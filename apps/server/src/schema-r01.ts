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

/** R10.1 token expiry/rotation and OIDC subject mappings. */
export const IDENTITY_MIGRATION = `ALTER TABLE api_tokens ADD COLUMN expires_at TEXT;
   ALTER TABLE api_tokens ADD COLUMN rotated_to TEXT;
   ALTER TABLE api_tokens ADD COLUMN oidc_issuer TEXT;
   ALTER TABLE api_tokens ADD COLUMN oidc_subject TEXT;
   CREATE TABLE oidc_subjects (issuer TEXT NOT NULL, subject TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, project_ids TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (issuer, subject));`;

/** R02.4 AWS pack scope: one account, regions, configured data events and the data-event source. */
export const AWS_SCOPE_MIGRATION = `CREATE TABLE aws_scopes (project_id TEXT NOT NULL, source_id TEXT NOT NULL, account_id TEXT NOT NULL, regions TEXT NOT NULL, data_event_names TEXT NOT NULL, data_source_id TEXT, verification TEXT NOT NULL DEFAULT 'fixture', updated_at TEXT NOT NULL, PRIMARY KEY (project_id, source_id));`;

/** R04.3 authorization snapshots for the scoped policy evaluator. */
export const ACCESS_SNAPSHOT_MIGRATION = `CREATE TABLE access_snapshots (project_id TEXT NOT NULL, snapshot_id TEXT NOT NULL, taken_at TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, stored_at TEXT NOT NULL, stored_by TEXT NOT NULL, PRIMARY KEY (project_id, snapshot_id));`;

/** R08.1 subjects on tokens and per-subject containment approvals bound to the plan digest. */
export const APPROVALS_MIGRATION = `ALTER TABLE api_tokens ADD COLUMN subject TEXT;
   ALTER TABLE containment_requests ADD COLUMN requested_subject TEXT;
   ALTER TABLE containment_requests ADD COLUMN plan TEXT;
   ALTER TABLE containment_requests ADD COLUMN plan_created_at TEXT;
   CREATE TABLE containment_approvals (request_id TEXT NOT NULL, project_id TEXT NOT NULL, subject TEXT NOT NULL, token_id TEXT NOT NULL, plan_digest TEXT NOT NULL, approved_at TEXT NOT NULL, PRIMARY KEY (request_id, subject));`;

// Keep migration text independent of runtime Store imports.
export const DECEPTION_MIGRATION = `CREATE TABLE decoys (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, value_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, retired_at TEXT, retired_reason TEXT);
   CREATE TABLE decoy_placements (id TEXT PRIMARY KEY, decoy_id TEXT NOT NULL REFERENCES decoys(id), project_id TEXT NOT NULL, location TEXT NOT NULL, asset_id TEXT, parent_placement_id TEXT, placed_at TEXT NOT NULL, placed_by TEXT NOT NULL, removed_at TEXT);
   CREATE TABLE decoy_test_windows (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, decoy_id TEXT, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, purpose TEXT NOT NULL, created_by TEXT NOT NULL);
   CREATE TABLE decoy_activations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, placement_id TEXT, decoy_id TEXT, trigger TEXT NOT NULL, observed_at TEXT NOT NULL, received_at TEXT NOT NULL, via TEXT NOT NULL, network_locator TEXT, locator_kind TEXT, user_agent TEXT, authorized_test_window TEXT, raw_ref TEXT);`;
