/**
 * next-C (post-phase review §E): active-environment framing in the mixed F15 world (castle + graph parity, explicit
 * realm overview) and attention compaction with the current case question in the first viewport. Explicit offline
 * synthetic fixture / API-backed isolated synthetic server; Chromium headless with SwiftShader (software WebGL). No GPU,
 * production or human-approval claim.
 */
import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRedesignHarness, loginRedesign, rendererDetails, writeRedesignEvidence, REDESIGN_ROOT, type RedesignHarness } from './redesign-harness.ts';

let h: RedesignHarness;
const report: Record<string, unknown>[] = [];
test.beforeAll(async () => { h = await createRedesignHarness(); });
test.afterAll(async () => { writeRedesignEvidence('next-c-focus-verification.json', { scope: 'next-C UX focus; synthetic fixtures; Chromium headless SwiftShader (software WebGL).', cases: report }); await h?.close(); });

/** Optional docs capture (DK_NEXT_C_SHOTS=1): same 1440x900 viewport as the review, labelled software WebGL. */
async function shot(page: Page, name: string, note: string) {
  if (!process.env.DK_NEXT_C_SHOTS) return;
  const dir = join(REDESIGN_ROOT, 'docs/phases/local-intelligence/screenshots/next-C'); mkdirSync(dir, { recursive: true });
  const bytes = await page.screenshot({ path: join(dir, `${name}.png`), timeout: 30_000 });
  let commit = 'unknown'; try { commit = execSync('git rev-parse HEAD', { cwd: REDESIGN_ROOT }).toString().trim(); } catch { /* not a checkout */ }
  writeFileSync(join(dir, `${name}.meta.json`), JSON.stringify({ name, file: `${name}.png`, phase: 'after', sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, commit, worktreeDirty: (() => { try { return execSync('git status --porcelain -- apps', { cwd: REDESIGN_ROOT }).toString().trim().length > 0; } catch { return null; } })(),
    capturedAt: new Date().toISOString(), viewport: page.viewportSize(), dpr: 1, browser: page.context().browser()?.version(), renderer: await rendererDetails(page), rendererNote: 'Chromium headless, SwiftShader software WebGL requested; no real-GPU claim.', url: page.url().replace(/token=[^&]+/, 'token=…'), note }, null, 2));
}
const pose = async (page: Page) => JSON.parse((await page.locator('canvas').getAttribute('data-camera-pose'))!) as { zoom: number; target: number[] };
async function settled(page: Page) {
  const canvas = page.locator('canvas');
  await expect.poll(async () => Number(await canvas.getAttribute('data-render-count'))).toBeGreaterThan(0);
  await expect(canvas).not.toHaveAttribute('data-camera-active', 'true');
  await expect.poll(async () => (await canvas.screenshot({ timeout: 30_000 })).length, { timeout: 60_000 }).toBeGreaterThan(25_000);
  await page.waitForTimeout(500);
}

test('next-C: F15 opens framed on the active environment; Realm overview is explicit; castle and graph share the framing', async ({ page }) => {
  await page.goto(h.offlineUrl + '/?fixture=F15#workspace=kingdom&view=castle');
  const framing = page.getByTestId('world-framing'), wrap = page.locator('.castle-wrap');
  await expect(framing).toBeVisible();
  await expect(framing).toHaveAttribute('data-implicit', 'true');
  const active = (await framing.getAttribute('data-framing'))!;
  expect(active).toMatch(/^env:/);
  await expect(wrap).toHaveAttribute('data-framing', active);
  await expect(wrap).toHaveAttribute('data-framing-implicit', 'true');
  await expect(framing.getByRole('button', { name: /^Active · / })).toHaveAttribute('aria-pressed', 'true');
  await expect(framing.getByRole('button', { name: /^Realm overview/ })).toHaveAttribute('aria-pressed', 'false');
  await settled(page);
  const framed = await pose(page);
  // every asset of both environments is still in the world (framing hides nothing)
  const labels = await page.locator('[data-asset-label]').count();
  await shot(page, 'after-f15-active-environment', 'Default: framed on the active environment (most urgent findings). Realm overview control in the toolbar.');
  // explicit realm overview frames every environment, written to the URL as world focus
  await framing.getByRole('button', { name: /^Realm overview/ }).click();
  await expect(framing).toHaveAttribute('data-implicit', 'false');
  await expect(framing).toHaveAttribute('data-framing', /^realm:/);
  await expect(wrap).toHaveAttribute('data-framing', /^realm:/);
  await expect(framing.getByRole('button', { name: /^Realm overview/ })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await pose(page)).zoom).toBeLessThan(framed.zoom / 1.3);
  await settled(page);
  expect(await page.locator('[data-asset-label]').count()).toBe(labels);
  expect(new URL(page.url()).hash).toContain('wf=realm');
  await shot(page, 'after-f15-realm-overview', 'Explicit Realm overview (both environments).');
  const overview = await pose(page);
  // back to the environment: explicit focus now, same camera scale as the implicit default
  await framing.getByRole('button', { name: /^Environment · |^Active · / }).click();
  await expect(wrap).toHaveAttribute('data-framing', active);
  await expect(wrap).toHaveAttribute('data-framing-implicit', 'false');
  await expect.poll(async () => (await pose(page)).zoom).toBeGreaterThan(overview.zoom * 1.3);
  // 2D parity: the graph reflects the same framing and marks membership without dimming in the implicit case
  await page.getByRole('radio', { name: '2D graph', exact: true }).click();
  const graph = page.locator('.graph-wrap');
  await expect(graph).toHaveAttribute('data-framing', active);
  await expect(graph.locator('[data-world-focus="member"]').first()).toBeVisible();
  await expect(graph.locator('[data-world-focus="outside"]').first()).toBeAttached();
  await framing.getByRole('button', { name: /^Realm overview/ }).click();
  await expect(graph).toHaveAttribute('data-framing', /^realm:/);
  await expect(graph.locator('[data-world-focus]')).toHaveCount(0);
  report.push({ case: 'F15 framing', active, implicit_zoom: framed.zoom, overview_zoom: overview.zoom, labels, graph_parity: true, result: 'passed' });
});

test('next-C follow-up: Realm overview packs environments with a bounded gap; populated bounds fill the stage', async ({ page }) => {
  const THREE = createRequire(new URL('../apps/web/package.json', import.meta.url))('three') as typeof import('three');
  const { applyRedesignFixture } = await import('../fixtures/redesign/offline.ts');
  const { demoGraph } = await import('../fixtures/testing/load.ts');
  const { realmPresentation, REALM_ENVIRONMENT_GAP } = await import('../apps/web/src/castle/scenePresentation.ts');
  // Same synthetic graph the offline F15 fixture uses (Node cannot load the Vite JSON imports of loadOfflineDemo).
  const graph = demoGraph();
  const base = { mode: 'offline-demo', project: { id: graph.project_id, name: 'x', dataset_kind: 'synthetic' }, projects: [], graph, sources: [], events: [], evidence: {}, findings: [], coverage: [], unobserved_asset_ids: [] } as never;
  const fixture = applyRedesignFixture(base, 'F15');
  const scene = realmPresentation(fixture.scene, fixture.graph), envOf = new Map(fixture.graph.assets.map(a => [a.id, a.environment]));
  await page.goto(h.offlineUrl + '/?fixture=F15#workspace=kingdom&view=castle');
  const wrap = page.locator('.castle-wrap'), canvas = page.locator('canvas');
  await settled(page);
  await page.getByTestId('world-framing').getByRole('button', { name: /^Realm overview/ }).click();
  await expect(wrap).toHaveAttribute('data-framing', /^realm:/);
  await settled(page);
  for (const r of scene.rooms) await expect(page.locator(`[data-asset-label="${r.asset_id}"]`)).toHaveCount(1);
  const p = await pose(page) as { zoom: number; target: number[]; position: number[] }, rect = (await canvas.boundingBox())!;
  const camera = new THREE.OrthographicCamera(-rect.width / 2, rect.width / 2, rect.height / 2, -rect.height / 2, 0.1, 800);
  camera.zoom = p.zoom; camera.position.fromArray(p.position); camera.lookAt(new THREE.Vector3(...(p.target as [number, number, number]))); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const toScreen = (x: number, y: number, z: number) => { const s = new THREE.Vector3(x, y, z).project(camera); return { x: (s.x + 1) / 2 * rect.width, y: (1 - s.y) / 2 * rect.height }; };
  // Screen-space extent of each environment's buildings (footprint corners at ground and roof height).
  const envBox = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
  for (const r of scene.rooms) for (const dx of [-1, 1]) for (const dz of [-1, 1]) for (const y of [0, r.height]) {
    const s = toScreen(r.position.x + dx * r.footprint.w / 2, y, r.position.z + dz * r.footprint.d / 2), e = envOf.get(r.asset_id)!;
    const b = envBox.get(e) ?? { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    envBox.set(e, { x0: Math.min(b.x0, s.x), x1: Math.max(b.x1, s.x), y0: Math.min(b.y0, s.y), y1: Math.max(b.y1, s.y) });
  }
  const boxes = [...envBox.values()].sort((a, b) => a.x0 - b.x0);
  expect(boxes.length).toBe(2);
  const union = { x0: Math.min(...boxes.map(b => b.x0)), x1: Math.max(...boxes.map(b => b.x1)), y0: Math.min(...boxes.map(b => b.y0)), y1: Math.max(...boxes.map(b => b.y1)) };
  const fillW = (union.x1 - union.x0) / rect.width, fillH = (union.y1 - union.y0) / rect.height;
  // the camera fits the populated union: it fills most of one stage dimension and stays on stage
  expect(Math.max(fillW, fillH)).toBeGreaterThan(0.6);
  expect(union.x0).toBeGreaterThan(-4); expect(union.x1).toBeLessThan(rect.width + 4);
  // the empty band between environments is small relative to the stage (it was ~half the width before packing)
  const gaps = boxes.slice(1).map((b, i) => Math.max(0, b.x0 - boxes[i]!.x1) / rect.width);
  for (const g of gaps) expect(g).toBeLessThan(0.15);
  const occupied = boxes.reduce((s, b) => s + (b.x1 - b.x0) * (b.y1 - b.y0), 0) / ((union.x1 - union.x0) * (union.y1 - union.y0));
  await shot(page, 'after-f15-realm-overview-v2', `Explicit Realm overview with presentation-only environment packing (gap <= ${REALM_ENVIRONMENT_GAP} m); stored layout and digest unchanged.`);
  report.push({ case: 'F15 realm overview packing', zoom: p.zoom, fill_w: +fillW.toFixed(3), fill_h: +fillH.toFixed(3), env_gaps_of_stage_width: gaps.map(g => +g.toFixed(3)), env_box_area_over_union: +occupied.toFixed(3), result: 'passed' });
});

test('next-C: a single-environment world shows no framing control and keeps the full fit', async ({ page }) => {
  await page.goto(h.offlineUrl + '/?fixture=F01#workspace=kingdom&view=castle');
  await expect(page.locator('.castle-wrap')).toHaveAttribute('data-framing', 'all');
  await expect(page.getByTestId('world-framing')).toHaveCount(0);
  report.push({ case: 'F01 single environment', framing: 'all', result: 'passed' });
});

test('next-C: repeated low-priority stale checks collapse to one counted row; expand shows all; case question + next obligation in the first viewport', async ({ browser }) => {
  const P = '/api/projects/demo-castle';
  const { context, page } = await loginRedesign(browser, h);
  try {
    const q = (await h.api('GET', `${P}/attention`)).json as { items: { id: string; kind: string; urgency: string; new_since_acknowledged: number | null }[] };
    const lowStale = q.items.filter((i) => i.kind === 'stale_check' && i.urgency === 'low' && !i.new_since_acknowledged);
    const significant = q.items.filter((i) => i.urgency !== 'low' || ['observer_gap', 'contradiction', 'incomplete_repair'].includes(i.kind));
    expect(lowStale.length, JSON.stringify(q.items.map((i) => [i.kind, i.urgency]))).toBeGreaterThanOrEqual(2);
    await page.getByRole('button', { name: 'Investigate', exact: true }).click();
    await page.getByRole('tab', { name: 'Cases', exact: true }).click();
    const panel = page.getByTestId('attention-queue');
    const group = panel.getByTestId('attention-group').and(panel.locator('[data-group-kind="stale_check"]'));
    await expect(group).toHaveCount(1);
    await expect(group).toHaveAttribute('data-count', String(lowStale.length));
    await expect(group).toContainText(`${lowStale.length} stale checks`);
    // collapsed: stale checks are not individual cards; significant items each keep their own card
    await expect(panel.locator('li[data-kind="stale_check"][data-urgency="low"]')).toHaveCount(0);
    await expect(panel.locator('li[data-kind]:not([data-urgency="low"])')).toHaveCount(significant.filter((i) => i.urgency !== 'low').length);
    await shot(page, 'after-cases-attention-compact-no-case', 'Cases with no case open: repeated low-priority stale checks compacted into one counted row.');
    // expand: every stale check is shown as an ordinary card, acknowledge controls intact
    await group.getByRole('button', { name: `Show all ${lowStale.length}` }).click();
    await expect(group.getByRole('button', { name: 'Collapse' })).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.locator('li[data-kind="stale_check"][data-urgency="low"]')).toHaveCount(lowStale.length);
    await expect(group.getByRole('button', { name: /^Acknowledge Stale check/ })).toHaveCount(lowStale.length);
    await group.getByRole('button', { name: 'Collapse' }).click();
    // a case: its question and the next evidence obligation sit in the first viewport
    const question = 'Did the blocked request still reach the database?';
    const c = await h.api('POST', `${P}/cases`, { title: 'next-C focus case', scope: { question, asset_ids: ['db'] }, closure_criteria: 'Every obligation resolved or documented' });
    expect(c.status, JSON.stringify(c.json)).toBe(200);
    await page.reload(); await expect(page.locator('.app')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Investigate', exact: true }).click();
    await page.getByRole('tab', { name: 'Cases', exact: true }).click();
    await page.getByLabel('Case list').getByRole('button', { name: 'next-C focus case' }).click();
    const focus = page.getByTestId('case-focus');
    await expect(focus.getByTestId('case-focus-question')).toContainText(question);
    await expect(focus.getByTestId('case-focus-next')).toContainText(/Next evidence obligation|Next meaningful action/);
    await expect(focus.getByTestId('case-focus-next')).not.toContainText('Loading');
    const vh = page.viewportSize()!.height;
    for (const id of ['case-focus-question', 'case-focus-next']) {
      const box = (await focus.getByTestId(id).boundingBox())!;
      expect(box.y + box.height, `${id} must be inside the first ${vh}px viewport`).toBeLessThanOrEqual(vh);
    }
    const qBox = (await focus.getByTestId('case-focus-question').boundingBox())!, aBox = (await panel.boundingBox())!;
    expect(qBox.y).toBeLessThan(aBox.y);
    await shot(page, 'after-cases-case-focus', 'Case open: question and next evidence obligation first; attention compacted below.');
    report.push({ case: 'attention compaction + case focus', low_stale: lowStale.length, significant: significant.length, question_bottom: qBox.y + qBox.height, result: 'passed' });
  } finally { await context.close(); }
});
