# Local Intelligence M6 evaluation (LP26) — li-m6-c2c34916

Model meta/muse-spark-1.3-contributor via the AI Gateway (restricted_model: MCP tools only). Conditions: C1 existing full investigation tools; C2 event tools with context; C3 guided investigation contract.
Preregistered 54 slots per mode (dev + held-out, 2 repetitions, fresh world and conversation per attempt). Spend (new phase ledger): $1.3864 of the $2 M6 allowance.

> **Incident: records lost.** The sandbox was reset while the held-out model block and the advisory AI critique were running or had just finished. Files written after about 03:29 UTC (Fri 2026-10-23 10:29 PM CDT (UTC-05:00)) did not survive: model attempt records for the slots listed below, their ledger entries and progress lines, and every critique record. The surviving records are byte-for-byte what the runner wrote. 28 of 54 model slots have no record and are excluded from every denominator (not re-run; never counted as failures or successes). Missing by block/condition: dev/C1 0, dev/C2 0, dev/C3 0, heldout/C1 7, heldout/C2 11, heldout/C3 10. Spend for the lost work is charged as a conservative estimate (attempts $0.6533, critique bound $0.3240). The previous session reported e2e dev/C1 6/6, heldout/C1 10/12, dev/C2 6/6, heldout/C2 11/12, dev/C3 0/6, heldout/C3 0/12; those records do not exist and the figures are not data of this report. AI critique: incomplete: no critique record survived; the advisory critique is reported as not available for this run.

Preregistration amendments (made before any comparison slot ran): amendment-1 — {"maxCompletionTokens":16000}: Development smoke (LP24 declared real route, dev LW-01 / C3, not a preregistered slot) ended as schema_failure: two consecutive replies stopped at finish_reason=length with empty content because the provider's reasoning tokens consumed the whole 6000-token completion cap. The cap counts hidden reasoning, so 6000 measures the cap rather than the loop. Raised to 16000 for every condition before any comparison slot ran; nothing else changed (prompt, tools, order, metrics unchanged). amendment-2 — undefined: Development smoke #2 (dev LW-01 / C3, not a preregistered slot) answered boundary_violation=unknown for every saas request, explaining that no delivered record maps a principal to its own tenant. That is correct: li-referee-1 demanded yes/no by inferring the own tenant from baseline-policy semantics that no evidence states (a referee defect: it demanded a fact no source delivered). A negative test reproducing it failed on li-referee-1 and passes on li-referee-2, which admits {truth, unknown} for saas boundary unless the operation's own delivered denial records the tenant-isolation reason. Agent-workspace destinations and delivery-identity grants/revocations are recorded directly and stay decisive. Effect admissibility is unchanged. No comparison slot had run.

## Model runs — objective metrics (deterministic referee)

| block/condition | started | invalid preflight | end-to-end | structured predicates | retrieval (required exposed/reachable) | claim validity | unsupported affirmatives | underclaims (unknown where established) | missed ops | statuses | tool calls | cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| dev/C1 | 6 | 0 | 6/6 (100%) | 66/66 (100%) | 68/68 (100%) | 77/77 (100%) | 0 | 0 | 0 | completed:6 | 107 | $0.0962 |
| dev/C2 | 6 | 0 | 6/6 (100%) | 66/66 (100%) | 68/68 (100%) | 77/77 (100%) | 0 | 0 | 0 | completed:6 | 69 | $0.0803 |
| dev/C3 | 6 | 0 | 0/6 (0%) | 58/66 (88%) | 68/68 (100%) | 74/74 (100%) | 0 | 8 | 0 | completed:6 | 29 | $0.0795 |
| heldout/C1 | 5 | 0 | 4/5 (80%) | 52/54 (96%) | 55/55 (100%) | 62/62 (100%) | 0 | 2 | 0 | completed:5 | 87 | $0.0909 |
| heldout/C2 | 1 | 0 | 1/1 (100%) | 12/12 (100%) | 11/11 (100%) | 11/11 (100%) | 0 | 0 | 0 | completed:1 | 5 | $0.0078 |
| heldout/C3 | 2 | 0 | 0/2 (0%) | 22/24 (92%) | 25/25 (100%) | 25/25 (100%) | 0 | 2 | 0 | completed:2 | 10 | $0.0294 |

## Scripted runs (no model; protocol baseline)

| block/condition | started | invalid preflight | end-to-end | structured predicates | retrieval (required exposed/reachable) | claim validity | unsupported affirmatives | underclaims (unknown where established) | missed ops | statuses | tool calls | cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| dev/C1 | 6 | 0 | 6/6 (100%) | 66/66 (100%) | 68/68 (100%) | 68/68 (100%) | 0 | 0 | 0 | completed:6 | 12 | $0.0000 |
| dev/C2 | 6 | 0 | 6/6 (100%) | 66/66 (100%) | 68/68 (100%) | 68/68 (100%) | 0 | 0 | 0 | completed:6 | 108 | $0.0000 |
| dev/C3 | 6 | 0 | 6/6 (100%) | 66/66 (100%) | 68/68 (100%) | 68/68 (100%) | 0 | 0 | 0 | completed:6 | 32 | $0.0000 |
| heldout/C1 | 12 | 0 | 12/12 (100%) | 120/120 (100%) | 120/120 (100%) | 120/120 (100%) | 0 | 0 | 0 | completed:12 | 24 | $0.0000 |
| heldout/C2 | 12 | 0 | 12/12 (100%) | 120/120 (100%) | 120/120 (100%) | 120/120 (100%) | 0 | 0 | 0 | completed:12 | 178 | $0.0000 |
| heldout/C3 | 12 | 0 | 12/12 (100%) | 120/120 (100%) | 120/120 (100%) | 120/120 (100%) | 0 | 0 | 0 | completed:12 | 62 | $0.0000 |

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
| dev/C3 | 8 | 0 | 7 | 1 | 8 | 8 | 0 | 0 |
| heldout/C1 | 2 | 0 | 1 | 1 | 2 | 0 | 0 | 0 |
| heldout/C2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| heldout/C3 | 2 | 0 | 2 | 0 | 2 | 2 | 0 | 0 |

## Limitations

- Synthetic local laboratory only (three blueprints, trusted built-in services); no production, provider or real-identity claim.
- Dev documents are repository-resident; held-out documents were private until seal. The model had MCP tools only (restricted_model), but the operator who wrote the generator, referee and tasks also wrote the product: not an operator-blinded study.
- Repetitions are not independent cases; small counts; no significance test and no pooled superiority claim.
- Exposure means the record reached the model, not that it was attended to; packet records count as exposure only when their digest equals the stored record.
- The referee's admissibility rules are this phase's specification (observer attachment + schedule faults); a silently dropped observer record admits not_observed or unknown.
- AI critique is advisory and from the same model family; human review is deferred.
- Records lost: 28 of 54 preregistered model slots have no surviving record (sandbox reset); they are missing, outside every denominator, and were not re-run. Held-out model counts cover only the surviving slots.
