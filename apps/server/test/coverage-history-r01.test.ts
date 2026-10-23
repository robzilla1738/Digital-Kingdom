import { describe, expect, it } from "vitest";
import { setup, liveGraph } from "./helpers.ts";

/** R01.2 historical, question-specific coverage. */
const T0 = Date.parse("2026-10-21T00:00:00Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();

async function project(opts: { eventWindow?: number } = {}) {
  const clock = { t: T0 - 60 * 60_000 };
  const ctx = await setup({ store: { now: () => new Date(clock.t), ...(opts.eventWindow ? { eventWindow: opts.eventWindow } : {}) } });
  const { app, admin, h } = ctx;
  await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "shop", name: "Shop", dataset_kind: "live" } });
  await app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: h(admin), payload: liveGraph() });
  const src = async (body: Record<string, unknown>) => { const r = await app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: h(admin), payload: body }); expect(r.statusCode, r.body).toBe(200); };
  await src({ id: "req", label: "request log", kind: "app_security", asset_ids: ["api"], stale_after_seconds: 600 });
  await src({ id: "dbaudit", label: "database audit", kind: "db_audit", asset_ids: ["db"], stale_after_seconds: 600 });
  let n = 0;
  const send = (source: string, occMin: number, recvMin: number, extra: Record<string, unknown> = {}) => {
    const asset = source === "req" ? "api" : "db";
    ctx.store.receive("shop", source, { source_event_id: `${source}-${++n}`, occurred_at: at(occMin), asset_ids: [asset], action: source === "req" ? "request_received" : "data_access", outcome: "success", ...extra }, at(recvMin));
  };
  const drain = () => { while (ctx.store.processBatch().processed) { /* drain */ } };
  const history = async (qs: Record<string, string>) => {
    const r = await app.inject({ url: `/api/projects/shop/coverage/history?${new URLSearchParams(qs)}`, headers: h(ctx.viewer) });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { spans: { from: string; to: string; state: string; sources: { source_id: string; state: string; reason: string }[] }[]; totals_ms: Record<string, number> };
  };
  return { ctx, clock, send, drain, history };
}
const span = (r: { spans: { from: string; to: string; state: string }[] }) => r.spans.map((s) => `${s.from.slice(11, 16)}-${s.to.slice(11, 16)} ${s.state}`);

describe("R01.2 historical coverage answers the question asked", () => {
  it("healthy request logs do not imply database-read visibility", async () => {
    const { clock, send, drain, history } = await project();
    for (let m = 0; m <= 120; m += 5) send("req", m, m);
    drain(); clock.t = T0 + 121 * 60_000;
    const api = await history({ asset: "api", action: "request_received", after: at(0), before: at(120) });
    expect(api.totals_ms.unknown).toBe(0);
    const db = await history({ asset: "db", action: "data_access", after: at(0), before: at(120) });
    expect(span(db)).toEqual(["00:00-02:00 unknown"]);
    expect(db.spans[0]!.sources).toEqual([{ source_id: "dbaudit", state: "unknown", reason: expect.stringMatching(/silent/) }]); // the request log is not a database observer
  });

  it("current sensor restoration does not backfill an outage", async () => {
    const { ctx, clock, send, drain, history } = await project();
    for (let m = 0; m <= 90; m += 5) send("dbaudit", m, m);
    send("dbaudit", 30, 30, { action: "sensor_unavailable", outcome: "unknown" });
    send("dbaudit", 60, 60, { action: "sensor_restored", outcome: "unknown" });
    drain(); clock.t = T0 + 91 * 60_000;
    expect(ctx.store.evaluation("shop").coverage.find((c) => c.source_id === "dbaudit")!.state).toBe("healthy"); // healthy now
    const r = await history({ asset: "db", action: "data_access", after: at(0), before: at(90) });
    expect(span(r)).toEqual(["00:00-00:30 covered", "00:30-01:00 unknown", "01:00-01:30 covered"]);
    expect(r.spans[1]!.sources[0]!.reason).toMatch(/reported itself unavailable/);
  });

  it("liveness is judged by receipt, not by an event's claimed time", async () => {
    const { clock, send, drain, history } = await project();
    send("dbaudit", 0, 0);
    send("dbaudit", 60, 120); // claims to have happened at 01:00 but was only received at 02:00
    send("dbaudit", 600, 1); // a future-stamped event received at 00:01 does not keep the source alive either
    drain(); clock.t = T0 + 121 * 60_000;
    const r = await history({ asset: "db", action: "data_access", after: at(0), before: at(120) });
    expect(span(r)).toEqual(["00:00-00:11 covered", "00:11-02:00 unknown"]);
  });

  it("a bounded evaluation window cannot silently erase a quiet source's outage", async () => {
    const { ctx, clock, send, drain, history } = await project({ eventWindow: 5 });
    send("dbaudit", 0, 0, { action: "sensor_unavailable", outcome: "unknown", coverage_note: "audit permission revoked" });
    for (let m = 1; m <= 30; m++) send("req", m, m);
    drain(); clock.t = T0 + 31 * 60_000;
    const cov = ctx.store.evaluation("shop").coverage.find((c) => c.source_id === "dbaudit")!;
    expect(cov.state).toBe("offline");
    expect(cov.note).toBe("audit permission revoked");
    expect((await history({ asset: "db", action: "data_access", after: at(0), before: at(30) })).totals_ms.covered).toBe(0);
  });

  it("a disablement recorded late applies to its effective interval", async () => {
    const { ctx, clock, send, drain, history } = await project();
    for (let m = 0; m <= 90; m += 5) send("dbaudit", m, m);
    drain(); clock.t = T0 + 91 * 60_000;
    const off = await ctx.app.inject({ method: "POST", url: "/api/projects/shop/sources/dbaudit/state", headers: ctx.h(ctx.admin), payload: { disabled: true, expected_revision: 1, reason: "maintenance window recorded late", effective_at: at(20) } });
    expect(off.statusCode, off.body).toBe(200);
    const on = await ctx.app.inject({ method: "POST", url: "/api/projects/shop/sources/dbaudit/state", headers: ctx.h(ctx.admin), payload: { disabled: false, expected_revision: 2, reason: "back", effective_at: at(40) } });
    expect(on.statusCode, on.body).toBe(200);
    const r = await history({ asset: "db", action: "data_access", after: at(0), before: at(90) });
    expect(span(r)).toEqual(["00:00-00:20 covered", "00:20-00:40 unknown", "00:40-01:30 covered"]);
    expect(r.spans[1]!.sources[0]!.reason).toBe("administratively disabled");
  });

  it("capability limits, sampling and retention are explicit", async () => {
    const { ctx, clock, send, drain, history } = await project();
    const reg = (body: Record<string, unknown>) => ctx.app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: ctx.h(ctx.admin), payload: body });
    expect((await reg({ id: "dbaudit", label: "database audit", kind: "db_audit", asset_ids: ["db"], stale_after_seconds: 600, outcomes_reported: ["failure", "denied"], expected_revision: 1 })).statusCode).toBe(200);
    for (let m = 0; m <= 60; m += 5) send("dbaudit", m, m, { outcome: "failure" });
    drain(); clock.t = T0 + 61 * 60_000;
    const succ = await history({ asset: "db", action: "data_access", outcome: "success", after: at(0), before: at(60) });
    expect(succ.totals_ms.covered).toBe(0);
    expect(succ.spans.at(-1)!.sources[0]!.reason).toMatch(/reports only failure\/denied outcomes/);
    expect((await history({ asset: "db", action: "data_access", outcome: "failure", after: at(0), before: at(60) })).totals_ms.unknown).toBe(0);
    expect((await reg({ id: "dbaudit", label: "database audit", kind: "db_audit", asset_ids: ["db"], stale_after_seconds: 600, sampling_ratio: 0.1, expected_revision: 2 })).statusCode).toBe(200);
    clock.t = T0 + 63 * 60_000;
    const sampled = await history({ asset: "db", action: "data_access", after: at(61.5), before: at(62.5) });
    expect(sampled.spans[0]).toMatchObject({ state: "partial" });
    expect(sampled.spans[0]!.sources[0]!.reason).toMatch(/sampled at 0.1/);
    expect((await reg({ id: "dbaudit", label: "database audit", kind: "db_audit", asset_ids: ["db"], stale_after_seconds: 600, retention_days: 1, expected_revision: 3 })).statusCode).toBe(200);
    clock.t = T0 + 3 * 86_400_000;
    const old = await history({ asset: "db", action: "data_access", after: at(0), before: at(30) });
    expect(old.totals_ms.covered).toBe(0);
    expect(old.spans[0]!.sources[0]!.reason).toMatch(/beyond the source's 1-day retention/);
    for (const bad of [{ sampling_ratio: 0 }, { sampling_ratio: 2 }, { retention_days: -1 }, { outcomes_reported: ["maybe"] }]) {
      expect((await reg({ id: "dbaudit", label: "x", kind: "db_audit", asset_ids: ["db"], expected_revision: 4, ...bad })).statusCode).toBe(400);
    }
  });

  it("validates the question", async () => {
    const { ctx } = await project();
    for (const qs of ["asset=db&action=data_access", "asset=db&action=nope&after=2026-10-21T00:00:00Z&before=2026-10-21T01:00:00Z", "asset=db&action=data_access&after=2026-10-21T00:00:00Z&before=2026-01-21T01:00:00Z", "asset=db&action=data_access&after=2026-01-01T00:00:00Z&before=2026-10-21T01:00:00Z"]) {
      expect((await ctx.app.inject({ url: `/api/projects/shop/coverage/history?${qs}`, headers: ctx.h(ctx.viewer) })).statusCode).toBe(400);
    }
    expect((await ctx.app.inject({ url: "/api/projects/shop/coverage/history?asset=ghost&action=data_access&after=2026-10-21T00:00:00Z&before=2026-10-21T01:00:00Z", headers: ctx.h(ctx.viewer) })).statusCode).toBe(404);
  });
});
