import { describe, expect, it } from "vitest";
import { setup, liveGraph } from "../../server/test/helpers.ts";

async function liveProject(ctx: Awaited<ReturnType<typeof setup>>) {
  const { app, admin, h } = ctx;
  await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "shop", name: "Shop", dataset_kind: "live" } });
  await app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: h(admin), payload: liveGraph() });
  const waf = (await app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: h(admin), payload: { id: "waf", label: "Edge WAF", kind: "waf", asset_ids: ["edge"], trusts_request_ids: true } })).json().key as string;
  return { waf };
}

// ---------------------------------------------------------------- fix 4
describe("fix 4: older findings keep complete, explicit evidence", () => {
  it("evidence for an old finding survives 5,000+ later events; >50 records; partial failures are explicit", async () => {
    const ctx = await setup();
    const { waf } = await liveProject(ctx);
    // an old finding with 120 evidence-bearing events
    for (let i = 0; i < 120; i++) ctx.store.receive("shop", "waf", { source_event_id: `old-${i}`, occurred_at: new Date(Date.parse("2026-10-01T00:00:00Z") + i * 1000).toISOString(), asset_ids: ["edge"], action: "waf_match", outcome: "blocked", rule_ref: "old-rule", evidence: { n: i } });
    // 5,100 unrelated later events
    for (let i = 0; i < 5100; i++) ctx.store.receive("shop", "waf", { source_event_id: `later-${i}`, occurred_at: new Date(Date.parse("2026-10-20T00:00:00Z") + i * 1000).toISOString(), asset_ids: ["edge"], action: "request_received", outcome: "allowed", evidence: { n: i } });
    while (ctx.store.processBatch(2000).processed) { /* drain */ }
    void waf;
    const f = ctx.store.listFindings("shop").find((x) => x.rule_id === "edge.blocked_request")!;
    expect(f.event_count).toBe(120);
    const first = (await ctx.app.inject({ url: `/api/projects/shop/findings/${f.id}/evidence?limit=50`, headers: ctx.h(ctx.viewer) })).json();
    expect(first).toMatchObject({ expected_event_count: 120, returned_event_count: 50, next_offset: 50, complete: false });

    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createServer, DkClient } = await import("../src/server.ts");
    const base = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    const mcp = createServer(new DkClient({ baseUrl: base, token: ctx.viewer, project: "shop" }));
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "1" });
    await Promise.all([mcp.connect(a), client.connect(b)]);
    const get = async (args: Record<string, unknown>) => JSON.parse(((await client.callTool({ name: "dk_get_finding", arguments: args })).content as { text: string }[])[0]!.text);

    const full = await get({ id: f.id });
    expect(full.completeness).toMatchObject({ complete: true, expected_events: 120, returned_events: 120, expected_evidence_records: 120, returned_evidence_records: 120 });
    expect(full.events).toHaveLength(120);

    const capped = await get({ id: f.id, max_events: 30 });
    expect(capped.completeness).toMatchObject({ complete: false, truncated: true, returned_events: 30 });
    expect(capped.completeness.warning).toMatch(/INCOMPLETE/);

    const victim = `evidence:${f.event_ids[7]}`;
    ctx.db.prepare("DELETE FROM evidence WHERE ref = ?").run(victim);
    const partial = await get({ id: f.id });
    expect(partial.completeness.complete).toBe(false);
    expect(partial.completeness.missing_evidence_refs).toEqual([victim]);

    const bundle = (await ctx.app.inject({ method: "POST", url: `/api/projects/shop/cases/${f.id}/export`, headers: ctx.h(ctx.analyst) })).json();
    expect(bundle.sections.events).toHaveLength(120);
    expect(bundle.manifest.complete).toBe(false);
    expect(bundle.sections.completeness.missing_evidence_refs).toEqual([victim]);
    await ctx.app.close();
  }, 60_000);
});

