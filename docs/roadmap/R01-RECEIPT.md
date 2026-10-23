# R01 receipt: evidence and history

Branch `roadmap/r01-evidence`, stacked on `main` 8957dd6 (R00 merged with owner go-ahead on 2026-10-22).
Status of each package is in `STATUS.json`. Local checks: typecheck, `npx vitest run` (450 tests / 51 files),
`pnpm validate:fixtures`, `pnpm build`. CI run recorded in `STATUS.json` once it completes.

## R01.1 versioned domain facts

Delivered: `apps/server/src/facts.ts` (migration 6). Entities with incarnations and optional provider identity
(`provider_ref` on graph assets and manifests); append-only bitemporal assertions typed declared_config,
observed_config, inferred_relationship, hypothesis, test_result, with valid_from, recorded_at, observed_at and
provenance; per-source evaluation with conflicts kept; precondition-checked, attributed reconciliations that go
stale when the chosen assertion stops being current; lazy legacy backfill with unknown provenance.

Acceptance (`apps/server/test/facts-r01.test.ts`, 8 tests):
- Late configuration discovery changes what is known without rewriting what was known earlier: a view at
  `known_at` before the late import is byte-identical after it; a changed value is not back-dated.
- A deleted and recreated resource with the same name becomes incarnation 2; a different provider id under the
  same asset id is a new entity; the same provider id returning is the same one.
- Graph history and the current view agree: asset sets equal `graphAsOf` at nine instants.
- Limitation: relationships whose endpoints are retired are not pruned from the facts view (graphAsOf does);
  the UI does not yet render facts (API and MCP only).

## R01.2 historical coverage

Delivered: `apps/server/src/coverage-history.ts`, source configuration revisions (migration 5) with
precondition-checked enable/disable at an effective time, declared sampling/retention/outcome limits
(migration 7), receipt-indexed liveness, Coverage workspace "Historical question" tab, MCP `dk_coverage_history`.

Acceptance (`coverage-history-r01.test.ts`, 7 tests):
- Healthy request logs do not imply database-read visibility (request log is excluded; db audit silence = unknown).
- Current sensor restoration does not backfill an outage (current state healthy; 00:30 to 01:00 unknown).
- Liveness is judged by receipt, not a late-delivered or future-stamped event.
- A bounded evaluation window cannot erase a quiet source's outage. **Failing first**: with per-source state
  disabled the current view reported the dark audit source as `not_assessed`; after the fix it is `offline` with
  its own note (`/workspace/work/r00/prefix-r012-window.txt`, not committed).
- Limitations: configuration history before migration 5 is assumed (stated as `history_basis`); collector-side
  loss is visible only through sampling and outage reports; the freshness threshold used is the latest declared.

## R01.3 evidence bundles

Delivered: `apps/server/src/bundles.ts` (migration 8), historical revision endpoint, export manifest names the
bundle, MCP `dk_create_bundle` / `dk_get_bundle_events`, finding view "Pin evidence bundle".

Acceptance (`bundles-r01.test.ts`, 5 tests): new evidence cannot change a pinned comparison and the bundle reopens
with identical records and digest; deleted records are `missing_events`, altered ones `changed_event_ids`;
expiry returns 410 with metadata, pinning retains; API and export report the same digest; authorization is
rechecked on every read. Limitations: the UI shows the bundle but still loads evidence through the existing
path; the MCP digest equality is by construction (same endpoint), not a separate stdio test.

## R01.4 concurrency

Delivered: `state_version` on findings with 428/409 preconditions and recorded actor/before/after history,
`as_of` annotations, source `config_revision` preconditions, optional If-Match for scene layout, containment
proposals bound to finding revision, policy digest and expiry. The finding view sends the version and keeps the
draft on conflict, showing the other reviewer's state.

Acceptance (`concurrency-r01.test.ts`, 11 tests): two edits from the same base cannot both win; historical replay
retrieves notes and state as of a time, current annotations are labelled current; expired approvals and changed
policy snapshots require renewed review (rejection still allowed). Pre-fix behaviour by inspection: the API had no
precondition (the UI itself said so); not re-run as a failing test.

## R01.5 bounded queries

Delivered: `scripts/bench-search.ts`, `R01.5-BENCHMARK.md`, migration 9 indexes, capped counts, 1 MB page budget,
v2 cursors with one-hour expiry and removal detection, per-principal rate limit, coverage without a rule run.

Acceptance (`search-budgets-r01.test.ts`, 8 tests): tied timestamps plus late arrivals never skip or duplicate;
removals after page one are reported; cursors expire with a stated time; results state scanned scope, budgets
and truncation. Large searches: worst measured request at 1M events about 175 ms (was about 1.8 s), and each
principal is limited to 30 per 10 s. Not cancellable mid-query (synchronous SQLite), and ingestion under
concurrent search load is not measured (R10.2).
