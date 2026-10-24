# Source and scope register

Repository facts are pinned to `9fec7ed24dea46157af8a7c0ef09bee77c2ffa88`. Proposed product behavior and package counts describe this handoff, not deployed functionality. The baseline source check did not execute application tests or a new model run.

## R01 — docs/roadmap/REMAINING.md

https://github.com/robzilla1738/Digital-Kingdom/blob/9fec7ed24dea46157af8a7c0ef09bee77c2ffa88/docs/roadmap/REMAINING.md

Use: Existing externally gated work and explicit AWS/notification deferrals.

## R02 — apps/server/src/recipes.ts

https://github.com/robzilla1738/Digital-Kingdom/blob/9fec7ed24dea46157af8a7c0ef09bee77c2ffa88/apps/server/src/recipes.ts

Use: Existing bounded recipe behavior, query/coverage handling and observable-claim hardening opportunities; not independently executed this turn.

## R03 — examples/reference-app/src/lab/runner.ts

https://github.com/robzilla1738/Digital-Kingdom/blob/9fec7ed24dea46157af8a7c0ef09bee77c2ffa88/examples/reference-app/src/lab/runner.ts

Use: Current finite HTTP lab runner and places to strengthen target ownership, per-operation effects and cleanup accounting.

## R04 — artifacts/completion/evaluation/REPORT.md

https://github.com/robzilla1738/Digital-Kingdom/blob/9fec7ed24dea46157af8a7c0ef09bee77c2ffa88/artifacts/completion/evaluation/REPORT.md

Use: Prior actual aggregate report; not new evaluation results or human-reviewed accuracy.

## R05 — apps/mcp/src/server.ts

https://github.com/robzilla1738/Digital-Kingdom/blob/9fec7ed24dea46157af8a7c0ef09bee77c2ffa88/apps/mcp/src/server.ts

Use: Existing case/history/bundle/recipe tools and permissions to reuse.

## R06 — apps/server/src/access/aws-policy.ts

https://github.com/robzilla1738/Digital-Kingdom/blob/9fec7ed24dea46157af8a7c0ef09bee77c2ffa88/apps/server/src/access/aws-policy.ts

Use: Unchanged conditional-result predicate; previously reported isolated reproduction, new full regression required.

## R07 — packages/contracts/src/surfaces.ts

https://github.com/robzilla1738/Digital-Kingdom/blob/9fec7ed24dea46157af8a7c0ef09bee77c2ffa88/packages/contracts/src/surfaces.ts

Use: Existing surface descriptors and named architectural families; prior review context.

## R08 — docs/quality/COMPLETION-2026-10-23.md

https://github.com/robzilla1738/Digital-Kingdom/blob/9fec7ed24dea46157af8a7c0ef09bee77c2ffa88/docs/quality/COMPLETION-2026-10-23.md

Use: Existing local completion evidence and limits; prior exact-head review context.

## R09 — docs/roadmap/R01-RECEIPT.md

https://github.com/robzilla1738/Digital-Kingdom/blob/9fec7ed24dea46157af8a7c0ef09bee77c2ffa88/docs/roadmap/R01-RECEIPT.md

Use: Existing history, bundle, concurrency and query implementation; prior exact-head review context.

## R10 — docs/roadmap/R05-RECEIPT.md

https://github.com/robzilla1738/Digital-Kingdom/blob/9fec7ed24dea46157af8a7c0ef09bee77c2ffa88/docs/roadmap/R05-RECEIPT.md

Use: Supported agent boundary and independent observation; prior exact-head review context.

## E01 — AWS IAM policy evaluation logic

https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html

Use: Why applicable denies/restrictive layers matter. No claim of full provider-equivalent local policy engine.

## E02 — MCP Security Best Practices

https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices

Use: Scope minimization, authorization boundaries, SSRF/token handling and local-server concerns. Pin actual supported SDK/protocol in implementation.

## E03 — Docker Engine security

https://docs.docker.com/engine/security/

Use: Daemon/mount authority and isolation limitations; keep daemon control out of the web app and use finite local operations.

## E04 — Docker Rootless mode

https://docs.docker.com/engine/security/rootless/

Use: Optional non-root launcher profile where supported, not an absolute sandbox claim or instruction to install Docker.

## E05 — Compose networking

https://docs.docker.com/compose/how-tos/networking/

Use: Explicit networks/service identities and changed addresses; default networking is not assumed to enforce the phase egress policy.

## E06 — Playwright visual comparisons

https://playwright.dev/docs/test-snapshots

Use: Actual screenshots and same-environment comparisons, not human visual/device approval.

## Claim boundaries

The supplied roadmap, code snippets, schemas and scenarios are original implementation proposals. Existing capabilities are grounded in the pinned source. External documentation informs safety/compatibility principles only. No provider benchmark, customer-utility conclusion, production protection claim or human approval is derived from those documents.
