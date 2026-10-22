/** Supplemental synthetic investigation checks. Fault routes are explicit, not production fallbacks. */
import { test, expect, type Page } from "@playwright/test";
import type { Finding, SecurityEvent } from "@dk/contracts";
import { createRedesignHarness, loginRedesign, offlineRedesign, captureRedesign, type RedesignHarness } from "./redesign-harness.ts";

let harness: RedesignHarness;
const project = "demo-castle", interval = "after=2026-10-20T13%3A59%3A00Z&before=2026-10-20T14%3A13%3A00Z";
let findings: Finding[], events: SecurityEvent[];
test.beforeAll(async () => { harness = await createRedesignHarness(); findings = (await harness.api("GET", `/api/projects/${project}/findings`)).json; events = (await harness.api("GET", `/api/projects/${project}/events/search?${interval}&limit=100`)).json.events; });
test.afterAll(async () => { await harness?.close(); });
async function openEvents(page: Page) { await page.getByRole("button", { name: "Investigate", exact: true }).click(); await page.getByRole("tab", { name: "Events", exact: true }).click(); await expect(page.getByTestId("event-workspace")).toBeVisible(); }
async function openFinding(page: Page, id: string) { await page.evaluate((findingId) => { location.hash = new URLSearchParams({ v: "2", workspace: "investigate", view: "graph", sel: `finding:${findingId}` }).toString(); }, id); await expect(page.locator("aside.evidence")).toHaveAttribute("data-selection-id", id); }
const pane = (page: Page) => page.locator("aside.evidence");

test("events require deliberate search; unlinked exact detail has independent coverage and safe copy preview", async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness);
  try {
    let searches = 0; page.on("request", (request) => { if (new URL(request.url()).pathname.endsWith("/events/search")) searches++; });
    await openEvents(page); await page.getByRole("button", { name: "Add exact filter" }).click();
    await page.getByLabel("Filter 1 field").selectOption("client_ip"); await page.getByLabel("Filter 1 value").fill("198.51.100.44");
    await expect(page.getByTestId("event-workspace")).toContainText("Network locator, not identity"); expect(searches).toBe(0);
    await page.getByRole("button", { name: "Remove filter 1" }).click(); await page.getByRole("button", { name: "Search events", exact: true }).click();
    await expect(page.getByTestId("event-query-completeness")).toContainText("stored matches"); expect(searches).toBe(1);
    await expect(page.getByTestId("event-source-coverage")).toContainText("Historical coverage during this interval has not been assessed");
    const unlinked = events.find((event) => !findings.some((finding) => [...finding.event_ids, ...finding.counterevidence_event_ids].includes(event.id)));
    expect(unlinked, "canonical seed must include an event not referenced by any finding").toBeTruthy();
    await page.getByRole("button", { name: `Open event ${unlinked!.id}`, exact: true }).click();
    await expect(page.getByTestId("event-unlinked")).toContainText("Not referenced by a finding");
    await expect(pane(page)).toContainText(unlinked!.source_id); await expect(pane(page)).toContainText("Received");
    await page.getByRole("button", { name: "Copy search context" }).click();
    const dialog = page.getByRole("dialog", { name: "Search context privacy preview" }); await expect(dialog).toBeVisible();
    const copy = await dialog.getByLabel("Text to copy").inputValue(); expect(copy).not.toContain("198.51.100.44"); expect(copy).not.toContain(harness.adminToken); expect(copy).toContain("Values excluded");
    await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(page.getByRole("button", { name: "Copy search context" })).toBeFocused();
  } finally { await context.close(); }
});

test("real opaque pagination stays pinned, retains rows after failure, and discards cursor on filter change", async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness);
  try {
    const cursors: (string | null)[] = []; let failLater = true;
    await page.route("**/events/search?*", async (route) => {
      const url = new URL(route.request().url()); cursors.push(url.searchParams.get("cursor"));
      if (url.searchParams.has("cursor") && failLater) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic page-two outage" }) });
      url.searchParams.set("limit", "2"); await route.continue({ url: url.toString() });
    });
    await openEvents(page); await page.getByRole("button", { name: "Search events", exact: true }).click();
    await expect(page.locator("tr[data-event-result-id]")).toHaveCount(2);
    const initial = await page.locator("tr[data-event-result-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-event-result-id")));
    await page.getByRole("button", { name: "Load next page", exact: true }).click();
    await expect(page.getByTestId("event-search-error")).toContainText("Previously loaded records are retained"); await expect(page.locator("tr[data-event-result-id]")).toHaveCount(2);
    expect(await page.locator("tr[data-event-result-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-event-result-id")))).toEqual(initial);
    expect(cursors[0]).toBeNull(); expect(cursors[1]).toBeTruthy(); failLater = false;
    await page.getByRole("button", { name: "Retry next page", exact: true }).click(); await expect(page.locator("tr[data-event-result-id]")).toHaveCount(4);
    expect(cursors[2]).toBe(cursors[1]); // Cursor bytes are reused, never decoded or reconstructed.
    await page.getByRole("button", { name: "Add exact filter" }).click(); await page.getByLabel("Filter 1 field").selectOption("actor_ref"); await page.getByLabel("Filter 1 value").fill("synthetic-no-such-actor");
    await expect(page.locator("tr[data-event-result-id]")).toHaveCount(0); await expect(page.getByRole("button", { name: "Load next page", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Search events", exact: true }).click(); await expect(page.getByTestId("event-search-empty")).toContainText("Activity outside reporting sources may be missing"); expect(cursors.at(-1)).toBeNull();
  } finally { await context.close(); }
});

test("event interval validation rejects more than31days before network and source-local namespace stays explicit", async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness);
  try {
    let searches = 0; page.on("request", (request) => { if (new URL(request.url()).pathname.endsWith("/events/search")) searches++; });
    await openEvents(page); await page.getByLabel("Event start time").fill("2026-09-01T00:00"); await page.getByLabel("Event end time").fill("2026-10-20T14:13");
    await page.getByRole("button", { name: "Search events", exact: true }).click(); await expect(page.getByTestId("event-search-error")).toContainText("31 days"); expect(searches).toBe(0);
    await page.getByRole("button", { name: "Add exact filter" }).click(); await page.getByLabel("Filter 1 field").selectOption("session_ref"); await expect(page.getByTestId("event-workspace")).toContainText("Source-local namespace");
  } finally { await context.close(); }
});

test("later finding-evidence page failure retains earlier exact records and marks aggregate incomplete", async ({ browser }) => {
  const target = findings.find((finding) => new Set([...finding.event_ids, ...finding.counterevidence_event_ids]).size > 1)!;
  const refs = new Set([...target.event_ids, ...target.counterevidence_event_ids]);
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await page.route(`**/api/projects/${project}/snapshot`, async (route) => { const response = await route.fetch(); const json = await response.json(); json.events = json.events.filter((event: SecurityEvent) => !refs.has(event.id)); await route.fulfill({ response, json }); });
    await page.route(`**/findings/${encodeURIComponent(target.id)}/evidence?*`, async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("offset") !== "0") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic later evidence-page outage" }) });
      const response = await route.fetch(); const json = await response.json(); json.events = json.events.slice(0, 1); json.returned_event_count = 1; json.next_offset = 1; json.complete = false;
      await route.fulfill({ response, json });
    });
    await page.reload(); await expect(page.locator(".app")).toBeVisible(); await openFinding(page, target.id);
    await expect(page.getByTestId("evidence-incomplete")).toHaveAttribute("data-error", "true"); await expect(page.getByTestId("evidence-incomplete")).toContainText("Could not load");
    await expect(pane(page).locator("[data-event-id]")).toHaveCount(1); await expect(page.getByTestId("evidence-count")).toContainText(`1 of ${refs.size}`);
    await page.getByTestId("evidence-incomplete").scrollIntoViewIfNeeded(); await captureRedesign(page, "V13-evidence-partial-retained");
  } finally { await context.close(); }
});

test("slow finding A evidence cannot appear in selected finding B and replay does not refetch the pinned record", async ({ browser }) => {
  const a = findings.find((finding) => finding.event_ids.length > 1)!, b = findings.find((finding) => finding.id !== a.id && !finding.event_ids.some((id) => a.event_ids.includes(id)))!;
  const { context, page } = await loginRedesign(browser, harness);
  let release = () => {}; const gate = new Promise<void>((resolve) => { release = resolve; }); let requestedA = false;
  try {
    await page.route(`**/findings/${encodeURIComponent(a.id)}/evidence?*`, async (route) => { requestedA = true; await gate; await route.continue().catch(() => {}); });
    let evidenceB = 0; page.on("request", (request) => { if (request.url().includes(`/findings/${encodeURIComponent(b.id)}/evidence?`)) evidenceB++; });
    await openFinding(page, a.id); await expect.poll(() => requestedA).toBe(true);
    await openFinding(page, b.id); await expect(pane(page).getByRole("heading", { name: b.title, exact: true })).toBeVisible();
    await expect(page.getByTestId("evidence-incomplete")).toHaveCount(0); release();
    expect(await pane(page).locator('[data-evidence-role="supporting"]').evaluateAll((rows) => rows.map((row) => row.getAttribute("data-event-id")))).toEqual(expect.arrayContaining(b.event_ids));
    for (const id of a.event_ids.filter((id) => !b.event_ids.includes(id) && !b.counterevidence_event_ids.includes(id))) await expect(pane(page).locator(`[data-event-id="${id}"]`)).toHaveCount(0);
    const before = evidenceB;
    await page.evaluate((findingId) => { location.hash = new URLSearchParams({ workspace: "investigate", view: "graph", sel: `finding:${findingId}`, t: "2026-10-20T14:00:00Z", basis: "known" }).toString(); }, b.id);
    await expect(pane(page)).toContainText("Evidence comparison is pinned"); expect(evidenceB).toBe(before);
  } finally { release(); await context.close(); }
});

test("viewer sees evidence but no mutation/export controls; denial clears all displayed sensitive records", async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness, { role: "viewer" });
  try {
    await openFinding(page, findings[0]!.id); await expect(page.getByTestId("evidence-incomplete")).toHaveCount(0);
    await expect(pane(page).getByRole("button", { name: "Save review", exact: true })).toHaveCount(0); await expect(pane(page).getByRole("button", { name: "Propose containment…", exact: true })).toHaveCount(0); await expect(pane(page).getByRole("button", { name: "Export case", exact: true })).toHaveCount(0);
    await openEvents(page); await page.getByRole("button", { name: "Search events", exact: true }).click(); await expect(page.locator("tr[data-event-result-id]").first()).toBeVisible();
    await page.route("**/events/search?*", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Synthetic project access revoked" }) }));
    await page.getByRole("button", { name: "Search events", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("Access denied");
    await expect(page.locator("tr[data-event-result-id]")).toHaveCount(0); await expect(page.locator("aside.evidence")).toHaveCount(0); await expect(page.locator(".app")).toHaveCount(0);
  } finally { await context.close(); }
});

test("late real ingestion announces newer records without replacing pinned finding revision or event snapshot", async ({ browser }) => {
  const target = (await harness.api("GET", `/api/projects/${project}/findings`)).json.find((finding: Finding) => finding.rule_id === "edge.blocked_request" && finding.event_ids.length > 1) as Finding;
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await openFinding(page, target.id); await expect(page.getByTestId("evidence-incomplete")).toHaveCount(0);
    await pane(page).getByLabel("Analyst note", { exact: true }).fill("Synthetic unsaved draft remains pinned");
    await openEvents(page); await page.getByRole("button", { name: "Search events", exact: true }).click(); await expect(page.locator("tr[data-event-result-id]").first()).toBeVisible();
    const priorRows = await page.locator("tr[data-event-result-id]").count(), priorSupport = await pane(page).locator('[data-evidence-role="supporting"]').count();
    // Supplemental synthetic delivery goes through the real journal, normalizer, detections and SSE.
    expect(harness.store.receive(project, "src-edge", { source_event_id: "redesign-late-blocked-event", occurred_at: "2026-10-20T14:01:19.000Z", asset_ids: ["edge"], action: "waf_match", outcome: "blocked", rule_ref: "sqli-942100", request_id: "redesign-late-request", route: "/synthetic-review", evidence: { note: "Supplemental synthetic late-arrival test; no production activity" } }, "2026-10-20T14:12:50.000Z").status).toBe("accepted");
    while (harness.store.processBatch(500).processed) { /* real ingestion only */ }
    await expect(page.getByTestId("finding-new-revision")).toContainText(`You are reading revision ${target.revision}`, { timeout: 15000 });
    await expect(page.getByTestId("new-event-records")).toContainText("Existing pages remain unchanged");
    await expect(page.locator("tr[data-event-result-id]")).toHaveCount(priorRows); await expect(pane(page).locator('[data-evidence-role="supporting"]')).toHaveCount(priorSupport);
    await expect(pane(page).getByRole("heading", { name: target.title, exact: true })).toBeVisible(); await expect(pane(page).getByLabel("Analyst note", { exact: true })).toHaveValue("Synthetic unsaved draft remains pinned");
    await page.getByRole("button", { name: "Kingdom", exact: true }).click(); await page.getByRole("button", { name: "Investigate", exact: true }).click(); await expect(pane(page).getByLabel("Analyst note", { exact: true })).toHaveValue("Synthetic unsaved draft remains pinned");
    const updated = (await harness.api("GET", `/api/projects/${project}/findings/${encodeURIComponent(target.id)}`)).json.finding as Finding; expect(updated.revision).toBeGreaterThan(target.revision);
    await page.getByRole("button", { name: `Refresh to revision ${updated.revision}`, exact: true }).click(); await expect(pane(page).getByRole("heading", { name: updated.title, exact: true })).toBeVisible(); await expect(page.getByTestId("evidence-incomplete")).toHaveCount(0);
    await page.getByRole("button", { name: "Search events", exact: true }).click(); await expect(page.locator("tr[data-event-result-id]")).toHaveCount(priorRows + 1);
  } finally { await context.close(); }
});

test("review failure preserves draft; server-confirmed lifecycle updates; proposals never execute and export requires scope review", async ({ browser }) => {
  const target = findings.find((finding) => finding.affected_asset_ids.includes("api")) ?? findings[0]!;
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await openFinding(page, target.id); await expect(page.getByTestId("evidence-incomplete")).toHaveCount(0);
    const reviewPath = `**/findings/${encodeURIComponent(target.id)}/disposition`;
    await page.route(reviewPath, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic review outage" }) }));
    await pane(page).getByLabel("Lifecycle", { exact: true }).selectOption("acknowledged"); await pane(page).getByLabel("Disposition", { exact: true }).selectOption("expected_test");
    const note = "Synthetic review note <img src=x onerror=alert(1)>"; await pane(page).getByLabel("Analyst note", { exact: true }).fill(note); await pane(page).getByRole("button", { name: "Save review", exact: true }).click();
    await expect(pane(page)).toContainText("Your draft is retained"); await expect(pane(page).getByLabel("Analyst note", { exact: true })).toHaveValue(note);
    await page.unroute(reviewPath); await pane(page).getByRole("button", { name: "Save review", exact: true }).click(); await expect(pane(page)).toContainText("Current lifecycle: acknowledged. Disposition: expected test."); await expect(pane(page).getByLabel("Analyst note", { exact: true })).toHaveValue("");
    await pane(page).getByRole("tab", { name: "Notes", exact: true }).click(); await expect(pane(page).getByRole("tabpanel", { name: "Notes" })).toContainText(note); await expect(pane(page).locator("img")).toHaveCount(0);
    await pane(page).getByRole("button", { name: "Propose containment…", exact: true }).click(); const action = pane(page).getByLabel("Proposed action"); await expect(action.locator("option").nth(1)).toBeAttached(); const actionId = await action.locator("option").nth(1).getAttribute("value"); await action.selectOption(actionId!);
    await expect(pane(page)).toContainText("Blast radius"); await pane(page).getByLabel("Proposal rationale").fill("Synthetic review-only test. No action authorized or executed."); await pane(page).getByRole("button", { name: "Create review proposal", exact: true }).click(); await expect(pane(page)).toContainText("pending proposal — no action executed.");
    const proposals = (await harness.api("GET", `/api/projects/${project}/containment`)).json.requests; expect(proposals.find((proposal: { finding_id: string }) => proposal.finding_id === target.id)?.status).toBe("pending");
    let exports = 0; page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/export")) exports++; }); await pane(page).getByRole("button", { name: "Export case", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "Case export scope" }); await expect(preview).toContainText("current server revision"); await expect(preview).toContainText("Redaction is not anonymity"); expect(exports).toBe(0);
    const download = page.waitForEvent("download"); await preview.getByRole("button", { name: "Download case export", exact: true }).click(); expect((await download).suggestedFilename()).toContain(target.id); expect(exports).toBe(1); await expect(preview).toContainText("Export requested successfully");
    await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    // Isolated synthetic second human principal exercises the real separation-of-duties decision API.
    // This is a test approval only, never a claim of real human approval or an execution path.
    const proposal = proposals.find((item: { finding_id: string }) => item.finding_id === target.id);
    const reviewer = harness.store.createToken("Synthetic separate proposal reviewer", "admin", [project]).token;
    const decision = await harness.api("POST", `/api/projects/${project}/containment/${encodeURIComponent(proposal.id)}/decision`, { decision: "approved" }, reviewer); expect(decision.status).toBe(200);
    await page.getByRole("button", { name: "Close evidence pane", exact: true }).click(); await openFinding(page, target.id);
    await expect(pane(page)).toContainText("Approved proposal — no action executed.");
    await expect(pane(page).getByRole("button", { name: /^Execute/ })).toHaveCount(0);
  } finally { await context.close(); }
});

test("authoritative422 import paths are displayed after successful local preview; draft and graph remain unchanged", async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness);
  try {
    const previousGraph = (await harness.api("GET", `/api/projects/${project}/snapshot`)).json.graph;
    await page.getByRole("button", { name: "Integrations", exact: true }).click(); await page.getByLabel("Supported format").selectOption("compose"); await page.getByLabel("Proposed graph revision").fill("redesign-server-rejected"); await page.getByLabel("Environment for all imported services").fill("synthetic-review");
    const draft = "services:\n  api:\n    image: busybox:latest\n    ports: ['8080:80']\n"; await page.getByLabel("Inventory text", { exact: true }).fill(draft); await page.getByRole("button", { name: "Preview declared inventory", exact: true }).click(); await expect(page.locator(".inventory-preview")).toContainText("Provisional local preview");
    // Authoritative server-only policy rejection uses the existing422 details envelope; no graph is changed.
    await page.route(`**/api/projects/${project}/graph?*`, (route) => route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "Import validation failed", details: ["/assets/0/id: synthetic server-only constraint", "/relationships/0/target_id: synthetic unresolved target"] }) }));
    await page.getByRole("checkbox", { name: /I reviewed this preview/ }).check(); await page.getByRole("button", { name: "Apply inventory import", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("/assets/0/id: synthetic server-only constraint"); await expect(page.getByRole("alert")).toContainText("/relationships/0/target_id: synthetic unresolved target"); await expect(page.getByLabel("Inventory text", { exact: true })).toHaveValue(draft); await expect(page.getByRole("alert")).toContainText("Your draft is retained");
    expect((await harness.api("GET", `/api/projects/${project}/snapshot`)).json.graph).toEqual(previousGraph); await expect(page.locator(".inventory-import")).toContainText(`Existing graph revision: ${previousGraph.graph_revision}`);
  } finally { await context.close(); }
});

test("exact archived unlinked event resolves asset focus across Graph and Castle without inserting it into snapshot", async ({ browser }) => {
  const unlinked = events.find((event) => event.asset_ids.length && !findings.some((finding) => [...finding.event_ids, ...finding.counterevidence_event_ids].includes(event.id)))!;
  const { context, page } = await loginRedesign(browser, harness);
  try {
    // Explicit bounded-snapshot omission; exact detail and event search still use the real archive endpoints.
    await page.route(`**/api/projects/${project}/snapshot`, async (route) => { const response = await route.fetch(); const json = await response.json(); json.events = json.events.filter((event: SecurityEvent) => event.id !== unlinked.id); await route.fulfill({ response, json }); });
    await page.reload(); await expect(page.locator(".app")).toBeVisible(); await openEvents(page); await page.getByRole("button", { name: "Search events", exact: true }).click(); await page.getByRole("button", { name: `Open event ${unlinked.id}`, exact: true }).click(); await expect(page.getByTestId("event-unlinked")).toBeVisible();
    await page.getByRole("button", { name: "Kingdom", exact: true }).click(); await page.getByRole("radio", { name: "2D graph", exact: true }).click(); await expect(pane(page)).toHaveAttribute("data-selection-id", unlinked.id);
    for (const asset of unlinked.asset_ids) await expect(page.locator(`svg.graph2d [data-node][data-asset-id="${asset}"]`)).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("radio", { name: "3D castle", exact: true }).click(); await expect(page.getByRole("button", { name: "Focus selection", exact: true })).toBeEnabled(); await page.getByRole("button", { name: "Focus selection", exact: true }).click();
    for (const asset of unlinked.asset_ids) await expect(page.locator(`[data-asset-label="${asset}"]`)).toHaveClass(/is-selected/);
    await expect(pane(page)).toHaveAttribute("data-selection-id", unlinked.id); await expect(page.getByTestId("event-unlinked")).toBeVisible();
  } finally { await context.close(); }
});

test("stale403 from old project reload cannot clear the newly selected project", async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness);
  let release = () => {}; const gate = new Promise<void>((resolve) => { release = resolve; }); let held = false, returned = false;
  try {
    await openFinding(page, findings[0]!.id); await expect(page.getByTestId("evidence-incomplete")).toHaveCount(0);
    await page.route(`**/api/projects/${project}/snapshot`, async (route) => { held = true; await gate; await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Synthetic revoked old-project response" }) }).catch(() => {}); returned = true; });
    const update = await harness.api("POST", `/api/projects/${project}/findings/${encodeURIComponent(findings[0]!.id)}/disposition`, { note: "Synthetic cross-project reload race" }); expect(update.status).toBe(200); await expect.poll(() => held).toBe(true);
    await page.getByLabel("Project", { exact: true }).selectOption("second-project"); await expect(page.getByLabel("Project", { exact: true })).toHaveValue("second-project"); await expect(page.locator(".app")).toBeVisible();
    release(); await expect.poll(() => returned).toBe(true); await expect(page.getByLabel("Project", { exact: true })).toHaveValue("second-project"); await expect(page.locator(".app")).toBeVisible(); await expect(page.getByLabel("API token")).toHaveCount(0); await expect(page.locator('aside[data-selection-kind="finding"]')).toHaveCount(0);
  } finally { release(); await context.close(); }
});

test("pinned finding spanning replay cutoff clearly labels later evidence without silently dropping it", async ({ browser }) => {
  const current = (await harness.api("GET", `/api/projects/${project}/findings`)).json as Finding[];
  const target = current.find((finding) => Date.parse(finding.last_seen) > Date.parse(finding.first_seen) && finding.event_ids.length > 1)!;
  const cutoff = new Date(Math.floor((Date.parse(target.first_seen) + Date.parse(target.last_seen)) / 2000) * 1000).toISOString();
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await openFinding(page, target.id); await expect(page.getByTestId("evidence-incomplete")).toHaveCount(0); const count = await pane(page).locator("[data-event-id]").count();
    await page.evaluate(({ id, at }) => { location.hash = new URLSearchParams({ workspace: "investigate", view: "graph", sel: `finding:${id}`, t: at, basis: "occurred" }).toString(); }, { id: target.id, at: cutoff });
    await expect(page.getByTestId("finding-outside-replay")).toContainText("evidence beyond the selected replay time"); await expect(pane(page).locator("[data-event-id]")).toHaveCount(count); await expect(pane(page)).toHaveAttribute("data-selection-id", target.id);
  } finally { await context.close(); }
});

test("old containment denial while next project snapshot is pending cannot clear the next authorization scope", async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness);
  let releaseOld = () => {}, releaseNext = () => {}; const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; }), nextGate = new Promise<void>((resolve) => { releaseNext = resolve; }); let oldHeld = false, nextHeld = false, oldReturned = false;
  try {
    await page.route(`**/api/projects/${project}/containment`, async (route) => { oldHeld = true; await oldGate; await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Synthetic old-scope denial" }) }).catch(() => {}); oldReturned = true; });
    await page.route("**/api/projects/second-project/snapshot", async (route) => { nextHeld = true; await nextGate; await route.continue().catch(() => {}); });
    const aborted = page.waitForEvent("requestfailed", { predicate: (request) => new URL(request.url()).pathname === `/api/projects/${project}/containment` });
    await openFinding(page, findings[0]!.id); await expect.poll(() => oldHeld).toBe(true); await page.getByLabel("Project", { exact: true }).selectOption("second-project"); await expect.poll(() => nextHeld).toBe(true);
    expect((await aborted).failure()?.errorText).toMatch(/aborted|cancelled|canceled/i);
    // Explicit expired-scope denial injection also verifies the event handler during the null-data window.
    await page.evaluate((oldProject) => dispatchEvent(new CustomEvent("dk:access-denied", { detail: { status: 403, path: `/api/projects/${oldProject}/containment`, scope: -1 } })), project);
    releaseOld(); await expect.poll(() => oldReturned).toBe(true); await expect(page.getByRole("alert")).toHaveCount(0); releaseNext(); await expect(page.getByLabel("Project", { exact: true })).toHaveValue("second-project"); await expect(page.locator(".app")).toBeVisible(); await expect(page.getByLabel("API token")).toHaveCount(0);
  } finally { releaseOld(); releaseNext(); await context.close(); }
});

test("export response arriving after confirmed role downgrade cannot download stale privileged content", async ({ browser }) => {
  const { context, page } = await loginRedesign(browser, harness);
  let release = () => {}; const gate = new Promise<void>((resolve) => { release = resolve; }); let held = false, returned = false, downloads = 0; const target = findings[0]!;
  try {
    page.on("download", () => { downloads++; }); await openFinding(page, target.id); await expect(page.getByTestId("evidence-incomplete")).toHaveCount(0);
    await page.route(`**/cases/${encodeURIComponent(target.id)}/export`, async (route) => { const response = await route.fetch(); expect(response.status()).toBe(200); held = true; await gate; await route.fulfill({ response }).catch(() => {}); returned = true; });
    await pane(page).getByRole("button", { name: "Export case", exact: true }).click(); await page.getByRole("dialog", { name: "Case export scope" }).getByRole("button", { name: "Download case export", exact: true }).click(); await expect.poll(() => held).toBe(true);
    const aborted = page.waitForEvent("requestfailed", { predicate: (request) => request.url().includes(`/cases/${encodeURIComponent(target.id)}/export`) });
    // Authoritative snapshot role downgrade. No higher role is invented and the underlying API stays real.
    await page.route(`**/api/projects/${project}/snapshot`, async (route) => { const response = await route.fetch(); const json = await response.json(); json.role = "viewer"; await route.fulfill({ response, json }); });
    expect((await harness.api("POST", `/api/projects/${project}/findings/${encodeURIComponent(target.id)}/disposition`, { note: "Synthetic role-change refresh" })).status).toBe(200);
    await expect(pane(page)).toContainText("Your role (viewer)", { timeout: 15000 }); await expect(page.getByRole("dialog", { name: "Case export scope" })).toHaveCount(0);
    expect((await aborted).failure()?.errorText).toMatch(/aborted|cancelled|canceled/i); release(); await expect.poll(() => returned).toBe(true); await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); expect(downloads).toBe(0);
  } finally { release(); await context.close(); }
});

test("SEM-01 canonical blocked request preserves exact source claim and limitations without downstream success", async ({ browser }) => {
  const canonical = (await harness.api("GET", `/api/projects/${project}/findings`)).json as Finding[];
  const target = canonical.find((finding) => finding.kind === "blocked_request_reported" && finding.evidence_level === "source_reported")!;
  expect(target).toBeTruthy(); expect(target.outcome_state).toBe("blocked"); expect(target.counterevidence_event_ids).toEqual([]);
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await openFinding(page, target.id); await expect(page.getByTestId("evidence-incomplete")).toHaveCount(0);
    await expect(pane(page).locator("p.claim")).toHaveText(target.claim); await expect(pane(page)).toContainText("Source-reported");
    for (const limitation of target.not_claimed) await expect(pane(page).getByText(limitation, { exact: true })).toBeVisible();
    await expect(pane(page)).toContainText("Backend effects and intent are not established by this record alone.");
    const bundle = (await harness.api("GET", `/api/projects/${project}/findings/${target.id}/evidence?offset=0&limit=500`)).json;
    expect(bundle.events.filter((event: SecurityEvent) => target.event_ids.includes(event.id)).every((event: SecurityEvent) => event.outcome === "blocked" || event.outcome === "denied")).toBe(true);
    await expect(pane(page).locator('[data-evidence-role="supporting"]')).toHaveCount(target.event_ids.length);
    expect((await pane(page).locator('[data-evidence-role="supporting"]').allTextContents()).join(" ")).not.toContain("Operation succeeded");
  } finally { await context.close(); }
});

test("SEM-05 zero findings with no configured source remains explicitly unobserved rather than secure", async ({ browser }) => {
  const id = "redesign-zero-source", base = structuredClone(harness.store.getGraph(project)!);
  harness.store.createProject(id, "Isolated synthetic no-source visibility", "synthetic", { start: "2026-10-20T13:59:00Z", end: "2026-10-20T14:13:00Z" });
  harness.store.putGraph(id, { ...base, project_id: id, graph_revision: "zero-source-v1", assets: base.assets.filter((asset) => asset.id === "ci"), relationships: [] }, "synthetic-test-fixture");
  const snapshot = (await harness.api("GET", `/api/projects/${id}/snapshot`)).json; expect(snapshot.findings).toEqual([]); expect(snapshot.sources).toEqual([]);
  const { context, page } = await loginRedesign(browser, harness, { project: id });
  try {
    await expect(page.locator(".sidebar")).toContainText("No open findings recorded"); await expect(page.locator(".sidebar")).toContainText("Absence of findings is not proof of safety.");
    await page.getByRole("tab", { name: /^Assets 1$/ }).click(); await page.locator('.sidebar [data-asset-id="ci"]').click();
    await expect(page.getByTestId("asset-coverage-state")).toContainText("Unobserved"); await expect(page.getByTestId("asset-coverage-state")).toContainText("No telemetry source is configured for this asset");
    await expect(page.locator('.sidebar [data-asset-id="ci"]')).toContainText("Unobserved"); await expect(page.locator(".sidebar")).not.toContainText(/all clear|secure|no threats/i);
    await page.getByRole("button", { name: "Coverage", exact: true }).click(); await expect(page.getByText("No telemetry sources configured.", { exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test("SEM-06 shared IP across unrelated actors remains network context with no invented identity or causal map edge", async ({ browser }) => {
  const address = "198.51.100.20";
  const matches = (await harness.api("GET", `/api/projects/${project}/events/search?${interval}&client_ip=${address}&limit=100`)).json.events as SecurityEvent[];
  const dana = matches.find((event) => event.actor_ref === "acct-dana")!, ops = matches.find((event) => event.actor_ref === "acct-ops" && event.outcome === "success")!;
  expect(dana).toBeTruthy(); expect(ops).toBeTruthy(); expect(dana.session_ref).not.toBe(ops.session_ref);
  const currentFindings = (await harness.api("GET", `/api/projects/${project}/findings`)).json as Finding[];
  expect(currentFindings.filter((finding) => [...finding.event_ids, ...finding.counterevidence_event_ids].includes(ops.id)).some((finding) => [...finding.event_ids, ...finding.counterevidence_event_ids].includes(dana.id))).toBe(false);
  const graph = harness.store.getGraph(project)!, declaredIds = new Set(graph.relationships.map((relationship) => relationship.id));
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await openEvents(page); await page.getByRole("button", { name: "Add exact filter" }).click(); await page.getByLabel("Filter 1 field").selectOption("client_ip"); await page.getByLabel("Filter 1 value").fill(address); await page.getByRole("button", { name: "Search events", exact: true }).click();
    for (const event of [dana, ops]) {
      await page.getByRole("button", { name: `Open event ${event.id}`, exact: true }).click(); await expect(pane(page)).toContainText(`${event.actor_ref} · source-local, not a verified person`); await expect(pane(page)).toContainText("Network locator, not identity");
      await page.getByRole("button", { name: "Kingdom", exact: true }).click(); await page.getByRole("radio", { name: "2D graph", exact: true }).click();
      const drawn = await page.locator("svg.graph2d [data-edge]").evaluateAll((edges) => edges.map((edge) => edge.getAttribute("data-edge-id"))); expect(drawn.length).toBeGreaterThan(0);
      expect(drawn.every((id) => !!id && declaredIds.has(id))).toBe(true); await expect(page.locator('svg.graph2d [data-node]')).toHaveCount(graph.assets.length); await expect(page.locator("svg.graph2d")).not.toContainText(address);
      await page.getByRole("button", { name: "Investigate", exact: true }).click(); await expect(page.getByTestId("event-workspace")).toBeVisible();
    }
  } finally { await context.close(); }
});

test("COV-01 mixed source coverage agrees as Partial visibility in Castle Graph list and detail", async ({ browser }) => {
  const assetId = "edge"; // F04 adds its disabled secondary source to the canonical reporting edge asset.
  const { context, page } = await offlineRedesign(browser, harness, `?fixture=F04#workspace=kingdom&view=castle&sel=asset:${encodeURIComponent(assetId)}`);
  try {
    await expect(page.getByTestId("asset-coverage-state")).toContainText("Partial visibility"); await expect(page.getByTestId("asset-coverage-state")).toContainText("1 of 2 configured sources reporting");
    await expect(page.locator(`[data-asset-label="${assetId}"] [data-coverage="partial"]`)).toHaveText("Partial visibility");
    await page.getByRole("tab", { name: /^Assets 13$/ }).click(); await expect(page.locator(`.sidebar [data-asset-id="${assetId}"]`)).toContainText("Partial visibility");
    await page.getByRole("radio", { name: "2D graph", exact: true }).click(); await expect(page.locator(`svg.graph2d [data-node][data-asset-id="${assetId}"]`)).toHaveAttribute("aria-label", /Partial visibility/);
    await expect(page.getByTestId("asset-coverage-state")).toContainText("Partial visibility");
    await pane(page).getByRole("button", { name: /Synthetic secondary source \(disabled\)/ }).click(); await expect(pane(page)).toContainText("Administratively disabled. Stored events do not establish current reporting.");
  } finally { await context.close(); }
});

test("TIME-04 live-mode snapshot windows extend only after Load updates or Return live, while pinned replay stays stable", async ({ browser }) => {
  // Like the pilot, this is a fresh in-memory live-mode project with local generated inputs, not live production evidence.
  const id = "redesign-live-window", sourceId = "local-only-waf", base = structuredClone(harness.store.getGraph(project)!);
  harness.store.createProject(id, "Isolated local live-mode timing test (non-production)", "live");
  harness.store.putGraph(id, { ...base, project_id: id, dataset_kind: "live", graph_revision: "local-window-v1", assets: base.assets.filter((asset) => asset.id === "edge"), relationships: [] }, "isolated-test-fixture");
  harness.store.upsertSource(id, { id: sourceId, label: "Generated local test input only", kind: "waf", asset_ids: ["edge"], trusts_request_ids: true, stale_after_seconds: 600 }, "isolated-test-fixture");
  const ingest = (suffix: string) => {
    expect(harness.store.receive(id, sourceId, { source_event_id: `local-window-${suffix}`, occurred_at: new Date().toISOString(), asset_ids: ["edge"], action: "waf_match", outcome: "blocked", rule_ref: "local-window-rule", request_id: `local-window-${suffix}`, evidence: { note: "Generated in this isolated test, no external source connected" } }).status).toBe("accepted");
    while (harness.store.processBatch(500).processed) { /* real local normalizer and detector */ }
  };
  ingest("initial"); const { context, page } = await loginRedesign(browser, harness, { project: id });
  try {
    await expect(page.getByTestId("timeline-mode")).toHaveAttribute("data-mode", "live"); await page.getByRole("tab", { name: /^Assets 1$/ }).click(); await page.locator('.sidebar [data-asset-id="edge"]').click();
    const rail = page.getByRole("slider", { name: "Replay position" }), initialEnd = Number(await rail.getAttribute("max"));
    await expect(pane(page).locator("tr[data-event-id]")).toHaveCount(1);
    const nextSnapshot = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/projects/${id}/snapshot` && response.status() === 200); ingest("selected"); const updated = await (await nextSnapshot).json();
    expect(Date.parse(updated.server_time)).toBeGreaterThan(initialEnd); await expect(page.getByRole("button", { name: "Load updates", exact: true })).toBeEnabled();
    expect(Number(await rail.getAttribute("max"))).toBe(initialEnd); await expect(pane(page).locator("tr[data-event-id]")).toHaveCount(1); await expect(pane(page)).toHaveAttribute("data-selection-id", "edge");
    await page.getByRole("button", { name: "Load updates", exact: true }).click(); await expect.poll(async () => Number(await rail.getAttribute("max"))).toBe(Date.parse(updated.server_time)); await expect(pane(page).locator("tr[data-event-id]")).toHaveCount(2); await expect(page.getByTestId("timeline-mode")).toHaveAttribute("data-mode", "live");
    const acceptedEnd = Number(await rail.getAttribute("max")); await rail.focus(); await rail.press("Home"); await rail.press("End"); await expect(page.getByTestId("timeline-mode")).toHaveAttribute("data-mode", "historical"); const historicalValue = await rail.inputValue();
    const historicalRows = await pane(page).locator("tr[data-event-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-event-id"))); expect(historicalRows).toHaveLength(2);
    const latestSnapshot = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/projects/${id}/snapshot` && response.status() === 200); ingest("historical"); const latest = await (await latestSnapshot).json();
    expect(Date.parse(latest.server_time)).toBeGreaterThan(acceptedEnd); await expect(page.getByRole("button", { name: "Load updates", exact: true })).toBeDisabled(); expect(await rail.inputValue()).toBe(historicalValue); expect(Number(await rail.getAttribute("max"))).toBe(acceptedEnd);
    expect(await pane(page).locator("tr[data-event-id]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-event-id")))).toEqual(historicalRows);
    await page.getByRole("button", { name: "Return live", exact: true }).click(); await expect.poll(async () => Number(await rail.getAttribute("max"))).toBe(Date.parse(latest.server_time)); await expect(pane(page).locator("tr[data-event-id]")).toHaveCount(3); await expect(page.getByTestId("timeline-mode")).toHaveAttribute("data-mode", "live"); await expect(pane(page)).toHaveAttribute("data-selection-id", "edge");
  } finally { await context.close(); }
});
