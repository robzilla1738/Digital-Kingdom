# R02 receipt

## R02.1 connector and support-pack contracts

Delivered: `apps/server/src/adapters/connectors.ts` (manifests, `validateManifest`, `checkInstallScopes`,
collection statuses), migration 11 (`sources.connector_id`, `sources.granted_scopes`, `collection_reports`),
`GET /api/connectors`, `POST /ingest/collection-report`, coverage-history overlay, Integrations "Connectors" tab.

Acceptance (`apps/server/test/connectors-r02.test.ts`, 4 tests; `e2e/cases-redesign.spec.ts` CONN-01):
- Permission denial, throttling, partial pagination and revoked scopes produce unknown or partial coverage for
  exactly their windows, with the collector's redacted reason; a replayed report is a duplicate, not a second fact.
- Installing a connector grants only its required read scopes; `*`, admin, write, full-access and foreign scopes
  are refused (422); unsupported source kinds for a connector are refused.
- The UI lists only each manifest's supported protocol versions and encodings and states that others are
  unsupported; no capability is shown as live-verified.

Limitations: "sandbox the connector" is a contract here (collect-only authority, scoped source keys), not process
isolation; there are no pull connectors yet, so pagination/cursor fields describe push semantics; the first pull
connector with real provider scopes is R02.4 (needs authorized provider access).
