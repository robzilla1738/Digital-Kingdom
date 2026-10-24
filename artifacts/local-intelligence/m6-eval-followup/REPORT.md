# Local Intelligence M6 evaluation (LP26) — li-m6-e61d01f7

Model meta/muse-spark-1.3-contributor via the AI Gateway (restricted_model: MCP tools only). Conditions: C1 existing full investigation tools; C2 event tools with context; C3 guided investigation contract.
Preregistered 27 slots per mode (dev + held-out, 1 repetition(s), fresh world and conversation per attempt). Spend: this run $0.3394; M6 ledger total $1.7258 of the $2 M6 allowance.

Follows li-m6-c2c34916 (records unchanged). LP26.1: v1 C3 could never satisfy a coverage obligation (case interval began before the world's observers existed and ended in the future; coverage history called a source silent between registration and its first receipt). Both fixed with failing tests first; this run asks the v1 question again on the same documents.

Changes from the followed run: controller case interval: [last observer registration, last record stored] instead of [start - 60 s, setup + 120 s] (eval/local/controller.ts); coverage history: a first receipt within the freshness threshold of registration makes [registration, first receipt) live; never-reporting or late sources stay unknown (apps/server/src/coverage-history.ts); limits: the followed run's effective limits ({"maxToolCalls":24,"maxModelCalls":30,"maxCompletionTokens":16000,"maxPromptTokensTotal":600000,"timeoutMs":300000,"toolResultCharLimit":60000}); repetitions: 1 (budget); AI critique: not run (budget); human review deferred.


## Model runs — objective metrics (deterministic referee)

| block/condition | started | invalid preflight | end-to-end | structured predicates | retrieval (required exposed/reachable) | claim validity | unsupported affirmatives | underclaims (unknown where established) | missed ops | statuses | tool calls | cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| dev/C1 | 3 | 0 | 2/3 (67%) | 32/33 (97%) | 34/34 (100%) | 39/39 (100%) | 0 | 1 | 0 | completed:3 | 46 | $0.0356 |
| dev/C2 | 3 | 0 | 3/3 (100%) | 33/33 (100%) | 34/34 (100%) | 39/39 (100%) | 0 | 0 | 0 | completed:3 | 24 | $0.0362 |
| dev/C3 | 3 | 0 | 3/3 (100%) | 33/33 (100%) | 34/34 (100%) | 39/39 (100%) | 0 | 0 | 0 | completed:3 | 17 | $0.0460 |
| heldout/C1 | 6 | 0 | 5/6 (83%) | 59/60 (98%) | 60/60 (100%) | 70/70 (100%) | 0 | 1 | 0 | completed:6 | 90 | $0.0830 |
| heldout/C2 | 6 | 0 | 6/6 (100%) | 60/60 (100%) | 60/60 (100%) | 71/71 (100%) | 0 | 0 | 0 | completed:6 | 64 | $0.0587 |
| heldout/C3 | 6 | 0 | 4/6 (67%) | 57/60 (95%) | 60/60 (100%) | 68/68 (100%) | 0 | 3 | 0 | completed:6 | 32 | $0.0799 |

## Side by side with li-m6-c2c34916 (v1, surviving records only)

| block/condition | v1 end-to-end | v1 predicates | this run end-to-end | this run predicates |
|---|---:|---:|---:|---:|
| dev/C1 | 6/6 (100%) | 66/66 (100%) | 2/3 (67%) | 32/33 (97%) |
| dev/C2 | 6/6 (100%) | 66/66 (100%) | 3/3 (100%) | 33/33 (100%) |
| dev/C3 | 0/6 (0%) | 58/66 (88%) | 3/3 (100%) | 33/33 (100%) |
| heldout/C1 | 4/5 (80%) | 52/54 (96%) | 5/6 (83%) | 59/60 (98%) |
| heldout/C2 | 1/1 (100%) | 12/12 (100%) | 6/6 (100%) | 60/60 (100%) |
| heldout/C3 | 0/2 (0%) | 22/24 (92%) | 4/6 (67%) | 57/60 (95%) |

v1 counts cover only its surviving records (26 of 54 slots; see its records-lost incident). This run's held-out documents are the same documents, revealed at the v1 seal (burned, not fresh).

## Scripted runs (no model; protocol baseline)

| block/condition | started | invalid preflight | end-to-end | structured predicates | retrieval (required exposed/reachable) | claim validity | unsupported affirmatives | underclaims (unknown where established) | missed ops | statuses | tool calls | cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| dev/C1 | 3 | 0 | 3/3 (100%) | 33/33 (100%) | 34/34 (100%) | 34/34 (100%) | 0 | 0 | 0 | completed:3 | 6 | $0.0000 |
| dev/C2 | 3 | 0 | 3/3 (100%) | 33/33 (100%) | 34/34 (100%) | 34/34 (100%) | 0 | 0 | 0 | completed:3 | 54 | $0.0000 |
| dev/C3 | 3 | 0 | 3/3 (100%) | 33/33 (100%) | 34/34 (100%) | 34/34 (100%) | 0 | 0 | 0 | completed:3 | 16 | $0.0000 |
| heldout/C1 | 6 | 0 | 6/6 (100%) | 60/60 (100%) | 60/60 (100%) | 60/60 (100%) | 0 | 0 | 0 | completed:6 | 12 | $0.0000 |
| heldout/C2 | 6 | 0 | 6/6 (100%) | 60/60 (100%) | 60/60 (100%) | 60/60 (100%) | 0 | 0 | 0 | completed:6 | 89 | $0.0000 |
| heldout/C3 | 6 | 0 | 6/6 (100%) | 60/60 (100%) | 60/60 (100%) | 60/60 (100%) | 0 | 0 | 0 | completed:6 | 31 | $0.0000 |

## AI semantic critique (ai_reviewed_advisory — separate denominator, not a score)

| block/condition | critiqued attempts | judgments | supported | unsupported | unclear | errors |
|---|---:|---:|---:|---:|---:|---:|
| dev/C1 | 0 | 0 | 0 | 0 | 0 | 0 |
| dev/C2 | 0 | 0 | 0 | 0 | 0 | 0 |
| dev/C3 | 0 | 0 | 0 | 0 | 0 | 0 |
| heldout/C1 | 0 | 0 | 0 | 0 | 0 | 0 |
| heldout/C2 | 0 | 0 | 0 | 0 | 0 | 0 |
| heldout/C3 | 0 | 0 | 0 | 0 | 0 | 0 |

Human review: deferred (EXT05). No record is approved.

## Exploratory failure breakdown (not preregistered)

| block/condition | failed predicates | outcome | independent_effect | boundary | answered unknown | ...after seeing unavailable coverage | wrong affirmative | missing op |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| dev/C1 | 1 | 0 | 0 | 1 | 1 | 0 | 0 | 0 |
| dev/C2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| dev/C3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| heldout/C1 | 1 | 0 | 0 | 1 | 1 | 0 | 0 | 0 |
| heldout/C2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| heldout/C3 | 3 | 0 | 3 | 0 | 3 | 3 | 0 | 0 |

## Limitations

- Synthetic local laboratory only (three blueprints, trusted built-in services); no production, provider or real-identity claim.
- Dev documents are repository-resident; held-out documents were private until seal. The model had MCP tools only (restricted_model), but the operator who wrote the generator, referee and tasks also wrote the product: not an operator-blinded study.
- Repetitions are not independent cases; small counts; no significance test and no pooled superiority claim.
- Exposure means the record reached the model, not that it was attended to; packet records count as exposure only when their digest equals the stored record.
- The referee's admissibility rules are this phase's specification (observer attachment + schedule faults); a silently dropped observer record admits not_observed or unknown.
- AI critique is advisory and from the same model family; human review is deferred.
