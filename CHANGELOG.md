# Changelog

## Unreleased (on `main`, after 0.3.2)

### Roadmap R01: evidence and history (branch `roadmap/r01-evidence`)

- **Versioned facts (R01.1).** Bitemporal entities and assertions (`valid_from`/`recorded_at`, typed: declared, observed, inferred, hypothesis, test result) with provenance. Late discovery adds knowledge without rewriting what was known; a deleted and recreated resource is a new incarnation; conflicting sources stay a conflict until an attributed, precondition-checked reconciliation. Optional asset `provider_ref`. `GET /facts`, `/facts/conflicts`, `/facts/entities/:ref`, `POST /facts/assertions`, `/facts/reconciliations`; MCP `dk_facts`.
- **Historical coverage (R01.2).** `GET /coverage/history` answers "could this asset/action/outcome have been recorded in this interval" as covered, partial and unknown spans with per-source reasons. Source configuration revisions, precondition-checked enable/disable with effective times, and declared sampling, retention and outcome limits. Liveness is judged by receipt time. Current coverage now reads per-source state from all stored events, so a bounded window can no longer hide a quiet source's outage (it previously showed as "not assessed"). Coverage workspace gains a Historical question tab; MCP `dk_coverage_history`.
- **Evidence bundles (R01.3).** Immutable, content-addressed bundles pin a finding revision's exact records and digests; deleted or altered records are reported, expiry returns 410 with metadata, pinning retains them. Historical finding revisions are retrievable. The case export names the same bundle; MCP `dk_create_bundle`, `dk_get_bundle_events`; the finding view can pin one.
- **Concurrency (R01.4).** Preconditions for finding review, source configuration and (optionally, via If-Match) scene layout; recorded actor/before/after history; historical annotations by `as_of`; containment approvals bound to policy and evidence with expiry.
- **Bounded queries (R01.5).** Benchmark at 10k/100k/1M events (`scripts/bench-search.ts`, results in `docs/roadmap/R01.5-BENCHMARK.md`), plan-driven indexes, capped counts, response byte budget, expiring cursors, removal detection mid-pagination, per-principal rate limit, and current coverage without a rule run per request.

### Roadmap R00: correctness baseline (branch `roadmap/r00-correctness`)

- **Typed, namespaced correlation (R00.2).** Rules join identifiers only inside an administrator-declared authority (`identity_namespace`, `run_namespace` on sources; undeclared = private). Two sources reporting `admin`, an account id equal to a session id, a success on another asset, or equal run ids from unrelated runtimes no longer link or corroborate. Ruleset `dk-rules-1.1.0`; history kept as revisions.
- **Route resolution (R00.3).** Optional declared route inventory on graph assets (schema and manifest). Ambiguous routes return every candidate (context 409; assessments cover all); event-inferred ownership is labelled and never favorable. The resolver no longer picks the most frequently observed asset.
- **Boundaries (R00.4).** Token-shaped values are masked in rejection and quarantine details (they could previously be echoed); `date-time` formats enforced in agent-schema tests; token revocation endpoint with cursor/session tests; budget, hostile-identifier and poison-row tests.
- **Receipts.** `docs/roadmap/` holds the owner's forward roadmap, the package ledger (`STATUS.json`), the R00 receipt and the R00.5 manual review packet (unrun).

### Castle visual refresh

- **Architecture.** The gatehouse now has two crenellated towers with slate spires and a crenellated gate walk, the guardhouse gains a round watch turret with a conical roof, and the vault gets corner buttresses. Every module stays inside its catalogued footprint, height and triangle budget, and roof-off still shows each interior floor.
- **Materials.** A warmer limestone and slate palette, deterministic per-part tonal variation, and baked ground-contact darkening so buildings sit on their terraces. Building colour stays independent of status.
- **Setting.** The district terraces now sit on a lawn island with earth-banded sides that also covers the paths between districts (no more paving overhanging the edge), with scattered low-poly trees as non-selectable decoration placed outside every district. No walls, moat or perimeter are drawn, since none is implied.
- **Lighting.** A warmer key light and a deeper ground bounce.
- **Camera tools.** The castle and graph camera tools sit in one compact row instead of a tall column that covered the scene.
- **Tooling.** `pnpm castle:manifest` regenerates `assets/castle-kit/MANIFEST.json` (source hashes, per-LOD triangles and bounds, palette).
- README screenshots re-shot from the offline demo, and the README updated for the redesigned workspaces and keyboard shortcuts.

### Interface redesign (from the owner-provided redesign branch)

- New workspace shell: **Kingdom** (castle and graph), **Investigate** (findings and event search), **Coverage** and **Integrations**, with a shared non-modal inspector and an expandable finding view.
- Exact evidence cards, bounded expanded timeline lanes, known-time vs. event-time replay with a visible replay scope, grouped districts for large scenes, a relationship chooser for overlapping paths, and labelled neutral-block recovery for module geometry or shader failures.
- Redesign acceptance suite (`pnpm pilot:redesign`) and verification artifacts under `artifacts/redesign/`.

### Event investigation, honest assessments, import validation (from branch `improve/investigation-honesty`)

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

### Controlled browser pilot (from branch `pilot/browser-pilot`)

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
