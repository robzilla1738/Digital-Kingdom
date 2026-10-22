# Digital Kingdom — implementation blueprint

**Status:** Planning and interface-design package, not a built security product.
**Prepared:** October 21, 2026.
**Name:** Working name; availability and trademarks have not been checked.

Digital Kingdom is a proposed self-hosted security console that turns an application's asset graph and security evidence into a navigable, adaptive 3D castle. The same evidence must remain usable in a conventional 2D graph and timeline. AI may propose presentation choices, but never invent infrastructure, declare compromise, or modify production.

## Read in this order

1. [Roadmap](ROADMAP.md): product scope, milestones, staffing assumptions, and release gates.
2. [Architecture](ARCHITECTURE.md): system boundaries, evidence model, collection, storage, correlation, and security.
3. [Visual specification](VISUAL_SPEC.md): how to produce a polished modular castle and keep it usable.
4. [Acceptance tests](ACCEPTANCE.md): correctness, integration, resilience, security, rendering, and user-value tests.
5. [Backlog](BACKLOG.md): ordered implementation issues with acceptance criteria.
6. [AI contributor instructions](AGENTS.md): bounded implementation workflow and prohibited shortcuts.
7. [Sources](SOURCES.md): primary documentation behind technology capabilities and important constraints.

The `schemas/` directory contains proposed JSON contracts. The `examples/` directory contains **synthetic** fixture data. `validate_examples.py` validates those example contracts and a narrow set of semantic constraints. It is not a production security validator, renderer, ingestion service, or implementation of the full architecture.

## Initial scope

One organization, one instrumented web application, one environment, approximately 5–50 logical services. Inventory comes from an explicit manifest, supported deployment descriptors, and OpenTelemetry metadata. Ingestion begins with application security events, selected traces, and one authenticated security-event adapter. A readable castle, timeline, and evidence pane work without an AI provider.

## Explicit non-goals for the first release

No universal asset discovery; no promise of complete attack detection; no human-attacker attribution; no automatic production blocking; no tenant-shared hosted service; no general-purpose SIEM replacement; no mandatory first-person gameplay; no arbitrary model-generated executable code.

## Validation performed for this package

The accompanying validation script checks JSON Schema validity, the supplied example data, graph and scene reference integrity, exact one-time scene membership of fixture assets, permitted module choices and zones, and rejection of several malformed scene proposals. A generated `VALIDATION_REPORT.md` records the actual result. Nothing here claims that the proposed product has been implemented, benchmarked, independently audited, or tested against live infrastructure.

## Proposed product repository

```text
apps/web/                   # 3D, 2D, evidence UI, replay
apps/server/                # Authenticated ingestion, queries, SSE, administration
apps/worker/                # Normalization, correlation, snapshots, retention
packages/contracts/         # Versioned schemas and generated types
packages/graph-core/        # Pure asset and relationship transformations
packages/scene-compiler/     # Deterministic layout and module assembly
packages/connectors/        # Reviewed source adapters and fixtures
packages/detections/        # Versioned rules with benign and malicious fixtures
packages/agent-observer/     # Later: approved run/tool/policy metadata adapter
assets/castle-kit/           # Modules, source files, licenses, manifests
fixtures/                   # Synthetic event sequences and expected results
infra/compose/              # Local demo and single-node deployment
security/                   # Threat model, disclosure process, permissions
```

This blueprint itself does not include third-party meshes, proprietary datasets, credentials, or production code. License selection for the future repository remains an explicit maintainer decision.
