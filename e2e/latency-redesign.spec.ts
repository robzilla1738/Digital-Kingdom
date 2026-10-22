/** Local synthetic timing and cache proof, not a production SLA or real-GPU benchmark. */
import { test, expect } from "@playwright/test";
import type { Finding } from "@dk/contracts";
import { createRedesignHarness, loginRedesign, rendererDetails, writeRedesignEvidence, type RedesignHarness } from "./redesign-harness.ts";

let harness: RedesignHarness;
test.beforeAll(async () => { harness = await createRedesignHarness(); });
test.afterAll(async () => { await harness?.close(); });

test("PERF-06 local journal SSE snapshot and UI timings are separate; CASTLE-05 event-only update reuses mounted module geometry", async ({ browser }) => {
  const project = "demo-castle", initial = (await harness.api("GET", `/api/projects/${project}/snapshot`)).json;
  const target = initial.findings.find((finding: Finding) => finding.rule_id === "edge.blocked_request" && finding.event_ids.length > 1) as Finding;
  const { context, page } = await loginRedesign(browser, harness);
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.getByTestId("connection-pill")).toHaveAttribute("data-state", "live");
    await page.locator(".display-menu > summary").click(); await page.getByLabel("Quality", { exact: true }).selectOption("low"); await page.locator(".display-menu > summary").click();
    const canvas = page.locator(".castle-wrap canvas"); await expect(canvas).toHaveAttribute("data-quality", "low"); await expect(canvas).toHaveAttribute("data-module-geometry-builds", /^[1-9][0-9]*$/);
    // Warm the selected LOD and its deferred GPU uploads before measuring event-only work.
    await page.waitForTimeout(750); await page.getByRole("button", { name: "Fit all assets", exact: true }).click();
    let lastRender = -1, stableFrames = 0;
    await expect.poll(async () => { const count = Number(await canvas.getAttribute("data-render-count")); stableFrames = count === lastRender ? stableFrames + 1 : 0; lastRender = count; return stableFrames; }, { intervals: [150], timeout: 10000 }).toBeGreaterThanOrEqual(2);
    const mountedCanvas = await canvas.elementHandle();
    const before = await canvas.evaluate((element) => ({ moduleGeometryBuilds: Number(element.dataset.moduleGeometryBuilds), gpuGeometries: Number(element.dataset.gpuGeometries), gpuTextures: Number(element.dataset.gpuTextures), renderCount: Number(element.dataset.renderCount), drawCalls: Number(element.dataset.drawCalls), triangles: Number(element.dataset.triangles), quality: element.dataset.quality }));
    await expect(page.locator(`.sidebar [data-finding-id="${target.id}"] .row-title`)).toHaveText(target.title);
    await page.evaluate(({ id, original }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(".castle-wrap canvas")!;
      const state = { started: performance.now(), uiObservedAt: null as number | null, rendererObservedAt: null as number | null, title: "" };
      const observer = new MutationObserver((records) => {
        const title = document.querySelector(`.sidebar [data-finding-id="${id}"] .row-title`)?.textContent ?? "";
        if (title && title !== original && state.uiObservedAt === null) { state.title = title; state.uiObservedAt = performance.now(); }
        if (state.uiObservedAt !== null && state.rendererObservedAt === null && records.some((record) => record.target === canvas && record.attributeName === "data-render-count")) state.rendererObservedAt = performance.now();
      });
      observer.observe(document.querySelector(".app")!, { attributes: true, attributeFilter: ["data-render-count"], childList: true, characterData: true, subtree: true });
      (window as unknown as { __dkLatency: typeof state & { stop: () => void } }).__dkLatency = Object.assign(state, { stop: () => observer.disconnect() });
    }, { id: target.id, original: target.title });
    const responseReady = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/projects/${project}/snapshot` && response.status() === 200);
    const sourceStart = performance.now();
    const accepted = harness.store.receive(project, "src-edge", { source_event_id: "redesign-latency-event", occurred_at: "2026-10-20T14:01:21.000Z", asset_ids: ["edge"], action: "waf_match", outcome: "blocked", rule_ref: "sqli-942100", request_id: "redesign-latency-request", route: "/synthetic-latency-probe", evidence: { note: "Isolated local timing input; no production event or external source" } }, "2026-10-20T14:12:52.000Z");
    const journalEnd = performance.now(); expect(accepted.status).toBe("accepted");
    let processed = 0; for (;;) { const batch = harness.store.processBatch(500); processed += batch.processed; if (!batch.processed) break; }
    const normalizerEnd = performance.now(); expect(processed).toBeGreaterThan(0);
    const response = await responseReady; await response.finished(); const snapshotObserved = performance.now();
    const updatedSnapshot = await response.json(), updated = updatedSnapshot.findings.find((finding: Finding) => finding.id === target.id) as Finding;
    expect(updated.revision).toBeGreaterThan(target.revision); expect(updated.event_ids).toHaveLength(target.event_ids.length + 1);
    await expect(page.locator(`.sidebar [data-finding-id="${target.id}"] .row-title`)).toHaveText(updated.title);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __dkLatency: { rendererObservedAt: number | null } }).__dkLatency.rendererObservedAt), { timeout: 15000 }).not.toBeNull();
    const observedEnd = performance.now(), browserTiming = await page.evaluate(() => {
      const state = (window as unknown as { __dkLatency: { started: number; uiObservedAt: number; rendererObservedAt: number; title: string; stop: () => void } }).__dkLatency; state.stop();
      return { sourceToUiObservedMs: state.uiObservedAt - state.started, sourceToRendererInstrumentationMs: state.rendererObservedAt - state.started, uiToRendererInstrumentationMs: state.rendererObservedAt - state.uiObservedAt, displayedTitle: state.title };
    });
    const after = await canvas.evaluate((element) => ({ moduleGeometryBuilds: Number(element.dataset.moduleGeometryBuilds), gpuGeometries: Number(element.dataset.gpuGeometries), gpuTextures: Number(element.dataset.gpuTextures), renderCount: Number(element.dataset.renderCount), drawCalls: Number(element.dataset.drawCalls), triangles: Number(element.dataset.triangles), quality: element.dataset.quality }));
    expect(await mountedCanvas!.evaluate((element) => element.isConnected)).toBe(true); expect(await canvas.count()).toBe(1); expect(after.moduleGeometryBuilds).toBe(before.moduleGeometryBuilds);
    expect(updatedSnapshot.graph.graph_revision).toBe(initial.graph.graph_revision); expect(updatedSnapshot.scene.digest).toBe(initial.scene.digest); expect(updatedSnapshot.scene.rooms).toEqual(initial.scene.rooms);
    const repeatedUpdates: Array<{ moduleGeometryBuilds: number; gpuGeometries: number; gpuTextures: number; renderCount: number }> = [];
    for (const sequence of [2, 3]) {
      const priorRender = Number(await canvas.getAttribute("data-render-count"));
      const nextSnapshot = page.waitForResponse((reply) => new URL(reply.url()).pathname === `/api/projects/${project}/snapshot` && reply.status() === 200);
      expect(harness.store.receive(project, "src-edge", { source_event_id: `redesign-cache-repeat-${sequence}`, occurred_at: `2026-10-20T14:01:2${sequence}.000Z`, asset_ids: ["edge"], action: "waf_match", outcome: "blocked", rule_ref: "sqli-942100", request_id: `redesign-cache-repeat-${sequence}`, evidence: { note: "Same-quality local event-only cache verification" } }, `2026-10-20T14:12:5${sequence}.000Z`).status).toBe("accepted");
      while (harness.store.processBatch(500).processed) { /* real event processing */ }
      const next = await (await nextSnapshot).json(), finding = next.findings.find((entry: Finding) => entry.id === target.id) as Finding;
      expect(finding.event_ids).toHaveLength(target.event_ids.length + sequence);
      await expect(page.locator(`.sidebar [data-finding-id="${target.id}"] .row-title`)).toHaveText(finding.title);
      await expect.poll(async () => Number(await canvas.getAttribute("data-render-count"))).toBeGreaterThan(priorRender);
      const resources = await canvas.evaluate((element) => ({ moduleGeometryBuilds: Number(element.dataset.moduleGeometryBuilds), gpuGeometries: Number(element.dataset.gpuGeometries), gpuTextures: Number(element.dataset.gpuTextures), renderCount: Number(element.dataset.renderCount) }));
      expect(resources.moduleGeometryBuilds).toBe(before.moduleGeometryBuilds); expect(resources.gpuGeometries).toBeLessThanOrEqual(after.gpuGeometries + 4); expect(resources.gpuTextures).toBeLessThanOrEqual(after.gpuTextures); expect(await mountedCanvas!.evaluate((element) => element.isConnected)).toBe(true);
      expect(next.scene.digest).toBe(initial.scene.digest); repeatedUpdates.push(resources);
    }
    const timing = response.request().timing();
    writeRedesignEvidence("source-to-display-local.json", {
      test: "PERF-06 local journal SSE snapshot and UI timings are separate; CASTLE-05 event-only update reuses mounted module geometry", recordedAt: new Date().toISOString(),
      conditions: { evidenceClass: "isolated canonical synthetic project, actual local journal/normalizer/SSE/snapshot/UI", browser: browser.version(), build: await page.locator('meta[name="dk-build"]').getAttribute("content"), renderer: await rendererDetails(page), viewport: page.viewportSize(), dpr: 1, quality: after.quality, reducedMotion: true, sourceTransport: "in-process Store.receive test input, not external source network", ssePollMs: 50, sampleCount: 1, warmup: "750ms quality settling, fit camera, then unchanged render count over two150ms intervals" },
      journalReceiveMs: journalEnd - sourceStart, normalizationDetectionAndPersistenceMs: normalizerEnd - journalEnd, totalSynchronousBackendMs: normalizerEnd - sourceStart,
      snapshotHttp: { requestToFirstByteMs: timing.responseStart - timing.requestStart, requestToResponseEndMs: timing.responseEnd - timing.requestStart, rawBrowserRequestTiming: timing },
      driverSourceToSnapshotObservedMs: snapshotObserved - sourceStart, driverSourceToUiObservedMs: observedEnd - sourceStart, browserTiming,
      geometry: { sameCanvasRemainedMounted: true, before, after, repeatedUpdates, graphRevisionUnchanged: true, sceneDigestUnchanged: true, sceneRoomsUnchanged: true },
      limitations: ["One local synthetic timing sample and three event-only cache observations, not a production SLA, network benchmark or process-heap leak proof.", "Browser timestamps include configured SSE polling, snapshot scheduling, client reconciliation and observer overhead; they are not summed with the separate backend/network measurements.", "Renderer instrumentation records the next observed canvas render-count mutation, not GPU presentation or monitor scanout.", "Headless Chromium uses software rendering; this does not satisfy the required reference-laptop real-GPU benchmark."]
    });
  } finally { await context.close(); }
});
