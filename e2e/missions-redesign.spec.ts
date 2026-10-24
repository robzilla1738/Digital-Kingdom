/** LP29: local mission desk (builder vs investigator) against an API-backed isolated synthetic server; Chromium SwiftShader, no GPU claim. */
import { test, expect, type Page } from '@playwright/test';
import { captureRedesign, createRedesignHarness, loginRedesign, writeRedesignEvidence, type RedesignHarness } from './redesign-harness.ts';
import { runMission } from '../examples/reference-app/src/world/mission.ts';
import { composeMission, missionTruthMarkers } from '../packages/local-world/src/index.ts';

let h: RedesignHarness;
const report: Record<string, unknown>[] = [];
test.beforeAll(async () => { h = await createRedesignHarness(); });
test.afterAll(async () => { writeRedesignEvidence('lp29-missions-verification.json', { scope: 'API-backed isolated synthetic server, Chromium headless SwiftShader; local runner in the test process.', cases: report }); await h?.close(); });

async function openDesk(page: Page) {
  await page.getByRole('button', { name: 'Integrations', exact: true }).click();
  await page.getByRole('tab', { name: 'Missions' }).click();
  await expect(page.getByTestId('mission-desk')).toBeVisible();
}

test('LP29-A1..A4: compose, preview, create, run locally, reopen, keep invalid drafts, taint on opening truth', async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, h);
  try {
    await openDesk(page);
    await expect(page.getByTestId('local-only-badge').first()).toContainText('Local only');
    const builder = page.getByTestId('mission-builder');
    await builder.getByLabel('Start from reviewed blueprint').selectOption('saas-storefront');
    await expect(builder.getByRole('table', { name: 'Scenario steps' })).toBeVisible();
    await builder.getByLabel('Mission mode').selectOption('investigate');
    // finite authoring: add a step from the finite vocabulary (incomplete, so preview must refuse it), then remove it
    await builder.getByLabel('Add step from the finite action vocabulary').selectOption('agent_search');
    await expect(builder.getByRole('table', { name: 'Scenario steps' }).locator('tbody tr')).toHaveCount(3);
    await builder.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByTestId('mission-error')).toContainText('required for agent_search');
    await builder.getByRole('button', { name: 'Remove step 2' }).click();
    await expect(builder.getByRole('table', { name: 'Scenario steps' }).locator('tbody tr')).toHaveCount(2);
    // the mission file for the local runner downloads from the builder
    const [download] = await Promise.all([page.waitForEvent('download'), builder.getByRole('button', { name: 'Download mission file' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^mission-saas-storefront-[0-9a-f]{6}\.mission\.json$/);
    // A3: an invalid edit keeps the draft exactly and creates nothing
    const json = builder.getByLabel('Mission draft JSON');
    const good = await json.inputValue();
    const badDraft = JSON.parse(good); badDraft.scenario.steps[0].url = 'http://169.254.169.254/'; const bad = JSON.stringify(badDraft, null, 1);
    await json.fill(bad);
    await builder.getByRole('button', { name: 'Preview' }).click();
    await expect(page.getByTestId('mission-error')).toContainText('unknown field');
    await expect(page.getByTestId('mission-error')).toContainText('Nothing was created and nothing is connected');
    expect(await json.inputValue()).toBe(bad);
    await expect(builder.getByRole('button', { name: 'Create mission' })).toBeDisabled();
    expect((await h.api('GET', '/api/local-missions')).json.missions).toHaveLength(0);
    await captureRedesign(page, 'lp29-builder-invalid-draft-kept');
    await json.fill(good);
    await builder.getByRole('button', { name: 'Preview' }).click();
    const preview = page.getByTestId('mission-preview');
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('table', { name: 'Budget preview' })).toContainText('2 of 400 allowed');
    await preview.scrollIntoViewIfNeeded();
    await captureRedesign(page, 'lp29-builder-preview');
    await builder.getByRole('button', { name: 'Create mission' }).click();
    // A2: after creation the desk switches to the investigator view, which carries no truth
    const inv = page.getByTestId('mission-investigator');
    await expect(inv).toBeVisible();
    await expect(page.getByTestId('mission-record')).toContainText('Blinded');
    await expect(page.getByTestId('mission-record')).toContainText('pnpm mission run');
    const draft = JSON.parse(good);
    const c = composeMission(draft); if (!c.ok) throw new Error('compose');
    const invText = await inv.innerText();
    for (const m of missionTruthMarkers(c.truth)) expect(invText.includes(m), `investigator view shows ${m}`).toBe(false);
    await captureRedesign(page, 'lp29-investigator-created');
    // run with the local runner (the same entry point as `pnpm mission run`), then reopen in the console
    const drain = () => { for (let i = 0; i < 200 && h.store.processBatch(200).processed; i++) { /* drain */ } };
    const run = await runMission(draft, { dk: { url: h.serverUrl, adminToken: h.adminToken }, missionId: draft.id, drain });
    await page.reload();
    await openDesk(page);
    await page.getByRole('radio', { name: 'Investigator', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`${c.brief.title}`) }).click();
    const runs = page.getByRole('table', { name: 'Mission runs' });
    await expect(runs).toContainText(run.run_id);
    await expect(runs).toContainText('complete');
    await expect(runs).toContainText('completed');
    await captureRedesign(page, 'lp29-investigator-reopened-run');
    // A2: opening truth is explicit and taints
    await page.getByText('Open builder truth (taints this mission)').click();
    await page.getByLabel('Reason for opening truth').fill('builder review after grading');
    await page.getByRole('button', { name: 'Mark non-blinded and open truth' }).click();
    await expect(page.getByTestId('mission-record')).toContainText('Non-blinded: truth was opened');
    await expect(runs).toContainText('no');
    await captureRedesign(page, 'lp29-investigator-truth-opened');
    // the builder draft survived the reload (session draft), and the investigator view stays distinct
    await page.getByRole('radio', { name: 'Builder', exact: true }).click();
    expect(JSON.parse(await page.getByLabel('Mission draft JSON').inputValue()).id).toBe(draft.id);
    // narrow screen
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('radio', { name: 'Investigator', exact: true }).click();
    await expect(page.getByTestId('mission-investigator')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await captureRedesign(page, 'lp29-investigator-390');
    report.push({ case: 'mission desk lifecycle', mission: draft.id, run: run.run_id, run_status: run.status, invalid_draft_kept: true, investigator_truth_markers_absent: true, truth_opened_taints: true, narrow_390_horizontal_overflow_px: overflow, result: 'passed' });
    expect(overflow).toBeLessThanOrEqual(1);
  } finally { await context.close(); }
});
