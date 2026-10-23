/** Original spec13.1/15.1: real isolated server setup state, not cosmetic completion. */
import { test, expect } from '@playwright/test';
import { createRedesignHarness, loginRedesign, captureRedesign, writeRedesignEvidence, type RedesignHarness } from './redesign-harness.ts';
let harness: RedesignHarness;
const results: Record<string, unknown>[] = [];
test.beforeAll(async () => { harness = await createRedesignHarness(); });
test.afterAll(async () => { writeRedesignEvidence('setup-capability-verification.json', { scope: 'Real empty synthetic server project, journal-normalized receipt and current source metadata. No external systems or persistent account access are configured.', checks: results }); await harness?.close(); });
test.afterEach(async ({}, info) => { results.push({ name: info.title, status: info.status, durationMs: info.duration }); });

test('PROSE-15: empty inventory, configuration and receipt are separate real server steps', async ({ browser }) => {
  const project = 'fresh-setup-proof';
  harness.store.createProject(project, 'Isolated fresh project', 'synthetic', { start: '2026-10-20T13:59:00Z', end: '2026-10-20T14:13:00Z' });
  const { context, page } = await loginRedesign(browser, harness, { project });
  try {
    const checklist = page.getByRole('region', { name: 'Project setup checklist' });
    await expect(checklist).toBeVisible(); await expect(checklist.locator('[data-complete="false"]')).toHaveCount(3);
    await expect(checklist).toContainText('No assets have been added to this project.');
    await page.getByRole('button', { name: 'Integrations', exact: true }).click();
    await page.getByRole('tab', { name: 'Display', exact: true }).click();
    await page.getByRole('button', { name: 'Kingdom', exact: true }).click();
    await checklist.getByRole('button', { name: 'Open inventory setup', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Import declared inventory' })).toBeVisible();
    await expect(page.locator('#inventory-setup > summary')).toBeFocused();
    await page.getByRole('button', { name: 'Kingdom', exact: true }).click();
    await expect(checklist.locator('[data-complete="false"]')).toHaveCount(3);
    await page.getByRole('tab', { name: /^Assets/ }).click();
    await expect(page.locator('.sidebar .empty')).toContainText('No assets have been added to this project.');
    await expect(page.locator('.sidebar .empty').getByRole('button', { name: 'View import guidance' })).toBeVisible();
    await captureRedesign(page, 'fresh-project-empty-inventory-checklist');
    const graph = harness.store.getGraph('demo-castle')!;
    harness.store.putGraph(project, { ...graph, project_id: project, graph_revision: 'setup-proof-r1', assets: graph.assets.filter(asset => asset.id === 'edge'), relationships: [] }, 'synthetic-setup-test');
    await page.reload(); await expect(checklist.locator('[data-setup-step="inventory"]')).toHaveAttribute('data-complete', 'true');
    await expect(checklist.locator('[data-setup-step="source"]')).toHaveAttribute('data-complete', 'false');
    await expect(checklist).toContainText('activity visibility is not configured');
    harness.store.upsertSource(project, { id: 'setup-source', label: 'Isolated setup application source', kind: 'app_security', asset_ids: ['edge'] }, 'synthetic-setup-test');
    await page.reload(); await expect(checklist.locator('[data-setup-step="source"]')).toHaveAttribute('data-complete', 'true');
    await expect(checklist.locator('[data-setup-step="receipt"]')).toHaveAttribute('data-complete', 'false');
    await expect(checklist).toContainText('Event receipt is not confirmed');
    const result = harness.store.receive(project, 'setup-source', { source_event_id: 'setup-receipt-1', occurred_at: '2026-10-20T14:01:00.000Z', asset_ids: ['edge'], action: 'request_received', outcome: 'success', evidence: { note: 'Explicit isolated setup test event' } }, '2026-10-20T14:01:01.000Z');
    expect(result.status).toBe('accepted'); while (harness.store.processBatch(100).processed) { /* real normalization */ }
    await page.reload(); await expect(checklist).toHaveCount(0);
    const snapshot = await harness.api('GET', `/api/projects/${project}/snapshot`); expect(snapshot.status).toBe(200); expect(snapshot.json.events).toHaveLength(1);
    results.push({ project, graphRevision: snapshot.json.graph.graph_revision, configuredSources: snapshot.json.sources.length, canonicalStoredEventCount: snapshot.json.events.length, eventId: snapshot.json.events[0].id });
  } finally { await context.close(); }
});

test('PROSE-13: cards show scoped configuration and keep absent assessments unknown', async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await page.route('**/api/projects/demo-castle/snapshot', async route => { const response = await route.fetch(), json = await response.json(); json.coverage = []; await route.fulfill({ response, json }); });
    await page.reload(); await page.getByRole('button', { name: 'Integrations', exact: true }).click();
    await page.locator('.integration-card').filter({ has: page.getByRole('heading', { name: 'Node application SDK', exact: true }) }).locator('details > summary').click();
    const application = page.locator('[data-integration-status="application"]');
    await expect(application).toContainText('matching source records configured');
    await expect(application).toContainText('SDK installation is not observable');
    await expect(application).toContainText(/0 reporting · 0 with reported gaps · 0 disabled · \d+ not assessed/);
    await expect(page.locator('[data-integration-status="otel"]')).toContainText('No matching source records configured');
    await expect(page.locator('[data-integration-status="inventory"]')).toContainText('Declared inventory present');
    await application.getByRole('button', { name: 'Inspect source records and timestamps' }).click();
    await expect(page.getByRole('group', { name: 'Coverage summary' })).toContainText('sources without confirmed reporting');
    await expect(page.locator('tr[data-state="not_assessed"]')).not.toHaveCount(0);
  } finally { await context.close(); }
});
