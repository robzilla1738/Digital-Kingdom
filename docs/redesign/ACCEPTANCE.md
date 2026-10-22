# Acceptance evidence and release status

**Not release-ready.** The assessed application and test source is `5ce7487c76c87be2b53f6520690987d2c5bdd063` on `improve/ui-castle-redesign`, based on `453b2db522780361405c388f036d7874041cb005`.

The supplied 86 MUST definitions remain unchanged in [acceptance-results.json](acceptance-results.json): **69 passed, 16 blocked, 1 not run, 0 failed**. REL-08 awaits the actual remote branch/PR handoff. The separately recorded prose corrections have **10 passed gates**, including their aggregate, plus **1 blocked representative-human usability review**. These machine results do not grant human visual, assistive-technology or hardware approval. The user separately authorized integrating the necessary dependency branches and redesign into main after green checks, respecting branch protections, with the automatically triggered Pages result to be monitored. That permission does not close the blocked acceptance gates.

[work-packages.json](work-packages.json) distinguishes 11 packages with their referenced requirements verified, 11 with blocked acceptance, 1 awaiting human validation and 1 awaiting handoff. A package's passing flag applies only to its listed requirements; it never overrides the product's false `release_ready` value.

## Verified execution and artifacts

The [execution receipt](../../artifacts/redesign/final/execution-receipt.json) and [receipt seal](../../artifacts/redesign/final/receipt-seal.json) bind source/test hashes, commands, production bundle manifests and artifact hashes. All **211 distinct mapped test references** resolve to actual results: passed checks, apart from the explicitly skipped genuine hidden-tab check.

- Typecheck, **376 unit/integration tests**, fixtures, API/offline builds and an independently relinked clean-source archive passed. The clean archive API bundle is byte-identical to the tested API bundle.
- The **11 original isolated pilot scenarios** passed. Exact evidence, authority and failure assertions remain. Locator and intentional shortcut-setup changes follow the redesign; a known freshness transition settles before the unchanged containment no-op comparison.
- The complete supplemental suite ran **78 cases: 77 passed, 1 skipped, 0 failed, 0 flaky**.
- **77 actual screenshots** have verified hashes and embedded source identity. The [index](../../artifacts/redesign/final/SCREENSHOT_INDEX.md) covers V01–V16 and supplemental regressions. Design and isolated API fixtures are explicitly synthetic, not customer telemetry.
- The [touch audit](../../artifacts/redesign/final/narrow-body-filter-touch-audit.json) measured **240 effective targets in 14 nonempty states** at 320/390 CSS px, minimum 44 px, with zero undersized targets. Eleven [shell-control checks](../../artifacts/redesign/shell/controls-regression.json) also passed, on a separately labeled frozen-source Vite development server rather than the production bundle.
- Eight actual axe DOM scans found **zero violations**, with **428 passing computed-contrast checks**, minimum **5.09:1**. Incomplete checks remain for manual follow-up. This is not full WCAG or assistive-technology certification.

The [baseline receipt](../../artifacts/redesign/baseline/README.md) separately records the exact clean base, 223 tests, the unchanged 11-case pilot and seven before images.

## Corrected prose requirements

Direct tests now verify primary-area finding detail, filtered queue and return context; complete supporting/counterevidence cards with in-context raw text; bounded display of 5,000 exact evidence records and paged Events; real empty-project setup; truthful source configuration/reporting and unknown-count states; a separate announcement preference; and operational card text of at least 13 CSS px. The JSON ledger identifies exact test titles, source lines, screenshots and reports for each correction.

For **§15.3**, actual CPU geometry/model faults and native body, roof and depth GLSL compile/link failures now produce labeled neutral blocks without changing canonical evidence. Explicit material/program ownership notifies every affected module-family owner, not an arbitrary first drawing asset. A healthy replacement clears only its own failure marker and retains the same canvas. The shared-family replacement report records program samples **37 → 35 → 35** and verifies owner release on unmount.

Unit tests additionally verify mismatched/unregistered ownership rejection, deferred-callback cancellation, later-owner notification and bounded material registration. Unowned shader failures receive a distinct renderer fallback rather than fabricated asset attribution. Actual whole-WebGL context loss is tested separately, preserving selection, time and evidence. These proofs cover the shipped owned material families, not every possible asynchronous driver or hardware fault.

## Remaining release gates

The 16 blocked original criteria are:

- CASTLE-01, 02, 03, 07, 09 and 14: named human architecture, composition, roof-off, dense-label and grouped-scene review.
- A11Y-01, 02, 04, 06, 09 and 10: complete manual keyboard/screen-reader tasks, actual-background/non-text contrast, browser zoom/reflow and forced-colors usability. Narrow detail uses the permitted full-page nonmodal alternative. Headless DOM checks do not replace these tasks.
- PERF-01 and PERF-04: physical reference-device/GPU measurements and readable-evidence assessment.
- PERF-02: the genuine second-tab experiment left both tabs visible in headless Chromium. No overridden visibility property or simulated hidden-state pass was accepted.
- REL-04: human visual-regression review. Existing PNGs or agent pixel critique do not constitute approval.

Representative-human formative usability under specification 1.3/29.5 also remains blocked. REL-08 awaits an actual reviewable remote branch/PR delivery receipt. Authorized integration and the automatically triggered Pages outcome must be recorded separately; neither is established by this test receipt.

## Measurement and capability boundaries

All browser runs used Chromium 141.0.7390.37 with ANGLE/Vulkan **SwiftShader**, not a physical GPU. The separate [native-GL F01 probe](../../artifacts/redesign/final/native-draw-budget.json) counted at most **119 main-plus-shadow draw calls** per real animation frame, below the default-scene target of 250. Instrumentation adds overhead and is not an FPS benchmark. Application `gl.info` counters exclude shadow passes; this separate probe does not establish the 50-asset physical-device budget.

PERF-03 passes only bounded observable lifecycle checks. Across five actual remounts and replay, new-renderer counts remained **57 geometries, 2 textures, 33 programs, 13 live module owners and 10 module builds**. All five previous native contexts were lost, their canvases disconnected and their owner registrations removed. **None of those context/canvas WeakRefs was observed collected.** The separate warmed six-project-switch run had flat measured **2,544 DOM nodes and 2,965 listeners**, one active stream and no pending fetches; collected JavaScript heap increased **881,368 bytes** within the bounded threshold. Native driver allocations were not measured. This is not a no-growth, process-wide/GPU-memory zero-leak or unlimited-duration certification.

Local source-to-display instrumentation separates ingestion, normalization, HTTP/SSE, DOM observation and renderer timing. It is not a production SLA or external source-network benchmark. The 200% capture uses CSS zoom emulation, not browser-chrome zoom.

The existing backend cannot provide arbitrary historical evidence revisions, historical topology/source administration or optimistic mutation concurrency. The UI discloses these limits. A finding-level source filter is unavailable without authoritative source associations; supported Events filtering remains explicit. Saved layouts retain approved coordinates and warn about enlarged-footprint collisions rather than silently reflowing buildings.

## Prior failures and publication

Candidate `3e0a0f0c6423b6b3645c0397f30b59d617edb8c8` passed its automated suites but failed actual §9.1/9.4 presentation requirements. Its [rejected-candidate receipt](../../artifacts/redesign/prior-candidates/3e0a0f0/README.md) is preserved. Candidate `66ce8f347fe60bba34b87e7d1b089183e78643cb` passed its 73 supplemental cases but lacked attributable shader-failure recovery; its [superseded-candidate receipt](../../artifacts/redesign/prior-candidates/66ce8f3/README.md) preserves that implementation failure separately from successful automation. Neither prior candidate's screenshots or tests were relabeled as corrected proof. The current assessment uses a complete new-source rerun.

The [publication audit](../../artifacts/redesign/artifact-safety-audit.json) found no known credential-prefix findings or publication-boundary violations. Raw traces and other excluded files remain ignored and untracked; the scan is not a guarantee to detect every secret. Protected backend, MCP, evidence-engine and frozen evaluation trees match the baseline. This verification receipt records no paid evaluation, merge, deployment or human approval. The separately authorized integration and Pages outcome require their own actual delivery records.
