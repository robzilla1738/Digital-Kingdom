# Investigation quality gates

## Scope

This change set is based on `812a9575e5682be0ae915f3f2cf8f74c86d395a6` and is intended for review into `improve/investigation-honesty`, not direct production deployment. It makes no paid model calls and does not rescore v1.

## Implemented behavior

- The shared coverage calculator honors administrative disablement before historical events or sensor-restored records. Current API, MCP and browser snapshots agree that a disabled source is offline. Assessment v2 remains non-favorable, while a severe finding still yields hold with gaps visible.
- Manifest project/environment and consumed optional fields are type-checked before transformations. Compose requires a service mapping and validates consumed service shapes, labels, dependency references and ports-container shape. Invalid inputs return field-level 422 responses without graph/scene mutation; genuine internal exceptions remain 500. This is validation of the SUPPORTED METADATA SUBSET, not full Docker Compose conformance.
- Compose service counts above 500 are rejected rather than silently truncated. Manifest bounds remain 1000 assets/5000 relationships. Supported valid imports remain tested.
- Event search reports `source_coverage.coverage_basis = current_state`, `coverage_as_of`, and `historical_coverage_assessed = false`. Event pages remain pinned to an event high-water mark; live source health can change between pages. Never infer interval-wide coverage from current health.
- The v2 plan describes C2's actual context rather than calling it raw-only. It requires equal underlying metadata, separately scores retrieval and reasoning, keeps missed retrieval in task-success denominators, and compares injection-direction shifts with clean-repeat variability.
- Offline objective-accounting helpers have no provider/client dependencies and do not make semantic claim-support decisions. They are preparation for v2, not evidence that v2 has run.

## Verification commands

Run `pnpm check` and `pnpm build`, then `pnpm pilot` with the supported Playwright Chromium installation. Review the results for the exact commit proposed for merge. A passing workflow on a parent commit is not final verification.

Targeted suites:

- `apps/server/test/quality-gates.test.ts`: disabled source with recent data, no data, sensor-restored record, severe finding, unrelated source, re-enable; malformed top-level manifest and Compose values; graph and scene unchanged.
- `apps/mcp/test/quality-gates-stdio.test.ts`: actual stdio subprocess and viewer token; search/detail, page pinning, machine-readable current coverage, disabled assessment, unknown targets and cross-project denial. No LLM.
- `eval/test/v2-objectives.test.ts`: unreachable evidence, missed retrieval, unexercised reasoning, pending review, end-to-end success/failure and invalid denominators.
- Existing import, evidence, protocol, durability and browser-pilot suites remain required. Do not replace failures with manual pass claims.

## Release checklist

- Confirm the latest candidate's typecheck, full test suite, fixtures, build and browser pilot passed.
- Compare Git trees for v1's `eval/runs`, `eval/grading` and `eval/scenarios` against the base; they must remain unchanged.
- Keep the PR unmerged until reviewed. Do not trigger Pages or a production rollout just because CI passes.
- Keep human-review packets pending until actual people complete their declared review scope.
- Before paid v2 work, obtain fresh provider/budget approval and verify the access-equivalence and output-contract gates using fake-model/offline tests.

## Known limits retained

Current coverage is not historical coverage. Source freshness depends on the configured thresholds and bounded available event window; healthy does not prove complete detection. Event search still uses scans for several normalized fields; a 31-day bound does not bound row count or latency. Source declarations do not establish complete inventory. Hypotheses, source reports and impact remain distinct.

Administrative disablement has no historical timestamp in the current source schema. Its coverage finding uses the assessment time where available, not a fabricated disablement event. Persisted state-transition history is separate future work.

The existing browser pilot uses software WebGL, not a real-device performance certification. The new stdio test exercises the protocol, not an AI model's judgment. Passing tests and this checklist are not a penetration test, a complete security audit, a scalability benchmark or production certification.
