# Digital Kingdom: Local Intelligence and Closed-Loop Defense

## Phase specification — continuation from existing main

Prepared 2026-10-23. Inspected main: `9fec7ed24dea46157af8a7c0ef09bee77c2ffa88`.

**Status:** implementation specification, not implemented functionality or completed verification. The current repository already implements important foundations. This package specifies the next increments. No application code, provider connection, model execution, merge, or deployment was performed to prepare it.

## 1. The owner’s decision

Continue Digital Kingdom; do not rebuild it. For this phase, defer customer deployments, third-party infrastructure accounts, AWS/identity-provider access, Slack/email destinations, outside-user recruitment, manual assistive-technology acceptance, and physical-hardware certification. Those are future validation tasks, not blockers to this development phase.

The owner is comfortable with AI using Digital Kingdom to exercise the investigation loop. Provide a no-provider scripted baseline, a bring-your-current-agent workflow, and an optional separately authorized model route. This instruction does not authorize a new paid provider route, repeated billable evaluation, or production action. The previous evaluation’s budget is historical, not reusable approval.

Continue unit, integration, browser, security, migration, fault, and local end-to-end testing. Deferring external validation is not permission to skip engineering verification. Local tests must exercise actual requests and effects where practical, not merely inject the records that a detector expects.

The product remains a useful investigation platform with a local laboratory attached. It must not become only an educational simulator. Every new investigation, comparison, case, world, and planning capability should operate on ordinary authorized Digital Kingdom evidence as well as local-laboratory evidence.

## 2. Product result

The phase is complete when an operator can:

1. Launch a local application world without a cloud account.
2. See its architecture and visibility in the existing castle and 2D views.
3. Trigger a controlled incident or change inside resources owned by that run.
4. Give an AI investigator only authorized observed evidence, not the scenario answer key.
5. Watch the investigator build a case, identify missing evidence, and distinguish competing explanations.
6. Compare concrete repair candidates without changing the baseline.
7. Apply a narrowly permitted repair to the disposable local world through a separate controller.
8. Independently verify the prohibited behavior and the legitimate operation.
9. Save a replayable case capsule and a regression recipe.

The signature experience is **inspect → explain → compare → repair locally → verify → replay**, with every screen linked to the same records. A flashy animation is never the pass condition.

### Product success statements

- “The agent found an important follow-on event that no rule promoted into a finding.”
- “The case remains unresolved because the relevant observer was unavailable; the UI and agent agree.”
- “The proposed repair closes the tested path while preserving the permitted operation.”
- “The castle shows which identity, route, tool, and resource are involved without inventing an attacker.”
- “The same incident can be replayed, compared to a repair branch, and run again from a sealed local recipe.”

These are targets to establish, not current claims.

## 3. Starting point: reuse rather than replace

Current main has durable ingestion, minimization before persistence, scoped source/user authority, deterministic findings, exact event search, versioned facts, historical coverage, evidence bundles, cases, recipes, a local reference pack, MCP, change/lineage analyses, a scoped policy evaluator, response plans, verification logic, and a substantially redesigned castle/interface. See `CURRENT_MAIN_BASELINE.json` for inspected paths and sources.

Extend these domains in place. `cases.ts` remains the case system. `bundles.ts` remains the evidence-reference mechanism. `coverage-history.ts` remains coverage authority. `recipes.ts` becomes more rigorous; it is not replaced by an LLM narrative engine. `response-plan.ts` and `verification.ts` remain the basis for planning and checking. The new laboratory must not bypass normal ingestion or authorize production actions.

The existing ten-module kit and four primary workspaces are assets. Add interiors, hierarchy navigation, comparisons, and actual architectural families. Do not introduce a second dashboard shell or recreate working inspectors.

### Facts that affect this phase

The held-out full-tool evaluation exposed 485/534 required event records, compared with 534/534 in the event-tool condition. This motivates retrieval and completion work. It does not establish causation or completed semantic superiority. Preserve the previous run and review state.

The existing policy result can omit restrictive-layer conditional denies from its final conditional classification. Reproduce and repair that first. Recipes also need tests around budget exhaustion, incomplete pages, source namespaces, and claims about intent. The local lab’s host allowlist and aggregate effect counter are insufficient foundations for broader agent-controlled execution; strengthen target ownership and operation-level observation before extending it.

## 4. Scope and non-goals

### In scope

- Local application blueprints and inert file imports.
- Reproducible local runtime worlds with owned targets.
- Better investigation contracts, evidence obligations, bounded query planning, and compact evidence delivery.
- Case-level claim and uncertainty tracking.
- Conditional path exploration and repair comparisons.
- Richer castle hierarchy, structural families, interiors, layers, and branch comparison.
- Native-agent and optional local/model-provider evaluation harnesses.
- Typed local-only repair execution under a run-scoped lease.
- Independent effect verification, positive controls, recovery checks, and regression capture.
- Portable, minimized case capsules and bounded scenario authoring.
- Local performance, failure, privacy, and compatibility checks.

### Explicitly deferred

- Connecting to real AWS, Azure, GCP, enterprise identity, endpoint, email, or SaaS accounts.
- Production deployment, enforcement, incident certification, or autonomous external response.
- Remote notifications or external integrations as prerequisites.
- Paid model calls without a fresh, explicit route and budget.
- Human usability/accessibility approval and physical-device certification.
- Claims of customer demand, general attack detection, agent immunity, or provider conformance based on local models.
- Team-scale database replacement or federation without a demonstrated need.

Maintain a machine-readable deferral register. Do not repeatedly halt unrelated implementation to request a deferred activity. Do not silently mark it complete either.

## 5. Feature A: the Local World Builder

### User flow

From Integrations, choose “Create local world.” Select a reviewed blueprint or import an inert descriptor. Preview resources, declared relationships, permissions, service versions, observers, limitations, and resource budgets. Confirm the disposable run scope, then start it.

The first screen should show real local application endpoints, the run identity, pause/reset/export controls, observer health, and the corresponding castle. A global badge reads “Local laboratory — synthetic people and data.” The badge is separate from transport freshness and incident severity.

### Blueprints

Ship three complete templates:

- **SaaS storefront:** ingress, auth, API, tenant database, background worker, queue, artifact store, and audit observer.
- **Agent workspace:** bounded workspace, MCP tool gateway, retrieval store, allowed/blocked receiver, runtime reports, and independent effect observer.
- **Delivery and identity:** local source manifest, build artifact depot, deployed digest, short-lived local credentials/grants, and observed use.

These are explicit reference applications, not cloud-provider replicas. Only claim provider semantics for the documented subset of imported policy data. Queue, token, and deployment behavior is defined by the local service implementation, not by pretending it is AWS.

### Blueprint contract

Use a schema-constrained plan containing stable logical IDs, allowed templates, versions/digests, bounded configuration, topology, observers, budgets, and a seed. Reject arbitrary executable code, images, commands, host mounts, remote URLs, privileged flags, and externally chosen ports. The controller allocates endpoints and private directories.

An LLM may propose a plan from the reviewed catalog. Deterministic validation and preview decide what is admissible. Never allow generated scene content to supply findings, control validation, or observed relationships.

### Discovery

Read local Compose/OpenAPI/manifest metadata through allowlisted fields without evaluating interpolations, scripts, environment files, or reusable actions. Show declaration provenance. Runtime observations become separate facts. Name equality alone is not an identity mapping.

## 6. Feature B: a safe, persistent local run controller

A run owns a unique project, service identity namespace, directories, token namespace, listener registry, policy revision, clocks, and cleanup manifest. It can start, pause supported stimulus, resume, snapshot, clone, stop, and clean up. Pausing stimulus does not pretend collector processing or wall time is frozen.

Provide a host-process mode for trusted built-in services and an optional hardened container mode. Both use synthetic records and bounded operations. Host-process mode is not an arbitrary-code sandbox and cannot host untrusted scenario programs. The application must not acquire a Docker socket; an operator-controlled launcher handles the optional container profile.

A loopback address does not prove ownership. The supervisor records the process and endpoint it created, binds a run-specific nonce/credential, and verifies the receiver handshake. Targets are passed by registered resource ID, not free-form URLs. Redirects are refused. Ports and DNS names never select arbitrary host services.

Network access for scenario activity is confined to run-owned resources. No cloud metadata, public Internet, LAN scanning, host networking, privileged containers, or home-directory mounts. A model broker, when approved, is a separate egress path that receives minimized case data and cannot relay arbitrary attacker traffic.

Default budgets bound services, memory, request count/rate, bytes, duration, concurrent runs, disk usage, and generated events. Cleanup is limited to manifest-owned resources and is idempotent. Failed cleanup remains an operational failure; do not report the complete run as healthy merely because its security assertion passed.

## 7. Feature C: a controlled stimulus engine

The stimulus engine supplies repeatable operations, benign distractors, configuration changes, and faults. It is not an exploit agent. Its DSL contains a finite action vocabulary such as request a registered route, use a synthetic token, enqueue a synthetic message, change a test grant, delay a test event, disable a test source, or publish a synthetic file to a controlled receiver.

A stimulus action should exercise an application API so that the application and independent observer generate evidence. Direct event injection is retained for parser/fault tests and must be labeled as fixture delivery rather than executed application behavior.

Maintain a deterministic scenario seed and event schedule, but use a separate monotonic wall clock for enforcement deadlines. A frozen evidence clock must never disable timeout enforcement. Record the difference between event occurrence, receipt, controller timing, and model-call duration.

Keep three stores separate:

- **Private scenario truth:** what was configured and what controlled operations actually occurred.
- **Observable evidence:** what sources successfully reported into Digital Kingdom.
- **Investigation output:** what the AI or person concluded from authorized evidence.

The investigator must not read private truth, mutation labels, held-out seeds, expected conclusions, or scenario filenames that reveal the answer. A scenario where the observer is absent should reward uncertainty even if the referee knows that an action happened.

## 8. Feature D: an Investigation Contract

The most important intelligence upgrade is a structured investigation contract, not another chat box.

A contract states the question, targets, interval, current bundle versions, allowed query budget, unresolved targets, evidence obligations, hypotheses, counterevidence obligations, and permissible conclusion predicates. It is built from a public case question, supported recipe version, and actual source capabilities—not the private scenario answer key.

### Evidence obligations

An obligation is a task such as:

- Resolve the principal inside its declared authority namespace.
- Retrieve follow-on activity in the allowed interval, including events unlinked to findings.
- Establish database-read coverage before making a negative read claim.
- Inspect counterevidence and current grant state.
- Verify that two reports come from independent origins.

States include `not_started`, `running`, `satisfied`, `partial`, `unavailable`, `inapplicable_with_reason`, and `failed`. Every transition cites queries, evidence, or capability records. There is no “everything complete” flag based solely on zero findings.

A contract can be complete for a bounded answer that is explicitly unresolved. It cannot permit a stronger conclusion than the observation supports. Uncertainty is a conclusion class, not a software crash.

## 9. Feature E: bounded evidence planning and delivery

Extend the recipe engine into a typed investigation planner. Do not expose raw SQL, arbitrary backend paths, unrestricted graph traversals, or user-supplied executable queries.

The planner selects supported pivots from available facts: identity/session/run namespace, route ownership, artifact digest, service incarnation, resource and action, interval, or control test. Network locators are not identities.

Query steps have a purpose, scope, expected data type, page status, retrieval errors, and stop conditions. A step that stops on page one or hits a budget remains partial. No coverage record obtained means unknown; it is not equivalent to a successful empty coverage evaluation.

Provide resumable jobs and bounded evidence packets. Each packet has exact IDs, provenance, roles, missing-reference status, stable bundle identity, a continuation, and its limits. Summaries can help prioritize records, but truncation never removes obligations or silently drops counterevidence.

An optional query ranking heuristic can prefer queries likely to distinguish the current hypotheses. Label this as an engineering heuristic, not a mathematically optimal policy. Use deterministic fallbacks. Never make a model the final authority for source completeness or permission scope.

### Existing recipe hardening

A success after failed logins plus any follow-on event does not prove credential guessing succeeded. An allowed call plus an effect does not prove the call was approved. Authorization and intent require their own evidence. Update hypothesis names and predicates to express the observable proposition first; leave intent unresolved without supporting records.

Test namespace scope throughout recipes and downstream helpers, not just in the detection rules. Source IDs, raw actor strings, and run IDs have different meanings.

## 10. Feature F: a focused MCP experience

Keep existing tools compatible. Add one small focused workflow instead of offering every tool at once by default:

1. Open/read an investigation contract.
2. Request the next bounded evidence step or inspect a referenced record.
3. Retrieve continuation pages.
4. Propose a structured conclusion with claim IDs, evidence, and uncertainty.
5. Prepare a repair candidate or verification request where the caller has the appropriate permission.

Persisted case edits and job creation are writes even when they do not modify monitored systems. Expose correct MCP annotations and server roles. Provide a genuinely read-only profile and a case-writing analyst-service profile. Neither can grant itself executor or approval authority.

A conclusion checker verifies ID existence, actual exposure in the attempt, scope, revision, required obligations, and supported structured predicates. It does not certify arbitrary natural-language semantics. Model-generated prose remains a draft; failed deterministic checks become visible warnings or rejection reasons.

A bring-your-agent mode prints or exports a scoped MCP configuration and a task prompt. The actual token stays in a protected local credential channel, not in a shareable capsule. Record whether the investigator had source-code, shell, or oracle access. A coding agent with repository access can provide useful development feedback but is not a blinded held-out evaluation.

## 11. Feature G: investigation workbench and local attention queue

Extend Cases inside Investigate, not a fifth competing console. Add an investigation progress panel with unresolved obligations, hypotheses, supporting/counterevidence, source sufficiency, and next bounded actions. The same IDs appear in MCP.

Show saved drafts, pending jobs, partial results, and revision conflicts. Keep important warnings visible while moving explanatory detail into accessible disclosures. An agent’s draft does not overwrite a human note or silently close a question.

Introduce a local attention queue for material case changes: new counterevidence, missing observer, changed authority, stale verification, incomplete repair, or newly retrieved decisive event. Deduplicate updates, preserve source records, and rate-limit presentation. It is not Slack/email delivery. Clicking an item opens the exact changed case revision and evidence.

A case summary should answer: what we observed; what it supports; what it does not support; what could change the conclusion; and the next meaningful action. Avoid a single opaque risk score.

## 12. Feature H: path exploration and counterfactual branches

Provide a “Why can this reach that?” workflow over the existing graph, authority snapshots, and provenance. Limit providers/actions to supported semantics and name every unresolved prerequisite. Fix the known conditional-deny classification before using its output to rank changes.

A branch clones a referenced state into a separate analysis namespace. It can compare proposed grants, routes, source configurations, artifact versions, or tool capabilities. It does not write facts into the baseline or fabricate observed traffic.

Distinguish:

- **Model-only comparison:** a declared/configured relationship changes under a supported evaluator.
- **Executed local comparison:** the candidate was instantiated in a disposable run and its behavior observed.
- **External effectiveness:** deferred until external validation.

Candidate generation uses reviewed templates. Rank finite candidates by tested objective coverage, blast radius, operational dependencies, reversibility, and residual unknowns. Return a tradeoff table rather than claiming a universally optimal fix. An unresolved path is not “closed.”

## 13. Feature I: remediation authoring

For a local gateway, tenant API, agent tool policy, or declared deployment, produce a narrow configuration/code patch in a disposable worktree. Bind it to the original source revision and artifact/configuration digest. Provide an explanation, affected resources, expected effects, verification plan, and undo/compensation plan.

Use reviewed transformations or an explicitly isolated coding agent. Do not execute instructions embedded in evidence, clone arbitrary repositories, or run dependency scripts by default. The runtime cannot write to the operator’s checkout or publish a pull request automatically.

Test both prohibited and permitted operations. A dependency or route fix that breaks all legitimate traffic is not a verified security improvement. Partial applicability stays partial. A patch can be exported as a file without connecting to GitHub.

## 14. Feature J: the operational castle

Preserve the improved stone/slate kit and current shell. Build the missing operational dimensions:

- Realm/environment/district navigation with semantic zoom.
- New geometry for the six declared families: DNS registry, dispatch house, key registry, supply depot, archive, and outpost.
- Interior views for routes, credentials/grants, data resources, tools/runs, deployments, and controls.
- Layers for declared topology, observed activity, authority, data, delivery, agents, coverage, and hypotheses.
- Side-by-side or ghosted comparison between a pinned baseline and a proposal/local verified branch.
- A case focus that highlights relevant records without rearranging the world.

Every selectable operational item resolves to an authorized record. Decorative walls and landscaping have no enforcement status. A modeled checkpoint opens a control record and test history. “No test” never looks like a validated defense.

Scene placement is deterministic and stable by logical identity. New versions/replicas do not create unrelated buildings. Historical objects are not shown as live. Unknown geometry falls back without dropping records. Important paths remain available in 2D and lists.

AI may choose approved groupings and architecture modules. It may not supply a severity, finding, verified control, or path-exploitability verdict. Geometry is not a causal model.

See `05_CASTLE_WORLD_SPEC.md` for behavior and architectural requirements.

## 15. Feature K: closed-loop repair in a disposable local world

Extend the existing plan/approval model with an explicitly separate local-lab authority path. A lab lease is not a human approval, and the standard production proposal path stays unchanged.

The operator/supervisor registers the run, resource inventory, allowed action types, exact scope, expiration, maximum actions, and safe stop conditions. The investigator can propose a plan; it cannot issue or extend its own lease. A controller accepts the plan only when parameters, run identity, policy revision, target fingerprints, and budgets match.

Initial actions are finite, local, and non-destructive: replace a local gateway policy, deactivate a synthetic test token, remove a synthetic grant, select an existing test artifact version, or restart a run-owned test observer. No generic shell, arbitrary URL, package installation, external credential rotation, or production adapter exists in this profile.

The action receipt records prepared, applied, failed, partially applied, verification pending, and final verification state separately. Use idempotency keys and state reconciliation when the controller crashes after a successful change but before saving a receipt. Do not blindly replay an operation.

This package authorizes no action now. The later agent may implement the controller and exercise ordinary local tests in its authorized disposable workspace. If the environment cannot provide the required resource isolation or explicit local lease, remain in plan-only mode and continue other work.

## 16. Feature L: independent effect verification

An observer must report specific operation IDs/nonces and resource revisions, not merely an aggregate hit count. Concurrent unrelated requests must not become evidence for the current probe. Verify observer availability at relevant boundaries and allow a bounded settling interval for delayed effects.

For each repair, inspect:

- The target state actually changed to the approved digest.
- The prohibited synthetic operation failed within the tested conditions.
- The permitted operation still succeeded.
- Relevant descendant authority is accounted for.
- Required observers were capable and reporting during the measurement interval.
- Cleanup and recovery completed, or their failure remains explicit.

The observer and product verifier are separate from the hidden scenario oracle. The observer supplies admissible evidence that a real product could consume. The private oracle is used only to grade the controlled experiment.

An action API accepting a change is not proof of an effect. A broken target returning errors is not successful enforcement. Absence of an effect under missing observation is inconclusive. A run can have a passed security assertion and failed cleanup; report both and do not call the whole run successful.

## 17. Feature M: convert the outcome into a regression

After a bounded local verification, generate a reviewed regression descriptor with synthetic inputs, expected structured predicates, scope, provenance, approved operations, and limitations. Keep private evidence and credentials out.

Future changes can rerun that descriptor. A changed contract may require a new version; never rewrite the old result. The castle can show which controls have current tests, stale tests, or failed regressions.

The regression should work without an LLM. AI can help author the descriptor, but the descriptor validates against a finite DSL and the expected predicate is reviewed against actual independently observed state.

## 18. Feature N: AI evaluation without external-environment prerequisites

There are three execution modes:

- **Scripted baseline:** no model, no provider; verifies protocol, retrieval, state, effects, and grading plumbing.
- **Bring-your-agent:** an existing coding/assistant environment drives the scoped MCP loop. Record its access and whether it was exposed to implementation or oracle data.
- **Approved model adapter:** a local model or explicitly approved remote provider with pinned configuration, token/call budgets, output limits, and data minimization.

Never silently fall back from one mode to another. A scripted run is not a model run; a local runtime run is not a cloud integration; AI semantic critique is not human review.

Preserve all original v1/v2 evaluation artifacts. New runs receive new versioned manifests and never rewrite old scores. The new plan is recorded before inspecting held-out outcomes. Known scenarios are regression tests; newly generated variants have separate seeds and answer-key access controls.

The private oracle can objectively grade synthetic task predicates. General natural-language judgment remains advisory AI-reviewed or unreviewed until later human review. This does not block engineering completion; it constrains the labels and claims.

## 19. Scoring that cannot reward ignorance

Publish separate measures for environment execution, data reachability, retrieval, evidence-valid conclusions, repair choice, local verification, collateral effects, cost, and latency. Count started attempts, timeouts, schema failures, and budgets exhausted.

A missing decisive record is a retrieval failure even if the final prose is cautious. A correct uncertainty answer under unobservable data is successful reasoning, but not proof that no incident occurred. Unavailable infrastructure is a preflight/run-infrastructure result, not a model pass or a reason to discard inconvenient started attempts.

Do not compute “accuracy” by subtracting automatic failures from the total. Structured truth predicates, admissible evidence, and subjective narrative quality are distinct. Report valid recommendations as a set where multiple repairs are acceptable. A hidden oracle must never require an investigator to assert information absent from its evidence.

## 20. Scenario breadth and mutation testing

The package specifies 24 scenario families. Reuse existing DK-T scenarios as source material while keeping new local variants separately identified. Existing externally unavailable results remain unchanged.

Variants include benign explanations, unrelated identities sharing locators, reordered/delayed evidence, missing observers, truncated pages, stronger/weaker authority, injected instructions, repeated operations, renamed topology, and controls that break legitimate work.

Use mutation tests that deliberately remove a denial, relax scope, skip a page, or substitute a model refusal for effect verification. The relevant tests must fail. Do not derive the test oracle by calling the same product helper being evaluated.

Local stimulus is bounded and non-destructive. No malware, exploit payload generation, public scanning, credential harvesting, or attack against third-party resources is needed to test these workflows.

## 21. Case capsules and scenario authoring

A capsule packages minimized records, graph/configuration revisions, scene layout, evidence references, test plans, approved local recipes, and integrity metadata. Import into a new project namespace; never overwrite a live project. Validate archive paths, sizes, nesting, digest references, and schema versions before materialization.

An evidence-only capsule does not contain the private answer key. A training capsule may contain it in an explicit separate attachment unavailable to an investigator until debrief. No provider keys, source secrets, tokens, native fonts, private screenshots, or arbitrary executables are included.

A visual scenario composer edits the finite DSL and previews operations. It does not ask an LLM to write arbitrary runtime code. Local authoring output is labeled synthetic, and a real provider name is a format descriptor, not evidence of integration.

## 22. Architecture and implementation constraints

Prefer incremental packages/interfaces over a new distributed stack. Keep current TypeScript contracts, SQLite-backed core, and shared UI/MCP domain services where they work. Add bounded job records and storage adapters only as needed.

Suggested new domain boundaries (paths are proposed, not existing):

- `packages/local-world`: blueprint validation and supported service catalog.
- `apps/server/src/investigation-contracts`: obligations, query jobs, and conclusion checks.
- `apps/server/src/lab-control`: run identity, leases, typed actions, receipts.
- `examples/reference-app`: actual owned runtime services and independent receivers.
- `eval/src/local-loop`: controller-facing driver, private oracle, score records.

Move code only when necessary; do not split everything into a new service. Shared schemas must not create circular migration imports. Preserve stable record IDs and maintain upgrade fixtures from genuine earlier versions.

Use request generation/version guards, idempotent mutation handling, bounded payloads, redaction before persistence, project/run isolation, cursor scope, and capability checks. Running inside a lab does not remove normal authorization requirements.

## 23. Acceptance and completion

The 32 work packages each have four concrete acceptance requirements. All start `not_run`. Eight milestone prompts direct the agent through dependencies. A package is not complete because the code compiles or a snapshot exists; it needs its boundary tests and a source-to-interface check where relevant.

This phase can be declared **local-loop verified for the stated scenarios and environment** when the specified gates pass. It cannot be declared production-verified, externally useful, human-approved, broadly agent-safe, or cloud-conformant on that basis.

Keep external gates in `DEFERRALS.json`. They do not block this phase’s local release. Model-based completion is additionally conditional on an actually available, approved agent route; missing model access permits the scripted engineering milestone but not an “AI-tested” label.

## 24. The final demonstration

Launch a local SaaS/agent world with ordinary permitted traffic. A controlled action uses a synthetic credential and leaves a related grant. The case includes a distracting same-address user, an unlinked read event on a later page, and a temporary database-audit outage.

The investigator receives only normal Digital Kingdom evidence. It resolves identity correctly, retrieves the later event, records the outage limitation, and proposes two bounded repairs. The castle highlights the involved route, key registry, tool annex, and archive; it does not draw an invented attacker.

A separate controller applies an allowed repair only to that run. The observer verifies the prohibited operation, checks legitimate traffic, and reports the remaining grant. The case stays unresolved until the grant is addressed or its residual risk is explicitly accepted under the correct scope. A revised local repair passes both controls. The user saves a case capsule and regression recipe.

Replay shows what was known before late evidence arrived, what changed in the repair branch, and exactly what the final verification established. No customer account, cloud connection, remote notification, or production action is necessary.
