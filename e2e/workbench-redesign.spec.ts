/**
 * LP12 investigation workbench in the real console (isolated synthetic server, fresh in-memory DB, seeded demo
 * project; Chromium headless with software WebGL requested — no GPU claim). The case data is created through the
 * same HTTP API the console uses; the agent proposal is stored by a service-principal token.
 */
import { test, expect, type Page } from '@playwright/test';
import type { Finding } from '@dk/contracts';
import { createRedesignHarness, loginRedesign, captureRedesign, writeRedesignEvidence, type RedesignHarness } from './redesign-harness.ts';

let harness: RedesignHarness;
let caseA: { id: string; title: string }, caseB: { id: string; title: string };
let question: string, note: string;
const reports: Record<string, unknown>[] = [];
const P = '/api/projects/demo-castle';

test.beforeAll(async () => {
  harness = await createRedesignHarness();
  const findings: Finding[] = (await harness.api('GET', `${P}/findings`)).json;
  const target = findings.find((f) => f.counterevidence_event_ids.length > 0)!;
  expect(target).toBeTruthy();
  const assets = new Set<string>();
  for (const id of [...target.event_ids, ...target.counterevidence_event_ids]) { const e = await harness.api('GET', `${P}/events/${encodeURIComponent(id)}`); for (const a of (e.json.event?.asset_ids ?? e.json.asset_ids ?? []) as string[]) assets.add(a); }
  expect(assets.size).toBeGreaterThan(0);
  const scope = { question: 'Did the blocked request still reach data?', asset_ids: [...assets], after: '2026-10-20T13:55:00Z', before: '2026-10-20T14:20:00Z' };
  const a = await harness.api('POST', `${P}/cases`, { title: 'Workbench A: contradicted block', scope, closure_criteria: 'Every obligation resolved or documented' });
  expect(a.status, JSON.stringify(a.json)).toBe(200);
  caseA = a.json;
  let v = a.json.version;
  const add = async (payload: Record<string, unknown>) => { const r = await harness.api('POST', `${P}/cases/${caseA.id}/items`, { ...payload, expected_version: v }); expect(r.status, JSON.stringify(r.json)).toBe(200); v = r.json.version; return r.json; };
  await add({ kind: 'finding', ref: target.id });
  question = 'Which identity issued the database read?';
  note = "Analyst note: keep the export job's schedule in mind.";
  await add({ kind: 'question', text: question });
  await add({ kind: 'hypothesis', text: 'The block was enforced and the read is unrelated.' });
  await add({ kind: 'hypothesis', text: 'The block was reported but the request still reached the database.' });
  await add({ kind: 'note', text: note });
  const contract = await harness.api('POST', `${P}/cases/${caseA.id}/contract`);
  expect(contract.status, JSON.stringify(contract.json)).toBe(200);
  const job = await harness.api('POST', `${P}/cases/${caseA.id}/jobs`, { budget: { max_units: 3, page_limit: 5 } });
  expect(job.status, JSON.stringify(job.json)).toBe(200);
  for (let i = 0; i < 5; i++) { const r = await harness.api('POST', `${P}/jobs/${job.json.id}/advance`, { max_units: 3 }); if (!['queued', 'running'].includes(r.json.job?.status)) break; }
  const agent = harness.store.createToken('Synthetic agent', 'analyst', ['demo-castle'], undefined, 'service').token;
  const current = (await harness.api('GET', `${P}/cases/${caseA.id}/contract`)).json.contract;
  const proposal = await harness.api('POST', `${P}/cases/${caseA.id}/conclusions`, { schema: 'dk.local.conclusion.v1', case_id: caseA.id, run_id: current.run_id, contract_revision: current.revision, status: 'draft', semantic_review: 'not_reviewed', scope_note: 'agent draft', requested_next_step: 'retrieve_more',
    claims: [{ id: 'c1', type: 'unresolved', text: 'Agent draft: the question is answered — it was the export job.', evidence_refs: [], coverage_refs: [], obligation_ids: [], uncertainty: 'identity telemetry incomplete' }] }, agent);
  expect(proposal.status, JSON.stringify(proposal.json)).toBe(200);
  const b = await harness.api('POST', `${P}/cases`, { title: 'Workbench B: no contract yet', scope: { question: 'Was the scheduler involved?', asset_ids: ['sched'] }, closure_criteria: 'Reviewed' });
  expect(b.status).toBe(200);
  caseB = b.json;
});
test.afterAll(async () => { writeRedesignEvidence('workbench-verification.json', reports); await harness?.close(); });

async function openCases(page: Page, keyboard = false) {
  const activate = async (loc: ReturnType<Page['getByRole']>) => { if (keyboard) { await loc.focus(); await page.keyboard.press('Enter'); } else await loc.click(); };
  await activate(page.getByRole('button', { name: 'Investigate', exact: true }));
  await activate(page.getByRole('tab', { name: 'Cases', exact: true }));
  await expect(page.getByLabel('Cases workspace')).toBeVisible();
  return activate;
}
const caseButton = (page: Page, title: string) => page.getByLabel('Case list').getByRole('button', { name: title, exact: true });
const criticalList = (page: Page) => page.getByTestId('wb-critical').locator('li').allInnerTexts();

test('LP12-A1: changing cases aborts stale reads and keeps each unsaved draft in its own case', async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await openCases(page);
    await caseButton(page, caseA.title).click();
    const detail = page.getByTestId('case-detail');
    await expect(detail).toContainText(caseA.title);
    await page.getByLabel('Case item text').fill('Unsaved draft for case A');
    // slow every read for case A from here on
    let delay = true; const aborted: string[] = []; const late: string[] = [];
    await page.route(new RegExp(`/cases/${caseA.id}(/workbench)?$`), async (route) => {
      if (route.request().method() !== 'GET' || !delay) return route.continue();
      await new Promise((r) => setTimeout(r, 2500));
      try { await route.continue(); late.push(route.request().url()); } catch { /* the page aborted it */ }
    });
    page.on('requestfailed', (r) => { if (r.url().includes(`/cases/${caseA.id}`)) aborted.push(`${new URL(r.url()).pathname} ${r.failure()?.errorText}`); });
    await caseButton(page, caseB.title).click();
    await expect(detail).toContainText(caseB.title);
    await expect(page.getByLabel('Case item text')).toHaveValue('');
    await page.getByLabel('Case item text').fill('Unsaved draft for case B');
    // start a slow load of A and switch back to B before it answers
    await caseButton(page, caseA.title).click();
    await caseButton(page, caseB.title).click();
    await expect(detail).toContainText(caseB.title);
    await page.waitForTimeout(3200);
    await expect(detail).toContainText(caseB.title);
    await expect(detail).not.toContainText(caseA.title);
    await expect(page.getByTestId('case-workbench')).not.toContainText('Workbench A');
    await expect(page.getByTestId('wb-readiness')).toHaveText('No contract');
    await expect(page.getByLabel('Case item text')).toHaveValue('Unsaved draft for case B');
    expect(aborted.length, 'the stale reads for case A were aborted by the browser').toBeGreaterThan(0);
    delay = false;
    await caseButton(page, caseA.title).click();
    await expect(detail).toContainText(caseA.title);
    await expect(page.getByLabel('Case item text')).toHaveValue('Unsaved draft for case A');
    await expect(page.getByTestId('case-drafts')).toContainText('item text');
    await expect(page.getByLabel('Case list')).toContainText('unsaved draft');
    await captureRedesign(page, 'lp12-workbench-draft-scope');
    reports.push({ test: 'LP12-A1', aborted, late_responses_rendered: false, drafts: { A: 'restored', B: 'restored' } });
  } finally { await context.close(); }
});

test('LP12-A2/A3: evidence, counterevidence, failed queries and uncertainty without the camera; agent proposal stays a draft', async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await openCases(page);
    await caseButton(page, caseA.title).click();
    const wb = page.getByTestId('case-workbench');
    await expect(wb.getByTestId('wb-readiness')).toBeVisible();
    // counterevidence first, readable in place
    const counter = wb.getByTestId('wb-counter').locator('li');
    expect(await counter.count()).toBeGreaterThan(0);
    const first = counter.first();
    await first.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(first).toContainText('Digest');
    await expect(first).toContainText('Obligations');
    await expect(wb.getByTestId('wb-supporting')).toBeVisible();
    await expect(wb.getByTestId('wb-failed')).toBeVisible();
    await expect(wb.getByTestId('wb-uncertainty')).toContainText('absence claim');
    await expect(wb.getByTestId('wb-obligations')).toBeVisible();
    await expect(wb.getByTestId('wb-hypotheses').locator('li')).toHaveCount(2);
    await expect(wb.getByTestId('wb-summary')).toContainText('What it does not support');
    // the agent's proposal is a versioned draft; the person's question and note are untouched
    const proposals = wb.getByTestId('wb-proposals');
    await expect(proposals).toContainText('Proposal v1');
    await expect(proposals).toContainText('agent Synthetic agent');
    await expect(proposals).toContainText('not accepted');
    const detail = page.getByTestId('case-detail');
    await expect(detail.locator('li', { hasText: question })).toContainText('(open)');
    await expect(detail).toContainText(note);
    await expect(wb.getByTestId('wb-next')).toContainText('a person decides');
    await wb.getByTestId('wb-counter').scrollIntoViewIfNeeded();
    await captureRedesign(page, 'lp12-workbench-desktop');
    // shared anchor: a record selects its castle object, and the castle selection filters the workbench
    const ref = (await first.locator('code').first().innerText()).trim();
    await first.getByRole('button', { name: 'Show in castle', exact: true }).click();
    await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('sel'))).toBe(`event:${ref}`);
    await expect.poll(() => page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get('workspace'))).toBe('kingdom');
    await openCases(page);
    await caseButton(page, caseA.title).click().catch(() => undefined);
    await expect(page.getByTestId('wb-anchor')).toContainText(`event:${ref}`);
    await expect(page.getByTestId('wb-anchor')).toContainText('1 case record(s) anchored here');
    await page.getByTestId('wb-anchor').scrollIntoViewIfNeeded();
    await captureRedesign(page, 'lp12-workbench-castle-anchor');
    reports.push({ test: 'LP12-A2/A3', counter_records: await counter.count(), anchor: `event:${ref}`, proposal: 'v1 not accepted', question_status: 'open' });
  } finally { await context.close(); }
});

test('LP12-A4: keyboard, reduced-motion and narrow-screen workflows show the same critical evidence and status', async ({ browser }) => {
  const baseline = await loginRedesign(browser, harness);
  let expected: string[], expectedCounter: string[];
  try {
    await openCases(baseline.page);
    await caseButton(baseline.page, caseA.title).click();
    await expect(baseline.page.getByTestId('wb-critical')).toBeVisible();
    expected = await criticalList(baseline.page);
    expectedCounter = await baseline.page.getByTestId('wb-counter').locator('li summary code').allInnerTexts();
    expect(expected.some((s) => s.startsWith('Counter records:'))).toBe(true);
  } finally { await baseline.context.close(); }
  const variants: { name: string; viewport?: { width: number; height: number }; reduced?: boolean; keyboard?: boolean }[] = [
    { name: 'keyboard', keyboard: true },
    { name: 'reduced-motion', reduced: true },
    { name: 'narrow-390', viewport: { width: 390, height: 844 } },
  ];
  for (const v of variants) {
    const { context, page } = await loginRedesign(browser, harness, v.viewport ? { viewport: v.viewport } : {});
    try {
      if (v.reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
      const activate = await openCases(page, v.keyboard);
      await activate(caseButton(page, caseA.title) as never);
      const wb = page.getByTestId('case-workbench');
      await expect(wb.getByTestId('wb-critical')).toBeVisible();
      expect(await criticalList(page), `${v.name}: critical status`).toEqual(expected);
      expect(await wb.getByTestId('wb-counter').locator('li summary code').allInnerTexts(), `${v.name}: counterevidence`).toEqual(expectedCounter);
      await expect(wb.getByTestId('wb-failed')).toBeVisible();
      await expect(wb.getByTestId('wb-proposals')).toContainText('not accepted');
      if (v.keyboard) {
        const summary = wb.getByTestId('wb-counter').locator('summary').first();
        await summary.focus(); await page.keyboard.press('Enter');
        await expect(wb.getByTestId('wb-counter').locator('li').first()).toContainText('Digest');
      }
      if (v.reduced) expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
      if (v.viewport) {
        const overflow = await wb.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(overflow, 'no horizontal overflow in the workbench at 390px').toBeLessThanOrEqual(1);
        await wb.getByTestId('wb-critical').scrollIntoViewIfNeeded();
      }
      await wb.getByTestId('wb-critical').scrollIntoViewIfNeeded();
      await captureRedesign(page, `lp12-workbench-${v.name}`);
      reports.push({ test: 'LP12-A4', variant: v.name, critical: await criticalList(page), counter: expectedCounter.length });
    } finally { await context.close(); }
  }
});
