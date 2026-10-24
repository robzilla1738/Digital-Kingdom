# li-next B — observer capability state + restart-test-observer candidate (receipt, in progress)

Branch `phase/li-next-b` from main `b0b4a20`. Brief: work/next/NEXT_BRIEF.md; review section C (observer gaps not in the local analysis state).

## Failing-before (tests written first, commit "next-B: failing tests first")
`npx vitest run apps/server/test/next-b-observer-candidates.test.ts examples/reference-app/next-b-observer-recovery.test.ts`
→ Test Files 2 failed; Tests **14 failed | 2 passed (16)**.
The 2 passing-before tests are regression guards on existing LP06/LP22 behaviour (stopped observer ⇒ unknown/inconclusive, never not_observed/pass); they are kept as explicit negative tests for this item.
