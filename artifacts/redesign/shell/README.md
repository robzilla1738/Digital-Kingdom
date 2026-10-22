# Frozen-source shell controls

All 11 controls passed with zero page errors on `5ce7487c76c87be2b53f6520690987d2c5bdd063`. The unchanged harness is `apps/web/src/shell/verify-controls.mjs`; its exact hash and the receipt hash are bound by [the execution receipt](../final/execution-receipt.json). Results are [controls-regression.json](controls-regression.json), with [console output](controls-run.log).

This separate run used a **Vite development server** on the frozen source, explicit synthetic fixtures, official Chromium headless-shell and SwiftShader. It is not the immutable production-bundle run, a real-source integration, a physical-device test or human approval.

```sh
VITE_DK_STATIC_DEMO=1 \
VITE_DK_BUILD=5ce7487c76c87be2b53f6520690987d2c5bdd063 \
PLAYWRIGHT_BROWSERS_PATH=/workspace/shared/dk-playwright \
node apps/web/src/shell/verify-controls.mjs
```

The checks cover keyboard and pointer inspector resizing, exact record and DOM continuity, narrow controls and focus restoration, source-filter capability guidance, native Escape priority, explicit map focus and deliberate WebGL recovery. Earlier candidates' complete shell receipts are preserved under ignored nonfinal storage; the sealed immediate predecessor is `../nonfinal/prior-66ce8f3/shell/`.
