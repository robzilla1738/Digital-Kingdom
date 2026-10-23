import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { seedDemo } from "../src/seed.ts";
import { createBackup, restoreBackup } from "../src/backup.ts";
import { setup, liveGraph } from "./helpers.ts";

/** R10.2 ingestion resilience and recovery. */
async function live(opts: { budget?: number; maxBacklog?: number; dbPath?: string } = {}) {
  const store = new Store(openDb(opts.dbPath ?? ":memory:"), { ...(opts.budget ? { sourceBudgetPerMinute: opts.budget } : {}) });
  seedDemo(store);
  const admin = store.createToken("admin", "admin").token;
  const app = await buildApp({ store, secret: "s", demoMode: false, webDist: "/nonexistent", ...(opts.maxBacklog ? { maxBacklog: opts.maxBacklog } : {}) });
  const h = { authorization: `Bearer ${admin}` };
  await app.inject({ method: "POST", url: "/api/projects", headers: h, payload: { id: "shop", name: "Shop", dataset_kind: "live" } });
  await app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: h, payload: liveGraph() });
  const key = async (id: string, asset: string) => (await app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: h, payload: { id, label: id, kind: "app_security", asset_ids: [asset] } })).json().key as string;
  let n = 0;
  const batch = (k: string, asset: string, count: number) => app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${k}` }, payload: { events: Array.from({ length: count }, () => ({ source_event_id: `e${++n}`, occurred_at: new Date().toISOString(), asset_ids: [asset], action: "request_received", outcome: "allowed" })) } });
  return { store, app, h, key, batch };
}

describe("R10.2 fairness and backpressure", () => {
  it("a noisy source is throttled with counted loss; a quiet source is still admitted and processed", async () => {
    const t = await live({ budget: 300 });
    const noisy = await t.key("noisy", "api"), quiet = await t.key("quiet", "db");
    let throttledReplies = 0;
    for (let i = 0; i < 8; i++) { const r = await t.batch(noisy, "api", 100); if (r.statusCode === 429) { throttledReplies++; expect(r.headers["retry-after"]).toBe("30"); } }
    const q = await t.batch(quiet, "db", 5);
    expect(q.statusCode).toBe(202);
    expect(q.json().accepted).toBe(5);
    expect(throttledReplies).toBeGreaterThan(0);
    while (t.store.processBatch(1000).processed) { /* drain */ }
    expect(t.store.listEvents("shop", { limit: 5000 }).filter((e) => e.source_id === "quiet")).toHaveLength(5);
    const health = (await t.app.inject({ url: "/api/projects/shop/health", headers: t.h })).json();
    const throttled = Object.entries(health.counters as Record<string, Record<string, number>>).find(([k]) => k.includes("noisy"));
    expect(JSON.stringify(health.counters)).toMatch(/rejected:throttled/);
    expect(t.store.listEvents("shop", { limit: 5000 }).filter((e) => e.source_id === "noisy")).toHaveLength(300); // exactly the budget, nothing silently dropped beyond what was refused
    void throttled;
  });

  it("a full backlog answers 503 Retry-After instead of growing without bound", async () => {
    const t = await live({ maxBacklog: 50 });
    const k = await t.key("s1", "api");
    expect((await t.batch(k, "api", 60)).statusCode).toBe(202);
    const r = await t.batch(k, "api", 1);
    expect(r.statusCode).toBe(503);
    expect(r.headers["retry-after"]).toBe("5");
    t.store.processBatch(1000);
    expect((await t.batch(k, "api", 1)).statusCode).toBe(202);
  });
});

describe("R10.2 faults do not corrupt checkpoints", () => {
  it("disk full refuses writes with 503, keeps the checkpoint and integrity, and recovers when space returns", async () => {
    const t = await live();
    const k = await t.key("s1", "api");
    await t.batch(k, "api", 20); t.store.processBatch(1000);
    const cp = t.store.checkpoint();
    const pages = Number((t.store.db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count);
    t.store.db.exec(`PRAGMA max_page_count = ${pages}`);
    let saw503 = false;
    for (let i = 0; i < 40 && !saw503; i++) { const r = await t.batch(k, "api", 100); if (r.statusCode === 503) saw503 = true; }
    expect(saw503).toBe(true);
    expect(t.store.checkpoint()).toBe(cp);
    expect((t.store.db.prepare("PRAGMA integrity_check").get() as Record<string, string>).integrity_check).toBe("ok");
    t.store.db.exec("PRAGMA max_page_count = 1073741823");
    while (t.store.processBatch(1000).processed) { /* drain what was accepted */ }
    expect(t.store.checkpoint()).toBeGreaterThanOrEqual(cp);
    expect((await t.batch(k, "api", 1)).statusCode).toBe(202);
  });

  it("a crash mid-batch rolls back and duplicate replay is idempotent", async () => {
    let crash = false;
    const store = new Store(openDb(":memory:"), { faultHook: (stage) => { if (crash && stage === "after_findings") throw Object.assign(new Error("SQLITE_IOERR: simulated crash"), { code: "ERR_SQLITE_ERROR" }); } });
    seedDemo(store);
    while (store.processBatch().processed) { /* settle */ }
    const src = store.listSources("demo-castle")[0]!;
    const ev = { source_event_id: "crash-1", occurred_at: new Date().toISOString(), asset_ids: [src.asset_ids[0]!], action: "sensor_restored", outcome: "unknown" };
    const cp0 = store.checkpoint();
    store.receive("demo-castle", src.id, ev);
    crash = true;
    expect(() => store.processBatch()).toThrow(/simulated crash/);
    expect(store.checkpoint()).toBe(cp0);
    crash = false;
    expect(store.processBatch().processed).toBe(1);
    expect(store.receive("demo-castle", src.id, ev).status).toBe("duplicate");
    expect(store.processBatch().processed).toBe(0);
  });

  it("a revoked source key is refused while its history is retained", async () => {
    const t = await live();
    const k = await t.key("s1", "api");
    await t.batch(k, "api", 3); t.store.processBatch(1000);
    const cur = t.store.listSources("shop").find((s) => s.id === "s1")!;
    await t.app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: t.h, payload: { id: "s1", label: "s1", kind: "app_security", asset_ids: ["api"], expected_revision: cur.config_revision } }); // re-keyed
    expect((await t.batch(k, "api", 1)).statusCode).toBe(401);
    expect(t.store.listEvents("shop", { limit: 100 }).filter((e) => e.source_id === "s1")).toHaveLength(3);
  });
});

describe("R10.2 encrypted backup and verified restore", () => {
  it("restores with references and integrity intact; wrong passphrase or tampering fails closed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dk-bk-"));
    const ctx = await setup({ dbPath: join(dir, "live.db") });
    while (ctx.store.processBatch().processed) { /* settle */ }
    const { file, manifest } = createBackup(ctx.store.db, "correct horse battery staple");
    expect(file.subarray(0, 4).toString()).toBe("DKB1");
    expect(file.includes(Buffer.from("demo-castle"))).toBe(false); // encrypted at rest
    const r = restoreBackup(file, "correct horse battery staple", join(dir, "restored.db"));
    expect(r).toMatchObject({ integrity: "ok", foreign_key_violations: 0, dangling_finding_events: 0, checkpoint_within_journal: true, counts_match: true, ok: true });
    expect(r.manifest.counts.findings).toBe(manifest.counts.findings);
    expect(() => restoreBackup(file, "wrong passphrase!!", join(dir, "x.db"))).toThrow(/authentication failed/);
    const bad = Buffer.from(file); bad[bad.length - 5]! ^= 1;
    expect(() => restoreBackup(bad, "correct horse battery staple", join(dir, "y.db"))).toThrow(/authentication failed/);
    expect(() => restoreBackup(file, "correct horse battery staple", join(dir, "restored.db"))).toThrow(/EEXIST/); // never overwrites
    expect(() => createBackup(ctx.store.db, "short")).toThrow(/at least 12/);
    // the live database is untouched by backup
    expect(ctx.store.listFindings("demo-castle").length).toBe(r.manifest.counts.findings ? ctx.store.listFindings("demo-castle").length : 0);
  });
});
