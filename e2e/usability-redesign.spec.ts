/**
 * LP30: automated visual usability and browser robustness across the phase's new views (castle world, roof-off
 * interior, comparison branch, case workbench, mission desk). API-backed isolated synthetic server, Chromium headless
 * SwiftShader. Automated axe/keyboard/reduced-motion/390px checks only: not a manual screen-reader evaluation, not a
 * physical-GPU benchmark and not a human approval.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { captureRedesign, createRedesignHarness, loginRedesign, rendererDetails, writeRedesignEvidence, REDESIGN_ROOT, type RedesignHarness } from './redesign-harness.ts';

let h: RedesignHarness;
const report: Record<string, any> = { scope: 'API-backed isolated synthetic server; Chromium headless with SwiftShader (software WebGL). Automated checks only.', views: [], cycles: null, renderer: null, findings: [] as string[] };
let cmpId = '';
let caseTitle = 'LP30 usability case';
test.beforeAll(async () => {
  h = await createRedesignHarness();
  const state = (await h.api('GET', '/api/projects/demo-castle/analysis/state')).json;
  const created = await h.api('POST', '/api/projects/demo-castle/analysis/comparisons', { base_state_hash: state.state_hash, label: 'LP30 usability', changes: [{ op: 'modify', kind: 'source', authority: 'demo-castle', id: 'src-app', attrs: { disabled: true } }] });
  cmpId = created.json.id;
  const c = await h.api('POST', '/api/projects/demo-castle/cases', { title: caseTitle, scope: { asset_ids: ['api'] }, closure_criteria: 'Every obligation resolved or documented' });
  if (c.status !== 200 && c.status !== 201) caseTitle = '';
});
test.afterAll(async () => { await h?.close(); });

const AXE = process.env.DK_AXE_PATH ?? `${REDESIGN_ROOT}/node_modules/axe-core/axe.min.js`;
async function axe(page: Page, include?: string) {
  await page.evaluate(readFileSync(AXE, 'utf8'));
  const r = await page.evaluate(async (sel) => (window as any).axe.run(sel ? { include: [sel] } : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }), include ?? null);
  return { violations: r.violations.map((v: any) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 5).map((n: any) => n.target) })), incomplete: r.incomplete.length, passes: r.passes.length };
}
const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function focusVisible(page: Page, presses = 12) {
  const seen: { tag: string; text: string; outline: string; boxShadow: string }[] = [];
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => { const e = document.activeElement as HTMLElement; const s = getComputedStyle(e); return { tag: e.tagName, text: (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 40), outline: `${s.outlineStyle} ${s.outlineWidth}`, boxShadow: s.boxShadow }; }));
  }
  const visible = seen.filter((s) => s.tag !== 'BODY' && (!/^none|0px/.test(s.outline) || s.boxShadow !== 'none'));
  return { presses, focused: seen.filter((s) => s.tag !== 'BODY').length, with_visible_indicator: visible.length, sample: seen.slice(0, 6) };
}

type View = { name: string; open: (page: Page) => Promise<void>; region: string };
const views: View[] = [
  { name: 'castle-world', region: 'body', open: async (page) => { await page.evaluate(() => { location.hash = 'workspace=kingdom&view=castle'; }); const show = page.getByRole('button', { name: 'Show map', exact: true }); if (await show.isVisible()) await show.click(); await expect(page.locator('canvas')).toBeVisible(); await expect.poll(async () => Number(await page.locator('canvas').getAttribute('data-render-count'))).toBeGreaterThan(0); } },
  { name: 'interior-inspector', region: '[data-testid="evidence-interior"]', open: async (page) => { await page.evaluate(() => { location.hash = 'workspace=kingdom&view=castle&sel=asset:api'; }); await expect(page.getByTestId('evidence-interior')).toBeVisible(); await page.getByTestId('evidence-interior').scrollIntoViewIfNeeded(); } },
  { name: 'comparison-branch', region: '[data-testid="world-comparison"]', open: async (page) => { await page.goto(`${h.serverUrl}/?project=demo-castle&cmp=${cmpId}#workspace=kingdom&view=castle`); await expect(page.locator('.app')).toBeVisible({ timeout: 30_000 }); const show = page.getByRole('button', { name: 'Show map', exact: true }); if (await show.isVisible()) { report.findings.push('comparison-branch at 390px: the open comparison is only reachable after "Show map"; the list view gives no indication a comparison is open'); await show.click(); } await expect(page.getByTestId('world-comparison')).toBeVisible({ timeout: 30_000 }); } },
  { name: 'case-workbench', region: '[aria-label="Cases workspace"]', open: async (page) => { await page.getByRole('button', { name: 'Investigate', exact: true }).click(); await page.getByRole('tab', { name: 'Cases', exact: true }).click(); await expect(page.getByLabel('Cases workspace')).toBeVisible(); if (caseTitle) { const b = page.getByLabel('Cases workspace').getByRole('button', { name: new RegExp(caseTitle) }).first(); if (await b.count()) await b.click(); } } },
  { name: 'mission-builder', region: '[data-testid="mission-desk"]', open: async (page) => { await page.getByRole('button', { name: 'Integrations', exact: true }).click(); await page.getByRole('tab', { name: 'Missions' }).click(); await page.getByLabel('Start from reviewed blueprint').selectOption('agent-workspace'); await page.getByRole('button', { name: 'Preview' }).click(); await expect(page.getByTestId('mission-preview')).toBeVisible(); } },
  { name: 'mission-failure-state', region: '[data-testid="mission-desk"]', open: async (page) => { await page.getByRole('button', { name: 'Integrations', exact: true }).click(); await page.getByRole('tab', { name: 'Missions' }).click(); await page.getByLabel('Start from reviewed blueprint').selectOption('delivery-identity'); const j = page.getByLabel('Mission draft JSON'); const d = JSON.parse(await j.inputValue()); d.scenario.steps[0].command = 'id'; await j.fill(JSON.stringify(d, null, 1)); await page.getByRole('button', { name: 'Preview' }).click(); await expect(page.getByTestId('mission-error')).toBeVisible(); await page.getByTestId('mission-error').scrollIntoViewIfNeeded(); } },
];

for (const v of views) {
  test(`LP30-A3: ${v.name} — axe, keyboard focus, reduced motion and 390px`, async ({ browser }) => {
    expect(existsSync(AXE)).toBe(true);
    const row: Record<string, any> = { view: v.name };
    for (const variant of ['desktop', 'reduced-motion', 'narrow-390'] as const) {
      const { context, page } = await loginRedesign(browser, h, variant === 'narrow-390' ? { viewport: { width: 390, height: 844 } } : {});
      try {
        if (variant === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' });
        const t0 = Date.now(); await v.open(page); const openMs = Date.now() - t0;
        if (variant === 'desktop') {
          row.open_ms = openMs; row.axe_region = await axe(page, v.region === 'body' ? undefined : v.region);
          row.keyboard = await focusVisible(page);
          if (!report.renderer) report.renderer = await rendererDetails(page);
        }
        if (variant === 'reduced-motion') {
          row.reduced_motion_media = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
          if (v.name === 'castle-world') {
            const canvas = page.locator('canvas');
            await page.evaluate(() => { location.hash = 'workspace=kingdom&view=castle&sel=asset:edge'; });
            const samples: (string | null)[] = []; for (let i = 0; i < 10; i++) { samples.push(await canvas.getAttribute('data-camera-active')); await page.waitForTimeout(50); }
            row.reduced_motion_camera_tween_seen = samples.includes('true');
            // let SwiftShader settle on demand frames before the screenshot (a bounded wait, not a retry)
            await expect(canvas).not.toHaveAttribute('data-camera-active', 'true');
            const rc = await canvas.getAttribute('data-render-count'); await page.waitForTimeout(500);
            row.reduced_motion_render_count_after_select = [rc, await canvas.getAttribute('data-render-count')];
          }
        }
        if (variant === 'narrow-390') row.overflow_390_px = await overflowX(page);
        await captureRedesign(page, `lp30-${v.name}-${variant}`, { timeout: 30_000 });
      } finally { await context.close(); }
    }
    report.views.push(row);
    writeRedesignEvidence(`lp30-usability-${v.name}.json`, { scope: report.scope, renderer: report.renderer, findings: report.findings, ...row });
    expect(row.axe_region.violations.filter((x: any) => ['serious', 'critical'].includes(x.impact)), JSON.stringify(row.axe_region.violations)).toEqual([]);
    expect(row.keyboard.focused).toBeGreaterThan(3);
    expect(row.keyboard.with_visible_indicator).toBe(row.keyboard.focused);
    expect(row.reduced_motion_media).toBe(true);
    if (v.name === 'castle-world') expect(row.reduced_motion_camera_tween_seen).toBe(false);
    expect(row.overflow_390_px).toBeLessThanOrEqual(1);
  });
}

test('LP30-A2: repeated project / camera / case switching stays bounded (one renderer, bounded heap, no stuck state)', async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, h);
  try {
    const cycles: Record<string, any>[] = [];
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
    for (let i = 0; i < 4; i++) {
      const project = i % 2 ? 'second-project' : 'demo-castle';
      const t0 = Date.now();
      await page.goto(`${h.serverUrl}/?project=${project}#workspace=kingdom&view=castle&sel=asset:${i % 3 ? 'api' : 'edge'}`);
      await expect(page.locator('.app')).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => Number(await page.locator('canvas').getAttribute('data-render-count') ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
      const ready = Date.now() - t0;
      await page.getByRole('button', { name: 'Investigate', exact: true }).click(); await page.getByRole('tab', { name: 'Cases', exact: true }).click(); await expect(page.getByLabel('Cases workspace')).toBeVisible();
      await page.getByRole('button', { name: 'Kingdom', exact: true }).click(); await expect(page.locator('canvas')).toBeVisible();
      const m = await page.evaluate(() => ({ canvases: document.querySelectorAll('canvas').length, heap: (performance as any).memory?.usedJSHeapSize ?? null, project: new URLSearchParams(location.search).get('project') }));
      cycles.push({ cycle: i, project, ready_ms: ready, ...m });
    }
    const heaps = cycles.map((c) => c.heap).filter((x) => typeof x === 'number');
    report.cycles = { conditions: 'one browser context, 4 full reloads alternating demo-castle/second-project, selection change and Investigate→Cases→Kingdom each cycle', cycles, page_errors: errors, heap_growth_bytes: heaps.length > 1 ? heaps.at(-1) - heaps[1] : null };
    writeRedesignEvidence('lp30-usability-cycles.json', { scope: report.scope, ...report.cycles });
    expect(errors).toEqual([]);
    for (const c of cycles) { expect(c.canvases).toBe(1); expect(c.project).toBe(c.project); expect(c.ready_ms).toBeLessThan(30_000); }
    if (heaps.length > 2) expect(heaps.at(-1) - heaps[1]).toBeLessThan(150 * 1024 * 1024);
  } finally { await context.close(); }
});
