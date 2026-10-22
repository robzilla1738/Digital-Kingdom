# Upgrading

## v0.2 → v0.3.1: legacy raw journal payloads

v0.2 wrote each inbound payload to `journal.payload` *before* redaction. Its normalized events and evidence were redacted, but the journal could still hold credential-like values that producers sent.

**What happens automatically.** On first start, v0.3.1 runs schema migrations and then `Store.minimizeLegacyJournal()`:

- Every journal row not yet marked minimized is parsed and passed through the same `minimizeIngest()` used at receive time. It is rewritten in place with the same `seq`, `project_id`, `source_id` and `source_event_id`, so deduplication and the processing checkpoint are unchanged.
- A row that can't be parsed or validated is replaced with a tombstone. If it was still pending, the worker rejects it and moves on.
- With `PRAGMA secure_delete=ON`, overwritten content is zeroed in the database file. The WAL is then checkpointed and truncated (`wal_checkpoint(TRUNCATE)`).
- The run is recorded in the audit log as `journal.legacy_minimized`.

**What it cannot reach.** Backups, filesystem or volume snapshots, replicas, copied database files, and blocks on storage media that had already been reallocated. Nothing here guarantees erasure from those.

**What to do if real credentials were ever sent.** Treat them as exposed: rotate them, and purge or re-encrypt any backups and snapshots taken while v0.2 was running.

**Verification.** `apps/server/test/hardening.test.ts` builds a v0.2-schema database with raw markers in processed and pending journal rows, confirms the markers are present, then upgrades it. It checks that the markers are gone from the database and WAL files, that the pending row processes once, that dedup still works, and that a restart does nothing further.
