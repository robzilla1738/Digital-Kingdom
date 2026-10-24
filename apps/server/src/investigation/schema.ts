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
