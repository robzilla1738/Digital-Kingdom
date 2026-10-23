import { CONTROLS_MIGRATION } from "./controls.ts";
import { BUNDLES_MIGRATION, CASES_MIGRATION, CONNECTORS_MIGRATION, FACTS_MIGRATION, IDENTITY_MIGRATION, AWS_SCOPE_MIGRATION, ACCESS_SNAPSHOT_MIGRATION, APPROVALS_MIGRATION } from "./schema-r01.ts";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Single-node durable store (SQLite, WAL, synchronous=FULL). The schema mirrors the PostgreSQL design in
 * docs/ARCHITECTURE.md (relational graph tables, indexed event envelopes, findings, checkpoints, outbox);
 * moving to PostgreSQL is a storage-adapter change behind the Store class, not a contract change.
 */
export type DB = DatabaseSync;

export const MIGRATIONS: string[] = [
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
  `ALTER TABLE sources ADD COLUMN allowed_actions TEXT;
   ALTER TABLE sources ADD COLUMN independence_group TEXT;
   ALTER TABLE api_tokens ADD COLUMN principal_type TEXT NOT NULL DEFAULT 'human' CHECK (principal_type IN ('human','service'));
   ALTER TABLE containment_requests ADD COLUMN requested_by_type TEXT NOT NULL DEFAULT 'human';
   CREATE INDEX events_project_seq ON events (project_id, seq);`,
  // v0.3.1: server-controlled journal metadata, legacy-minimization marker, per-record quarantine
  `ALTER TABLE journal ADD COLUMN meta TEXT;
   ALTER TABLE journal ADD COLUMN minimized INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE quarantine (journal_seq INTEGER PRIMARY KEY, project_id TEXT NOT NULL, source_id TEXT NOT NULL, source_event_id TEXT NOT NULL, error TEXT NOT NULL, created_at TEXT NOT NULL);`,
  // R00.2: administrator-declared correlation authorities. NULL = private per-source namespace (no
  // cross-source identity joins), which is the safe default for every existing source.
  `ALTER TABLE sources ADD COLUMN identity_namespace TEXT;
   ALTER TABLE sources ADD COLUMN run_namespace TEXT;`,
  // R01.4: optimistic concurrency and decision history. Existing rows start at version 0 / revision 1;
  // containment requests created before policy snapshots carry NULL and must be requested again to approve.
  `ALTER TABLE findings ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE state_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, version INTEGER NOT NULL, actor TEXT NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL, reason TEXT, at TEXT NOT NULL);
   CREATE INDEX state_changes_subject ON state_changes (project_id, subject_type, subject_id, id);
   ALTER TABLE sources ADD COLUMN config_revision INTEGER NOT NULL DEFAULT 1;
   CREATE TABLE source_revisions (project_id TEXT NOT NULL, source_id TEXT NOT NULL, revision INTEGER NOT NULL, config TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL, recorded_at TEXT NOT NULL, effective_at TEXT NOT NULL, PRIMARY KEY (project_id, source_id, revision));
   ALTER TABLE containment_requests ADD COLUMN finding_revision INTEGER;
   ALTER TABLE containment_requests ADD COLUMN policy_digest TEXT;
   ALTER TABLE containment_requests ADD COLUMN expires_at TEXT;`,
  // R01.1: bitemporal entities, assertions and reconciliations (see facts.ts). Existing projects are
  // backfilled lazily from their stored graph revisions with legacy (unknown) provenance.
  FACTS_MIGRATION,
  // R01.2: capability declarations used by historical coverage, and indexes for receipt-based liveness.
  `ALTER TABLE sources ADD COLUMN sampling_ratio REAL;
   ALTER TABLE sources ADD COLUMN retention_days INTEGER;
   ALTER TABLE sources ADD COLUMN outcomes_reported TEXT;
   CREATE INDEX events_source_received ON events (project_id, source_id, received_at);
   CREATE INDEX events_source_action ON events (project_id, source_id, action, occurred_at);`,
  // R01.3: immutable, content-addressed investigation bundles.
  BUNDLES_MIGRATION,
  // R01.5: indexes chosen from EXPLAIN QUERY PLAN on the 10k/100k/1M benchmark (docs/roadmap/R01.5-BENCHMARK.md).
  // Expression texts must match investigate.ts FIELD_FILTERS exactly for SQLite to use them.
  `CREATE INDEX events_time_id ON events (project_id, occurred_at, id);
   DROP INDEX events_project_time;
   CREATE INDEX events_action_time ON events (project_id, action, occurred_at, id);
   CREATE INDEX events_source_time ON events (project_id, source_id, occurred_at, id);
   CREATE INDEX events_actor ON events (project_id, json_extract(body, '$.actor_ref'), occurred_at, id);
   CREATE INDEX events_session ON events (project_id, json_extract(body, '$.session_ref'), occurred_at, id);
   CREATE INDEX events_request ON events (project_id, json_extract(body, '$.request_id'), occurred_at, id);
   CREATE INDEX events_run ON events (project_id, json_extract(body, '$.run_id'), occurred_at, id);
   CREATE INDEX events_client_ip ON events (project_id, json_extract(body, '$.client_ip'), occurred_at, id);
   CREATE INDEX events_route ON events (project_id, json_extract(body, '$.route'), occurred_at, id);
   CREATE INDEX events_rule ON events (project_id, json_extract(body, '$.rule_ref'), occurred_at, id);
   CREATE INDEX events_trace ON events (project_id, json_extract(body, '$.trace_id'), occurred_at, id);`,
  // R03.1: durable cases with append-only items (see cases.ts).
  CASES_MIGRATION,
  // R02.1: connector manifests bound to sources, and collection reports for honest coverage.
  CONNECTORS_MIGRATION,
  // R10.1: token expiry and rotation, OIDC subject mappings.
  IDENTITY_MIGRATION,
  // R02.4: AWS identity/audit pack scope.
  AWS_SCOPE_MIGRATION,
  // R04.3: authorization snapshots.
  ACCESS_SNAPSHOT_MIGRATION,
  // R07.1: control inventory and verification records.
  CONTROLS_MIGRATION,
  // R08.1: token subjects and per-subject approvals.
  APPROVALS_MIGRATION,
];

export function openDb(path: string): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA secure_delete = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set((db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version));
  MIGRATIONS.forEach((sql, i) => {
    const v = i + 1;
    if (applied.has(v)) return;
    tx(db, () => { db.exec(sql); db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(v, new Date().toISOString()); });
  });
  return db;
}

const depth = new WeakMap<DB, number>();
/** One IMMEDIATE transaction; a nested call joins the outer transaction instead of failing on BEGIN. */
export function tx<T>(db: DB, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  if (d > 0) { depth.set(db, d + 1); try { return fn(); } finally { depth.set(db, d); } }
  depth.set(db, 1);
  try { return txOuter(db, fn); } finally { depth.set(db, 0); }
}
function txOuter<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { try { db.exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
}
