import { describe, expect, it } from "vitest";
import { setup, liveGraph } from "./helpers.ts";

/**
 * M6b CI stabilisation — an outage reported for one asset must not be ended by a restoration reported for another.
 *
 * Defect (CI run 40064260489, examples/reference-app/lp06-world.test.ts:161; reproduced locally 3/60): the LP06
 * audit observer watches two assets (tenant-db, artifacts) and reports sensor_unavailable / sensor_restored once per
 * asset. Historical coverage paired those health reports per SOURCE, not per asset, so when the artifacts
 * restoration was stamped one millisecond before the tenant-db restoration, the tenant-db outage "ended" early and
 * the last millisecond of a deliberate outage was reported covered. Not caused by LP26.1 (pre-existing since R01;
 * aef7f12 and bab16d8 have identical code, the race only depends on which millisecond each report lands in).
 * Outage time must never count as covered.
 */
const T0 = Date.parse("2026-10-20T19:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

async function project() {
  const clock = { t: T0 };
  const ctx = await setup({ store: { now: () => new Date(clock.t) } });
  const { app, admin, h } = ctx;
  await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "shop", name: "Shop", dataset_kind: "live" } });
  await app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: h(admin), payload: liveGraph() });
  const r = await app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: h(admin), payload: { id: "audit", label: "audit", kind: "db_audit", asset_ids: ["db", "api"], allowed_actions: ["data_access", "sensor_unavailable", "sensor_restored"], stale_after_seconds: 600 } });
  expect(r.statusCode, r.body).toBe(200);
  let n = 0;
  const send = (action: string, asset_ids: string[], ms: number) => ctx.store.receive("shop", "audit", { source_event_id: `e-${++n}`, occurred_at: at(ms), asset_ids, action, outcome: action === "data_access" ? "success" : "unknown" }, at(ms));
  const history = async (asset: string, after: number, before: number, nowMs: number) => {
    while (ctx.store.processBatch().processed) { /* drain */ }
    clock.t = T0 + nowMs;
    const q = await app.inject({ url: `/api/projects/shop/coverage/history?${new URLSearchParams({ asset, action: "data_access", after: at(after), before: at(before) })}`, headers: h(ctx.viewer) });
    expect(q.statusCode, q.body).toBe(200);
    return q.json() as { spans: { from: string; to: string; state: string; sources: { source_id: string; state: string; reason: string }[] }[]; totals_ms: Record<string, number> };
  };
  return { send, history };
}

describe("M6b: per-asset outage pairing in historical coverage", () => {
  it("the other asset's restoration one millisecond earlier does not end this asset's outage (CI 40064260489 shape)", async () => {
    const { send, history } = await project();
    send("data_access", ["db"], 5);
    send("sensor_unavailable", ["db"], 1000); send("sensor_unavailable", ["api"], 1000);
    send("sensor_restored", ["api"], 1024); send("sensor_restored", ["db"], 1025); // artifacts-before-tenant-db order
    send("data_access", ["db"], 1030);
    const r = await history("db", 1000, 1025, 2000);
    expect(r.totals_ms).toEqual({ covered: 0, partial: 0, unknown: 25 });
    expect(r.spans.every((s) => s.state === "unknown")).toBe(true);
    expect(r.spans[0]!.sources).toContainEqual({ source_id: "audit", state: "unknown", reason: "source reported itself unavailable" });
  });

  it("each asset's outage is placed from its own reports; outside the outage the source covers again", async () => {
    const { send, history } = await project();
    send("data_access", ["db"], 5);
    send("sensor_unavailable", ["api"], 900); send("sensor_unavailable", ["db"], 1000);
    send("sensor_restored", ["api"], 1024); send("sensor_restored", ["db"], 1100);
    expect((await history("db", 0, 2000, 3000)).totals_ms).toEqual({ covered: 1900, partial: 0, unknown: 100 });
    expect((await history("api", 0, 2000, 3000)).totals_ms).toEqual({ covered: 1876, partial: 0, unknown: 124 });
  });

  it("one outage report naming both assets applies to each; restoring one leaves the other unknown until the end (not restored)", async () => {
    const { send, history } = await project();
    send("data_access", ["db"], 5);
    send("sensor_unavailable", ["db", "api"], 1000); send("sensor_restored", ["api"], 1010); // restoring api does not restore db
    const db = await history("db", 0, 2000, 3000);
    expect(db.totals_ms.covered).toBe(1000);
    expect(db.totals_ms.unknown).toBe(1000);
    const api = await history("api", 0, 2000, 3000);
    expect(api.totals_ms.unknown).toBe(10);
  });
});
