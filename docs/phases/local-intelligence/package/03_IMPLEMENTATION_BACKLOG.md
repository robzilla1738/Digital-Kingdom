# Implementation backlog

32 bounded work packages; 128 acceptance requirements. All proposed checks start `not_run`. Paths listed below exist in the reviewed repository unless the implementation has moved; recheck HEAD before editing.

Dependency order, not an imposed timeline, controls the work. Use existing modules rather than a new project.
## LP00 — Recover baseline and phase boundaries
**Goal:** Continue current implementation and make this local-only phase explicit.

**Dependencies:** none

**Inspect/reuse:** `docs/roadmap/STATUS.json`, `docs/quality/COMPLETION-2026-10-23.md`, `package.json`, `.github/workflows/ci.yml`

### Deliverables
- Current HEAD/working-tree and existing-work receipt; no reset or scaffold.
- Existing-to-new requirement mapping, frozen-evaluation digests, and permission matrix.
- New local-phase ledger alongside, not instead of, previous roadmap and receipts.

### Acceptance
- **LP00-A1:** Record the actual HEAD and preserve unknown/uncommitted work; rebase decisions are explicit, not automatic.
- **LP00-A2:** Historical evaluation and receipt trees are fingerprinted and unchanged after bootstrap.
- **LP00-A3:** Runtime network, model-budget and local-action policy default to no external access/no new provider calls.
- **LP00-A4:** Baseline checks are executed where available; unavailable checks remain not_run and are not described as passed.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP01 — Repair scoped permission semantics
**Goal:** Prevent overstated feasible access before analysis becomes more prominent.

**Dependencies:** LP00

**Inspect/reuse:** `apps/server/src/access/aws-policy.ts`, `apps/server/test/access-r04.test.ts`, `apps/server/src/change-review.ts`, `apps/server/src/aftermath.ts`

### Deliverables
- Reproducing module and API tests for conditional denies in every supported policy layer.
- Conditional/blocked/unresolved precedence and explicit unsupported-semantics handling.
- One authoritative result used by paths, change review, aftermath and UI.

### Acceptance
- **LP01-A1:** Boundary, session-policy and SCP conditional-deny fixtures reproduce the old behavior and return conditional after repair.
- **LP01-A2:** A definitely applicable unconditional deny remains blocked; missing controlling inputs cannot become feasible.
- **LP01-A3:** Unsupported policy constructs and case-sensitive resource identifiers are exercised and conservatively handled within declared support.
- **LP01-A4:** The API, change review, aftermath and MCP expose consistent decision and evidence, without changing frozen evaluation records.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP02 — Harden recipe conclusions and incomplete work
**Goal:** Make recipes rigorous enough to drive an investigator rather than just produce plausible explanations.

**Dependencies:** LP00

**Inspect/reuse:** `apps/server/src/recipes.ts`, `apps/server/src/investigate.ts`, `apps/server/src/coverage-history.ts`, `packages/detections/src/correlation.ts`

### Deliverables
- Recipe result version with obligation/query status and explicit unavailable/budget outcomes.
- Namespace-aware follow-on pivots and page continuations.
- Observable hypothesis predicates separated from intent and approval.

### Acceptance
- **LP02-A1:** Budget exhaustion, a null coverage result, a failed page and zero configured observers each remain partial/unknown and cannot imply visibility.
- **LP02-A2:** A decisive event beyond the first 100 results is retrieved or explicitly outstanding; no silent completion.
- **LP02-A3:** Same raw actor/session/run IDs under unrelated authorities do not support a joint hypothesis.
- **LP02-A4:** Failed logins followed by success and benign activity never alone establish malicious guessing; allowed tool calls never alone establish approval.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP03 — Define run provenance and capability contracts
**Goal:** Separate local execution, fixture delivery, model output and external validation.

**Dependencies:** LP00

**Inspect/reuse:** `packages/contracts/src/types.ts`, `packages/contracts/schemas`, `apps/server/src/adapters/connectors.ts`, `packages/contracts/src/surfaces.ts`

### Deliverables
- Versioned run/blueprint/verification contracts, schema validators and migration proposal.
- Orthogonal local-run provenance without redefining synthetic/live compatibility.
- Support matrix separating rendered, declared, instrumented, local-verified and externally verified.

### Acceptance
- **LP03-A1:** Existing synthetic/live examples remain valid or receive an explicit tested versioned migration; no silent semantic relabeling.
- **LP03-A2:** Local recorded activity always exposes synthetic-data and local-scope qualifiers in API/UI/MCP/export.
- **LP03-A3:** Every new contract rejects unknown executable, credential and arbitrary-target fields.
- **LP03-A4:** Capability badges derive from scoped receipts, not from a surface family name or an LLM declaration.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP04 — Compile local application blueprints
**Goal:** Create coherent local worlds without hand-authoring the whole graph.

**Dependencies:** LP03

**Inspect/reuse:** `packages/graph-core/src/importers.ts`, `packages/graph-core/src/routes.ts`, `packages/scene-compiler/src/compile.ts`, `examples/reference-app/src/pack.ts`

### Deliverables
- Reviewed templates for SaaS, agent workspace and delivery/identity.
- Inert descriptor import, preview and deterministic plan compiler.
- Stable asset/route/identity assignment and explicit observation gaps.

### Acceptance
- **LP04-A1:** An empty workspace can preview all three templates without provider credentials.
- **LP04-A2:** Untrusted Compose/OpenAPI/manifest strings are treated as data; scripts, interpolation, remote refs and executable assets are rejected or ignored explicitly.
- **LP04-A3:** Same blueprint version/seed yields the same logical graph and layout proposal; changed input yields a new revision.
- **LP04-A4:** Adding a service preserves unrelated identities and coordinates; ambiguous routes stay ambiguous.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP05 — Own and isolate the local runtime
**Goal:** Build a run controller that cannot target arbitrary services merely because they are local.

**Dependencies:** LP03, LP04

**Inspect/reuse:** `examples/reference-app/src/quickstart.ts`, `examples/reference-app/src/pack.ts`, `examples/reference-app/src/lab/runner.ts`, `infra/compose/docker-compose.yml`

### Deliverables
- Run-owned endpoint registry, nonce handshake, temp directories, process manifests and least-authority tokens.
- Start/pause/resume/clone/stop/cleanup lifecycle; separate monotonic enforcement deadline.
- Trusted host-process mode and optional constrained operator-launched container profile.

### Acceptance
- **LP05-A1:** A different localhost service, redirect, metadata/LAN/public address or unregistered endpoint is refused before action.
- **LP05-A2:** A run token cannot reach another run or a non-lab project; forged environment labels do not grant authority.
- **LP05-A3:** Stopping/aborting cleans only manifest-owned resources and records cleanup failure without removing user files.
- **LP05-A4:** Frozen scenario time cannot suspend wall-clock limits; resource and network controls are checked or the execution mode is explicitly restricted/refused.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP06 — Run instrumented services and independent observers
**Goal:** Exercise actual local operations and effects, not only synthetic event insertion.

**Dependencies:** LP05

**Inspect/reuse:** `examples/reference-app/src/app.ts`, `examples/reference-app/src/agent/boundary.ts`, `packages/sdk-node/src/index.ts`, `apps/server/src/adapters/otlp.ts`

### Deliverables
- Local gateway, auth/API, tenant data, queue/worker and artifact/token services with controlled data.
- Per-operation effect observer with run/resource identity and health intervals.
- CLI/UI setup that identifies exactly which local capabilities are reporting.

### Acceptance
- **LP06-A1:** A real local request reaches the expected service and appears identically in API, browser and MCP evidence.
- **LP06-A2:** A permitted operation and a prohibited operation produce independently observed outcomes under the current policy.
- **LP06-A3:** A deliberate observer outage becomes unknown for the affected interval, not a no-effect conclusion.
- **LP06-A4:** Every source has independent declared authority; relayed/self-reported records cannot corroborate themselves.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP07 — Build a finite scenario and fault DSL
**Goal:** Make local worlds repeatable and variable without handing AI arbitrary execution.

**Dependencies:** LP06

**Inspect/reuse:** `scenarios/dk-t`, `scripts/run-scenarios.ts`, `examples/reference-app/src/lab/runner.ts`, `eval/src/scenarios.ts`

### Deliverables
- Finite actions, event schedules, benign distractors, isolated mutations and deterministic seeds.
- Separate private-truth store, observable evidence store and investigator output.
- Snapshot/reset and partial-run accounting.

### Acceptance
- **LP07-A1:** DSL cannot execute scripts, shell, plugins or unrestricted network requests.
- **LP07-A2:** Same seed/action schedule reproduces intended state; runtime timing differences are recorded, not hidden.
- **LP07-A3:** Missing/delayed/dropped evidence affects observability without rewriting private operation truth.
- **LP07-A4:** Investigator views contain no answer labels, hidden seeds, expected action IDs or oracle credentials.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP08 — Add investigation contracts and obligations
**Goal:** Turn a case question into auditable evidence requirements.

**Dependencies:** LP01, LP02, LP03

**Inspect/reuse:** `apps/server/src/cases.ts`, `apps/server/src/recipes.ts`, `apps/server/src/bundles.ts`, `apps/server/src/facts.ts`

### Deliverables
- Versioned case contract with public goal, targets, interval, hypothesis and obligation state.
- Explicit negative-claim coverage requirements and closure prerequisites.
- Transition ledger linked to evidence/query revisions.

### Acceptance
- **LP08-A1:** Contracts derive from public case scope and supported recipes, never private scenario truth.
- **LP08-A2:** An obligation is satisfied only by the required scoped evidence or a documented inapplicability reason.
- **LP08-A3:** An incomplete investigation can honestly conclude unresolved without asserting a negative or malicious intent.
- **LP08-A4:** Changing scope or evidence invalidates affected obligations without overwriting previous decisions.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP09 — Execute bounded investigation plans
**Goal:** Give AI a reliable next evidence step with resumable work.

**Dependencies:** LP08

**Inspect/reuse:** `apps/server/src/investigate.ts`, `apps/server/src/recipes.ts`, `apps/server/src/store.ts`, `apps/server/test/search-budgets-r01.test.ts`

### Deliverables
- Typed query-plan jobs, continuations, quotas, cancellation and restart state.
- Scope-safe pivots using declared identities, routes, run/resource IDs and versions.
- Per-step purpose, results, errors, completeness and budget counters.

### Acceptance
- **LP09-A1:** A key event beyond page one is fetched under a stable snapshot without duplicate/skip at tied timestamps.
- **LP09-A2:** No tool accepts raw SQL, arbitrary paths, unrestricted graph queries or source credentials.
- **LP09-A3:** Restart resumes from committed job state; cancellation/revocation stops further authorized work.
- **LP09-A4:** Budget/truncation/error states remain explicit and do not mark downstream obligations satisfied.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP10 — Deliver compact evidence and check claims
**Goal:** Reduce model overload without hiding decisive records or uncertainty.

**Dependencies:** LP09

**Inspect/reuse:** `apps/server/src/bundles.ts`, `apps/server/src/assistant.ts`, `apps/mcp/src/server.ts`, `apps/web/src/lib/evidence-loader.ts`

### Deliverables
- Versioned compact packets with exact refs, roles, exposure records, revisions and continuations.
- Structured claim checker for scoped predicates plus unsupported-narrative flags.
- Non-destructive packet expansion and counterevidence preservation.

### Acceptance
- **LP10-A1:** A summary never substitutes for a missing required record; packet omissions are machine-readable.
- **LP10-A2:** Citations to existing but not retrieved records fail availability checks; cross-run/revision refs fail scope checks.
- **LP10-A3:** Arbitrary natural-language support is not labeled machine-proved merely because IDs exist.
- **LP10-A4:** Counterevidence, source uncertainty and partial query status survive packet size limits and exports.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP11 — Expose a focused MCP workflow
**Goal:** Make the common investigation loop simpler than choosing among all tools.

**Dependencies:** LP10

**Inspect/reuse:** `apps/mcp/src/server.ts`, `apps/mcp/test/mcp-r05.test.ts`, `apps/mcp/test/quality-gates-stdio.test.ts`, `apps/server/src/app.ts`

### Deliverables
- Focused read-only and analyst-service profiles, capability negotiation and stable output envelopes.
- Open/read contract, next bounded step, inspect refs and propose conclusion actions.
- Real stdio tests and an exportable configuration for an existing coding agent.

### Acceptance
- **LP11-A1:** Both profiles receive only permitted project/run evidence and the same records as the UI.
- **LP11-A2:** Case/job writes have correct annotations and backend privileges; viewer cannot persist a change by calling a nominal read tool.
- **LP11-A3:** Prompt text in an event/tool result cannot change profile, budget, target or approval policy.
- **LP11-A4:** Tool outputs are bounded with resumable refs; disconnected clients can resume without hidden extra model calls.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP12 — Build the investigation workbench
**Goal:** Make obligations, hypotheses and AI drafts useful to a human reviewing the case.

**Dependencies:** LP08, LP10, LP11

**Inspect/reuse:** `apps/web/src/workspaces/investigate/CasesWorkspace.tsx`, `apps/web/src/inspector/FindingView.tsx`, `apps/web/src/lib/navigation.ts`

### Deliverables
- Case progress, evidence/coverage questions, competing hypotheses and next-action panel.
- Versioned agent proposals separate from accepted case records.
- Shared anchors linking castle selections and actual evidence.

### Acceptance
- **LP12-A1:** Changing cases aborts stale reads and preserves unsaved drafts in the correct scope.
- **LP12-A2:** A user can reach supporting/counterevidence, failed queries and uncertainty without navigating a 3D camera.
- **LP12-A3:** Agent completion cannot silently resolve an unanswered case question or erase a person’s note.
- **LP12-A4:** Keyboard/reduced-motion/narrow-screen automated workflows retain the same critical evidence and status.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP13 — Add bounded path and change exploration
**Goal:** Make why-can-this-reach-that and what-changed inspectable.

**Dependencies:** LP01, LP08

**Inspect/reuse:** `apps/server/src/access/aws-policy.ts`, `apps/server/src/change-review.ts`, `apps/server/src/lineage.ts`, `apps/server/src/facts.ts`

### Deliverables
- Provenance-linked conditional path inspector with explicit unsupported prerequisites.
- Local/snapshot change comparisons for grants, routes, tools and artifacts.
- Candidate state hashes and deterministic analysis receipts.

### Acceptance
- **LP13-A1:** Conditional permission never animates as observed use; unsupported provider semantics remain unresolved.
- **LP13-A2:** A proposed candidate cannot modify baseline facts, findings, scenes or approval receipts.
- **LP13-A3:** Same-name resources/versions under different authorities remain distinct throughout a comparison.
- **LP13-A4:** A comparison records the exact state, policy version, conditions and unassessed paths.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP14 — Generate reviewable repair candidates
**Goal:** Suggest useful, narrow repairs rather than generic recommendations.

**Dependencies:** LP13

**Inspect/reuse:** `apps/server/src/change-review.ts`, `apps/server/src/response-plan.ts`, `apps/server/src/controls.ts`, `apps/server/src/aftermath.ts`

### Deliverables
- Reviewed repair templates and candidate tradeoff ranking for finite local controls.
- Disposable worktree/config patch output with exact baseline and artifact references.
- Expected impact, positive controls, verification and compensation for each candidate.

### Acceptance
- **LP14-A1:** At least two valid candidates or an explicit no-supported-repair result are returned for applicable scenarios.
- **LP14-A2:** Ranking records objective coverage, disruption, prerequisites and unknowns; it does not claim global optimality.
- **LP14-A3:** A patch cannot execute evidence instructions, write the operator checkout or publish a PR.
- **LP14-A4:** A stale baseline/candidate digest prevents old approval from authorizing a changed repair.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP15 — Create a local attention queue
**Goal:** Keep important case changes visible without external notification dependencies.

**Dependencies:** LP12

**Inspect/reuse:** `apps/server/src/notify.ts`, `apps/server/src/cases.ts`, `apps/web/src/workspaces/investigate/CasesWorkspace.tsx`

### Deliverables
- In-app queue for new evidence, contradictions, incomplete repairs, observer gaps and stale checks.
- Deduplication, acknowledgement, replay and bounded urgency rules.
- Optional local webhook sink for testing only.

### Acceptance
- **LP15-A1:** Repeated source retries do not create a notification storm or discard the underlying case event.
- **LP15-A2:** Acknowledging a queue item never closes a finding or case implicitly.
- **LP15-A3:** Notifications contain scoped minimized summaries and never expose another project’s details.
- **LP15-A4:** The workflow works with every remote destination disabled and no outbound notification call.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP16 — Render world hierarchy and semantic zoom
**Goal:** Make the world navigable as environments grow.

**Dependencies:** LP04, LP12

**Inspect/reuse:** `packages/scene-compiler/src/hierarchy.ts`, `apps/web/src/castle/scenePresentation.ts`, `apps/web/src/graph2d/Graph2D.tsx`, `apps/web/src/lib/state.tsx`

### Deliverables
- Searchable realm/environment/district/structure navigation with stable IDs.
- Semantic zoom and focus history shared with list/2D view.
- Current/historical/branch view labels and archived resource placement.

### Acceptance
- **LP16-A1:** Adding a service preserves unrelated coordinates; intentional reflow is previewed and versioned.
- **LP16-A2:** Removed/recreated resources resolve to their own incarnation and historical location.
- **LP16-A3:** Every aggregated district retains a complete accessible membership list and asset search.
- **LP16-A4:** WebGL loss, resize, back navigation and selection changes retain the case and evidence scope.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP17 — Build six meaningful architectural families
**Goal:** Extend the kit beyond mapping every new surface to the same ten buildings.

**Dependencies:** LP16

**Inspect/reuse:** `packages/contracts/src/surfaces.ts`, `apps/web/src/castle/modules.tsx`, `assets/castle-kit/MANIFEST.json`, `packages/scene-compiler/src/compile.ts`

### Deliverables
- DNS registry, dispatch house, key registry, supply depot, archive and outpost geometries.
- Bounds, origins, anchors, roof groups, hit proxies, LOD and asset provenance.
- Actual rendered contact sheet and mixed-world composition using supported records.

### Acceptance
- **LP17-A1:** Every family has a readable unique silhouette and in-bounds geometry at supported LOD; no placeholder cube is counted as finished art.
- **LP17-A2:** Roof-off and selection proxies work at overview and interior scales without intercepting unrelated clicks.
- **LP17-A3:** Geometry/material/manifest hashes and licenses are recorded; no user font files are distributed in handoff exports.
- **LP17-A4:** Rendered families do not imply discovery or control verification; unsupported surfaces display honest capability state.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP18 — Add evidence-linked interiors
**Goal:** Reveal useful technical detail inside the world without forcing game navigation.

**Dependencies:** LP12, LP16, LP17

**Inspect/reuse:** `apps/web/src/panels/EvidencePane.tsx`, `apps/web/src/lib/layers.ts`, `apps/web/src/castle/Castle3D.tsx`, `apps/web/src/graph2d/Graph2D.tsx`

### Deliverables
- Route, key/grant, data, tool/run, artifact and control interiors.
- Typed relationships and observed/configured/hypothetical distinctions.
- Direct evidence/obligation actions with equivalent conventional interface.

### Acceptance
- **LP18-A1:** Selecting an interior object opens the exact authoritative record and its provenance, not a generated description alone.
- **LP18-A2:** Declared doors/grants are not drawn as observed attacker transit; status is never color-only.
- **LP18-A3:** Agent decisions, executions and effects remain distinct and link to their independent evidence.
- **LP18-A4:** The same workflow and selected IDs survive 3D/2D/list switching and narrow-screen use.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP19 — Add baseline-versus-repair world comparison
**Goal:** Make consequences understandable without repainting hypotheses as facts.

**Dependencies:** LP13, LP14, LP18

**Inspect/reuse:** `packages/scene-compiler/src/compile.ts`, `apps/web/src/lib/state.tsx`, `apps/web/src/panels/Timeline.tsx`, `apps/server/src/change-review.ts`

### Deliverables
- Ghosted or side-by-side branches with common camera/layout and a change list.
- Separate model-only and executed-local results.
- Time-known/time-occurred replay with actual source/history scope.

### Acceptance
- **LP19-A1:** Creating or viewing a branch does not change baseline state or current source coverage.
- **LP19-A2:** Removed/added/changed authority is visible with exact references and unresolved conditions.
- **LP19-A3:** A simulated blocked path never appears as a verified executed control.
- **LP19-A4:** Comparison export identifies both revisions and preserves incomplete/changed evidence warnings.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP20 — Introduce run-scoped local authority leases
**Goal:** Allow bounded lab execution without weakening existing human approval semantics.

**Dependencies:** LP05, LP14

**Inspect/reuse:** `apps/server/src/response-plan.ts`, `apps/server/src/containment.ts`, `apps/server/src/verification.ts`, `apps/server/src/app.ts`

### Deliverables
- Supervisor-issued local-lab lease with run/resource/action/digest/TTL/budget restrictions.
- Distinct lab authorization namespace and default plan-only behavior.
- Preconditions, kill switch and audit transitions.

### Acceptance
- **LP20-A1:** An investigator/service token cannot issue, extend or approve its own lease.
- **LP20-A2:** Lease targets are supervisor-owned resources; forged lab metadata or a real provider ARN is refused.
- **LP20-A3:** Expired/stale/replayed approval or changed parameters cannot authorize execution.
- **LP20-A4:** A local lease never counts as human approval and cannot authorize the existing production-facing response path.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP21 — Execute typed local repairs
**Goal:** Close the action loop only inside disposable run-owned services.

**Dependencies:** LP20, LP06

**Inspect/reuse:** `apps/server/src/response-plan.ts`, `examples/reference-app/src/lab/runner.ts`, `examples/reference-app/src/pack.ts`

### Deliverables
- Allowlisted gateway policy, synthetic token/grant, local artifact and observer operations.
- Journaled state machine, idempotency, recovery reconciliation and compensation.
- Separate controller identity with no arbitrary shell/network capability.

### Acceptance
- **LP21-A1:** An approved local plan changes only the exact registered target revision and records an effect receipt.
- **LP21-A2:** Crash after application but before receipt is reconciled without applying the change twice.
- **LP21-A3:** Shell commands, arbitrary endpoints, host paths and production adapter requests are rejected.
- **LP21-A4:** Cancellation, quota, partial failure and cleanup are surfaced; original compromised authority is not restored as rollback.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP22 — Verify effects independently
**Goal:** Prove scoped outcomes rather than equating API success with defense.

**Dependencies:** LP21, LP07

**Inspect/reuse:** `apps/server/src/verification.ts`, `examples/reference-app/src/lab/runner.ts`, `examples/reference-app/src/agent/boundary.ts`, `apps/server/src/controls.ts`

### Deliverables
- Per-operation nonce/digest observations, bounded settling and repeated health checks.
- Prohibited/allowed controls, residual-access and disruption evaluation.
- Separate security verdict, execution state and cleanup outcome.

### Acceptance
- **LP22-A1:** An accepted action with unchanged target behavior fails verification.
- **LP22-A2:** Delayed and unrelated concurrent effects are correlated correctly; unavailable observer yields inconclusive.
- **LP22-A3:** Prohibited behavior blocked while legitimate behavior broken cannot be a verified repair.
- **LP22-A4:** Cleanup failure remains visible and prevents whole-run success even when the security assertion passed.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP23 — Capture a repair as a replayable regression
**Goal:** Turn a resolved local case into reusable protection knowledge.

**Dependencies:** LP22, LP19

**Inspect/reuse:** `apps/server/src/regression.ts`, `apps/server/src/cases.ts`, `apps/server/src/controls.ts`, `scenarios/dk-t`

### Deliverables
- Sanitized regression descriptor with exact prerequisites and positive/negative controls.
- Case/control/test/version linkage and stale-test propagation.
- Before/after case replay and explicit residual uncertainty.

### Acceptance
- **LP23-A1:** A regression reruns without an LLM and reproduces the supported boundary result.
- **LP23-A2:** Changing a relevant policy/tool/artifact version marks the old validation stale.
- **LP23-A3:** No secret, private oracle, arbitrary executable or unrelated record is exported in the descriptor.
- **LP23-A4:** Closing a case requires scoped answers/accepted unknowns; a failed verification cannot silently close it.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP24 — Support a bring-your-agent local investigation
**Goal:** Let the owner’s existing AI exercise the product without provisioning external services.

**Dependencies:** LP11, LP07

**Inspect/reuse:** `apps/mcp/src/main.ts`, `apps/mcp/src/server.ts`, `eval/src/v2/instance.ts`, `eval/src/v2/harness.ts`

### Deliverables
- Native-agent task prompt, scoped MCP setup and evidence-exposure recorder.
- Scripted, native-agent, local-model and approved-provider mode declarations.
- Explicit distinction between developer-assisted runs and blinded evaluation.

### Acceptance
- **LP24-A1:** A real stdio client can investigate the local world through normal authenticated endpoints.
- **LP24-A2:** No provider route is silently selected; missing model availability remains not_exercised for AI-specific checks.
- **LP24-A3:** A native coding agent with repo/oracle access is labeled development_assisted, not held-out blinded.
- **LP24-A4:** Captured traces include observable tool I/O and claims, not hidden model reasoning or tokens.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP25 — Separate private truth and admissible-evidence grading
**Goal:** Make local AI tests informative rather than self-grading theater.

**Dependencies:** LP24

**Inspect/reuse:** `eval/src/v2/preflight.ts`, `eval/src/v2/report.ts`, `eval/src/v2/exposure.ts`, `scripts/run-scenarios.ts`

### Deliverables
- Private scenario controller/oracle with no investigator-readable endpoint or filesystem mount.
- Independent expected predicates and admissibility under actual observer coverage.
- Versioned seed commitments, data-equality preflight and leakage canaries.

### Acceptance
- **LP25-A1:** Investigator attempts to read oracle paths, seed/config keys and scoring endpoints are denied and recorded.
- **LP25-A2:** Grading uses actual controlled operations/state, not the same detector/helper whose output is being tested.
- **LP25-A3:** The answer key accepts uncertainty when decisive facts are unobservable; it never demands omniscience.
- **LP25-A4:** Renaming resources or changing nuisance fields does not leak the answer or change a logically equivalent objective.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP26 — Evaluate guided versus current investigation loops
**Goal:** Measure whether the new workflow fixes missed evidence without expanding authority.

**Dependencies:** LP25, LP10

**Inspect/reuse:** `eval/src/v2/harness.ts`, `eval/src/v2/report.ts`, `eval/src/budget.ts`, `artifacts/completion/evaluation/REPORT.md`

### Deliverables
- Preregistered local-loop comparison: existing full tools, event tools and guided contract.
- Equal underlying evidence, randomized order, fresh conversations and retained failures.
- Objective metrics plus separately labeled AI semantic critique and deferred human review.

### Acceptance
- **LP26-A1:** All conditions pass evidence-access/metadata equality before attempts; invalid preflight is not a model score.
- **LP26-A2:** Missing reachable evidence counts against retrieval and end-to-end success; no outcome is inferred by subtracting automatic failures.
- **LP26-A3:** Structured task/repair predicates, semantic critique and coverage limitations use separate denominators.
- **LP26-A4:** No prior $5 budget or historical approval is reused; remote paid mode requires an explicit new route, cap and pre-reservation.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP27 — Exercise adversarial and fault variants
**Goal:** Find weaknesses using controlled changes, not broad attacks on outside systems.

**Dependencies:** LP25, LP22

**Inspect/reuse:** `scenarios/dk-t`, `eval/src/scenarios.ts`, `packages/detections/test`, `apps/server/test`

### Deliverables
- 24 new local families mapped to existing regressions without rewriting them.
- Metamorphic and mutation tests for identity, pagination, coverage, enforcement and claims.
- Budgeted noise, delayed evidence, outages and injected instructions.

### Acceptance
- **LP27-A1:** Removing a denial, skipping a required page or substituting a model refusal makes the corresponding test fail.
- **LP27-A2:** Clean/injected pairs differ only in the intended field and are compared against clean-repeat variability.
- **LP27-A3:** No scenario launches external scans, malware, arbitrary shell or real credential collection.
- **LP27-A4:** Errors, partial runs, observer outages and budget exhaustion remain in the run/accounting records.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP28 — Package evidence-only and training capsules
**Goal:** Make a local case portable and inspectable without third-party storage.

**Dependencies:** LP23, LP25

**Inspect/reuse:** `apps/server/src/export.ts`, `apps/server/src/backup.ts`, `apps/server/src/bundles.ts`, `apps/web/src/inspector/actions.tsx`

### Deliverables
- Minimized capsule manifest, evidence/scene revisions, optional synthetic regression descriptors.
- Safe archive import into a new namespace with independent integrity checks.
- Separate sealed oracle attachment only for training/evaluation packages.

### Acceptance
- **LP28-A1:** Round-trip retains exact supported evidence references and explicitly reports absent records.
- **LP28-A2:** Zip-slip, absolute paths, links, oversized entries, decompression bombs and unsupported executables are rejected before extraction.
- **LP28-A3:** Evidence-only exports exclude oracle data, tokens, secrets, provider credentials and private font files.
- **LP28-A4:** Hash/signature validation is described as integrity/origin checking, not proof of truth, completeness or independent approval.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP29 — Build a local mission and scenario composer
**Goal:** Make the local capabilities usable beyond hand-written test files.

**Dependencies:** LP07, LP18, LP28

**Inspect/reuse:** `apps/web/src/workspaces/integrations/IntegrationsWorkspace.tsx`, `apps/web/src/workspaces/investigate/CasesWorkspace.tsx`, `packages/contracts/src/surfaces.ts`

### Deliverables
- Blueprint selection, finite stimulus authoring, budget preview and run lifecycle controls.
- Mission desk for investigate/compare/verify/replay without replacing four workspaces.
- AI-assisted proposal as schema-validated data, never executable program.

### Acceptance
- **LP29-A1:** An operator creates, previews, runs and reopens a supported local mission without editing source.
- **LP29-A2:** Builder and investigator views are distinct; opening truth explicitly taints the run as non-blinded.
- **LP29-A3:** Invalid plans keep drafts and do not create partial resources or fabricated connected status.
- **LP29-A4:** Local-only operation is obvious throughout UI/MCP/export; remote setup is not a prerequisite.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP30 — Measure local robustness and visual usability
**Goal:** Avoid shipping a large feature set that collapses under ordinary use.

**Dependencies:** LP29, LP27

**Inspect/reuse:** `e2e`, `playwright.redesign.config.ts`, `scripts/bench-search.ts`, `apps/server/src/backup.ts`, `apps/web/src/castle`

### Deliverables
- Exact-candidate browser, latency, resource and recovery receipts.
- Reduced-motion/keyboard/2D parity and actual rendered module/interior/compare screens.
- Runtime-egress checks and same-environment before/after benchmarks.

### Acceptance
- **LP30-A1:** Existing tests still pass or changes have a versioned reason and retained old evidence; no weakened assertions for green CI.
- **LP30-A2:** Repeated start/reset/project/camera/case cycles are bounded under recorded conditions and failed cleanup is surfaced.
- **LP30-A3:** Real rendered screenshots and browser interactions cover new families, interiors, branches and failure states.
- **LP30-A4:** Claims stay scoped to tested hardware/software; manual screen-reader, physical GPU and external-use acceptance remain deferred.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

## LP31 — Deliver the integrated local phase
**Goal:** Finish a complete demonstrable loop with honest status and a continuation handoff.

**Dependencies:** LP30, LP26

**Inspect/reuse:** `README.md`, `docs/roadmap/STATUS.json`, `docs/quality`, `docs/RELEASE.md`

### Deliverables
- One-command local demo, agent handoff, phase ledger and capability matrix.
- Final scenario/claim/effect/repair replay with exact evidence parity across interfaces.
- Readiness separated into engineering, AI-loop, external validation and production authority.

### Acceptance
- **LP31-A1:** An end-to-end scripted run covers launch, incident, investigation, repair, verification and export on the same candidate.
- **LP31-A2:** An actually available approved AI route exercises the loop or AI status remains explicitly not_exercised without blocking truthful scripted completion.
- **LP31-A3:** All phase requirements have receipts or explicit reasons; external deferred items are never silently approved.
- **LP31-A4:** No unauthorized repository merge/deployment/provider call occurred; handoff names precise next work instead of declaring universal readiness.

**Receipt:** exact candidate, changed contracts, tests and outcomes, negative/fault cases, migration implications, screenshots when visual, and remaining limitations. No external test is required to implement this package. Model-specific checks require an actual approved route; otherwise they remain not exercised.

