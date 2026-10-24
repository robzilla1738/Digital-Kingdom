/** LP18: evidence-linked interiors in the inspector (API-backed isolated synthetic server, SwiftShader; no GPU claim). */
import { test, expect } from '@playwright/test';
import { captureRedesign, createRedesignHarness, loginRedesign, writeRedesignEvidence, type RedesignHarness } from './redesign-harness.ts';

let h: RedesignHarness;
const report: Record<string, unknown>[] = [];
test.beforeAll(async () => { h = await createRedesignHarness(); });
test.afterAll(async () => { writeRedesignEvidence('lp18-interior-verification.json', { scope: 'API-backed isolated synthetic server (demo-castle), Chromium headless SwiftShader.', cases: report }); await h?.close(); });

test('LP18-A1/A2/A4: interior rows equal the API interior, open the exact record, and survive 3D/2D switching and a narrow screen', async ({ browser }) => {
  const api = (await h.api('GET', '/api/projects/demo-castle/assets/api/interior')).json;
  expect(api.schema).toBe('dk.asset_interior.v1');
  const { context, page } = await loginRedesign(browser, h);
  try {
    await page.evaluate(() => { location.hash = 'workspace=kingdom&view=castle&sel=asset:api'; });
    const evidence = page.locator('aside.evidence');
    await expect(evidence).toHaveAttribute('data-selection-id', 'api');
    const section = page.getByTestId('evidence-interior');
    await expect(section).toBeVisible();
    await expect(section).toHaveAttribute('data-schema', 'dk.asset_interior.v1');
    const rows = section.locator('[data-interior-object]');
    const uiIds = await rows.evaluateAll(es => es.map(e => e.getAttribute('data-interior-object')));
    const apiIds = api.objects.map((o: { object_id: string }) => o.object_id);
    // The browser builds with the same function from the records it loaded; the server additionally holds the
    // controls registry and grants snapshot, so every non-control/grant API object must be present in the UI.
    expect(uiIds.length).toBeGreaterThan(2);
    for (const id of apiIds.filter((x: string) => !/^(control|grant|credential):/.test(x))) expect(uiIds, id).toContain(id);
    for (const id of uiIds) expect(apiIds, id!).toContain(id);
    // A2: transit only on observed records, and every row carries text status (not colour only)
    for (const r of await rows.all()) {
      const basis = await r.getAttribute('data-basis'), transit = await r.getAttribute('data-transit');
      if (transit === 'true') expect(basis).toBe('observed');
      await expect(r.locator('p.small').first()).not.toBeEmpty();
    }
    await expect(section.getByTestId('interior-unavailable').first()).toContainText('unknown, not absent');
    await section.scrollIntoViewIfNeeded();
    await captureRedesign(page, 'lp18-interior-inspector');
    // A1: open the exact relationship record
    const relRow = rows.filter({ has: page.locator('button', { hasText: 'Open record' }) }).and(section.locator('[data-record^="relationship:"]')).first();
    const record = (await relRow.getAttribute('data-record'))!.split(':').slice(1).join(':');
    await relRow.getByRole('button', { name: /Open relationship record/ }).click();
    await expect(evidence).toHaveAttribute('data-selection-id', record);
    await captureRedesign(page, 'lp18-interior-opened-relationship-record');
    // A4: the same selected id survives the 2D view and back
    await page.getByRole('radio', { name: '2D graph', exact: true }).click();
    await expect(evidence).toHaveAttribute('data-selection-id', record);
    await page.getByRole('radio', { name: '3D castle', exact: true }).click();
    await expect(evidence).toHaveAttribute('data-selection-id', record);
    // narrow screen: the inspector keeps the asset interior and the exact record
    await page.setViewportSize({ width: 420, height: 860 });
    await page.evaluate(() => { location.hash = 'workspace=kingdom&view=castle&sel=asset:api'; });
    await expect(page.getByTestId('evidence-interior')).toBeVisible();
    await page.getByTestId('evidence-interior').scrollIntoViewIfNeeded();
    await captureRedesign(page, 'lp18-interior-narrow');
    report.push({ case: 'interior inspector', asset: 'api', uiObjects: uiIds, apiObjects: apiIds, openedRecord: record, survives2D3D: true, narrow: true, result: 'passed' });
  } finally { await context.close(); }
});
