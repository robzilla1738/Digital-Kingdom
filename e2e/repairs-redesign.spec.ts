/**
 * LP14 repair candidate tradeoff table in the real console (isolated synthetic server, fresh in-memory DB, seeded
 * demo project; Chromium headless with software WebGL requested — no GPU claim). The candidate set is generated
 * through the same HTTP API the console uses; nothing is applied, approved or executed.
 */
import { test, expect } from '@playwright/test';
import { createRedesignHarness, loginRedesign, captureRedesign, writeRedesignEvidence, type RedesignHarness } from './redesign-harness.ts';

let harness: RedesignHarness;
let kase: { id: string; title: string };
let set: { id: string; status: string; candidates: { candidate_id: string; rank: number; valid: boolean; template: { id: string }; plan: { plan_id: string; authority: string }; tradeoffs: { objective_coverage: { blocked: number; of: number }; disruption: { permitted_broken: string[] } } }[] };
const P = '/api/projects/demo-castle';
const A = '111122223333', deployer = `arn:aws:iam::${A}:user/deployer`;
const reports = 'arn:aws:s3:::castle-reports', secrets = 'arn:aws:s3:::castle-secrets';

test.beforeAll(async () => {
  harness = await createRedesignHarness();
  const snap = { snapshot_id: 'lp14-e2e', taken_at: '2026-10-23T18:00:00Z', organization: null,
    principals: [{ arn: deployer, account: A, type: 'user', access_keys: [{ id: 'AKIATESTDEPLOYER0001', status: 'Active' }], policies: [{ id: 'pol', Statement: [
      { Sid: 'ReadReports', Effect: 'Allow', Action: ['s3:GetObject'], Resource: `${reports}/*` },
      { Sid: 'ReadAnything', Effect: 'Allow', Action: ['s3:GetObject'], Resource: 'arn:aws:s3:::*' }] }] }],
    resources: [{ arn: reports, account: A, policy: null }, { arn: secrets, account: A, policy: null }] };
  expect((await harness.api('POST', `${P}/access/snapshot`, snap)).status).toBe(200);
  const c = await harness.api('POST', `${P}/cases`, { title: 'Repair: over-broad deployer read', scope: { question: 'Can the deployer read the secrets bucket?', asset_ids: ['api'] }, closure_criteria: 'Repair reviewed' });
  expect(c.status, JSON.stringify(c.json)).toBe(200);
  kase = c.json;
  const state = (await harness.api('GET', `${P}/analysis/state`)).json;
  const r = await harness.api('POST', `${P}/cases/${kase.id}/repairs`, { base_state_hash: state.state_hash, objective: {
    prohibited: [{ id: 'deny-secrets-read', kind: 'permission', principal: deployer, action: 's3:GetObject', resource: `${secrets}/payroll.csv` }],
    permitted: [{ id: 'allow-report-read', kind: 'permission', principal: deployer, action: 's3:GetObject', resource: `${reports}/q3.csv` }] } });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  set = r.json;
});
test.afterAll(async () => { await harness?.close(); });

test('LP14-A1/A2: the case workbench shows ranked plan-only repair candidates with their recorded tradeoffs', async ({ browser }) => {
  expect(set.candidates.length).toBeGreaterThanOrEqual(2);
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await page.getByRole('button', { name: 'Investigate', exact: true }).click();
    await page.getByRole('tab', { name: 'Cases', exact: true }).click();
    await page.getByLabel('Case list').getByRole('button', { name: kase.title, exact: true }).click();
    const box = page.getByTestId('wb-repairs');
    await expect(box).toBeVisible();
    await expect(box).toContainText(`plan only · ${set.status.replace(/_/g, ' ')}`);
    await expect(box).toContainText('not a claim of global optimality');
    await expect(box).toContainText('No plan here is approved or applied');
    const rows = box.locator('tbody tr');
    await expect(rows).toHaveCount(set.candidates.length);
    const shown = await rows.evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? '')));
    for (const [i, c] of set.candidates.entries()) {
      expect(shown[i]![0]).toBe(String(c.rank));
      expect(shown[i]![1]).toBe(c.template.id);
      expect(shown[i]![3]).toBe(`${c.tradeoffs.objective_coverage.blocked} of ${c.tradeoffs.objective_coverage.of}`);
      expect(shown[i]![7]).toContain(c.plan.plan_id);
      expect(c.plan.authority).toBe('plan_only');
    }
    // the broad candidate (deactivating the key) breaks the permitted report read; the table says so
    const broad = set.candidates.find((c) => c.template.id === 'deactivate-test-token')!;
    expect(broad.tradeoffs.disruption.permitted_broken).toEqual(['allow-report-read']);
    expect(shown[set.candidates.indexOf(broad)]![4]).toBe('1 of 1');
    await box.scrollIntoViewIfNeeded();
    await captureRedesign(page, 'lp14-repair-tradeoffs');
    writeRedesignEvidence('repair-tradeoffs-verification.json', { test: 'LP14-A1/A2', status: set.status, rows: shown.map((r) => ({ rank: r[0], template: r[1], target: r[2], blocked: r[3], permitted_broken: r[4], changes: r[5], unknowns: r[6], plan: r[7] })) });
  } finally { await context.close(); }
});
