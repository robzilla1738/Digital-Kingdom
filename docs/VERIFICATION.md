# Verification map

Run `pnpm check` (typecheck + tests + fixture validation) and `pnpm build`.

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
| V06 (WebGL loss → 2D) | `apps/web/src/castle/Castle3D.tsx` (context-loss handler) and manual headless check |
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
| Isolated non-production trial (SDK → finding → UI API → MCP, outage, unknowns, restart, inert proposal) | `apps/mcp/test/trial.e2e.test.ts` |
| Human/service approvals | `apps/server/test/trust.test.ts` › containment approvals |
| Fixture integrity | `scripts/validate-fixtures.ts` → `docs/VALIDATION_REPORT.md` |

Not yet automated: O03–O05 load and soak targets, V04/V05/V07–V11 performance and visual-regression budgets on real hardware, screen-reader audit.
