# Upgrading

## v0.3 → v0.3.2: pending rows with in-payload redaction metadata

v0.3 kept its own redaction report inside each journal payload, as `evidence._dk_redaction`. v0.3.1 rejects every `_dk_` key, so in an in-place upgrade **v0.3.1 tombstoned pending v0.3 rows that carried this report**. Those were acknowledged events that had not yet been processed. **Don't upgrade a v0.3 database with a backlog to v0.3.1; go straight to v0.3.2 or later.**

v0.3.2 adds a separate, versioned conversion step that is only used for legacy rows (`convertLegacyPayload`). It lifts the top-level `evidence._dk_redaction` out of the payload, type-checks it, and stores it in `journal.meta` as `legacy_format: "v0.3-evidence-redaction"` with a note that it is carried over, not independently verified. It then re-minimizes the rest exactly like a live payload. Sequence numbers, source event ids, dedup keys and the checkpoint are unchanged, and the normalized event id is the same one v0.3 would have produced. Any other `_dk_` key in a legacy row still tombstones. Live ingestion stays strict.

Caveat: a v0.2 producer could have sent a top-level `evidence._dk_redaction` itself. That is handled the same way. The worst case is an extra, type-checked redaction count in a coverage note, and it never strengthens an evidence claim.

Verified against `fixtures/legacy/v0.3-journal.sqlite`, written by the **genuine v0.3 code** (commit 83df9bb) through `scripts/make-v03-legacy-fixture.ts`. It has one processed row and three pending rows, including one whose evidence object existed only to carry the report. The tests are in `apps/server/test/upgrade-v03.test.ts`.

To regenerate the fixture: `git worktree add /tmp/v03wt 83df9bb`, symlink the repo's root `node_modules` into the worktree, copy each workspace package's `node_modules` into it (pnpm's workspace links are relative), then from `/tmp/v03wt` run `npx tsx <repo>/scripts/make-v03-legacy-fixture.ts <repo>/fixtures/legacy/v0.3-journal.sqlite`.

## v0.2 → v0.3.1: legacy raw journal payloads

v0.2 wrote each inbound payload to `journal.payload` *before* redaction. Its normalized events and evidence were redacted, but the journal could still hold credential-like values that producers sent.

**What happens automatically.** On first start, v0.3.1 runs schema migrations and then `Store.minimizeLegacyJournal()`:

- Every journal row not yet marked minimized is parsed and passed through the same `minimizeIngest()` used at receive time. It is rewritten in place with the same `seq`, `project_id`, `source_id` and `source_event_id`, so deduplication and the processing checkpoint are unchanged.
- A row that can't be parsed or validated is replaced with a tombstone. If it was still pending, the worker rejects it and moves on.
- With `PRAGMA secure_delete=ON`, overwritten content is zeroed in the database file. The WAL is then checkpointed and truncated (`wal_checkpoint(TRUNCATE)`).
- The run is recorded in the audit log as `journal.legacy_minimized`.

**What it cannot reach.** Backups, filesystem or volume snapshots, replicas, copied database files, and blocks on storage media that had already been reallocated. Nothing here guarantees erasure from those.

**What to do if real credentials were ever sent.** Treat them as exposed: rotate them, and purge or re-encrypt any backups and snapshots taken while v0.2 was running.

**Verification.** `apps/server/test/hardening.test.ts` builds a v0.2-schema database (reconstructed by downgrading the current schema, not written by the v0.2 binary) with raw markers in processed and pending journal rows, confirms the markers are present, then upgrades it. It checks that the markers are gone from the database and WAL files, that the pending row processes once, that dedup still works, and that a restart does nothing further.
