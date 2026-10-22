import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup, liveGraph } from "./helpers.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";

async function liveProject(ctx: Awaited<ReturnType<typeof setup>>) {
  const { app, admin, h } = ctx;
  expect((await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "shop", name: "Shop", dataset_kind: "live" } })).statusCode).toBe(200);
  const g = await app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: h(admin), payload: liveGraph() });
  expect(g.statusCode, g.body).toBe(200);
  const s = await app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: h(admin), payload: { id: "waf", label: "Edge WAF", kind: "waf", asset_ids: ["edge"], trusts_request_ids: true } });
  const o = await app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: h(admin), payload: { id: "observer", label: "Observer", kind: "effect_observer", asset_ids: ["db"], trusts_request_ids: true } });
  return { wafKey: s.json().key as string, observerKey: o.json().key as string };
}
const evt = (id: string, extra: Record<string, unknown> = {}) => ({ source_event_id: id, occurred_at: "2026-10-21T10:00:00Z", asset_ids: ["edge"], action: "waf_match", outcome: "blocked", rule_ref: "942100", ...extra });

describe("authentication and authorization (C)", () => {
  it("S01: anonymous access is denied outside demo mode", async () => {
    const { app } = await setup({ demoMode: false });
    expect((await app.inject({ url: "/api/projects/demo-castle/snapshot" })).statusCode).toBe(401);
  });
  it("S01b: demo mode grants anonymous read to synthetic projects only", async () => {
    const ctx = await setup({ demoMode: true });
    await liveProject(ctx);
    expect((await ctx.app.inject({ url: "/api/projects/demo-castle/snapshot" })).statusCode).toBe(200);
    expect((await ctx.app.inject({ url: "/api/projects/shop/snapshot" })).statusCode).toBe(404);
    expect((await ctx.app.inject({ url: "/api/projects" })).json().map((p: { id: string }) => p.id)).toEqual(["demo-castle"]);
    expect((await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/cases/x/export" })).statusCode).toBe(403);
  });
  it("S02: a viewer cannot change sources, graph, or export cases (backend enforced)", async () => {
    const ctx = await setup();
    const { app, viewer, h } = ctx;
    const f = (await app.inject({ url: "/api/projects/demo-castle/findings", headers: h(viewer) })).json()[0];
    for (const [method, url] of [["POST", "/api/projects/demo-castle/sources"], ["POST", "/api/projects/demo-castle/graph"], ["POST", `/api/projects/demo-castle/cases/${f.id}/export`], ["POST", `/api/projects/demo-castle/findings/${f.id}/disposition`], ["GET", "/api/audit"]] as const) {
      expect((await app.inject({ method, url, headers: h(viewer), payload: {} })).statusCode, url).toBe(403);
    }
  });
  it("rejects invalid tokens", async () => {
    const { app } = await setup();
    expect((await app.inject({ url: "/api/projects", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
  });
  it("cookie sessions require the CSRF header for writes", async () => {
    const ctx = await setup();
    const login = await ctx.app.inject({ method: "POST", url: "/api/session", payload: { token: ctx.analyst } });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    expect(String(login.headers["set-cookie"])).toMatch(/HttpOnly; SameSite=Strict/);
    const f = (await ctx.app.inject({ url: "/api/projects/demo-castle/findings", headers: { cookie } })).json()[0];
    const url = `/api/projects/demo-castle/findings/${f.id}/disposition`;
    expect((await ctx.app.inject({ method: "POST", url, headers: { cookie }, payload: { lifecycle: "acknowledged" } })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "POST", url, headers: { cookie, "x-dk-request": "1" }, payload: { lifecycle: "acknowledged" } })).statusCode).toBe(200);
  });
});

describe("ingestion (TK-013/014)", () => {
  it("accepts, deduplicates (E01), and processes into findings", async () => {
    const ctx = await setup();
    const { wafKey } = await liveProject(ctx);
    const send = () => ctx.app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${wafKey}` }, payload: evt("w-1") });
    expect((await send()).json()).toMatchObject({ accepted: 1, duplicate: 0 });
    expect((await send()).json()).toMatchObject({ accepted: 0, duplicate: 1 });
    ctx.store.processBatch();
    const fs = (await ctx.app.inject({ url: "/api/projects/shop/findings", headers: ctx.h(ctx.viewer) })).json();
    expect(fs).toHaveLength(1);
    expect(fs[0].outcome_state).toBe("blocked");
    const health = (await ctx.app.inject({ url: "/api/projects/shop/health", headers: ctx.h(ctx.viewer) })).json();
    expect(health.counters.waf).toMatchObject({ accepted: 1, duplicate: 1 });
  });
  it("S03: a source cannot assert another project", async () => {
    const ctx = await setup();
    const { wafKey } = await liveProject(ctx);
    const r = await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${wafKey}` }, payload: evt("w-2", { project_id: "demo-castle" }) });
    expect(r.statusCode).toBe(422);
    expect(r.json().errors[0].reason).toBe("project_mismatch");
  });
  it("S14: synthetic sources cannot be attached to live projects; demo keys only write to demo", async () => {
    const ctx = await setup();
    await liveProject(ctx);
    const r = await ctx.app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: ctx.h(ctx.admin), payload: { id: "fake", label: "demo", asset_ids: ["edge"], dataset_kind: "synthetic" } });
    expect(r.statusCode).toBe(422);
    const g = await ctx.app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: ctx.h(ctx.admin), payload: { ...liveGraph(), dataset_kind: "synthetic", graph_revision: "r2" } });
    expect(g.statusCode).toBe(422);
  });
  it("rejects missing/invalid source keys and user tokens on ingest", async () => {
    const ctx = await setup();
    expect((await ctx.app.inject({ method: "POST", url: "/ingest/events", payload: evt("x") })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: ctx.h(ctx.admin), payload: evt("x") })).statusCode).toBe(401);
  });
  it("S07: compressed bodies, deep nesting, prototype pollution and oversized batches are refused", async () => {
    const ctx = await setup();
    const { wafKey } = await liveProject(ctx);
    const auth = { authorization: `Bearer ${wafKey}` };
    expect((await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: { ...auth, "content-encoding": "gzip", "content-type": "application/json" }, payload: "xx" })).statusCode).toBe(415);
    let deep: Record<string, unknown> = {}; for (let i = 0; i < 40; i++) deep = { d: deep };
    expect((await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: auth, payload: { ...evt("d"), evidence: deep } })).statusCode).toBe(413);
    expect((await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: { ...auth, "content-type": "application/json" }, payload: '{"__proto__":{"admin":true}}' })).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: auth, payload: { events: Array.from({ length: 501 }, (_, i) => evt(`b${i}`)) } })).statusCode).toBe(413);
  });
  it("unmapped assets are rejected at normalization and counted (not guessed)", async () => {
    const ctx = await setup();
    const { wafKey } = await liveProject(ctx);
    await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${wafKey}` }, payload: evt("u1", { asset_ids: ["shadow-service"] }) });
    ctx.store.processBatch();
    const health = (await ctx.app.inject({ url: "/api/projects/shop/health", headers: ctx.h(ctx.viewer) })).json();
    expect(health.counters.waf["rejected:unmapped_asset"]).toBe(1);
    expect(health.recent_rejections[0].reason).toBe("unmapped_asset");
  });
  it("Falco adapter maps alerts to rooms by alias", async () => {
    const ctx = await setup();
    await liveProject(ctx);
    const { key } = (await ctx.app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: ctx.h(ctx.admin), payload: { id: "falco", label: "Falco", kind: "falco", asset_ids: ["api"] } })).json();
    const alert = { output: "Shell spawned (container=checkout-7d9f8c6b5d-x2x9q)", priority: "Warning", rule: "Terminal shell in container", time: "2026-10-21T10:00:00.000000000Z", output_fields: { "container.name": "checkout-7d9f8c6b5d-x2x9q", "evt.num": 99 } };
    const r = await ctx.app.inject({ method: "POST", url: "/ingest/falco", headers: { authorization: `Bearer ${key}` }, payload: alert });
    expect(r.statusCode, r.body).toBe(202);
    ctx.store.processBatch();
    const f = ctx.store.listFindings("shop");
    expect(f[0]).toMatchObject({ kind: "runtime_alert_reported", affected_asset_ids: ["api"], severity: "high" });
  });
  it("OTLP spans map to sampled context events", async () => {
    const ctx = await setup();
    await liveProject(ctx);
    const { key } = (await ctx.app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: ctx.h(ctx.admin), payload: { id: "otel", label: "OTel", kind: "otel", asset_ids: ["api"] } })).json();
    const body = { resourceSpans: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "checkout-api" } }] }, scopeSpans: [{ spans: [
      { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", name: "GET /cart/:id", startTimeUnixNano: "1761040800000000000", attributes: [{ key: "http.route", value: { stringValue: "/cart/:id" } }, { key: "http.response.status_code", value: { intValue: 403 } }] },
      { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "c7ad6b7169203331", name: "internal", startTimeUnixNano: "1761040800000000000", attributes: [] },
    ] }] }] };
    const r = await ctx.app.inject({ method: "POST", url: "/v1/traces", headers: { authorization: `Bearer ${key}` }, payload: body });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({}); // ExportTraceServiceResponse with no partial success
    ctx.store.processBatch();
    const e = ctx.store.listEvents("shop")[0]!;
    expect(e).toMatchObject({ sampled: true, outcome: "denied", route: "/cart/:id", asset_ids: ["api"] });
  });
});

describe("durability and recovery (B)", () => {
  it("O01: accepted events survive a restart and reprocess idempotently", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dk-"));
    const path = join(dir, "db.sqlite");
    const ctx = await setup({ dbPath: path });
    const { wafKey } = await liveProject(ctx);
    for (const id of ["a", "b", "c"]) await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${wafKey}` }, payload: evt(id) });
    await ctx.app.close(); ctx.db.close();
    const store2 = new Store(openDb(path));
    while (store2.processBatch().processed) { /* drain */ }
    expect(store2.listEvents("shop")).toHaveLength(3);
    expect(store2.listFindings("shop")[0]!.event_count).toBe(3);
  });
  it("O02: a crash during finding creation rolls back the batch; recovery is consistent", async () => {
    let crash = false;
    const ctx = await setup({ store: { faultHook: (stage) => { if (crash && stage === "after_findings") throw new Error("simulated crash"); } } });
    const { wafKey } = await liveProject(ctx);
    crash = true;
    await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${wafKey}` }, payload: evt("c1") });
    const before = ctx.store.checkpoint();
    expect(() => ctx.store.processBatch()).toThrow(/simulated crash/);
    expect(ctx.store.checkpoint()).toBe(before);
    expect(ctx.store.listEvents("shop")).toHaveLength(0);
    expect(ctx.store.listFindings("shop")).toHaveLength(0);
    crash = false;
    ctx.store.processBatch();
    expect(ctx.store.listEvents("shop")).toHaveLength(1);
    expect(ctx.store.listFindings("shop")).toHaveLength(1);
    ctx.store.processBatch();
    expect(ctx.store.listFindings("shop")[0]!.revision).toBe(1);
  });
  it("E09: a late event creates a new finding revision instead of rewriting history", async () => {
    const ctx = await setup();
    const { wafKey } = await liveProject(ctx);
    const auth = { authorization: `Bearer ${wafKey}` };
    await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: auth, payload: evt("l1") });
    ctx.store.processBatch();
    await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: auth, payload: evt("l2", { occurred_at: "2026-10-21T09:59:00Z" }) });
    ctx.store.processBatch();
    const id = ctx.store.listFindings("shop")[0]!.id;
    const d = (await ctx.app.inject({ url: `/api/projects/shop/findings/${id}`, headers: ctx.h(ctx.viewer) })).json();
    expect(d.finding.revision).toBe(2);
    expect(d.revisions.map((r: { event_count: number }) => r.event_count)).toEqual([1, 2]);
  });
  it("O06: SSE resumes from a cursor and signals resync for an expired cursor", async () => {
    const ctx = await setup();
    const { wafKey } = await liveProject(ctx);
    const head = ctx.store.outboxHead().max;
    await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${wafKey}` }, payload: evt("s1") });
    ctx.store.processBatch();
    const address = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    const read = async (url: string, headers: Record<string, string> = {}) => {
      const ac = new AbortController();
      const res = await fetch(address + url, { headers: { ...ctx.h(ctx.viewer), ...headers }, signal: ac.signal });
      const reader = res.body!.getReader(); let text = "";
      const until = Date.now() + 400;
      while (Date.now() < until) { const r = await Promise.race([reader.read(), new Promise<{ value?: undefined; done: boolean }>((ok) => setTimeout(() => ok({ done: false }), 100))]); if (r.value) text += new TextDecoder().decode(r.value); if (r.done) break; }
      ac.abort(); return text;
    };
    const resumed = await read(`/api/projects/shop/stream?cursor=${head}`);
    expect(resumed).toMatch(/event: event/);
    expect(resumed).toMatch(/event: finding/);
    ctx.store.pruneOutbox(0);
    ctx.store.emit("shop", "graph", {});
    const stale = await read(`/api/projects/shop/stream`, { "last-event-id": "1" });
    expect(stale).toMatch(/event: resync/);
    await ctx.app.close();
  });
});

describe("scene and export", () => {
  it("planner falls back to the deterministic default when no model is configured (S11)", async () => {
    const ctx = await setup();
    const r = (await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/scene/plan?apply=1", headers: ctx.h(ctx.analyst) })).json();
    expect(r.source).toBe("default");
    expect(r.applied).toBe(true);
  });
  it("S10: a scene proposal with invented assets is rejected by the API", async () => {
    const ctx = await setup();
    const scene = ctx.store.getScene("demo-castle")!;
    const bad = { schema_version: "0.2", graph_revision: scene.graph_revision, seed: 1, style_profile: "stone-slate-v1", camera_profile: "isometric-v1", placements: [{ asset_id: "ghost", zone_id: "public", module_id: "gatehouse" }] };
    const r = await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/scene", headers: ctx.h(ctx.analyst), payload: bad });
    expect(r.statusCode).toBe(422);
    expect(r.json().details.join(" ")).toMatch(/cannot invent assets/);
  });
  it("graph import via compose keeps rooms stable across revisions (V02)", async () => {
    const ctx = await setup();
    await liveProject(ctx);
    const compose = "services:\n  edge:\n    image: nginx\n    depends_on: [api]\n  api:\n    image: x/api\n    ports: ['80']\n    labels: ['dk.id=api']\n  db:\n    image: postgres\n";
    const before = ctx.store.getScene("shop")!;
    const r = await ctx.app.inject({ method: "POST", url: "/api/projects/shop/graph?format=compose&revision=r2&environment=prod", headers: { ...ctx.h(ctx.admin), "content-type": "application/yaml" }, payload: compose });
    expect(r.statusCode, r.body).toBe(200);
    const after = ctx.store.getScene("shop")!;
    for (const room of before.rooms) expect(after.rooms.find((x) => x.asset_id === room.asset_id)?.position).toEqual(room.position);
  });
  it("S12: an exported case verifies, and tampering is detected", async () => {
    const ctx = await setup();
    const f = ctx.store.listFindings("demo-castle").find((x) => x.kind === "source_contradiction")!;
    const bundle = (await ctx.app.inject({ method: "POST", url: `/api/projects/demo-castle/cases/${f.id}/export`, headers: ctx.h(ctx.analyst) })).json();
    expect(bundle.sections.events).toHaveLength(2);
    expect(bundle.manifest.guarantee).toMatch(/Not proof of completeness/);
    const ok = (await ctx.app.inject({ method: "POST", url: "/api/verify-export", headers: ctx.h(ctx.viewer), payload: bundle })).json();
    expect(ok.valid).toBe(true);
    bundle.sections.events[0].outcome = "success";
    const bad = (await ctx.app.inject({ method: "POST", url: "/api/verify-export", headers: ctx.h(ctx.viewer), payload: bundle })).json();
    expect(bad.valid).toBe(false);
    expect(bad.problems.join(" ")).toMatch(/events/);
    const audit = (await ctx.app.inject({ url: "/api/audit", headers: ctx.h(ctx.admin) })).json();
    expect(audit.some((a: { action: string }) => a.action === "case.export")).toBe(true);
  });
  it("evidence is served as the redacted derivative only (S08)", async () => {
    const ctx = await setup();
    const snap = (await ctx.app.inject({ url: "/api/projects/demo-castle/snapshot", headers: ctx.h(ctx.viewer) })).json();
    const all = JSON.stringify(snap);
    expect(all).not.toContain("hunter2");
    expect(all).not.toContain("eyJhbGci");
  });
  it("seeded demo matches the in-memory pipeline (same engine both paths)", async () => {
    const ctx = await setup();
    const kinds = ctx.store.listFindings("demo-castle").map((f) => f.kind).sort();
    expect(kinds).toContain("source_contradiction");
    expect(kinds).toHaveLength(10);
    const late = ctx.store.listEvents("demo-castle").filter((e) => Date.parse(e.received_at) - Date.parse(e.occurred_at) > 60_000);
    expect(late.length).toBeGreaterThan(0);
  });
});

describe("agent interface (MCP backing API)", () => {
  it("returns asset security context with findings, coverage and permitted containment", async () => {
    const ctx = await setup();
    const c = (await ctx.app.inject({ url: "/api/projects/demo-castle/context?asset=identity-service", headers: ctx.h(ctx.viewer) })).json();
    expect(c.asset.id).toBe("auth");
    expect(c.findings.direct.map((f: { kind: string }) => f.kind)).toContain("repeated_auth_failure");
    expect(c.permitted_containment.every((a: { requires_human_approval: boolean }) => a.requires_human_approval)).toBe(true);
    expect(c.boundaries.join(" ")).toMatch(/does not execute containment/);
  });
  it("resolves a route to its asset", async () => {
    const ctx = await setup();
    const c = (await ctx.app.inject({ url: "/api/projects/demo-castle/context?route=/admin/roles", headers: ctx.h(ctx.viewer) })).json();
    expect(c.asset.id).toBe("api");
  });
  it("flags unobserved assets as unknown, not safe", async () => {
    const ctx = await setup();
    const c = (await ctx.app.inject({ url: "/api/projects/demo-castle/context?asset=release-pipeline", headers: ctx.h(ctx.viewer) })).json();
    expect(c.guidance[0]).toMatch(/unknown, not safe/);
  });
  it("assess-change holds a change touching contradicted findings", async () => {
    const ctx = await setup();
    const r = (await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/assess-change", headers: ctx.h(ctx.viewer), payload: { asset_ids: ["edge"], summary: "update auth endpoint" } })).json();
    expect(r.posture).toBe("hold");
    expect(r.blocking_findings.length).toBeGreaterThan(0);
  });
  it("containment is a proposal: requester cannot self-approve; nothing executes", async () => {
    const ctx = await setup();
    const f = ctx.store.listFindings("demo-castle").find((x) => x.kind === "repeated_auth_failure")!;
    const bad = await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/containment", headers: ctx.h(ctx.analyst), payload: { finding_id: f.id, action_id: "data.restrict_access", rationale: "x" } });
    expect(bad.statusCode).toBe(422);
    const req = (await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/containment", headers: ctx.h(ctx.admin), payload: { finding_id: f.id, action_id: "auth.force_reauth", rationale: "repeated failures then success" } })).json();
    expect(req.status).toBe("pending");
    const self = await ctx.app.inject({ method: "POST", url: `/api/projects/demo-castle/containment/${req.id}/decision`, headers: ctx.h(ctx.admin), payload: { decision: "approved" } });
    expect(self.statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "POST", url: `/api/projects/demo-castle/containment/${req.id}/decision`, headers: ctx.h(ctx.viewer), payload: { decision: "approved" } })).statusCode).toBe(403);
  });
});
