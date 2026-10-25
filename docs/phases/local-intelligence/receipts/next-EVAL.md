# Receipt — next-EVAL: fresh held-out model evaluation of the claim-scoped uncertainty fix (post-merge item A)

Branch `eval/li-next-fresh` (cut from main `271b545`, which contains li-next item A). Not merged; no PR.
Owner authorization: Robert Courson, Sat 2026-10-24 21:21 CDT — "Yes use the AI Gateway key i gave you above with Muse
spark 1.3 contributor model". This overrides the li-next "no model calls" rule for this evaluation only.

## Status: IN PROGRESS (model block running)

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
