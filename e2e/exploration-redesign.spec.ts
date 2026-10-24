/** LP13 "Why can this reach that?" in the real console (isolated synthetic server; seeded demo inventory). */
import { test, expect } from '@playwright/test';
import { createRedesignHarness, loginRedesign, captureRedesign, writeRedesignEvidence, type RedesignHarness } from './redesign-harness.ts';

let harness: RedesignHarness;
const ACCT = '111122223333', role = `arn:aws:iam::${ACCT}:role/export-job`, bucket = 'arn:aws:s3:::castle-exports';
test.beforeAll(async () => {
  harness = await createRedesignHarness();
  const snap = { snapshot_id: 'lp13-e2e', taken_at: '2026-10-20T14:00:00Z', organization: null,
    principals: [{ arn: role, account: ACCT, type: 'role', trust: { id: 'trust', Statement: [] }, policies: [{ id: 'export', Statement: [{ Sid: 'ReadWithMfa', Effect: 'Allow', Action: ['s3:GetObject'], Resource: `${bucket}/*`, Condition: { Bool: { 'aws:MultiFactorAuthPresent': 'true' } } }] }] }],
    resources: [{ arn: bucket, account: ACCT, policy: null }] };
  expect((await harness.api('POST', '/api/projects/demo-castle/access/snapshot', snap)).status).toBe(200);
});
test.afterAll(async () => { await harness?.close(); });

test('LP13-A1: path inspector lists provenance per hop; only observed activity is marked animated; conditional permission is not', async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await page.getByRole('button', { name: 'Coverage', exact: true }).click();
    await page.getByRole('tab', { name: 'Paths', exact: true }).click();
    const panel = page.getByTestId('path-inspector');
    await panel.getByLabel('Path from').selectOption('web');
    await panel.getByLabel('Path to').selectOption('db');
    await panel.locator('summary', { hasText: 'Permission' }).click();
    await panel.getByLabel('Principal ARN').fill(role);
    await panel.getByLabel('Action').fill('s3:GetObject');
    await panel.getByLabel('Resource ARN').fill(`${bucket}/ledger.csv`);
    await panel.getByRole('button', { name: 'Explain', exact: true }).click();
    const result = panel.getByTestId('path-result');
    await expect(result).toContainText('Declared path (not observed end to end)');
    const first = result.locator('.path-list > li').first();
    await expect(first.locator('li[data-basis="observed_activity"]')).toHaveAttribute('data-animate', 'true');
    await expect(first.locator('li[data-basis="declared_relationship"]').first()).toHaveAttribute('data-animate', 'false');
    await expect(first).toContainText('provenance fixture:inventory-manifest');
    const perm = panel.getByTestId('path-permission');
    await expect(perm).toContainText('Configured permission: conditional');
    await expect(perm).toContainText('conditions not evaluated: aws:MultiFactorAuthPresent must hold');
    const permHops = perm.locator('li[data-basis="configured_permission"]');
    expect(await permHops.count()).toBeGreaterThan(0);
    for (const v of await permHops.evaluateAll((els) => els.map((e) => e.getAttribute('data-animate')))) expect(v).toBe('false');
    await perm.scrollIntoViewIfNeeded();
    await captureRedesign(page, 'lp13-path-inspector');
    writeRedesignEvidence('path-inspector-verification.json', { test: 'LP13-A1', observed_hops_animated: true, declared_hops_animated: false, permission: 'conditional', permission_hops_animated: false });
  } finally { await context.close(); }
});
