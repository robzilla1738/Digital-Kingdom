/**
 * R10.2 soak/fault measurement: N events from three sources (one noisy) into a fresh file database, processed
 * by the worker loop, then an encrypted backup and verified restore. Prints timings used in docs/OPERATIONS_RECOVERY.md.
 * Usage: pnpm soak [events=100000]
 */
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../apps/server/src/db.ts";
import { Store } from "../apps/server/src/store.ts";
import { createBackup, restoreBackup } from "../apps/server/src/backup.ts";

const N = Number(process.argv[2] ?? 100_000);
const dir = mkdtempSync(join(tmpdir(), "dk-soak-"));
const store = new Store(openDb(join(dir, "digital-kingdom.db")), { sourceBudgetPerMinute: Math.ceil(N * 0.5) });
store.createProject("soak", "Soak", "live");
store.putGraph("soak", { schema_version: "0.2", dataset_kind: "live", project_id: "soak", graph_revision: "r1", assets: ["a", "b", "c"].map((id) => ({ id, name: id, kind: "service", environment: "prod", allowed_zone_ids: ["application"], source_refs: ["m"] })), relationships: [] } as never, "soak");
for (const s of ["noisy", "q1", "q2"]) store.upsertSource("soak", { id: s, label: s, kind: "app_security", asset_ids: [s === "noisy" ? "a" : s === "q1" ? "b" : "c"] } as never, "soak");
const t0 = Date.now(); let accepted = 0, throttled = 0;
const base = Date.now() - 3600_000;
for (let i = 0; i < N; i++) {
  const src = i % 10 < 8 ? "noisy" : i % 10 === 8 ? "q1" : "q2";
  if (!store.admit("soak", src)) { throttled++; continue; }
  const r = store.receive("soak", src, { source_event_id: `e${i}`, occurred_at: new Date(base + i).toISOString(), asset_ids: [src === "noisy" ? "a" : src === "q1" ? "b" : "c"], action: "request_received", outcome: "allowed" });
  if (r.status === "accepted") accepted++;
}
const ingestMs = Date.now() - t0;
const t1 = Date.now(); while (store.processBatch(1000).processed) { /* worker */ }
const processMs = Date.now() - t1;
const t2 = Date.now(); const { file } = createBackup(store.db, "soak-test-passphrase"); const backupMs = Date.now() - t2;
const t3 = Date.now(); const rep = restoreBackup(file, "soak-test-passphrase", join(dir, "restored.db")); const restoreMs = Date.now() - t3;
console.log(JSON.stringify({ events_offered: N, accepted, throttled, ingest_ms: ingestMs, ingest_per_s: Math.round(accepted / (ingestMs / 1000)), process_ms: processMs, process_per_s: Math.round(accepted / (processMs / 1000)), db_bytes: statSync(join(dir, "digital-kingdom.db")).size, backup_bytes: file.length, backup_ms: backupMs, restore_ms: restoreMs, restore_ok: rep.ok }, null, 1));
rmSync(dir, { recursive: true, force: true });
