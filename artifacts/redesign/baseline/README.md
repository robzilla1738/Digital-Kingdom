# Baseline verification receipt

Exact baseline: `453b2db522780361405c388f036d7874041cb005`, branch `fix/investigation-quality-gates`. The clean tracked tree was archived before any implementation edits. All tracked archive file hashes still match the original git tree; see `snapshot-integrity.json`. No frozen evaluation files were altered.

## Results

- Typecheck: passed.
- Unit/integration: 25 files, 223 tests passed with `OTEL_TRACES_SAMPLER=always_on OTEL_TRACES_SAMPLER_ARG=1`.
- Fixture validation: passed using `node --import tsx scripts/validate-fixtures.ts`.
- Production build: passed.
- Unchanged browser pilot: 11/11 passed in approximately 1.1 minutes with official Playwright Chromium headless-shell and SwiftShader.
- Seven before images: six actual offline synthetic application states, plus a separately labeled ten-module geometry study.

## Conditions and limitations

Node 24.19.0; pnpm 10.12.1; Playwright 1.56.1; Chromium headless-shell 141.0.7390.37. Full dependency versions are recorded separately. Screenshots are 1440×900 CSS pixels, device scale factor 1. The application corpus uses the bundled fixed October 20, 2026 synthetic event interval; no real-source data is in these images. Main screens use the unchanged baseline source, compiled with the existing `VITE_DK_STATIC_DEMO=1` option and a single-inline-bundle capture configuration. The module study imports unchanged module geometry into a neutral-lighting comparison harness and is not a product screen.

The renderer identifies itself as ANGLE Vulkan SwiftShader. This verifies actual WebGL pixels and functional parity, not GPU performance or real-device usability. No human approval is implied. The isolated-live pilot evidence is kept apart from the synthetic screenshot corpus and uses temporary local credentials/data only.

## Environmental recovery, not product fixes

Initial isolated-copy errors from a missing examples/reference-app node_modules directory were corrected by copying the existing installed dependency links; the source was not changed. The inherited environment sampled only 1% of OpenTelemetry spans, causing two exporter tests to fail. All 223 tests pass under a deterministic always-on sampler. Initial logs remain available rather than being discarded.

The tsx CLI could not bind its Unix IPC socket in the execution sandbox, so the supported Node tsx loader ran the same fixture script. System Chromium 154 failed its process-singleton Unix socket before any test. The official Playwright headless-shell resolved that launch limitation without changing test code or browser security settings. Local servers and browser clients run in the same execution process group because loopback is isolated across tool calls. Earlier unsuccessful attempts and raw logs are preserved.

See `commands.tsv` for exact commands and exit codes, `screenshot-metadata.json` for browser/renderer and console status, `reproduction/` for capture recipes, and `isolated-live-pilot-headless-shell/` for final pilot screenshots and sanitized results. Raw trace archives stay local and are excluded from publication because they can contain temporary session credentials.
