# R05 receipt

## R05.1 agent intent, decision, execution and effect contracts

Delivered: `agent` object in `ingest-event` and `event` schemas and `AgentContext` type (packages/contracts);
consistency checks and private-content minimization in `packages/detections/src/normalize.ts` and `redact.ts`
(`PRIVATE_AGENT_KEY`); rule R7 v3 in `rules.ts` (origin-based independence, runtime split, legacy qualification);
ruleset `dk-rules-1.2.0`; demo agent run declares phases and origins (`scripts/build-demo-fixture.ts`).

Acceptance (`packages/detections/test/agent-r05.test.ts`, 5 tests). **Failing first: all 5 failed** with the
pre-change detections source and the new contracts (`/workspace/work/r00/prefix-r051.txt`, not committed).
- Runtime self-report cannot masquerade as independent corroboration (`source_reported` vs `corroborated`).
- Identical run ids from unrelated runtimes do not join, even inside one declared run namespace.
- Legacy generic tool events remain valid but carry an explicit qualification.
- Private prompts and payloads are removed before persistence; numbers and identifiers stay.

Limitations: no separate `packages/agent-observability` package was created; the SDK passes `agent` through its
event type. Hidden reasoning is never collected, so "why the model chose a tool" is out of scope by design. The
UI shows agent fields only through the raw event detail.
