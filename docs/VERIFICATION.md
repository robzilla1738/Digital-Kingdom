# Verification map

Run `pnpm check` (typecheck + tests + fixture validation) and `pnpm build`. The browser pilot runs with `pnpm build && pnpm pilot`; see [PILOT_RUNBOOK.md](PILOT_RUNBOOK.md), and [PILOT_RESULTS.md](PILOT_RESULTS.md) for the last recorded run.

A passing test is evidence only for what it exercises. The test levels are:

- **Unit:** pure package logic (`packages/*/test`).
- **API/integration:** an in-process Fastify app with a real SQLite file, the SDK, and in-memory or real MCP transports (`apps/*/test`, `examples/**/e2e.test.ts`). Vitest.
- **Browser:** the real server entry point as a child process, the built web app in Chromium, and an MCP client over the stdio launch path (`e2e/pilot.spec.ts`). Playwright, CI job `browser-pilot`. 3D uses SwiftShader software WebGL.
- **Real-agent:** none. The MCP tests use a programmatic protocol client. They test the interface, not an LLM's judgment.
- **Manual:** the GPU 3D checklist in PILOT_RUNBOOK.md, and screen-reader use.
- **Unverified operational targets:** load, soak, multi-node, and GPU frame budgets.

| Blueprint acceptance | Where it is tested |
|---|---|
| E01–E09, E12 | `packages/detections/test/detections.test.ts` |
| E09 (server revisions) | `apps/server/test/server.test.ts` › late event creates a new revision |
| E10, E11 | `packages/graph-core/test/graph.test.ts` › temporal topology |
| O01, O02, O06 | `apps/server/test/server.test.ts` › durability and recovery |
| S01, S02, S03, S07, S08, S14 | `apps/server/test/server.test.ts`, `packages/detections/test` |
| S04, S09, S10, S11 | `packages/scene-compiler/test/scene.test.ts`, detections (hostile labels) |
| S12 | `apps/server/test/server.test.ts` › export verifies, tampering detected |
| V01, V02, V03, V12 | `packages/scene-compiler/test/scene.test.ts` |
| V06 (WebGL unavailable → 2D) | `e2e/pilot.spec.ts` › C3. Mid-session context *loss* is handled in `Castle3D.tsx` but not automated |
| Live local E2E | `examples/reference-app/e2e.test.ts` |
| MCP agent interface | `apps/mcp/test/mcp.test.ts` |
| Fix 1: redaction before persistence | `apps/server/test/trust.test.ts` › fix 1 |
| Fix 2: honest assessments | `apps/server/test/trust.test.ts` › fix 2 |
| Fix 3: source capabilities / independence | `apps/server/test/trust.test.ts` › fix 3, `packages/detections/test` › source capabilities |
| Fix 4: complete evidence | `apps/mcp/test/evidence.test.ts` |
| Fix 5: OTLP/HTTP | `apps/server/test/otlp.test.ts` (official OTel JS exporter) |
| Token delegation scope | `apps/server/test/hardening.test.ts` › token delegation |
| Reserved metadata, quarantine, infra-error retry | `apps/server/test/hardening.test.ts` › internal metadata |
| v0.2 → v0.3.1 upgrade purge | `apps/server/test/hardening.test.ts` › upgrading a v0.2 database |
| v0.3 → v0.3.2 upgrade with a pending backlog (genuine v0.3 fixture) | `apps/server/test/upgrade-v03.test.ts` |
| Isolated non-production trial, backend/API/MCP only (SDK → finding → UI API → MCP, outage, unknowns, restart, inert proposal) | `apps/mcp/test/trial.e2e.test.ts` |
| v0.3.1 tombstones stay tombstones; read-only diagnostic; replay is collapsed by dedup | `apps/server/test/tombstones.test.ts` (fixture `fixtures/legacy/v0.3-after-v0.3.1-startup.sqlite`) |
| Stale-source finding has a derived time and the project's dataset kind | `packages/detections/test/coverage-finding-time.test.ts` |
| **Browser pilot:** reference app → server + worker → browser finding on the stable asset ID, with non-overstated claim (A) | `e2e/pilot.spec.ts` › A |
| Browser ↔ MCP (stdio) ↔ API evidence parity: support/counter IDs, asset, completeness (B) | `e2e/pilot.spec.ts` › B |
| 3D (real WebGL context + non-blank frame) ↔ 2D selection parity, toggles, search, replay, return-to-latest (C) | `e2e/pilot.spec.ts` › C |
| Failed evidence fetch shown as incomplete, not empty (C2) | `e2e/pilot.spec.ts` › C2 (network fault injection) |
| WebGL unavailable → 2D fallback (C3, *not* counted as 3D) | `e2e/pilot.spec.ts` › C3 |
| Stale source and unknown/mixed targets in browser and MCP (D) | `e2e/pilot.spec.ts` › D |
| Acknowledged-unprocessed event survives a crash restart, processed once; browser shows lost stream, never falls back to the synthetic demo, reconnects (E) | `e2e/pilot.spec.ts` › E |
| Containment: service proposes via MCP, self-approval 403, human approval, no monitored-system change (F) | `e2e/pilot.spec.ts` › F |
| Instruction-like evidence text rendered as data, authorizes nothing (G) | `e2e/pilot.spec.ts` › G |
| Human/service approvals | `apps/server/test/trust.test.ts` › containment approvals |
| Fixture integrity | `scripts/validate-fixtures.ts` → `docs/VALIDATION_REPORT.md` |

Not yet automated: GPU-rendered 3D (manual checklist), mid-session WebGL context loss, O03–O05 load and soak targets, V04/V05/V07–V11 performance and visual-regression budgets on real hardware, screen-reader audit.
