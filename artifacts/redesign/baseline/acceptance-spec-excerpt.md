## 28. Acceptance and regression specification

Every row below is a required acceptance condition. `acceptance_criteria.json` contains the machine-readable register; all tests begin as **not run**. Existing tests may satisfy a condition only after the implementation agent identifies the exact test and reruns it on the final candidate.

| ID | Scenario | Expected result | Verification |
|---|---|---|---|
| SEM-01 | Blocked request from one source | Label source-reported block; no claim of prevented backend access or compromise. | UI semantic fixture and text assertion |
| SEM-02 | Successful ordinary operation | Show operation success without attacker or compromise language. | Event/finding fixture |
| SEM-03 | Two conflicting sources | Expose both supporting and counterevidence; do not declare a winner. | Finding detail browser test |
| SEM-04 | Low-severity observed effect and critical attempted finding | Urgency is based on actual severity, not outcome rank. | Selector unit test and screenshot |
| SEM-05 | No findings with no source coverage | Show unknown visibility, not secure or all-clear. | Empty-state test |
| SEM-06 | Same IP across unrelated actors | Do not draw an identity/causal path; show network-not-identity limitation. | Correlation fixture |
| SEM-07 | Approved proposal | Display approved proposal and no action executed; no remediation success animation. | API and browser test |
| SEM-08 | Query/bundle completeness differs from coverage | Render separate indicators and counts with independent explanations. | Contract fixture |
| SEM-09 | Source-reporting marker | Use Reporting, not asset secure; preserve actual source state. | Copy assertion |
| SEM-10 | Overlapping findings affect multiple assets | Project counts use distinct IDs and state their scope. | Selector unit test |
| NAV-01 | Open old hash deep link | Resolve same project, selection, view, time and basis or explicit unavailable state. | Navigation browser test |
| NAV-02 | Switch Castle to Graph and back | Keep selection, interval, applicable filters and camera return context. | Browser parity test |
| NAV-03 | Select finding then focus | Selection opens detail; explicit focus moves camera once. | Interaction test |
| NAV-04 | Open inspector at 1280px | Panels adapt without clipping detail or collapsing the canvas below useful width. | Responsive screenshot |
| NAV-05 | Back/Forward through selections | Restore deliberate navigation state, not scrub-step spam. | Browser history test |
| NAV-06 | Change project while a request is pending | Previous response is canceled/discarded and never displayed in new project. | Delayed-response browser test |
| NAV-07 | Search local navigation | Find asset/finding by authorized metadata; no paid model call or event query implied. | Network and UI test |
| NAV-08 | Filtered selected object | Preserve access to selection and show its filtered-out status explicitly. | Browser test |
| INV-01 | Old finding outside snapshot window | Fetch exact referenced records and disclose pagination/missing records. | API-backed browser test |
| INV-02 | Evidence page fails after prior pages loaded | Retain loaded records; aggregate state is incomplete with retry/error. | Failure-injection browser test |
| INV-03 | Finding changes during reading | Keep current revision explicit and offer deliberate refresh. | Revision fixture |
| INV-04 | Relevant event has no finding | Event search retrieves it; detail says no finding references it. | Search browser/MCP parity test |
| INV-05 | Search page snapshot with late arrivals | No skipped/duplicated rows; show newer data notice without mutating pinned pages. | API integration plus UI test |
| INV-06 | Change a filter after pagination | Discard cursor and require a new scoped search. | Browser test |
| INV-07 | Zero stored matches | Show scoped empty result and visibility caveat, not activity absence. | Text assertion |
| INV-08 | Rapid A then B selection with slow A response | No A evidence appears in B detail. | Race-condition browser test |
| INV-09 | Raw event contains HTML and instructions | Render inert plain text; no execution or automatic action. | Security browser test |
| INV-10 | Viewer opens analyst action | No unauthorized mutation; control is absent/disabled with explanation. | Role-matrix test |
| COV-01 | One healthy and one unhealthy covering source | Asset shows Partial visibility in castle, graph, list and detail. | Shared-selector and browser parity |
| COV-02 | Source administratively disabled after recent telemetry | No reporting/healthy presentation; correct disabled explanation. | API-backed fixture |
| COV-03 | Asset with no source | Unobserved distinct from source offline and transport disconnected. | Coverage fixture |
| COV-04 | Historical event query | Current coverage basis/as-of visible; historical coverage explicitly unassessed. | Contract/UI assertion |
| COV-05 | Coverage source and asset counts | Different units separated; no combined unlabeled total. | Summary test |
| COV-06 | Unavailable coverage request | Unknown/unassessed, not zero gaps. | Failure-injection test |
| TIME-01 | Switch occurred to known-at basis | Use tested cutoff semantics and explicit timestamps; no future evidence leakage. | Temporal fixture |
| TIME-02 | Replay with unavailable historic topology | Show actual graph revision and limitation. | Replay browser test |
| TIME-03 | Current analyst note during historical replay | Mark as current annotation or exclude; never imply it existed then. | Replay assertion |
| TIME-04 | Reach replay end | Stop at final time; user chooses Return live. | Clock-controlled browser test |
| TIME-05 | SSE reconnect while snapshot still fails | Stay Synchronizing/stale until successful snapshot application. | Reconnect test |
| TIME-06 | New events while review is paused | Buffer notices; preserve row order, playhead and selection. | Live-arrival test |
| CASTLE-01 | Ten module turntable/orthographic views | Each has a distinct silhouette and consistent scale/material language. | Reviewed module-sheet screenshots |
| CASTLE-02 | Gatehouse near view | Recessed real arch, wall thickness and roof overhang read clearly. | Visual review |
| CASTLE-03 | 13-asset overview | Coherent courtyard composition; architecture occupies usable canvas without clipped labels. | 1440×900 screenshot |
| CASTLE-04 | Procedural rebuild with same inputs | Identical placement/decoration for same seed and versions. | Determinism test |
| CASTLE-05 | One new event | Update status overlays without rebuilding or moving architecture. | Instrumentation assertion |
| CASTLE-06 | One new asset | Preserve existing placements where possible; no automatic full reflow. | Compiler test |
| CASTLE-07 | Module bounds and roof-off state | No collision, out-of-bounds overhang or invented child assets. | Geometry checks and screenshots |
| CASTLE-08 | Click decorative wall/window | Decoration ignored or maps to parent asset; no phantom asset IDs. | Picking test |
| CASTLE-09 | Selected label amid dense scene | Selected name remains readable; other labels collision-managed without flicker. | Projected-bound assertion and visual review |
| CASTLE-10 | Declared versus observed versus hypothetical relation | Different patterns and explicit labels; hypothetical off by default. | Layer screenshot/test |
| CASTLE-11 | Unlinked timeline events | Highlight individual records without animated causal trail. | Semantic fixture |
| CASTLE-12 | Manual camera interaction during focus animation | Cancel tween and respect user input; no snap-back. | Interaction browser test |
| CASTLE-13 | WebGL loss | Fallback to Graph retains selection/time/evidence; no silent demo substitution. | Context-loss test |
| CASTLE-14 | 200 assets | Use explicit grouping with member access; preserve every authorized asset in search/list. | Scale fixture and grouped-scene review |
| A11Y-01 | Keyboard-only finding investigation | Complete selection, evidence, counterevidence, filters and return without canvas manipulation. | Manual keyboard task |
| A11Y-02 | Modal inspector on narrow screen | Focus contained, Escape works, focus restored to invoker. | Browser + screen-reader check |
| A11Y-03 | Desktop inspector | No focus trap; region label and headings are usable. | Accessibility-tree check |
| A11Y-04 | Text and meaningful controls | Meet required contrast on actual backgrounds, not token samples alone. | Automated and manual contrast check |
| A11Y-05 | Reduced motion enabled | No automatic camera/ambient/pulse motion; full information remains. | Motion media-query test |
| A11Y-06 | 200% zoom and 320 CSS px width | Operational text/controls reflow; no page-level horizontal clipping. | Zoom/reflow review |
| A11Y-07 | Touch input | Primary touch targets at least 44px by product requirement. | Bounding-box assertion |
| A11Y-08 | Typing and dialogs with shortcuts enabled | Do not intercept editing/native/browser shortcuts. | Keyboard test |
| A11Y-09 | Screen reader with live telemetry | Announce useful state changes, not every event or entire evidence pane. | Manual screen-reader task |
| A11Y-10 | Forced colors and 2D/list path | Focus, selection and state remain identifiable without color alone. | Forced-colors screenshot/task |
| PERF-01 | 13 assets on recorded reference laptop | Meet declared medium-quality frame/latency targets or document an approved exception. | Real-device benchmark |
| PERF-02 | Idle/hidden page | No continuous decorative rendering; background work bounded. | Performance trace |
| PERF-03 | Repeated project/view switches | No monotonic retained GPU-resource/listener/request growth. | Resource-lifetime test |
| PERF-04 | 50-asset scene | Apply LOD/label/shadow budgets while maintaining readable evidence. | Benchmark and screenshot |
| PERF-05 | Poor graphics performance | Quality reduces decoration first with hysteresis; evidence not removed. | Quality-controller test |
| PERF-06 | Network/backend latency | Report separately from renderer latency; no fabricated real-time SLA. | Measurement report |
| SEC-01 | Attacker-controlled name/evidence | No raw HTML, JavaScript execution, external fetch or layout-plan code execution. | Security fixture and network interception |
| SEC-02 | Logout/permission revocation | Clear sensitive caches and stop outstanding requests/streams. | Authorization browser test |
| SEC-03 | Cross-project deep link | Reauthorize; no cached record disclosure. | Multi-project browser test |
| SEC-04 | Share link | No token/evidence/sensitive filter in default link; explicit privacy preview when needed. | Link serialization tests |
| SEC-05 | No external resource setup | No unsolicited font/texture/analytics/model requests. | Network allowlist test |
| SEC-06 | Real backend unavailable | Explicit error/stale state; never silently replace with synthetic demo. | Offline/live boundary test |
| SEC-07 | AI layout proposal references invented asset/code | Validation rejects it; deterministic renderer remains functional. | Contract regression |
| SEC-08 | Export | Scope/redaction/completeness shown and actual backend permissions preserved. | Export browser/API test |
| REL-01 | Baseline capture | Record exact HEAD, dependencies and current screenshots before changes. | Handoff evidence review |
| REL-02 | Existing tests | Preserve behavioral checks; document any justified changed expectations. | Full CI |
| REL-03 | Final candidate | Typecheck, unit/integration, fixture validation, build and browser pilot run against exact head. | CI logs |
| REL-04 | Visual snapshots | Freeze controllable time/seed/animation; review baselines rather than auto-approve diffs. | Visual QA receipt |
| REL-05 | Frozen evaluation directories | Git trees unchanged unless separately authorized. | Git tree comparison |
| REL-06 | Asset supply chain | License/source/hash/editable source documented for every shipped asset. | Manifest audit |
| REL-07 | Capability inventory | No dead nav, fake metrics, simulated production records or unsupported enabled controls. | Manual capability audit |
| REL-08 | Delivery | PR contains screenshots, actual checks, measured limits and rollback; no deployment/merge implied. | PR review |

A release fails if a MUST condition is failed or silently skipped. A blocked check is not a pass; document the blocker, impact, and owner decision. Human visual/usability review must name its actual reviewer and scope.

---

## 29. Visual QA, usability, and release evidence

### 29.1 Dedicated redesign fixtures

Create new synthetic UI fixtures under a dedicated design/test location, not by editing frozen evaluation cases. Use a fixed clock and deterministic seed. Include:

| Fixture | Purpose |
|---|---|
| F01 — 13-asset architectural reference | Default overview, ten module types represented through valid asset mappings. |
| F02 — Blocked request | Source-reported block, no effect evidence. |
| F03 — Contradiction | Block report plus independent effect, both visible. |
| F04 — Partial coverage | One reporting source and one disabled/stale source for the same asset. |
| F05 — Unobserved asset | No configured source; no findings. |
| F06 — Event without finding | Relevant stored data-access event reachable through search only. |
| F07 — Shared address | Unrelated actors share an IP; no identity edge. |
| F08 — Incomplete bundle | Missing record, page failure, and explicit references. |
| F09 — Late arrival | Occurrence and receipt times differ; both replay bases tested. |
| F10 — Disconnected backend | Last successful snapshot retained visibly stale; auth failure variant clears data. |
| F11 — Long/untrusted labels | Long names, Unicode, escaped HTML, instruction-like text, no execution. |
| F12 — 50 assets / F13 — 200 assets | Labels, grouping, camera fit and performance targets. |
| F14 — Empty project | Inventory/source onboarding and honest zero states. |
| F15 — Read-only user | No unauthorized action path; same evidence available within scope. |
| F16 — Proposal approved | Confirmation that approval changed no monitored system. |

Fixture counts are deliberately separate from the current production or evaluation datasets. They must be labeled synthetic in every screenshot and exported test record.

### 29.2 Required screenshot set

At minimum capture these final states at the stated viewport. Use the same baseline viewport, fonts, fixed clock, seed, and quality tier for comparison.

| Shot | Required content |
|---|---|
| V01 | 1440×900 Kingdom overview, inspector closed, F01. |
| V02 | Same viewport, selected high-priority finding with inspector. |
| V03 | Same selection in 2D Graph. |
| V04 | Expanded finding with supporting and counterevidence, F03. |
| V05 | Event-search results with pinned snapshot and current coverage. |
| V06 | Event detail with no referencing finding, F06. |
| V07 | Coverage page with partial/unobserved states. |
| V08 | 3D overview with coverage hatching and selected label. |
| V09 | Module comparison sheet: all ten IDs, same light/camera scale. |
| V10 | Close gatehouse, hall, vault, observatory, and roof-off detail. |
| V11 | Replay with late event and explicit time basis. |
| V12 | Stale/disconnected state; data not portrayed as live. |
| V13 | Evidence-load error with partial records retained. |
| V14 | 1366×768 layout; 1024px layout; 390px mobile detail. |
| V15 | Reduced-motion and high-contrast/forced-colors equivalents. |
| V16 | 50-asset overview and 200-asset grouped state. |

Screenshots demonstrate appearance and particular states; they do not prove every workflow. Attach test results and interaction evidence separately.

### 29.3 Screenshot automation

Use Playwright screenshot assertions with a pinned test environment; rendering can vary by OS/browser/hardware. [S11] Freeze controllable animations, clocks, and randomness. Mask only genuinely nondeterministic metadata such as build duration, never evidence text, missing-record warnings, labels, or the entire castle.

The first new baseline requires review. Do not call a changed screenshot correct merely because an agent updated it. Set appropriate pixel tolerances only after understanding renderer noise. Pair 3D images with scene/DOM assertions: real WebGL context, expected module count, selected asset ID, visible label bounds, and a nonblank frame. Falling back to 2D must not count as a passing 3D render test.

### 29.4 Visual review scorecard

A person should review each category as acceptable / needs work / blocked, with notes rather than an unearned numerical polish score:

- Hierarchy: the selected claim, evidence state, and uncertainty are easy to find.
- Calmness: unselected architecture and ordinary activity do not compete with attention markers.
- Castle quality: ten distinctive silhouettes, coherent construction, useful negative space, readable material/light separation.
- Labels: no important overlap, clipped names, unreadable backing, or flicker.
- Spatial meaning: a viewer cannot easily mistake decorative geometry for an observed path or active control.
- Workflow: keyboard and pointer selection lead to the same record; camera motion is deliberate.
- Failure honesty: incomplete/stale/unknown states remain obvious and accurate.
- Consistency: typography, surfaces, buttons, icons, and spacing use the shared system.

An agent may perform automated checks and give a design critique, but that is not a completed human review. Record which reviews are still pending.

### 29.5 Usability pilot

Use five representative participants for formative feedback where available: at least two developers, one platform engineer, and one person less familiar with security vocabulary. Synthetic tasks only. Observe without explaining the castle metaphor in advance beyond the product's own introduction.

Tasks: identify a high-severity finding; explain blocked versus observed effect; find counterevidence; locate an unlinked event; recognize partial coverage; return from replay to live; copy a safe reference; explain why an approved proposal did not execute. Record errors, task time, navigation path, and the participant's explanation of uncertainty.

Compare to the baseline where feasible with alternating task order. Do not pool model-evaluation scores with human usability results. If 3D is slower for detailed evidence work, retain it as orientation and make the conventional investigation view the clear next step.

### 29.6 Release evidence bundle

Deliver exact commit, full CI results, synthetic fixture definitions, screenshots, accessibility check notes, performance traces/device details, network allowlist report, asset-license manifest, before/after design rationale, known limitations, and rollback instructions. A failed or unexecuted check remains clearly labeled. Do not convert “not tested” into “not applicable” to obtain a clean checklist.

---

## 30. Implementation-agent operating contract

### 30.1 Initial actions

Read the selected branch and confirm which investigation fixes are present. Record actual HEAD and package versions. Run the existing typecheck/test/fixture/build pipeline before changing behavior. Capture baseline screenshots using the existing browser pilot or an isolated local setup. Confirm that live mode and synthetic demo are visually distinct.

Do not start by replacing the app with a new template. First identify the current state/data boundaries, evidence fetch behavior, source synchronization, replay semantics, module catalog, and protected evaluation directories.

### 30.2 Work ordering

Implement the design-system and shared state contracts first. Build one complete journey—finding list → selected asset → evidence → counterevidence → 2D parity—before polishing every screen. In parallel, improve three representative modules (gatehouse, hall, observatory), review them together, then extend the shared construction/material vocabulary to the other seven.

Only after module quality is coherent should the agent integrate the full courtyard layout, labels, and performance controls. Otherwise, a polished camera merely hides inconsistent geometry.

### 30.3 Evidence of completion

For every package, report changed files, behavior, actual checks run, checks not run, screenshots, and remaining limitations. Use test results from the actual candidate, not a previous branch or a recalled count. Preserve honest “pending” state for human review and hardware benchmarks.

No feature is complete until loading, empty, permission-denied, partial, error, stale, and reduced-motion variants have been considered where applicable. No button may be left as a dead placeholder in the delivered UI.

### 30.4 Prohibited shortcuts

Do not remove limitations or counterevidence to reduce visual clutter. Do not hardcode fixture data into live components. Do not use client-side authorization as the only boundary. Do not hide test failures with snapshot updates, broad catch blocks, relaxed schemas, or skipped tests. Do not rewrite historical evaluation results.

Do not call all sources “healthy” because the transport is connected. Do not make the castle “under attack” solely because requests exist. Do not convert a third-party dependency into a fully mapped interior. Do not load external models/textures or paid model services to finish the artwork without approval.

### 30.5 Review gates, not promises of perfection

The implementation can be excellent within a declared scope while still having known limits. Final reporting should say exactly what was built and verified. It must not claim perfect security, total visibility, guaranteed real time, general prompt-injection immunity, or production certification.

### 30.6 Suggested implementation PR title

`Redesign Digital Kingdom: evidence-first workflows and architectural castle`

The PR should remain separate from automatic deployment/merge operations. Include a rollback path that restores the prior renderer without reverting security fixes or changing stored records.

---

## 31. Canonical scenario and screen walkthrough
