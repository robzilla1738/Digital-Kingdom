import { test, expect } from '@playwright/test';
import { captureRedesign, createRedesignHarness, writeRedesignEvidence, type RedesignHarness } from './redesign-harness.ts';

let harness: RedesignHarness;
const reports: unknown[] = [];
test.beforeAll(async () => { harness = await createRedesignHarness(); });
test.afterAll(async () => { writeRedesignEvidence('grouped-focus-verification.json', reports); await harness?.close(); });

for (const { view, width } of [{ view: 'graph', width: 1440 }, { view: 'castle', width: 1440 }, { view: 'graph', width: 320 }] as const) {
  for (const selection of [
    { kind: 'finding', id: 'f-1ogfivz17xdjzf', assets: ['blob', 'edge'] },
    { kind: 'path', id: 'rel-edge-web', assets: ['edge', 'web'] },
  ]) {
    test(`F13 ${view} ${width}px: explicit ${selection.kind} focus retains every cross-district endpoint`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${harness.offlineUrl}/?fixture=F13#workspace=kingdom&view=${view}&sel=${selection.kind}:${selection.id}`);
      await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', selection.id);
      if (view === 'castle') await expect.poll(async () => Number(await page.locator('canvas').getAttribute('data-render-count'))).toBeGreaterThan(0);

      if (width < 600 && selection.kind === 'path') {
        await page.getByRole('button', { name: 'Coverage', exact: true }).click();
        await page.getByRole('button', { name: 'Kingdom', exact: true }).click();
        await page.getByRole('radio', { name: '2D graph', exact: true }).click();
      }
      // Normal pointer click is deliberate: Html wrappers must not cover the real Focus control.
      await page.getByRole('button', { name: selection.kind === 'finding' ? 'Focus affected assets' : 'Focus selection', exact: true }).click();
      const panel = page.locator(view === 'castle' ? '.scene-group-panel' : '.graph-group-panel');
      await expect(panel).toContainText('Combined focus');
      const selector = view === 'castle' ? '[data-asset-label]' : '.graph2d [data-node][data-asset-id]';
      for (const id of selection.assets) {
        await expect(page.locator(view === 'castle' ? `[data-asset-label="${id}"]` : `.graph2d [data-node][data-asset-id="${id}"]`)).toBeVisible();
      }
      if (view === 'castle') await expect(page.locator('canvas')).toHaveAttribute('data-camera-active', 'false');
      const renderedIds = await page.locator(selector).evaluateAll(elements => elements.map(element => element.getAttribute('data-asset-label') ?? element.getAttribute('data-asset-id')));
      expect(renderedIds).toEqual(expect.arrayContaining(selection.assets));
      expect(renderedIds.length).toBeLessThanOrEqual(50);
      let roundtrip: { drawnIds: (string | null)[]; viewBox: number[]; names: string[]; membersExpanded: string | null; controlsExpanded: string | null } | null = null;
      if (width < 600) {
        const context = async () => ({
          drawnIds: await page.locator(selector).evaluateAll(elements => elements.map(element => element.getAttribute('data-asset-id'))),
          viewBox: (await page.locator('svg.graph2d').getAttribute('viewBox'))!.split(' ').map(value => Number(Number(value).toFixed(6))),
          names: await page.locator(`${selector} .node-name`).allTextContents(),
          membersExpanded: await page.getByRole('button', { name: 'Members', exact: true }).getAttribute('aria-expanded'),
          controlsExpanded: await page.getByRole('button', { name: 'Graph controls', exact: true }).getAttribute('aria-expanded'),
        });
        // Opposite-to-default disclosure states prove that the whole presentation context is cached.
        await page.getByRole('button', { name: 'Graph controls', exact: true }).click();
        roundtrip = await context();
        expect(roundtrip.membersExpanded).toBe('false');
        expect(roundtrip.controlsExpanded).toBe('true');
        await page.getByRole('radio', { name: '3D castle', exact: true }).click();
        await expect.poll(async () => Number(await page.locator('canvas').getAttribute('data-render-count'))).toBeGreaterThan(0);
        await page.getByRole('radio', { name: '2D graph', exact: true }).click();
        await expect.poll(context).toEqual(roundtrip);
        await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', selection.id);
        await page.getByRole('button', { name: 'Graph controls', exact: true }).click();
      }
      const selectedBounds = await page.locator(selector).evaluateAll((elements, selected) => elements
        .filter(element => selected.includes(element.getAttribute('data-asset-label') ?? element.getAttribute('data-asset-id') ?? ''))
        .map(element => {
          const stageElement = element.closest('.stage')!, bounds = element.getBoundingClientRect(), stage = stageElement.getBoundingClientRect();
          const name = element.querySelector('.node-name,.name')!, readable = name.getBoundingClientRect();
          const occluders = [...stageElement.querySelectorAll('.graph-group-panel,.scene-group-panel,.stage-tools,.legend,.banner,.stage-title')]
            .filter(overlay => overlay.getClientRects().length > 0).filter(overlay => { const rect = overlay.getBoundingClientRect(); return bounds.left < rect.right && bounds.right > rect.left && bounds.top < rect.bottom && bounds.bottom > rect.top; }).map(overlay => overlay.className);
          const nameHitTests = [0.15, 0.5, 0.85].map(fraction => { const hit = document.elementFromPoint(readable.left + readable.width * fraction, readable.top + readable.height / 2); return !!hit && (hit === element || element.contains(hit)); });
          return { id: element.getAttribute('data-asset-label') ?? element.getAttribute('data-asset-id'), fullyInsideStage: bounds.left >= stage.left && bounds.right <= stage.right && bounds.top >= stage.top && bounds.bottom <= stage.bottom, occluders, nameHitTests, renderedNameHeight: readable.height };
        }), selection.assets);
      for (const bounds of selectedBounds) { expect(bounds.fullyInsideStage).toBe(true); expect(bounds.occluders).toEqual([]); expect(bounds.nameHitTests).toEqual([true, true, true]); }
      const members = await panel.locator('li').count();
      await captureRedesign(page, `grouped-focus-${view}-${selection.kind}${width < 600 ? `-${width}` : ""}`);
      for (const id of selection.assets) {
        const target = page.locator(view === 'castle' ? `[data-asset-label="${id}"] .name` : `.graph2d [data-node][data-asset-id="${id}"] .node-name`);
        await expect(target).toBeVisible();
        await target.click();
        await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', id);
        if (width < 600) await page.getByRole('button', { name: 'Close evidence pane', exact: true }).click();
        await expect(panel.locator('li')).toHaveCount(members);
      }
      if (width < 600) {
        await expect(page.getByRole('button', { name: 'Members', exact: true })).toHaveAttribute('aria-expanded', 'false');
        await page.getByRole('button', { name: 'Members', exact: true }).click();
        await expect(panel.locator('li').first()).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      expect(errors).toEqual([]);
      reports.push({ view, width, selection, renderedIds, selectedBounds, roundtrip, fullMembershipCount: members, normalPointerFocus: true, everySelectedNameReceivesNormalPointerSelection: true, errors, result: 'passed' });
    });
  }
}
