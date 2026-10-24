/** LP19: baseline-versus-repair comparison drawn on the same castle (API-backed isolated synthetic server, SwiftShader). */
import { test, expect } from '@playwright/test';
import { captureRedesign, createRedesignHarness, writeRedesignEvidence, type RedesignHarness } from './redesign-harness.ts';

let h: RedesignHarness;
test.beforeAll(async () => { h = await createRedesignHarness(); });
test.afterAll(async () => { await h?.close(); });

test('LP19-A1..A4: the repair comparison marks the same baseline rooms, keeps model-only separate from executed, and changes no baseline state', async ({ browser }) => {
  const state = (await h.api('GET', '/api/projects/demo-castle/analysis/state')).json;
  const created = await h.api('POST', '/api/projects/demo-castle/analysis/comparisons', { base_state_hash: state.state_hash, label: 'LP19 browser', changes: [
    { op: 'modify', kind: 'source', authority: 'demo-castle', id: 'src-app', attrs: { disabled: true } },
    { op: 'add', kind: 'route', authority: 'demo-castle/demo', id: 'edge POST /admin', attrs: { asset_id: 'edge', path: '/admin', methods: ['POST'] } },
  ] });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  const id = created.json.id;
  const before = (await h.api('GET', '/api/projects/demo-castle/snapshot')).json;
  const world = (await h.api('GET', `/api/projects/demo-castle/analysis/comparisons/${id}/world`)).json;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.goto(`${h.serverUrl}/?project=demo-castle&cmp=${id}#workspace=kingdom&view=castle`);
    await page.getByLabel('API token').fill(h.adminToken); await page.getByRole('button', { name: /^Sign in$/i }).click();
    const panel = page.getByTestId('world-comparison');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId('comparison-revisions')).toContainText(world.revisions.baseline.state_hash.slice(0, 12));
    await expect(panel.getByTestId('comparison-revisions')).toContainText(world.revisions.candidate.state_hash.slice(0, 12));
    for (const c of world.changes) await expect(panel.locator(`[data-change-key="${c.key}"]`)).toHaveAttribute('data-op', c.op);
    await expect(panel.getByTestId('comparison-executed-local')).toContainText('not a verified executed control');
    await expect(panel).toContainText('never a security fact');
    for (const r of world.rooms.filter((x: { baseline_position: unknown }) => x.baseline_position)) await expect(page.locator(`[data-comparison-room="${r.asset_id}"]`)).toHaveAttribute('data-change', r.change);
    // the ordinary asset labels (canonical records) are all still there, no room was added/moved
    await expect(page.locator('[data-asset-label]')).toHaveCount(before.graph.assets.length);
    await page.waitForTimeout(600);
    await captureRedesign(page, 'lp19-baseline-vs-repair-castle');
    // a change row selects the same canonical asset record
    const first = world.changes.find((c: { asset_ids: string[] }) => c.asset_ids.length)!;
    await panel.locator(`[data-change-key="${first.key}"]`).getByRole('button', { name: first.asset_ids[0], exact: true }).click();
    await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', first.asset_ids[0]);
    // A1: nothing about the baseline changed
    const after = (await h.api('GET', '/api/projects/demo-castle/snapshot')).json;
    for (const f of ['graph', 'scene', 'sources', 'coverage', 'findings']) expect(after[f], f).toEqual(before[f]);
    expect((await h.api('GET', '/api/projects/demo-castle/analysis/state')).json.state_hash).toBe(state.state_hash);
    writeRedesignEvidence('lp19-comparison-verification.json', { scope: 'API-backed isolated synthetic server (demo-castle); one LP13 model-only comparison; Chromium headless SwiftShader.', comparison: id, revisions: world.revisions, rooms: world.rooms, changes: world.changes.map((c: { key: string; op: string }) => ({ key: c.key, op: c.op })), baselineUnchanged: ['graph', 'scene', 'sources', 'coverage', 'findings', 'analysis state hash'], executedLocal: world.executed_local, result: 'passed' });
  } finally { await context.close(); }
});
