# Controlled non-production pilot: runbook

This exercise shows that the core workflow hangs together on one isolated machine: real telemetry from a reference application reaches the castle UI and an MCP client as the same evidence. **It is not a production deployment procedure, and passing it does not make Digital Kingdom production-ready.**

## Supported setup

- Node ≥ 22.13 and pnpm 10.12.1 (from `packageManager`), installed with `pnpm install --frozen-lockfile`.
- Chromium from Playwright 1.56.1: `npx playwright install --with-deps chromium`.
- Linux or macOS. CI runs on `ubuntu-latest`.
- Everything binds to `127.0.0.1` on ephemeral ports. Nothing talks to a monitored production system.

## Isolated topology

```
reference app (examples/reference-app, real @dk/sdk-node)   127.0.0.1:<ephemeral>
        │  POST /ingest/events  (source key, project-scoped)
        ▼
Digital Kingdom server + worker (apps/server/src/main.ts)   127.0.0.1:<ephemeral>
        │  fresh temp DK_DATA_DIR (SQLite journal, deleted at teardown)
        ├── built web app (apps/web/dist) ──► Chromium (Playwright), session cookie from the token sign-in
        └── REST ◄── MCP server over stdio (apps/mcp/src/main.ts) ◄── protocol-level MCP client (SDK)
                     authenticated with a project-scoped *service* analyst token
```

## Environment variables (names only, never commit values)

| Variable | Used by | Pilot value |
|---|---|---|
| `DK_DATA_DIR` | server | a fresh `mkdtemp` directory |
| `PORT`, `HOST` | server | ephemeral port, `127.0.0.1` |
| `DK_ADMIN_TOKEN` | server | random per run (synthetic human admin) |
| `DK_SECRET` | server | random per run |
| `DK_SEED_DEMO`, `DK_DEMO_MODE` | server | `false` (no synthetic demo project, no anonymous access) |
| `DK_WORKER_INTERVAL_MS` | server | `100` |
| `DK_COVERAGE_SWEEP_MS` | server | `500` (default 30000). Makes staleness observable within seconds |
| `DK_WORKER_PAUSED` | server | `true` only for the restart check. Ingest-only mode: events are acknowledged and journaled but not processed. **Test mechanism, not a production mode** |
| `DK_URL`, `DK_TOKEN`, `DK_PROJECT` | MCP stdio server | pilot server URL, service token, `pilot` |
| `DK_SOURCE_KEY` | reference app (standalone) | source key returned by `POST /api/projects/:p/sources` |

## Run it

```
pnpm build          # the pilot drives the BUILT web app served by the server
pnpm pilot          # = playwright test (e2e/pilot.spec.ts, serial, ~2 min)
```

Setup and teardown happen automatically (`e2e/harness.ts`): a temp data dir, ephemeral port, synthetic admin token, and a server child process. At the end the server is stopped and the data dir is removed. Waits poll observable conditions against bounded deadlines; there are no fixed sleeps.

### Manual run (same topology)

```
DK_DATA_DIR=$(mktemp -d) PORT=8790 DK_ADMIN_TOKEN=<random> DK_SEED_DEMO=false DK_DEMO_MODE=false pnpm start
# create project, graph and sources with the admin token (see beforeAll in e2e/pilot.spec.ts for the exact calls)
DK_URL=http://127.0.0.1:8790 DK_SOURCE_KEY=<source key> PORT=3080 npx tsx examples/reference-app/src/app.ts
DK_URL=http://127.0.0.1:8790 DK_TOKEN=<service token> DK_PROJECT=pilot pnpm mcp
```

Shutdown: Ctrl-C each process, then delete the temp `DK_DATA_DIR`.

## Generating controlled events

Use only the reference app, which emits through the real SDK:

- 5× `POST /login {"user":"ops","password":"wrong-password"}` → 401, then one more → 429 (the lockout emits a `denied` authentication event).
- `GET /orders?q=<SQLi-shaped input + harmless instruction-like text>` → 400. The input-filter denial records the offending input as the untrusted attribute `input_sample`.
- The `db-audit` source (declared with `stale_after_seconds: 3`) sends a single `data_access` event and then goes silent.

## Expected observations

| Check | Browser | MCP |
|---|---|---|
| Finding | "5 failed sign-ins for one account" on `checkout` (shown as checkout-api). Outcome *Attempted*, source-reported. The claim matches the server and makes no compromise claim | `dk_get_finding` returns the same supporting and counter event IDs, `affected_asset_ids: ["checkout"]`, `completeness.complete: true` |
| 3D/2D | The same selection and evidence in both views. 3D needs a real WebGL context and a non-blank frame | n/a |
| Evidence fetch failure | "Incomplete evidence: Could not load…" callout, `data-error=true`, distinct from an empty result | `completeness.retrieval_errors` (covered by API/MCP tests) |
| Stale source | Coverage row *Stale*. Finding "checkout-db audit stale", *Unknown · Not assessed*, never "outage" | `dk_coverage` → `degraded` |
| Unknown targets | n/a | unknown asset → `not_assessed`. Known + unknown mix → `targets_unresolved: 1`, never `no_recorded_concerns` |
| Restart | Pill turns *Reconnecting* or *Disconnected*, a "This is not live monitoring" banner appears, the timeline says "Latest received · not live", and the view is never swapped for the synthetic demo. Back to *Streaming* after restart | n/a |
| Acknowledged event | Accepted (202) while the worker is paused, killed before processing, processed exactly once after restart. A resend counts as `duplicate` | n/a |
| Containment | n/a | The service proposes via `dk_propose_containment` and gets `pending`. Its own approval is 403. A human admin approval returns `approved`, and no event, finding, source or reference-app behavior changes |
| Untrusted text | `input_sample` is shown literally as text: no `<img>` element, no script ran | Returned inside `evidence`/events with the "untrusted" note. It creates no containment request and doesn't change the finding's level or outcome |

## Manual 3D checklist (for a real GPU)

The automated 3D check runs on SwiftShader. On a workstation with a GPU, confirm:

1. The castle renders with rooms for edge, checkout-api and checkout-db. Labels don't overlap at 1440×900 or 1280×800.
2. Clicking the checkout-api building selects asset `checkout` (inspector header shows `checkout`), the same as clicking its node in 2D.
3. Selecting the sign-in finding highlights the checkout room. Switching with `2`/`3` keeps the selection.
4. Orbit, zoom and reset (home button) respond, and frame pacing feels smooth. Record the browser, GPU, and frame rate if you measure it.
5. With OS "reduce motion" on, the camera doesn't animate.
6. Disconnecting the server shows the banner over the 3D view too.

## Cleanup

`pnpm pilot` cleans up after itself. Manually, stop the processes and `rm -rf` the temp data dir. Evidence lands in `artifacts/pilot/` (git-ignored; uploaded by CI as `browser-pilot-evidence`).

## Known limitations

- Traces are recorded **after** sign-in, so the typed token never appears in them. They do contain the per-run synthetic session cookie. That cookie is invalid once teardown deletes the server and its database. Don't record traces against any real installation.
- The 3D check is software-rendered. It shows the scene renders and is consistent, not that performance is acceptable.
- The only human containment approval path is the REST API (`POST …/containment/:id/decision`). The web UI can request containment but has no approval control yet.
- Single machine, a single SQLite file and one browser. No load, multi-node or long-duration behavior is exercised.
