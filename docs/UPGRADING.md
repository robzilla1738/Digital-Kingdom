# Upgrading

## Unreleased: correlation namespaces, route inventory, ruleset dk-rules-1.1.0 (roadmap R00)

- Migration 4 adds `sources.identity_namespace` and `sources.run_namespace`. Existing sources get NULL, which
  means private to that source: after upgrading, events from two different sources no longer correlate on an
  equal `actor_ref`, `session_ref` or `run_id`. If two sources genuinely share an authority (an app accepting
  the identity provider's sessions; an observer that receives a runtime's run ids), re-register both with the
  same namespace.
- The ruleset is now `dk-rules-1.1.0`. Re-evaluation appends a finding revision; earlier revisions stay in
  `finding_revisions`. Finding ids are unchanged unless two authorities used the same identifier text.
- Graphs may declare asset `routes`. Without them, route lookups are labelled inferred and assessments that
  rest on them are never favorable.
- New admin endpoint `POST /api/tokens/:id/revoke`.

## v0.3 → v0.3.2: pending rows with in-payload redaction metadata

v0.3 kept its own redaction report inside each journal payload, as `evidence._dk_redaction`. v0.3.1 rejects every `_dk_` key, so in an in-place upgrade **v0.3.1 tombstoned pending v0.3 rows that carried this report**. Those were acknowledged events that had not yet been processed. **Don't upgrade a v0.3 database with a backlog to v0.3.1; go straight to v0.3.2 or later.**

v0.3.2 adds a separate, versioned conversion step that is only used for legacy rows (`convertLegacyPayload`). It lifts the top-level `evidence._dk_redaction` out of the payload, type-checks it, and stores it in `journal.meta` as `legacy_format: "v0.3-evidence-redaction"` with a note that it is carried over, not independently verified. It then re-minimizes the rest exactly like a live payload. Sequence numbers, source event ids, dedup keys and the checkpoint are unchanged, and the normalized event id is the same one v0.3 would have produced. Any other `_dk_` key in a legacy row still tombstones. Live ingestion stays strict.

Caveat: a v0.2 producer could have sent a top-level `evidence._dk_redaction` itself. That is handled the same way. The worst case is an extra, type-checked redaction count in a coverage note, and it never strengthens an evidence claim.

Verified against `fixtures/legacy/v0.3-journal.sqlite`, written by the **genuine v0.3 code** (commit 83df9bb) through `scripts/make-v03-legacy-fixture.ts`. It has one processed row and three pending rows, including one whose evidence object existed only to carry the report. The tests are in `apps/server/test/upgrade-v03.test.ts`.

To regenerate the fixture: `git worktree add /tmp/v03wt 83df9bb`, symlink the repo's root `node_modules` into the worktree, copy each workspace package's `node_modules` into it (pnpm's workspace links are relative), then from `/tmp/v03wt` run `npx tsx <repo>/scripts/make-v03-legacy-fixture.ts <repo>/fixtures/legacy/v0.3-journal.sqlite`.

### Prevention is not recovery

**v0.3.2 prevents the bad conversion during a direct upgrade from v0.3. It cannot reconstruct original payloads that a prior v0.3.1 startup already replaced with tombstones.**

v0.3.1 overwrote each affected `journal.payload` with `{"_tombstone":true}`, set `journal.minimized = 2`, and recorded the reason in `journal.meta.tombstone`. With `secure_delete=ON`, the old content was zeroed, so nothing in that database can restore it. The v0.3.2+ converter only reads rows with `minimized = 0`, so it never touches an existing tombstone. This is tested in `apps/server/test/tombstones.test.ts` against `fixtures/legacy/v0.3-after-v0.3.1-startup.sqlite`, which was produced by running the genuine v0.3.1 code once on the genuine v0.3 fixture.

What a tombstone means depends on whether its row had already been processed when v0.3.1 started:

- **Processed before the upgrade:** the normalized event, evidence and findings already existed and are unaffected. Only the journal copy is gone.
- **Pending at the upgrade:** the event was acknowledged (HTTP 202) but never normalized. It is absent from events, findings and coverage. That is the actual data loss.

### Identify potentially affected rows (read-only)

```
npx tsx scripts/diagnose-legacy-tombstones.ts /path/to/digital-kingdom.db          # human-readable
npx tsx scripts/diagnose-legacy-tombstones.ts /path/to/digital-kingdom.db --json   # machine-readable
```

Stop the server first, or point the script at a backup. It copies the database and any `-wal` file to a temporary directory and only reads the copy. For each tombstone it lists `seq`, project, source, `source_event_id`, the recorded reason, whether the row was pending at the checkpoint, and whether a normalized event exists. Every row is reported as `recovered: false`.

Limits:

- A reason naming `_dk_redaction` is consistent with this bug but does not prove it, because a v0.2 producer could have sent that key itself. Tombstones with other reasons (unparseable or invalid legacy payloads) are unrelated.
- It cannot show what the lost payloads contained.
- It does not look at backups, snapshots or source systems.

### Recovery considerations

These are bounded by what has been verified. Recovery itself has not been tested end to end.

1. **Preserve the affected database first.** Stop the server and copy the database with its `-wal` and `-shm` files before doing anything else.
2. **Work on an isolated copy.** Assess a pre-upgrade backup, or the original source records (application logs, the producer's own store), in a separate scratch installation. Never touch the live data directory.
3. **Never overwrite the current installation automatically.** No tool here merges data back, and none should be run blindly.
4. **Don't invent event contents.** If no authoritative copy of an original payload exists, the event stays lost. Record that as a known gap, for example in an analyst note on the affected findings or coverage. Don't reconstruct it from memory or from findings.
5. **Don't change event IDs to get past deduplication.** Event IDs are derived from (project, source, `source_event_id`). Re-sending an original record with its original `source_event_id` is **collapsed as a duplicate**, because the tombstoned journal row still holds that dedup key. That behavior is verified in `tombstones.test.ts`. So a straightforward replay through `/ingest` does not restore a pending tombstoned event. Inventing a new `source_event_id` would create an event that claims to be something it isn't, and would break correlation with the source system.
6. A supported repair path would need its own design and review: verified provenance of the original record, an explicit audit entry, and a way to replace a tombstone in place under the same identity. It is not part of this release.
7. If credentials may have been in the affected payloads, rotate them regardless. See the v0.2 section below.

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
