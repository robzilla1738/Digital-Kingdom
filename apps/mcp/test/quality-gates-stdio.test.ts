import { describe, expect, it } from "vitest";
import { setup, liveGraph } from "../../server/test/helpers.ts";
import { connectStdioMcp } from "./stdio-client.ts";

/** Real stdio subprocess, service-viewer credential, no model or provider call. */
describe("investigation honesty over the documented stdio transport", () => {
  it("pins event pages but reports CURRENT coverage, and denies unknown/cross-project targets", async () => {
    let clock = Date.parse("2026-10-22T16:00:00.000Z");
    const c = await setup({ store: { now: () => new Date(clock) } });
    let mcp: Awaited<ReturnType<typeof connectStdioMcp>> | undefined;
    try {
      c.store.createProject("shop", "Stdio quality fixture", "live");
      c.store.putGraph("shop", liveGraph() as Parameters<typeof c.store.putGraph>[1], "test");
      c.store.upsertSource("shop", { id: "app", label: "App", kind: "app_security", asset_ids: ["api"], stale_after_seconds: 60 }, "test");
      for (const n of [1, 2]) {
        const r = c.store.receive("shop", "app", { source_event_id: `test-${n}`, occurred_at: "2026-10-21T16:00:00.000Z", asset_ids: ["api"], action: "authentication", outcome: "success", evidence: { note: "synthetic fixture" } });
        expect(r.status).toBe("accepted");
      }
      c.store.processBatch();
      const token = c.store.createToken("stdio reviewer", "viewer", ["shop"], undefined, "service").token;
      const base = await c.app.listen({ port: 0, host: "127.0.0.1" });
      mcp = await connectStdioMcp({ DK_URL: base, DK_TOKEN: token, DK_PROJECT: "shop" });
      const query = { after: "2026-10-21T00:00:00Z", before: "2026-10-22T00:00:00Z", asset_id: "api", limit: 1 };
      const first = await mcp.call("dk_search_events", query);
      expect(first.source_coverage).toMatchObject({ coverage_basis: "current_state", coverage_as_of: new Date(clock).toISOString(), historical_coverage_assessed: false });
      expect(first.events.untrusted).toBe(true);
      expect(first.page.has_more).toBe(true);
      expect(first.source_coverage.sources[0].current_state).toBe("healthy");
      expect(first.limits.join(" ")).toMatch(/Historical coverage is not assessed/);
      clock += 1000;
      c.db.prepare("UPDATE sources SET disabled = 1 WHERE project_id = 'shop' AND id = 'app'").run();
      const second = await mcp.call("dk_search_events", { ...query, cursor: first.page.next_cursor });
      expect(second.snapshot_seq).toBe(first.snapshot_seq);
      expect(second.events.records[0].id).not.toBe(first.events.records[0].id);
      expect(second.query_completeness.complete).toBe(true);
      expect(second.source_coverage).toMatchObject({ coverage_basis: "current_state", coverage_as_of: new Date(clock).toISOString(), historical_coverage_assessed: false });
      expect(second.source_coverage.sources[0]).toMatchObject({ current_state: "offline", disabled: true });
      const detail = await mcp.call("dk_get_event", { id: first.events.records[0].id });
      expect(detail.event.id).toBe(first.events.records[0].id);
      expect(detail.evidence_completeness.complete).toBe(true);
      const assessment = await mcp.call("dk_assess_change", { asset_ids: ["api"] });
      expect(assessment).toMatchObject({ posture: "insufficient_context", favorable: false, target_resolution: { complete: true }, evidence_sufficiency: { sufficient: false } });
      expect((await mcp.call("dk_assess_change", { asset_ids: ["no-such-asset"] })).posture).toBe("not_assessed");
      await expect(mcp.call("dk_search_events", { ...query, project: "demo-castle", cursor: first.page.next_cursor })).rejects.toThrow(/404|not found/i);
    } finally {
      await mcp?.close(); await c.app.close(); c.db.close();
    }
  }, 30_000);
});
