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
