# Proposed contracts and compatibility

The five JSON schemas in `contracts/` are **design proposals**, not descriptions of endpoints that already exist. Their examples are illustrative, not execution receipts. Validate them before adopting or adapting them to the repository. Schemas enforce shape; authorization, semantic completeness, target ownership and actual evidence require code and tests.

## Existing interfaces remain authoritative

Retain current case/finding/event IDs, project authorization, `dataset_kind`, evidence-bundle digests, source namespaces, history, and response-plan approval semantics. Do not rename or remove existing APIs to match this package casually. Version new behavior and document migrations.

Use a separate local-run provenance record: local run ID, world/blueprint version, source origin, execution mode, and synthetic-data status. An event can be an actual observation of a locally running synthetic application without becoming production evidence. The existing live/synthetic distinction must remain compatible with that nuance.

## Contract map

| Proposal | Purpose | Authoritative producer |
|---|---|---|
| `world-plan` | Finite reviewed local service composition | Validator/compiler, not untrusted text |
| `investigation-contract` | Public task scope and evidence obligations | Case service plus supported recipe/capability logic |
| `conclusion` | Structured, cited, bounded proposed answer | Investigator draft, checked by deterministic validators |
| `repair-plan` | Candidate actions and verification requirements | Planner; plan-only until independent lease authorization |
| `verification-receipt` | Observed local security and operational outcome | Independent verifier using actual effects and health |

Every proposal uses a distinct schema/version. Unknown fields are rejected. No schema allows a remote target URL, executable command, provider credential, or production execution authority.

## Semantic requirements beyond JSON validation

### World plan

Resource IDs are unique, every dependency resolves, and dependency cycles are rejected unless a separately supported lifecycle contract explicitly handles them. Template versions and image/artifact hashes come from the approved catalog. An endpoint is allocated by the supervisor, not chosen in the plan. Settings must match each template’s supported parameters; an empty free-form map must not become an arbitrary script/config injection surface.

### Investigation contract

Intervals must be ordered and bounded. Asset IDs and snapshot references must resolve within the caller’s project/run scope. Obligations are generated only from public case questions and actual available capabilities. `bounded_answer_ready` requires relevant obligations to be satisfied or explicitly inapplicable. `unresolved_answer_ready` requires documented unavailable/partial dependencies; it is not an escape hatch for work never attempted. A contract with unfinished work is normally collecting or blocked.

### Conclusion

Observed claims require actual supporting records. Negative claims require applicable interval-specific coverage and query completion. ID existence, exposure to the investigator and support for the exact proposition are separate checks. A mechanically checked predicate is not a certificate for all nearby narrative text. An unresolved claim needs an explicit reason and scope. None of these fields approves a response action or closes the case automatically.

### Repair plan

Each action type accepts only its matching parameters. Reject an object containing both token and arbitrary policy parameters for a single-token action. Resolve resource IDs only through the supervisor registry. Hash exact canonical content, including target/run/version, requested operation, parameter values, expiry and verification. A separate valid lease binds that hash and authority. The supplied schema intentionally permits `plan_only` only; do not mutate the example to execute it.

### Verification receipt

Each probe is correlated to an actual unique operation. The verifier checks observer capability and health at that operation’s interval. A pass requires the prohibited and permitted controls, sufficient supported observation, correct target revision, and no unexpected effect in scope. Overall pass requires acceptable cleanup. No before/after aggregate counter can substitute for per-operation attribution under concurrent traffic.

## API design guidance

Prefer adding a small set of domain endpoints behind current authorization rather than parallel independent stores. Suggested concepts are local runs, investigation contracts/jobs, case proposals, branch comparisons, local leases and verification receipts. Exact URL names are an implementation decision recorded in an ADR.

Read endpoints return evidence with scope/version/capability metadata. Writes require appropriate roles, optimistic version preconditions and audit. An endpoint that creates a persistent job or bundle is a write even if it does not alter a monitored application. Never rely on MCP annotations alone.

Use opaque cursors bound to project, run, query/filter, snapshot and expiry. Define removal/retention semantics. Cursor lifetime is not a permission grant; reauthorize every read. If job result size exceeds a budget, return resumable references and a partial state rather than a misleading empty list.

## MCP profiles

- `investigation-read`: cases, contracts, evidence, history and bounded read-only planning.
- `investigation-author`: same plus scoped case/contract proposals; no source configuration or approval rights.
- `lab-request`: propose exact local action plans and request a supervisor-authorized execution; cannot mint leases.

Consider a separate lab MCP server/process to reduce accidental exposure. The local executor itself is not a general tool exposed to production-configured agent sessions. Capabilities state transport, schema versions, scope and available role. Do not announce subscriptions unless actual client/server support is implemented; incremental polling remains a valid fallback.

## Compatibility and migration tests

Keep real historical database fixtures. New table migrations are transactional and additive where practical. Never regenerate old stored event IDs or overwrite frozen evidence while introducing run provenance. Store candidate/branch facts under a separate revision/namespace. Importing a capsule creates a new project scope with documented ID mapping and immutable original references.

A saved scene using the ten original modules must still load. New families require catalog versioning and fallback. An unsupported family shows a labeled placeholder with retained asset access; it must not disappear. Current 2D and accessibility paths remain usable.

A former model evaluation transcript is not rewritten to fit a new schema. Retain its original schema/decoder or describe its reproduction limitation.
