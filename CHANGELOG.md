# Changelog

## Unreleased (on `main`, after 0.3.2)

### Roadmap R08.2: exact response plans and revalidation

- `POST /containment/:id/plan` attaches an exact plan (typed parameters per action, targets with provider ids, optional artifact digest, state fingerprint, evidence bundle, policy revision, TTL, downstream blast radius, reversibility with rollback or compensation, effect-observer coverage). The plan digest is part of what approvals bind; `GET /containment/:id/precheck` and approval both refuse drifted targets, changed policy or an expired TTL. Untyped actions and parameters with shell metacharacters are refused; there is still no executor.

### Roadmap R08.1: response authorization bound to subjects and policy

- Approvals are counted per authenticated subject (SSO issuer and subject, or a person an installation admin binds to a human token with `subject`), not per token. `POST /approval-policy` (human installation admin only) sets 1 to 3 required approvals; each approval binds the plan digest (action, permitted set, approval policy, finding revision) and stops counting if its token is revoked or expires. The requester's subject can never approve. Audit entries name the subject. Containment remains proposal-only.

### Roadmap R07.1: control inventory and verification records

- Controls (`apps/server/src/controls.ts`, migration 15): declared, configured, tested, failed, stale and unknown states derived only from verification records bound to the control's config digest, with expiry, observer availability and recorded conditions. A pass with an unavailable observer is stored as inconclusive; a config or policy change makes earlier tests stale. `/controls` routes and a Coverage → Controls tab.

### Roadmap R04.1: source-to-running-artifact lineage

- `apps/server/src/lineage.ts` and `POST /lineage/evaluate`: repository, commit, workflow, artifact digest, registry tag, deployment and runtime links with DSSE/in-toto SLSA v1 provenance verified against a policy of expected signers, builders and repositories; explicit undeclared, unsigned, unverified and verified states; tag and runtime drift. A merged commit is not treated as deployed until the runtime digest matches. Sigstore keyless bundles are not verified.

### Roadmap R03.3: credential aftermath and residual access

- `GET /aftermath/aws-key/:key` and MCP `dk_credential_aftermath`: from recorded CloudTrail events, the keys, sessions and grants an AWS access key created (transitively), each one's current state from the latest authorization snapshot, the surviving permission, audit gaps since first use, and a status of resolved, unresolved or unknown. Same-user key creation is flagged as possible rotation; malice is never claimed. Access key ids are stored in event attributes only as keyed fingerprints.

### Roadmap R04.3: scoped effective-access paths

- AWS IAM evaluator for S3 actions and `sts:AssumeRole` (`apps/server/src/access/aws-policy.ts`): explicit denies, identity and resource policies, permission boundaries, session policies, SCPs and cross-account both-sides rules, returning feasible, conditional (condition keys listed), blocked or unresolved (any missing input) with statement evidence, including paths through role assumption. `POST /access/snapshot`, `GET /access/paths`, MCP `dk_access_paths`. Always labelled configured permission, never observed access.

### Roadmap R02.4: AWS CloudTrail identity and audit pack (fixture conformance)

- `dk.aws.cloudtrail` connector, `cloud_audit` and `cloud_data_audit` source kinds, `POST /api/projects/:p/aws/scope` (one account, regions, configured data events) and `POST /ingest/aws/cloudtrail` for CloudTrail export files. Key ids link creation, grants and later use; cross-account records are refused; without configured data events, reads stay unknown. Verified only against sanitized fixture records (`fixtures/aws/`); no real AWS account has been checked.

### Roadmap R10.2: ingestion resilience and recovery

- Per-source admission budgets (`429 Retry-After`, counted as `rejected:throttled`), bounded backlog backpressure (`503 Retry-After`), disk-full answered as a retryable 503 with nothing written, AES-256-GCM encrypted backups (`pnpm backup`) and verified restores (`pnpm restore`: integrity, foreign keys, finding references, checkpoint bounds, counts), and `pnpm soak`. Measurements and RPO/RTO assumptions in `docs/OPERATIONS_RECOVERY.md`.

### Roadmap R05.3: MCP cases, capabilities and incremental delivery

- MCP `dk_capabilities` (contract and recipe versions, budgets, delivery model), `dk_case_changes` (cursor-based incremental case delivery; changes made while a client is disconnected arrive on the next poll), and `digital-kingdom://cases/{id}` resources. Oversized tool results are withheld with an explicit budget error (`maxOutputBytes`, `DK_MCP_MAX_OUTPUT_BYTES`), never cut. Server: `GET /api/capabilities`, `GET /cases/changes`. Remote MCP transport is deliberately not offered.

### Roadmap R05.2: one agent boundary, end to end

- Reference MCP tool gateway (`examples/reference-app/src/agent/boundary.ts`) that reports every call's intent, policy decision (`policy_enforcer`) and execution (`tool_wrapper`), plus a separate controlled receiver whose observer reports deliveries with its own key as `independent_observer`. Unobserved paths and permission assumptions are documented in code and receipt.

### Roadmap R10.1: deployment identity

- OIDC sign-in with pinned JWKS (RS256/ES256), explicit subject-to-role mappings (no mapping, no access), and immediate session revocation on unmapping. Token expiry (service default 90 days) and rotation; audited logout; trusted-proxy policy checked against the socket peer (Fastify's own protocol getter trusts any sender); anonymous demo off by default once live data exists; `pnpm admin:recover` for filesystem-only, audited, 24-hour human admin recovery.

### Roadmap R11.1: offline evaluation v2 harness

- `eval/src/v2/harness.ts` implements the v2 plan without any provider call: condition profiles (C2 is guarded against being labelled raw-only), an access-equivalence preflight that traverses every search page with the agent's real viewer credential and invalidates (never scores) cases with unequal or unreachable evidence, seeded generation of 12 families (8 v1 plus unlinked follow-on, shared address, mixed coverage, instruction contamination) as dev plus two held-out variants, eight length-matched clean/injected pairs (two per injection style), a preregistered counterbalanced order, three-denominator scoring, and budget reservation that stops before 80% of an approved cap. Real providers are refused without a separately approved budget. A test pins the digest of the v1 scenarios, grading keys and runs.

### Roadmap R02.2: one-command local application pack

- `pnpm quickstart` starts an isolated live project on 127.0.0.1 with its own database: declared inventory, four least-privilege sources (application SDK, database audit fixture, agent tool wrapper, independent effect observer), the instrumented reference app and a recorded agent run, and prints the guided steps (authorize, preview, import, validate, first event). `pnpm quickstart --reset` deletes `.dk-local/`. The Node SDK gains `dataAccess`, `toolStep` (with agent context), `sensorDown`/`sensorUp`.
- CI runs a real OpenTelemetry Collector binary (otelcol 0.112.0, checksum-verified) through Digital Kingdom's OTLP endpoint: delivery, retry while the server is down, collector restart, and the decompressed-size cap.

### Roadmap R02.3: read-only repository discovery

- `POST /discovery/github/preview` reads repository, workflow, deployment, release and head-commit metadata from the GitHub REST API (GET only; optional read-only `DK_GITHUB_TOKEN`). Workflow YAML is parsed as inert data: triggers, environments and referenced actions are kept; `run:` steps are never retained or executed. Stable ids come from GitHub numeric ids, so renames keep identity. Refused calls (rate limits, 403, 404) become partial discovery. The preview lists additions, removals, changes and id collisions; `POST /discovery/github/apply` needs the preview id and the base graph revision. Admin panel in Integrations → Connectors. Live-checked read-only against this repository.

### Roadmap R06.1: semantic world hierarchy

- `GET /scene/hierarchy`: realm, environment, provider account, district and structure groups with stable ids derived from declarations (never positions or findings), a flat searchable index, environment/account boundaries, the layout version and a footprint-collision report for stored scenes. `GET /scene/locate/:asset` resolves current or historical positions. Compiled scenes keep `historical_rooms` for assets that left the graph and a `layout_version` that advances on reflow; both sit outside the geometry digest, so existing scene digests are unchanged. MCP `dk_world_hierarchy`.

### Roadmap R03.2: investigation recipes

- Four versioned, deterministic recipes (`auth-burst-then-success@1`, `blocked-request-scope@1`, `agent-effect-attribution@1`, `change-or-maintenance@1`) return competing hypotheses with supporting and counter event ids, alternate explanations, bounded follow-on queries that include events no finding references, coverage checks, and stop conditions that block a conclusion when the needed observer was not live. A shared client IP is always kept as an unresolved locator, never attribution. `GET /api/recipes`, `POST /api/projects/:p/recipes/:id/run` (optionally attaching hypotheses to a case); MCP `dk_list_recipes`, `dk_run_recipe`; the case view can run a recipe on a linked finding.

### Roadmap R02.1: connector manifests

- Every ingestion path (event API, OTLP/HTTP JSON, Falco) has a manifest: protocol and exact versions, read scopes and why, pagination and resume, rate limits, cost, data handling, limits, and a verification level per capability (declared to live-verified; nothing is claimed live-verified). `GET /api/connectors`; Integrations gains a Connectors tab.
- Sources are bound to a connector (`connector_id`, `granted_scopes`). Installation grants only the manifest's required read scopes by default; administrative, wildcard, write and foreign scopes are refused. Connectors are collect-only by contract.
- Collectors report each collection window (`POST /ingest/collection-report`: complete, partial, permission_denied, throttled, scope_revoked, error; idempotent per report id). Historical coverage marks those windows partial or unknown with the collector's (redacted) reason.

### Roadmap R05.1: agent run contracts (ruleset dk-rules-1.2.0)

- Optional `agent` context on events: `phase` (intent, decision, execution, effect), `origin` (runtime_self_report, tool_wrapper, policy_enforcer, independent_observer), initiating principal, runtime, model route, tool and version, policy revision, step, parent run. Phase, outcome and origin must agree: a refusal cannot be recorded as enforcement, and an observer reports effects only.
- Only an `independent_observer` corroborates a runtime's reports; a runtime's own effect report never does. Runs from different runtimes with the same run id stay apart even inside one declared namespace. Events without agent context remain valid and the finding says independence was inferred from source grouping only.
- Prompts, completions, message history, reasoning and raw tool inputs/outputs are dropped from agent events before persistence (the removal is recorded). The demo's agent run now declares its phases and origins.

### Roadmap R03.1: durable cases

- Cases with their own identity, scope (question, assets, interval), owner, questions and hypotheses, closure criteria, and a timeline of linked findings, independent events and notes. Linking a finding pins an immutable bundle to the case. A closed finding never closes a case; closing requires every question answered or accepted unresolved, a closure statement, and the owner or an administrator. All edits are version-checked and recorded; removals are tombstones. Signed case export (`digital-kingdom-case/2`) lists unavailable records explicitly and verifies with `/api/verify-export`. Investigate workspace gains a Cases tab; MCP `dk_list_cases`, `dk_get_case`.

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
