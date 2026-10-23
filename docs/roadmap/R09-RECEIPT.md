# R09 receipt

## R09.1 edge, DNS, API and webhook pack

- Changed: packages/graph-core/src/packs/edge.ts, packages/graph-core/test/packs-r09.test.ts.
- Commands: pnpm -s typecheck (clean); npx vitest run packages/graph-core/test/packs-r09.test.ts (16 passed, 4 per pack).
- Acceptance (fixtures): certificate hostname stays discovered_lead without a matching challenge; unlisted or expired origins refused; same path in prod and staging are distinct routes; frontend and webhook results list blind spots.
- Blocked (gate authorized_provider_access): live DNS, CT logs, Cloudflare/WAF feeds and any origin probe.
- Migration/rollback: none.

## R09.2 workload, queue and runtime pack

- Changed: packages/graph-core/src/packs/workload.ts, test in packs-r09.test.ts.
- Commands: pnpm -s typecheck (clean); npx vitest run packages/graph-core/test/packs-r09.test.ts (16 passed, 4 per pack).
- Acceptance (fixtures): pid 42 reused on n1 yields two lifetimes; a consumer without a shared message id is adjacent only; uncovered nodes are listed; scaling to 40 replicas keeps slots api=0, worker=1.
- Blocked (gate authorized_provider_access): live Kubernetes, Hubble and serverless feeds.
- Migration/rollback: none.

## R09.3 data, RAG, secrets and backup pack

- Changed: packages/graph-core/src/packs/data.ts, test in packs-r09.test.ts.
- Commands: pnpm -s typecheck (clean); npx vitest run packages/graph-core/test/packs-r09.test.ts (16 passed, 4 per pack).
- Acceptance (fixtures): no audit coverage -> unknown and the gap is reported; cross-tenant probe denied while own-tenant returns, a mis-tenanted document reports broken; latest failed restore -> failed; secret_value and rows fields are refused.
- Blocked (gate authorized_provider_access): a live database audit adapter, object-store events, vector stores.
- Migration/rollback: none.

## R09.4 SaaS, endpoint and correspondence pack

- Changed: packages/graph-core/src/packs/saas.ts, test in packs-r09.test.ts.
- Commands: pnpm -s typecheck (clean); npx vitest run packages/graph-core/test/packs-r09.test.ts (16 passed, 4 per pack).
- Acceptance (fixtures): shared account -> human null; plan retention, missing data-access logs and ungranted scopes listed; grant_added and data_read reported separately; EDR install then removal flips coverage true -> false.
- Blocked (gate authorized_provider_access): live identity provider, endpoint and mail/collaboration feeds.
- Migration/rollback: none.
