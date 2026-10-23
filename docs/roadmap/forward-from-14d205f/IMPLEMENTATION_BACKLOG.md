# Digital Kingdom: forward implementation backlog


Reviewed baseline: `14d205fc295d0d8584f8c81d183193c4d75dc96d` on `main`. This is continuation work, not a rebuild. All items are proposed, not completed by this roadmap.


Phases are workstreams, not a serial calendar. Follow each item’s explicit dependencies; independent visual, operational and evaluation work can proceed in parallel. Existing files are edit anchors, while paths beginning `proposed` are intended additions to be confirmed at implementation time.


## R00 — Secure and reconcile the integrated baseline

Preserve main; close source-traced semantic gaps and update the delivery/acceptance record.


### R00.1 — Publish a current-main readiness receipt

**Current baseline:** integrated implementation; documentation partly historical. **Status:** proposed, not started by this roadmap.

**Purpose:** Replace outdated branch/pending-deployment statements with a separately dated receipt for the integrated candidate; preserve frozen historical receipts.

**Dependencies:** None beyond the reviewed baseline. **External gate:** local.

**Code anchors:** `docs/redesign/ACCEPTANCE.md`; `docs/redesign/IMPLEMENTATION.md`; `README.md`; `.github/workflows/ci.yml`; `.github/workflows/pages.yml`.

**Deliverables:**

1. Record HEAD, build, CI run and artifact IDs and the served-build check

2. Separate implemented, CI-verified, visually inspected, manually accepted and live-provider-verified states

3. Reconcile every earlier open task with current main; no blind replay of old rebuild prompts

**Acceptance checks:**

1. Record 376 tests/43 files and the exact-head browser results only where supported by this run

2. Preserve the hidden-tab skip and human/hardware gates

3. A future failed candidate cannot inherit a prior screenshot or pass label

**Blueprint capabilities:** DK-C01, DK-C22.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R00.2 — Enforce typed, namespaced event correlation

**Current baseline:** source-reviewed correctness risk; full regression reproduction pending. **Status:** proposed, not started by this roadmap.

**Purpose:** The reviewed authentication rule matches raw identifier strings across candidate successes; prevent unrelated sources, identifier kinds, or runs becoming a supported causal link.

**Dependencies:** R00.1. **External gate:** local.

**Code anchors:** `packages/detections/src/rules.ts`; `packages/detections/src/normalize.ts`; `packages/contracts/src/types.ts`; `packages/detections/test/`.

**Deliverables:**

1. Define a correlation identity with project, issuer/source namespace, identifier type and value

2. Audit authentication, authorization-change, request and agent-run joins

3. Make cross-source identity equivalence explicit and evidence-backed; preserve uncertainty for legacy records

**Acceptance checks:**

1. Two sources using actor_ref=admin do not link without an explicit common issuer

2. actor_ref X does not match session_ref X

3. Equal run_id strings from unrelated runtimes do not corroborate an effect

4. Legitimate shared-issuer flow and independent-observer positive controls still work

**Blueprint capabilities:** DK-C02, DK-C05, DK-C12.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R00.3 — Resolve routes without guessing one owner

**Current baseline:** current asset/route posture exists; prospective analysis absent. **Status:** proposed, not started by this roadmap.

**Purpose:** Current route context selects a highest-frequency asset from a bounded recent event window. Make ambiguity, method/host scope and missing route inventory explicit.

**Dependencies:** R00.1. **External gate:** local.

**Code anchors:** `apps/server/src/context.ts`; `packages/graph-core/`; `packages/contracts/schemas/agent/`; `apps/server/test/assessment-v2.test.ts`.

**Deliverables:**

1. Represent route identity using environment, service/host, HTTP method and normalized template

2. Return candidates/ambiguous resolution instead of silently choosing a dominant asset

3. Differentiate current-target posture from assessment of an actual proposed change

**Acceptance checks:**

1. Two services with /login cannot produce an unexplained single owner

2. An important route outside the latest event window remains discoverable from authoritative inventory

3. No matching route or unsupported change scope stays insufficient_context/not_assessed

**Blueprint capabilities:** DK-C02, DK-C13, DK-C15.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R00.4 — Tighten contracts and adversarial data-boundary tests

**Current baseline:** extensive hardening present; extend rather than replace. **Status:** proposed, not started by this roadmap.

**Purpose:** Close inexpensive format, resource-budget and permission-revocation gaps before connecting more independent sources.

**Dependencies:** R00.1. **External gate:** local.

**Code anchors:** `packages/contracts/test/agent-schemas.test.ts`; `packages/contracts/schemas/`; `apps/server/src/security.ts`; `apps/server/test/`; `apps/mcp/test/`.

**Deliverables:**

1. Validate date-time formats rather than ignoring the format warning observed in CI

2. Test query budgets, cursor scope after revocation, oversized results and hostile identifiers

3. Define quarantine versus transient infrastructure retry behavior and observable counters

**Acceptance checks:**

1. Invalid coverage_as_of fails schema validation

2. A revoked token cannot resume a previously authorized cursor

3. Malformed evidence cannot monopolize worker progress or inject UI/agent instructions

4. Schema failures never expose raw credentials in logs or error bodies

**Blueprint capabilities:** DK-C02, DK-C22.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R00.5 — Close the remaining design release gates honestly

**Current baseline:** automated coverage exists; manual gates open. **Status:** proposed, not started by this roadmap.

**Purpose:** Use the existing polished UI and screenshots as the starting point for real-device and human checks, not another redesign.

**Dependencies:** R00.1. **External gate:** human_and_physical_device.

**Code anchors:** `docs/redesign/acceptance-results.json`; `docs/redesign/work-packages.json`; `e2e/`; `apps/web/src/`.

**Deliverables:**

1. Create a current candidate manual-review packet with task-specific evidence

2. Exercise keyboard/screen-reader, actual zoom/forced colors and physical GPU performance

3. Record architecture/composition/dense-label usability review and genuine hidden-tab behavior

**Acceptance checks:**

1. Human reviewer IDs and actual device/browser conditions accompany pass claims

2. No automated screenshot or agent critique is relabeled human approval

3. Unavailable manual tests remain blocked without preventing independent implementation

**Blueprint capabilities:** DK-C06, DK-C22.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


## R01 — Make evidence reproducible across time and concurrent work

Provide version-pinned evidence, historical source capabilities, explicit coverage intervals and safe mutations.


### R01.1 — Version domain assertions and entity lifetimes

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** A stored graph revision is not yet a complete historical knowledge model. Keep provider identity, valid time and observation time separately.

**Dependencies:** R00.2, R00.3. **External gate:** local.

**Code anchors:** `packages/contracts/`; `packages/graph-core/`; `apps/server/src/db.ts`; `apps/server/src/store.ts`.

**Deliverables:**

1. Add stable entity references, scoped provider IDs and typed assertions

2. Store valid_from/valid_to and observed_at/recorded_at plus evidence provenance

3. Keep conflicting configuration assertions and explicit reconciliation decisions

4. Add versioned migrations and legacy unknown provenance

**Acceptance checks:**

1. Late configuration discovery changes what is known without rewriting what was known earlier

2. A deleted/recreated resource with the same name is not silently the same identity

3. Graph history and current view agree for equivalent temporal inputs

**Blueprint capabilities:** DK-C02, DK-C05.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R01.2 — Persist source capability and coverage history

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Replace event-count freshness as the sole proxy with interval-specific observability for the question being investigated.

**Dependencies:** R01.1. **External gate:** local.

**Code anchors:** `packages/detections/src/rules.ts`; `apps/server/src/db.ts`; `apps/server/src/store.ts`; `apps/web/src/workspaces/coverage/`.

**Deliverables:**

1. Store source configuration revisions, enable/disable transitions, permissions, event classes, sampling, loss and retention

2. Separate heartbeat receipt, business-event time, collection completeness and observer capability

3. Return historical interval coverage and explicit unknown spans

**Acceptance checks:**

1. Healthy request logs do not imply database-read visibility

2. Current sensor restoration does not backfill an outage

3. A heartbeat is evaluated by receipt/liveness rather than an unrelated future event timestamp

4. A bounded evaluation window cannot silently erase a quiet source history

**Blueprint capabilities:** DK-C04, DK-C22.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R01.3 — Serve revision-pinned evidence bundles

**Current baseline:** exact reference pagination exists; arbitrary revision pinning missing. **Status:** proposed, not started by this roadmap.

**Purpose:** Current UI detects some drift, but the backend cannot serve arbitrary immutable evidence revisions. Make historical investigation reproducible.

**Dependencies:** R01.1, R01.2. **External gate:** local.

**Code anchors:** `apps/server/src/store.ts`; `apps/server/src/export.ts`; `apps/server/src/app.ts`; `apps/web/src/lib/investigation.ts`; `apps/mcp/src/server.ts`.

**Deliverables:**

1. Add immutable bundle IDs tying finding revision, event references, graph/source revisions and scope

2. Use paginated exact-reference retrieval with explicit retention/deletion failures

3. Document snapshot TTL, retained case pins and authorization rechecks

**Acceptance checks:**

1. Concurrent new evidence cannot silently change an already pinned comparison

2. A historical bundle reopens with the same included record versions

3. Expired or deleted evidence produces missing/expired metadata, not an empty complete answer

4. UI, MCP and export report the same bundle digest and limits

**Blueprint capabilities:** DK-C10, DK-C11.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R01.4 — Add optimistic concurrency and annotation history

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Prevent stale analysts or agents from overwriting dispositions, source settings, scene proposals or case decisions.

**Dependencies:** R01.1. **External gate:** local.

**Code anchors:** `apps/server/src/app.ts`; `apps/server/src/store.ts`; `apps/web/src/inspector/`; `packages/contracts/`.

**Deliverables:**

1. Require expected revision/ETag for mutable user state

2. Persist actor, before/after and decision timestamps

3. Offer conflict comparison rather than silent last-writer-wins

**Acceptance checks:**

1. Two concurrent edits from the same base cannot both silently win

2. Historical replay labels current notes or retrieves historical notes explicitly

3. Expired approvals and changed policy snapshots require renewed review

**Blueprint capabilities:** DK-C11, DK-C19, DK-C22.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R01.5 — Bound query work and prove snapshot semantics

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** A 31-day window is not a row or CPU budget. Add measured indexes, isolation and explicit incompleteness under retention.

**Dependencies:** R01.1, R01.3. **External gate:** local.

**Code anchors:** `apps/server/src/investigate.ts`; `apps/server/src/db.ts`; `apps/server/src/store.ts`; `apps/mcp/src/server.ts`.

**Deliverables:**

1. Measure representative 10k/100k/1m-event workloads on recorded hardware

2. Add selected source/time/identity/route indexes based on query plans

3. Define request cancellation, response-byte budgets and concurrent-search limits

4. Ensure retention cannot silently mutate an advertised frozen search

**Acceptance checks:**

1. Late arrivals, tied timestamps and concurrent retention cannot skip or duplicate results without a stated expiration

2. Large searches cannot block ingestion indefinitely

3. Results include scanned scope, truncation, errors and current/historical coverage distinction

**Blueprint capabilities:** DK-C10, DK-C23.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


## R02 — Connect a real application with a complete supported pack

Turn manual setup into a least-privilege, diagnosable path from inventory to a useful recorded finding.


### R02.1 — Define versioned connector and support-pack contracts

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Turn adapter claims into inspectable support levels, permissions and repeatable conformance tests.

**Dependencies:** R00.4, R01.1. **External gate:** local.

**Code anchors:** `apps/server/src/adapters/`; `packages/contracts/`; `apps/web/src/workspaces/integrations/`; `proposed packages/connectors/`.

**Deliverables:**

1. Manifest for provider/API version, read scopes, pagination, cursor, rate limits, cost and data handling

2. Capability levels: declared, discovered, instrumented, analyzed, lab-verified, live-verified

3. Sandbox the connector and keep collector authority separate from response authority

**Acceptance checks:**

1. Permission denial, throttling, partial pagination, replay and revoked scopes produce honest coverage

2. Installing a connector never defaults to global administrator access

3. Only the supported protocol/versions appear enabled in UI

**Blueprint capabilities:** DK-C03, DK-C22, DK-C24.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R02.2 — Deliver a one-command local application pack

**Current baseline:** SDK/reference app exists; coherent onboarding pack incomplete. **Status:** proposed, not started by this roadmap.

**Purpose:** Make a new user reach a genuine controlled investigation without manually assembling every resource and source.

**Dependencies:** R02.1. **External gate:** local.

**Code anchors:** `examples/reference-app/`; `packages/sdk-node/`; `infra/compose/`; `apps/web/src/workspaces/integrations/`.

**Deliverables:**

1. Package app, auth outcome emitter, database audit fixture, agent runtime fixture and effect observer

2. Guided authorize/preview/import/validate/first-event workflow

3. Real OpenTelemetry Collector binary conformance test, plus removal/reset instructions

**Acceptance checks:**

1. Fresh checkout produces a real SDK event on the correct asset and identical UI/MCP evidence

2. Deliberate source outage becomes a visible gap

3. Supported Collector retry/restart/decompressed-size behavior is tested

4. Static demo remains distinctly synthetic and offline

**Blueprint capabilities:** DK-C03, DK-C18.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R02.3 — Add repository and deployment discovery

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Connect one authorized repository to workflows and declared runtime inventory without executing untrusted repository code.

**Dependencies:** R02.1, R02.2. **External gate:** local.

**Code anchors:** `packages/graph-core/`; `proposed packages/connectors/github/`; `apps/web/src/workspaces/integrations/`.

**Deliverables:**

1. Read-only GitHub metadata, workflow and manifest importer

2. Owner-confirmed inventory preview and stable reconciliation

3. Track commit/workflow/artifact/deployment metadata with explicit unsupported fields

**Acceptance checks:**

1. Hostile workflow text and repository hooks are never executed

2. Renames/redeploys preserve supported stable IDs

3. Rate limits and inaccessible repositories appear as partial discovery

4. Import preview reports additions, removals and uncertainty before applying

**Blueprint capabilities:** DK-C03, DK-C07.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R02.4 — Deliver the first real cloud identity/audit pack

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Use one tightly supported cloud scope as the first operational integration rather than launching many shallow connectors.

**Dependencies:** R02.1, R01.2, R01.5. **External gate:** authorized_provider_access.

**Code anchors:** `proposed packages/connectors/aws/`; `apps/server/src/adapters/`; `packages/graph-core/`; `apps/web/src/workspaces/integrations/`.

**Deliverables:**

1. Recommended reference scope: one AWS account with read-only IAM/resource metadata and authorized CloudTrail exports/collection

2. Separate management and configured data-event capabilities

3. Track regions, missing permissions, supported resources and collection intervals

4. Support offline sanitized exports for development and fixture testing

**Acceptance checks:**

1. A known key use and grant change are linked through provider IDs with raw source references

2. Missing data events never produce a no-read conclusion

3. Cross-account visibility stops at the authorization boundary

4. A real-account check is marked separately from fixture conformance

**Blueprint capabilities:** DK-C03, DK-C04, DK-C05.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


## R03 — Complete investigations and credential aftermath

Persist cases, retrieve unlinked activity, test hypotheses and identify remaining authority.


### R03.1 — Persist cases separately from findings

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** The UI has investigations, but durable cases need their own identity, questions, ownership and pinned evidence.

**Dependencies:** R01.3, R01.4. **External gate:** local.

**Code anchors:** `apps/server/src/db.ts`; `apps/server/src/app.ts`; `apps/web/src/workspaces/investigate/`; `apps/mcp/src/server.ts`.

**Deliverables:**

1. Case, scope, owner, questions, timeline, linked findings and independent events

2. Immutable evidence bundles, revisions, notes and closure criteria

3. Role-gated collaboration and export that states limits

**Acceptance checks:**

1. A case may contain an event that produced no finding

2. A closed detector finding does not silently close an unresolved case

3. Concurrent edits and scope changes retain history

4. Case export reopens with matching references and explicit unavailable records

**Blueprint capabilities:** DK-C11.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R03.2 — Add hypotheses and deterministic investigation recipes

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Help a person or agent distinguish explanations instead of receiving only a persuasive alert narrative.

**Dependencies:** R03.1, R01.2, R01.5. **External gate:** local.

**Code anchors:** `proposed packages/investigation/`; `apps/web/src/workspaces/investigate/`; `apps/mcp/src/server.ts`.

**Deliverables:**

1. Versioned recipes with required evidence, alternate explanations, next queries and stop conditions

2. Supporting/counterevidence and unresolved questions per hypothesis

3. Coverage-aware query recommendations with bounded budgets

**Acceptance checks:**

1. Shared-IP attribution bait remains separate

2. A benign maintenance case can be resolved without changing facts

3. Missing observer capability stops an unjustified conclusion

4. Recipes query unlinked follow-on events rather than only finding references

**Blueprint capabilities:** DK-C10, DK-C11, DK-C13.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R03.3 — Build credential aftermath and residual-access investigation

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Make original-key rotation insufficient to close a case when recorded descendant access survives.

**Dependencies:** R02.4, R03.2. **External gate:** local.

**Code anchors:** `proposed packages/identity/`; `proposed packages/investigation/credential-aftermath/`; `apps/web/src/workspaces/investigate/`.

**Deliverables:**

1. Credential metadata and issuance/usage/grant lineage; never require the exposed secret

2. Investigate newly created keys, role trust changes, grants and sessions within supported provider scope

3. Recheck current authority with provider-specific session limitations

**Acceptance checks:**

1. Original key inactive plus descendant grant active remains unresolved

2. Legitimate key rotation is not automatically malicious

3. A missing account or audit interval stays unknown

4. A synthetic residual-access case identifies the actionable surviving permission

**Blueprint capabilities:** DK-C16.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R03.4 — Integrate registered deception assets safely

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Connect planted decoys to placement history and exact trigger evidence without claiming human identification.

**Dependencies:** R03.1, R03.3. **External gate:** local.

**Code anchors:** `proposed packages/connectors/deception/`; `packages/detections/src/rules.ts`; `apps/web/src/workspaces/investigate/`.

**Deliverables:**

1. Decoy registry, unique placement IDs, propagation, authorized tests and retirement

2. One existing provider adapter plus local controlled receiver

3. Clear distinction among request, document fetch, credential use and scanner validation

**Acceptance checks:**

1. Trigger maps to registered placement but not necessarily original compromise

2. DNS resolver/proxy IP is not treated as attacker identity

3. Authorized scanner/test activation is retained and annotated, not silently deleted

4. No decoy contains a working production secret

**Blueprint capabilities:** DK-C17.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R03.5 — Add reliable external attention delivery

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** An operational console must notify the right owner when they are not watching the castle.

**Dependencies:** R03.1, R02.1. **External gate:** authorized_notification_destination.

**Code anchors:** `proposed apps/server/src/notifications/`; `apps/server/src/db.ts`; `apps/web/src/workspaces/integrations/`.

**Deliverables:**

1. Durable notification outbox, owner routing, deduplication, escalation and quiet-window controls

2. Minimal redacted summaries with authenticated case deep links

3. Delivery receipts, retries and test notifications

**Acceptance checks:**

1. Restart does not lose acknowledged notifications or spam duplicate messages

2. Notification failures are visible inside Digital Kingdom

3. Shared external channel does not receive unauthorized project evidence

4. No alert-volume metric substitutes for useful investigation outcome

**Blueprint capabilities:** DK-C11, DK-C22.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


## R04 — Prevent dangerous changes through lineage and effective authority

Connect code and artifacts to running software, applicable weaknesses and prospective security changes.


### R04.1 — Establish source-to-running-artifact lineage

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** A pipeline building a safe commit is not proof that its artifact is the one running in the exposed service.

**Dependencies:** R02.3, R02.4, R01.1. **External gate:** local.

**Code anchors:** `proposed packages/lineage/`; `packages/contracts/`; `proposed packages/connectors/github/`; `apps/web/src/workspaces/kingdom/`.

**Deliverables:**

1. Repository→commit→workflow→builder→digest→registry→deployment→runtime links

2. Digest and expected signer/issuer validation; provenance policy

3. Explicit undeclared/unsigned/unverified/verified states and drift

**Acceptance checks:**

1. Mutable image tag resolving to a different digest is detected

2. Valid provenance from an unexpected issuer does not satisfy policy

3. Matching provenance is not labeled malware-free

4. The deployed fix is checked at runtime digest/version, not just merged PR

**Blueprint capabilities:** DK-C07.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R04.2 — Add contextual vulnerability applicability

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Rank affected deployed components by explicit exposure and authority, not a CVSS-only alarm list.

**Dependencies:** R04.1. **External gate:** external_feed_access.

**Code anchors:** `proposed packages/vulnerabilities/`; `proposed packages/connectors/threat-intel/`; `packages/contracts/`.

**Deliverables:**

1. SBOM/package identity and OSV matching; cached feed versions

2. KEV and EPSS as separate global context; reviewed VEX provenance

3. Applicability, reachability, observed exploitation and verified remediation kept distinct

**Acceptance checks:**

1. A dependency in source but not the running artifact is not reported as confirmed runtime exposure

2. Backports, missing version and stale feeds produce qualified results

3. A KEV match does not label this installation compromised

4. Each priority explanation cites specific affected resources and assumptions

**Blueprint capabilities:** DK-C09.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R04.3 — Compute conditional effective-access paths

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Add policy semantics and prerequisites to graph paths; a visual connection is not proof of exploitable access.

**Dependencies:** R02.4, R01.1, R01.2. **External gate:** local.

**Code anchors:** `proposed packages/identity/`; `proposed packages/exposure/`; `packages/graph-core/`; `apps/web/src/castle/`.

**Deliverables:**

1. Scoped policy evaluator for one provider/action family with documented limits

2. Account for explicit denies, resource/identity policies, boundaries, sessions and relevant organization policies

3. Return feasible/conditional/blocked/unresolved paths with evidence

**Acceptance checks:**

1. An allow statement overridden by a known deny is not presented as effective access

2. Missing policy input makes the result unresolved

3. Cross-account cases use the applicable trust and resource sides

4. Configured permission is never mislabeled observed data access

**Blueprint capabilities:** DK-C05, DK-C08.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R04.4 — Replace target-only posture with a real security change diff

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** A deployment may introduce authority even when no current finding exists. Review the proposed before/after change.

**Dependencies:** R04.1, R04.2, R04.3, R03.1. **External gate:** local.

**Code anchors:** `apps/server/src/context.ts`; `proposed packages/change-review/`; `apps/mcp/src/server.ts`; `apps/web/src/workspaces/investigate/`.

**Deliverables:**

1. Versioned ChangePlan tied to base/candidate commits, artifacts and configuration

2. Detect new ingress, broader grants, changed tools/model routes and lost telemetry

3. Suggested negative/positive tests, owner review and post-deploy check

**Acceptance checks:**

1. A new broad permission with zero existing findings is surfaced

2. Unknown scope cannot be favorable

3. Changing the candidate after review invalidates the old assessment

4. Post-deploy observed state must match the reviewed change

**Blueprint capabilities:** DK-C15.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


## R05 — Observe agents and serve bounded security context

Join intent, policy decisions, actual execution and independently observed effects; keep MCP scoped.


### R05.1 — Define agent intent/decision/execution/effect contracts

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Extend generic tool events into an attributable, scoped agent run model without collecting hidden reasoning or raw secrets.

**Dependencies:** R00.2, R01.1, R01.2. **External gate:** local.

**Code anchors:** `packages/contracts/`; `proposed packages/agent-observability/`; `packages/sdk-node/`.

**Deliverables:**

1. Run identity, initiating principal, runtime/model route, tool version and policy revision

2. Separate refusal, enforcement denial, attempted execution and observed effect

3. Declared observation origins and independent evidence correlation

**Acceptance checks:**

1. Runtime self-report cannot masquerade as independent corroboration

2. Identical run IDs from unrelated runtimes do not join

3. Legacy generic tool events remain valid but qualified

4. Private prompts/payloads are minimized before persistence

**Blueprint capabilities:** DK-C12.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R05.2 — Instrument one real agent workflow and independent observer

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Prove one supported agent boundary end to end instead of listing every AI framework as supported.

**Dependencies:** R05.1, R02.2. **External gate:** local.

**Code anchors:** `proposed examples/agent-reference/`; `proposed packages/connectors/agent-runtime/`; `proposed packages/observers/`.

**Deliverables:**

1. One adapter for a chosen open runtime/tool gateway

2. Separate controlled destination or file observer outside agent write authority

3. Document unobserved execution paths and permission assumptions

**Acceptance checks:**

1. Prohibited synthetic egress never reaches the controlled receiver when enforcement succeeds

2. Permitted work still completes

3. Wrapper-bypass scenario exposes the observation gap without attributing an unlinked process

4. Monitoring cannot be disabled by the monitored agent identity

**Blueprint capabilities:** DK-C12, DK-C18.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R05.3 — Extend MCP with bounded cases and subscriptions

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Keep one shared evidence model while adding case context and client-aware incremental delivery.

**Dependencies:** R03.1, R05.1, R10.1. **External gate:** local.

**Code anchors:** `apps/mcp/src/`; `apps/server/src/app.ts`; `packages/contracts/schemas/agent/`.

**Deliverables:**

1. Versioned case, bundle, capability and change-context tools

2. Supported resource/update capabilities with incremental polling fallback

3. Optional remote transport only with authenticated, audience-bound and scoped access

4. Output/token budgets and expiry/revocation handling

**Acceptance checks:**

1. Stdio and any supported remote mode agree on scope and evidence IDs

2. Read-only annotations are not used as authorization

3. No downstream token passthrough or unrestricted URL fetching

4. Model/client disconnection does not stop monitoring or lose case changes

**Blueprint capabilities:** DK-C13.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R05.4 — Add optional bounded investigation assistance

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Model assistance should summarize and choose evidence queries, not invent facts or become the final authority.

**Dependencies:** R03.2, R05.3, R11.1. **External gate:** model_provider_and_budget_approval.

**Code anchors:** `proposed packages/assistant/`; `apps/mcp/`; `apps/web/src/workspaces/investigate/`; `eval/`.

**Deliverables:**

1. Authorized case projection, query budget, evidence-reference outputs and model/prompt provenance

2. Draft claims, uncertainty, counterevidence and suggested next questions

3. No model dependency in collection, detection, query, scene fallback or authorization

**Acceptance checks:**

1. Injected instructions in logs do not grant tools, approvals or scope

2. Claims without retrieved support are marked unsupported

3. Provider outage leaves deterministic product usable

4. Observe recommendation effects in matched evaluations, not only blocked writes

**Blueprint capabilities:** DK-C13.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


## R06 — Expand the castle into a faithful operational world

Extend the current architectural kit with real surface semantics, meaningful layers and stable navigation.


### R06.1 — Add a semantic world hierarchy without remapping history

**Current baseline:** current grouped districts and module kit implemented. **Status:** proposed, not started by this roadmap.

**Purpose:** Preserve the current ten-module campus while supporting realm/environment/district/structure/interior navigation.

**Dependencies:** R01.1, R02.1. **External gate:** local.

**Code anchors:** `packages/contracts/src/catalog.ts`; `packages/scene-compiler/`; `apps/web/src/castle/scenePresentation.ts`; `apps/web/src/graph2d/`.

**Deliverables:**

1. Stable grouping identities and explicit environment/account boundaries

2. Persistent layout versions, approved reflow and tombstoned historical assets

3. Semantic zoom, group membership and equivalent searchable lists

**Acceptance checks:**

1. Adding a resource does not rearrange unrelated districts

2. A group is presentation-only, not an invented incident

3. Selection survives 3D/2D switching and historical lookup

4. Legacy stored scenes preserve supported positions and report new footprint collisions

**Blueprint capabilities:** DK-C06.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R06.2 — Extend all 28 surface mappings with capability-aware architecture

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Turn the surrounding world into a readable model while exposing the actual level of integration for each surface.

**Dependencies:** R06.1, R02.1. **External gate:** local.

**Code anchors:** `packages/contracts/`; `assets/castle-kit/MANIFEST.json`; `apps/web/src/castle/architecture.ts`; `proposed surface-registry/`.

**Deliverables:**

1. Versioned surface descriptors and mappings from operational entities to presentation modules

2. Introduce DNS registry, dispatch house, key registry, supply depot, archive and outpost families when supported by data

3. Separate decoration, organizational boundaries and tested enforcement controls

**Acceptance checks:**

1. A drawn watchtower cannot imply a connected sensor

2. Generic historical events keep their old meaning under a richer surface model

3. Every selectable operational structure resolves to a permitted entity

4. All surface support levels are visible and machine-readable

**Blueprint capabilities:** DK-C06, DK-C24.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R06.3 — Add meaningful security layers and interior views

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Allow the castle to explain why a relationship matters rather than display every edge at once.

**Dependencies:** R06.2, R04.3, R04.1, R05.1. **External gate:** local.

**Code anchors:** `apps/web/src/castle/`; `apps/web/src/inspector/`; `apps/web/src/graph2d/`; `packages/scene-compiler/`.

**Deliverables:**

1. Switch infrastructure, identity, data, delivery, agent-capability and coverage layers

2. Service interiors expose route/method, deployment, instances, permissions and tool capabilities

3. Evidence and proposed-change focus modes with explicit user camera control

**Acceptance checks:**

1. Permissions remain distinguishable from observed activity

2. Hypothetical movement cannot look like recorded intrusion

3. Current coverage is not shown as historical truth

4. Equivalent evidence and actions remain usable in lists/2D/reduced motion

**Blueprint capabilities:** DK-C06, DK-C08, DK-C12.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R06.4 — Polish composition with measured usability and performance

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Improve the now-working castle instead of rebuilding its shell; prioritize legibility and scene scale over cinematic clutter.

**Dependencies:** R06.1, R00.5. **External gate:** human_and_physical_device.

**Code anchors:** `apps/web/src/castle/Environment.tsx`; `apps/web/src/castle/labels.tsx`; `apps/web/src/castle/architecture.ts`; `e2e/redesign/`.

**Deliverables:**

1. Intentional district approach lines, meaningful connector endpoints and focused label hierarchy

2. Optional control-backed boundary structures only where records support their meaning

3. Physical-device quality profiles, label collision review and stable memory behavior

4. Human comparison of castle, graph and table tasks with equal evidence

**Acceptance checks:**

1. A user can identify selected resource, supported relationship and evidence in each representation

2. Large-world labels and camera preserve orientation

3. Quality reduction removes decoration before evidence

4. Actual hardware measurements and named review scope accompany claims

**Blueprint capabilities:** DK-C06, DK-C23.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


## R07 — Prove selected defenses in a controlled laboratory

Distinguish configured controls from controls tested successfully under specified conditions.


### R07.1 — Create control inventory and verification records

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Make shields and checkpoints represent an actual control with scope, policy and validation history.

**Dependencies:** R01.2, R04.3. **External gate:** local.

**Code anchors:** `proposed packages/controls/`; `packages/contracts/`; `apps/server/src/db.ts`; `apps/web/src/workspaces/coverage/`.

**Deliverables:**

1. Declared/configured/tested/stale/failed/unknown control states

2. Policy version, supported scope, evidence and test expiration/invalidation

3. Avoid calling a configured control effective without behavioral evidence

**Acceptance checks:**

1. Relevant config change invalidates the old test claim

2. An unavailable observer yields inconclusive, not a pass

3. Positive and negative test results retain their conditions

4. Every control marker opens a defensible record

**Blueprint capabilities:** DK-C14.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R07.2 — Implement an isolated defense-lab runner

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Run reproducible authorized tests with independent observations, cleanup and protected production boundaries.

**Dependencies:** R07.1, R05.2, R10.1. **External gate:** local.

**Code anchors:** `proposed apps/lab/`; `examples/`; `proposed packages/controls/`; `infra/`.

**Deliverables:**

1. Synthetic fixtures, owned sandbox targets, action allowlists and environment assertions

2. Resource/time/request budgets, abort handling and cleanup receipts

3. Separate effect observer and permitted-operation positive control

**Acceptance checks:**

1. Test cannot target an unapproved environment or arbitrary external address

2. A prohibited action is blocked while legitimate work still functions

3. Failed cleanup and partial outcomes stay visible

4. No availability failure is mistaken for successful security enforcement

**Blueprint capabilities:** DK-C18.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R07.3 — Complete the 16 scenario packs

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Turn the blueprint scenarios into complete inventory→evidence→case→verification demonstrations, including benign alternatives.

**Dependencies:** R07.2, R03.3, R04.1. **External gate:** local.

**Code anchors:** `proposed scenarios/`; `proposed apps/lab/`; `eval/`; `apps/web/src/workspaces/investigate/`.

**Deliverables:**

1. Implement DK-T01–DK-T16 as versioned scenario manifests

2. Include shared-IP bait, absent database audit, unlinked reads, origin bypass, artifact mismatch, control no-op and backup restore failure

3. Mark executor-dependent scenarios unavailable until executor gates pass

**Acceptance checks:**

1. Each scenario has explicit expected observations, disallowed claims and missing-evidence variants

2. UI/MCP and independent observer agree on record identity

3. Scenarios are not a claim of universal attack coverage

4. A scenario can fail without the runner hiding its result

**Blueprint capabilities:** DK-C18.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R07.4 — Convert resolved cases into sanitized regression proposals

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Close the learning loop without leaking private incidents or treating generated tests as validated defenses.

**Dependencies:** R07.3, R03.2. **External gate:** local.

**Code anchors:** `proposed packages/controls/`; `proposed packages/investigation/`; `proposed scenarios/`.

**Deliverables:**

1. User-reviewed transformation from case lesson to minimized synthetic fixture

2. Sensitive-data checks, provenance and versioned expected outcome

3. PR-ready regression proposal with no automatic public publication

**Acceptance checks:**

1. Private identifiers and secrets are absent from generated fixtures

2. The proposed regression fails the broken condition and passes the corrected one

3. An agent cannot self-approve publication

4. A new rule preserves benign counterexamples

**Blueprint capabilities:** DK-C18, DK-C24.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


**Staged execution:** Non-response scenarios run against their actual supported capabilities. Response-dependent cases remain explicitly blocked until R08.3/R08.4 exist and are authorized. They must be rerun in the final integrated candidate, not mocked into a pass to unblock executor development.

## R08 — Authorize, execute and verify bounded response

Keep response independent from the reasoning agent and prove effects in explicitly authorized environments.


### R08.1 — Bind response authorization to real subjects and policy

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Move beyond distinct human-typed tokens before enabling execution.

**Dependencies:** R10.1, R03.1, R07.1. **External gate:** local.

**Code anchors:** `apps/server/src/security.ts`; `apps/server/src/containment.ts`; `apps/server/src/store.ts`; `proposed apps/response-controller/`.

**Deliverables:**

1. Identity-provider subjects, service identities, roles, resource scope and separation of duties

2. Policy-required approvals tied to exact plan digest and expiry

3. Independent break-glass path and protected monitoring authority

**Acceptance checks:**

1. Two tokens for the same person do not satisfy a two-person requirement

2. Agent cannot approve itself, edit approval policy or disable its verifier

3. Revocation or policy change invalidates stale authority

4. Audit identifies the actual authenticated subject

**Blueprint capabilities:** DK-C19.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R08.2 — Define exact response plans and revalidation

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Make the plan a bounded executable contract, not an ambiguous action name and rationale.

**Dependencies:** R08.1, R01.3, R01.4. **External gate:** local.

**Code anchors:** `apps/server/src/containment.ts`; `packages/contracts/`; `proposed apps/response-controller/`.

**Deliverables:**

1. Exact targets, parameters, state fingerprint, evidence bundle, policy revision, TTL and blast radius

2. Rollback or compensation and explicit irreversibility

3. Recheck preconditions immediately before execution and after material drift

**Acceptance checks:**

1. Changed target, parameters or artifact digest cannot reuse approval

2. A key revocation is not falsely labeled reversible

3. Missing effect-observer capability blocks verified-success claims

4. Unsupported action never falls back to arbitrary shell

**Blueprint capabilities:** DK-C19.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R08.3 — Build a separate laboratory-only executor first

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Introduce meaningful response without putting broad provider authority in the investigation agent.

**Dependencies:** R08.2, R07.2, R10.2. **External gate:** explicit_lab_execution_authorization.

**Code anchors:** `proposed apps/response-controller/`; `proposed packages/response-adapters/`; `infra/`.

**Deliverables:**

1. Typed provider API adapters, separate scoped credentials and action journal

2. Idempotency, crash reconciliation, bounded retry, lease/expiry and manual stop

3. Initially one explicitly owned non-production environment

**Acceptance checks:**

1. Crash after provider success is reconciled before retry

2. Repeated delivery does not apply the action twice

3. Timeout is not interpreted as confirmed failure or success

4. Production credentials/targets are rejected unless separately configured and authorized

**Blueprint capabilities:** DK-C20.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R08.4 — Verify containment and service recovery independently

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** An accepted provider call does not close the case; verify effects and surviving authority.

**Dependencies:** R08.3, R03.3, R07.1. **External gate:** local.

**Code anchors:** `proposed packages/verification/`; `proposed apps/response-controller/`; `apps/web/src/workspaces/investigate/`.

**Deliverables:**

1. State, behavior, permitted-control, residual-access and observability checks

2. Pending/verified/failed/inconclusive/compensated states with propagation windows

3. Separate containment, service restoration and historical exposure conclusions

**Acceptance checks:**

1. Provider accepts a no-op yet observer sees access: case remains unresolved

2. Original credential is disabled but descendant access survives: verification fails

3. Legitimate service disruption is detected

4. All claims name their tested scope and unassessed paths

**Blueprint capabilities:** DK-C21.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


## R09 — Broaden coverage through tested surface packs

Expand beyond the first stack without disguising unsupported sensors or provider-specific limitations.


### R09.1 — Add edge, DNS, browser, API and webhook packs

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Expand public-facing coverage through authoritative inventories and authorized tests, not unrestricted external scanning.

**Dependencies:** R02.1, R01.2, R04.1. **External gate:** authorized_provider_access.

**Code anchors:** `proposed packages/connectors/edge/`; `proposed packages/connectors/api/`; `packages/graph-core/`; `apps/web/src/workspaces/integrations/`.

**Deliverables:**

1. DNS/certificate and declared-origin inventory; optional Cloudflare/WAF feed with version/plan support

2. OpenAPI routes, browser dependency metadata and webhook authorization/replay configuration

3. Separate discovered leads from verified ownership and instrumented paths

**Acceptance checks:**

1. A certificate hostname is not assumed owned

2. Alternate origin validation only runs against authorized targets

3. A route is scoped by method/service/environment

4. Frontend and webhook observations disclose blind spots

**Blueprint capabilities:** DK-C03, DK-C08.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R09.2 — Add workload, serverless, queue and runtime packs

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Represent dynamic compute and asynchronous delivery without one permanent building per transient instance.

**Dependencies:** R02.1, R01.1, R06.1. **External gate:** authorized_provider_access.

**Code anchors:** `proposed packages/connectors/kubernetes/`; `proposed packages/connectors/runtime/`; `packages/contracts/`; `apps/web/src/castle/`.

**Deliverables:**

1. Logical workload, pod/process/function lifecycle and queue/topic producers/consumers

2. Falco/Hubble or equivalent supported feed adapters with precise semantics

3. Message correlation and provider identity scopes; replica-level drilldown

**Acceptance checks:**

1. Pod/process-ID reuse does not join different lifetimes

2. Queue adjacency alone does not prove message lineage

3. Missing node coverage is surfaced

4. Scale-up does not rearrange all logical service locations

**Blueprint capabilities:** DK-C03, DK-C05, DK-C06.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R09.3 — Add data, RAG, secrets and backup packs

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Make sensitive information boundaries and recovery capability inspectable without ingesting the sensitive content by default.

**Dependencies:** R02.1, R01.2, R07.2. **External gate:** authorized_provider_access.

**Code anchors:** `proposed packages/connectors/data/`; `proposed packages/connectors/rag/`; `proposed packages/connectors/backup/`; `proposed packages/controls/`.

**Deliverables:**

1. One database audit adapter, object-storage events and resource-level access metadata

2. RAG document origin, tenant permissions, retrieval and memory mutation lineage

3. Secret/signing metadata and backup/restore-test evidence

**Acceptance checks:**

1. Database audit absent is not no reads

2. Cross-tenant synthetic retrieval is denied while own-tenant retrieval works

3. Backup configuration success plus failed restore remains failed recovery

4. No raw document, secret or customer row is required for baseline inventory

**Blueprint capabilities:** DK-C03, DK-C14, DK-C18.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R09.4 — Add SaaS, endpoint and correspondence packs

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Extend the external world only where the provider grants sufficient authoritative data.

**Dependencies:** R02.1, R01.1, R03.1. **External gate:** authorized_provider_access.

**Code anchors:** `proposed packages/connectors/saas/`; `proposed packages/connectors/endpoint/`; `proposed packages/connectors/collaboration/`.

**Deliverables:**

1. One identity-provider/SaaS grant integration, endpoint feed and mail/collaboration security feed at a time

2. Delegated scope, forwarding/config changes and developer-device relationships

3. No invented visibility into provider interiors or employee behavior

**Acceptance checks:**

1. Shared service account does not establish a particular human actor

2. Provider permissions/licensing limitations are visible

3. Changing delegated grant is separated from actual data access

4. Feed installation/removal has tested coverage effects

**Blueprint capabilities:** DK-C03, DK-C05.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


## R10 — Operate securely and scale from measured demand

Add deployment security, recovery, query isolation and optional team-scale operation without breaking the local product.


### R10.1 — Strengthen deployment identity and secret handling

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Prepare for real team use before remote agent access or response execution.

**Dependencies:** R00.4. **External gate:** identity_provider_for_live_verification.

**Code anchors:** `apps/server/src/security.ts`; `apps/server/src/store.ts`; `infra/compose/`; `Dockerfile`; `SECURITY.md`.

**Deliverables:**

1. OIDC/SSO subjects, scoped service credentials, expiry/rotation and least-privilege token issuance

2. TLS deployment, trusted proxy policy, secret storage and sensitive export authorization

3. Demo disabled by default for real telemetry deployments; auditable login/logout and scope changes

**Acceptance checks:**

1. Tenant/project and field-level access survives token rotation and session revocation

2. No secret persists in browser local storage, logs, trace artifacts or screenshots

3. Cross-origin/CSRF and proxy boundary tests pass

4. A user can recover access without granting the monitored agent emergency authority

**Blueprint capabilities:** DK-C22.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R10.2 — Measure ingestion resilience and recovery

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** A trustworthy product must state what it can recover under failure and what it cannot.

**Dependencies:** R01.5, R10.1. **External gate:** local.

**Code anchors:** `apps/server/src/worker.ts`; `apps/server/src/store.ts`; `packages/sdk-node/`; `infra/`; `docs/UPGRADING.md`.

**Deliverables:**

1. Load/soak/fault harness, per-source budgets, bounded backpressure and visible loss accounting

2. Supported encrypted backup, restore and upgrade procedure

3. RPO/RTO and queue/disk assumptions documented from tests

**Acceptance checks:**

1. Disk full, duplicate replay, process crash and revoked source do not corrupt checkpoints

2. Backup restoration preserves references and required integrity checks

3. A noisy source cannot indefinitely starve others

4. No undocumented deletion is introduced to meet a benchmark

**Blueprint capabilities:** DK-C22.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R10.3 — Add team-scale storage only after workload proof

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Preserve local SQLite while introducing a tested storage boundary where measured concurrency/retention requires it.

**Dependencies:** R01.5, R10.2. **External gate:** measured_capacity_need.

**Code anchors:** `apps/server/src/db.ts`; `apps/server/src/store.ts`; `proposed packages/storage/`; `infra/`.

**Deliverables:**

1. Storage interface extracted with behavior-preserving conformance suite

2. Optional PostgreSQL/event store and object storage selected from measurements

3. Migration and rollback/forward-recovery plan with evidence immutability

**Acceptance checks:**

1. Same fixtures produce equivalent authorized queries across backends

2. Cross-project concurrency and retention preserve case pins

3. Cursor/snapshot semantics do not change silently

4. No graph database is required merely for 3D rendering

**Blueprint capabilities:** DK-C23.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R10.4 — Add safe multi-environment federation

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Provide a realm-level view without silently exporting raw security data or weakening tenant boundaries.

**Dependencies:** R10.3, R06.1, R01.1. **External gate:** multi_environment_authorization.

**Code anchors:** `proposed packages/federation/`; `apps/server/`; `apps/mcp/`; `apps/web/src/castle/`.

**Deliverables:**

1. Federated summaries with provenance and local deep-link retrieval

2. Independent trust domains, scoped service identities and data residency rules

3. Explicit partial failure and duplicate entity reconciliation

**Acceptance checks:**

1. One realm cannot fetch another realm evidence through a shared cursor

2. Offline spoke remains unavailable rather than healthy

3. Identity collisions across accounts/regions do not merge

4. Aggregated view preserves the scope and age of each observation

**Blueprint capabilities:** DK-C23.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R10.5 — Secure releases and the extension ecosystem

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Make it possible to trust, install, update and contribute without turning plugins into an unrestricted execution route.

**Dependencies:** R02.1, R10.1. **External gate:** owner_release_settings.

**Code anchors:** `.github/workflows/`; `CONTRIBUTING.md`; `SECURITY.md`; `proposed packages/extension-sdk/`; `infra/`.

**Deliverables:**

1. Reviewed release process, dependency inventory, verified artifact provenance and license notices

2. Versioned connector/rule/module contracts with isolated permissions

3. Opt-in usage telemetry only, no required hosted model dependency

4. Branch protection/rulesets proposed for owner approval, not bypassed

**Acceptance checks:**

1. Release artifacts match recorded source/build identity

2. Malformed or overprivileged plugin is rejected

3. A contributor pack includes benign, missing-evidence and failure fixtures

4. Upgrade removal/revocation and disconnected installation are documented and tested

**Blueprint capabilities:** DK-C24, DK-C22.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


## R11 — Validate usefulness and ship a maintainable ecosystem

Complete valid evaluations, human release gates, reproducible releases and contributor workflows.


### R11.1 — Complete the offline v2 evaluation runner

**Current baseline:** plan and six objective tests exist; full v2 runner absent. **Status:** proposed, not started by this roadmap.

**Purpose:** The plan and objective helpers exist; implement the complete equal-access harness before any provider spend.

**Dependencies:** R00.2, R01.3, R03.2. **External gate:** local.

**Code anchors:** `eval/src/`; `eval/test/`; `docs/AGENT_EVAL_V2_PLAN.md`.

**Deliverables:**

1. Condition-specific tool profiles, common metadata and exhaustive evidence access-equivalence preflight

2. Seeded held-out generation, preregistered ordering, clean/injected pairing

3. Separate retrieval, conditional reasoning, task success and pending human review

4. Budget reservation logic tested with a fake provider

**Acceptance checks:**

1. Required evidence never retrieved fails retrieval/task success

2. Unavailable evidence invalidates preflight rather than improving scores

3. C2 is not labeled raw-only when it includes derived context

4. v1 trees and transcripts remain unchanged

**Blueprint capabilities:** DK-C13, DK-C18.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R11.2 — Run approved model evaluation with independent review

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Measure the product claims without replacing human judgments or hiding failures.

**Dependencies:** R11.1. **External gate:** provider_budget_and_human_review.

**Code anchors:** `eval/`; `docs/AGENT_EVAL_V2_PLAN.md`; `proposed eval/v2/`.

**Deliverables:**

1. Pin candidate, provider route, model, prompt, clock, tool schemas and approved cost cap

2. Preserve every started attempt and all preflight failures

3. Blinded/scope-recorded review and uncertainty at case/family level

**Acceptance checks:**

1. No provider request before route/budget approval

2. Injection-direction changes compared with normal clean variation

3. Scores distinguish operator-LLM screens from actual human judgments

4. No claim of immunity, superiority or production readiness follows from a small synthetic evaluation

**Blueprint capabilities:** DK-C13, DK-C18.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R11.3 — Validate outside-user utility and interface advantage

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Prove the castle and MCP help users complete real investigation tasks, not merely attract attention.

**Dependencies:** R02.2, R03.1, R06.4. **External gate:** external_participants.

**Code anchors:** `docs/redesign/`; `proposed docs/usability/`; `examples/`; `apps/web/`.

**Deliverables:**

1. Consenting outside-user onboarding and task protocol with equal-evidence 3D/2D/table comparisons

2. Measure successful setup, correct conclusions, time, errors, recognition of gaps and return use

3. Record accessibility and real-device results separately from automated CI

**Acceptance checks:**

1. Report unsuccessful installations and abandoned tasks

2. A visually impressive but slower task is not declared better

3. MCP-only adoption is recorded as a valid product signal

4. Keep review privacy and data-sharing consent explicit

**Blueprint capabilities:** DK-C06, DK-C22.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.


### R11.4 — Ship supported product tiers and maintenance commitments

**Current baseline:** new work. **Status:** proposed, not started by this roadmap.

**Purpose:** Publish only the capability and assurance level actually verified for the release.

**Dependencies:** R10.5, R11.3. **External gate:** local.

**Code anchors:** `README.md`; `CHANGELOG.md`; `docs/`; `proposed support-matrix/`; `.github/workflows/`.

**Deliverables:**

1. Define local reference, read-only connected pilot, team investigation and optional lab-response tiers

2. Versioned supported providers, permissions, limits, troubleshooting and uninstall

3. Maintainer ownership, disclosure policy, regression/scenario contributions and compatibility policy

4. Release notes cite exact candidate evidence and remaining gates

**Acceptance checks:**

1. No integration logo without its declared support level

2. Open-source core works without paid model service

3. One complete source→case→verification demo matches the shipped candidate

4. Security corrections propagate to supported packs and tests

**Blueprint capabilities:** DK-C24.

**Required receipt:** exact candidate, changed files, actual commands/results, evidence locations, supported scope, failed or blocked checks, migration/rollback implications and next action.
