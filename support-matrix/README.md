# Support matrix

`SUPPORT_MATRIX.json` is the single source for what this release supports. The UI, README and release notes may
only name an integration listed there, at its declared level, and CI (`apps/server/test/support-r11.test.ts`)
fails when a connector or integration card lacks an entry or an entry points at a test that does not exist.

## Tiers

| Tier | Status | What it covers | Still open |
|---|---|---|---|
| Local reference | supported | one machine; demo data or your own declared inventory and local sources | — |
| Read-only connected pilot | alpha | isolated non-production deployment, scoped keys, read-only grants | live provider validation, human/device review |
| Team investigation | preview | analysts, OIDC subjects, cases, two-person approval, notification outbox | real SSO, real notification destination, team-scale storage |
| Optional lab response | not available | — | the lab executor (R08.3) is not built |

No tier requires a paid model service. Digital Kingdom sends no usage telemetry.

## Levels

`declared` (configuration or fixture logic only) · `discovered` (read from a source of record) · `instrumented`
(events received from a live sensor) · `analyzed` (rules and tests over those events) · `lab_verified` ·
`live_verified`. Nothing in this release is `lab_verified` or `live_verified`.

## Maintenance commitments

- Ownership: see `MAINTAINERS.md`. Security reports follow `SECURITY.md` (private advisories, acknowledgement within
  5 working days).
- A security correction lands with a regression test; every integration whose `tests` reference the affected code
  is rerun in CI before release, and the fix is listed under each affected integration in the release notes.
- Compatibility: contract ids (`dk.*.vN`) never change meaning in place; a breaking change gets a new version and the
  old one stays readable for at least one minor release. Database migrations are forward-only; roll back by
  restoring a backup with the previous release.
- Contributions: regression fixtures through `scenarios/regressions/README.md`; extensions through
  `docs/EXTENSIONS.md`; scenarios through `scenarios/dk-t/`.
