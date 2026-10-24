/**
 * LP16 world hierarchy and semantic zoom in the real console. Chromium headless with software WebGL (SwiftShader)
 * requested; screenshots are labelled as such and make no GPU claim. Offline cases use the explicit synthetic scale
 * fixture; server cases use the isolated in-memory harness (seeded synthetic demo project).
 */
import { test, expect, type Page } from '@playwright/test';
import { createRedesignHarness, loginRedesign, offlineRedesign, captureRedesign, writeRedesignEvidence, type RedesignHarness } from './redesign-harness.ts';

let h: RedesignHarness;
const evidence: Record<string, unknown> = {};
test.beforeAll(async () => { h = await createRedesignHarness(); });
test.afterAll(async () => { writeRedesignEvidence('lp16-world-verification.json', evidence); await h?.close(); });

async function rendered(page: Page) {
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  await expect.poll(async () => Number(await canvas.getAttribute('data-render-count')), { timeout: 30_000 }).toBeGreaterThan(1);
  return canvas;
}
async function settled(page: Page) {
  const canvas = page.locator('canvas').first();
  await expect.poll(async () => { const a = await canvas.getAttribute('data-camera-pose'); await page.waitForTimeout(450); return a !== null && a === await canvas.getAttribute('data-camera-pose') && await canvas.getAttribute('data-camera-active') !== 'true'; }, { timeout: 15_000 }).toBe(true);
  return canvas.getAttribute('data-camera-pose');
}

test('LP16-A3: 200-asset world — complete district membership lists, search, shared focus with the 2D graph, semantic level', async ({ browser }) => {
  const { context, page } = await offlineRedesign(browser, h, '?fixture=F13#workspace=kingdom&view=castle');
  try {
    await rendered(page);
    await page.getByRole('tab', { name: 'World', exact: true }).click();
    const nav = page.getByTestId('world-navigator');
    await expect(nav).toBeVisible();
    // every district lists ALL of its members; the counts add up to the 200 logical assets
    const districts = nav.locator('[data-world-node*="/district:"]');
    const n = await districts.count();
    expect(n).toBeGreaterThan(3);
    let total = 0; const perDistrict: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const d = districts.nth(i), id = (await d.getAttribute('data-world-node'))!;
      const count = Number(await d.locator('.count').first().innerText());
      await d.getByRole('button', { name: /^Show all \d+ members of/ }).click();
      await expect(d.locator('[data-world-structure]')).toHaveCount(count);
      perDistrict[id] = count; total += count;
      await d.getByRole('button', { name: /^Hide all \d+ members of/ }).click();
    }
    expect(total).toBe(200);
    // focus one district: the castle frames it, grouped membership opens, and the same focus reaches the 2D graph
    const canvas = page.locator('canvas').first();
    const before = await settled(page);
    const target = Object.keys(perDistrict).filter((id) => id.endsWith('/district:automation')).sort((a, b) => perDistrict[b]! - perDistrict[a]!)[0]!;
    await nav.locator(`[data-world-node="${target}"] .world-row .link-row`).click();
    await expect(page).toHaveURL(new RegExp(`wf=${encodeURIComponent(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    const framed = await settled(page);
    expect(framed).not.toBe(before);
    const panel = page.locator('.scene-group-panel');
    await expect(panel).toContainText(`members`);
    await expect(panel.locator('li')).toHaveCount(perDistrict[target]!);
    await captureRedesign(page, 'lp16-world-navigator-district-focus-200');
    // search finds an asset hidden inside an aggregated district; selecting it is the canonical asset id
    await page.getByLabel('Search world').fill('Synthetic pipeline 017');
    const result = nav.locator('[data-world-result]');
    await expect(result).toHaveCount(1);
    const id = (await result.getAttribute('data-world-result'))!;
    await result.click();
    await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', id);
    // the result's structure becomes the shared focus: the castle frames it and its label is drawn
    await expect.poll(() => decodeURIComponent(page.url())).toContain(`/structure:${id}`);
    await settled(page);
    await expect(page.locator(`[data-asset-label="${id}"]`).locator('xpath=..')).toHaveAttribute('data-label-visible', 'true');
    // the result row stays inside the sidebar (no clipped text)
    const fits = await result.evaluate((el) => { const r = el.getBoundingClientRect(), side = el.closest('aside')!.getBoundingClientRect(); return r.right <= side.right + 0.5 && el.scrollWidth <= el.clientWidth + 1; });
    expect(fits).toBe(true);
    await captureRedesign(page, 'lp16-world-search-selection-200');
    // the 2D graph shares focus and selection
    await page.getByRole('radio', { name: '2D graph', exact: true }).click();
    await expect(page.locator('svg.graph2d')).toBeVisible();
    await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', id);
    expect(page.url()).toContain('wf=');
    await captureRedesign(page, 'lp16-world-graph-shared-focus-200');
    // back through focus history restores the previous focus in any view
    await page.getByRole('radio', { name: '3D castle', exact: true }).click();
    await rendered(page);
    await settled(page);
    await page.getByLabel('Search world').fill('');
    await nav.getByRole('button', { name: 'All environments', exact: true }).click();
    await expect.poll(() => page.url()).not.toContain('wf=');
    await page.goBack();
    const structureFocus = Object.keys(perDistrict).find((d) => d.startsWith('env:synthetic-design/district:delivery'))! + `/structure:${id}`;
    await expect.poll(() => decodeURIComponent(page.url())).toContain(`wf=${structureFocus}`);
    // further Back steps walk the same history (view switches included) to the district focus chosen first
    const atTarget = () => decodeURIComponent(page.url()).split('#')[1]?.split('&').includes(`wf=${target}`) ?? false;
    let steps = 0;
    while (!atTarget() && steps < 6) { await page.goBack(); steps++; await page.waitForTimeout(250); }
    expect(atTarget()).toBe(true);
    await rendered(page);
    // semantic zoom: zooming changes the semantic level (labels thin out, findings are not hidden)
    const levels: string[] = [];
    for (let i = 0; i < 7; i++) { await page.getByRole('toolbar', { name: 'Castle view' }).getByRole('button', { name: 'Zoom out', exact: true }).click(); await page.waitForTimeout(160); }
    await settled(page);
    levels.push((await canvas.getAttribute('data-semantic-level'))!);
    for (let i = 0; i < 12; i++) { await page.getByRole('toolbar', { name: 'Castle view' }).getByRole('button', { name: 'Zoom in', exact: true }).click(); await page.waitForTimeout(160); }
    await settled(page);
    levels.push((await canvas.getAttribute('data-semantic-level'))!);
    expect(new Set(levels).size).toBe(2);
    await expect(page.getByTestId('semantic-level')).toHaveText(levels[1]!);
    evidence.a3 = { fixture: 'F13 (200 synthetic assets)', districts: perDistrict, total, focused: target, searchSelected: id, framedCameraChanged: before !== framed, semanticLevels: levels };
  } finally { await context.close(); }
});

test('LP16-A2: a removed and recreated asset shows its archived placement and its own incarnation', async ({ browser }) => {
  const P = '/api/projects/demo-castle';
  const graph = structuredClone(h.store.getGraph('demo-castle')!) as any;
  const without = { ...graph, graph_revision: `${graph.graph_revision}-lp16-minus`, assets: graph.assets.filter((a: { id: string }) => a.id !== 'blob'), relationships: graph.relationships.filter((r: { source_id: string; target_id: string }) => r.source_id !== 'blob' && r.target_id !== 'blob') };
  expect((await h.api('POST', `${P}/graph`, without)).status).toBe(200);
  const back = { ...graph, graph_revision: `${graph.graph_revision}-lp16-again` };
  expect((await h.api('POST', `${P}/graph`, back)).status).toBe(200);
  const loc = (await h.api('GET', `${P}/scene/locate/blob`)).json;
  expect(loc.incarnations.map((i: { incarnation_id: string }) => i.incarnation_id)).toEqual(['blob~2', 'blob~1']);
  const { context, page } = await loginRedesign(browser, h);
  try {
    await rendered(page);
    await page.getByRole('tab', { name: 'World', exact: true }).click();
    await page.getByLabel('Show archived placements (1)').check();
    const label = page.locator('[data-archived-asset="blob"]');
    await expect(label).toHaveCount(1);
    await expect(label).toHaveAttribute('data-incarnation', 'blob~1');
    await settled(page);
    await expect(label.locator('xpath=..')).toHaveAttribute('data-label-visible', 'true');
    await captureRedesign(page, 'lp16-archived-placement');
    // the current incarnation's record lists the earlier incarnation separately
    await page.getByLabel('Search world').fill('blob');
    const results = page.locator('[data-world-result="blob"]');
    await expect(results).toHaveCount(2);
    await expect(results.nth(1)).toHaveAttribute('data-world-state', 'archived');
    await results.first().click();
    await expect(page.getByTestId('earlier-incarnations')).toBeVisible();
    await expect(page.locator('aside.evidence')).toContainText('blob~1 · retired in');
    await captureRedesign(page, 'lp16-earlier-incarnation-record');
    evidence.a2 = { incarnations: loc.incarnations, archivedLabel: 'blob~1', current: loc.incarnation };
  } finally { await context.close(); }
});

test('LP16-A4: case scope and evidence scope survive WebGL loss, resize, back navigation and selection changes', async ({ browser }) => {
  const c = await h.api('POST', '/api/projects/demo-castle/cases', { title: 'LP16 scope: api data reads', scope: { question: 'Which reads reached the database?', asset_ids: ['api', 'db'] }, closure_criteria: 'Reviewed' });
  expect(c.status, JSON.stringify(c.json)).toBe(200);
  const { context, page } = await loginRedesign(browser, h);
  try {
    await page.getByRole('button', { name: 'Investigate', exact: true }).click();
    await page.getByRole('tab', { name: 'Cases', exact: true }).click();
    await page.getByLabel('Case list').getByRole('button', { name: c.json.title, exact: true }).click();
    await expect.poll(() => page.url()).toContain(`case=${c.json.id}`);
    await page.getByRole('button', { name: 'Kingdom', exact: true }).click();
    const chip = page.getByTestId('case-scope');
    await expect(chip).toContainText(`Case scope · ${c.json.title} · 2 scoped assets`);
    await rendered(page);
    await page.getByRole('tab', { name: /^Assets/ }).click();
    await page.locator('aside.sidebar [data-asset-id="api"]').click();
    await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', 'api');
    await page.locator('aside.sidebar [data-asset-id="db"]').click();
    await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', 'db');
    // real context loss: graph fallback keeps case, selection and view label
    const lost = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => { const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null; const ext = gl?.getExtension('WEBGL_lose_context'); if (!ext) return false; ext.loseContext(); return true; });
    expect(lost).toBe(true);
    await expect(page.getByRole('region', { name: 'Asset relationship graph', exact: true })).toBeVisible();
    await expect(chip).toContainText(c.json.title);
    await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', 'db');
    await expect(page.getByTestId('world-view-label')).toHaveAttribute('data-view-mode', 'current');
    await captureRedesign(page, 'lp16-case-scope-after-webgl-loss');
    // resize to a narrow viewport and back: same case and selection
    await page.setViewportSize({ width: 820, height: 900 });
    await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', 'db');
    expect(page.url()).toContain(`case=${c.json.id}`);
    await captureRedesign(page, 'lp16-case-scope-narrow');
    await page.setViewportSize({ width: 1440, height: 900 });
    // back navigation restores the previous selection, case intact
    await page.goBack();
    await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', 'api');
    await expect(chip).toContainText(c.json.title);
    expect(page.url()).toContain(`case=${c.json.id}`);
    evidence.a4 = { case: c.json.id, contextLoss: 'real WEBGL_lose_context', afterLoss: 'db', afterBack: 'api', resized: ['820x900', '1440x900'] };
  } finally { await context.close(); }
});
