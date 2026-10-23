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
