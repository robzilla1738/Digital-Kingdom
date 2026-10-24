# Local Intelligence Phase — final phase report

Branch `phase/local-intelligence` (not merged; no PR opened; `main` untouched at the phase baseline `9fec7ed`).
Ledger: `docs/phases/local-intelligence/STATUS.json` (packages, all 128 ACCEPTANCE requirement ids, deferrals, decisions,
model spend). Per-package receipts: `docs/phases/local-intelligence/receipts/LP00.md` … `LP31.md`. Final candidate,
CI run and test counts: `receipts/LP31.md`.

## Readiness, separated

| Dimension | State | Basis |
|---|---|---|
| Engineering | **Verified for the executed gates only.** LP00–LP30 are `ci_verified`; LP31 is verified locally and in CI on the final head recorded in `receipts/LP31.md`. | Typecheck, the vitest suite (8 shards), `validate:fixtures`, `pnpm scenarios`, `pnpm build`, `release:manifest`/`release:verify`, Playwright pilot + redesign suites (CI `browser-pilot`), and the integrated loop test. |
| AI loop | **Verified only for the model runs that actually ran** (LP26 runs and the final-pass fresh-document run; numbers below). The LP31 integrated loop is scripted and records `ai_loop: not_exercised_in_this_run`. | `receipts/LP26.md`, `artifacts/local-intelligence/m6-eval/REPORT.md`, `artifacts/local-intelligence/m6-eval-followup/REPORT.md`, `artifacts/local-intelligence/m7-fresh-eval/REPORT.md`. |
| External validation | **Not done; deferred** (EXT01–EXT09 remain `deferred_by_owner`). | `package/DEFERRALS.json`, `STATUS.json.deferrals`. |
| Production authority | **None.** Local actions exist only as typed operations under a supervisor-owned lease on disposable run-owned resources. No production action, connector, provider enrolment, merge or deploy was performed. | LP20–LP23 receipts; `06_SECURITY_AND_AUTHORITY.md`. |

## Run the local loop

```
pnpm install --frozen-lockfile
pnpm loop:local          # integrated loop; writes artifacts/tmp/lp31/integrated-loop-receipt.json (exact-candidate receipt)
```

One command runs, on the current checkout and on 127.0.0.1 only, with synthetic data and no model call, **in one
leased local world**: blueprint world (saas-storefront, scenario LW-01) on a supervisor with leased lab actions →
finite scenario → case + guided investigation contract → scripted bring-your-agent investigation over the real stdio
**focused MCP** read profile → evidence + claim checks → investigator token revoked → the launcher reports the run's
declared enforcement-point configuration (`dk.local.config_snapshot.v1`) → **LP14 generates reviewable candidates**
(2 valid: `restore-reviewed-policy` → `set_gateway_policy@api` `policy:baseline` / `policy:candidate`) → the rank-1
**generated plan, unmodified**, is leased and executed as a typed local repair in the same run → independent effect
verification → regression capture + model-free replay → link to the case and the **castle comparison built from that
candidate's own LP13 change list** (the `api` room changed; executed-local list `success/verified/local_run_only`) →
post-repair model check (`no_repair_needed`) → evidence-only capsule export and import on a fresh instance. The default
investigation world (no lab option) stays plan-only, and every typed action still needs a lease scoped to the plan. The receipt names the git commit, whether the tree
was dirty, the runtime, and a digest/outcome per stage. The same loop is the test
`eval/test/li-lp31-integrated-loop.test.ts`. Other local entry points: `pnpm world`, `pnpm mission run <file>`,
`pnpm scenarios`, the console **Integrations → Local world / Missions** tabs, and the focused MCP profile
(`docs/phases/local-intelligence/MCP_FOCUSED.md`).

## What was reused (continue, not rebuild)

The existing evidence store, ingestion and coverage engine; finding/recipe engine; cases and case export; the MCP server
(the focused investigation profile is a second profile on the same client and endpoints); the castle renderer and its
scene/layout contracts; analysis exploration (LP13 extends it); backup/export signing; the Playwright pilot and
redesign harness; the earlier `eval/` harness and budget reservation (LP24–LP27 extend it); the release manifest.

## What changed (by milestone)

- **M0 (LP00–LP03):** baseline recovery, scoped permission semantics, recipe conclusions that keep incomplete work
  visible, run-provenance and capability contracts (`dk.local.*` schemas, standalone validators).
- **M1 (LP04–LP07):** blueprint compiler, supervisor-owned isolated runtime, instrumented services with independent
  observers, finite scenario/fault DSL (LW-01…), local-run provenance shown everywhere.
- **M2 (LP08–LP11):** investigation contracts and obligations, bounded resumable plans/jobs, compact evidence packets
  with deterministic claim checks, focused MCP workflow.
- **M3 (LP12–LP15):** investigation workbench, bounded path/change exploration, reviewable plan-only repair candidates,
  local attention queue.
- **M4 (LP16–LP19):** world hierarchy and semantic zoom, six architectural families, evidence-linked interiors,
  baseline-versus-repair world comparison.
- **M5 (LP20–LP23):** run-scoped lab leases, typed local repairs (five action types, no shell/URL executor),
  independent effect verification, replayable regressions linked to cases and comparisons.
- **M6 (LP24–LP27):** bring-your-agent investigation over stdio MCP, private-truth referee separated from the
  investigator, guided-vs-current loop comparison with real model runs, adversarial/fault variants.
- **M7 (LP28–LP31):** evidence-only and training capsules (sealed oracle), mission/scenario composer and mission desk,
  robustness and visual-usability measurements (both 390px findings fixed), missions exportable in evidence-only
  capsules (builder truth refused), and the integrated loop with its exact-candidate receipt.

## What was actually verified

- **Engineering:** only what the executed tests assert, on the hardware/software recorded in each receipt
  (aarch64 sandbox, 2 vCPU; CI ubuntu-latest). Browser checks use Chromium with SwiftShader (software WebGL); automated
  axe/keyboard/reduced-motion/390px checks do not certify accessibility conformance.
- **AI loop (LP26 + final pass), model `meta/muse-spark-1.3-contributor` via the AI Gateway:**
  - `li-m6-c2c34916` (v1, sealed as is): **28 of 54 model records were lost in a sandbox reset** and were not re-run;
    they are outside every denominator. Surviving model records 26/54 (dev 18/18, held-out 8/36). End-to-end:
    dev C1 6/6, C2 6/6, C3 0/6; held-out C1 4/5, C2 1/1, C3 0/2. Predicates: dev C1 66/66, C2 66/66, C3 58/66;
    held-out C1 52/54, C2 12/12, C3 22/24. Scripted 54/54. Critique incomplete (no record survived).
  - `li-m6-e61d01f7` (follow-up after the LP26.1 coverage fix, same documents — held-out already burned,
    1 repetition): model records 27/27. End-to-end: dev C1 2/3, C2 3/3, C3 3/3; held-out C1 5/6, C2 6/6, C3 4/6.
    Predicates: dev C1 32/33, C2 33/33, C3 33/33; held-out C1 59/60, C2 60/60, C3 57/60. Unsupported affirmatives 0.
    Critique not run (budget).
  - **`li-m7-7f4a12cd` (final pass, fresh documents)**: preregistered and committed (`7f1d615`) before any attempt;
    12 **newly generated** held-out documents (4 per family, fresh master seed, never seen by any run, private until
    seal), C1/C2/C3, 1 repetition, model records **36/36** (committed as produced; none lost), scripted baseline 36/36.
    Held-out end-to-end: **C1 11/12, C2 11/12, C3 8/12**. Predicates: C1 96/99, C2 98/99, C3 89/99. Retrieval 108/108 in
    every condition; claim validity 100%; unsupported affirmatives 0 everywhere. Underclaims (unknown where the
    evidence established an answer): C1 3, C2 1, C3 10 — all 10 C3 misses answered `unknown` after seeing coverage
    reported unavailable (6 independent-effect, 4 boundary). Scripted: 12/12 and 99/99 in every condition.
    Report: `artifacts/local-intelligence/m7-fresh-eval/REPORT.md`.
  - These are small, partly non-independent samples; they do not establish that the guided loop is better in general.
    On fresh documents the guided contract (C3) was **not** better: it used the fewest tool calls (59 vs 180 C1 / 121 C2)
    but was more conservative, answering unknown where the evidence was sufficient.
- **Model spend:** **$2.138016** of the $3.00 phase cap on the conservative ledger basis: M6 $1.725762 (including
  $0.977297 of estimates for lost records) + final-pass `li-m7` $0.412254 attributed. The final pass's true spend is
  **$0.208718** (gateway-reported, equal to the budget ledger's incurred total; phase total $1.934480 on that basis):
  the runner's per-attempt attribution over-counted overlapping attempts under `--concurrency 2` (the M6 runs show the
  same pattern); fixed for future runs, records not rewritten (`m7-fresh-eval/spend-reconciliation.json`).

## Limitations

- Closed in the final pass (were limitations of the first LP31 candidate): the loop no longer repairs in a second run,
  the executed plan is the LP14 generator's own output, and the castle comparison is that candidate's change list.
- LP14's local-world candidates are **model-only** over the run's declared configuration snapshot and the declared
  graph. Their policy semantics (`dk.local.tenant_policy_model.v1`: a tenant API in isolated mode refuses another
  tenant's records unless its policy is the deliberately weak lab variant; an agent tool gateway forwards to a
  non-approved receiver only in that variant) are a model of the reviewed local templates, not evidence; only LP22
  independent verification is executed evidence. Covered defects: the saas-storefront tenant API and the
  agent-workspace tool gateway policy variants. Observer gaps in local worlds (the audit observer stopped) are not
  reflected in the analysis state, so `restart-test-observer` is not generated for them.
- The configuration snapshot is reported by the run's launcher (admin token, local-run projects only, run id must
  match); Digital Kingdom does not independently attest it.
- Timings and robustness bounds are environment-specific (software WebGL, 2 vCPU); not benchmarks.
- Hash/HMAC checks on capsules are integrity/origin checks, not proof of truth, completeness or approval.
- No manual screen-reader evaluation, physical-GPU run, outside user, or human semantic review.
- CI history includes flaky tests recorded in the ledger (live-source freshness snapshot, a collector timing race);
  none was resolved by weakening an assertion.

## Deferred gates (still deferred, never passed)

EXT01 real cloud/identity/SaaS accounts · EXT02 remote notifications · EXT03 production response · EXT04 outside users ·
EXT05 human semantic review · EXT06 manual accessibility and physical GPUs · EXT07 paid/new model provider ·
EXT08 federation/team storage · EXT09 merge/deploy/release administration.

## Requirement status

All 128 ACCEPTANCE requirement ids are mapped in `STATUS.json.requirements` with a status from the ledger vocabulary
and evidence paths (checked by `eval/test/li-lp31-ledger.test.ts`). Tallies are in `receipts/LP31.md`.

## Next work (precise)

See `STATUS.json.next_action.precise_next_work`: owner review and the merge decision (EXT09); EXT05/EXT06 human and physical acceptance;
observer-gap candidates for local worlds.
