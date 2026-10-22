# Changelog

## Unreleased (branch `improve/investigation-honesty`): event investigation, honest assessments, import validation

- **Event-level investigation.** New read-only, viewer-role `GET /api/projects/:p/events/search` and `GET /api/projects/:p/events/:id`, exposed as the MCP tools `dk_search_events` and `dk_get_event`.
  - Search covers normalized, redacted events in a declared interval of at most 31 days, using exact-match filters only (identity, session, run, request, trace, address, route, rule, source, asset, action, outcome).
  - Pagination is keyset-based and pinned to a snapshot. Cursors are HMAC-signed and bound to the project and filters. Project authorization is checked on every page.
  - Query completeness, source coverage and finding-bundle completeness are reported separately.
  - Correlation namespaces and trust limits are documented and returned with results. A shared IP address never establishes identity.
  - Contracts: `schemas/agent/event-search.v1`, `event-detail.v1`.
- **Change assessment v2 (breaking).** Target resolution and evidence sufficiency are now separate. Missing, offline or stale telemetry on a target yields `insufficient_context` (v1 returned `proceed_with_care` with `assessment_complete: true`). `hold` is kept for severe findings, with gaps still exposed. Unrelated stale sources don't block a target. `assessment_complete` is removed; use `target_resolution.complete`, `evidence_sufficiency.sufficient` and `favorable`. Contract: `schemas/agent/change-assessment.v2`.
- **Fix:** a manifest with an unsupported asset kind returned HTTP 500. Manifest and compose imports now return 422 with field-level details (`/assets/1/kind: ...`), validate everything before building, and leave the graph and scene untouched on failure. Unexpected errors remain a generic 500.
- **MCP profiles:** `DK_MCP_TOOLS=investigation` now includes event search. `investigation-v1` reproduces the v1 evaluation tool set.
- **Evaluation:** v1 records and judgments are unchanged. Added: a review note, a read-only citation audit (identifier existence vs. evidence availability vs. claim support), a pending human-review packet, and the predefined v2 plan (`docs/AGENT_EVAL_V2_PLAN.md`).

## Unreleased (branch `pilot/browser-pilot`): controlled browser pilot

- **Browser pilot** (`e2e/`, Playwright, CI job `browser-pilot`). Runs the real server and worker on a fresh temp DB, the reference app through the real SDK, the built UI in Chromium, and a stdio MCP client. It covers source-to-screen evidence, human/MCP parity, 3D/2D parity, failed evidence fetches, WebGL fallback, staleness and unknown targets, crash-restart durability and reconnect, proposal-only containment, and untrusted evidence text.
- **Fix:** if the server became unreachable after a live session, the UI could silently swap in the offline *synthetic* demo. It now keeps the last data and shows a "not live monitoring" banner with the time of the last sync.
- **Fix:** the timeline said "Live" whenever a live project was at its latest position, even with the stream down. "Live" now requires a healthy stream, and a reconnect always refetches the snapshot.
- **Fix:** connection state now separates SSE transport from snapshot synchronization. After a reconnect the UI shows "Synchronizing" and keeps the stale-data warning until the catch-up snapshot is applied. A failed snapshot never shows Live, and while the stream stays connected it retries with bounded backoff until it clears. The non-synthetic dataset badge reads "Telemetry" instead of "Live".
- **Fix:** stale-source findings had no events, so they were stamped with the Unix epoch (shown as 00:00:00 and sorted first) and labelled synthetic in live projects. They now carry the derived moment the source went stale and the project's dataset kind.
- **Fix:** the event inspector did not show source-reported attributes or stored evidence records. They are now shown as plain, explicitly untrusted text.
- **Fix:** the public static demo probed `/api/me` at the origin root. Builds with `VITE_DK_STATIC_DEMO=1` (used by Pages) never contact a backend.
- **Upgrade docs:** prevention vs. recovery for v0.3.1 tombstones, plus a read-only diagnostic (`pnpm diagnose:tombstones <db>`). A new fixture, produced by the genuine v0.3.1 code, backs tests showing that tombstones are never presented as recovered and that a replayed source record is collapsed by dedup.
- Server test knobs: `DK_WORKER_PAUSED` (ingest-only) and `DK_COVERAGE_SWEEP_MS`. Reference app: input-filter denials record the offending input as the untrusted attribute `input_sample`.

## 0.3.2: safe upgrade from v0.3

- **Fix:** an in-place upgrade from v0.3 could tombstone *pending* journal rows, because v0.3 stored its redaction report inside the payload as `evidence._dk_redaction` and v0.3.1 rejects reserved keys. Legacy rows now go through a separate, versioned conversion that lifts out and type-checks that report, records its provenance in `journal.meta`, and re-minimizes the rest. Live ingestion is still strict.
- Regression tests run against a database fixture written by the genuine v0.3 code. They check pending rows processed exactly once, unchanged event ids and dedup, preserved redaction notes, restart, malformed legacy metadata, and live rejection of `_dk_` fields.
- **Guidance:** don't upgrade a v0.3 database with a backlog to v0.3.1; use 0.3.2 or later. 0.3.x is suited to a fresh-database, isolated, non-production pilot with controlled data. It is not production-certified.

## 0.3.1: hardening

- **Token delegation cannot escalate.** Only human admin tokens can issue tokens. Requested projects must be a subset of the issuer's scope, omitted projects default to the issuer's scope, and `*` is reserved for installation admins. Roles cannot exceed the issuer's. Service identities cannot mint identities. Project creation is installation-admin only, and project admins see only their projects' audit entries.
- **Reserved metadata.** `_dk_*` keys are rejected at ingestion at any depth. Redaction metadata moved to a server-controlled `journal.meta` column and is type-sanitized on every replay.
- **Per-record quarantine.** A record that fails deterministically is rolled back to its own savepoint, then quarantined, counted and audited, so later records still progress and restarts don't retry it. Infrastructure errors still roll back the batch and hold the checkpoint.
- **v0.2 upgrade path.** Legacy raw journal rows are re-minimized in place on first start (same seq and dedup keys), unparseable rows become tombstones, and the WAL is truncated. Tested against a v0.2-schema database holding raw markers. See docs/UPGRADING.md.
- **Demo publishing.** Back to GitHub's artifact deployment (`deploy-pages`). The build embeds `<meta name="dk-build">`, and the workflow checks the *served* page for this commit's id.
- **Interface redesign.** A new design system: one dark theme, a 4/8px grid, a type scale, one accent colour and an SVG icon set. A cleaner app shell with collapsible list and inspector, responsive down to one column. In 3D: new lighting and materials, priority-based labels that hide when they would overlap, glow only on active findings, and a framed camera with limits. In 2D: aligned cards, curved edges with arrowheads, clear coverage-gap styling, and pan, zoom and fit. A cleaner evidence pane and timeline.
- **Non-production trial test.** SDK → finding on the correct asset → identical evidence ids for the human API and MCP → visible source outage → unknown targets stay unknown → acknowledged events survive restart → an approved proposal changes nothing.

## 0.3.0: trustworthiness release

1. **Redaction before persistence.** `receive()` now minimizes and redacts the supported envelope (`minimizeIngest`) before the first durable write. The journal never holds raw payloads, and `secure_delete` is on. Test: planted password, bearer, JWT, cookie, query and attribute markers are absent from the journal, every table and the on-disk SQLite and WAL files, checked before processing, after processing and after restart.
2. **Honest assessments.** `assess-change` / `dk_assess_change` add `not_assessed` and `insufficient_context` postures, `assessment_complete`, and requested, resolved and unresolved target counts with reasons (`unknown_target`, `missing_graph`, `lookup_error`). An unresolved target never yields `no_recorded_concerns`.
3. **Source capabilities and evidence authority.** Every source must be assigned assets. Its kind (or an admin `allowed_actions` grant) limits which event categories it may assert, and observation categories are never granted by default. Enforcement runs at receive and again at normalization. New `independence_group`: corroboration and contradiction compare observation origin, not source id.
4. **Complete, paginated evidence.** `GET /findings/:id/evidence` retrieves events by the finding's own references, with expected and returned counts, missing event and evidence references, and `next_offset`. `dk_get_finding` pages through it and returns a `completeness` block. Case exports use exact references and carry `completeness` plus `manifest.complete`. The UI fetches older evidence on demand and flags incomplete views.
5. **OTLP/HTTP compliance.** Dedicated handler: HTTP 200 with `ExportTraceServiceResponse`, `partialSuccess.rejectedSpans`, Status-shaped errors, gzip with a decompressed-size cap, 415 for protobuf, and idempotent retries. Tested with the official OpenTelemetry JS exporter, plain and gzip.

**Approvals.** Tokens carry `principal_type` (`human` | `service`). Service tokens can request containment but never decide it, and the docs no longer claim that two different humans approved. New `POST /api/tokens` (admin).

**Demo deployment.** The Pages workflow publishes the offline demo to a `gh-pages` branch.

## 0.2.0
Initial vertical slice: engine, server, castle UI, 2D graph, replay, MCP server, Node SDK and reference app.
