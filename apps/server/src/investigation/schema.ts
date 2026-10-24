/**
 * Local Intelligence Phase M2 storage (additive migrations; nothing existing is rewritten).
 *
 * LP08: investigation contracts. A contract is a pointer to its latest revision; revisions and the obligation
 * transition ledger are append-only (enforced by triggers), so a later scope or evidence change can invalidate an
 * obligation only by writing a NEW revision that names the old decision.
 */
export const INVESTIGATION_CONTRACTS_MIGRATION = `
CREATE TABLE investigation_contracts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, case_id TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (project_id, case_id));
CREATE TABLE investigation_contract_revisions (contract_id TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, cause TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (contract_id, revision));
CREATE TABLE investigation_transitions (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, contract_id TEXT NOT NULL, revision INTEGER NOT NULL, obligation_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, cause TEXT NOT NULL, reason TEXT NOT NULL, evidence_refs TEXT NOT NULL, query_refs TEXT NOT NULL, actor TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX investigation_transitions_contract ON investigation_transitions (contract_id, id);
CREATE TRIGGER investigation_contract_revisions_append_only_u BEFORE UPDATE ON investigation_contract_revisions BEGIN SELECT RAISE(ABORT, 'investigation contract revisions are append-only'); END;
CREATE TRIGGER investigation_contract_revisions_append_only_d BEFORE DELETE ON investigation_contract_revisions BEGIN SELECT RAISE(ABORT, 'investigation contract revisions are append-only'); END;
CREATE TRIGGER investigation_transitions_append_only_u BEFORE UPDATE ON investigation_transitions BEGIN SELECT RAISE(ABORT, 'the obligation ledger is append-only'); END;
CREATE TRIGGER investigation_transitions_append_only_d BEFORE DELETE ON investigation_transitions BEGIN SELECT RAISE(ABORT, 'the obligation ledger is append-only'); END;`;

/**
 * LP09: bounded investigation plan jobs. A job binds one contract revision; steps hold committed state (cursor,
 * snapshot, counters) updated in the same transaction as the unit's deliveries and the budget counter. Deliveries
 * are unique per (channel, channel id, step, ref), so a re-fetched page can never double-count a record. LP10 adds
 * packet and inspect channels to the same delivery log (the basis of claim availability checks).
 */
export const INVESTIGATION_JOBS_MIGRATION = `
CREATE TABLE investigation_jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, case_id TEXT NOT NULL, contract_id TEXT NOT NULL, contract_revision INTEGER NOT NULL, status TEXT NOT NULL, budget TEXT NOT NULL, created_by TEXT NOT NULL, created_token TEXT, principal_type TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL, stop_reason TEXT);
CREATE INDEX investigation_jobs_case ON investigation_jobs (project_id, case_id, created_at);
CREATE TABLE investigation_job_steps (job_id TEXT NOT NULL, step_id TEXT NOT NULL, ord INTEGER NOT NULL, kind TEXT NOT NULL, purpose TEXT NOT NULL, obligation_id TEXT, params TEXT NOT NULL, status TEXT NOT NULL, state TEXT NOT NULL, pages INTEGER NOT NULL DEFAULT 0, units INTEGER NOT NULL DEFAULT 0, error TEXT, completeness TEXT, result_applied TEXT, started_at TEXT, finished_at TEXT, PRIMARY KEY (job_id, step_id));
CREATE TABLE investigation_job_events (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, step_id TEXT, kind TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX investigation_job_events_job ON investigation_job_events (job_id, id);
CREATE TABLE investigation_deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, contract_id TEXT NOT NULL, contract_revision INTEGER NOT NULL, channel TEXT NOT NULL CHECK (channel IN ('job','packet','inspect')), channel_id TEXT NOT NULL, step_id TEXT NOT NULL, ref TEXT NOT NULL, kind TEXT NOT NULL, role TEXT NOT NULL, detail TEXT, principal TEXT NOT NULL, at TEXT NOT NULL, UNIQUE (channel, channel_id, step_id, ref));
CREATE INDEX investigation_deliveries_contract ON investigation_deliveries (contract_id, contract_revision, ref);`;
