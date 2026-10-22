# Redesign verification evidence

Frozen application candidate: `5ce7487c76c87be2b53f6520690987d2c5bdd063`. Actual verification passed 376 unit tests, all 11 original pilot scenarios, and 77 supplemental browser cases with one genuine hidden-tab skip. The [execution receipt](final/execution-receipt.json) binds exact test-source hashes, three bundle manifests, commands and results. The [final summary](final/README.md) separates passed automation from remaining human, accessibility, browser and hardware gates.

Two superseded candidates are preserved rather than silently replaced. [3e0a0f0](prior-candidates/3e0a0f0/README.md) passed its automation but failed the expanded-finding presentation requirements. [66ce8f3](prior-candidates/66ce8f3/README.md) passed its automation but still lacked attributable shader compile-failure isolation. The current candidate adds actual native body, roof and depth compiler-fault recovery, shared-family replacement and program/owner lifetime proofs.

- [Baseline receipt](baseline/README.md): exact clean commit, actual before images, command results and isolated original pilot.
- [Final screenshot index](final/SCREENSHOT_INDEX.md): required V01–V16 views, exact filenames, viewport, synthetic fixture and data-source labels.
- [Final browser results](final/results.json): full supplemental browser suite, generated from actual test execution.
- [DOM accessibility](final/axe-dom-results.json): actual axe-core 4.10.3 scan results, incomplete checks and computed contrast observations.
- [Shader recovery](final/module-shader-body-failure.json): native compiler failures, neutral fallback and canonical-record continuity, with roof/depth/family receipts alongside it.
- [Resource lifetime](final/resource-lifetime.json) and [software-renderer measurements](final/software-performance.json): observed counters, explicitly not a hardware-performance certification.
- [Publication audit](artifact-safety-audit.json): known-token-prefix scan and local-only archive inventory. Never a claim to detect every possible secret.

## Evidence classes

The before/after design corpus is explicitly synthetic. It does not demonstrate discovery of real infrastructure or successful production integration. The final server-backed redesign cases use a fresh memory database, canonical synthetic seed, local API/SSE and deliberate response/network faults. They exercise actual application paths but are not live-customer evidence. The original isolated pilot remains separately labeled: it exercises the repository's real SDK/ingestion path against controlled local reference applications.

All browser images are real Chromium captures, not mockups. The browser is Playwright 1.56.1's official Chromium headless-shell 141.0.7390.37 with ANGLE/Vulkan SwiftShader. There is no real-GPU, physical-device, cross-browser or human-approval claim. The gl.info draw-call and triangle counters describe the main pass only, excluding shadow passes. A separate [native F01 draw-call probe](final/native-draw-budget.json) wraps actual WebGL draw methods and groups them by real animation frame, including offscreen shadow draws, to check the default 13-asset combined-frame budget. That instrumented condition is separate from load/FPS measurements and does not establish the 50-asset physical-hardware performance requirement. The real second-tab experiment did not change document.hidden in this headless browser, so hidden-tab suspension remains an explicit skipped gate rather than a simulated pass. Browser-chrome zoom is unavailable in this headless run; the 200% frame is explicitly CSS zoom emulation. Automated accessibility cannot certify all canvas meaning, screen-reader experience or full WCAG conformance. Axe incomplete checks are retained rather than silently promoted to passes.

## Reproduction

Install the pinned workspace dependencies and Playwright Chromium headless-shell. Stamp both builds with `VITE_DK_BUILD=<full-source-candidate-sha>`. Run the ordinary production build for the API-backed server. Build a separate immutable synthetic bundle from `apps/web` using `VITE_DK_STATIC_DEMO=1` and an explicit `--outDir` under `artifacts/redesign/offline-dist`. Set `DK_RED_OFFLINE_DIST` to that directory when running `node node_modules/@playwright/test/cli.js test -c playwright.redesign.config.ts`. Both browser and its local servers must execute in the same process/worker namespace in this VM. The harness uses no external data service.

Run the additional narrow-control audit with `DK_RED_OFFLINE_DIST=artifacts/redesign/offline-dist node --import tsx artifacts/redesign/reproduction/check-touch-bounds.ts`. It covers expanded finding queue controls and opened raw-text pagination as well as filters and compact inspector bodies. Run `python3 artifacts/redesign/reproduction/audit-artifact-publication.py` before staging evidence.

After a successful full capture, run `node scripts/redesign-artifact-index.mjs <source-candidate-sha>` to verify the exact embedded candidate build, all PNG hashes and V01–V16 coverage and regenerate the index. Screenshot metadata records the exact viewport, browser version, capture time, fixture, build label and PNG hash. The baseline capture recipe is in `baseline/reproduction/`.

## Publication hygiene

Publish source, synthetic screenshots, sanitized text logs/results and metadata only. Raw ZIP traces, HAR, videos, databases, ephemeral test output, intermediate capture corpora and compiled fixture bundles are ignored. The original pilot's local traces can contain temporary session credentials even though the login step was excluded from tracing. They must not be force-added. Nonfinal experiments are retained locally under the ignored `nonfinal` directory; final index generation rejects unclassified screenshot files.

No frozen grading scenarios, review decisions, evaluation run evidence or production environment were altered to improve these results. No paid evaluation, deployment, merge or human approval is part of this evidence.
