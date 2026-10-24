# Receipt — li-next item A: claim-local uncertainty and affirmative evidence

Branch `phase/li-next-a` (cut from main `b0b4a20`). Post-phase review batch, item A (STATUS_REVIEW.md §A).
No model or provider call was made for this item. STATUS.json was not edited.

## 1. What the C3 transcripts show (li-m7-7f4a12cd, artifacts/local-intelligence/m7-fresh-eval)

Failed C3 attempts: slots 001 (`lh-247dd4848d`, delivery-identity, 2 underclaims), 021 (`lh-17757478f2`,
delivery-identity, 2), 026 (`lh-b4ff82e8bf`, saas-storefront, 1), 031 (`lh-3f97f7cb12`, saas-storefront, 5) — 10
underclaims, every one answered `unknown`. In all four the model called only dk_session, dk_read_contract,
dk_get_packet and dk_inspect_refs (never dk_next_step or dk_check_conclusion), so what it acted on was the contract
and the packet text.

Two failure shapes:

**S1 — a gap in one interval tainted a covered interval (6 underclaims: 001×2, 021×2, 031×2, field
`independent_effect`).** In each world the independent observer was stopped for 20–30 ms (e.g. 031: tenant-db audit
stopped 09:43:40.535Z..09:43:40.555Z of a 145 ms case interval). The requests the model got wrong ran while the
observer was live (031: op-4 at .493Z, op-6 at .527Z); only the request inside the gap (op-7, .548Z) is genuinely
unknown, and the model got that one right. The packet's own `coverage_gaps[].uncovered_spans` was correct and narrow,
but everything around it described the gap as interval-wide:

- `coverage:<asset>:data_access` asked "Could data_access ... have been recorded **for the whole interval**?" and
  answered `unavailable` with reason **"0 minute(s) with no capable live observer"** (jobs.ts rounded a 20 ms gap
  to minutes);
- `negative_claims[negative:<asset>:data_access]` said: "A claim that data_access did not happen on <asset>
  **cannot be made**" — no interval qualifier, no covered sub-interval;
- `readiness_reason` ended "**Only an unresolved answer for those parts is honest.**";
- the claim checker (`claims.ts` predicate and `conclusions.ts` rule) had no way to assess an absence claim narrowed
  to a covered sub-interval: `action_not_observed` was refused whenever the whole-interval requirement was unmet,
  even with a predicate `after/before`.

The model's answers echo this literally: 021 "coverage for deploy-data:data_access was unavailable **for the whole
interval**"; 031 "coverage for tenant-db data_access is unavailable ... making absence unknown".

**S2 — positive observations not affirmed (4 underclaims: 026×1, 031×3, field `boundary_violation`).** Denied
requests carried a recorded denial with `rule_ref: tenant-isolation` (api `request_received`, outcome `denied`); the
referee admits only `yes`. The model answered unknown, arguing the principal's home tenant is not recorded. This shape
is partly model semantics rather than guidance: C1 (3) and C2 (1) underclaims are the same boundary field without any
packet. What the guided material contributed was the global framing above (readiness "unresolved", every unmet
obligation listed together) with nothing stating that a coverage gap never weakens a recorded positive observation.

## 2. Code changes

- `apps/server/src/investigation/scoping.ts` (new): `coverageScopes` (latest coverage result per asset:action under
  same-scope revisions), `coveredWithin` (complement of uncovered spans), `assessAbsence` (claim-, operation-,
  resource- and interval-specific: whole interval needs the original requirement; a sub-interval is assessable only if
  activity retrieval is complete, the coverage obligation is `unavailable|partial` and decided by that very coverage
  result, a source is configured, the span list is complete (not capped), the result was computed for the contract
  interval, and the window touches no uncovered span), `bearingUnmet` (unmet obligations that bear on a claim;
  positive observations: none), `CLAIM_SCOPING_NOTE`.
- `conclusions.ts`: `checkAgainstContract` takes an optional assessor; a `not_observed_in_scope` claim with predicate
  `after/before` inside a covered sub-interval passes the contract rule; everything else is refused as before.
- `claims.ts`: the `action_not_observed` predicate uses `assessAbsence` (the contradiction search over the complete
  retrieval is unchanged, so a recorded observation still refutes an absence claim); every claim result gains
  `uncertainty_scope { bearing_unmet_obligations, note }`.
- `packets.ts`: `uncertainty.negative_claims[]` gains `assessable_within` (covered sub-intervals; `[]` when no scoping
  is possible, e.g. no configured source) and `not_assessable_within` (the uncovered spans); `uncertainty.claim_scoping`
  states the scoping rule once.
- `jobs.ts`: coverage reasons give the gap at sub-minute precision and say whether it is the whole interval or "the
  rest of the interval was covered" (e.g. "53 ms of 457 ms with no capable live observer in 1 span(s) (...); the rest
  of the interval was covered"); coverage details record `interval_ms` and `uncovered_spans_total` (so a capped span
  list is never used to scope).
- `contracts.ts`: the negative-requirement reason says "anywhere in the whole interval" and points to claim_scoping.
- `packages/contracts/src/investigation.ts` `deriveReadiness`: unresolved reason now scopes itself ("Only an
  unresolved answer is honest for the parts those obligations bear on (absence of those actions on those assets, in
  their uncovered spans); recorded observations, other assets and actions, and covered sub-intervals stay answerable.").
- `apps/mcp/src/focused.ts`: server instructions add one sentence: uncertainty is claim-local; a gap blocks absence
  claims only for its own asset, action and uncovered spans, never erases a recorded positive observation, never taints
  other assets/actions/covered intervals. "Unknown coverage is unknown, not safe" is kept.

Not changed: the eval system prompt `SYSTEM_LI` (preregistered, shared by C1–C3), the referee, the scripted
investigator, any eval artifact, STATUS.json.

Example (031 world replayed, after): `negative:tenant-db:data_access` → `assessable: false` (whole interval),
`assessable_within: [start..gap-1ms, gap+1ms..end]`, `not_assessable_within: [gap]`; `negative:queue:data_access`
(no source) → `assessable_within: []`.

## 3. Tests (failing first)

New `eval/test/li-next-a-claim-scope.test.ts` (11 tests) replays the four sealed held-out documents
(`heldout-documents-revealed-at-seal.json`) in fresh local worlds with the guided planner — no model. A
guidance-literal scripted investigator reads only the C3 packet and follows its stated scoping; the referee is used
only to grade. Covers S1 per document, packet span scoping, checker-vs-referee agreement per request, S2 positive
observations (audit read and recorded denial → `predicate_checked`, `bearing_unmet_obligations: []`), contradiction
by a recorded observation, and counterexamples both ways: covered sibling resource accepted in the gap window while
the gap resource is refused there; a window straddling the gap edge and the whole interval refused; a sibling with no
configured observer refused in every window. New `apps/server/test/next-a-scoping.test.ts` (4 unit tests).

Before (commit ef16451, fix absent): 11/11 failed — e.g. "expected [ …(2) ] to deeply equal []" (two independent_effect
underclaims per document from the literal investigator), "expected undefined to match object
{ bearing_unmet_obligations: [] }". Full output: work/next/a-before-test-output.txt (project scratch).
After (commit d9cda14): 11/11 pass; LP10 packet tests pass after keeping the always-uncut uncertainty section compact.

Full suite (local, commit d9cda14): `pnpm typecheck` exit 0; `pnpm test` **990 passed / 1 skipped, 142 files**
(baseline at b0b4a20 per the review: 975 passed / 1 skipped, 140 files; +15 new tests); `pnpm validate:fixtures`
exit 0. An intermediate run (before the packet-size fix) showed 2 LP10 failures (`phase-lp10-packets.test.ts` A1/A4:
the always-uncut uncertainty section had grown past their 9 000-byte pages); the per-claim reasons were shortened and
the scoping note is stated once, after which those tests pass unchanged.

## 4. Scripted replay over the held-out documents

Scripted only (no model): `tsx eval/local/run.ts run --mode scripted --out /tmp/a-replay` over a scratch copy of the
li-m7-7f4a12cd preregistration pointing at the revealed held-out documents (nothing written under artifacts/).
Result, unchanged from the sealed scripted baseline: C1 12/12 end-to-end, 99/99 structured, 0 underclaims; C2 12/12,
99/99, 0; C3 12/12, 99/99, 0. (The scripted investigator does not read the new wording, so this shows the change broke
no world, referee or protocol path; it says nothing about model behaviour.)

## 5. CI

Run 40132854212 on d9cda14 (fix commit): `check` success; `browser-pilot` success (both jobs green). This receipt-only commit
triggers a further run, reported in the hand-back message.

## 6. Honest limits

- **No fresh model evaluation was run** (needs a separately approved budget). The effect of these changes on model
  accuracy is unmeasured; the deterministic fixtures show only that the server now states, and checks, the scoping a
  correct answer needs.
- S2 (boundary_violation after a recorded tenant-isolation denial) is only addressed indirectly (claim_scoping and
  per-claim `uncertainty_scope` say a positive observation is never weakened by gaps). The server does not interpret
  rule semantics; the C1/C2 boundary underclaims suggest part of S2 is model interpretation.
- Sub-interval scoping is millisecond-granular over closed spans and conservative at span edges.
- The eval system prompt was deliberately left unchanged (preregistered); a future evaluation would test the new
  server wording under the same prompt.
