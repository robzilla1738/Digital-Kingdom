/**
 * LP15 local attention queue in the real console (isolated synthetic server, fresh in-memory DB, seeded demo
 * projects; Chromium headless with software WebGL requested — no GPU claim). No notification destination exists; the
 * test also asserts the page talks only to the local server.
 */
import { test, expect } from '@playwright/test';
import type { Finding } from '@dk/contracts';
import { createRedesignHarness, loginRedesign, captureRedesign, writeRedesignEvidence, type RedesignHarness } from './redesign-harness.ts';

let harness: RedesignHarness;
let kase: { id: string; title: string; version: number };
let target: Finding;
const P = '/api/projects/demo-castle';

test.beforeAll(async () => {
  harness = await createRedesignHarness();
  const findings: Finding[] = (await harness.api('GET', `${P}/findings`)).json;
  target = findings.find((f) => f.counterevidence_event_ids.length > 0)!;
  expect(target).toBeTruthy();
  const c = await harness.api('POST', `${P}/cases`, { title: 'Attention: contradicted block', scope: { question: 'Did the blocked request still reach data?', asset_ids: target.affected_asset_ids }, closure_criteria: 'Every question answered' });
  expect(c.status, JSON.stringify(c.json)).toBe(200);
  kase = c.json;
  const linked = await harness.api('POST', `${P}/cases/${kase.id}/items`, { kind: 'finding', ref: target.id, expected_version: kase.version });
  expect(linked.status, JSON.stringify(linked.json)).toBe(200);
  kase = linked.json;
  // new records on the case's assets from a run-owned synthetic source, delivered twice (a retry)
  const src = await harness.api('POST', `${P}/sources`, { id: 'lp15-src', label: 'lp15 synthetic source', kind: 'app_security', asset_ids: target.affected_asset_ids, dataset_kind: 'synthetic' });
  expect(src.status, JSON.stringify(src.json)).toBe(200);
  const now = Date.now();
  for (let retry = 0; retry < 2; retry++) for (let i = 0; i < 3; i++)
    harness.store.receive('demo-castle', 'lp15-src', { source_event_id: `lp15-${i}`, occurred_at: new Date(now - 60_000 + i).toISOString(), asset_ids: target.affected_asset_ids, action: 'request_received', outcome: 'success', route: '/lp15' });
  while (harness.store.processBatch().processed) { /* drain */ }
});
test.afterAll(async () => { await harness?.close(); });

test('LP15: the Cases workspace shows the deduplicated local attention queue; acknowledging closes nothing', async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness);
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  try {
    await page.getByRole('button', { name: 'Investigate', exact: true }).click();
    await page.getByRole('tab', { name: 'Cases', exact: true }).click();
    const panel = page.getByTestId('attention-queue');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('no notification is sent anywhere');
    const evidence = panel.locator('li[data-kind="new_evidence"]');
    await expect(evidence).toHaveCount(1);
    await expect(evidence).toContainText('3 records');
    await expect(evidence).toContainText(`case ${kase.id}`);
    const contra = panel.locator(`li[data-kind="contradiction"]`, { hasText: target.id });
    await expect(contra).toHaveCount(1);
    await expect(contra).toHaveAttribute('data-urgency', 'high');
    await expect(panel).not.toContainText('Attention: contradicted block'); // ids and counts only, no titles
    await captureRedesign(page, 'lp15-attention-queue');
    // acknowledge the contradiction: the item leaves the open list; the case and the finding are unchanged
    await contra.getByRole('button', { name: /^Acknowledge/ }).click();
    await expect(panel.getByRole('status')).toContainText('The case and finding are unchanged');
    await expect(panel.locator(`li[data-kind="contradiction"]`, { hasText: target.id })).toHaveCount(0);
    const caseAfter = (await harness.api('GET', `${P}/cases/${kase.id}`)).json;
    expect(caseAfter).toMatchObject({ status: 'open', version: kase.version });
    const findingAfter = (await harness.api('GET', `${P}/findings/${target.id}`)).json.finding;
    expect(findingAfter.lifecycle).toBe(target.lifecycle);
    expect(findingAfter.disposition).toBe(target.disposition);
    // open the case from the queue, without the camera
    await evidence.getByRole('button', { name: 'Open case' }).click();
    await expect(page.getByTestId('case-detail')).toContainText(kase.title);
    // the queue never reaches beyond the local server
    expect([...hosts]).toEqual([new URL(harness.serverUrl).host]);
    const replay = (await harness.api('GET', `${P}/attention/replay?after=0&limit=500`)).json;
    writeRedesignEvidence('attention-verification.json', { test: 'LP15', new_evidence_records: 3, retried_deliveries_merged: true, contradiction_urgency: 'high', acknowledged: target.id, case_status_after_ack: caseAfter.status, finding_lifecycle_after_ack: findingAfter.lifecycle, hosts: [...hosts].length, replay_changes: replay.changes.length });
  } finally { await context.close(); }
});
