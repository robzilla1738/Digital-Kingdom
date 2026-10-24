import { describe, expect, it } from "vitest";
import { setup, liveGraph } from "./helpers.ts";

/**
 * LP26.1 — historical coverage must reflect actual observer coverage.
 *
 * Defect (found by the LP26 comparison li-m6-c2c34916): a source registered at R whose first receipt arrived a few
 * milliseconds later was reported "silent for more than 600s (no receipts)" from the start of the question interval
 * to that first receipt, so every local-run coverage obligation came back `unavailable` while the observers were live.
 * Truly uncovered time (before registration, a source that never reported, a first report later than the freshness
 * threshold, the future) must stay unknown: missing evidence is never called healthy.
 */
const T0 = Date.parse("2026-10-20T19:00:00.000Z");
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();

async function project() {
  const clock = { t: T0 };
  const ctx = await setup({ store: { now: () => new Date(clock.t) } });
  const { app, admin, h } = ctx;
  await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "shop", name: "Shop", dataset_kind: "live" } });
  await app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: h(admin), payload: liveGraph() });
  const register = async (id: string, regSec: number) => {
    clock.t = T0 + regSec * 1000;
    const r = await app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: h(admin), payload: { id, label: id, kind: "db_audit", asset_ids: ["db"], stale_after_seconds: 600 } });
    expect(r.statusCode, r.body).toBe(200);
  };
  let n = 0;
  const send = (source: string, recvSec: number) => ctx.store.receive("shop", source, { source_event_id: `${source}-${++n}`, occurred_at: at(recvSec), asset_ids: ["db"], action: "data_access", outcome: "success" }, at(recvSec));
  const drain = () => { while (ctx.store.processBatch().processed) { /* drain */ } };
  const history = async (after: number, before: number, nowSec: number) => {
    drain(); clock.t = T0 + nowSec * 1000;
    const r = await app.inject({ url: `/api/projects/shop/coverage/history?${new URLSearchParams({ asset: "db", action: "data_access", after: at(after), before: at(before) })}`, headers: h(ctx.viewer) });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { spans: { from: string; to: string; state: string; sources: { source_id: string; state: string; reason: string }[] }[]; totals_ms: Record<string, number> };
  };
  return { register, send, history };
}

describe("LP26.1 coverage from registration reflects live observers", () => {
  it("a source registered at R that reports within its freshness threshold covers [R, ...) — not 'silent' before its first receipt", async () => {
    const { register, send, history } = await project();
    await register("dbaudit", 0);
    send("dbaudit", 0.005); // first receipt 5 ms after registration (the local world's observers)
    send("dbaudit", 30); send("dbaudit", 90);
    const r = await history(0, 120, 121);
    expect(r.totals_ms).toEqual({ covered: 120_000, partial: 0, unknown: 0 });
    expect(r.spans.flatMap((s) => s.sources.map((x) => x.reason)).join(" ")).not.toMatch(/silent/);
  });

  it("time before registration stays unknown", async () => {
    const { register, send, history } = await project();
    await register("dbaudit", 60);
    send("dbaudit", 60.01); send("dbaudit", 100);
    const r = await history(0, 120, 121);
    expect(r.totals_ms.unknown).toBe(60_000);
    expect(r.spans[0]).toMatchObject({ state: "unknown" });
    expect(r.spans[0]!.sources[0]!.reason).toBe("source not yet registered");
    expect(r.totals_ms.covered).toBe(60_000);
  });

  it("a source that never reported is never covered, even within its freshness threshold of registration", async () => {
    const { register, history } = await project();
    await register("dbaudit", 0);
    const r = await history(0, 120, 121);
    expect(r.totals_ms.covered).toBe(0);
    expect(r.spans[0]!.sources[0]!.reason).toMatch(/silent/);
  });

  it("a first report later than the freshness threshold does not vouch for the time before it", async () => {
    const { register, send, history } = await project();
    await register("dbaudit", 0);
    send("dbaudit", 900); // 15 min after registration with a 10 min threshold
    const r = await history(0, 1000, 1001);
    expect(r.totals_ms.unknown).toBe(900_000);
    expect(r.totals_ms.covered).toBe(100_000);
  });

  it("the future stays unknown", async () => {
    const { register, send, history } = await project();
    await register("dbaudit", 0);
    send("dbaudit", 0.005); send("dbaudit", 50);
    const r = await history(0, 120, 60);
    expect(r.totals_ms.covered).toBe(60_000);
    expect(r.totals_ms.unknown).toBe(60_000);
    expect(r.spans.at(-1)!.sources[0]!.reason).toBe("in the future");
  });
});
