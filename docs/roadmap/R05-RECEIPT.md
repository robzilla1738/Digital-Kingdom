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

## R05.2 instrument one real agent workflow and independent observer

Delivered: `examples/reference-app/src/agent/boundary.ts` (`createGateway`, `startControlledSink`,
`UNOBSERVED_PATHS`, `PERMISSION_ASSUMPTIONS`) running on the R02.2 local pack.

Acceptance (`examples/reference-app/agent-boundary.test.ts`, 4 tests, real MCP client/server, real HTTP receiver):
- Prohibited egress: the gateway denies a non-allowlisted destination; the receiver gets nothing; Digital Kingdom
  records a policy-enforcer denial finding.
- Permitted work completes; its effect is corroborated by the independent observer.
- A direct request to the receiver around the gateway yields a high-severity effect finding stating that the
  wrapper did not report it, with no principal attributed.
- The agent's service viewer token cannot disable the observer source (403), and the gateway exposes no tool
  that touches monitoring.

Unobserved paths: direct network access, other MCP servers or plugins, and tool arguments (never recorded).
The chosen boundary is MCP; other runtimes are not claimed as supported.

## R05.3 extend MCP with bounded cases and subscriptions

Delivered: `dk_capabilities`, `dk_case_changes`, case resource template, per-server output budget, `/api/capabilities`, `/cases/changes`.

Acceptance (`apps/mcp/test/mcp-r05.test.ts`, 5 tests):
- Stdio is the only transport; no remote mode is offered, so there is nothing to disagree on scope (stated in capabilities).
- A viewer calling the non-read-only containment tool is refused by the server role check; annotations are hints only.
- No tool input names a URL, endpoint, token or header; the client only calls its configured base URL with its own token.
- Closing the MCP client does not stop ingestion; case changes made meanwhile are returned on the next poll in order.
- Results above the budget are withheld with `truncated: true` and the budget, not partially returned.

Limitations: no push subscriptions (polling every 30 s); no remote MCP.

## R05.4 bounded case assistance

- Candidate: roadmap/batch4 (commit follows this receipt).
- Changed: apps/server/src/assistant.ts (new), app.ts (route, AppConfig.assistant), test/assistant-r05.test.ts.
- Commands: pnpm -s typecheck (clean); npx vitest run apps/server/test/assistant-r05.test.ts (3 passed, stub models only).
- Acceptance: (1) an obedient stub that asks to approve containment, call tools and widen scope changes nothing and its requests are listed as ignored; (2) claims citing non-retrieved ids or no ids are unsupported; (3) provider error and non-JSON output return the deterministic summary; collection, detection, queries, scene fallback and authorization never touch the assistant.
- Blocked (gate model_provider_and_budget_approval): (4) observing recommendation effects in matched evaluations needs a real model and an approved budget; no provider is configured or called.
- Migration/rollback: none.
