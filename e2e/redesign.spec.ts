import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { createRedesignHarness, loginRedesign, captureRedesign, rendererDetails, writeRedesignEvidence, REDESIGN_ROOT, type RedesignHarness } from './redesign-harness.ts';
import { processDeliveries } from '../packages/detections/src/index.ts';
import { relationshipMeaning } from '../apps/web/src/lib/layers.ts';

let h: RedesignHarness;
const reports: any[] = [];
test.beforeAll(async () => { h = await createRedesignHarness(); });
test.afterAll(async () => { writeRedesignEvidence('visual-verification.json', reports); await h?.close(); });
async function offline(page: Page, query = '?fixture=F01') {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(h.offlineUrl + '/' + query); await expect(page.locator('.app')).toBeVisible({ timeout: 40_000 });
  reports.push({ path: query, pageErrors: errors, mode: 'explicit offline synthetic fixture' });
}
async function rendered(page: Page) {
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => Number(await page.locator('canvas').getAttribute('data-render-count')), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(650);
}
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name, exact: true });
async function noDocumentOverflow(page: Page) {
  const measurement = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth }));
  expect(measurement.scrollWidth).toBeLessThanOrEqual(measurement.width + 1); reports.push({ overflow: measurement });
}

test('V01–V04: reference overview, stable selection across views, expanded contradiction', async ({ page, browser }) => {
  await offline(page); await rendered(page);
  await expect(page.locator('aside.evidence')).toBeHidden();
  await captureRedesign(page, 'V01-kingdom-overview-1440');
  reports.push({ renderer: await rendererDetails(page), browser: browser.version(), noRealGpuClaim: true });
  const first = page.locator('.sidebar [data-finding-id]').first(); const id = await first.getAttribute('data-finding-id');
  await first.click(); await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', id!);
  await captureRedesign(page, 'V02-kingdom-selected-1440');
  await page.getByRole('radio', { name: '2D graph', exact: true }).click();
  await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', id!);
  await expect(page.locator('svg.graph2d')).toBeVisible();
  await captureRedesign(page, 'V03-graph-same-selection-1440');
  await nav(page, 'Investigate').click();
  const contradiction = page.locator('.findings-workspace [data-finding-kind="control_contradiction"]');
  const available = await contradiction.count();
  if (!available) await page.locator('.findings-workspace [data-finding-id]').filter({ hasText: 'Sources disagree' }).first().click(); else await contradiction.first().click();
  await expect(page.locator('aside.evidence [data-evidence-role="supporting"]')).not.toHaveCount(0);
  await expect(page.locator('aside.evidence [data-evidence-role="counter"]')).not.toHaveCount(0);
  const selectedFinding = await page.locator('aside.evidence').getAttribute('data-selection-id');
  await page.getByRole('button', { name: 'Expand investigation', exact: true }).click();
  const expanded = page.locator('aside.evidence.expanded-evidence[data-expanded="true"]');
  await expect(expanded).toHaveAttribute('data-selection-id', selectedFinding!);
  await expect(page.getByRole('navigation', { name: 'Filtered finding queue' })).toBeVisible();
  await expect(page.getByTestId('finding-queue-position')).toContainText('matching findings');
  await expect(page.locator('aside.evidence')).toHaveCount(1);
  await expect(page.locator('.workspace-content.expanded-finding > .workspace-results')).toBeHidden();
  const contentBounds = await page.locator('.workspace-content').boundingBox(), detailBounds = await expanded.boundingBox();
  // Primary-content presentation, not merely renaming the former 384–520 px inspector.
  expect(detailBounds!.width).toBeGreaterThan(800);
  expect(detailBounds!.width / contentBounds!.width).toBeGreaterThan(0.7);
  await captureRedesign(page, 'V04a-expanded-contradiction-claim');
  const fixtureSources = JSON.parse(readFileSync(`${REDESIGN_ROOT}/fixtures/demo/sources.json`, 'utf8'));
  const fixture = { sources: fixtureSources, ...processDeliveries(JSON.parse(readFileSync(`${REDESIGN_ROOT}/fixtures/demo/graph.json`, 'utf8')), fixtureSources, JSON.parse(readFileSync(`${REDESIGN_ROOT}/fixtures/demo/deliveries.json`, 'utf8'))) }, cards = [];
  for (const role of ['supporting', 'counter']) {
    const card = expanded.locator(`article[data-evidence-role="${role}"]`).first();
    const eventId = await card.getAttribute('data-event-id'), event = fixture.events.find(record => record.id === eventId)!;
    expect(event, 'Card must identify an actual canonical fixture event').toBeTruthy();
    const source = fixture.sources.find(source => source.id === event.source_id)!;
    await expect(card.getByTestId('evidence-card-source')).toContainText(source.label);
    await expect(card.getByTestId('evidence-card-source')).toContainText(event.source_id);
    await expect(card).toContainText(event.action);
    await expect(card.getByTestId('evidence-card-occurred').locator('time')).toHaveAttribute('datetime', event.occurred_at);
    await expect(card.getByTestId('evidence-card-received').locator('time')).toHaveAttribute('datetime', event.received_at);
    await expect(card.getByTestId('evidence-card-relationship')).toContainText(selectedFinding!);
    await expect(card.getByTestId('evidence-card-redaction')).toContainText(/redact/i);
    const fields = [];
    for (const field of ['source','action','outcome','occurred','received','redaction','relationship','reference']) {
      const element = card.getByTestId(`evidence-card-${field}`);
      await expect(element).toBeVisible();
      fields.push(await element.evaluate((element, field) => {
        const bounds = element.getBoundingClientRect(), walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), textRects = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim() || node.parentElement?.closest('svg,[aria-hidden="true"]')) continue;
          const range = document.createRange(); range.selectNodeContents(node); textRects.push(...Array.from(range.getClientRects()));
        }
        return { field, fontSize: parseFloat(getComputedStyle(element).fontSize), text: element.textContent, width: bounds.width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
          clippedText: textRects.filter(rect => rect.left < bounds.left - 2 || rect.right > bounds.right + 2 || rect.top < bounds.top - 2 || rect.bottom > bounds.bottom + 2).map(rect => rect.toJSON()) };
      }, field));
    }
    for (const field of fields) { if (field.field !== 'reference') expect(field.fontSize, `${role} ${field.field} operational value must be at least 13 CSS px`).toBeGreaterThanOrEqual(13); expect(field.clippedText, `${role} ${field.field} must wrap without clipping`).toEqual([]); expect(field.scrollWidth).toBeLessThanOrEqual(field.clientWidth + 1); }
    cards.push({ role, eventId, fields });
  }
  const supporting = expanded.locator('article[data-evidence-role="supporting"]').first(), counter = expanded.locator('article[data-evidence-role="counter"]').first();
  await supporting.scrollIntoViewIfNeeded();
  await expect(supporting).toBeInViewport({ ratio: 0.95 }); await expect(counter).toBeInViewport({ ratio: 0.95 });
  await captureRedesign(page, 'V04b-contradiction-supporting-counter');
  await expect(supporting.getByTestId('evidence-card-payload')).toHaveCount(0);
  await supporting.getByTestId('evidence-card-raw').locator('summary').click();
  await expect(supporting.getByTestId('evidence-card-payload')).toContainText(cards[0].eventId!);
  await expect(supporting.getByTestId('evidence-card-raw')).toContainText('Recorded text — untrusted.');
  await expect(expanded).toHaveAttribute('data-selection-id', selectedFinding!);
  await supporting.getByTestId('evidence-card-payload').scrollIntoViewIfNeeded();
  await captureRedesign(page, 'V04c-in-context-raw-evidence');
  writeRedesignEvidence('expanded-finding-card-readability.json', { contentBounds, detailBounds, selectedFinding, cards, rawExpansionRetainsFinding: true, bothEvidenceKindsVisibleTogether: true });
});

test('V07–V08: partial source administration stays separate from findings and map hatching', async ({ page }) => {
  await offline(page, '?fixture=F04'); await nav(page, 'Coverage').click();
  await expect(page.locator('[data-source-id="redesign-disabled-source"]')).toContainText('Administratively disabled');
  await captureRedesign(page, 'V07a-coverage-sources');
  await page.getByRole('tab', { name: 'Assets with gaps', exact: true }).click();
  await expect(page.locator('tr[data-coverage="partial"]')).not.toHaveCount(0);
  await expect(page.locator('tr[data-coverage="unobserved"]')).not.toHaveCount(0);
  await captureRedesign(page, 'V07b-partial-unobserved-assets');
  const selected = page.locator('tr[data-coverage="partial"]').first(); const id = await selected.getAttribute('data-asset-id');
  await selected.getByRole('button').first().click(); await nav(page, 'Kingdom').click(); await rendered(page);
  await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', id!);
  await expect(page.getByTestId('asset-coverage-state')).toContainText('Partial visibility');
  await captureRedesign(page, 'V08-3d-partial-coverage-selection');
});

test('V05–V06: deliberate event search and unlinked successful operation are inspectable', async ({ page }) => {
  await offline(page, '?fixture=F06#workspace=investigate&tab=events');
  await page.getByRole('button', { name: 'Search events', exact: true }).click();
  await expect(page.getByTestId('event-query-completeness')).toBeVisible();
  await expect(page.getByTestId('event-source-coverage')).toBeVisible();
  await captureRedesign(page, 'V05-event-search-separate-completeness');
  await page.locator('[data-event-result-id="redesign-unlinked-data-access"]').getByRole('button').first().click();
  await expect(page.getByTestId('event-unlinked')).toBeVisible();
  await expect(page.locator('aside.evidence')).toContainText(/success/i);
  await captureRedesign(page, 'V06-unlinked-event');
});

test('V11: replay uses explicit known-time basis and keeps source-coverage limitations', async ({ page }) => {
  await offline(page, '?fixture=F01#workspace=kingdom&view=graph&sel=event:ev-eluj891y8g8b9&t=2026-10-20T14%3A03%3A00.000Z&basis=known');
  await page.getByText('Time settings', {exact:true}).click();
  await expect(page.getByRole('radio', { name: 'Known at the time', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('timeline-mode')).toHaveAttribute('data-mode', 'historical');
  await expect(page.locator('.tl-details')).toContainText('Historical topology is unavailable');
  await expect(page.locator('.tl-details')).toContainText('historical visibility is not assessed');
  await captureRedesign(page, 'V11a-known-time-replay-scope');
  await page.getByRole('button',{name:'Close time settings',exact:true}).click();
  await expect(page.locator('.tl-details')).toHaveJSProperty('open',false);const persistentScope=page.locator('.timeline > .replay-scope');const expectedRevision=JSON.parse(readFileSync(`${REDESIGN_ROOT}/fixtures/demo/graph.json`,'utf8')).graph_revision;await expect(persistentScope).toBeVisible();await expect(persistentScope).toContainText(`Replay uses graph revision ${expectedRevision}.`);await expect(persistentScope).toContainText('Historical topology and source administration are unavailable');await expect(persistentScope).toContainText('Coverage is current as of');await expect(persistentScope).toContainText('notes and disposition are current annotations');writeRedesignEvidence('replay-visible-scope.json',{expectedRevision,detailsOpen:false,visibleText:await persistentScope.innerText()});
  await expect(page.locator('aside.evidence')).toContainText('Outside the selected replay interval');
  await expect(page.locator('aside.evidence')).toContainText('Late record; occurrence and receipt times differ');
  await captureRedesign(page, 'V11b-late-record-known-time');
  await page.getByRole('button',{name:'Expand timeline',exact:true}).click();await expect(page.locator('[data-timeline-lane]')).toHaveCount(3);
  for(const id of ['findings','events','coverage']){await expect(page.locator(`[data-timeline-lane="${id}"]`)).toBeVisible();expect(await page.locator(`[data-timeline-lane="${id}"] .timeline-lane-track i`).count()).toBeLessThanOrEqual(24);}
  await expect(page.locator('.timeline-lanes')).toContainText('not historical coverage intervals');
  const health=page.getByLabel('Inspect health records in interval');const healthId=await health.locator('option').nth(1).getAttribute('value');expect(healthId).toBeTruthy();await health.selectOption(healthId!);await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id',healthId!);
  await captureRedesign(page,'V11c-expanded-exact-record-lanes');
});

test('V09–V10: ten architectural modules and actual roof removal', async ({ page }) => {
  await page.goto(h.offlineUrl + '/?moduleSheet=all');
  await expect(page.getByRole('heading', { name: /ten stable module IDs/ })).toBeVisible();
  await expect.poll(async () => (await page.locator('canvas').screenshot()).length).toBeGreaterThan(25000);
  await page.waitForTimeout(500); await captureRedesign(page, 'V09-ten-module-sheet');
  await page.goto(h.offlineUrl + '/?moduleSheet=near');
  await expect(page.getByRole('heading', { name: /four-module near inspection/ })).toBeVisible();
  await page.waitForTimeout(700); await captureRedesign(page, 'V10a-four-module-near');
  const before = await page.locator('canvas').screenshot();
  await page.getByRole('button', { name: 'Hide roofs', exact: true }).click(); await page.waitForTimeout(700);
  const after = await page.locator('canvas').screenshot(); expect(after.equals(before)).toBe(false);
  await captureRedesign(page, 'V10b-four-module-roofs-off');
  await page.mouse.move(1320,240);await page.mouse.down();await page.mouse.move(1320,400,{steps:8});await page.mouse.up();await page.waitForTimeout(500);await captureRedesign(page,'V10c-roofs-off-elevated-floor-inspection');
});

test('stable ID history, hidden filters, and keyboard manual-activation semantics', async ({ page }) => {
  await page.setViewportSize({width:1700,height:900});
  await offline(page, '?fixture=F01#workspace=kingdom&view=graph');
  const attention = page.getByRole('tab', { name: /^Attention/ }); const assets = page.getByRole('tab', { name: /^Assets 13$/ });
  await attention.focus(); await page.keyboard.press('ArrowRight'); await expect(assets).toBeFocused();
  await expect(attention).toHaveAttribute('aria-selected', 'true'); await page.keyboard.press('Enter');
  await expect(assets).toHaveAttribute('aria-selected', 'true');
  const row = page.locator('.sidebar button[data-asset-id]').first(); const id = await row.getAttribute('data-asset-id');
  await row.focus(); await page.keyboard.press('Enter'); await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', id!);
  await page.getByLabel('Filter assets', { exact: true }).fill('no-such-asset');
  await expect(page.locator('.pinned-selection')).toBeVisible(); await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', id!);
  await nav(page, 'Coverage').click(); await nav(page, 'Investigate').click(); await page.goBack();
  await expect(nav(page, 'Coverage')).toHaveAttribute('aria-current', 'page');
  await page.goForward(); await expect(nav(page, 'Investigate')).toHaveAttribute('aria-current', 'page');
  const url = page.url(); expect(url).not.toMatch(/token|Bearer|no-such-asset/);
  await page.reload(); await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', id!);
  await page.getByRole('button', { name: 'Close evidence pane' }).click(); await expect(page.locator('aside.evidence')).toBeHidden();
  reports.push({ keyboard: 'Tab manual activation, Enter select, history back/forward/reload, hidden selection verified' });
});

test('F11/F14: untrusted text is inert and empty project is not a fabricated kingdom', async ({ page }) => {
  const external:string[]=[];const requests:string[]=[];
  page.on('request',request=>{const u=new URL(request.url());requests.push(`${u.protocol}//${u.host}${u.pathname}`);if(!['data:','blob:'].includes(u.protocol)&&u.origin!==new URL(h.offlineUrl).origin)external.push(request.url());});
  await offline(page, '?fixture=F11#workspace=kingdom&view=graph');
  await page.getByRole('tab', { name: /^Assets 13$/ }).click();
  await page.locator('.sidebar button[data-asset-id]').first().click();
  await expect(page.locator('aside.evidence .ev-title h2')).toContainText('<img src=x onerror=');
  expect(await page.evaluate(() => (window as any).__dkPwned)).toBeUndefined();
  expect(await page.locator('aside.evidence img').count()).toBe(0); await captureRedesign(page, 'F11-untrusted-text');
  for(const workspace of ['Investigate','Coverage','Integrations','Kingdom']){await nav(page,workspace).click();await expect(nav(page,workspace)).toHaveAttribute('aria-current','page');}
  await page.getByRole('radio',{name:'3D castle',exact:true}).click();await rendered(page);
  expect(external).toEqual([]);writeRedesignEvidence('network-allowlist.json',{scope:'Actual page requests through hostile F11 graph/detail, all four workspaces, and rendered WebGL 3D; no external application resource requests.',workspaces:['Kingdom','Investigate','Coverage','Integrations'],realWebGLCanvas:true,external,requests});
  await offline(page, '?fixture=F14'); await expect(page.locator('.side-heading')).toContainText('0 assets');
  await expect(page.locator('.app')).toContainText(/No.*assets|empty|No open findings recorded/i);
  await captureRedesign(page, 'F14-empty-inventory');
});

test('V14: responsive records, close controls, and no document overflow at 320–1366', async ({ page }) => {
  const touchTargets:any[]=[], timelineClocks:any[]=[];
  for (const width of [1366, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 768 });
    await offline(page, '?fixture=F01#workspace=investigate');
    await noDocumentOverflow(page); await captureRedesign(page, `V14-${width}-findings`);
    await page.locator('.findings-workspace [data-finding-id]').first().click();
    await expect(page.locator('aside.evidence')).toBeVisible(); await noDocumentOverflow(page);
    await captureRedesign(page, `V14-${width}-detail`);
    if(width<500){
      for(const target of await page.locator('.primary-nav button, .header-search input, .inspector-slot .tabs button, button[aria-label="Close evidence pane"], .tl-controls .tl-play, .tl-controls .return-live').all()){
        if(!await target.isVisible())continue;const box=await target.boundingBox();if(!box)continue;
        touchTargets.push({viewport:width,name:await target.getAttribute('aria-label')||await target.textContent(),width:box.width,height:box.height});
      }
    }
    await page.getByRole('button', { name: 'Close evidence pane' }).click(); await expect(page.locator('aside.evidence')).toBeHidden();
    if(width<1024){const opener=page.locator('.findings-workspace [data-finding-id]').first();await expect(opener).toBeFocused();await opener.click();await expect(page.locator('aside.evidence')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('aside.evidence')).toBeHidden();await expect(opener).toBeFocused();}
    if (width < 500) for (const historical of [false, true]) {
      await offline(page, `?fixture=F01#workspace=kingdom&view=graph${historical ? '&t=2026-10-20T14%3A03%3A00.000Z&basis=known' : ''}`);
      await expect(nav(page, 'Kingdom')).toHaveAttribute('aria-current', 'page');
      const showMap = page.getByRole('button', { name: 'Show map', exact: true }); if (await showMap.isVisible()) await showMap.click();
      await expect(page.locator('.tl-time b')).toBeVisible();
      await expect(page.locator('.tl-time b')).toHaveText(historical ? '14:03:00 UTC' : '14:13:00 UTC');
      const clock = await page.locator('.tl-time b').evaluate(element => {
        const bounds = element.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(element);
        const textRects = Array.from(range.getClientRects());
        return { text: element.textContent, bounds: bounds.toJSON(), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
          textRects: textRects.map(rect => rect.toJSON()),
          hits: textRects.flatMap(rect => [.2,.5,.8].map(fraction => { const hit = document.elementFromPoint(rect.left + rect.width * fraction, rect.top + rect.height / 2); return !!hit && (hit === element || element.contains(hit)); })),
          occluders: Array.from(document.querySelectorAll('.tl-controls button,.tl-controls summary')).filter(control => { const box = control.getBoundingClientRect(); return control.getClientRects().length && textRects.some(rect => rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top); }).map(control => control.textContent) };
      });
      expect(clock.bounds.width).toBeGreaterThan(0); expect(clock.textRects.length).toBeGreaterThan(0); expect(clock.hits.length).toBeGreaterThan(0);
      expect(clock.scrollWidth).toBeLessThanOrEqual(clock.clientWidth + 1); expect(clock.occluders).toEqual([]); expect(clock.hits.every(Boolean)).toBe(true);
      for (const rect of clock.textRects) { expect(rect.left).toBeGreaterThanOrEqual(clock.bounds.left - 1); expect(rect.right).toBeLessThanOrEqual(clock.bounds.right + 1); }
      timelineClocks.push({ width, historical, ...clock }); await noDocumentOverflow(page);
      await captureRedesign(page, `V14-${width}-timeline-${historical ? 'historical' : 'live'}`);
    }
  }
  await page.setViewportSize({width:1280,height:768});await offline(page,'?fixture=F01');await rendered(page);await page.locator('.sidebar [data-finding-id]').first().click();await expect(page.locator('aside.evidence')).toBeVisible();
  // R3F sizes the drawing surface through ResizeObserver after the inspector mounts.
  // Wait for those real bounds without weakening the minimum width or overlap limit.
  await expect.poll(async () => {
    const canvas = await page.locator('canvas').boundingBox(), pane = await page.locator('aside.evidence').boundingBox();
    return !!canvas && !!pane && canvas.width >= 560 && canvas.x + canvas.width <= pane.x + 1;
  }).toBe(true);
  const canvasBox=await page.locator('canvas').boundingBox(),paneBox=await page.locator('aside.evidence').boundingBox();expect(canvasBox!.width).toBeGreaterThanOrEqual(560);expect(canvasBox!.x+canvasBox!.width).toBeLessThanOrEqual(paneBox!.x+1);await noDocumentOverflow(page);await captureRedesign(page,'V14-1280-kingdom-detail');writeRedesignEvidence('1280-panel-layout.json',{canvasBox,paneBox,viewport:{width:1280,height:768},noPanelOverlap:true,minimumCanvasWidthRequired:560});
  const selectedBeforeResize=await page.locator('aside.evidence').getAttribute('data-selection-id');const resize=page.getByRole('separator',{name:'Resize inspector'});await resize.focus();await resize.press('Home');await expect(resize).toHaveAttribute('aria-valuenow','360');const grip=await resize.boundingBox();await page.mouse.move(grip!.x+grip!.width/2,grip!.y+80);await page.mouse.down();await page.mouse.move(grip!.x+grip!.width/2-40,grip!.y+80,{steps:5});await page.mouse.up();await expect(resize).toHaveAttribute('aria-valuenow','400');await resize.press('End');await expect(resize).toHaveAttribute('aria-valuenow','520');await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id',selectedBeforeResize!);await noDocumentOverflow(page);await captureRedesign(page,'V14-1280-resized-inspector');
  await page.setViewportSize({width: 1440, height: 900}); await offline(page, '?fixture=F01#workspace=coverage');
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await noDocumentOverflow(page); await captureRedesign(page, 'V14-200percent-css-zoom');
  writeRedesignEvidence('touch-targets.json',touchTargets);expect(touchTargets.filter(t=>t.width<43.5||t.height<43.5)).toEqual([]);
  writeRedesignEvidence('narrow-timeline-clock-bounds.json', timelineClocks);
  reports.push({ zoom: 'CSS zoom 200%; actual Chromium browser-chrome zoom unavailable in headless mode', widths: [1366,1280,1024,768,390,320] });
});

test('V15: axe DOM accessibility, reduced motion, forced colors, and visible keyboard focus', async ({ page }) => {
  const axePath = process.env.DK_AXE_PATH ?? `${REDESIGN_ROOT}/node_modules/axe-core/axe.min.js`;
  expect(existsSync(axePath), 'Install the pinned root axe-core dev dependency, or provide DK_AXE_PATH.').toBe(true);
  const scans: any[] = [];
  for (const workspace of ['kingdom','investigate','coverage','integrations','kingdom-expanded','kingdom-inspector','investigate-primary-detail','investigate-primary-detail-320']) {
    await page.setViewportSize({ width: workspace.endsWith('-320') ? 320 : 1440, height: 900 });
    await offline(page, `?fixture=F01#workspace=${workspace.split('-')[0]}&view=graph`);
    if(workspace.endsWith('expanded'))await page.getByRole('button',{name:'Expand timeline',exact:true}).click();
    if(workspace.endsWith('inspector'))await page.locator('.sidebar [data-finding-id]').first().click();
    if(workspace.includes('primary-detail')) { await page.locator('.findings-workspace [data-finding-id]').first().click(); await page.getByRole('button',{name:'Expand investigation',exact:true}).click(); await page.getByTestId('evidence-card-raw').first().locator('summary').click(); await expect(page.getByTestId('evidence-card-payload').first()).toBeVisible(); }
    await page.evaluate(readFileSync(axePath,'utf8'));
    const result = await page.evaluate(async () => (window as any).axe.run(document, { runOnly: {type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
    scans.push({ workspace, url: page.url().replace(h.offlineUrl,''), violations: result.violations, incomplete: result.incomplete, passes: result.passes.map((p:any) => p.id), computedContrast: result.passes.filter((p:any) => p.id === 'color-contrast').flatMap((p:any) => p.nodes.map((n:any) => ({ target:n.target,checks:[...n.any,...n.all].map((c:any) => ({id:c.id,data:c.data,message:c.message})) }))) });
  }
  writeRedesignEvidence('axe-dom-results.json', { version:'4.10.3', scope:'Rendered DOM, not canvas geometry or a complete conformance certification', scans });
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await offline(page, '?fixture=F01#workspace=investigate');
  await captureRedesign(page, 'V15-forced-colors-reduced-motion');
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => { const e=document.activeElement!; const s=getComputedStyle(e); return { tag:e.tagName, text:e.textContent, outline:s.outline, color:s.color, background:s.backgroundColor, width:e.getBoundingClientRect().width }; });
  writeRedesignEvidence('keyboard-focus.json', focus); expect(focus.outline).not.toContain(' 0px');
  expect(scans.flatMap(s => s.violations.map((v:any) => ({ workspace:s.workspace,id:v.id,impact:v.impact,targets:v.nodes.map((n:any) => n.target) })))).toEqual([]);
});

test('V16: 50/200 logical assets, grouping, software renderer and bounded demand frames', async ({ page }) => {
  const performance: any[] = [];
  for (const [fixture,count] of [['F12',50],['F13',200]] as const) {
    const started = Date.now(); await offline(page, `?fixture=${fixture}`); await rendered(page);
    await expect(page.locator('.side-heading')).toContainText(`${count} assets`);
    if (count === 200) await expect(page.getByText('District overview', {exact:true})).toBeVisible();
    await captureRedesign(page, `V16-${count}-overview`);
    const before = await page.locator('canvas').evaluate((e:any) => ({...e.dataset})); await page.waitForTimeout(1000);
    const after = await page.locator('canvas').evaluate((e:any) => ({...e.dataset}));
    performance.push({ fixture,logicalAssets:count,loadToCaptureMs:Date.now()-started, before,after,renderer:await rendererDetails(page),viewport:page.viewportSize(),note:'Headless SwiftShader smoke only. Not a real-GPU FPS benchmark; load includes shader compilation and tool environment. drawCalls and triangles are Three.js main-pass counters: the renderer resets info after shadowMap.render. Shadow passes are excluded, so these counters do not establish the combined main-plus-shadow budget.' });
    expect(Number(after.renderCount)-Number(before.renderCount)).toBeLessThan(10);
    await page.getByRole('radio',{name:'2D graph',exact:true}).click(); if (count === 50) await expect(page.locator('[data-node]')).toHaveCount(count); else { await expect(page.getByText('200 assets · Grouped overview', {exact:true})).toBeVisible(); await page.getByRole('tab',{name:/^Assets 200$/}).click(); await expect(page.locator('.sidebar [data-asset-id]')).toHaveCount(200); }
    await captureRedesign(page, `V16-${count}-graph`);
  }
  writeRedesignEvidence('software-performance.json', performance);
});


test('V12: actual browser network interruption retains stale records and never claims live', async ({ browser }) => {
  const {context,page} = await loginRedesign(browser,h);
  try {
    await expect(page.getByTestId('connection-pill')).toHaveAttribute('data-state','live',{timeout:15_000});
    const first=page.locator('.sidebar [data-finding-id]').first();const id=await first.getAttribute('data-finding-id');await first.click();
    await context.setOffline(true); h.disconnectClients();
    await expect(page.getByTestId('connection-pill')).not.toHaveAttribute('data-state','live',{timeout:20_000});
    await expect(page.getByTestId('connection-banner')).toContainText('not live monitoring');
    await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id',id!);
    await captureRedesign(page,'V12-network-interruption-stale-records');
    reports.push({faultInjection:'Playwright context.setOffline(true) plus test server closeAllConnections() to terminate existing SSE socket; canonical synthetic server data retained',state:await page.getByTestId('connection-pill').getAttribute('data-state')});
  } finally {await context.setOffline(false);await context.close();}
});

test('explicit camera focus and context loss preserve stable selection and graph fallback', async ({page}) => {
  await offline(page,'?fixture=F01');await rendered(page);
  await page.getByRole('tab',{name:/^Assets 13$/}).click();
  await page.locator('.sidebar [data-asset-id]').first().click();
  // Inspector mounting changes the viewport. Compare camera history only after
  // the renderer has applied the actual resized drawing surface.
  await expect.poll(() => page.locator('canvas').evaluate(canvas => {
    const [width, height] = (canvas.dataset.cameraViewport ?? '').split('x').map(Number), bounds = canvas.getBoundingClientRect();
    return Math.abs(width - bounds.width) < 1 && Math.abs(height - bounds.height) < 1;
  })).toBe(true);
  // A late layout pass (an inspector scrollbar appearing once its content settles, ~15 px) can refit
  // the unmanipulated overview once more after the first viewport match (CI runs 40047042997,
  // 40048249657: zoom 20.184 -> 19.683, so Back correctly restored the refitted view, not the stale
  // baseline). Wait for pose and drawing surface to be stable across a quiet interval, then read the
  // baseline and press Focus in the same task so no refit can fall between the two.
  const settledPose = () => page.locator('canvas').evaluate(canvas => {
    const [width, height] = (canvas.dataset.cameraViewport ?? '').split('x').map(Number), bounds = canvas.getBoundingClientRect();
    return Math.abs(width - bounds.width) < 1 && Math.abs(height - bounds.height) < 1 && canvas.dataset.cameraActive !== 'true' ? canvas.dataset.cameraPose ?? null : null;
  });
  await expect.poll(async () => { const a = await settledPose(); await page.waitForTimeout(500); const b = await settledPose(); return a !== null && a === b; }, {timeout: 10_000}).toBe(true);
  const focusButton = page.getByRole('button',{name:'Focus asset',exact:true});await expect(focusButton).toBeEnabled();
  const initial = await focusButton.evaluate(button => { const pose = document.querySelector('canvas')?.dataset.cameraPose ?? null; (button as HTMLButtonElement).click(); return pose; });
  expect(initial).not.toBeNull();
  await expect.poll(()=>page.locator('canvas').getAttribute('data-camera-pose')).not.toBe(initial);
  await page.waitForTimeout(600);const focused=await page.locator('canvas').getAttribute('data-camera-pose');
  const selection=await page.locator('aside.evidence').getAttribute('data-selection-id');
  await page.getByRole('button',{name:'Back to previous camera view',exact:true}).click();await page.waitForTimeout(650);
  await expect.poll(()=>page.locator('canvas').getAttribute('data-camera-pose'),{timeout:10_000}).toBe(initial);
  const replay=page.getByRole('slider',{name:'Replay position'});await replay.focus();await replay.press('End');await replay.press('ArrowLeft');await expect(page.getByTestId('timeline-mode')).toHaveAttribute('data-mode','historical');const cutoff=await replay.inputValue();const pane=page.locator('aside.evidence');const evidenceIds=await pane.locator('[data-event-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-event-id')));expect(evidenceIds.length).toBeGreaterThan(0);const evidenceText=await pane.innerText();
  const lost=await page.locator('canvas').evaluate((canvas:any)=>{const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');const ext=gl?.getExtension('WEBGL_lose_context');if(!ext)return false;ext.loseContext();return true;});expect(lost).toBe(true);
  await expect(page.getByRole('region',{name:'Asset relationship graph',exact:true})).toBeVisible();
  await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id',selection!);
  await expect(replay).toHaveValue(cutoff);expect(await pane.locator('[data-event-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-event-id')))).toEqual(evidenceIds);expect(await pane.innerText()).toBe(evidenceText);
  await captureRedesign(page,'webgl-context-loss-selection-retained');
  await page.getByRole('button',{name:'Retry 3D',exact:true}).click();await rendered(page);await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id',selection!);await captureRedesign(page,'webgl-retry-selection-retained');
  await expect(replay).toHaveValue(cutoff);expect(await pane.locator('[data-event-id]').evaluateAll(rows=>rows.map(row=>row.getAttribute('data-event-id')))).toEqual(evidenceIds);expect(await pane.innerText()).toBe(evidenceText);writeRedesignEvidence('context-loss-retained-evidence.json',{cutoff,selection,evidenceIds,evidenceText,preservedAcross:['actual WEBGL_lose_context fallback','explicit Retry 3D']});
  reports.push({camera:{initial,focused},contextLoss:'Real WEBGL_lose_context extension; stable selection retained in 2D fallback'});
});


test('resource lifetime: bounded module cache and renderer counts after view and replay cycles', async ({page}) => {
  await page.addInitScript(()=>{
    const records:any[]=[];const seen=new WeakSet<object>();const original=HTMLCanvasElement.prototype.getContext;(window as any).__webglLifecycle=records;
    (HTMLCanvasElement.prototype as any).getContext=function(type:string,...args:any[]){const context=(original as any).apply(this,[type,...args]);if(context&&['webgl','webgl2','experimental-webgl'].includes(type)&&!seen.has(context)){seen.add(context);const record={id:records.length+1,context:new WeakRef(context),canvas:new WeakRef(this),lostEvents:0};records.push(record);this.addEventListener('webglcontextlost',()=>{record.lostEvents++;},{once:true});}return context;};
  });
  await offline(page,'?fixture=F01'); await rendered(page);
  const expectedModuleOwners = JSON.parse(readFileSync(`${REDESIGN_ROOT}/fixtures/demo/graph.json`, 'utf8')).assets.length;
  const settledRendererCounters = async () => {
    let previous = '', stableObservations = 0;
    const canvas = page.locator('canvas');
    await expect.poll(async () => {
      const counters = await canvas.evaluate((element: HTMLCanvasElement) => ({ ...element.dataset }));
      // useFrame publishes the previous completed render's GL counters. A positive program count
      // plus at least two rendered frames excludes the initial zero before shader compilation.
      const ready = Number(counters.renderCount) >= 2 && Number(counters.gpuPrograms) > 0 && Number(counters.moduleShaderOwners) === expectedModuleOwners;
      const signature = JSON.stringify([counters.gpuPrograms, counters.moduleShaderOwners, counters.gpuGeometries, counters.gpuTextures, counters.quality]);
      stableObservations = ready && signature === previous ? stableObservations + 1 : 0;
      previous = signature;
      return stableObservations;
    }, { timeout: 10_000, intervals: [100, 100, 200] }).toBeGreaterThanOrEqual(2);
    return canvas.evaluate((element: HTMLCanvasElement) => ({ ...element.dataset }));
  };
  const initial = await settledRendererCounters();
  const samples:any[]=[],previousContextLifecycle:any[]=[];
  for(let cycle=0;cycle<5;cycle++) {
    const previousId=await page.locator('canvas').evaluate(canvas=>(window as any).__webglLifecycle.find((r:any)=>r.canvas.deref()===canvas)?.id);expect(previousId).toBeTruthy();
    await page.getByRole('radio',{name:'2D graph',exact:true}).click(); await expect(page.locator('canvas')).toHaveCount(0);
    await page.waitForTimeout(750); // R3F defers renderer destruction by 500ms.
    await expect.poll(()=>page.evaluate(id=>{const record=(window as any).__webglLifecycle.find((r:any)=>r.id===id);const context=record.context.deref();return !context||context.isContextLost();},previousId),{timeout:5000}).toBe(true);
    const previousContext = await page.evaluate(id=>{const record=(window as any).__webglLifecycle.find((r:any)=>r.id===id),context=record.context.deref(),canvas=record.canvas.deref();return {id,collected:!context,contextLost:context?context.isContextLost():null,lostEvents:record.lostEvents,canvasCollected:!canvas,canvasConnected:canvas?.isConnected??false,moduleShaderOwners:Number(canvas?.dataset.moduleShaderOwners ?? 0),ownerCounterPresent:!!canvas?.hasAttribute('data-module-shader-owners')};},previousId);
    expect(previousContext.moduleShaderOwners).toBe(0);
    expect(previousContext.ownerCounterPresent).toBe(false);
    previousContextLifecycle.push(previousContext);
    await page.getByRole('radio',{name:'3D castle',exact:true}).click(); await rendered(page); await expect(page.locator('canvas')).toHaveCount(1);
    const counters = await settledRendererCounters();
    expect(Number(counters.gpuPrograms)).toBe(Number(initial.gpuPrograms));
    expect(Number(counters.moduleShaderOwners)).toBe(expectedModuleOwners);
    samples.push({cycle,...counters});
  }
  const stableBuilds=Number(samples.at(-1).moduleGeometryBuilds);
  const slider=page.getByRole('slider',{name:'Replay position'});await slider.focus();await slider.press('Home');
  for(let i=0;i<6;i++)await slider.press('ArrowRight'); await page.waitForTimeout(500);
  const afterReplay = await settledRendererCounters();
  expect(Number(afterReplay.gpuPrograms)).toBe(Number(initial.gpuPrograms));
  expect(Number(afterReplay.moduleShaderOwners)).toBe(expectedModuleOwners);
  expect(Number(afterReplay.moduleGeometryBuilds)).toBe(stableBuilds);
  expect(stableBuilds).toBeLessThanOrEqual(30); // Ten module IDs × three explicit detail levels.
  expect(Number(samples.at(-1).gpuGeometries)).toBeLessThanOrEqual(Number(samples[0].gpuGeometries)+4);
  expect(Number(samples.at(-1).gpuTextures)).toBeLessThanOrEqual(Number(samples[0].gpuTextures)+2);
  writeRedesignEvidence('resource-lifetime.json',{scope:'Five actual renderer unmount/remount cycles plus replay edits in Chromium SwiftShader. Previous WebGL contexts are held by WeakRef only and must be lost or GC-collected after the deferred teardown before remount. Nonzero program counts are sampled after completed rendering and stable observations; registered owners must match the 13-asset fixture and disappear from the old canvas on teardown. Current-renderer program/geometry/texture counts and bounded shared CPU cache are not process-wide GPU memory or a process heap/leak proof.',expectedModuleOwners,initial,previousContextLifecycle,teardownWaitMs:750,samples,afterReplay});
});


test('editing, modal and browser-modifier keys are not intercepted when shortcuts are enabled',async({browser})=>{
  const {context,page}=await loginRedesign(browser,h);
  try{
    await nav(page,'Integrations').click();await page.getByRole('tab',{name:'Display',exact:true}).click();await page.getByRole('checkbox',{name:'Enable single-character shortcuts outside editing fields'}).check();
    await nav(page,'Kingdom').click();await page.locator('.sidebar [data-finding-id]').first().click();
    const selected=await page.locator('aside.evidence').getAttribute('data-selection-id');
    const note=page.getByLabel('Analyst note',{exact:true});await note.fill('');await note.pressSequentially('23[]/');await expect(note).toHaveValue('23[]/');
    await expect(page.getByRole('radio',{name:'3D castle',exact:true})).toHaveAttribute('aria-checked','true');
    await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id',selected!);
    await page.getByRole('button',{name:'Export case',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Case export scope'});await expect(dialog).toBeVisible();
    const close=dialog.getByRole('button',{name:'Close preview',exact:true});await close.focus();await page.keyboard.press('2');await page.keyboard.press('3');await page.keyboard.press('[');await page.keyboard.press(']');await page.keyboard.press('/');await expect(close).toBeFocused();await expect(dialog).toBeVisible();
    await expect(page.getByRole('radio',{name:'3D castle',exact:true})).toHaveAttribute('aria-checked','true');await close.click();
    // Dispatch cancellable DOM events instead of invoking actual browser-tab shortcuts.
    const modifiers=await page.evaluate(()=>{const target=document.querySelector<HTMLElement>('.workspace-toolbar h1')!;return ['ctrlKey','metaKey','altKey','shiftKey'].map(mod=>{const e=new KeyboardEvent('keydown',{key:'2',bubbles:true,cancelable:true,[mod]:true});target.dispatchEvent(e);return {modifier:mod,defaultPrevented:e.defaultPrevented};});});
    expect(modifiers.every(m=>!m.defaultPrevented)).toBe(true);await expect(page.getByRole('radio',{name:'3D castle',exact:true})).toHaveAttribute('aria-checked','true');
    writeRedesignEvidence('shortcut-noninterception.json',{typed:'23[]/',editable:'Actual textarea input preserved',modal:'Actual key presses remained scoped to the export dialog',modifiers,nativeBrowserShortcutNote:'Modifier events checked for non-cancellation and no app navigation; native browser chrome actions deliberately not invoked.'});
  }finally{await context.close();}
});

test('controlled replay reaches its end and stays historical until Return to latest',async({page})=>{
  await page.clock.install();await offline(page,'?fixture=F01#view=graph');const slider=page.getByRole('slider',{name:'Replay position'});const end=await slider.getAttribute('max');
  await slider.focus();await slider.press('End');await slider.press('ArrowLeft');await page.getByRole('button',{name:'Play replay',exact:true}).click();await page.clock.runFor(2000);
  await expect(page.getByRole('button',{name:'Play replay',exact:true})).toBeVisible();await expect(slider).toHaveValue(end!);await expect(page.getByTestId('timeline-mode')).toHaveAttribute('data-mode','historical');
  await page.clock.runFor(3000);await expect(slider).toHaveValue(end!);await expect(page.getByTestId('timeline-mode')).toHaveAttribute('data-mode','historical');
  await page.getByRole('button',{name:'Return to latest',exact:true}).click();await expect(page.getByTestId('timeline-mode')).toHaveAttribute('data-mode','latest');
  writeRedesignEvidence('replay-end.json',{clock:'Playwright controlled browser clock:2000ms+3000ms',end:Number(end),automaticallyReturnedToLatest:false,explicitReturnToLatestVerified:true,dataset:'fixed synthetic F01'});
});


test('A11Y-03: desktop and narrow inspectors remain nonmodal and keyboard Tab can exit and return',async({page})=>{
  const samples:any[]=[];
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});await offline(page,'?fixture=F01#workspace=investigate&sel=asset:api');
    const pane=page.getByRole('complementary',{name:'Evidence',exact:true});await expect(pane).toBeVisible();await expect(pane).not.toHaveAttribute('aria-modal','true');await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.waitForTimeout(100);const accessibleTree=await pane.ariaSnapshot();expect(accessibleTree).toContain('complementary "Evidence"');
    const last=await pane.evaluate(root=>{const candidates=Array.from(root.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,summary,[tabindex]')).filter(e=>e.tabIndex>=0&&!e.matches(':disabled')&&e.getClientRects().length>0);const target=candidates.at(-1)!;target.focus();return {tag:target.tagName,text:target.textContent};});
    await page.keyboard.press('Tab');const outside=await page.evaluate(()=>({tag:document.activeElement?.tagName,text:document.activeElement?.textContent,insideInspector:!!document.activeElement?.closest('aside.evidence')}));expect(outside.insideInspector).toBe(false);
    await page.keyboard.press('Shift+Tab');expect(await pane.evaluate(root=>root.contains(document.activeElement))).toBe(true);await page.getByRole('button',{name:'Close evidence pane',exact:true}).focus();await page.keyboard.press('Shift+Tab');const previous=await page.evaluate(()=>({tag:document.activeElement?.tagName,insideInspector:!!document.activeElement?.closest('aside.evidence')}));expect(previous.insideInspector).toBe(false);expect(previous.tag).not.toBe('BODY');await page.keyboard.press('Tab');expect(await pane.evaluate(root=>root.contains(document.activeElement))).toBe(true);samples.push({width,accessibleTree,last,outside,previous,forwardAndReverseExitAndReturn:true});
  }
  writeRedesignEvidence('inspector-nonmodal-keyboard.json',{scope:'Chromium accessibility snapshot and real Tab/Shift+Tab, not a manual screen-reader session',samples});
});

test('A11Y-05: reduced-motion preference makes focus immediate and leaves no continuous effect or camera frames',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await offline(page,'?fixture=F01#workspace=kingdom&view=castle&sel=asset:api');await rendered(page);const canvas=page.locator('canvas');const before=await canvas.getAttribute('data-camera-pose');
  await canvas.evaluate(element=>{const states:(string|null)[]=[];(window as any).__motionStates=states;const observer=new MutationObserver(records=>{for(const record of records)states.push(record.oldValue,element.getAttribute('data-camera-active'));});observer.observe(element,{attributes:true,attributeFilter:['data-camera-active'],attributeOldValue:true});(window as any).__motionObserver=observer;});
  await page.getByRole('button',{name:'Focus asset',exact:true}).click();await expect.poll(()=>canvas.getAttribute('data-camera-pose')).not.toBe(before);await page.waitForTimeout(450);
  const focused=await canvas.getAttribute('data-camera-pose'),framesBefore=await canvas.getAttribute('data-render-count');await page.waitForTimeout(700);const framesAfter=await canvas.getAttribute('data-render-count');expect(framesAfter).toBe(framesBefore);expect(await canvas.getAttribute('data-camera-pose')).toBe(focused);
  const motion=await page.evaluate(()=>{(window as any).__motionObserver.disconnect();return {prefersReduced:matchMedia('(prefers-reduced-motion: reduce)').matches,cameraActiveStates:(window as any).__motionStates,runningDomAnimations:document.getAnimations().filter(a=>a.playState==='running').length};});expect(motion.prefersReduced).toBe(true);expect(motion.cameraActiveStates).not.toContain('true');expect(motion.runningDomAnimations).toBe(0);
  writeRedesignEvidence('reduced-motion-behavior.json',{scope:'Chromium media preference emulation, real 3D focus and MutationObserver, 700ms idle observation; not a physical OS-setting or screen-reader certification',before,focused,framesBefore,framesAfter,...motion});
});


test('CASTLE-10: rendered relationship patterns and labels distinguish evidence without color; hypothetical stays off by default',async({page})=>{
  const graph=JSON.parse(readFileSync(`${REDESIGN_ROOT}/fixtures/demo/graph.json`,'utf8'));const hypothetical=graph.relationships.filter((r:any)=>r.evidence_level==='hypothetical');expect(hypothetical.length).toBeGreaterThan(0);
  await offline(page,'?fixture=F01#workspace=kingdom&view=graph');await expect(page.locator('svg.graph2d')).toBeVisible();await page.getByRole('tab',{name:/^Assets 13$/}).click();await page.locator(`.sidebar [data-asset-id="${hypothetical[0].source_id}"]`).click();
  for(const edge of hypothetical)await expect(page.locator(`[data-edge-id="${edge.id}"]`)).toHaveCount(0);
  await page.getByText('Layers & display',{exact:true}).click();await expect(page.getByRole('checkbox',{name:'Hypothetical relationships',exact:true})).not.toBeChecked();
  for(const name of ['Runtime calls','Identity & permissions','Deployment','Agent tools'])await page.getByRole('checkbox',{name,exact:true}).check();
  for(const edge of hypothetical)await expect(page.locator(`[data-edge-id="${edge.id}"]`)).toHaveCount(0);
  await page.getByRole('checkbox',{name:'Hypothetical relationships',exact:true}).check();await page.getByText('Layers & display',{exact:true}).click();
  const patterns:Record<string,number[]>={observed:[],declared:[8,5],inferred:[10,4,2,4],hypothetical:[2,6]};const samples:any[]=[];
  for(const [level,expected] of Object.entries(patterns)){
    const canonical=graph.relationships.find((r:any)=>r.evidence_level===level&&(level==='hypothetical'||!['runs_as','may_assume','invokes_tool'].includes(r.kind)));await page.locator(`.sidebar [data-asset-id="${canonical.source_id}"]`).click();const edge=page.locator(`[data-edge-id="${canonical.id}"]`);await expect(edge).toBeVisible();const meaning=relationshipMeaning(canonical.kind,level);await expect(edge).toHaveAttribute('aria-label',`${meaning.label} relationship`);await expect(edge.locator('title')).toHaveText(`${meaning.label}: ${meaning.note}`);
    const dash=await edge.locator('path.edge').evaluate(element=>({attribute:element.getAttribute('stroke-dasharray'),computed:getComputedStyle(element).strokeDasharray}));const actual=dash.computed==='none'?[]:Array.from(dash.computed.matchAll(/[0-9.]+/g),match=>Number(match[0]));expect(actual).toEqual(expected);samples.push({id:canonical.id,selectedAsset:canonical.source_id,level,...dash});
  }
  await page.getByRole('button',{name:'Map key',exact:true}).click();for(const label of ['Observed','Declared','Inferred (dash-dot in map)','Hypothetical · off by default'])await expect(page.locator('.legend-body').getByText(label,{exact:true})).toBeVisible();
  await captureRedesign(page,'relationship-patterns-hypothetical-opt-in');writeRedesignEvidence('relationship-rendered-patterns.json',{scope:'Actual selected-neighborhood SVG computed dash styles, accessible labels and visible legend; a canonical endpoint selected for each sample. All layers explicitly enabled only after default hypothetical absence was confirmed',hypotheticalAbsentByDefault:true,hypotheticalStillAbsentWithIdentityLayer:true,samples});
});

test('default F01 native draw calls include main and shadow passes within the 250-call budget',async({page})=>{
  await page.addInitScript(()=>{
    const frames=new Map<number,any>();let activeFrame:number|null=null;
    const nativeRaf=window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame=(callback)=>nativeRaf(time=>{const previous=activeFrame;activeFrame=time;try{callback(time);}finally{activeFrame=previous;}});
    const defaultFramebuffer=new WeakMap<object,boolean>();
    for(const constructor of [window.WebGLRenderingContext,window.WebGL2RenderingContext]){
      if(!constructor)continue;const prototype=constructor.prototype;
      const bindDescriptor=Object.getOwnPropertyDescriptor(prototype,'bindFramebuffer');
      if(typeof bindDescriptor?.value==='function'){
        const nativeBind=bindDescriptor.value;
        Object.defineProperty(prototype,'bindFramebuffer',{...bindDescriptor,value:function(this:any,...args:any[]){const result=nativeBind.apply(this,args);if(args[0]===this.FRAMEBUFFER||args[0]===this.DRAW_FRAMEBUFFER)defaultFramebuffer.set(this,args[1]===null);return result;}});
      }
      for(const method of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced','drawRangeElements']){
        const descriptor=Object.getOwnPropertyDescriptor(prototype,method);if(typeof descriptor?.value!=='function')continue;const nativeDraw=descriptor.value;
        Object.defineProperty(prototype,method,{...descriptor,value:function(this:any,...args:any[]){
          const result=nativeDraw.apply(this,args);const canvas=this.canvas;
          if(canvas instanceof HTMLCanvasElement&&canvas.dataset.engine?.startsWith('three.js')){
            const key=activeFrame??-1;let frame=frames.get(key);
            if(!frame){frame={rafTimestamp:activeFrame,nativeDrawCalls:0,defaultFramebufferDrawCalls:0,offscreenDrawCalls:0,triangles:0,methods:{},qualities:[],contextType:constructor.name};frames.set(key,frame);}
            frame.nativeDrawCalls++;if(defaultFramebuffer.get(this)!==false)frame.defaultFramebufferDrawCalls++;else frame.offscreenDrawCalls++;
            frame.methods[method]=(frame.methods[method]??0)+1;if(!frame.qualities.includes(canvas.dataset.quality))frame.qualities.push(canvas.dataset.quality??'not-yet-published');
            const count=method==='drawRangeElements'?args[3]:method.startsWith('drawArrays')?args[2]:args[1];const instances=method==='drawArraysInstanced'?args[3]:method==='drawElementsInstanced'?args[4]:1;
            if(args[0]===this.TRIANGLES)frame.triangles+=count/3*instances;
          }
          return result;
        }});
      }
    }
    (window as any).__nativeDrawFrames=()=>Array.from(frames.values());
  });
  await offline(page,'?fixture=F01#workspace=kingdom&view=castle');await rendered(page);await expect(page.locator('.side-heading')).toContainText('13 assets');await page.waitForTimeout(1000);
  const frames=await page.evaluate(()=>(window as any).__nativeDrawFrames());const publishedMainPass=await page.locator('canvas').evaluate((canvas:any)=>({...canvas.dataset}));
  const completeFrames=frames.filter((frame:any)=>frame.rafTimestamp!==null);const outsideRaf=frames.filter((frame:any)=>frame.rafTimestamp===null);const maximum=Math.max(...completeFrames.map((frame:any)=>frame.nativeDrawCalls));
  writeRedesignEvidence('native-draw-budget.json',{fixture:'F01',logicalAssets:13,viewport:page.viewportSize(),dpr:await page.evaluate(()=>devicePixelRatio),renderer:await rendererDetails(page),method:'Native WebGL drawArrays/drawElements, instanced variants and drawRangeElements wrappers preserve original receivers, arguments and results. Counts group by real requestAnimationFrame timestamp; bindFramebuffer tracks default versus offscreen draws, including shadow targets. No postprocessing renderer is present in this scene.',instrumentation:'Separate instrumented condition, not an FPS/load sample. JavaScript counting adds overhead. Native framebuffer counts belong to each complete frame; the application-published gl.info main-pass counter is the previous completed main pass because it is sampled by useFrame before rendering.',frames,outsideRaf,publishedMainPass,maximumCompleteFrameDrawCalls:maximum,target:250,scope:'Actual default synthetic 13-asset scene at medium quality, Chromium SwiftShader. No real-GPU timing or hardware-performance claim.'});
  expect(completeFrames.length).toBeGreaterThan(0);expect(outsideRaf).toEqual([]);expect(completeFrames.some((frame:any)=>frame.offscreenDrawCalls>0)).toBe(true);expect(completeFrames.some((frame:any)=>frame.qualities.includes('medium'))).toBe(true);
  for(const frame of completeFrames){expect(frame.contextType).toBe('WebGL2RenderingContext');expect(frame.nativeDrawCalls).toBe(frame.defaultFramebufferDrawCalls+frame.offscreenDrawCalls);}
  expect(maximum).toBeLessThanOrEqual(250);
});
