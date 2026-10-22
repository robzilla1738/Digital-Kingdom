# Controlled non-production pilot: results

**Result: the controlled, isolated, non-production pilot passed (9/9 browser scenarios), after the fixes listed below.** This exercise does **not** establish production readiness. See "What this does not establish".

## Tested code

- Base: `main` @ `591289d00519a42a5bfbe25d4d89dfc1fa0f4af2` (v0.3.2). At the start of the work HEAD was unchanged and the tree was clean.
- Work branch: `pilot/browser-pilot`. Not merged to main.
- The local runs below used the branch working tree that became commit `0c37c60` plus the docs commit. CI ran on the branch head (see "CI").

## Environment (local runs)

| | |
|---|---|
| OS | Debian GNU/Linux 13 (trixie), aarch64, sandboxed VM. No GPU |
| Node / pnpm | v22.23.3 / 10.12.1 (`packageManager`), `pnpm install --frozen-lockfile` |
| Browser | Playwright 1.56.1, Chromium headless shell 1194 |
| 3D rendering | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)`, software WebGL |
| Viewport | 1440×900 |
| Workload | 3 assets, 2 sources, about 10 events. Functional only, **no performance measurement** |

## Commands and results

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ok |
| `pnpm typecheck` | ok, no errors |
| `pnpm test` (vitest) | baseline at 591289d: 13 files / 141 tests passed. Branch: 15 files / 144 tests passed |
| `pnpm validate:fixtures` | all checks PASS |
| `pnpm build`, and `DK_BASE=/Digital-Kingdom/ VITE_DK_STATIC_DEMO=1 VITE_DK_BUILD=test pnpm build` | ok. Build ID embedded (`dk-build` = `test`) |
| `pnpm build && pnpm pilot` (Playwright) | 9 passed, 0 skipped, 0 flaky (2.3 min). Repeated on 3 separate clean runs |

## Browser pilot scenarios (`e2e/pilot.spec.ts`)

| | Scenario | Result | Key observation |
|---|---|---|---|
| A | Reference app (real SDK) → server + worker → browser | PASS | `repeated_auth_failure` on asset `checkout`. Outcome `attempted`, evidence `source_reported`. Claim identical to the server's, with no compromise wording. 5 supporting events, 0 counter, complete |
| B | Same finding through the MCP stdio launch path (protocol-level SDK client, service analyst token) | PASS | Same 5 event IDs, same asset, `completeness.complete: true`, `evidence.untrusted: true`, and matches the REST evidence endpoint |
| C | 3D ↔ 2D, toggles, search, replay, return-to-latest | PASS (software WebGL) | Real WebGL context and a non-blank frame (~100 KB PNG). Same finding and asset selection and support IDs in both views |
| C2 | Evidence fetch fails (injected 503) | PASS | "Incomplete evidence: Could not load…" (`data-error=true`). Shows complete once restored |
| C3 | WebGL unavailable | PASS (fallback only, **not counted as 3D**) | 3D control disabled, banner, 2D graph, no canvas |
| D | Stale source, unknown and mixed targets | PASS | Coverage `degraded`, shown as "Stale", never "outage". Unknown asset → `not_assessed`. Known + unknown → `insufficient_context`, `targets_unresolved: 1` |
| E | Acknowledge, crash before processing, restart | PASS | 202 while the worker was paused. SIGKILL. After restart, processed **exactly once**, and a resend is a `duplicate`. Browser showed "Reconnecting" with a "not live monitoring" banner and "Latest received · not live", then reconnected |
| F | Containment | PASS | Service proposal via MCP → `pending`. Self-approval 403. Human admin → `approved`. Events, findings, sources and reference-app behavior unchanged (lockout still 429) |
| G | Instruction-like evidence text | PASS | Rendered literally as text, no `<img>` element, script did not run. MCP returns it as untrusted data. No containment request created, finding level and outcome unchanged |

Structured observations: `docs/img/pilot/pilot-observations.json`. Screenshots: `docs/img/pilot/*.png`.

## Defects found by the pilot and fixed

| Defect (confirmed) | Fix | Regression test |
|---|---|---|
| After a live session, an unreachable server made the UI **silently swap in the offline synthetic demo** | Once in server mode, keep the last data and show a "Connection lost… not live monitoring" banner with the last sync time | pilot E (no synthetic pill, banner visible) |
| The timeline said **"Live" while the stream was down** | "Live" requires a healthy stream, otherwise "Latest received · not live". A reconnect forces a snapshot refetch | pilot E |
| Stale-source findings were stamped with the **Unix epoch** (shown 00:00:00, sorted first) and labelled **synthetic in a live project** | Derived stale moment (last receipt + threshold, stable across sweeps), using the project's dataset kind | `packages/detections/test/coverage-finding-time.test.ts`, pilot D |
| The event inspector **did not show source attributes or stored evidence records**, so the supporting records could not be inspected | Shown as plain text, explicitly labelled untrusted | pilot G |
| The public static demo requested `/api/me` at the **origin root** (404 outside the base path) | `VITE_DK_STATIC_DEMO=1` in the Pages build never contacts a backend | build check. Needs a Pages redeploy to observe |
| CI: `playwright install --with-deps` failed on `ubuntu-latest` (logs not readable with the available token; the runner began migrating to Ubuntu 26 on 2026-10-19) | Pinned the job to `ubuntu-24.04` | CI rerun (see below) |

Other changes: test-only server knobs `DK_WORKER_PAUSED` and `DK_COVERAGE_SWEEP_MS`. The reference app records the denied input as attribute `input_sample`. Stable `data-*` hooks were added for tests (`data-finding-id`, `data-asset-id`, `data-event-id`, `data-selection-id`, `data-state`).

## Suspected or not reproduced

None open from this run.

## Operational limitations

- 3D was software-rendered. GPU rendering, frame pacing and visual regression are **not verified**. A manual checklist is in PILOT_RUNBOOK.md.
- Human containment approval exists only as the REST API. There is no approval control in the UI.
- Traces contain the per-run synthetic session cookie (it is invalid after teardown). The typed token and service token were confirmed absent from traces and logs (grep of extracted traces and `server.log`).
- Mid-session WebGL context loss and reduced-motion behavior were not automated.

## Upgrade documentation

`docs/UPGRADING.md` now separates prevention (v0.3.2 converter) from recovery (not possible from an already-tombstoned database). It adds the read-only `pnpm diagnose:tombstones <db>` diagnostic and its limits, plus recovery cautions. One of those cautions is verified: replaying an original source record is collapsed as a duplicate by the existing dedup entry. Tested by `apps/server/test/tombstones.test.ts` against a fixture produced by the genuine v0.3.1 code.

## Public synthetic demo

- `https://robzilla1738.github.io/Digital-Kingdom/`: the `demo-pages` run `39759773211` (attempt 2, re-run after the owner set Pages source = GitHub Actions; API reports `build_type: workflow`) completed deploy and its served-build check.
- Independently verified on 2026-10-22: the served `<meta name="dk-build">` = `591289d00519a42a5bfbe25d4d89dfc1fa0f4af2`. JS and CSS under `/Digital-Kingdom/assets/` return 200. In Chromium the app rendered the castle labelled **Synthetic · Offline** with 10 findings and 13 assets. No backend is published.
- The deployed build is main @ 591289d. The static-demo fix on this branch reaches Pages only after a merge to main.

## CI

- Run `39767190443` (branch head `624529e`): `check` passed. `browser-pilot` failed at `npx playwright install --with-deps chromium` before any test ran, which led to the runner pin.
- Run `39767455892` (branch head `079cc30`, `ubuntu-24.04`): **`check` passed and `browser-pilot` passed** (install, build, `pnpm pilot`, evidence upload). Artifact `browser-pilot-evidence`: https://github.com/robzilla1738/Digital-Kingdom/actions/runs/39767455892
- CI runs Chromium on x86_64 Ubuntu 24.04 with software WebGL. The local runs were on aarch64 Debian 13.

## What this does not establish

- Production readiness, scale, soak, multi-node or HA behavior, or any performance target.
- GPU 3D correctness or performance.
- That an LLM agent would use the MCP tools well. Only a programmatic client was tested.
- Immunity to prompt injection in general. One harmless string was shown to be inert in this UI and in these tools.
- That containment proposals are effective. They are never executed, by design.
