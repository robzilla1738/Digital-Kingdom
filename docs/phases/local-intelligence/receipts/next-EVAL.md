# Receipt — next-EVAL: fresh held-out model evaluation of the claim-scoped uncertainty fix (post-merge item A)

Branch `eval/li-next-fresh` (cut from main `271b545`, which contains li-next item A). Not merged; no PR.
Owner authorization: Robert Courson, Sat 2026-10-24 21:21 CDT — "Yes use the AI Gateway key i gave you above with Muse
spark 1.3 contributor model". This overrides the li-next "no model calls" rule for this evaluation only.

## Status: DONE — sealed; all 36 model + 36 scripted records present; no halt, no model error

## Result (held-out, n = 12 per condition, 1 repetition)

| condition | model e2e | model structured | retrieval | unsupported affirmatives | underclaims | scripted e2e / structured |
|---|---|---|---|---|---|---|
| C1 | 9/12 | 105/108 | 112/112 | 0 | 3 | 12/12, 108/108 |
| C2 | 11/12 | 107/108 | 112/112 | 0 | 1 | 12/12, 108/108 |
| C3 | 10/12 | 106/108 | 112/112 | 0 | 2 | 12/12, 108/108 |

vs m7 (different documents): C3 end-to-end 8/12 → 10/12, underclaims 10 → 2, unsupported affirmatives 0 → 0; C1 11/12
→ 9/12 (3 → 3 underclaims, all boundary); C2 11/12 → 11/12. H1, H2, H3 all met. S1 shape (independent_effect with a
gap elsewhere in the interval): C3 1/7 → 6/6 correct; S2 (boundary after tenant-isolation denial): C3 9/13 → 14/16.
Genuinely in-gap requests answered unknown in every condition (C3 3/3). Both remaining C3 failures are S2
boundary_violation on saas-storefront (slots 025, 035), the same semantic reading as C1/C2's boundary underclaims.
Details, excerpts and caveats: `artifacts/local-intelligence/next-fresh-eval/REPORT.md` (post-seal section) and
`comparison-vs-m7.json`.

Spend: true $0.243396532 (206 requests; gateway-reported = BudgetLedger = ledger entries; every generation id looked up
server-side on /v1/generation, sum equal, 0 mismatches). Phase total $2.381413 conservative / $2.177877 true (< $3.00).

## Files (all new, under artifacts/local-intelligence/next-fresh-eval/)
preregistration.json, runs/approved_provider/000-035.json (+ manifest, progress.jsonl), runs/scripted/000-035.json,
model-spend-ledger.json, report.json, REPORT.md, heldout-documents-revealed-at-seal.json, spend-reconciliation.json,
gateway-generation-lookup.json, comparison-vs-m7.json. Tools: eval/local/next-eval-compare.py,
eval/local/next-eval-reconcile.py, eval/local/next-eval-gateway-lookup.mjs (read-only analysis; the lookup sends
only generation ids). m7 and all earlier artifacts unchanged (`git diff 271b545 -- artifacts/local-intelligence/m7-fresh-eval` empty).

## Honest limits
- Different documents than m7; n = 12; one repetition; one model; no significance test. The C3 improvement is
  consistent with the fix (same failure shape now answered correctly at comparable exposure) but not proof of a
  general effect. C1 dropped 11/12 → 9/12 on these documents with no product change on its path: per-document
  variation and model sampling are of the same size as the differences.
- Operator not blinded (same author wrote generator, referee, product). The operator saw per-slot progress lines
  during the run (as in m7); no slot was re-run.
- The revealed master seed and documents are now burned for future held-out use.
- AI critique not run; human review deferred (EXT05).
- S2 remains: the model will not affirm a boundary violation from a tenant-isolation denial when the target tenant
  is unrecorded. Whether that is the referee's or the model's reading is a specification question, not addressed here.

## 1. Preregistration (sealed before any model call)

- Id **`li-next-6a102b1f`**, file `artifacts/local-intelligence/next-fresh-eval/preregistration.json`, committed in
  `618fae1` and pushed before the first gateway request. `repository_commit` e02d26a, working tree clean.
- Runner change (e02d26a): `eval/local/run.ts prepare-fresh` gained `--id-prefix`, `--hypothesis`, `--follows` only
  (records the new id family and the directional hypothesis). Harness, conditions, referee, limits unchanged.
- Same design as `li-m7-7f4a12cd`: C1/C2/C3, system prompt `li-p1` sha256 75c85e45… (identical), public tasks
  `li-task-1` (identical), referee `li-referee-2`, generator `li-heldout-gen-1`, limits identical (maxCompletionTokens
  16000), 1 repetition, fresh world and conversation per attempt, concurrency 2.
- 12 NEW held-out documents (4 per family) from a fresh master seed (sha256 differs from m7; zero document hashes in
  common with m7), materialized in a private directory outside the repository until seal.
- Hypothesis: H1 C3 underclaims < 10 (m7); H2 C3 end-to-end > 8/12 (m7); H3 unsupported affirmatives stay 0 in every
  condition (a non-zero C3 count is a regression regardless of H1/H2). Descriptive only.
- Budget: own ledger `artifacts/local-intelligence/next-fresh-eval/model-spend-ledger.json`, allowance $0.60, run stop
  $0.52, prior phase spend $2.138016 (conservative), max phase total $2.738016 < $3.00. Worst-case reservation before
  every request (existing BudgetLedger).

## Commands

```
npx tsx eval/local/run.ts prepare-fresh --out artifacts/local-intelligence/next-fresh-eval --per-family 4 \
  --repetitions 1 --allowance 0.60 --prior-phase-spend 2.138016 --id-prefix li-next --follows ... --hypothesis ...
DK_LI_ROUTE=ai-gateway DK_LI_MODEL=meta/muse-spark-1.3-contributor DK_LI_CAP_USD=0.60 DK_LI_APPROVED=local-intelligence-phase \
  AI_GATEWAY_API_KEY=placeholder NODE_USE_ENV_PROXY=1 NO_PROXY=127.0.0.1,localhost \
  npx tsx eval/local/run.ts run --out artifacts/local-intelligence/next-fresh-eval --mode approved_provider --block heldout --concurrency 2
npx tsx eval/local/run.ts run --out artifacts/local-intelligence/next-fresh-eval --mode scripted --block heldout
npx tsx eval/local/run.ts seal --out artifacts/local-intelligence/next-fresh-eval
python3 eval/local/next-eval-compare.py artifacts/local-intelligence/next-fresh-eval artifacts/local-intelligence/m7-fresh-eval
```
(The credential is injected on the wire; no key is written anywhere. Private documents: DK_LI_PRIVATE_DIR outside the repo.)

## Resume

If interrupted: records are committed as produced (`[skip ci]`). Re-running `run` attempts only slots without a record
(never re-runs a recorded slot). Then seal, compare, finish this receipt.
