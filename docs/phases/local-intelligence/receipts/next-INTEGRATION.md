# Receipt — post-merge review batch ("li-next") integration

Date: 2026-10-24. Base: `main` @ `b0b4a20`. Integration branch: `phase/li-next`, code head `7e3caf5`.
Source brief: the external post-merge review of `b0b4a20` (NEXT_AGENT_PROMPT items 1–6). Not merged to `main`;
no PR opened; nothing deployed. No model or provider calls were made in this batch.

| Review item | Branch merged | Receipt | Result |
|---|---|---|---|
| 1. Preserve work, recheck head | — | this file | Started from exact `b0b4a20`; historical receipts, eval artifacts and scores untouched (append-only). |
| 2. Claim-local uncertainty | `phase/li-next-a` | `next-A.md` | Evidence sufficiency scoped by claim, resource, action and interval; gaps block only unsupported absence claims they bear on; 4 failed fresh C3 documents reproduced deterministically (11 failing before, 11 passing after). Model accuracy effect **unmeasured** (no approved budget). |
| 3. Observer state + restart candidate | `phase/li-next-b` | `next-B.md` | Supervisor-reported observer capability/history; reviewed plan-only `restart_test_observer`; handshake verification (`verified` only on observed probe); stopped observer never reads as "blocked". |
| 4. AI-selected local repairs | `phase/li-next-d` | `next-D.md` | `pnpm bench:repairs` (in CI): 4 cases incl. overbroad, residual-access, no-safe-option and misleading-prediction distractors; 7 scripted/fake-model selectors; 13/13 positive controls caught; 0 wrong choices uncaught. `rehearsal` selector 4/4, `reasoning` 3/4 (fooled by misleading prediction, caught by verification). Real-model selector adapter present but refuses without `--allow-model-selector --budget-usd --approved-by`. |
| 5. Active-environment framing, attention compaction | `phase/li-next-c` | `next-C.md`, `screenshots/next-C/` | Castle opens on the active environment with a realm overview control (2D/3D shared focus); realm overview packs environment gaps display-only (digests unchanged); repeated low-priority items grouped with exact counts and "Show all"; coverage gaps and medium/high items never grouped; case question and next obligation first. |
| 6. Current-main receipt | `phase/li-next` | `MAIN-MERGE.md` | Appended; branch-era reports kept, with a dated pointer at the top of `PHASE_REPORT.md`. |

## Verification on the integrated head `7e3caf5`

- Local (2026-10-24, sandbox): `pnpm typecheck` ✓, `pnpm validate:fixtures` ✓, `pnpm loop:local` LOOP OK (incl. new
  observer-recovery leg), `pnpm bench:repairs` BENCH OK (13/13 positive controls, model not used),
  `pnpm scenarios` exit 0 (LW-01–LW-03 pass; unavailable/partial scenarios unchanged and not counted as passes),
  `pnpm build` ✓.
- CI run [40142449242](https://github.com/robzilla1738/Digital-Kingdom/actions/runs/40142449242): success
  (`check` incl. full vitest suite and bench step, and `browser-pilot` original + redesign suites).
- Sub-branch CI: A 40132854212, B 40133539256, C 40136395212, D 40140865342 — all green on their last code commits.
  Intermittent failures seen during the batch (`examples/reference-app/e2e.test.ts` count assertion, one
  shader-program budget check, one containment pilot test) passed on rerun without code changes; recorded as
  load-related flakes, not fixed.

## Limitations (carried forward honestly)

- Integrated loop and repair bench are scripted / fake-model; `ai_loop` and `ai_selector` are not real-model results.
- Bench is synthetic: one world type (LW-01), four cases, one misprediction type; rehearsal worlds are deterministic
  copies of the scored world, so rehearsal fidelity is by construction.
- Observer and configuration snapshots are launcher-reported, not attested; host-process mode is not an OS isolation
  boundary and runs trusted templates only.
- Grouped scenes (>50 rooms) keep the district overview instead of default active-environment framing.
- External gates EXT01–EXT09 remain deferred by the owner.

## Next unfinished gate

A fresh held-out model evaluation (claim-scoping effect on C3, and a real-model repair selector) requires explicit
owner authorization and budget. Merging `phase/li-next` to `main` requires owner approval.
