# Changelog

## 0.3.1: hardening

- **Token delegation cannot escalate.** Only human admin tokens can issue tokens. Requested projects must be a subset of the issuer's scope, omitted projects default to the issuer's scope, and `*` is reserved for installation admins. Roles cannot exceed the issuer's. Service identities cannot mint identities. Project creation is installation-admin only, and project admins see only their projects' audit entries.
- **Reserved metadata.** `_dk_*` keys are rejected at ingestion at any depth. Redaction metadata moved to a server-controlled `journal.meta` column and is type-sanitized on every replay.
- **Per-record quarantine.** A record that fails deterministically is rolled back to its own savepoint, then quarantined, counted and audited, so later records still progress and restarts don't retry it. Infrastructure errors still roll back the batch and hold the checkpoint.
- **v0.2 upgrade path.** Legacy raw journal rows are re-minimized in place on first start (same seq and dedup keys), unparseable rows become tombstones, and the WAL is truncated. Tested against a v0.2-schema database holding raw markers. See docs/UPGRADING.md.
- **Demo publishing.** Back to GitHub's artifact deployment (`deploy-pages`). The build embeds `<meta name="dk-build">`, and the workflow checks the *served* page for this commit's id.
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
