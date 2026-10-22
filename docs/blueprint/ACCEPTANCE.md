# Acceptance and release test plan

**All performance numbers below are proposed targets. No product benchmark is claimed.**

## A. Evidence and correlation

| ID | Test | Required result |
|---|---|---|
| E01 | Same event delivered three times | One normalized logical record/finding; delivery attempts remain diagnosable |
| E02 | Two legitimate requests with identical coarse fields | They remain distinct when source event IDs differ |
| E03 | Failed logins followed by unrelated successful login from shared NAT | No asserted causal chain from IP alone |
| E04 | Public caller supplies forged trace header | Mark external context untrusted; preserve a separate trusted boundary identity |
| E05 | WAF rejects a suspicious request | Label reported attempt and blocked outcome, not compromise |
| E06 | Successful HTTP response with no effect telemetry | Do not claim exploit success |
| E07 | Missing data-access log permissions | Explicit not-assessed gap, never a clean-data verdict |
| E08 | Source says blocked; independent observer sees effect | Flag contradiction with both source references |
| E09 | Delayed event changes an incident | Preserve revision and receive time; do not silently rewrite history |
| E10 | Asset removed after incident | Historical replay uses historical asset identity and topology |
| E11 | Resource renamed/redeployed | Stable logical room, new instance/deployment metadata |
| E12 | Decoy token used | Confirm token event; do not infer human identity or unique initial intrusion point |

## B. Pipeline and operations

| ID | Test | Required result |
|---|---|---|
| O01 | API restarts after durable acceptance | Accepted event reprocesses idempotently |
| O02 | Worker crashes during finding creation | Transaction/checkpoint recovery avoids partial inconsistent state |
| O03 | Collector loses destination for supported buffer interval | Queued data resumes; lag and queue size remain visible |
| O04 | Queue exceeds retention/capacity | Explicit counts/gap and operator alert; no false guarantee of completeness |
| O05 | Disk full | Stop acknowledging non-durable input; health degrades; preserve prior evidence |
| O06 | Browser disconnect/reconnect | Resume by cursor or refetch bounded snapshot; no phantom fresh activity |
| O07 | One-minute 1,000-event/s burst | Bounded buffering at reference settings; no unbounded memory growth |
| O08 | Sustained 100-event/s workload | Proposed p95 durable-acceptance-to-availability under two seconds |
| O09 | Multi-hour soak | No accumulating resource leak; quotas and retention act as documented |
| O10 | Clean-host restore | Metadata, source keys procedure, evidence references, and replay restored |
| O11 | Schema upgrade and rollback plan | Migration tested on saved fixtures; unsupported rollback stated clearly |
| O12 | Loss of health channel | Independent deployment monitoring identifies unhealthy console |

## C. Security

| ID | Test | Required result |
|---|---|---|
| S01 | Anonymous access to map/evidence | Denied outside isolated demo mode |
| S02 | Viewer changes connector or exports restricted originals | Denied by backend, not just UI |
| S03 | Source asserts another project's ID | Source-bound identity rejects it |
| S04 | HTML/script payload in labels/logs | Displayed as text; no executable content |
| S05 | Connector instructed to fetch metadata service/internal arbitrary URL | Rejected by policy; redirects and DNS changes covered |
| S06 | External URI or huge texture in imported asset | Rejected before rendering |
| S07 | Malicious nested/compressed event | Resource and parser limits enforced |
| S08 | Request contains bearer token/customer data | Default minimization prevents forbidden storage/export |
| S09 | Prompt injection inside event data | Narrator cannot gain tools or alter evidence; output remains a draft |
| S10 | LLM returns invented assets/security state | Scene proposal rejected |
| S11 | AI provider outage/limit | Core map, detection, replay, and default scene continue |
| S12 | Evidence file altered after export | Validation reports mismatch relative to the trusted manifest |
| S13 | Compromised source emits fabricated signed event | Origin can be verified; truth is not assumed; contradiction workflow works |
| S14 | Demo event attempts to enter production project | Segregated at source authentication/configuration boundary |
| S15 | Dependency/release compromise scenario | Provenance verification process, revocation notice, and update procedure rehearsed |

## D. Scene and user experience

| ID | Test | Required result |
|---|---|---|
| V01 | Same graph/seed/compiler/catalog | Same canonical scene coordinates and membership |
| V02 | One service added | Existing unrelated pinned rooms do not move |
| V03 | Hundreds of replicas restart | No room explosion or identity churn |
| V04 | Long/hostile asset names | Safe, readable labels; full name accessible in pane |
| V05 | Asset/finding selected in 3D then 2D | Same underlying selection and filters |
| V06 | Graphics context unavailable | Useful 2D/timeline experience persists |
| V07 | Sensor silent | Hatched/unknown coverage state, not safe/green |
| V08 | Reduced motion and keyboard use | All evidence tasks remain available |
| V09 | Active reference scene at 1080p | Proposed 30-FPS minimum on named reference hardware |
| V10 | 20-Mbps load test | Proposed first interaction within five seconds with critical assets <=6 MB |
| V11 | Hypothetical path alongside observed flow | Distinguishable by pattern, label, and evidence status, not just color |
| V12 | Room/path selection | Correct stable IDs; no mismatch between mesh and evidence |

## E. Live integration validation

Directly posting synthetic JSON proves only parser/renderer behavior. Maintain both synthetic replay tests and local end-to-end tests. In the latter, perform approved benign or controlled security-relevant actions against an isolated sample app and verify collection, authentication, mapping, normalization, findings, and display.

Never expose deliberately vulnerable test services to the public internet. Default the test network to local/internal access with explicit fixtures and synthetic credentials. Keep the tool's intended defenses observable without requiring weaponized exploit chains.

The agent test should include a permitted tool operation, denied operation, model refusal without attempted execution, and an independently observed harmless write or network request to a controlled sink. Do not infer enforcement from the model's natural-language answer.

## F. Human evaluation

Recruit 8–12 initial participants across developer/platform/security roles. Use the same data in 3D and 2D, alternate ordering, and ask three tasks: identify the impacted asset; distinguish blocked attempt from observed effect; identify an evidence gap. Record completion time, errors, unsupported conclusions, and confidence. Treat the result as formative, not proof of broad effectiveness.

## Release labels

**Demo:** synthetic source-to-screen experience; no production claims.
**Alpha:** supported live sources, known limitations, private pilots only.
**Beta:** security, resilience, permissions, recovery, and measurement gates passed for the declared scope.
**1.0:** documented supported configurations, maintainers, migrations, disclosure process, regression corpus, and operational support policy.
