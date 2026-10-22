# Frozen-candidate verification

Application and test source: `5ce7487c76c87be2b53f6520690987d2c5bdd063`. These are actual executions, not simulated outcomes. No tracked source or tests changed during this run.

- Typecheck, 376 unit tests, fixture validation and production builds passed. A fresh git archive independently passed the same source gates, and its API bundle is byte-identical to the tested API bundle.
- All 11 original controlled local SDK/ingestion pilot scenarios passed, with no skips or flakes.
- The complete redesign suite ran 78 cases: **77 passed, 1 skipped, 0 failed, 0 flaky**, in 271.097 seconds. The skip is the real second-tab experiment: headless Chromium kept both tabs visible, so hidden-tab lifecycle is not proven.
- The additional touch audit measured **240 effective targets in 14 states** at 390/320 CSS px, with no undersized targets. It includes expanded finding queues, comparison-checkbox labels and enabled raw-text pagination.
- The unchanged shell harness passed **11 controls with zero page errors** on the same frozen source using a separately labeled synthetic Vite development server, not the production bundle.
- All **77 screenshot hashes and build labels** match the candidate. The [index](SCREENSHOT_INDEX.md) covers V01–V16 plus supplemental regression images. Screenshot data are synthetic; server-backed cases are isolated local tests, not customer telemetry.

## Readability and accessibility

The replacement [V04 comparison](screenshots/V04b-contradiction-supporting-counter.png) shows both complete evidence kinds in the primary-width detail. Desktop and 320px checks confirm the seven operational card fields are at least 13 CSS px, exact sources/actions/timestamps wrap without clipping, and raw expansion preserves the selected finding. The expanded queue retains filters, record instance, draft, comparison, scroll and return focus. The 320px live/historical timeline timestamp has positive bounds and real unobstructed text hit points.

Eight actual axe-core 4.10.3 DOM scans found **zero violations**. They contain 428 passing computed-contrast checks, with a minimum observed passing ratio of 5.09:1. Five states retain color-contrast incompletes for manual follow-up. This is not a global typography audit, full WCAG certification, assistive-technology test or human design approval. The 200% image is CSS zoom emulation, not browser-chrome zoom.

## Resource and performance scope

All runs used official Playwright Chromium headless-shell 141.0.7390.37 and ANGLE/Vulkan SwiftShader. The native F01 probe observed a maximum of **119 draw calls per real animation frame**, including offscreen shadow draws, below the 250-call default-scene limit. Its instrumentation condition is separate from timing samples. Published `gl.info` counters remain main-pass-only. This does not certify the 50-asset physical-hardware requirement.

The healthy 13-asset scene retained exactly 33 nonzero shader programs and 13 registered module owners after actual rendered-frame settling, across five remounts and replay edits. Every retired canvas lost its ownership registration and native WebGL context after teardown. Garbage collection was not observed and is not claimed; current-renderer counts are not process-wide GPU memory. The warmed six-project-switch sample retained one live stream, no pending fetches and a measured heap delta of 881,368 bytes under its bounded assertion. Three event-only updates reused the same mounted canvas and stable module/GPU geometry/texture counts. Local source-to-display timing is a measured sample, not an SLA. Earlier 40-switch memory diagnostics remain separately labeled under `../diagnostics/`.

Separate geometry and shader fallback tests deliberately inject visual faults. Geometry recovery explicitly classifies its expected sanitized React/R3F error. The shader cases inject invalid GLSL into isolated body, roof and depth programs, observe native compile/link failures, and verify neutral fallback, canonical records, selection, focus and other buildings. A shared-family case verifies both affected assets, a server-accepted healthy replacement, repeated-replacement program counts of 37 → 35 → 35 without growth and released ownership/native context. The shader cases emitted no page errors in this run. These are bounded attributed-family proofs, not silent global error suppression or a certification of every driver-wide failure.

## Reproduction and integrity

[execution-receipt.json](execution-receipt.json) records all exact titles/statuses, 23 proof-source file hashes, commands, three complete bundle manifests and individual artifact hashes. [receipt-seal.json](receipt-seal.json) binds that receipt, the index, summaries and publication audit. Source and original-pilot commands are in [final-commands.log](final-commands.log); supplemental conditions are in [supplemental-commands.log](supplemental-commands.log).

Raw credential-bearing trace archives, databases, videos, ephemeral test output and working corpora stay ignored and untracked. The publication scan checks known token prefixes and is not a guarantee to detect every possible secret. Human release review, real assistive technologies, cross-browser/physical-device checks and genuine hidden-tab behavior remain outside the demonstrated result. No merge, deployment, paid evaluation or human approval was performed.
