# R11 receipt

## R11.1 offline v2 evaluation runner

Delivered: `eval/src/v2/harness.ts`; v1 building blocks re-exported from `eval/src/scenarios.ts` without changing
v1 output; `eval/test/v2-harness.test.ts` (10 tests); plan amendment note.

Acceptance:
- Required evidence never retrieved fails retrieval and end-to-end success; its reasoning objective is unexercised.
- Unavailable or unequal evidence (events, evidence references, common metadata, prompt cap) invalidates the case
  in preflight; scoring then returns `invalid_case`, never a better score.
- C2 stays "Event-MCP with context", `raw_only: false`, exactly two tools; relabeling it raw throws.
- The v1 scenarios, grading keys and runs tree digest is pinned
  (`9f6fde03ddec56f6692149a94c7f09fdf7f4287b534700a66aec173d6e811d96`, tracked files).
- Budget reservation is tested only with a fake provider: it counts in-flight reservations and stops before 80%
  of the cap; a real provider is refused without `DK_EVAL_V2_APPROVED=1` and an approved cap.

Not done here (R11.2, gated on provider budget and human review): any model call, transcripts, held-out grading,
blind human review.

## R11.4 support tiers and maintenance commitments

- Candidate: roadmap/batch4 (commit follows this receipt).
- Changed: support-matrix/ (new), MAINTAINERS.md, SECURITY.md, README.md, docs/RELEASE_NOTES_TEMPLATE.md, apps/server/test/support-r11.test.ts.
- Commands: pnpm -s typecheck (clean); npx vitest run apps/server/test/support-r11.test.ts (2 passed).
- Acceptance: (1) every connector id and every Integrations card route maps to a matrix entry with a level, and no entry claims lab/live verification; (2) model_service_required false and the golden path runs with planner and assistant unset; (3) golden path test passes at this candidate; (4) each integration cites the tests that must rerun for a security correction, checked to exist.
- Open: tier claims beyond local reference rest on gated work (outside testers R11.3, provider access R09, notification destination R03.5); the matrix states those gates.
- Migration/rollback: none.
