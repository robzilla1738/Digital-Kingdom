/** LP17: rendered evidence for the six architectural families (explicit offline synthetic fixtures, SwiftShader). */
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import { captureRedesign, createRedesignHarness, writeRedesignEvidence, type RedesignHarness } from './redesign-harness.ts';

const FAMILIES = ['dns_registry', 'dispatch_house', 'key_registry', 'supply_depot', 'archive', 'outpost'];
let h: RedesignHarness;
const report: Record<string, unknown>[] = [];
test.beforeAll(async () => { h = await createRedesignHarness(); });
test.afterAll(async () => {
  writeRedesignEvidence('lp17-families-verification.json', { scope: 'Explicit offline synthetic fixtures (moduleSheet=families|all, fixture=F15) in Chromium headless with SwiftShader; no GPU or production claim.', cases: report });
  await h?.close();
});

async function settled(page: Page) {
  const canvas = page.locator('canvas');
  await expect.poll(async () => (await canvas.screenshot({ timeout: 30_000 })).length, { timeout: 60_000 }).toBeGreaterThan(25_000);
  await page.waitForTimeout(600);
}

test('LP17-A1: contact sheet of the six families, roofs on and off', async ({ page }) => {
  await page.goto(h.offlineUrl + '/?moduleSheet=families');
  await expect(page.getByRole('heading', { name: /six architectural families/ })).toBeVisible();
  await expect(page.locator('[data-module-sheet="families"]')).toHaveAttribute('data-module-count', '6');
  for (const id of FAMILIES) await expect(page.locator(`[data-sheet-module="${id}"]`)).toBeVisible();
  await expect(page.locator('[data-module-sheet="families"]')).toContainText('does not mean the asset is discovered');
  await settled(page);
  const roofsOn = await page.locator('canvas').screenshot({ timeout: 30_000 });
  await captureRedesign(page, 'lp17-families-contact-sheet');
  await page.getByRole('button', { name: 'Hide roofs', exact: true }).click(); await page.waitForTimeout(700);
  const roofsOff = await page.locator('canvas').screenshot({ timeout: 30_000 });
  expect(roofsOff.equals(roofsOn), 'Removing roofs must change the rendered pixels').toBe(false);
  await captureRedesign(page, 'lp17-families-contact-sheet-roofs-off');
  report.push({ case: 'families contact sheet', modules: FAMILIES, roofsToggleChangesPixels: true, result: 'passed' });
});

test('LP17-A1: module sheet renders all 16 stable module IDs', async ({ page }) => {
  await page.goto(h.offlineUrl + '/?moduleSheet=all');
  await expect(page.getByRole('heading', { name: /16 stable module IDs/ })).toBeVisible();
  await expect(page.locator('[data-sheet-module]')).toHaveCount(16);
  for (const id of FAMILIES) await expect(page.locator(`[data-sheet-module="${id}"]`)).toBeVisible();
  await settled(page);
  await captureRedesign(page, 'lp17-module-sheet-16');
  report.push({ case: '16-module sheet', count: 16, result: 'passed' });
});

test('LP17-A2/A4: F15 mixed world; with roofs off each family plinth selects its own record and clear ground selects nothing new', async ({ page }) => {
  const THREE = createRequire(new URL('../apps/web/package.json', import.meta.url))('three') as typeof import('three');
  const { applyRedesignFixture } = await import('../fixtures/redesign/offline.ts');
  const { demoGraph } = await import('../fixtures/testing/load.ts');
  const { realmPresentation } = await import('../apps/web/src/castle/scenePresentation.ts');
  // F15's scene depends only on the demo graph (recordProposal over declared fields); Node cannot load the
  // Vite JSON imports of loadOfflineDemo, so the same synthetic graph is read through the Node fixture loader.
  const graph = demoGraph();
  const base = { mode: 'offline-demo', project: { id: graph.project_id, name: 'x', dataset_kind: 'synthetic' }, projects: [], graph, sources: [], events: [], evidence: {}, findings: [], coverage: [], unobserved_asset_ids: [] } as never;
  const fixture = applyRedesignFixture(base, 'F15');
  // next-C: the castle draws the display-only realm packing (stored layout unchanged), so pick in those coordinates.
  const rooms = realmPresentation(fixture.scene, fixture.graph).rooms;
  const familyRooms = FAMILIES.map(f => rooms.find(r => r.module_id === f)!);
  expect(familyRooms.every(Boolean)).toBe(true);
  await page.goto(h.offlineUrl + '/?fixture=F15#workspace=kingdom&view=castle');
  const canvas = page.locator('canvas');
  await expect.poll(async () => Number(await canvas.getAttribute('data-render-count'))).toBeGreaterThan(0);
  for (const r of familyRooms) await expect(page.locator(`[data-asset-label="${r.asset_id}"]`)).toHaveCount(1);
  await settled(page);
  await captureRedesign(page, 'lp17-f15-mixed-world');
  const evidence = page.locator('aside.evidence'), toolbar = page.getByRole('toolbar', { name: 'Castle view' });
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 800);
  let rect = (await canvas.boundingBox())!;
  const readPose = async () => {
    const pose = JSON.parse((await canvas.getAttribute('data-camera-pose'))!); rect = (await canvas.boundingBox())!;
    camera.left = -rect.width / 2; camera.right = rect.width / 2; camera.top = rect.height / 2; camera.bottom = -rect.height / 2;
    camera.zoom = pose.zoom; camera.position.fromArray(pose.position); camera.lookAt(new THREE.Vector3(...pose.target)); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    return pose;
  };
  const toScreen = (x: number, y: number, z: number) => { const s = new THREE.Vector3(x, y, z).project(camera); return { x: rect.x + (s.x + 1) / 2 * rect.width, y: rect.y + (1 - s.y) / 2 * rect.height }; };
  const select = async (id: string) => { await page.evaluate(id => { location.hash = 'workspace=kingdom&view=castle&sel=asset:' + id; }, id); await expect(evidence).toHaveAttribute('data-selection-id', id); };
  const focus = async (id: string) => {
    await select(id); await toolbar.getByRole('button', { name: 'Focus selection', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-camera-active', 'true'); await expect(canvas).toHaveAttribute('data-camera-active', 'false'); await page.waitForTimeout(250);
  };
  // Environment (overview) scale: the LP16 world navigator frames the synthetic-design environment holding the six families.
  // Open the inspector first (a selection), so the environment is framed for the canvas width actually used while picking.
  await select('families-names'); await page.waitForTimeout(400);
  await page.getByRole('tab', { name: 'World', exact: true }).click();
  const envRow = page.getByTestId('world-navigator').locator('[data-world-node="env:synthetic-design"] > button.link-row');
  await expect(envRow).toContainText('6');
  const framedBefore = await canvas.getAttribute('data-camera-pose');
  await envRow.click();
  await expect.poll(() => canvas.getAttribute('data-camera-pose')).not.toBe(framedBefore);
  await expect(canvas).toHaveAttribute('data-camera-active', 'false'); await page.waitForTimeout(600);
  await captureRedesign(page, 'lp17-f15-families-district');
  const roofsOn = await canvas.screenshot({ timeout: 30_000 });
  await toolbar.getByRole('button', { name: 'Show roofs' }).click(); await page.waitForTimeout(700);
  expect((await canvas.screenshot({ timeout: 30_000 })).equals(roofsOn), 'roofs-off changes the rendered world').toBe(false);
  await captureRedesign(page, 'lp17-f15-families-district-roofs-off');
  const clicks: Record<string, unknown>[] = [];
  const offsets = [[0, 0], [0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2], [0.3, 0.3], [-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3]];
  const pick = async (r: typeof familyRooms[number]) => {
    const other = familyRooms.find(o => o.asset_id !== r.asset_id)!.asset_id;
    await select(other); await page.waitForTimeout(120); await readPose();
    for (const [ox, oz] of offsets) {
      const p = toScreen(r.position.x + ox! * r.footprint.w, 0.2, r.position.z + oz! * r.footprint.d);
      if (p.x < rect.x + 8 || p.x > rect.x + rect.width - 8 || p.y < rect.y + 8 || p.y > rect.y + rect.height - 8) continue;
      if (!await page.evaluate(q => document.elementFromPoint(q.x, q.y)?.tagName === 'CANVAS', p)) continue;
      await page.mouse.click(p.x, p.y);
      if (await evidence.getAttribute('data-selection-id') === r.asset_id) return p;
    }
    return null;
  };
  // Overview (district) scale with roofs off: every family is clickable through its floor.
  for (const r of familyRooms) {
    const hit = await pick(r);
    expect(hit, `${r.module_id}: a roofs-off floor point at environment scale must select ${r.asset_id}`).not.toBeNull();
    const capability = page.getByTestId('family-capability');
    await expect(capability).toBeVisible();
    await expect(capability).toContainText('does not mean this asset is discovered, monitored or protected');
    clicks.push({ scale: 'environment', module: r.module_id, asset: r.asset_id, point: hit, support: await capability.getAttribute('data-support') });
  }
  // Interior scale: focus each building (roofs stay off) and click its exposed floor.
  for (const r of familyRooms) {
    await focus(r.asset_id);
    const hit = await pick(r);
    expect(hit, `${r.module_id}: a roofs-off floor point at interior scale must select ${r.asset_id}`).not.toBeNull();
    clicks.push({ scale: 'interior', module: r.module_id, asset: r.asset_id, point: hit, zoom: (await readPose()).zoom });
  }
  await captureRedesign(page, 'lp17-f15-roofs-off-family-selected');
  // A ground point clear of every footprint (by 1.2 m) must not select any building.
  const inside = (x: number, z: number) => rooms.some(o => Math.abs(x - o.position.x) < o.footprint.w / 2 + 1.2 && Math.abs(z - o.position.z) < o.footprint.d / 2 + 1.2);
  const b = realmPresentation(fixture.scene, fixture.graph).bounds;
  let ground: null | { x: number; y: number; world: number[]; selection: string | null } = null;
  await envRow.click(); await page.waitForTimeout(800);
  const anchor = familyRooms[0]!.asset_id; await readPose();
  for (let gx = b.minX; gx <= b.maxX && !ground; gx += 0.9) for (let gz = b.minZ; gz <= b.maxZ && !ground; gz += 0.9) {
    if (inside(gx, gz)) continue;
    const p = toScreen(gx, 0.02, gz);
    if (p.x < rect.x + 40 || p.x > rect.x + rect.width - 40 || p.y < rect.y + 40 || p.y > rect.y + rect.height - 120) continue;
    if (!await page.evaluate(q => document.elementFromPoint(q.x, q.y)?.tagName === 'CANVAS', p)) continue;
    await page.evaluate(id => { location.hash = 'workspace=kingdom&view=castle&sel=asset:' + id; }, anchor);
    await expect(evidence).toHaveAttribute('data-selection-id', anchor); await page.waitForTimeout(80);
    await page.mouse.click(p.x, p.y); await page.waitForTimeout(150);
    const sel = await evidence.getAttribute('data-selection-id');
    // Relationship paths on the ground may legitimately be picked; a building may not.
    expect(rooms.filter(o => o.asset_id !== anchor).some(o => o.asset_id === sel), `ground ${gx},${gz} picked building ${sel}`).toBe(false);
    ground = { x: p.x, y: p.y, world: [gx, 0, gz], selection: sel };
  }
  expect(ground, 'a visible clear-ground point exists').not.toBeNull();
  report.push({ case: 'F15 roofs-off click-through', clicks, clearGround: ground, result: 'passed' });
});
