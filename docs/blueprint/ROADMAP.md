# Digital Kingdom: product and delivery roadmap

## 1. The product promise

**Understand what your application contains, what security activity was observed, how the evidence connects, and what remains unobserved.**

The castle is the signature interface. The evidence model is the product's source of truth. The security engine should work when the renderer is unavailable; the renderer should work with a saved synthetic case; AI should be optional in both cases.

A user should be able to open a room, see its real resource identity and owner, inspect recent findings, reconstruct a particular request or agent run, inspect the source records, and export a bounded investigation. The system must distinguish blocked attempts, successful operations, suspicious actions, demonstrated effects, and hypotheses.

“Works perfectly” is not a defensible release promise. Replace it with explicit support boundaries, reproducible tests, declared latency, visible collection gaps, and graceful failure. Unknown must never be rendered as safe.

## 2. Initial users and scope

Start with developers and small platform teams operating a web application with roughly 5–50 logical services. Support one organization and one environment per project. A local synthetic demo requires no cloud credentials. Production operation is read-only with respect to monitored systems.

Choose a reference deployment: browser frontend, edge/reverse proxy, authentication component, application API, worker, database, and optional agent/tool service. Begin with a Docker Compose fixture and an explicit asset manifest; accept OpenAPI metadata for route inventory. Both describe intended configuration and must not be mistaken for runtime truth.

Do not start by supporting every cloud, every agent framework, every deployment system, and every SIEM. Publish a matrix identifying supported sources, collected fields, prerequisites, required permissions, sampling, retention, and known blind spots.

## 3. The minimum useful journey

1. Run the isolated demo and inspect a clearly labeled synthetic incident.
2. Import a manifest and supported deployment metadata without uploading secrets.
3. Review the discovered logical services, relationships, and unresolved items.
4. Generate a deterministic castle; optionally ask an AI planner for a constrained grouping/style proposal.
5. Approve the mapping; retain stable room positions across routine deployments.
6. Connect authenticated security events and selected tracing data.
7. Run a benign local verification event and confirm source-to-room mapping.
8. Investigate a finding using the same evidence in 3D, 2D, and the timeline.
9. See a collection gap immediately when a connector fails.
10. Export the case, evidence references, coverage window, and versions used.

The onboarding target is a first useful map within 15 minutes on the documented reference setup **after prerequisites exist**. This is a usability target to measure, not a claim about uninstrumented applications.

## 4. Five separate product surfaces

**Map:** inventories, actual resource names, ownership, exposure, trust relationships, and coverage.

**Live activity:** aggregated observations and findings, with source delay and ingestion health visible. No simulated particles masquerading as live observations.

**Investigation:** linked events, counterevidence, source records, analyst notes, and historical replay.

**Exposure:** later, supported vulnerability and permission relationships. Hypothetical paths have distinct rendering and retain their assumptions.

**Configuration and health:** collection permissions, connector status, retention, AI opt-in, asset mapping, scene preferences, and audit history.

Keep operational health, security findings, and telemetry coverage separate. A database can be available, have a security finding, and have incomplete audit coverage at the same time.

## 5. Milestones and acceptance gates

These are planning estimates for two experienced engineers, a part-time 3D technical artist, and periodic independent security review. Tasks overlap; real schedules depend on integration complexity and pilot feedback. They are not promised delivery dates.

### Phase 0: validate the user problem and contracts — weeks 1–2

Produce a product brief, source/permission matrix, threat model, graph/event/scene contracts, reference application inventory, and a small fixture corpus. Interview 5–8 prospective users about incident questions they currently struggle to answer.

Build two paper-level interaction paths: castle-to-evidence and 2D-to-evidence. Agree on consistent terminology for an attempted action, observed effect, source-reported finding, and analyst-confirmed incident.

**Gate:** each entity and finding can be explained without the castle metaphor. Every planned integration has an owner, realistic data source, and known limits. The team has selected one initial application stack.

### Phase 1: polished synthetic vertical slice — weeks 3–5

Implement graph loading, scene compilation, stable asset-to-room mapping, a modular castle, a matching 2D view, selection, search, timeline, replay, and the evidence drawer. Use licensed modular assets rather than a huge generated mesh.

Add an optional layout planner that outputs a small JSON proposal. Validate references and constraints, then compile it with trusted code. Invalid or unavailable AI output falls back to the deterministic default. The planner does not have access to real telemetry or cloud credentials.

**Gate:** the complete synthetic incident is understandable and replayable. Every security animation has an evidence ID. Scene generation does not invent assets or relationships. A user can inspect all findings without navigating in 3D. The product is clearly labeled a demo, not yet production monitoring.

### Phase 2: instrumented live alpha — weeks 6–10

Build the authenticated receiver, durable event journal, normalization worker, inventory reconciliation, stable service identity, source freshness, idempotency, and resume-capable event delivery. Implement one Node application security-event adapter, selected OTLP ingestion, and one real security-source adapter; allow manual authenticated JSON ingestion for other experiments.

Use dedicated unsampled security events for security-critical actions; sampled performance traces are context, not a complete security ledger. Implement a small, documented rule set: reported WAF finding, repeated authentication failure, sensitive authorization change, honeytoken trigger, and loss of telemetry. A successful login alone is not a compromise rule.

**Gate:** a controlled reference application produces real source events that appear in the correct room and evidence pane. Duplicate delivery does not duplicate findings. Denied collection permission becomes a visible coverage gap. No cloud write privileges are required.

### Phase 3: harden a private beta — weeks 11–16

Add session authentication, viewer/analyst/admin roles, protected evidence export, source allowlists, quotas, bounded parsing, encryption at rest/in transit, source secret handling, retention controls, backup/restore, audit logging, and security regression tests. Treat these as prerequisites to production pilots, not later premium features.

Test collector downtime, full disks, queue pressure, delayed source events, browser reconnect, GPU loss, hostile labels, malicious URLs, scene JSON injection, and invalid model output. Run sustained load on named reference hardware. Verify restoration from a clean machine.

**Gate:** pass the supported threat model and fault tests; complete a time-bounded soak test; publish measured throughput and latency; run 3–5 pilot deployments without unattended production response actions.

### Phase 4: agent evidence and deception — weeks 17–22

Integrate one agent/tool execution environment. Collect run ID, parent step, actor identity, tool/server identity, allowed/denied decision, action result, approved destination, and redacted evidence references. Do not collect hidden reasoning, unrestricted prompts, or raw secrets by default.

Connect an existing honeytoken implementation. Add independent observation of a controlled outbound test endpoint and agent tool effects. Display differences between requested, permitted, attempted, and observed actions.

**Gate:** a controlled test can distinguish model refusal from enforcement blocking and actual execution. A honeytoken trigger is linked to its placement without claiming to identify the human attacker or original breach point. The AI narrator cannot execute tools or alter security conclusions.

### Phase 5: version 1 and extensibility — weeks 23–28

Stabilize contracts and migrations, publish installation and recovery documentation, ship contributor examples, sign releases, publish a dependency inventory, review asset licenses, and release a public synthetic demonstration. Add one prioritized inventory connector based on actual pilot demand, not a large connector catalog.

Measure the castle against the equivalent 2D workflow. Improve or reduce 3D elements that slow users down. Publish known limitations and the current supported-source matrix.

**Gate:** users can install, verify, upgrade, restore, and investigate the documented reference setup; important findings have evidence and explicit coverage; user tests demonstrate a useful task outcome. Release labels reflect actual maturity.

### After version 1

Add deeper cloud identity paths, deployment/artifact provenance, vulnerability context, multi-project fleet navigation, and richer connector isolation. Add a separate event store or broker only when measured load requires it. Multi-tenant hosted operation needs its own threat model and release gate.

Automated remediation is a distinct future project: explicit policy, approval, narrow credentials, dry runs, rollback, and an independent audit channel. Do not quietly add it to an incident assistant.

## 6. How AI should help

There are four different roles:

**Development assistant:** creates bounded implementation changes against contracts and fixtures. Humans review dependency choices, permissions, authentication, event correlation, and release artifacts.

**Layout planner:** proposes groupings and approved module/style choices from sanitized metadata. It cannot create security facts. The stable layout compiler validates and applies the proposal.

**Asset authoring assistant:** helps create modular source assets or reviewed Blender scripts in an offline sandbox. Humans validate geometry, scale, licensing, performance, and usability before assets enter a signed release.

**Investigation explainer:** later, produces source-linked explanations from a bounded case view. It cannot execute arbitrary queries, fetch arbitrary URLs, change rules, or modify production. Analysts can inspect the exact evidence behind each sentence.

No AI provider should be required for installation, detection, replay, evidence export, or ordinary layout updates.

## 7. Adoption and open-source model

Proposed code license: Apache-2.0, subject to the maintainer's goals and dependency review. This is a permissive choice; it does not prevent proprietary forks. Asset licenses are tracked separately and must permit repository redistribution and modification.

Publish governance, maintainers, contribution guidelines, a developer certificate of origin policy, disclosure instructions, version support windows, and a transparent roadmap. Keep authentication, redaction, evidence export, and basic integrations in the open-source core.

A connector contribution should include its minimum permissions, source schema versions, field mapping, time semantics, sample events, malformed-input tests, coverage behavior, and migration policy. A detection contribution needs positive, benign, ambiguous, and missing-evidence fixtures.

Prefer a focused maintainer set with code ownership for contracts, evidence, connectors, and rendering. Avoid a central mandatory telemetry service. Hosted convenience or support may be optional funding paths, but the core should remain self-hostable and usable offline with imported evidence.

## 8. Resources and cost discipline

Plan on one evidence/backend engineer, one frontend/3D engineer, limited technical-art time, and security/user testing. A solo developer should expect a substantially longer path and should hold the scope to one stack.

AI can reduce repetitive implementation and asset-preparation work; it does not remove architecture, security-review, or operational-maintenance responsibilities. A polished demo in several weeks and a trustworthy supported beta several months later are different milestones.

Start with a single-node deployment. Track retained event volume before selecting storage. At 100 events/second and 1 KB/event, payload alone is approximately 8.64 GB/day; at 1,000 events/second it is 86.4 GB/day, before indexes, replicas, or backups. These are arithmetic sizing assumptions, not observed product metrics. Retention and aggregation are essential.

Use short default retention for performance traces, configurable retention for sanitized security events, and explicit retention for incident evidence. Warn before quotas force dropping or expiring evidence. A disabled LLM should not increase operational risk or stop ingestion.

## 9. Success measures

Measure setup completion, correct asset mapping, evidence retrieval time, time to distinguish a blocked attempt from a successful effect, correct recognition of missing coverage, false causal links, alert volume per investigated case, user correction rate, and reproducibility of replay.

In user testing, compare identical evidence in 3D and 2D, counterbalance task order, and measure errors as well as speed. An initial 8–12-person study can identify usability problems; it does not prove general superiority.

The project succeeds when users make better-supported decisions. A screenshot, star count, or animated attack does not establish security benefit.

## 10. First public demonstration

Use an isolated, local reference application. Show a normal request, a rejected suspicious request, an authorized login, a sensitive action linked by a trusted request/session identifier, and a synthetic honeytoken event. Include a deliberately missing sensor to demonstrate honest uncertainty. At least one later demo must exercise a real source adapter, not merely post fabricated alerts directly to the renderer.

The presenter clicks a room, sees the real asset name and source records, changes to 2D, rewinds the same incident, and exports a reproducible case. All demo-generated events are visibly marked and segregated from production findings.

That is the first complete product story. Build and validate it before expanding the kingdom.

## Documentation basis

See SOURCES.md for primary documentation. The roadmap, durations, targets, and design choices are proposals. Existing source capabilities include OpenTelemetry service identity and sampling, Falco event output, Cilium/Hubble service maps, modular CC0 castle assets, glTF delivery, and constrained graph layout. None establishes complete security visibility on its own.
