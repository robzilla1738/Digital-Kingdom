# Local Intelligence M6 evaluation (LP26) — li-next-6a102b1f

Model meta/muse-spark-1.3-contributor via the AI Gateway (restricted_model: MCP tools only). Conditions: C1 existing full investigation tools; C2 event tools with context; C3 guided investigation contract.
Preregistered 36 slots per mode on NEWLY generated held-out documents only (12 documents, fresh master seed, never seen by any run; 1 repetition(s), fresh world and conversation per attempt). Spend: this run $0.243397 of its $0.6 allowance; phase total $2.381413 of the $3.00 phase cap (prior $2.138016).


## Model runs — objective metrics (deterministic referee)

| block/condition | started | invalid preflight | end-to-end | structured predicates | retrieval (required exposed/reachable) | claim validity | unsupported affirmatives | underclaims (unknown where established) | missed ops | statuses | tool calls | cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| dev/C1 | 0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |  | 0 | $0.0000 |
| dev/C2 | 0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |  | 0 | $0.0000 |
| dev/C3 | 0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |  | 0 | $0.0000 |
| heldout/C1 | 12 | 0 | 9/12 (75%) | 105/108 (97%) | 112/112 (100%) | 130/130 (100%) | 0 | 3 | 0 | completed:12 | 200 | $0.1191 |
| heldout/C2 | 12 | 0 | 11/12 (92%) | 107/108 (99%) | 112/112 (100%) | 130/130 (100%) | 0 | 1 | 0 | completed:12 | 126 | $0.0501 |
| heldout/C3 | 12 | 0 | 10/12 (83%) | 106/108 (98%) | 112/112 (100%) | 130/130 (100%) | 0 | 2 | 0 | completed:12 | 64 | $0.0742 |

## Scripted runs (no model; protocol baseline)

| block/condition | started | invalid preflight | end-to-end | structured predicates | retrieval (required exposed/reachable) | claim validity | unsupported affirmatives | underclaims (unknown where established) | missed ops | statuses | tool calls | cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| dev/C1 | 0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |  | 0 | $0.0000 |
| dev/C2 | 0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |  | 0 | $0.0000 |
| dev/C3 | 0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |  | 0 | $0.0000 |
| heldout/C1 | 12 | 0 | 12/12 (100%) | 108/108 (100%) | 112/112 (100%) | 112/112 (100%) | 0 | 0 | 0 | completed:12 | 24 | $0.0000 |
| heldout/C2 | 12 | 0 | 12/12 (100%) | 108/108 (100%) | 112/112 (100%) | 112/112 (100%) | 0 | 0 | 0 | completed:12 | 172 | $0.0000 |
| heldout/C3 | 12 | 0 | 12/12 (100%) | 108/108 (100%) | 112/112 (100%) | 112/112 (100%) | 0 | 0 | 0 | completed:12 | 61 | $0.0000 |

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
| dev/C1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| dev/C2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| dev/C3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| heldout/C1 | 3 | 0 | 0 | 3 | 3 | 0 | 0 | 0 |
| heldout/C2 | 1 | 0 | 0 | 1 | 1 | 0 | 0 | 0 |
| heldout/C3 | 2 | 0 | 0 | 2 | 2 | 2 | 0 | 0 |

## Limitations

- Synthetic local laboratory only (three blueprints, trusted built-in services); no production, provider or real-identity claim.
- Dev documents are repository-resident; held-out documents were private until seal. The model had MCP tools only (restricted_model), but the operator who wrote the generator, referee and tasks also wrote the product: not an operator-blinded study.
- Repetitions are not independent cases; small counts; no significance test and no pooled superiority claim.
- Exposure means the record reached the model, not that it was attended to; packet records count as exposure only when their digest equals the stored record.
- The referee's admissibility rules are this phase's specification (observer attachment + schedule faults); a silently dropped observer record admits not_observed or unknown.
- AI critique is advisory and from the same model family; human review is deferred.
