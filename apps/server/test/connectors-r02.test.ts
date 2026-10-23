import { describe, expect, it } from "vitest";
import { setup, liveGraph } from "./helpers.ts";
import { CONNECTORS, validateManifest } from "../src/adapters/connectors.ts";

/** R02.1 connector manifests, install scopes and honest coverage from collection reports. */
const T0 = Date.parse("2026-10-21T00:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

async function project() {
  const clock = { t: T0 - 3600_000 };
  const ctx = await setup({ store: { now: () => new Date(clock.t) } });
  await ctx.app.inject({ method: "POST", url: "/api/projects", headers: ctx.h(ctx.admin), payload: { id: "shop", name: "Shop", dataset_kind: "live" } });
  await ctx.app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: ctx.h(ctx.admin), payload: liveGraph() });
  const reg = (body: Record<string, unknown>) => ctx.app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: ctx.h(ctx.admin), payload: body });
  return { ctx, clock, reg };
}

describe("R02.1 manifests", () => {
  it("every built-in manifest is collect-only, non-administrative and states its verification level", () => {
    for (const m of CONNECTORS) expect(validateManifest(m)).toEqual([]);
    expect(validateManifest({ ...CONNECTORS[0]!, authority: "collect_and_respond" as never, read_scopes: [{ scope: "iam:*", why: "", required: true }] }).length).toBe(2);
    expect(CONNECTORS.flatMap((c) => c.capabilities).some((c) => c.level === "live_verified")).toBe(false); // nothing is claimed live-verified
  });
  it("the catalog is served with capability levels", async () => {
    const { ctx } = await project();
    const r = (await ctx.app.inject({ url: "/api/connectors", headers: ctx.h(ctx.viewer) })).json();
    expect(r.connectors.map((c: { id: string }) => c.id)).toEqual(["dk.events.http", "dk.otlp.traces", "dk.falco"]);
    expect(r.capability_levels).toEqual(["declared", "discovered", "instrumented", "analyzed", "lab_verified", "live_verified"]);
  });
});

describe("R02.1 installation never defaults to administrator access", () => {
  it("default grants are the manifest's required read scopes; admin, wildcard and foreign scopes are refused", async () => {
    const { ctx, reg } = await project();
    const ok = await reg({ id: "app", label: "app", kind: "app_security", asset_ids: ["api"] });
    expect(ok.statusCode, ok.body).toBe(200);
    const src = ctx.store.listSources("shop").find((s) => s.id === "app")!;
    expect(src).toMatchObject({ connector_id: "dk.events.http", granted_scopes: ["source-key:ingest"] });
    for (const scopes of [["*"], ["iam:admin"], ["db:write"], ["s3:full_access"], ["unknown:read"]]) {
      const r = await reg({ id: "x", label: "x", kind: "app_security", asset_ids: ["api"], granted_scopes: scopes });
      expect(r.statusCode, String(scopes)).toBe(422);
    }
    expect((await reg({ id: "x", label: "x", kind: "db_audit", asset_ids: ["db"], connector_id: "dk.falco" })).statusCode).toBe(422); // kind unsupported by connector
    expect((await reg({ id: "x", label: "x", kind: "generic", asset_ids: ["api"], connector_id: "acme.magic" })).statusCode).toBe(400);
  });
});

describe("R02.1 collection failures produce honest coverage", () => {
  it("permission denial, throttling, partial pagination and revoked scopes lower coverage; replay is idempotent", async () => {
    const { ctx, clock, reg } = await project();
    const r = await reg({ id: "dbaudit", label: "db audit", kind: "db_audit", asset_ids: ["db"], stale_after_seconds: 3600 });
    const key = r.json().key as string;
    clock.t = T0 + 5 * 3600_000;
    for (let m = 0; m <= 300; m += 10) ctx.store.receive("shop", "dbaudit", { source_event_id: `e${m}`, occurred_at: at(m), asset_ids: ["db"], action: "data_access", outcome: "success" }, at(m));
    while (ctx.store.processBatch().processed) { /* drain */ }
    const report = (body: Record<string, unknown>) => ctx.app.inject({ method: "POST", url: "/ingest/collection-report", headers: { authorization: `Bearer ${key}` }, payload: body });
    expect((await report({ report_id: "w1", window_start: at(0), window_end: at(60), status: "complete" })).json().duplicate).toBe(false);
    expect((await report({ report_id: "w2", window_start: at(60), window_end: at(120), status: "permission_denied", detail: "AccessDenied reading audit log; token AKIAABCDEFGHIJKLMNOP" })).statusCode).toBe(200);
    await report({ report_id: "w3", window_start: at(120), window_end: at(180), status: "throttled" });
    await report({ report_id: "w4", window_start: at(180), window_end: at(240), status: "partial", pages_fetched: 3, cursor: "abc" });
    await report({ report_id: "w5", window_start: at(240), window_end: at(300), status: "scope_revoked" });
    const replay = await report({ report_id: "w2", window_start: at(60), window_end: at(120), status: "permission_denied" });
    expect(replay.json().duplicate).toBe(true);
    const h = (await ctx.app.inject({ url: `/api/projects/shop/coverage/history?asset=db&action=data_access&after=${at(0)}&before=${at(300)}`, headers: ctx.h(ctx.viewer) })).json();
    const view = h.spans.map((s: { from: string; to: string; state: string; sources: { reason: string }[] }) => `${s.from.slice(11, 16)}-${s.to.slice(11, 16)} ${s.state} ${s.sources[0]?.reason ?? ""}`);
    expect(view).toEqual([
      "00:00-01:00 covered assigned, enabled, capable and live",
      "01:00-02:00 unknown collector reported permission denied for this window: AccessDenied reading audit log; token [redacted]",
      "02:00-03:00 unknown collector reported throttled for this window",
      "03:00-04:00 partial collector reported partial for this window",
      "04:00-05:00 unknown collector reported scope revoked for this window",
    ]);
    expect((await report({ report_id: "bad", window_start: at(10), window_end: at(5), status: "complete" })).statusCode).toBe(400);
    expect((await report({ report_id: "bad", window_start: at(10), window_end: at(20), status: "fine" })).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: "POST", url: "/ingest/collection-report", headers: { authorization: "Bearer nope" }, payload: {} })).statusCode).toBe(401);
  });
});
