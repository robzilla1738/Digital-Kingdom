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
