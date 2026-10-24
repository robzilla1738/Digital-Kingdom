import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import { join } from "node:path";
import { compileWorld, composeMission, draftFromScenario, instantiateBlueprint } from "../../packages/local-world/src/index.ts";
import { buildApp } from "../../apps/server/src/app.ts";
import { openDb } from "../../apps/server/src/db.ts";
import { Store } from "../../apps/server/src/store.ts";
import { runMission } from "./src/world/mission.ts";
import { RUN_OPTIONS, VARIANT_FAMILIES, type Doc } from "../../eval/local/variants.ts";

/**
 * LP30 — local robustness measurements: repeated mission start/run/stop/cleanup cycles, restart/replay equivalence,
 * LP27 fault variants run as missions, surfaced cleanup failure, and runtime egress. Numbers are recorded for THIS
 * environment only (see report.environment); budgets are generous bounds, not performance claims.
 */
const ROOT = join(import.meta.dirname, "../..");
// The committed report was produced with DK_LP30_REPORT_DIR=artifacts/phase-local-intelligence/M7; by default the test
// writes to the ignored artifacts/tmp so `pnpm test` never dirties the tree (release:verify requires a clean build tree).
const OUT = join(ROOT, process.env.DK_LP30_REPORT_DIR ?? "artifacts/tmp/lp30");
const lw = (id: string): Doc => JSON.parse(readFileSync(join(ROOT, `scenarios/local-world/dsl/${id}.scenario.json`), "utf8"));
const report: Record<string, unknown> = { schema: "dk.lp30.robustness.v1", environment: { platform: os.platform(), arch: os.arch(), cpus: os.cpus().length, cpu_model: os.cpus()[0]?.model ?? "unknown", total_mem_mb: Math.round(os.totalmem() / 2 ** 20), node: process.version, note: "sandbox measurements; not a hardware benchmark" } };
afterAll(() => { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, "lp30-robustness-report.json"), JSON.stringify(report, null, 2)); });

async function server() {
  const store = new Store(openDb(":memory:"));
  const admin = store.createToken("lp30 admin", "admin").token, analyst = store.createToken("lp30 analyst", "analyst").token;
  const app = await buildApp({ store, secret: "lp30", demoMode: false, webDist: "/nonexistent" });
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  const req = async (token: string, method: string, path: string, body?: unknown) => { const r = await fetch(`${url}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json() as any }; }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const drain = () => { for (let i = 0; i < 200 && store.processBatch(200).processed; i++) { /* drain */ } };
  return { store, app, url, admin, analyst, req, drain, close: async () => { await app.close(); store.db.close(); } };
}
const resources = () => process.getActiveResourcesInfo().filter((r) => r !== "TTYWrap").length;
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)]!;

describe("LP30-A2: repeated local mission cycles are bounded and cleanup is surfaced", () => {
  it("8 start/run/stop/cleanup cycles of one mission: all complete, identical step outcomes, bounded resources and memory, loopback-only egress", async () => {
    const s = await server();
    const destinations: string[] = [];
    const orig = net.Socket.prototype.connect;
    (net.Socket.prototype as any).connect = function (this: net.Socket, ...args: any[]) { const o = args[0]; destinations.push(typeof o === "object" && o ? String(o.host ?? o.path ?? "localhost") : String(args[1] ?? "localhost")); return (orig as any).apply(this, args); }; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const draft = draftFromScenario(lw("LW-01") as never);
      expect((await s.req(s.analyst, "POST", "/api/local-missions", { draft })).status).toBe(201);
      const base = resources(); const heap0 = process.memoryUsage().heapUsed;
      const cycles: Record<string, unknown>[] = []; const outcomes: string[] = [];
      for (let i = 0; i < 8; i++) {
        const t0 = performance.now();
        const r = await runMission(draft, { dk: { url: s.url, adminToken: s.admin }, missionId: draft.id, drain: s.drain });
        const ms = performance.now() - t0;
        outcomes.push(JSON.stringify(r.truth.steps.map((x) => [x.index, x.outcome, x.status])) + JSON.stringify(r.truth.effects.map((e) => [e.step, e.resource_id, e.action])));
        cycles.push({ cycle: i, status: r.status, wall_ms: Math.round(ms), active_resources: resources(), heap_mb: +(process.memoryUsage().heapUsed / 2 ** 20).toFixed(1), cleanup: r.world.run.cleanupRecord.outcome });
      }
      const rec = (await s.req(s.admin, "GET", `/api/local-missions/${draft.id}`)).json;
      const walls = cycles.map((c) => c.wall_ms as number);
      const resDelta = resources() - base, heapDeltaMb = (process.memoryUsage().heapUsed - heap0) / 2 ** 20;
      const nonLoopback = destinations.filter((d) => !["127.0.0.1", "localhost", "::1"].includes(d));
      report.cycles = { conditions: "one in-process server (in-memory DB), 8 sequential runMission cycles of LW-01 (13 steps) at time scale 0", cycles, wall_ms: { min: Math.min(...walls), p95: p95(walls), max: Math.max(...walls) }, active_resources: { baseline: base, after: resources(), delta: resDelta }, heap_delta_mb: +heapDeltaMb.toFixed(1), runs_recorded: rec.runs.length, egress: { connections: destinations.length, distinct: [...new Set(destinations)], non_loopback: nonLoopback } };
      expect(cycles.every((c) => c.status === "complete" && c.cleanup === "completed")).toBe(true);
      expect(new Set(outcomes).size, "restart/replay: every cycle has identical step outcomes and effects").toBe(1);
      expect(rec.runs).toHaveLength(8);
      expect(rec.runs.every((r: { status: string; cleanup: { outcome: string } }) => r.status === "complete" && r.cleanup.outcome === "completed")).toBe(true);
      expect(resDelta, "no listeners/sockets/timers left behind").toBeLessThanOrEqual(4);
      expect(heapDeltaMb).toBeLessThan(200);
      expect(p95(walls)).toBeLessThan(15_000);
      expect(nonLoopback, "runtime egress stays on loopback").toEqual([]);
    } finally { net.Socket.prototype.connect = orig; await s.close(); }
  }, 120_000);

  it("a cleanup failure (an unowned file in the run directory) is surfaced on the mission run, never reported as completed", async () => {
    const s = await server();
    try {
      const draft = draftFromScenario(lw("LW-03") as never, "verify");
      expect((await s.req(s.analyst, "POST", "/api/local-missions", { draft })).status).toBe(201);
      const r = await runMission(draft, { dk: { url: s.url, adminToken: s.admin }, missionId: draft.id, drain: s.drain, onWorld: (w) => writeFileSync(join(w.run.dir, "operator-left-this.txt"), "not owned by the run") });
      const rec = (await s.req(s.admin, "GET", `/api/local-missions/${draft.id}`)).json;
      report.cleanup_failure = { run_status: r.status, supervisor_outcome: r.world.run.cleanupRecord.outcome, failures: r.world.run.cleanupRecord.failures.map((f) => f.reason), mission_run_cleanup: rec.runs[0].cleanup };
      expect(r.world.run.cleanupRecord.outcome).toBe("failed");
      expect(rec.runs[0].cleanup).toEqual({ outcome: "failed", failures: r.world.run.cleanupRecord.failures.length });
      expect(rec.runs[0].cleanup.failures).toBeGreaterThan(0);
    } finally { await s.close(); }
  }, 60_000);
});

describe("LP30-A2: LP27 fault variants run as local missions", () => {
  it("observer outage, dropped evidence and a partial run compose as missions, run, and are recorded with honest status", async () => {
    const s = await server();
    try {
      const rows: Record<string, unknown>[] = [];
      for (const id of ["V01", "V04", "V07", "V24"]) {
        const f = VARIANT_FAMILIES.find((x) => x.id === id)!;
        const d = lw(f.base); const v = { ...f.apply(d, compileWorld(instantiateBlueprint(d.blueprint, { seed: d.seed } as never))), id: `${d.id}.${f.id}` };
        const draft = { ...draftFromScenario(v as never, "verify"), id: `mission-${id.toLowerCase()}` };
        const c = composeMission(draft);
        expect(c.ok, `${id} ${c.ok ? "" : c.issues.join("; ")}`).toBe(true);
        expect((await s.req(s.analyst, "POST", "/api/local-missions", { draft })).status).toBe(201);
        const t0 = performance.now();
        const r = await runMission(draft, { dk: { url: s.url, adminToken: s.admin }, missionId: draft.id, drain: s.drain, run: RUN_OPTIONS[id] ?? {} });
        const rec = (await s.req(s.admin, "GET", `/api/local-missions/${draft.id}`)).json;
        rows.push({ variant: id, category: f.category, steps: draft.scenario.steps.length, status: r.status, executed: r.accounting.executed!.length, refused: r.accounting.refused!.length, failed: r.accounting.failed!.length, not_run: r.accounting.not_run!.length, wall_ms: Math.round(performance.now() - t0), mission_run_status: rec.runs[0].status, cleanup: rec.runs[0].cleanup.outcome });
        expect(rec.runs[0].status).toBe(r.status);
        expect(rec.runs[0].cleanup.outcome).toBe("completed");
        expect(r.accounting.executed!.length + r.accounting.refused!.length + r.accounting.failed!.length + r.accounting.not_run!.length).toBe(draft.scenario.steps.length);
      }
      report.variants = rows;
      expect(rows.find((x) => x.variant === "V24")).toMatchObject({ status: "partial", mission_run_status: "partial" });
      expect((rows.find((x) => x.variant === "V24")!.not_run as number)).toBeGreaterThan(0);
      for (const id of ["V01", "V04", "V07"]) expect(rows.find((x) => x.variant === id)!.status).toBe("complete");
    } finally { await s.close(); }
  }, 120_000);
});
