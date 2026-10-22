/**
 * READ-ONLY diagnostic for legacy journal tombstones.
 *
 *   npx tsx scripts/diagnose-legacy-tombstones.ts <path/to/digital-kingdom.db> [--json]
 *
 * It copies the database (and any -wal file) to a temporary directory and inspects the COPY, so the
 * installation's files are never opened for writing. Stop the server first, or run it against a backup,
 * so the copy is consistent.
 *
 * It lists journal rows a legacy-minimization pass replaced with a tombstone (journal.minimized = 2) and
 * classifies them:
 *   - "v0.3.1-reserved-redaction": the tombstone reason names "_dk_redaction". This is consistent with
 *     the v0.3 -> v0.3.1 upgrade bug, but a v0.2 producer could also have sent that key.
 *   - "other": any other reason (unparseable or otherwise invalid legacy payload).
 * For each it reports whether the row was still pending at the checkpoint, and whether a normalized event
 * with the same source_event_id exists (a row processed before the upgrade still has its event).
 *
 * Limits: it cannot see original payload contents (they are gone from this database), cannot prove the
 * cause of a tombstone, and says nothing about data outside this file (backups, source systems).
 * It never modifies or "recovers" anything.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface TombstoneReport {
  database: string; checkpoint: number | null; tombstones: number;
  rows: { seq: number; project_id: string; source_id: string; source_event_id: string; classification: "v0.3.1-reserved-redaction" | "other"; reason: string; pending_at_checkpoint: boolean; normalized_event_exists: boolean; recovered: false }[];
  limits: string[];
}

export function diagnose(dbPath: string): TombstoneReport {
  const src = resolve(dbPath);
  if (!existsSync(src)) throw new Error(`no such database: ${src}`);
  const dir = mkdtempSync(join(tmpdir(), "dk-diagnose-"));
  try {
    const copy = join(dir, basename(src));
    copyFileSync(src, copy);
    if (existsSync(src + "-wal")) copyFileSync(src + "-wal", copy + "-wal");
    const db = new DatabaseSync(copy);
    const cols = (db.prepare("PRAGMA table_info(journal)").all() as { name: string }[]).map((c) => c.name);
    const limits = [
      "Original payload contents are not recoverable from this database.",
      "A _dk_redaction tombstone is consistent with the v0.3 -> v0.3.1 upgrade bug but does not prove it (a v0.2 producer could have sent that key).",
      "Nothing outside this file (backups, snapshots, source systems) was examined.",
      "This report recovers nothing; every row is reported as recovered: false.",
    ];
    if (!cols.includes("minimized")) { db.close(); return { database: src, checkpoint: null, tombstones: 0, rows: [], limits: ["This database predates v0.3.1 (no journal.minimized column): no legacy tombstones can exist yet.", ...limits.slice(2)] }; }
    const cp = (db.prepare("SELECT last_seq FROM checkpoints WHERE name = 'normalizer'").get() as { last_seq: number } | undefined)?.last_seq ?? 0;
    const rows = (db.prepare("SELECT seq, project_id, source_id, source_event_id, meta FROM journal WHERE minimized = 2 ORDER BY seq").all() as { seq: number; project_id: string; source_id: string; source_event_id: string; meta: string | null }[]).map((r) => {
      let reason = ""; try { reason = String((JSON.parse(r.meta ?? "{}") as { tombstone?: unknown }).tombstone ?? ""); } catch { reason = "unreadable meta"; }
      const ev = db.prepare("SELECT 1 FROM events WHERE project_id = ? AND source_id = ? AND json_extract(body, '$.source_event_id') = ? LIMIT 1").get(r.project_id, r.source_id, r.source_event_id);
      return { seq: r.seq, project_id: r.project_id, source_id: r.source_id, source_event_id: r.source_event_id, classification: (/_dk_redaction/.test(reason) ? "v0.3.1-reserved-redaction" : "other") as "v0.3.1-reserved-redaction" | "other", reason: reason.slice(0, 200), pending_at_checkpoint: r.seq > cp, normalized_event_exists: !!ev, recovered: false as const };
    });
    db.close();
    return { database: src, checkpoint: cp, tombstones: rows.length, rows, limits };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) { console.error("usage: diagnose-legacy-tombstones.ts <db> [--json]"); process.exit(2); }
  const r = diagnose(path);
  if (process.argv.includes("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log(`database: ${r.database}\ncheckpoint: ${r.checkpoint}\nlegacy tombstones: ${r.tombstones}`);
  for (const x of r.rows) console.log(`  seq ${x.seq}  ${x.project_id}/${x.source_id}  ${x.source_event_id}  ${x.classification}  ${x.pending_at_checkpoint ? "PENDING (never normalized)" : "processed before upgrade"}  event ${x.normalized_event_exists ? "exists" : "absent"}`);
  console.log("\nLimits:\n" + r.limits.map((l) => `  - ${l}`).join("\n"));
}
