# Regression fixtures from resolved cases (R07.4)

Each `*.json` here is a `dk.regression_fixture.v1` exported from an **approved** regression proposal
(`POST /api/projects/:p/cases/:id/regression-proposal`, a human non-author decision, then `/export`).
Fixtures are minimized and synthetic: placeholders replace every identifier and times are offsets from 2030-01-01.
`apps/server/test/regressions-dir.test.ts` replays every file here against the current ruleset in CI.

Nothing is added here automatically. A passing regression shows one recorded condition still holds; it is not a
validated defence.
