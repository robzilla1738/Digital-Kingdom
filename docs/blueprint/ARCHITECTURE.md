# Architecture and evidence model

## 1. Boundary diagram in words

Sources produce inventories and events. Reviewed collectors authenticate, minimize, and buffer data. An authenticated receiver durably journals accepted records. Workers normalize them, update temporal asset relationships, and evaluate supported rules. A query API exposes authorized views. A scene compiler produces presentation data; a renderer displays it. An optional AI planner can propose presentation data before compilation. An optional narrator can explain a bounded evidence view.

There is no production-write path from the model or browser into monitored systems. The observation system is outside the application's request path wherever practical. Losing the dashboard must not bring down the application. Losing telemetry must produce an explicit degraded state.

## 2. Recommended first implementation

Use a TypeScript monorepo: React/Three.js/React Three Fiber for rendering, a conventional 2D graph, a Node/Fastify API and worker, and shared JSON Schema contracts. These are implementation choices to validate, not guarantees of throughput. Keep ingestion and rule evaluation off the browser's main thread.

Use PostgreSQL for project metadata, assets, relations, indexed event envelopes, findings, connector checkpoints, and a durable outbox. Start with relational graph tables, not a mandatory graph database. Maintain large evidence blobs in a controlled filesystem or optional object store with retention metadata. Do not use transient database notifications as the durable queue.

Use Server-Sent Events for a read-only browser event stream, with persisted cursors and reconnect/resume. Use regular authenticated API requests for configuration and analyst actions. Slow clients receive bounded aggregate updates and can refetch a snapshot; they do not block ingestion.

Use the OpenTelemetry Collector for standard OTLP handling, transformations, and forwarding. Pin and test a compatible collector distribution and its components. Do not implement a complete new telemetry protocol. Critical security events use a separate supported path and are not silently sampled with performance spans.

Start with Compose and a documented single-node profile. Add Helm, a separate analytical store, and brokers only when deployment needs justify them.

## 3. Canonical records

### Asset

Fields: stable asset ID; project/environment; logical kind; provider identifiers; names and aliases; owner; expected/observed provenance; discovery sources; software/deployment identity when known; valid-from/valid-to; first/last observed; lifecycle state; coverage references.

Do not use IP addresses as asset IDs. Do not create a new room whenever an ephemeral replica restarts. Stable logical services own transient instances. Identity reconciliation is explicit and reversible; conflicting matches go to a review queue.

### Relationship

Fields: edge ID; source/target asset or identity; semantic type; direction; scope; evidence level; source references; effective interval; observed interval; supporting event IDs; assumptions.

Examples: belongs_to, calls, runs_as, reads_from, deploys, invokes_tool, may_assume, protected_by. Keep declared, observed, and inferred relationships distinct. Network reachability is not proof of authorization. IAM capability evaluation must be action/resource/condition aware; it is not a generic shortest-path calculation.

### Event

Fields: schema version; project/environment; source identity and source-native ID; event time; received time; source clock quality when available; normalized asset references; action; outcome; request/trace/span/session/run identifiers when trustworthy; source-reported severity; evidence references; original parser/rule version; data classification; synthetic/live dataset provenance.

Use a keyed pseudonymous identifier for application sessions rather than storing bearer tokens. Do not blindly accept public request headers as trustworthy correlation data. Generate or validate boundary-local identifiers and record the trust decision.

### Finding

Fields: finding ID; kind; lifecycle; affected assets; supported claim; rule version; source-reported versus independently corroborated status; evidence IDs; counterevidence; time range; analyst disposition; coverage gaps; next-review steps.

Avoid an unexplained numerical confidence percentage. Use named evidence levels with documented requirements. Confirmation that a decoy was used does not confirm the identity of its user or their initial entry point.

### Coverage

Fields: source; intended scope; permissions tested; last success; heartbeat; lag; sampling; backfill support; retention window; dropped/rejected counters; gaps; known unsupported event classes; health state.

A coverage ratio can use a known declared inventory as its denominator. It must not claim to quantify the unknown universe of all assets.

### Scene

Fields: graph revision; scene schema version; compiler version; seed; approved module set; membership and zones; persistent transforms; label anchors; presentation settings; camera presets.

Security state is not a mutable field controlled by the scene planner. It is projected from the evidence/query layer when rendering.

## 4. Source model and priorities

**P0:** Explicit inventory, supported Compose/OpenAPI extraction, OpenTelemetry resource metadata, application authentication/authorization events, generic authenticated security-event intake, and one real adapter.

**P1:** Falco HTTP/JSON alerts, existing honeytoken webhooks, a cloud inventory/audit connector chosen by users, and a single agent/tool observer.

**P2:** Kubernetes runtime inventory and Hubble where already installed, cloud identity analysis, build/artifact metadata, vulnerability scanner exports with deployment binding, and SBOM/VEX context.

Metadata importers must be local, allowlist-based, and avoid ingesting environment-variable values or unrestricted Terraform state. Do not execute imported repository code to discover resources. Do not mount the Docker daemon socket into the web service for convenience.

A connector manifest records schema versions, permissions, event timing, replay/backfill behavior, supported kinds, ordering guarantees if any, and health probes. External adapters run with narrow credentials and resource/network limits. Plugin installation is an administrator operation.

## 5. Durability and ordering

Authenticate before accepting the source's project identifier. Bound request size, decompression ratio, nesting, and field cardinality. Deduplicate by source-native event ID when reliable; otherwise use a documented stable digest strategy that does not collapse legitimately repeated distinct actions.

Acknowledge receipt only after the applicable durable journal commit. Apply event processing and outbox publication transactionally or with retry-safe checkpoints. Delivery is at least once inside the explicitly supported window; processing is idempotent. Do not claim exactly-once end-to-end behavior.

Preserve event time and receive time. Late events can revise an investigation, with the revision shown to the analyst. Unknown clock skew is a reason to avoid asserting a total causal order. Replays bind to graph snapshots and versions as well as events. Tombstoned resources remain available to historical cases.

Enable collector persistent queues and monitor backlog, retry exhaustion, and disk pressure. These reduce loss but cannot eliminate source outages, disk failures, queue limits, or missing permissions. A rejected event and a dropped event must be counted separately.

Preserve evidence separately from visual aggregation. Ten thousand similar blocked requests can be one on-screen cluster while supported underlying records remain queryable within retention. Browsers do not receive every raw event by default.

## 6. Correlation and detection

Start with a small deterministic rule pack and explicit mappings to findings supplied by existing sensors. Do not train a universal anomaly detector for the first release.

Strong links may include a trusted request identifier across instrumented services, a source-authenticated session identifier, cloud session lineage, a process/container identity, or a registered agent run/tool invocation. A shared IP, time proximity, country, or user-agent string alone is weak association.

Rules distinguish attempted operation, accepted request, successful operation, observed side effect, and established security impact. HTTP 200 is not proof of exploit success. A WAF match is a reported detection; a matching installed CVE is a vulnerability assessment, not an observed attack.

Suggested initial findings: source-reported WAF match; repeated failures under an explicit window rule; unexpected sensitive privilege change requiring review; decoy credential use; sensor/coverage loss. Each has benign and missing-evidence fixtures. Known tests remain in the audit trail and are labeled, not silently deleted.

Unknown security activity outside the supplied logs is not detectable. A compromised collector can supply false data; signed events help authenticate origin but do not establish truth. Where important, correlate independent sources and surface disagreement.

## 7. AI integration

### Layout planner

Input: sanitized graph projection, approved module catalog, explicit allowed placements, prior approved layout, and style constraints. Exclude raw logs, tokens, customer data, and arbitrary repository documents.

Output: a schema-limited proposal containing existing asset IDs, allowed zone IDs, approved module IDs, style profile, and layout seed. The proposal has no arbitrary URLs, scripts, shader code, cloud actions, security edges, findings, or credentials.

Validation: JSON syntax; schema; unique IDs; exact coverage of required visible assets; allowed zone/module combinations; immutable logical identities; upper bounds; and then deterministic geometric validation in the compiler. Failed proposals are rejected with actionable errors. A maximum number of repair attempts and a cost limit prevent indefinite loops; fallback is always available.

### Narrator

Later input is a bounded, authorized case view with evidence IDs. Claims are generated as an explicitly unverified draft and checked for valid references. Never pass raw event text as system instructions. No shell, arbitrary network, write APIs, or production tokens are available to the narrator. Red-team prompt injection through source names, logs, tool responses, and imported assets.

### Agent telemetry

Store run identity, policy version, tool/server identity, requested operation category, enforcement decision, independently observed effect where available, and evidence references. Keep prompt bodies and outputs opt-in and redacted. Hidden chain-of-thought is not a required evidence source.

A tool wrapper sees only actions passing through that wrapper. Unsupported transports and bypass paths are explicit coverage gaps. Model refusal, guardrail denial, operating-system denial, and a completed action are different states.

## 8. Security and privacy

The map reveals architecture, identities, sensitive resources, and weaknesses. Treat it as confidential security data.

Require authenticated access before production use. Single-tenant v1 still needs project-bound authorization checks, least-privilege roles, session protection, and export auditing. Protect connector secrets outside browser storage and logs. Use TLS, encrypted storage, a rotation procedure, and a tested backup/restore plan.

Escape untrusted names and text. Do not load telemetry-supplied images or hyperlinks automatically. Restrict asset loading to a verified local catalog. Reject external URIs and hostile resource sizes in imported scenes. Guard source connectors against SSRF and redirect abuse. Bound regexes, parsers, queues, and graph traversal.

Do not collect cookies, authorization headers, passwords, private keys, customer payloads, or complete prompts by default. Prefer route templates over raw URLs. Redact before external export. Local storage still needs a retention policy and access control.

If retaining original evidence is necessary, keep it in a separately authorized store and identify any transformations. A digest of a redacted derivative is not the digest of its original. Sign and verify manifests where useful, but describe the guarantee: tamper detection relative to trusted records, not proof of completeness or legal admissibility.

Demo data is a separate project or datastore and cannot be made production evidence by a request parameter. Health monitoring includes an independent path so a broken ingestion pipeline cannot silently report itself healthy.

## 9. Scaling and operational targets

Initial benchmark profile: 200 registered logical assets, at most 50 detailed visible rooms, a 100-event/second sustained normalized workload, a one-minute 1,000-event/second burst with buffering, and a specified 4-vCPU/8-GB reference host. These are unmeasured goals, to be revised after benchmarks.

Target p95 of two seconds from durable acceptance to query/UI availability at the sustained profile. Separately display source-to-receive delay. Do not include delayed provider logging inside a promise the product cannot control.

Use indexed event envelopes, partition retention, time-bounded queries, and derived aggregate tables. Background workers enforce quotas and tombstone retention. Event-store or broker replacement happens behind stable interfaces only after profiling demonstrates a need.

The browser gets snapshots plus versioned deltas, batches updates, and aggregates activity. Geometry does not update for each event. Dynamic alert layers and stable architecture geometry remain separate.

## 10. Threat model boundaries

Supported defenses cover the console and its ingestion surfaces. The product does not establish truth if all relevant sensors are compromised, does not reveal activity that produces no available evidence, and does not universally discover shadow infrastructure.

No production response executes in v1. Future response functionality requires a separate authorization service, explicit operator approval, minimal write privileges, action-specific tests, rollback limits, and an audit sink the response executor cannot modify.

See SOURCES.md for primary documentation supporting source behavior, service identity, telemetry limits, collector buffering, and existing security/visualization components.
