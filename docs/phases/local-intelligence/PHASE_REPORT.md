# Local Intelligence Phase — final phase report

Branch `phase/local-intelligence` (not merged; no PR opened; `main` untouched at the phase baseline `9fec7ed`).
Ledger: `docs/phases/local-intelligence/STATUS.json` (packages, all 128 ACCEPTANCE requirement ids, deferrals, decisions,
model spend). Per-package receipts: `docs/phases/local-intelligence/receipts/LP00.md` … `LP31.md`. Final candidate,
CI run and test counts: `receipts/LP31.md`.

## Readiness, separated

| Dimension | State | Basis |
|---|---|---|
| Engineering | **Verified for the executed gates only.** LP00–LP30 are `ci_verified`; LP31 is verified locally and in CI on the final head recorded in `receipts/LP31.md`. | Typecheck, the vitest suite (8 shards), `validate:fixtures`, `pnpm scenarios`, `pnpm build`, `release:manifest`/`release:verify`, Playwright pilot + redesign suites (CI `browser-pilot`), and the integrated loop test. |
| AI loop | **Verified only for the LP26 runs that actually ran** (numbers below). The LP31 integrated loop is scripted and records `ai_loop: not_exercised_in_this_run`. | `receipts/LP26.md`, `artifacts/local-intelligence/m6-eval/REPORT.md`, `artifacts/local-intelligence/m6-eval-followup/REPORT.md`. |
| External validation | **Not done; deferred** (EXT01–EXT09 remain `deferred_by_owner`). | `package/DEFERRALS.json`, `STATUS.json.deferrals`. |
| Production authority | **None.** Local actions exist only as typed operations under a supervisor-owned lease on disposable run-owned resources. No production action, connector, provider enrolment, merge or deploy was performed. | LP20–LP23 receipts; `06_SECURITY_AND_AUTHORITY.md`. |

## Run the local loop

```
pnpm install --frozen-lockfile
pnpm loop:local          # integrated loop; writes artifacts/tmp/lp31/integrated-loop-receipt.json (exact-candidate receipt)
```

One command runs, on the current checkout and on 127.0.0.1 only, with synthetic data and no model call:
blueprint world (saas-storefront, scenario LW-01) → finite scenario → case + guided investigation contract →
scripted bring-your-agent investigation over the real stdio **focused MCP** read profile → evidence + claim checks →
LP14 repair candidates → lab lease → typed local repair (`set_gateway_policy` on `api`) → independent effect
verification → regression capture + model-free replay → link to the case and the castle comparison's executed-local
list → evidence-only capsule export and import on a fresh instance. The receipt names the git commit, whether the tree
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
- **AI loop (LP26), model `meta/muse-spark-1.3-contributor` via the AI Gateway:**
  - `li-m6-c2c34916` (v1, sealed as is): **28 of 54 model records were lost in a sandbox reset** and were not re-run;
    they are outside every denominator. Surviving model records 26/54 (dev 18/18, held-out 8/36). End-to-end:
    dev C1 6/6, C2 6/6, C3 0/6; held-out C1 4/5, C2 1/1, C3 0/2. Predicates: dev C1 66/66, C2 66/66, C3 58/66;
    held-out C1 52/54, C2 12/12, C3 22/24. Scripted 54/54. Critique incomplete (no record survived).
  - `li-m6-e61d01f7` (follow-up after the LP26.1 coverage fix, same documents — held-out already burned,
    1 repetition): model records 27/27. End-to-end: dev C1 2/3, C2 3/3, C3 3/3; held-out C1 5/6, C2 6/6, C3 4/6.
    Predicates: dev C1 32/33, C2 33/33, C3 33/33; held-out C1 59/60, C2 60/60, C3 57/60. Unsupported affirmatives 0.
    Critique not run (budget).
  - These are small, partly non-independent samples; they do not establish that the guided loop is better in general.
- **Model spend:** **$1.725762** of the $3.00 phase cap, **including $0.977297 of estimates** for work whose records
  were lost (real cost unknown, at most that). M7 (LP28–LP31) spent $0.00.

## Limitations

- The LP31 loop repairs in a **second disposable run** of the same blueprint and defect: the LW-01 investigation world is
  started without leased lab actions. The LP14 generator reasons over the analysis model and **returned 0 candidates**
  for this local world, so the executed typed action is the reviewed `set_gateway_policy` on `api` that the
  investigation's boundary-violation claims point at — not a generator output. The castle comparison's model-only
  change is a placeholder used to open the comparison; only its executed-local list carries the verified repair.
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

See `STATUS.json.next_action.precise_next_work`: owner review and the merge decision (EXT09); LP14 local-world gateway
candidates; a single leased world for the loop; a preregistered fresh-document LP26 re-run if the owner approves spend;
EXT05/EXT06 human and physical acceptance.
