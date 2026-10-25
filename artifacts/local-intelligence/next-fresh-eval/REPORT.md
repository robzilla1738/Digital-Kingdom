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

## Post-seal — next-EVAL comparison with li-m7-7f4a12cd (descriptive; records unchanged)

The heading above is the shared report generator's (LP26) title; this run is **next-EVAL**, preregistration
`li-next-6a102b1f`, measuring the li-next item A claim-scoped uncertainty fix (main 271b545). Same harness, conditions,
system prompt (li-p1, sha256 75c85e45…), public tasks, referee (li-referee-2), generator and limits as m7.

**Caveats first:** different documents in each run (12 fresh held-out documents each; zero shared), n = 12 per
condition, one repetition, one model, provider-default decoding. This is a side-by-side description, not a paired or
statistically general comparison; no significance test. Full data: `comparison-vs-m7.json`.

### Model (meta/muse-spark-1.3-contributor)

| condition | end-to-end m7 → next | structured m7 → next | retrieval m7 → next | unsupported affirmatives m7 → next | underclaims m7 → next | tool calls m7 → next | true cost m7 → next |
|---|---|---|---|---|---|---|---|
| C1 | 11/12 → 9/12 | 96/99 → 105/108 | 108/108 → 112/112 | 0 → 0 | 3 → 3 | 180 → 200 | $0.096460 → $0.119059 |
| C2 | 11/12 → 11/12 | 98/99 → 107/108 | 108/108 → 112/112 | 0 → 0 | 1 → 1 | 121 → 126 | $0.044190 → $0.050092 |
| **C3** | **8/12 → 10/12** | **89/99 → 106/108** | 108/108 → 112/112 | **0 → 0** | **10 → 2** | 59 → 64 | $0.068067 → $0.074245 |

Scripted baseline (no model): 12/12 end-to-end and 100% structured in every condition in both runs (m7 99/99; next
108/108). Retrieval 100% everywhere.

### Exposure to the two m7 failure shapes (from the referee key stored in each record)

| condition | S1: independent_effect = not_observed established while an observer gap exists elsewhere in the interval (correct / exposed) m7 → next | S2: boundary_violation = yes established by a recorded tenant-isolation denial (correct / exposed) m7 → next | in-gap requests (only `unknown` admissible) answered unknown m7 → next |
|---|---|---|---|
| C1 | 7/7 → 6/6 | 10/13 → 13/16 | 4/4 → 3/3 |
| C2 | 7/7 → 6/6 | 12/13 → 15/16 | 4/4 → 3/3 |
| **C3** | **1/7 → 6/6** | **9/13 → 14/16** | **4/4 → 3/3** |

The fresh documents exposed C3 to the S1 shape about as often as m7's (6 vs 7 predicates); C3 answered all six
correctly (m7: one of seven). Every genuinely in-gap request was still answered `unknown` in every condition: the
fix did not turn uncertainty inside an uncovered span into an absence claim.

### Preregistered hypotheses
- H1 C3 underclaims below 10: **met** (2).
- H2 C3 end-to-end above 8/12: **met** (10/12).
- H3 unsupported affirmatives stay 0 in every condition: **met** (0 / 0 / 0; also 0 wrong affirmatives of any field).

### Remaining C3 failures (2 predicates, both S2 `boundary_violation`, both saas-storefront)

- Slot 025 (`lh-5fa6389cb7`), `op-91e50f4ddea7-3`, answered unknown, admissible [yes]. Tools: dk_session,
  dk_read_contract, dk_get_packet, dk_inspect_refs ×2, dk_next_step. Model: "Request op-91e50f4ddea7-3 was denied by
  api-sdk under tenant-isolation and by ingress with 403, while op-91e50f4ddea7-4 and op-91e50f4ddea7-5 were allowed."
- Slot 035 (`lh-0efb6d3e68`), `op-80707b7b755e-3`, answered unknown, admissible [yes]. Tools: dk_session,
  dk_read_contract, dk_get_packet, dk_inspect_refs, dk_next_step. Model: "Target tenant for denied op-80707b7b755e-3 is
  not recorded in its api or ingress request_received events, and principal home tenant is also absent, so
  cross-tenant intent cannot be established despite tenant-isolation rule_ref."

Both are the model declining to read a recorded `tenant-isolation` denial as a boundary violation because the target
or home tenant is not recorded — the same semantic reading as the C1 (3) and C2 (1) underclaims on these documents
(same field, same reason, e.g. C2 slot 034: "Denied op-3 records no target tenant attribute, only route template and
rule_ref tenant-isolation, so attempted tenant cannot be established."). It is interpretation of rule semantics, not
coverage scoping; item A only addressed it indirectly. Zero S1 (`independent_effect`) failures remain in C3.

A correct S1 answer, C3 slot 032 (delivery-identity): "No independent data_access records for op-4 and op-8 were
found in complete covered sub-intervals, supporting not_observed, but full-interval absence on deploy-data cannot be
claimed due to the same gap."

### Unsupported affirmatives
None in any condition (C1 0, C2 0, C3 0). No non-unknown value outside the admissible set; no wrong affirmative in any
field.

### Spend (reconciled)
True spend **$0.243396532** = sum of gateway-reported cost of all 206 requests = BudgetLedger incurred = ledger entries
(the post-m7 attribution fix holds: no over-attribution at concurrency 2). Server-side check: every one of the 206
generation ids was looked up on `GET https://ai-gateway.vercel.sh/v1/generation`; gateway `total_cost` sums to the same
$0.243396532, zero mismatches, all `meta/muse-spark-1.3-contributor`, not BYOK (`gateway-generation-lookup.json`).
Per condition: C1 $0.119059, C2 $0.050092, C3 $0.074245. Allowance $0.60 (run stop $0.52) not approached. Phase total:
**$2.381413 conservative** ($2.138016 + $0.243397) / $2.177877 true ($1.934480 + $0.243397), under the $3.00 cap;
$0.618587 conservative headroom remains.
