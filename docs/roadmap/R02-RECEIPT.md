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

## R02.3 repository and deployment discovery

Delivered: `packages/graph-core/src/github.ts` (`inspectWorkflow`, `discoverGithub`, `previewMerge`),
`apps/server/src/github-discovery.ts` (GET-only fetcher, preview/apply with base-revision check), routes, admin
panel in Integrations → Connectors.

Acceptance (`apps/server/test/github-r02.test.ts`, 4 tests, fixture fetch, no network):
- Hostile workflow text (YAML anchors, `curl | sh`, `rm -rf /`, secret expressions, local actions) is parsed as data;
  no `run:` content appears anywhere in the output and every request goes to api.github.com for that repository.
- A repository rename keeps `gh-repo-<id>`; a replaced workflow shows as one addition and one removal.
- A 403 with an exhausted rate limit is partial discovery; a 404 repository is a 502 with the partial record,
  never an empty inventory.
- The preview applies nothing; apply refuses a stale base revision.

Live read-only check (2026-10-22, unauthenticated, robzilla1738/Digital-Kingdom): 4 assets (repository, ci.yml,
pages.yml, github-pages environment), triggers and action references extracted, 7 deployments, head 628f1e0, no
partial records (`/workspace/work/r00/live-github-discovery.txt`, not committed).

Limitations: GitHub only; job permissions, secrets, reusable-workflow inputs and runner identity are listed as
unsupported; artifact lineage is R04.1.

## R02.2 one-command local application pack

Delivered: `examples/reference-app/src/pack.ts` (`startPack`, `resetPack`), `src/quickstart.ts` (`pnpm quickstart`),
SDK helpers (`dataAccess`, `toolStep`, `sensorDown`, `sensorUp`, `runId`, `agent`), reference-app database-read
hook, `examples/reference-app/collector.test.ts` and the CI step that downloads a pinned, checksum-verified
otelcol 0.112.0.

Acceptance (`examples/reference-app/pack.test.ts`, 4 tests; `collector.test.ts`, 1 test, passes locally with
otelcol 0.112.0 linux/arm64 and runs in CI on linux/amd64):
- A fresh start passes all five guided steps; the SDK event lands on `checkout`, the audit read on `db`, and the
  event detail from the HTTP API equals the MCP `dk_get_event` event and evidence.
- A deliberate audit outage is offline in current coverage and unknown in historical coverage; the agent run is
  independently corroborated and its denial recorded.
- Restarting on the same directory does not duplicate sources; reset removes the directory.
- The static demo stays synthetic; the pack project is live.
- Real collector: delivery, retry while Digital Kingdom is down (no loss after restart), collector restart, and a
  40 MiB decompressed gzip body refused with 413.

Limitations: the pack runs in one Node process (not containers); `.dk-local/` holds a pack-only admin token in
the database; the guided steps are printed by the CLI, while the web Setup checklist remains the in-app guide.

CI: run 39901028491 on 41f301c (check, collector conformance with otelcol 0.112.0 linux/amd64, browser pilot and
redesign suites) verifies R02.2, R02.3, R03.2, R05.2, R06.1, R10.1 (local scope) and R11.1. Earlier batch-3 runs
had one-off `pilot:redesign` failures (b059865, 8ea6492) that did not reproduce on later commits with the same
code, and one real failure (v1 digest included untracked server logs) fixed in 67f455f.
