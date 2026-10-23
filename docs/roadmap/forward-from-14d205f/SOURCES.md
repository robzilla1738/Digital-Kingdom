# Sources and evidence scope

All repository file links below are pinned to `14d205fc295d0d8584f8c81d183193c4d75dc96d`. External documentation is a current reference, not a permanently pinned implementation dependency.

## [R01] Main snapshot and source inventory
Source: https://github.com/robzilla1738/Digital-Kingdom/commit/14d205fc295d0d8584f8c81d183193c4d75dc96d

Branch resolved through GitHub connector; main remained at this SHA on final check. Full tree enumerated; selected implementation files read.

## [R02] Exact-head CI
Source: https://github.com/robzilla1738/Digital-Kingdom/actions/runs/39872878689

Check-job log inspected; 376 tests/43 files. Downloaded artifact 12467382603 parsed independently: pilot 11 expected; redesign 77 expected/1 skipped/0 unexpected/0 flaky.

## [R03] Exact-head Pages workflow
Source: https://github.com/robzilla1738/Digital-Kingdom/actions/runs/39872878685

Workflow success observed; static demo, not production backend deployment.

## [R04] Current change log
Source: https://github.com/robzilla1738/Digital-Kingdom/blob/14d205fc295d0d8584f8c81d183193c4d75dc96d/CHANGELOG.md

Merged redesign and current architectural refresh; history is not automatically current acceptance.

## [R05] Historical redesign acceptance
Source: https://github.com/robzilla1738/Digital-Kingdom/blob/14d205fc295d0d8584f8c81d183193c4d75dc96d/docs/redesign/ACCEPTANCE.md

Frozen earlier candidate receipt; manual and physical-hardware gates retained, not automatically cleared by merge.

## [R06] Redesign implementation notes
Source: https://github.com/robzilla1738/Digital-Kingdom/blob/14d205fc295d0d8584f8c81d183193c4d75dc96d/docs/redesign/IMPLEMENTATION.md

Prior candidates, supported recovery boundaries, clean-checkout and artifact-isolation context.

## [R07] Capability audit
Source: https://github.com/robzilla1738/Digital-Kingdom/blob/14d205fc295d0d8584f8c81d183193c4d75dc96d/docs/redesign/CAPABILITIES.md

Actual workspace controls and explicit unsupported backend capabilities.

## [R08] Presentation and replay state
Source: https://github.com/robzilla1738/Digital-Kingdom/blob/14d205fc295d0d8584f8c81d183193c4d75dc96d/apps/web/src/lib/state.tsx

Pinned selection, explicit updates, current coverage during replay, graph/time limitations.

## [R09] Current README scope and limitations
Source: https://github.com/robzilla1738/Digital-Kingdom/blob/14d205fc295d0d8584f8c81d183193c4d75dc96d/README.md

Supported adapters, single-node scope, no response execution, current test documentation.

## [R10] Detection rules
Source: https://github.com/robzilla1738/Digital-Kingdom/blob/14d205fc295d0d8584f8c81d183193c4d75dc96d/packages/detections/src/rules.ts

Typed/source namespace omissions identified by source review in authentication/session joins. Needs executable regression, not an alleged production incident.

## [R11] Event normalization
Source: https://github.com/robzilla1738/Digital-Kingdom/blob/14d205fc295d0d8584f8c81d183193c4d75dc96d/packages/detections/src/normalize.ts

Stable event IDs include project/source; raw actor/session/run references are preserved, not automatically issuer-namespaced.

## [R12] Agent context and change assessment
Source: https://github.com/robzilla1738/Digital-Kingdom/blob/14d205fc295d0d8584f8c81d183193c4d75dc96d/apps/server/src/context.ts

Route ownership heuristic and current-target assessment; no prospective candidate diff in this implementation.

## [R13] Storage schema
Source: https://github.com/robzilla1738/Digital-Kingdom/blob/14d205fc295d0d8584f8c81d183193c4d75dc96d/apps/server/src/db.ts

Existing graph/finding revisions and current source table; no independent case/hypothesis/control/executor domain.

## [R14] MCP implementation
Source: https://github.com/robzilla1738/Digital-Kingdom/blob/14d205fc295d0d8584f8c81d183193c4d75dc96d/apps/mcp/src/server.ts

Read-mostly shared backend tools; bounded transport client; proposal boundary.

## [R15] Canonical types
Source: https://github.com/robzilla1738/Digital-Kingdom/blob/14d205fc295d0d8584f8c81d183193c4d75dc96d/packages/contracts/src/types.ts

Ten current asset kinds/modules, six zones, nine relationship kinds and current event vocabulary.

## [R16] Castle environment implementation
Source: https://github.com/robzilla1738/Digital-Kingdom/blob/14d205fc295d0d8584f8c81d183193c4d75dc96d/apps/web/src/castle/Environment.tsx

Deterministic nonselectable lawn/trees/terraces; explicitly no invented security perimeter.

## [R17] Store and proposal workflow
Source: https://github.com/robzilla1738/Digital-Kingdom/blob/14d205fc295d0d8584f8c81d183193c4d75dc96d/apps/server/src/store.ts

Bounded current evaluation window, token identities, proposal decisions without execution.

## [R18] Evaluation v2 plan
Source: https://github.com/robzilla1738/Digital-Kingdom/blob/14d205fc295d0d8584f8c81d183193c4d75dc96d/docs/AGENT_EVAL_V2_PLAN.md

Plan and offline accounting, not a completed paid evaluation. Separate approval and honest human-review scope.

## [E01] OpenTelemetry Collector resiliency
Source: https://opentelemetry.io/docs/collector/resiliency/

Official guidance on queues, retries, persistent buffering and remaining loss scenarios.

## [E02] AWS effective policy evaluation
Source: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic_policy-eval-denyallow.html

Official applicable policy and explicit-deny semantics; pin provider behavior when implementing.

## [E03] GitHub artifact attestations
Source: https://docs.github.com/en/actions/concepts/security/artifact-attestations

Official provenance and verification guidance; attestations do not guarantee secure source/artifacts.

## [E04] MCP security guidance
Source: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/2026-07-28/tutorials/security/security_best_practices.mdx

Official project guidance including audience validation, token passthrough and confused-deputy risk. Resolve and pin the supported protocol revision during implementation.
