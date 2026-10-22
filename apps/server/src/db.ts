import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Single-node durable store (SQLite, WAL, synchronous=FULL). The schema mirrors the PostgreSQL design in
 * docs/ARCHITECTURE.md (relational graph tables, indexed event envelopes, findings, checkpoints, outbox);
 * moving to PostgreSQL is a storage-adapter change behind the Store class, not a contract change.
 */
export type DB = DatabaseSync;

const MIGRATIONS: string[] = [
  `CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, dataset_kind TEXT NOT NULL CHECK (dataset_kind IN ('synthetic','live')), created_at TEXT NOT NULL, meta TEXT);
   CREATE TABLE graph_revisions (project_id TEXT NOT NULL, revision TEXT NOT NULL, graph TEXT NOT NULL, created_at TEXT NOT NULL, current INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (project_id, revision));
   CREATE TABLE scenes (project_id TEXT NOT NULL, graph_revision TEXT NOT NULL, scene TEXT NOT NULL, proposal TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (project_id, graph_revision));
   CREATE TABLE sources (id TEXT NOT NULL, project_id TEXT NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL, asset_ids TEXT NOT NULL, trusts_request_ids INTEGER NOT NULL DEFAULT 0, stale_after_seconds INTEGER, key_hash TEXT UNIQUE, created_at TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (project_id, id));
   CREATE TABLE journal (seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, source_id TEXT NOT NULL, source_event_id TEXT NOT NULL, payload TEXT NOT NULL, received_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1, UNIQUE (project_id, source_id, source_event_id));
   CREATE TABLE events (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, project_id TEXT NOT NULL, source_id TEXT NOT NULL, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL, asset_ids TEXT NOT NULL, body TEXT NOT NULL);
   CREATE INDEX events_project_time ON events (project_id, occurred_at);
   CREATE TABLE evidence (ref TEXT PRIMARY KEY, project_id TEXT NOT NULL, event_id TEXT NOT NULL, body TEXT NOT NULL, redacted INTEGER NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE findings (id TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL, content_digest TEXT NOT NULL, body TEXT NOT NULL, lifecycle TEXT NOT NULL DEFAULT 'open', disposition TEXT NOT NULL DEFAULT 'unreviewed', updated_at TEXT NOT NULL, PRIMARY KEY (project_id, id));
   CREATE TABLE finding_revisions (project_id TEXT NOT NULL, finding_id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (project_id, finding_id, revision));
   CREATE TABLE analyst_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, finding_id TEXT NOT NULL, author TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE checkpoints (name TEXT PRIMARY KEY, last_seq INTEGER NOT NULL);
   CREATE TABLE outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE INDEX outbox_project ON outbox (project_id, seq);
   CREATE TABLE counters (project_id TEXT NOT NULL, source_id TEXT NOT NULL, metric TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (project_id, source_id, metric));
   CREATE TABLE rejections (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, source_id TEXT NOT NULL, stage TEXT NOT NULL, reason TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE api_tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('viewer','analyst','admin')), token_hash TEXT NOT NULL UNIQUE, project_ids TEXT NOT NULL DEFAULT '*', created_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, token_id TEXT NOT NULL, expires_at TEXT NOT NULL);
   CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, project_id TEXT, target TEXT, detail TEXT);
   CREATE TABLE containment_requests (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, finding_id TEXT NOT NULL, action_id TEXT NOT NULL, requested_by TEXT NOT NULL, rationale TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')), decided_by TEXT, created_at TEXT NOT NULL, decided_at TEXT);`,
];

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set((db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version));
  MIGRATIONS.forEach((sql, i) => {
    const v = i + 1;
    if (applied.has(v)) return;
    tx(db, () => { db.exec(sql); db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(v, new Date().toISOString()); });
  });
  return db;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { try { db.exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
}
