/** Bounded acceptance checks against the real seeded server. All faults below are explicit test injections. */
import { test, expect, type Page } from '@playwright/test';
import type { CoverageRecord, Finding, Graph, SourceConfig } from '@dk/contracts';
import { createRedesignHarness, loginRedesign, captureRedesign, writeRedesignEvidence, type RedesignHarness } from './redesign-harness.ts';

type Snapshot = { graph: Graph; sources: (SourceConfig & { disabled?: boolean })[]; coverage: CoverageRecord[]; findings: Finding[]; server_time: string };
let harness: RedesignHarness;
const project = 'demo-castle';
const results: Record<string, unknown>[] = [];
test.beforeAll(async () => { harness = await createRedesignHarness(); });
test.afterAll(async () => { writeRedesignEvidence('presentation-acceptance.json', { scope: 'Isolated API-backed canonical synthetic seed. No production data, fake mutation success, or historical coverage claims.', checks: results }); await harness?.close(); });
test.afterEach(async ({}, info) => { results.push({ name: info.title, status: info.status, durationMs: info.duration, ...(info.error ? { error: info.error.message } : {}) }); });
async function snapshot(): Promise<Snapshot> { const response = await harness.api('GET', `/api/projects/${project}/snapshot`); expect(response.status).toBe(200); return response.json; }
function expectedCounts(data: Snapshot) {
  // Independently count source entities versus distinct inventory entities; never sum source asset memberships.
  const unavailable = data.sources.filter(source => source.disabled || !data.coverage.some(record => record.source_id === source.id && record.state === 'healthy'));
  const gaps = data.graph.assets.filter(asset => { const configured = data.sources.filter(source => source.asset_ids.includes(asset.id)); return configured.length === 0 || configured.some(source => source.disabled || !data.coverage.some(record => record.source_id === source.id && record.asset_ids.includes(asset.id) && record.state === 'healthy')); });
  return { sourceCount: unavailable.length, assetCount: gaps.length, gapIds: gaps.map(asset => asset.id).sort() };
}
const coverage = (page: Page) => page.locator('.coverage-workspace');
async function openCoverage(page: Page) { await page.getByRole('button', { name: 'Coverage', exact: true }).click(); await expect(coverage(page)).toBeVisible(); }
async function expectCounts(page: Page, counts: { sourceCount: number; assetCount: number }) {
  const summary = page.getByRole('group', { name: 'Coverage summary' });
  await expect(summary.locator('.summary-item').filter({ hasText: 'sources without confirmed reporting' }).locator('strong')).toHaveText(String(counts.sourceCount));
  await expect(summary.locator('.summary-item').filter({ hasText: 'assets with visibility gaps' }).locator('strong')).toHaveText(String(counts.assetCount));
  await expect(page.locator('.topbar .coverage-shortcut')).toHaveText(`${counts.assetCount} assets with visibility gaps`);
}

test('COV-05: canonical source counts and distinct affected asset counts agree across Coverage and header', async ({ browser }) => {
  const data = await snapshot(), counts = expectedCounts(data);
  expect(counts.sourceCount).toBeGreaterThan(0); expect(counts.assetCount).toBeGreaterThan(counts.sourceCount);
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await openCoverage(page); await expectCounts(page, counts);
    await expect(coverage(page).locator('tr[data-source-id]')).toHaveCount(data.sources.length);
    await expect(coverage(page).getByText(/Current coverage as of/)).toBeVisible();
    await page.getByRole('tab', { name: 'Assets with gaps', exact: true }).click();
    expect(await coverage(page).locator('tr[data-asset-id]').evaluateAll(rows => rows.map(row => row.getAttribute('data-asset-id')).sort())).toEqual(counts.gapIds);
    await expectCounts(page, counts);
    await captureRedesign(page, 'COV05-distinct-sources-and-assets');
    results.push({ acceptance: 'COV-05', canonicalSourceCount: data.sources.length, unavailableSources: counts.sourceCount, inventoryAssets: data.graph.assets.length, distinctAssetsWithGaps: counts.assetCount });
  } finally { await context.close(); }
});

test('COV-06: fault-injected missing assessments remain unknown, never zero gaps or healthy', async ({ browser }) => {
  const data = await snapshot(); const { context, page } = await loginRedesign(browser, harness);
  try {
    let omissions = 0;
    // Retain the real canonical snapshot and omit only its assessment records. This is a missing-data fault, not a fabricated successful backend action.
    await page.route(`**/api/projects/${project}/snapshot`, async route => { const response = await route.fetch(); const json = await response.json(); json.coverage = []; omissions++; await route.fulfill({ response, json }); });
    await page.reload(); await expect(page.locator('.app')).toBeVisible(); await openCoverage(page); expect(omissions).toBeGreaterThan(0);
    await expectCounts(page, { sourceCount: data.sources.length, assetCount: data.graph.assets.length });
    await expect(coverage(page).locator('tr[data-state="not_assessed"]')).toHaveCount(data.sources.length);
    await expect(coverage(page).locator('tr[data-state="healthy"]')).toHaveCount(0);
    await expect(coverage(page).getByText('A missing assessment remains unknown.', { exact: false })).toBeVisible();
    await page.getByRole('tab', { name: 'Assets with gaps', exact: true }).click();
    await expect(coverage(page).locator('tr[data-asset-id]')).toHaveCount(data.graph.assets.length);
    const states = await coverage(page).locator('tr[data-asset-id]').evaluateAll(rows => rows.map(row => row.getAttribute('data-coverage')));
    expect(states.every(state => state === 'unassessed' || state === 'unobserved')).toBe(true);
    await expect(coverage(page).getByRole('heading', { name: 'No visibility gaps recorded in this snapshot.' })).toHaveCount(0);
    await captureRedesign(page, 'COV06-missing-assessment-explicit-fault');
  } finally { await context.close(); }
});

test('COV-06: failed refresh retains confirmed nonzero gaps and visibly marks the snapshot stale', async ({ browser }) => {
  const data = await snapshot(), counts = expectedCounts(data); const { context, page } = await loginRedesign(browser, harness);
  try {
    await openCoverage(page); await expectCounts(page, counts); await expect(page.getByTestId('connection-pill')).toHaveAttribute('data-state', 'live');
    const basis = await coverage(page).locator('.scope-note').first().innerText(); let failures = 0;
    await page.route(`**/api/projects/${project}/snapshot`, async route => { failures++; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Explicit synthetic snapshot refresh outage' }) }); });
    // A genuine server-confirmed update prompts the normal SSE refresh path. The snapshot response alone fails.
    expect((await harness.api('POST', `/api/projects/${project}/findings/${encodeURIComponent(data.findings[0]!.id)}/disposition`, { note: 'Synthetic refresh trigger for coverage failure acceptance' })).status).toBe(200);
    await expect(page.getByTestId('connection-pill')).toHaveAttribute('data-state', 'sync-failed', { timeout: 15000 }); expect(failures).toBeGreaterThan(0);
    await expect(page.getByTestId('connection-banner')).toBeVisible(); await expect(page.getByTestId('connection-banner')).toContainText('Could not refresh the snapshot'); await expect(page.getByTestId('connection-banner')).toContainText('Showing data as of');
    await expectCounts(page, counts); expect(counts.assetCount).toBeGreaterThan(0);
    await expect(coverage(page).locator('.scope-note').first()).toHaveText(basis);
    await expect(page.locator('.topbar .coverage-shortcut')).not.toHaveText('0 assets with visibility gaps');
    await expect(coverage(page).locator('tr[data-state="offline"], tr[data-state="stale"], tr[data-state="unavailable"]')).not.toHaveCount(0);
    await captureRedesign(page, 'COV06-failed-snapshot-retains-known-gaps');
  } finally { await context.close(); }
});

test('TIME-03: earlier replay visibly labels later server notes and dispositions as current annotations', async ({ browser }) => {
  const data = await snapshot(); const finding = data.findings.find(item => item.kind === 'blocked_request_reported') ?? data.findings[0]!;
  const replay = '2026-10-20T14:00:00Z', note = 'Synthetic current annotation recorded after the selected replay interval.';
  const saved = await harness.api('POST', `/api/projects/${project}/findings/${encodeURIComponent(finding.id)}/disposition`, { lifecycle: 'acknowledged', disposition: 'expected_test', note, expected_state_version: finding.state_version ?? 0 });
  expect(saved.status).toBe(200); const created = saved.json.notes.find((entry: { note: string }) => entry.note === note); expect(created).toBeTruthy(); expect(Date.parse(created.created_at)).toBeGreaterThan(Date.parse(replay));
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await page.evaluate(({ id, time }) => { location.hash = new URLSearchParams({ v: '2', workspace: 'kingdom', view: 'graph', sel: `finding:${id}`, t: time, basis: 'known' }).toString(); }, { id: finding.id, time: replay });
    const detail = page.locator('aside.evidence'); await expect(detail).toHaveAttribute('data-selection-id', finding.id);
    await expect(page.locator('.replay-scope')).toBeVisible(); await expect(page.locator('.replay-scope')).toContainText('notes and disposition are current annotations');
    await detail.getByRole('tab', { name: 'Notes', exact: true }).click(); const notes = detail.getByRole('tabpanel', { name: 'Notes', exact: true }); await notes.scrollIntoViewIfNeeded();
    await expect(notes.getByText('Current annotations, not a reconstruction of what was known during replay.', { exact: true })).toBeVisible(); await expect(notes.getByText(note, { exact: true })).toBeVisible();
    await captureRedesign(page, 'TIME03-current-notes-during-earlier-replay');
    const currentReview = detail.getByText('Current lifecycle: acknowledged. Disposition: expected test. Closing a finding does not establish remediation.', { exact: true });
    await currentReview.scrollIntoViewIfNeeded(); await expect(currentReview).toBeVisible(); await expect(page.locator('.replay-scope')).toBeVisible();
    await captureRedesign(page, 'TIME03-current-disposition-during-earlier-replay');
    const after = await harness.api('GET', `/api/projects/${project}/findings/${encodeURIComponent(finding.id)}`); expect(after.status).toBe(200); expect(after.json.finding.lifecycle).toBe('acknowledged'); expect(after.json.finding.disposition).toBe('expected_test'); expect(after.json.notes.find((entry: { note: string }) => entry.note === note).created_at).toBe(created.created_at);
    results.push({ acceptance: 'TIME-03', replayTime: replay, currentAnnotationCreatedAt: created.created_at, findingId: finding.id, currentLifecycle: 'acknowledged', currentDisposition: 'expected_test' });
  } finally { await context.close(); }
});
