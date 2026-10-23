# R07 receipt

## R07.1 control inventory and verification records

Delivered: `Controls` (upsert, recordTest, state machine), routes (admin declares, analyst records tests), Coverage → Controls tab with per-control record.

Acceptance (`apps/server/test/controls-r07.test.ts`, 4 tests):
- Changing the rule mode changes the config digest; the passing test no longer applies and the control is stale, with a history entry.
- A pass recorded with `observer_available: false` becomes inconclusive; state unknown with the observer named. An expired pass is stale.
- A pass and a later fail both keep their conditions; the latest conclusive result (fail) sets the state.
- Every listed control opens a full record; viewers cannot record tests; conditions are required.
- Configured with provider evidence but no test is labelled 'not shown as effective'; `effective_claimed` is true only for tested.

Limits: tests are recorded by people or the lab runner (R07.2); controls are not yet drawn as castle markers (R06.3).

## R07.2 isolated defense-lab runner

Delivered: `runLabTest`, `refuseTarget`, `toControlTest`.

Acceptance (`examples/reference-app/lab.test.ts`, 4 tests, real reference app on 127.0.0.1):
- Benign /orders succeeds with a database read observed; two SQL-injection probes are blocked with no read observed: pass.
- Staging (not approved), production (even if listed), example.com, 10.0.0.5 and an absolute probe URL are refused before any request.
- Failed cleanup is recorded; a two-request budget yields a partial, inconclusive run; an abort still runs cleanup.
- A target answering 503 is inconclusive with the positive-control reason; an unavailable observer is inconclusive.

Limits: HTTP probes only; sandbox targets are started by the caller; no container isolation of the runner itself.

## R07.3 complete the 16 scenario packs (locally executable part)

Delivered: 16 manifests, `scripts/run-scenarios.ts`, CI step, manifest test (`apps/server/test/scenarios-r07.test.ts`, 2 tests), local receipt `docs/roadmap/receipts/R07.3-scenarios-local.json`.

Result: 12 passed (DK-T01-05, 07-09, 12, 14-16), DK-T13 partial_passed (inert-evidence half; model behaviour gated on R11.2), DK-T06 unavailable (alternate-origin discovery not built; R09.1 gated), DK-T10 and DK-T11 unavailable (response executor, R08.3 gated). None of the unavailable ones is labelled passed.

The runner's own first run failed DK-T08 because a manifest named a test title that did not exist; it reported the failure and exited non-zero, then passed once the title was fixed. Independent-observer and UI/MCP record identity are exercised in DK-T04/T05 and the R02.2 pack test.

Required later: an integrated rerun after R08 without relabelling blocked scenarios.

## R07.4 regression proposals

- Candidate: roadmap/batch4 (commit follows this receipt).
- Changed: apps/server/src/regression.ts (new), db.ts, app.ts (POST /cases/:id/regression-proposal, GET /regressions, GET /regressions/:id, POST /regressions/:id/decision, POST /regressions/:id/export), scenarios/regressions/README.md, test/regression-r07.test.ts, test/regressions-dir.test.ts, hardening teardown.
- Commands: pnpm -s typecheck (clean); npx vitest run apps/server/test/regression-r07.test.ts (3 passed); npx vitest run (572 passed, 1 skipped, 80 files).
- Acceptance: (1) no original event, source, actor, session, IP, request, route, asset id, project or case id survives as a value (test walks every leaf); secrets, emails and non-documentation IPs in the lesson are refused without echoing them; (2) verification reports corrected passes and broken fails for auth.repeated_failure; (3) service principal and author approvals are 403, digest mismatch 409; (4) benign counterexamples are required, and a proposal whose benign set fires is verification_failed and cannot be approved.
- Scope: rule-level expectations (rule fires or stays quiet) on detection rules. Not coverage, containment or UI regressions.
- Finding during build: an asset whose id equals its kind ('auth') made naive substring checks fail; leak checks now use whole tokens for short ids and treat public schema vocabulary as non-identifying.
- Migration/rollback: adds regression_proposals only.
- Next: commit an approved fixture through a normal reviewed PR.
