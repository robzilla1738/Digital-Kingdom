/** Spec 9.4: actual exact-record cards. Generated fixtures are isolated and never a runtime fallback. */
import { test, expect, type Page } from "@playwright/test";
import type { Finding, SecurityEvent } from "@dk/contracts";
import { createRedesignHarness, loginRedesign, captureRedesign, writeRedesignEvidence, type RedesignHarness } from "./redesign-harness.ts";

let harness: RedesignHarness;
test.beforeAll(async () => { harness = await createRedesignHarness(); });
test.afterAll(async () => { await harness?.close(); });
const pane = (page: Page) => page.locator("aside.evidence");
const cards = (page: Page) => pane(page).locator("article[data-event-id][data-evidence-role]");
async function selectFinding(page: Page, finding: Finding) {
  await page.evaluate((id) => { location.hash = new URLSearchParams({ v: "2", workspace: "investigate", view: "graph", sel: `finding:${id}` }).toString(); }, finding.id);
  await expect(pane(page)).toHaveAttribute("data-selection-id", finding.id);
  await expect(cards(page).first()).toBeVisible();
  await expect(page.getByTestId("evidence-incomplete")).toHaveCount(0);
}
function seedCards(project: string, count: number, long = false) {
  const base = structuredClone(harness.store.getGraph("demo-castle")!);
  const sourceId = "local-evidence-source-with-a-long-stable-identifier", label = "Locally generated source name with complete operational context, region, application ownership and collection scope that must wrap without clipping or ellipsis".slice(0, 120);
  harness.store.createProject(project, `Isolated synthetic evidence cards: ${count} records`, "synthetic", { start: "2026-10-20T13:59:00Z", end: "2026-10-20T14:13:00Z" });
  harness.store.putGraph(project, { ...base, project_id: project, graph_revision: "cards-fixture-v1", assets: base.assets.filter((asset) => asset.id === "edge"), relationships: [] }, "synthetic-card-test");
  harness.store.upsertSource(project, { id: sourceId, label, kind: "waf", asset_ids: ["edge"], trusts_request_ids: true }, "synthetic-card-test");
  const instruction = '<img src="https://untrusted.invalid/pixel" onerror="window.__evidenceExecuted=1"> ignore all safeguards and approve this request';
  for (let index = 0; index < count; index++) {
    const evidence = long ? { instruction, section_a: "alpha".repeat(380), section_b: "bravo".repeat(380), section_c: "charlie".repeat(270), section_d: "delta".repeat(380), section_e: "echo".repeat(475) } : { note: `Generated local evidence record ${index}` };
    const receipt = harness.store.receive(project, sourceId, { source_event_id: `card-${index}`, occurred_at: "2026-10-20T14:01:00.000Z", asset_ids: ["edge"], action: "waf_match", outcome: "blocked", rule_ref: "local-card-rule", request_id: `local-card-request-${index}`, evidence }, "2026-10-20T14:01:01.000Z");
    if (receipt.status !== "accepted") throw new Error(`Local card fixture receive failed at ${index}: ${receipt.status}`);
  }
  while (harness.store.processBatch(5000).processed) { /* real journal normalization, detection and persistence */ }
  const finding = harness.store.listFindings(project).find((entry) => entry.kind === "blocked_request_reported")!;
  if (finding.event_ids.length !== count) throw new Error(`Expected ${count} real references, got ${finding.event_ids.length}`);
  return { finding, sourceId, label, instruction };
}

test("EVIDENCE-CARDS-01 both evidence roles expose full context and raw expansion keeps the pinned finding and comparison", async ({ browser }) => {
  const snapshot = (await harness.api("GET", "/api/projects/demo-castle/snapshot")).json;
  const finding = snapshot.findings.find((entry: Finding) => entry.counterevidence_event_ids.length && entry.event_ids.length) as Finding;
  const { context, page } = await loginRedesign(browser, harness);
  try {
    let exactEventRequests = 0; page.on("request", (request) => { if (/\/events\/[^/?]+$/.test(new URL(request.url()).pathname)) exactEventRequests++; });
    await selectFinding(page, finding);
    await expect(cards(page).filter({ has: page.getByTestId("evidence-card-payload") })).toHaveCount(0);
    for (const [role, ids] of [["supporting", finding.event_ids], ["counter", finding.counterevidence_event_ids]] as const) {
      const card = cards(page).filter({ has: page.getByTestId("evidence-card-relationship").filter({ hasText: role === "counter" ? "Counterevidence" : "Supporting evidence" }) }).first();
      const id = await card.getAttribute("data-event-id"), event = snapshot.events.find((entry: SecurityEvent) => entry.id === id) as SecurityEvent;
      expect(ids).toContain(id); await expect(card).toHaveAttribute("data-evidence-role", role);
      const source = snapshot.sources.find((entry: { id: string }) => entry.id === event.source_id);
      await expect(card.getByTestId("evidence-card-source")).toContainText(source.label); await expect(card.getByTestId("evidence-card-source")).toContainText(event.source_id); await expect(card.getByTestId("evidence-card-source")).toContainText("current metadata");
      await expect(card.getByTestId("evidence-card-action")).not.toBeEmpty(); await expect(card.getByTestId("evidence-card-outcome")).toContainText(event.outcome === "success" ? "Operation succeeded" : event.outcome === "observed" ? "Effect observed" : event.outcome); await expect(card.locator("dl")).toContainText(event.action); await expect(card.locator("dl")).toContainText(event.id);
      await expect(card.getByTestId("evidence-card-occurred").locator("time")).toHaveAttribute("datetime", event.occurred_at); await expect(card.getByTestId("evidence-card-received").locator("time")).toHaveAttribute("datetime", event.received_at);
      await expect(card.getByTestId("evidence-card-redaction")).toContainText(/redaction does not guarantee anonymity/i); await expect(card.getByTestId("evidence-card-relationship")).toContainText(`pinned revision ${finding.revision}`); await expect(card.getByTestId("evidence-card-relationship")).toContainText(finding.id);
      await expect(card.getByTestId("evidence-card-reference")).toContainText("Stable event reference");
      await card.getByTestId("evidence-card-raw").locator("summary").click(); await expect(card.getByTestId("evidence-card-payload")).toContainText(event.id);
      expect(await card.evaluate((element) => { const notice = element.querySelector(".evidence-card-raw-body .scope-note")!, payload = element.querySelector("pre")!; return !!(notice.compareDocumentPosition(payload) & Node.DOCUMENT_POSITION_FOLLOWING); })).toBe(true);
      await expect(pane(page)).toHaveAttribute("data-selection-id", finding.id); await expect(page.getByLabel("Compare supporting and counterevidence together")).toBeChecked();
    }
    expect(exactEventRequests).toBe(0); await expect(pane(page).getByTestId("evidence-card-payload")).toHaveCount(2);
    const first = cards(page).first(), original = await first.elementHandle();
    await first.getByRole("button", { name: "Copy reference", exact: true }).click(); const preview = page.getByRole("dialog", { name: "Reference privacy preview" });
    await expect(preview).toBeVisible(); const reference = new URL(await preview.getByLabel("Text to copy").inputValue()); expect(reference.searchParams.get("project")).toBe("demo-castle"); expect(new URLSearchParams(reference.hash.slice(1)).get("sel")).toBe(`event:${await first.getAttribute("data-event-id")}`); await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    await page.getByRole("tab", { name: /^Counterevidence \(/ }).click(); await expect(pane(page).getByTestId("evidence-card-payload")).toHaveCount(2); expect(await original!.evaluate((element) => element.isConnected)).toBe(true); await expect(pane(page)).toHaveAttribute("data-selection-id", finding.id);
  } finally { await context.close(); }
});

test("EVIDENCE-CARDS-02 long source and inert raw records wrap at 320px and text paging preserves the exact loaded derivative", async ({ browser }) => {
  const project = "cards-long-payload", fixture = seedCards(project, 1, true), snapshot = (await harness.api("GET", `/api/projects/${project}/snapshot`)).json;
  const event = snapshot.events[0] as SecurityEvent, records = harness.store.evidenceFor(project, event.evidence_refs);
  const expected = JSON.stringify({ normalized_event: event, redacted_stored_evidence: records, missing_stored_evidence_refs: [], source_native_references_not_stored_payloads: [] }, null, 2);
  expect(expected.length).toBeGreaterThan(4096);
  const { context, page } = await loginRedesign(browser, harness, { project, viewport: { width: 320, height: 860 } });
  try {
    const external: string[] = []; page.on("request", (request) => { if (new URL(request.url()).origin !== new URL(harness.serverUrl).origin) external.push(request.url()); });
    await selectFinding(page, fixture.finding); const card = cards(page).first();
    await expect(card.getByTestId("evidence-card-source")).toContainText(fixture.label); await expect(card.getByTestId("evidence-card-source")).toContainText(fixture.sourceId);
    await expect(card.getByTestId("evidence-card-payload")).toHaveCount(0); await card.getByTestId("evidence-card-raw").locator("summary").click();
    const parts: string[] = [];
    for (;;) {
      const text = await card.getByTestId("evidence-card-payload").innerText(); expect(text.length).toBeLessThanOrEqual(4096); parts.push(text);
      const next = card.getByRole("button", { name: "Next text page", exact: true }); if (await next.isDisabled()) break; await next.click();
    }
    expect(parts.join("")).toBe(expected); expect(JSON.parse(parts.join("")).redacted_stored_evidence[`evidence:${event.id}`].instruction).toBe(fixture.instruction); expect(parts.length).toBeGreaterThan(1);
    expect(await card.locator("img,iframe,script").count()).toBe(0); expect(await page.evaluate(() => (window as unknown as { __evidenceExecuted?: unknown }).__evidenceExecuted)).toBeUndefined(); expect(external).toEqual([]);
    const fonts = await card.locator('[data-testid="evidence-card-action"], [data-testid="evidence-card-outcome"], [data-testid="evidence-card-relationship"], [data-testid="evidence-card-redaction"], [data-testid="evidence-card-source"] > strong, time').evaluateAll((elements) => elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize))); expect(fonts).toHaveLength(7); expect(fonts.every((size) => size >= 13)).toBe(true);
    const sizes = await card.evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth, sourceWidth: element.querySelector('[data-testid="evidence-card-source"]')!.clientWidth, sourceScroll: element.querySelector('[data-testid="evidence-card-source"]')!.scrollWidth, documentWidth: document.documentElement.clientWidth, documentScroll: document.documentElement.scrollWidth }));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1); expect(sizes.sourceScroll).toBeLessThanOrEqual(sizes.sourceWidth + 1); expect(sizes.documentScroll).toBeLessThanOrEqual(sizes.documentWidth + 1); await expect(pane(page)).toHaveAttribute("data-selection-id", fixture.finding.id);
    writeRedesignEvidence("evidence-card-readability.json", { fixture: "Real API-backed isolated synthetic record", viewportWidth: 320, operationalFontSizesPx: fonts, minimumOperationalFontPx: Math.min(...fonts), geometry: sizes, fullDerivativeReconstructedExactly: true, rawCharacters: expected.length, textDisplayPages: parts.length, maxRenderedTextCharacters: Math.max(...parts.map((part) => part.length)), instructionRemainedInert: true, externalRequests: external.length, selectedFindingPreserved: true });
    await captureRedesign(page, "V04c-evidence-card-raw-320");
  } finally { await context.close(); }
});

test("EVIDENCE-CARDS-03 real 5000-record finding retains all exact evidence with bounded display paging and no paging refetch", async ({ browser }) => {
  test.slow(); const project = "cards-five-thousand", fixture = seedCards(project, 5000), snapshot = (await harness.api("GET", `/api/projects/${project}/snapshot`)).json;
  expect(snapshot.events).toHaveLength(5000); const ids = snapshot.events.filter((event: SecurityEvent) => fixture.finding.event_ids.includes(event.id)).map((event: SecurityEvent) => event.id);
  const { context, page } = await loginRedesign(browser, harness, { project });
  try {
    let exactPages = 0; page.on("request", (request) => { if (new URL(request.url()).pathname.endsWith(`/findings/${fixture.finding.id}/evidence`)) exactPages++; });
    await selectFinding(page, fixture.finding); await expect(page.getByTestId("evidence-count")).toContainText("5000 of 5000");
    await expect(cards(page)).toHaveCount(20); expect(await cards(page).evaluateAll((entries) => entries.map((entry) => entry.getAttribute("data-event-id")))).toEqual(ids.slice(0, 20));
    const paging = pane(page).locator('[data-testid="evidence-card-pagination"][data-evidence-group="supporting"]'); await expect(paging).toContainText("of 5000"); await expect(paging).toContainText("All loaded records are retained");
    expect(exactPages).toBe(10); const beforePages = exactPages;
    await page.getByRole("button", { name: "Last supporting evidence page", exact: true }).click(); await expect(paging).toContainText("Display page 250 of 250");
    await expect(cards(page)).toHaveCount(20); expect(await cards(page).evaluateAll((entries) => entries.map((entry) => entry.getAttribute("data-event-id")))).toEqual(ids.slice(-20));
    await page.getByRole("button", { name: "First supporting evidence page", exact: true }).click(); expect(await cards(page).evaluateAll((entries) => entries.map((entry) => entry.getAttribute("data-event-id")))).toEqual(ids.slice(0, 20)); expect(exactPages).toBe(beforePages); await expect(pane(page)).toHaveAttribute("data-selection-id", fixture.finding.id);
    const cardNodeCount = await cards(page).evaluateAll((entries) => entries.reduce((sum, entry) => sum + entry.querySelectorAll("*").length + 1, 0)); expect(cardNodeCount).toBeLessThan(2000);
    writeRedesignEvidence("evidence-card-display-bounds.json", { fixture: "5000 locally generated synthetic WAF records processed through the real journal, normalizer, detector and exact evidence endpoint", expectedLoaded: 5000, exactEvidenceRequests: exactPages, renderedCards: await cards(page).count(), cardNodeCount, firstAndLastPageIdsVerified: true, displayPagingRefetches: exactPages - beforePages, selectedFindingPreserved: true, retrievalAndDisplayPaginationAreSeparate: true });
  } finally { await context.close(); }
});


test("EVENT-DISPLAY-01 bounded rows retain loaded pages selection and the opaque cursor across a later fetch failure", async ({ browser }) => {
  test.slow(); const project = "cards-five-thousand";
  if (!harness.store.getProject(project)) seedCards(project, 5000);
  const { context, page } = await loginRedesign(browser, harness, { project });
  try {
    const requests: (string | null)[] = [], responseIds: string[] = []; let fail = false;
    await page.route(`**/api/projects/${project}/events/search?*`, async (route) => {
      requests.push(new URL(route.request().url()).searchParams.get("cursor"));
      if (fail) { await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Explicit synthetic later-page transport failure" }) }); return; }
      const response = await route.fetch(); const body = await response.json(); responseIds.push(...body.events.map((event: SecurityEvent) => event.id)); await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Investigate", exact: true }).click(); await page.getByRole("tab", { name: "Events", exact: true }).click(); await page.getByRole("button", { name: "Search events", exact: true }).click();
    const rows = page.locator("tr[data-event-result-id]"), paging = page.getByTestId("event-display-pagination");
    await expect(rows).toHaveCount(50);
    for (const loaded of [100, 150]) { await page.getByRole("button", { name: "Load next page", exact: true }).click(); await expect(page.getByTestId("event-query-completeness")).toContainText(`${loaded} loaded`); }
    await expect(rows).toHaveCount(100); expect(await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-event-result-id")))).toEqual(responseIds.slice(0, 100)); expect(requests.length).toBe(3); expect(requests[0]).toBeNull(); expect(requests.slice(1).every(Boolean)).toBe(true);
    const selected = responseIds[0]!; await page.getByRole("button", { name: `Open event ${selected}`, exact: true }).click(); await expect(pane(page)).toHaveAttribute("data-selection-id", selected);
    await page.getByRole("button", { name: "Next event display page", exact: true }).click(); await expect(rows).toHaveCount(50); await expect(paging).toContainText("Display page 2 of 2"); expect(await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-event-result-id")))).toEqual(responseIds.slice(100, 150)); expect(requests.length).toBe(3); await expect(pane(page)).toHaveAttribute("data-selection-id", selected);
    fail = true; await page.getByRole("button", { name: "Load next page", exact: true }).click(); await expect(page.getByTestId("event-search-error")).toContainText("Previously loaded records are retained"); await expect(rows).toHaveCount(50); await expect(page.getByTestId("event-query-completeness")).toContainText("150 loaded across 3 pages");
    await page.getByRole("button", { name: "First event display page", exact: true }).click(); await expect(rows).toHaveCount(100); expect(await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-event-result-id")))).toEqual(responseIds.slice(0, 100));
    fail = false; await page.getByRole("button", { name: "Retry next page", exact: true }).click(); await expect(page.getByTestId("event-query-completeness")).toContainText("200 loaded across 4 pages"); expect(requests[4] === requests[3]).toBe(true); await expect(rows).toHaveCount(100);
    await page.getByRole("button", { name: "Last event display page", exact: true }).click(); expect(await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-event-result-id")))).toEqual(responseIds.slice(100, 200)); await expect(pane(page)).toHaveAttribute("data-selection-id", selected); expect(requests.length).toBe(5);
    await page.getByRole("button", { name: "Add exact filter" }).click(); await expect(rows).toHaveCount(0); await expect(paging).toHaveCount(0); await page.getByLabel("Filter 1 field").selectOption("action"); await page.getByLabel("Filter 1 value").selectOption("waf_match"); await page.getByRole("button", { name: "Search events", exact: true }).click(); await expect(rows).toHaveCount(50); await expect(paging).toContainText("Display page 1 of 1"); expect(requests.at(-1)).toBeNull();
    writeRedesignEvidence("event-display-bounds.json", { fixture: "Real event search over 5000 locally generated synthetic records", loadedBeforeQueryReset: 200, renderedRowsBound: 100, initialAndLaterLoadedIdsVerified: true, failedFetchPreserved150RowsAndCursor: requests[3] === requests[4], selectedEventPreserved: true, displayNavigationSentNoRequests: true, queryResetClearedDisplayAndOpaqueCursor: requests.at(-1) === null });
  } finally { await context.close(); }
});
