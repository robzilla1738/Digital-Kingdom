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
