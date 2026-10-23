/** R01 schemas (migrations 6 and 8). Kept separate so db.ts does not import the domain logic. */
export const FACTS_MIGRATION = `CREATE TABLE entities (entity_ref TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, app_id TEXT NOT NULL, incarnation INTEGER NOT NULL, provider_scope TEXT, provider_id TEXT, created_recorded_at TEXT NOT NULL);
   CREATE UNIQUE INDEX entities_identity ON entities (project_id, kind, app_id, incarnation);
   CREATE TABLE assertions (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL, entity_ref TEXT NOT NULL, assertion_type TEXT NOT NULL, attribute TEXT NOT NULL, value TEXT NOT NULL, valid_from TEXT, valid_to TEXT, observed_at TEXT, recorded_at TEXT NOT NULL, source_ref TEXT NOT NULL, method TEXT NOT NULL, provenance TEXT NOT NULL);
   CREATE INDEX assertions_subject ON assertions (project_id, entity_ref, attribute, recorded_at);
   CREATE TABLE reconciliations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, entity_ref TEXT NOT NULL, attribute TEXT NOT NULL, chosen_assertion_id TEXT NOT NULL, considered TEXT NOT NULL, rationale TEXT NOT NULL, decided_by TEXT NOT NULL, decided_at TEXT NOT NULL, version INTEGER NOT NULL);
   CREATE INDEX reconciliations_subject ON reconciliations (project_id, entity_ref, attribute, decided_at);`;

/** R01.3 immutable investigation bundles. */
export const BUNDLES_MIGRATION = `CREATE TABLE bundles (id TEXT NOT NULL, project_id TEXT NOT NULL, digest TEXT NOT NULL, finding_id TEXT NOT NULL, finding_revision INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, expires_at TEXT, pinned INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (project_id, id));`;

/** R03.1 durable cases. */
export const CASES_MIGRATION = `CREATE TABLE cases (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, scope TEXT NOT NULL, owner TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('open','resolved','closed')), closure_criteria TEXT NOT NULL, closure TEXT, version INTEGER NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE INDEX cases_project ON cases (project_id, updated_at);
   CREATE TABLE case_items (seq INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL, project_id TEXT NOT NULL, item_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, ref TEXT NOT NULL, body TEXT NOT NULL, added_by TEXT NOT NULL, added_at TEXT NOT NULL, removed_at TEXT, removed_by TEXT, removal_reason TEXT);
   CREATE INDEX case_items_case ON case_items (case_id, seq);`;

/** R02.1 connector identity on sources and collector-reported collection windows. */
export const CONNECTORS_MIGRATION = `ALTER TABLE sources ADD COLUMN connector_id TEXT;
   ALTER TABLE sources ADD COLUMN granted_scopes TEXT;
   CREATE TABLE collection_reports (project_id TEXT NOT NULL, source_id TEXT NOT NULL, report_id TEXT NOT NULL, window_start TEXT NOT NULL, window_end TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY (project_id, source_id, report_id));
   CREATE INDEX collection_reports_window ON collection_reports (project_id, source_id, window_start);`;
