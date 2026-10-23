# R03 receipt

## R03.1 durable cases

Delivered: `apps/server/src/cases.ts` (migration 10: `cases`, `case_items`), routes under `/cases`, MCP
`dk_list_cases` / `dk_get_case`, Investigate "Cases" tab (`CasesWorkspace.tsx`), signed case export.

Acceptance (`apps/server/test/cases-r03.test.ts`, 6 tests; `e2e/cases-redesign.spec.ts` CASE-01):
- A case may contain an event that produced no finding (`produced_finding: false`).
- A closed detector finding does not close an unresolved case; the case shows the finding's current state beside it.
- Concurrent edits and scope changes retain history: a stale editor gets 409 with the change made since, missing
  preconditions get 428, removals are tombstones, every version is in the history.
- Case export reopens with matching references (bundle digests equal the bundle API; signature verifies) and,
  after an event is deleted, lists it in `sections.unavailable` with the reason and marks the export incomplete.

Also: closing requires every question answered or accepted as unresolved, a closure statement, and the owner or an
administrator; closed cases are read-only until reopened.

Limitations: no real-time co-editing or comments thread; owner is a principal label, not an identity-provider
subject (R08.1/R10.1); case export embeds event bodies already redacted at ingestion, which is not anonymity.

## R03.2 hypotheses and deterministic investigation recipes

Delivered: `apps/server/src/recipes.ts` (schema `dk.recipe_run.v1`), recipe routes, MCP tools, case-view runner.

Acceptance (`apps/server/test/recipes-r03.test.ts`, 5 tests):
- Shared-IP attribution bait remains separate: another account's request from the same address is a follow-on
  event of the locator query and never supports the account-takeover hypothesis.
- A benign maintenance case is resolved through case hypotheses and closure; the assertion count and the finding's
  evidence are unchanged.
- With the database audit source dark, the data-access stop condition triggers and `conclusion_allowed` is false.
- The account's later database read, which no finding references, is returned as an unlinked follow-on event and
  supports the hypothesis.

Limitations: four recipes cover seven of nine finding kinds' common questions; recipe budgets count queries and
coverage checks (max 12), not rows; recipes never decide intent or authorization.

## R03.3 credential aftermath and residual-access investigation

Delivered: `apps/server/src/aftermath.ts`, CloudTrail mapping of grant targets and session keys (fingerprinted), route, MCP tool.

Acceptance (`apps/server/test/aftermath-r03.test.ts`, 4 tests, synthetic CloudTrail records):
- Exposed key inactive, but the key it created for another user is active and the policy it attached is still attached: unresolved, naming `svc-backup via active key ...; s3:GetObject on acme-exports is feasible` and the attached policy. The session that key obtained is reported expired (12-hour STS maximum).
- Same-user key creation is flagged as consistent with routine rotation for owner confirmation; `malicious_claimed` is always false.
- No snapshot, or an audit-coverage gap since first use, keeps the answer unknown.
- With every descendant removed and the original inactive, the aftermath resolves.

Found while building: the redaction layer masks AWS access key ids in event attributes (they match secret-scanner patterns). Key lineage now uses keyed fingerprints in attributes; ids are shown only when the query or the snapshot supplies them.

Limits: one provider (AWS), recorded events only, no live recheck of credentials (snapshot-based).

## R03.4 integrate registered deception assets safely

Delivered: `Deception` (register, place, retire, testWindow, activate, report), `fromCanarytokens`, routes, optional `decoy_used` event through a project honeytoken source.

Acceptance (`apps/server/test/deception-r03.test.ts`, 4 tests):
- A hit on the fork's placement reports the path original -> fork, the locator with `identity: false`, and what is not established (person, original compromise). Unknown ids get the same 204 and record nothing.
- A Canarytokens DNS alert records 8.8.8.8 as `dns_resolver`; a forwarded request records the peer as `proxy`.
- Inside a registered test window, a trufflehog verifier hit (scanner_validation) and a document fetch are retained and annotated.
- Generated values are AKIA-shaped but never stored; a real active key or private-key text is refused; retired decoys take no new placements.

Limit: the Canarytokens adapter is format-conformant to its documented webhook fields; not checked against a live Canarytokens account.

## R03.5 notification outbox

- Candidate: roadmap/batch4 (commit follows this receipt).
- Changed: apps/server/src/notify.ts (new), db.ts (NOTIFY_MIGRATION), app.ts (routes, case hooks, notifier decoration), main.ts (DK_PUBLIC_URL, DK_NOTIFY_INTERVAL_MS delivery/escalation loop), apps/web Integrations Notifications tab, test/notify-r03.test.ts, hardening teardown.
- Commands: pnpm -s typecheck (clean); npx vitest run apps/server/test/notify-r03.test.ts (2 passed); npx vitest run (568 passed, 1 skipped, 78 files).
- Acceptance: (1) restart on the same file database neither resends delivered rows nor sends an acknowledged one; (2) 503/connection failures appear in /notifications/status failures with attempts and last_error, permanent failures become failed; (3) a destination authorized for another project receives nothing, and payloads exclude case titles (test plants a secret-looking title); (4) status note states delivery counts are not investigation outcomes.
- Supported scope: generic signed HTTPS webhook. No Slack/PagerDuty/email adapters. Tested with an injected receiver only.
- Blocked: real delivery to an authorized destination (gate authorized_notification_destination stays open).
- Migration/rollback: adds notify_destinations, notify_outbox (+ index notify_outbox_due), notify_receipts; rollback drops them, no existing table is altered.
- Next: an operator registers an authorized destination, runs POST /api/notifications/destinations/:id/test, and records the receipt.
