/**
 * R01.5 search benchmark. Generates N synthetic events directly into a fresh SQLite database (bypassing
 * ingestion, which is measured separately in R10.2), then times the investigation queries.
 *
 *   pnpm tsx scripts/bench-search.ts 10000 100000 1000000 > docs/roadmap/R01.5-BENCHMARK.json
 *
 * Everything here is synthetic. Results depend on the machine; the JSON records it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, cpus, totalmem, arch, platform } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { openDb } from "../apps/server/src/db.ts";
import { Store } from "../apps/server/src/store.ts";
import { parseSearchQuery, searchEvents } from "../apps/server/src/investigate.ts";

const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0);
const graph = {
  schema_version: "0.2", dataset_kind: "live", project_id: "bench", graph_revision: "r1",
  assets: ["edge", "api", "auth", "db", "worker"].map((id) => ({ id, name: id, kind: id === "db" ? "database" : id === "edge" ? "edge" : id === "auth" ? "auth" : "service", environment: "prod", allowed_zone_ids: [id === "db" ? "data" : id === "edge" ? "public" : "application"], source_refs: ["bench"] })),
  relationships: [],
};
const ACTIONS = ["request_received", "authentication", "data_access", "waf_match"];
const SOURCES = ["edge", "app", "auth", "db"];
const T0 = Date.parse("2026-09-01T00:00:00Z");
const DAYS = 30;

function time<T>(fn: () => T, reps = 3): { ms: number; result: T } {
  let best = Infinity; let result!: T;
  for (let i = 0; i < reps; i++) { const t = performance.now(); result = fn(); best = Math.min(best, performance.now() - t); }
  return { ms: Math.round(best * 10) / 10, result };
}

const out: Record<string, unknown> = {
  machine: { cpu: (cpus()[0]?.model && cpus()[0]!.model !== "unknown" ? cpus()[0]!.model : undefined) || (() => { try { return /Model name:\s*(.+)/.exec(execSync("lscpu", { encoding: "utf8" }))?.[1]?.trim() ?? "unknown"; } catch { return "unknown"; } })(), cores: cpus().length, memory_gb: Math.round(totalmem() / 2 ** 30), arch: arch(), platform: platform(), node: process.version },
  note: "Synthetic events inserted directly; best of 3 runs per query; single process, file-backed SQLite (WAL, synchronous=FULL).",
  runs: [] as unknown[],
};

for (const n of sizes) {
  const dir = mkdtempSync(join(tmpdir(), "dk-bench-"));
  const db = openDb(join(dir, "db.sqlite"));
  const store = new Store(db, { now: () => new Date(T0 + (DAYS + 1) * 86_400_000) });
  store.createProject("bench", "Bench", "live");
  store.putGraph("bench", graph as never, "bench");
  for (const s of SOURCES) store.upsertSource("bench", { id: s, label: s, kind: "generic", asset_ids: ["edge", "api", "auth", "db", "worker"], stale_after_seconds: 3600 }, "bench");
  const ins = db.prepare("INSERT INTO events (id, seq, project_id, source_id, occurred_at, received_at, action, outcome, asset_ids, body) VALUES (?, ?, 'bench', ?, ?, ?, ?, ?, ?, ?)");
  const t0 = performance.now();
  db.exec("BEGIN");
  for (let i = 0; i < n; i++) {
    const occ = new Date(T0 + Math.floor((i / n) * DAYS * 86_400_000)).toISOString();
    const src = SOURCES[i % SOURCES.length]!, action = ACTIONS[i % ACTIONS.length]!, asset = graph.assets[i % 5]!.id;
    const id = `ev_${i.toString(36).padStart(8, "0")}`;
    const e = { schema_version: "0.2", dataset_kind: "live", id, project_id: "bench", source_id: src, occurred_at: occ, received_at: occ, asset_ids: [asset], action, outcome: i % 7 === 0 ? "failure" : "success", actor_ref: `acct-${i % 5000}`, session_ref: `s-${i % 20000}`, request_id: `req-${i}`, client_ip: `198.51.100.${i % 250}`, route: `/r/${i % 300}`, evidence_refs: [] };
    ins.run(id, i + 1, src, occ, occ, action, e.outcome, JSON.stringify([asset]), JSON.stringify(e));
    if (i % 50_000 === 49_999) { db.exec("COMMIT"); db.exec("BEGIN"); }
  }
  db.exec("COMMIT");
  const insertMs = Math.round(performance.now() - t0);
  db.exec("ANALYZE");
  const q = (extra: Record<string, string>, days = 7) => parseSearchQuery({ after: new Date(T0 + 10 * 86_400_000).toISOString(), before: new Date(T0 + (10 + days) * 86_400_000).toISOString(), limit: "50", ...extra }).query;
  const cases: Record<string, ReturnType<typeof q>> = {
    "7 days, no filter": q({}),
    "31 days, no filter": q({}, 20),
    "7 days, actor_ref": q({ actor_ref: "acct-42" }),
    "7 days, session_ref": q({ session_ref: "s-4242" }),
    "7 days, action=authentication": q({ action: "authentication" }),
    "7 days, asset_id=db": q({ asset_id: "db" }),
    "7 days, client_ip": q({ client_ip: "198.51.100.7" }),
  };
  const results: Record<string, unknown> = {};
  for (const [name, query] of Object.entries(cases)) {
    const r = time(() => searchEvents(store, "bench", query, "bench-secret"));
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM events WHERE project_id = 'bench' AND occurred_at >= ? AND occurred_at <= ?${query.fields.actor_ref ? " AND json_extract(body, '$.actor_ref') = ?" : ""} ORDER BY occurred_at, id LIMIT 51`).all(query.after, query.before, ...(query.fields.actor_ref ? [query.fields.actor_ref] : [])) as { detail: string }[];
    results[name] = { ms: r.ms, matching: (r.result as { query_completeness: { matching_in_snapshot: unknown } }).query_completeness.matching_in_snapshot, returned: (r.result as { events: unknown[] }).events.length, plan: plan.map((p) => p.detail) };
  }
  const evalMs = time(() => store.evaluation("bench"), 1).ms;
  (out.runs as unknown[]).push({ events: n, insert_ms: insertMs, db_mb: Math.round((db.prepare("SELECT page_count * page_size AS b FROM pragma_page_count(), pragma_page_size()").get() as { b: number }).b / 2 ** 20), searches: results, current_coverage_ms: evalMs });
  db.close();
  rmSync(dir, { recursive: true, force: true });
  process.stderr.write(`done ${n}\n`);
}
console.log(JSON.stringify(out, null, 2));
