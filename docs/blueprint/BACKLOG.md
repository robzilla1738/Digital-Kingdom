# Ordered implementation backlog

Priorities P0–P5 correspond to roadmap phases, not severity. Each issue should become a small set of reviewable changes. The list is a proposed backlog, not evidence of completed work.

| ID | Phase | Issue | Acceptance criterion | Depends on |
|---|---|---|---|---|
| TK-001 | P0 | Define user/problem brief | Record reference application and three investigation tasks. | None |
| TK-002 | P0 | Write source/permission matrix | Each source lists required access, delay, sampling, backfill, and blind spots. | TK-001 |
| TK-003 | P0 | Write threat model | Cover telemetry injection, SSRF, evidence disclosure, malicious assets, and model output. | TK-001 |
| TK-004 | P0 | Version core contracts | Assets, relationships, events, findings, coverage, and scenes have schemas and fixtures. | TK-002 |
| TK-005 | P0 | Build golden synthetic corpus | Benign, suspicious, missing-evidence, duplicate, and delayed sequences have expected outcomes. | TK-004 |
| TK-006 | P1 | Curate licensed modular kit | Module manifest includes source, license, dimensions, sockets, detail levels, and budgets. | TK-003 |
| TK-007 | P1 | Implement scene validation | Reject unknown IDs, duplicate membership, unsupported modules, and prohibited fields. | TK-004,TK-006 |
| TK-008 | P1 | Implement deterministic layout | Same inputs reproduce positions; adding a room does not move unrelated pinned rooms. | TK-007 |
| TK-009 | P1 | Render castle viewer | Select correct assets; roofs can be hidden; labels remain readable. | TK-008 |
| TK-010 | P1 | Build 2D and evidence pane | Selection, filters, and evidence agree with 3D. | TK-004 |
| TK-011 | P1 | Implement replay | Timeline binds graph revision, scene, events, and rule versions. | TK-005,TK-009,TK-010 |
| TK-012 | P1 | Optional AI scene proposal | Sanitized bounded input, validated output, retry budget, and offline fallback. | TK-007,TK-008 |
| TK-013 | P2 | Authenticated event receiver | Project-bound source identity, bounded input, durable acknowledgment, and deduplication. | TK-003,TK-004 |
| TK-014 | P2 | Durable processing/outbox | Restart recovery and duplicate-safe finding creation pass fault tests. | TK-013 |
| TK-015 | P2 | Local metadata importer | Allowlist parsing of supported manifests; no code execution or secret upload. | TK-004 |
| TK-016 | P2 | OpenTelemetry integration | Stable resources and selected traces map correctly; sampling is reported. | TK-013,TK-015 |
| TK-017 | P2 | Application auth event adapter | Failed/successful auth and authorization events preserve trusted identifiers and outcomes. | TK-013 |
| TK-018 | P2 | First security source adapter | An actual source event reaches an evidence-linked finding through authenticated ingestion. | TK-013 |
| TK-019 | P2 | Initial deterministic rules | Positive, benign, ambiguous, and missing-evidence fixtures pass. | TK-005,TK-014 |
| TK-020 | P2 | Coverage and connector health | Permission loss, clock/ingest lag, gaps, and retries appear visibly. | TK-014,TK-016 |
| TK-021 | P2 | Live SSE updates | Bounded deltas, resume cursor, and snapshot recovery work under reconnect. | TK-014,TK-009 |
| TK-022 | P3 | Production authentication and RBAC | Backend enforces viewer/analyst/admin and restricted exports. | TK-003,TK-013 |
| TK-023 | P3 | Privacy and retention | Default redaction, route normalization, quotas, and incident retention are tested. | TK-003,TK-014 |
| TK-024 | P3 | Backup and recovery | Clean-host restoration recovers metadata and evidence references. | TK-014,TK-023 |
| TK-025 | P3 | Collector and ingestion chaos | Disk, queue, source downtime, duplicates, and delayed events degrade honestly. | TK-020,TK-024 |
| TK-026 | P3 | Renderer performance and accessibility | Measured reference scene, reduced motion, keyboard workflow, and context-loss fallback. | TK-009,TK-010,TK-021 |
| TK-027 | P3 | Adversarial input review | XSS, SSRF, scene/mesh abuse, decompression, and prompt injection tests pass. | TK-012,TK-022,TK-023 |
| TK-028 | P3 | Private pilot | Three to five consenting teams complete source setup and investigations. | TK-025,TK-026,TK-027 |
| TK-029 | P4 | Agent metadata adapter | One supported runtime reports run/tool/policy/action/effect with coverage boundaries. | TK-014,TK-023 |
| TK-030 | P4 | Honeytoken integration | Registered placement and signed/source-verified alerts correlate without identity overclaims. | TK-018,TK-020 |
| TK-031 | P4 | Independent agent-effect fixture | Differentiate refusal, enforcement denial, attempted action, and controlled observed effect. | TK-029 |
| TK-032 | P4 | Bounded evidence narrator | Optional source-citing draft with no production tools, secret input, or evidence mutation. | TK-027,TK-029 |
| TK-033 | P5 | Public release pipeline | Pinned build dependencies, provenance, dependency manifest, and verification instructions. | TK-027 |
| TK-034 | P5 | Contributor SDK and governance | Connector template, fixture rules, disclosure process, maintainers, and version policy. | TK-028 |
| TK-035 | P5 | User comparison study | Counterbalanced 2D/3D tasks measure errors, time, and recognition of unknowns. | TK-028 |
| TK-036 | P5 | Supported 1.0 release | Documented installs/upgrades/restores and published measured limits; all release gates reviewed. | TK-031,TK-033,TK-034,TK-035 |
