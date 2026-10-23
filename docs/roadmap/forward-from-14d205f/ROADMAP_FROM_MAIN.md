# Digital Kingdom: forward roadmap from the integrated main branch

## Read this first

**Continue the existing product. Do not rebuild it.** This roadmap is anchored to `robzilla1738/Digital-Kingdom` at `14d205fc295d0d8584f8c81d183193c4d75dc96d` (commit time 2026-10-22T23:28:57Z). Recheck the working branch and current main before implementing; never reset newer or uncommitted work to this reference.

The destination is an evidence-driven security system with an architectural world for humans and bounded investigation tools for agents. The current product already supplies a substantial local evidence and presentation foundation. The next work should convert that foundation into complete, useful workflows against actual supported environments.

This is a dependency-driven plan, not a calendar estimate or production certification. Proposed work is not implemented merely because it appears here. Repository facts are supported by the sources in `SOURCES.md`. The detailed 52-package backlog is in `IMPLEMENTATION_BACKLOG.md` and `BACKLOG.json`; every package includes scope, dependencies, paths, deliverables, tests and external gates.

### Recommended product thesis

> Connect an application, understand its relevant authority and exposures, investigate recorded activity without inventing certainty, and prove that a selected defensive change achieved its intended result.

The castle is how people orient themselves in that system. The same canonical records power the 2D graph, evidence interface, APIs, MCP and exports. None is an independent source of security truth.

## 1. What actually exists on main

The current branch includes the prior quality-gates, investigation-honesty and redesigned interface work. It is no longer appropriate to plan the four-workspace shell, ten-module kit, event search or basic MCP server as entirely new features. Preserve them and their regressions. [R01–R09]

| Area | Current-main baseline | Remaining distinction |
|---|---|---|
| Collection/storage | Authenticated generic ingestion, Node SDK, Falco HTTP, OTLP/HTTP JSON, durable SQLite journal, deduplication, normalization, quarantine, migrations and outbox | Not a broad automatic inventory/telemetry integration platform; provider-specific live verification and operational scale remain |
| Evidence/detections | Explainable rules, evidence references, findings and revisions, exact finding evidence, unlinked event search, completeness disclosures | Some correlation needs namespace tightening; historical bundle pinning and a separate case domain are missing |
| Coverage/assessment | Source-scoped current health, disabled-source handling, target resolution separated from sufficiency | Source health is not question-specific historical observability; assessment does not inspect a real candidate code/configuration diff |
| Human interface | Kingdom, Investigate, Coverage and Integrations; shared inspector, expanded finding comparison, event search, 2D view and replay | Human acceptance, physical hardware, broader operational workflows and selected backend capabilities remain |
| Castle | Ten procedural architectural modules, LOD, grouped districts, explicit focus, label management, geometry/program recovery, neutral fallback, improved limestone/slate and landscaping | Not yet the full 28-surface operational world; control architecture needs actual control records |
| MCP | Shared authorized backend, read-only investigation profile, event search/detail, current-target assessment, proposal tool under stronger role | Not an autonomous monitor, a full agent-effect instrumentation system or a response executor |
| Response | Proposed containment and separate human-typed-token decisions | No monitored-system action; no real-subject approval contract, exact plan digest or independent action verification |
| Evaluation | Preserved v1 records, correction notes, citation routing, pending human packet, v2 plan and offline scoring helpers | No completed, independently reviewed v2 product-effectiveness result |
| Deployment | Local reference setup and successful static Pages workflow | Static demo publication is not a hosted backend or production readiness |

### Execution evidence reviewed

The exact-head CI run `39872878689` reports typecheck, fixtures and build passing, with **376 tests across 43 files**. Its downloaded browser artifact contains **11 expected pilot results** and **77 expected redesign results, one skipped, zero unexpected and zero flaky results**. Pages run `39872878685` reports success. These results were checked against the exact head; they are not inherited from a parent. [R02,R03]

Five actual CI screenshot states were visually sampled: Kingdom overview, ten-module contact sheet, supporting/counterevidence comparison, event search and partial/unobserved coverage. Their recorded build IDs match the reviewed commit. They are synthetic CI captures, not an independent interactive browser exercise or physical-GPU benchmark. The current overview is supplied as `CURRENT_MAIN_OVERVIEW.jpg`.

An older frozen redesign acceptance ledger records 69 passed, 16 blocked and one not-run criterion. Keep that receipt historical. Do not silently relabel all 86 criteria approved after a merge. Manual visual judgment, assistive-technology tasks, real-device performance, representative usability and the genuine hidden-tab experiment have explicit remaining limitations. Reconcile delivery-related statuses separately with the current main workflow. [R04,R05]

### What not to redo

Keep the current four workspaces, stable asset IDs, query-driven MCP, authentic source credentials, redaction-before-persistence, quarantine, exact evidence retrieval, data-scope cancellation, pinned investigations, explicit replay boundaries and fault recovery. Do not replace them with a template, a new rendering framework or another database just to create visible progress. Refactors need a demonstrable contract, correctness or measured performance benefit.

## 2. First checkpoint: preserve the baseline and close semantic gaps

Work packages: **R00.1–R00.5**. Security and operations work in R10 begins in parallel; numbering is not a waterfall.

### 2.1 Namespaced correlation

The current repeated-authentication rule groups failures using an asset plus a session/account string. Its follow-on success comparison accepts either `session_ref` or `actor_ref` equal to the same string without an issuer/source or asset restriction in that predicate. The privilege-change rule also links equal raw session strings. The normalizer preserves these supplied reference strings rather than automatically placing them in a provider identity namespace. [R10,R11]

This is a **source-reviewed correctness risk**, not a reproduced production compromise. Begin with failing synthetic regressions. Two distinct authorities can both use a short identifier such as `admin`; an account identifier can equal an unrelated session identifier. A join must not make them one principal.

Use a typed correlation identity: project, issuer/namespace, reference type, value, and applicable resource/lifetime scope. Cross-source links require an explicit common namespace or stronger independently supported lineage. Distinguish trusted request propagation from a shared raw request string. Review agent run joins for the same problem.

Acceptance: unrelated sources, identifier types, assets, environments, expired sessions and reused process/run identifiers do not create stronger findings; explicitly supported same-authority relationships still work. Version rules and preserve historical findings rather than silently rewriting old conclusions.

### 2.2 Route resolution

The current context resolver searches a recent event window, gathers assets associated with matching routes and chooses the most frequent asset. This is a heuristic, not authoritative route ownership. `/login` can exist in multiple services or environments. [R12]

Add an explicit method/host/environment/service route registry with provenance. Return candidate targets when ambiguous; require qualification or assess the full declared target set. Mark event-inferred ownership as inferred. An old but registered route must not disappear merely because it is outside the latest event window.

Acceptance: equal paths on two services cannot produce an unexplained favorable assessment for only the more frequently observed service. Preserve the existing safe `not_assessed`/`insufficient_context` behavior.

### 2.3 Boundary tests and honest readiness

The current CI log warns that one `date-time` format is ignored by the agent-schema validator. Add actual format validation and invalid-date tests. Also exercise revoked credentials between cursor pages, changed filters, bounded responses, unknown-source restrictions and oversized inputs. No green test should be achieved by deleting its important assertion.

Create a new current-main readiness receipt rather than editing frozen receipts. Record which checks are automated, manually completed, provider-verified or not run. Protect main through an owner-approved repository policy; do not bypass protections or change administrative settings as incidental implementation.

## 3. Make evidence and history reproducible

Work packages: **R01.1–R01.5**.

The UI currently compensates for backend limitations: it retains partial evidence, checks revision drift and labels current coverage during replay. That is good behavior. The next step is to give it stronger server contracts, not remove the warnings. [R05–R08]

### 3.1 Versioned domain facts

Separate declared configuration, observed configuration, recorded activity, inferred relationships, hypotheses and test results. Give each assertion a subject, provenance, valid interval and recorded-at interval. Retain conflicts between sources rather than choosing the most recent assertion as universally correct.

Retain provider-native identity alongside stable application identity. A recreated resource with the same name is not automatically the same resource. Model logical workloads and individual instances separately. Provide migration defaults that mean unknown, not invented history.

### 3.2 Historical capability coverage

Persist configuration and administrative transitions: enabled/disabled, assigned assets, event classes, freshness expectations, sampling, dropped records, retention, replay/backfill support and permission changes. Evaluate coverage for a question, scope and interval—not just whether one source has recently sent any event.

Examples:

- Request logs are reporting but database reads were not collected: database-access conclusions remain unresolved.
- A source is healthy today but was disabled during the incident: historical investigation keeps the gap.
- A source can report errors but not successful reads: silence does not imply no read.
- A feed is sampled: distinguish received records from complete activity.

Current telemetry from a collector cannot retrospectively establish missing history. Keep unknown intervals visible. Collector queues and retries also have documented loss scenarios; monitor and report those rather than claiming zero loss. [E01]

### 3.3 Immutable investigation bundles

A bundle should bind project, graph revision, finding revision, exact event/reference IDs, query parameters, event snapshot, relevant source configuration, ruleset and known omissions. Every page uses the same bundle identity. New observations produce a new bundle rather than mutating a comparison halfway through.

The current database already has finding revisions; add authorized APIs and revision-aware membership rather than inventing another independent evidence system. Content hashes establish change detection relative to the supplied reference, not truth or completeness.

### 3.4 Concurrent work and performance

Require revision preconditions for dispositions, notes where appropriate, source changes and plans. On conflict, show the newer state; do not silently overwrite another investigator.

Bound query work, not only result size or days. Benchmark representative 10,000/100,000/1,000,000-event synthetic datasets with stated hardware before setting supported limits. Add suitable indexes, cancellation, query budgets and fair work scheduling. Track expired snapshots and retention effects explicitly. Slow historical searches must not stop ingestion.

## 4. Make real onboarding a complete supported workflow

Work packages: **R02.1–R02.4**.

The next adoption milestone is not another screenshot. It is a new user connecting a supported application without manually authoring every relationship and immediately receiving a truthful, useful model.

### 4.1 Connector contracts

Every connector needs a versioned manifest: permissions, resources, event classes, identity mapping, rate limits, watermarks, retry/idempotency behavior, redaction, failure categories and verification scope.

Represent separate support facts: modeled, discoverable, ingestible, analyzable, contract-tested, live-provider-verified and supported for response. These are not one linear score. A decorative representation or a sample payload must not appear as a connected integration.

### 4.2 Local application pack

Ship one executable local pack with a reference service, authentication flow, database audit, real collector configuration, known source mappings and independent agent-effect observer. Configure scoped producers and verify a harmless event. Include startup, removal, troubleshooting, backpressure and privacy instructions.

Main supports OTLP JSON and official exporter tests, but its documented limits do not establish Collector-binary compatibility or arbitrary protocol support. Test a real Collector against the exact documented configuration; explicitly reject unsupported encodings. [R09,E01]

### 4.3 Repository and deployment discovery

Read repository metadata, deployment descriptors and workflow results without executing arbitrary repository code. Record declared versus observed assets. Connect commit, workflow and deployed artifact references where the available evidence allows it. Use a GitHub App or narrowly scoped credentials when adding a production connector; never embed a broad personal token in browser state or a model prompt.

### 4.4 First cloud pack

Recommended first implementation: one AWS account, a declared region set, read-only IAM and CloudTrail/inventory support, plus an offline-export path. This is a product choice, not a claim that AWS is the only suitable platform. If the first pilot is on another provider, select its equivalent complete pack while keeping the same contracts.

Track management versus data-event coverage, account boundaries, missing permissions, policy retrieval failures and delayed delivery. Do not infer resource reads from management-only visibility. A connector that fails halfway must report partial inventory rather than a clean empty graph.

A completed pack supplies inventory, activity, case recipe, verification scenario and UI/MCP output. Provider-specific integration is not complete when an SDK call returns a list.

## 5. Persist investigations, not only findings

Work packages: **R03.1–R03.5**.

The current schema contains findings, revisions, notes and containment requests. It does not provide a separate persistent case/hypothesis domain. An export called a case is not a complete case-management workflow. [R13]

Add cases with a stated question, owner, scope, interval, pinned evidence bundles, related findings, independently retrieved events, hypotheses, contradictions, gaps, decisions and follow-up checks. A case can begin without any finding. Analysts and agents should work from the same case version.

Investigation recipes should specify the next discriminating query, not merely produce a generic narrative. A case might compare credential compromise, legitimate administration, an identity-linking error and collection loss. A hypothesis must carry the evidence that would support or weaken it. Unsupported associations remain leads.

### Flagship: credential aftermath

Start with a credential identifier and exposure window. Determine recorded use, session lineage, new credentials/grants/trust changes, current surviving authority and unresolved accounts or intervals. The tool should never request the stolen secret merely to identify it.

Distinguish available to a workload, read, transmitted, used, and used without authorization. Record which transition the evidence supports. Rotation of the original credential is not automatically complete containment of related sessions or independently created grants.

Connect safe honeytokens through registered placements and trigger evidence. Token use points to the decoy and an observation, not a human identity or guaranteed entry point. Record tests/scanners, copied placements and export destinations. No intrusive tracking payloads or hack-back functionality.

Add reliable attention delivery: severity-aware digesting, case deduplication, escalation, quieting with expiry and audit, minimal data in external notifications, and a linked authorized case. Acknowledgment is not resolution. Notifications must not drown out high-value findings with every ordinary HTTP request.

## 6. Prevent risky changes through actual lineage and authority

Work packages: **R04.1–R04.4**.

Main's assessment examines existing target findings and coverage. It does not evaluate the proposed code/configuration/artifact diff; the supplied summary is echoed, not analyzed as a candidate change. Keep that useful current-target assessment, but do not market it as prospective security proof. [R12]

### 6.1 Artifact-to-runtime chain

Build the chain from repository/commit through build identity and artifact digest to registry, deployment revision and running instance. A pipeline asset and `deploys` edge are only declarations until supported.

Verify provenance against expected repository, issuer, workflow and artifact digest. A valid signature by an unexpected signer fails the installation's policy. Attestations do not guarantee the artifact is safe; they support origin/build reasoning. [E03]

### 6.2 Vulnerability applicability

Associate SBOM/component data with the actual deployed digest. Consume authoritative advisories and exploitability context with freshness and source provenance. Distinguish matched version, affected configuration, reachable execution path and observed exploitation. VEX statements need issuer, product, time and justification; KEV membership is exploitation context, not proof of an incident here. Do not turn a global likelihood or severity score into an individual breach probability.

### 6.3 Conditional effective access

Compute access under documented conditions, including identity, resource, boundary, session and organization restrictions where supported. AWS explicitly evaluates more than simple allow statements; applicable deny logic can overturn a superficially reachable path. [E02]

Return feasible-under-recorded-conditions, conditionally feasible, blocked or unresolved. Include every prerequisite and unsupported policy feature. A graph path is not an exploit chain.

### 6.4 Real change assessment

Compare before/after snapshots for exposed routes, policy grants, agent tools, egress destinations, build identities, artifact source and visibility. Bind the result to an exact candidate commit/artifact/configuration and test scope. A new candidate invalidates prior assurance where relevant.

After deployment, verify the running artifact and resulting configuration. A merged fix is not proof that the deployed service changed. Present the changed doors, permission routes and sensor coverage in the castle alongside an exact textual diff.

## 7. Understand what agents actually did

Work packages: **R05.1–R05.4**.

Main supports tool-invocation/effect event categories and an MCP investigation client. The future capability is a complete supported observation path, not simply renaming those events as autonomous defense. [R14,R15]

Model four planes: authorized intent, policy decision, actual execution and independently observed effect. Bind them to run, issuer, tool/server identity, policy version, workload identity and relevant resource scope. Maintain privacy-minimized references rather than copying all prompts and secrets.

Instrument one real agent workflow and a separate effect observer. Test a permitted operation and a prohibited operation. Compare reported refusal/denial with actual effect, including a controlled path outside the ordinary wrapper. Absence of an effect is meaningful only when the observer could have recorded it.

Extend MCP with bounded case resources, incremental updates and client-capability-aware subscriptions or polling. Continuous detection belongs to the backend, not a model polling every raw event. Remote MCP requires separate authorization, audience validation, origin/SSRF controls, revocation and tenant/field scope; no token passthrough. [E04]

An optional investigation assistant can draft a summary, propose a query or explain a bounded result. It must not fabricate evidence edges or modify its own authority. Store observable tool actions and claim references needed for audit, not hidden reasoning. Keep deterministic behavior useful when the model is unavailable. Use fake-model tests until separately authorized provider calls.

## 8. Grow the castle into the operational world

Work packages: **R06.1–R06.4** and the surface packs in R09.

### Preserve the current visual investment

Main already has ten recognizable structures, original procedural geometry, quality modes, roof behavior, bounds/triangle checks, grouping, focus and recovery. The latest visual refresh makes the composition warmer and more coherent. Extend that kit; do not return to blockout geometry or replace it with a generic map. [R04,R16]

The current lawn/terrace setting is deliberately not an enforcement perimeter. It avoids drawing an invented moat or wall. That does not prohibit future fortress architecture: it requires operational controls and decorative architecture to remain distinguishable.

### Add semantic levels

Use realm → environment/account → district → logical asset → interior. Display replicas beneath the logical workload. Keep resource identity distinct from display name. A source change or new event must not rearrange the entire world. Show a preview for major reflow and preserve historical layouts or disclose when unavailable.

### Give surroundings a real job

| World component | Operational backing required |
|---|---|
| DNS registry pavilion and approach routes | Domain ownership, records, certificates, discovered endpoints and uncertainty |
| Gates and alternate entrances | Host/method/route/ingress inventory and applicable controls |
| Dispatch houses and lanes | Queues/topics, producers/consumers and delivery evidence |
| Key registry and authority overlay | Namespaced identities, credentials, grants, sessions and policy conditions |
| Forge and supply depot | Source/build/digest/registry/runtime provenance |
| Archives and vault interiors | Data resources, classifications, access policies and relevant audit scope |
| Observatory and tool annexes | Agent/run/tool identities, policy decisions, execution and effect observations |
| Partner pavilions and outposts | External integration boundaries and registered endpoint telemetry |
| Reserve archives | Backup configuration plus dated restore-test results |
| Watchtowers and control checkpoints | Observability capability and control test records, not decorative reassurance |
| Unresolved region | Specific discovered lead or missing scope, not a claim to know invisible infrastructure |

The full 28-item mapping is in `SURFACE_EXPANSION_MATRIX.json`. Add schema and source support before giving an element operational meaning. Unsupported surfaces may be explicitly declared inventory, but cannot acquire fictional live state.

### Keep six independently selectable layers

Infrastructure, identity/authority, data, delivery, agent capability and evidence/coverage. The same structure persists between layers. Relationships identify direction, type, time, provenance and claim class. Declared and hypothetical edges do not animate as observed attacker movement.

Interiors provide useful detail: API doors, route ownership, workload instances, permission grants, deployed versions, tool capabilities and controls. Do not create tiny unusable objects for every leaf at overview distance. Semantic zoom and conventional lists expose that detail without hiding membership.

### Human and machine usability

Selection should reveal evidence; explicit focus changes the camera. Controls must remain readable with an inspector open. Unknown or partial coverage stays visible independent of threat status. A shader failure changes presentation, not backend risk.

Test the actual application on physical devices and with keyboard/screen-reader users. Maintain non-WebGL parity and reduced motion. Measure whether the world improves orientation and communication; keep tables superior where tables are the right tool. All real data should remain accessible when decorative complexity is reduced.

## 9. Prove controls in an authorized laboratory

Work packages: **R07.1–R07.4**.

Create controls with states declared, observed-configured, tested, stale-test, failed and unknown. A control record binds scope, policy revision, source, test version/time, evidence and limitations. Code or policy drift can invalidate the test result.

The laboratory uses synthetic identities/resources and controlled receivers. Define target ownership, allowed actions, budgets, stop conditions and cleanup. Externally supplied attack content must not grant permission to act. Do not run exploit tests against arbitrary assets simply because a discovery feed found them.

Every negative test needs an appropriate permitted control. A tool that blocks all outbound traffic is not proven correctly configured if it also breaks required work. A terminated process is not proof that the triggering action was prevented; observe the destination or state independently.

The 16 scenario pack definitions should be implemented in stages. Non-response packs can pass before an executor exists. Response-dependent packs remain explicitly blocked until R08 provides the required capability; do not mock an execution and call the operational scenario complete. Persist every attempt, failure, observation and cleanup outcome.

Convert resolved cases into proposed sanitized regression tests. The owner reviews publication; private incident records do not automatically become community fixtures.

## 10. Introduce response as a separate authority plane

Work packages: **R08.1–R08.4**.

Main intentionally does not execute containment. Keep that boundary until the new controller and verification contracts are tested. A human-typed token decision is not proof of two independent people; the current code itself records that limitation. [R13,R17]

First add real subjects and approval policy. Then introduce exact response plans that bind environment, provider-native targets, operation, parameters, evidence bundle, policy version, preconditions, expiry, expected blast radius, lease/compensation and verification steps. Any changed target or meaningful precondition requires revalidation.

Build a separate laboratory-only executor first. Use restricted provider adapters, not arbitrary AI-generated shell commands. Give executor, reasoning agent, approver and verifier separate authority. Reject stale or replayed approvals and repeated non-idempotent actions.

Test the ambiguous crash window: a provider may have performed an action even if Digital Kingdom failed before recording the receipt. Reconcile provider state before retrying. Distinguish rollback from compensation; never restore a known compromised key as a rollback.

Verification checks provider state, prohibited behavior, permitted behavior, residual access, sensor visibility and propagation. Outcomes are verified within scope, failed or inconclusive. API acceptance is not successful containment. Service restored is not proof that all historical data exposure was resolved.

Production execution remains a separately authorized, narrowly supported deployment decision. Nothing in this roadmap grants permission for it.

## 11. Expand breadth only through complete packs

Work packages: **R09.1–R09.4**.

The destination includes all discussed surfaces, but each should arrive with a working path from inventory through evidence to a useful question. Edge/DNS/browser/API/webhook packs, runtime/serverless/queue packs, data/RAG/secrets/backup packs and SaaS/endpoint/email packs have distinct authority and privacy requirements.

A pack includes source conformance, minimal permissions, canonical mappings, history, examples, benign alternatives, missing-coverage cases, UI/MCP views, investigation recipes and removal instructions. Specify what is contract-tested versus live-provider-verified.

Data/RAG packs should support authorized tenant-isolation tests and document provenance without routinely ingesting private documents. Email packs can start with audit metadata rather than body contents. Backup packs should report restore validation separately from configuration. Endpoint identity includes process lifetime and device registration, not just a host label.

The first outside users should determine pack priority. Full architectural ambition is compatible with precise supported scope; breadth without support quality is not power.

## 12. Operate securely and scale from measurements

Work packages: **R10.1–R10.5**, running alongside the earlier tracks.

Add OIDC/SSO-backed subjects for team use, service-token lifetime and rotation, emergency recovery, sensitive-field authorization, auditable administrative changes and clear demo/live separation. Protect collector and response credentials independently. Read-only evidence access still needs data minimization.

Measure source bursts, duplicates, out-of-order delivery, backpressure, full disks, failed migrations, poison records, revoked credentials, slow queries and restart recovery. Verify backup restoration of the knowledge/evidence and administrative state, not just that a backup file exists. Report collection and verification gaps during failures.

Retain SQLite as a supported local mode until workload evidence justifies another store. Add a storage interface and parity tests before team-scale migration. PostgreSQL or specialized event storage is a measured option, not a prerequisite to useful defense. Do not add Kafka or a graph database as a prestige feature.

Federation comes after local correctness and clear boundaries. Keep tenant/resource authorization, provenance, event clocks, partial outages and conflict resolution explicit. Cross-realm maps must not disclose another tenant's existence through counts or search.

Secure the project's own supply chain: reviewed dependencies, release SBOM, expected provenance, reproducible verification, scoped CI credentials, secret scanning and extension permissions. Owner-approved branch protections and required checks belong here. Attestations must be verified under an expected-origin policy; they do not make vulnerable source safe. [E03]

## 13. Prove usefulness rather than expanding claims

Work packages: **R11.1–R11.4**.

The v2 plan is not a completed runner. Finish its offline orchestration and fake-model tests, equal-access preflight, budget accounting, fresh conversations, prompt/tool manifests and immutable attempt handling before paid execution. [R18]

Keep three denominators: retrieval, conditional reasoning and end-to-end task success. Reachable but missed evidence fails the retrieval goal. Reasoning about unseen evidence is unexercised, not a pass. Pending semantic review cannot become completed accuracy. Preserve provider/harness failures and alternative recommendations.

For injection evaluation, compare paired clean/injected cases with ordinary clean-run variation and counterbalanced ordering. Zero writes does not establish recommendation immunity. Human claim-support judgments must be performed by real reviewers; an operator model can supply labeled screens but not fabricate that approval.

Run outside-user studies on installation, locating the affected resource, interpreting counterevidence, recognizing missing visibility and completing a real task. Compare equal-information castle, graph/list and MCP workflows. Record what users actually do and whether they return, not just whether they like the demonstration.

Publish capability support, limitations, verification scope, upgrade instructions, licenses and maintainer commitments. Keep core local evidence functionality and export usable without a model API. Optional managed services are separate from the open-source value proposition.

## 14. Three flagship workflows to build and demonstrate

### A. Agent boundary failure

An owned sandbox agent requests an action. A policy event reports denial, but a separate observer records an effect. The case shows both, makes no automatic impact claim, identifies the supported discrepancy and preserves missing paths. A proposed correction is tested with prohibited and permitted operations. The same run and evidence are inspectable in the observatory, conventional evidence view and MCP.

This is a proposed scenario, not a claim that the current product has completed it end to end.

### B. Credential aftermath

A credential identifier is reported exposed. Discovery and audit data establish supported use, a subsequent grant change and the current surviving grant. A same-address login from an unrelated authority remains separate. Missing-account coverage stays unresolved. The response is authorized separately; verification checks the relevant access and legitimate workload, not only the original key state.

### C. Deployment security regression

A candidate changes an artifact and broadens permissions or adds an entrance. The product identifies the exact before/after relationship, applicable source/build context and required control tests. Approval binds to that candidate. After deployment the runtime digest/configuration is checked. The castle shows the changed entrance/authority path without calling a theoretical exposure an observed intrusion.

These three workflows combine the distinctive presentation with concrete reasons to keep the tool installed.

## 15. Milestones, not a restart or calendar

| Milestone | Required outcome | Primary work |
|---|---|---|
| M0 — Dependable integrated baseline | Current main preserved; namespaced correlation and route ambiguity tested; exact receipt and limitations | R00 and early R10 |
| M1 — Reproducible investigation | Stable historical facts, source capability intervals, pinned bundles, concurrency and bounded queries | R01 |
| M2 — Connected application | One complete local pack and first authorized provider pack expose useful real inventory/activity | R02 with R05 instrumentation |
| M3 — Useful case outcome | A case independently finds relevant activity and residual authority, with known gaps | R03 |
| M4 — Preventive engineering | Actual runtime lineage and a candidate security diff identify a meaningful change | R04 |
| M5 — Faithful world and agent plane | The relevant surfaces, identities and agent effects are navigable without invented semantics | R05/R06/R09 |
| M6 — Verified defense | Positive/negative lab tests and independent effect verification | R07 and gated R08 |
| M7 — Supported operational product | Recovery, scale, release safety, external utility and honestly reviewed evaluations | R10/R11 |

Engineering may overlap where dependencies permit. Security-critical correctness cannot be waived for presentation progress. Manual or provider gates do not prohibit independent local work; they prohibit claiming that the gated result has been verified.

### First five implementation batches

1. **Source correctness:** R00.2–R00.4. Reproduce namespaced-reference and ambiguous-route cases, implement the bounded fix, and run current regressions.
2. **Versioned domain/evidence foundation:** R01.1 and R01.4, followed by R01.2 and R01.3. Split into reviewable migrations/API commits; do not ship an enormous undifferentiated rewrite.
3. **Measured retrieval and capability-aware onboarding:** R01.5 and R02.1. Protect ingestion while defining real pack conformance.
4. **One complete local stack and agent observer:** R02.2 and R05.1–R05.2. Test actual data flow, missing sources and permitted/prohibited effects.
5. **Persistent case plus first authorized provider scope:** R03.1, R02.3/R02.4 as access allows, then the first credential-aftermath recipe. A provider export path can be tested before live access is approved.

Castle improvements in R06 proceed alongside newly supported data, rather than a second isolated redesign campaign.

## 16. Suggested measurable acceptance outcomes

These are proposed targets and measurement obligations, not existing results.

- An unfamiliar operator reaches a useful local result through documented setup without editing core source or drawing every asset.
- Every operational visual resolves to a canonical entity or explicitly bounded group; every security claim resolves to evidence and uncertainty.
- Required evidence is retrieved even when unattached to findings and older than the latest UI window.
- Two different authorities with the same account/session text do not create a false link.
- A current healthy source cannot erase a historical data-collection gap.
- Every comparison uses one immutable bundle version or explicitly reports incomplete/drifted state.
- A candidate permission expansion is identified with supporting policies and unsupported conditions disclosed.
- Prohibited lab actions fail while permitted control actions succeed; observer failures yield inconclusive results.
- Approved/accepted/executed/verified remain separate response states.
- Restarts, storage problems and collector gaps have measured outcomes and visible loss/coverage counters.
- Selected workloads satisfy documented UI/query budgets on named hardware; frame-rate numbers do not stand in for investigative usability.
- External users can complete the chosen case more accurately or with lower effort than their equal-information comparison workflow, measured rather than assumed.

## 17. What an implementation agent must preserve

Use the current worktree and live branch state. Never reset to this SHA just because it appears in the roadmap. Do not re-run all old rebuild stages. Preserve security fixes, API compatibility, frozen v1 evaluations and existing visual work. New schemas need versioned migration and regression plans.

Complete one end-to-end slice at a time. For each package, record the actual revision, files, commands, outcomes, screenshot/fixture references, external scope and remaining gaps. A file or heading named after a feature is not completion. A successful fake/provider-contract test is not live verification.

No paid model calls, production changes, infrastructure spend, private-data transfers, merges, branch-policy changes or public deployment are authorized by this roadmap. Existing specific permissions should be checked and honored, not inferred from the general ambition.

## 18. Review scope and limits

The review inventoried main, read key implementation and contract files, inspected CI and artifacts, parsed exact-head browser results and visually sampled five corresponding captures. It did not execute a local full test suite, conduct a new interactive browser pilot, test a physical GPU, complete human accessibility/usability review, or audit every source line. No repository changes were made.

The strongest current conclusion is that an integrated, extensively tested local alpha now exists. The source-traced issues should be reproduced before claiming they are fixed. The future capabilities remain proposed until the new implementation and execution receipts establish otherwise.

**Keep the product. Strengthen the evidence. Connect real surfaces. Complete investigations. Prove selected defenses. Let the castle reveal that work accurately.**
