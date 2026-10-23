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
