# Local Intelligence M6 evaluation (LP26) — li-m7-7f4a12cd

Model meta/muse-spark-1.3-contributor via the AI Gateway (restricted_model: MCP tools only). Conditions: C1 existing full investigation tools; C2 event tools with context; C3 guided investigation contract.
Preregistered 36 slots per mode on NEWLY generated held-out documents only (12 documents, fresh master seed, never seen by any run; 1 repetition(s), fresh world and conversation per attempt). Spend: this run $0.412254 of its $0.9 allowance; phase total $2.138016 of the $3.00 phase cap (prior $1.725762).


## Model runs — objective metrics (deterministic referee)

| block/condition | started | invalid preflight | end-to-end | structured predicates | retrieval (required exposed/reachable) | claim validity | unsupported affirmatives | underclaims (unknown where established) | missed ops | statuses | tool calls | cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| dev/C1 | 0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |  | 0 | $0.0000 |
| dev/C2 | 0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |  | 0 | $0.0000 |
| dev/C3 | 0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |  | 0 | $0.0000 |
| heldout/C1 | 12 | 0 | 11/12 (92%) | 96/99 (97%) | 108/108 (100%) | 131/131 (100%) | 0 | 3 | 0 | completed:12 | 180 | $0.1682 |
| heldout/C2 | 12 | 0 | 11/12 (92%) | 98/99 (99%) | 108/108 (100%) | 123/123 (100%) | 0 | 1 | 0 | completed:12 | 121 | $0.1105 |
| heldout/C3 | 12 | 0 | 8/12 (67%) | 89/99 (90%) | 108/108 (100%) | 128/128 (100%) | 0 | 10 | 0 | completed:12 | 59 | $0.1335 |

## Scripted runs (no model; protocol baseline)

| block/condition | started | invalid preflight | end-to-end | structured predicates | retrieval (required exposed/reachable) | claim validity | unsupported affirmatives | underclaims (unknown where established) | missed ops | statuses | tool calls | cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| dev/C1 | 0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |  | 0 | $0.0000 |
| dev/C2 | 0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |  | 0 | $0.0000 |
| dev/C3 | 0 | 0 | 0/0 | 0/0 | 0/0 | 0/0 | 0 | 0 | 0 |  | 0 | $0.0000 |
| heldout/C1 | 12 | 0 | 12/12 (100%) | 99/99 (100%) | 108/108 (100%) | 108/108 (100%) | 0 | 0 | 0 | completed:12 | 24 | $0.0000 |
| heldout/C2 | 12 | 0 | 12/12 (100%) | 99/99 (100%) | 108/108 (100%) | 108/108 (100%) | 0 | 0 | 0 | completed:12 | 167 | $0.0000 |
| heldout/C3 | 12 | 0 | 12/12 (100%) | 99/99 (100%) | 108/108 (100%) | 108/108 (100%) | 0 | 0 | 0 | completed:12 | 62 | $0.0000 |

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
| heldout/C3 | 10 | 0 | 6 | 4 | 10 | 10 | 0 | 0 |

## Limitations

- Synthetic local laboratory only (three blueprints, trusted built-in services); no production, provider or real-identity claim.
- Dev documents are repository-resident; held-out documents were private until seal. The model had MCP tools only (restricted_model), but the operator who wrote the generator, referee and tasks also wrote the product: not an operator-blinded study.
- Repetitions are not independent cases; small counts; no significance test and no pooled superiority claim.
- Exposure means the record reached the model, not that it was attended to; packet records count as exposure only when their digest equals the stored record.
- The referee's admissibility rules are this phase's specification (observer attachment + schedule faults); a silently dropped observer record admits not_observed or unknown.
- AI critique is advisory and from the same model family; human review is deferred.
