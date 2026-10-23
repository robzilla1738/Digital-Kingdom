# Controlled scenarios DK-T01 to DK-T16

Versioned manifests (`dk.scenario.v1`) for the sixteen blueprint scenarios. Each lists expected observations,
claims that must NOT be made, a missing-evidence variant, a benign alternative and the tests that demonstrate it.
`pnpm scenarios` runs every referenced test and writes `artifacts/scenarios/receipt.json`; a failing scenario
fails the command and is reported, never hidden.

These are demonstrations of specific behaviours on synthetic data. They are not a claim of coverage against
attacks in general. Scenarios marked `response_dependent` (DK-T10, DK-T11) stay unavailable until the
laboratory executor exists and is authorized; DK-T06 is not implemented; DK-T13's model-behaviour half waits for
the approved evaluation. None of these is labelled passed.
