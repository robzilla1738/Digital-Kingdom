# R00 receipt: dependable integrated baseline (milestone M0)

Roadmap: `docs/roadmap/forward-from-14d205f/` (owner-supplied, 52 packages). Ledger: `docs/roadmap/STATUS.json`.
Branch: `roadmap/r00-correctness`, based on `main` = `14d205fc295d0d8584f8c81d183193c4d75dc96d`.
Not merged, not deployed. Merging and Pages deployment need owner authorization.

States used here are kept distinct: **implemented** (code exists), **locally verified** (full checks ran
and passed in the sandbox on the recorded tree), **CI-verified** (a CI run on the exact head passed),
**manually accepted** (named human), **provider-verified** (live provider). Nothing in this receipt is
manually accepted or provider-verified.

## R00.1 current-main receipt

Recorded 2026-10-22 20:55 CDT (UTC-05:00) for the baseline, before any R00 change:

| Fact | Value | How checked |
|---|---|---|
| main HEAD | `14d205fc295d0d8584f8c81d183193c4d75dc96d` | `git rev-parse origin/main` |
| CI on exact head | run `39872878689` (`ci`, push to main): success | GitHub Actions API, `head_sha` filter |
| Pages on exact head | run `39872878685` (`demo-pages`): success | same |
| Served build | `<meta name="dk-build" content="14d205f…">` on https://robzilla1738.github.io/Digital-Kingdom/ | `curl` of the live page, 2026-10-23 01:54 UTC |
| Tests at baseline | 376 tests / 43 files (CI log; roadmap evidence) | carried from the run above, not re-run here |
| Browser results at baseline | 11 pilot; 77 redesign expected, 1 skipped (hidden-tab), 0 unexpected, 0 flaky | roadmap `CURRENT_MAIN_EVIDENCE.json` (artifact of run 39872878689) |

Not inherited: the counts above belong to `14d205f` only. The R00 candidate gets its own numbers below and
its own CI run; a failed candidate cannot borrow either.

Frozen and untouched: `docs/redesign/ACCEPTANCE.md`, `docs/redesign/acceptance-results.json`
(69 passed / 16 blocked / 1 not run at their own candidate), `eval/runs`, eval scenarios v1, grading v1.
The hidden-tab skip and all human/hardware gates remain open (see R00.5).

Reconciled open threads from earlier work: browser pilot (merged in PR #1), investigation-honesty and
quality-gates (on main via 860a315), castle refresh (14d205f). Still open and not addressed here: the
pre-existing React #185 on very rapid timeline keyboard scrubbing; v1 human review packet (pending human);
v2 agent evaluation (needs provider + budget approval).

## R00.2 typed, namespaced correlation

Problem (source-reviewed, now reproduced in tests): `dk-rules-1.0.1` joined identifier strings with no
authority. A success with `session_ref` or `actor_ref` equal to the failure key linked regardless of
source, identifier type or asset; privilege changes linked equal raw session strings across sources; agent
effects were corroborated by any tool call with an equal `run_id`.

Change:

- `packages/detections/src/correlation.ts`: correlation identity = project + namespace + type + value.
  Namespaces come only from the server-side source declaration (`identity_namespace` for actor/session,
  `run_namespace` for run ids); an undeclared source is private (`source:<id>`, prefix reserved).
- `rules.ts` → `dk-rules-1.1.0`; `auth.repeated_failure`, `authz.sensitive_change`,
  `agent.enforcement_denied`, `agent.effect_observed` → rule version 2. Joins require the same namespace and
  type (and, for sign-in successes, the same asset). Equal text elsewhere is disclosed in `not_claimed` or
  `coverage_gaps`, never linked. An effect whose only same-text tool calls come from another namespace is
  `medium` with an explicit gap instead of a claimed wrapper bypass.
- Finding ids are kept when only one authority uses an identifier; when two collide, the lexicographically
  first namespace keeps the 1.0.x id and the other gets `…|ns:<namespace>`. Stored findings are not rewritten:
  re-evaluation appends a revision.
- Server: migration 4 adds `sources.identity_namespace`/`run_namespace` (NULL = private); validated on
  `POST /api/projects/:p/sources`; returned in source lists and snapshots; shown in the evidence pane;
  `CORRELATION_NAMESPACES` disclosure text in event search updated.
- Demo fixture declares the real authorities: `src-auth` + `src-app` share `idp:castle-gate`;
  `src-agent` + `src-sink` share `agent-runtime:support-agent`. Demo findings are unchanged in substance.

Evidence:

- `packages/detections/test/correlation.test.ts` (16 tests). Pre-fix run against the 1.0.1 rules:
  **8 failed / 8 passed** — the 8 negatives (cross-source `admin`, actor-vs-session, cross-asset, merged
  authorities, id collision, app-local session, unrelated runtime run id, demo without declarations).
  Positive controls (same source; declared shared issuer; independent observer in a declared run namespace;
  effect with no call anywhere still `high`) passed before and after.
- Two existing tests in `detections.test.ts` relied on undeclared cross-source run joins; their source
  fixtures now declare `run_namespace` (assertions unchanged).

Not supported (stated, not hidden): session lifetimes/expiry are not modelled because events carry no
session validity interval; trusted `request_id` keeps its existing contract (both events must be trusted);
decoy grouping still uses asset + rule reference.

## R00.3 route resolution

Problem: `securityContext` picked the asset with the most matching events in the newest 20,000 events.

Change:

- Graph schema v0.2 (additive, optional): asset `routes: [{ path, methods?, hosts? }]`; manifest importer
  accepts `"METHOD /path"` strings or mappings and rejects malformed routes with 422 issues.
- `packages/graph-core/src/routes.ts`: route query = method + host + path + environment; segment-exact
  template matching (`{id}`, `:id`, trailing `/*`), never prefix matching.
- `apps/server/src/context.ts` `resolveRoute`: declared inventory first (provenance `graph:<revision>`,
  independent of event windows); otherwise ownership inferred from stored events (all events, bounded at
  200,000 routed rows, flagged if limited) and labelled `inferred_from_events`.
  - Context: ambiguous → 409 listing candidates; invalid → 400; none → 404.
  - Assessment: an ambiguous route is assessed against every candidate; inferred ownership adds an
    `ownership_inferred` sufficiency reason, so it can never be favorable; `route_resolution` and
    `target_resolution.assets_assessed` added (additive to `dk.change_assessment.v2`); optional `environment`
    input; malformed bodies → 400.
- MCP `dk_security_context` and `dk_assess_change` accept `environment` and describe the new behaviour.

Evidence: `apps/server/test/routes-r00.test.ts` (11 tests). Pre-fix run against the previous resolver:
**6 failed / 5 passed** (the busier `partners-api` was chosen for `/login`; declared-only routes 404'd; no
inferred labelling). The 4 helper tests and the body-validation test exercise new code only.
The demo graph has no route inventory, so demo route lookups are honestly `inferred` (existing
`/admin/roles` test still resolves to `orders-api`). Assessment of an actual candidate diff remains R04.4.

## R00.4 contracts and data boundaries

- `date-time` formats are enforced in the agent-schema tests (`ajv-formats`); invalid `coverage_as_of`
  values fail. Pre-fix probe: the new test failed and ajv logged `unknown format "date-time" ignored`.
- **Real defect reproduced and fixed:** rejection and quarantine details echoed producer-supplied values,
  so a credential-shaped value in an identifier (for example an AWS-style key as an asset id) reached the
  ingest response, `rejections`, `quarantine` and the project health and snapshot views. `safeDetail()` now masks token-shaped values and
  bounds length everywhere a detail is stored or returned. Pre-fix run: the test failed on `AKIA…` in the body.
- Token revocation: `POST /api/tokens/:id/revoke` (human admin within scope; `*` tokens only by an
  installation admin; last installation admin protected), deletes derived sessions, audited. A revoked token
  cannot resume a cursor by bearer or session; a token without project scope cannot use another project's
  cursor; cursors cannot move between projects.
- Bounded inputs: oversized `limit`, filter values, cursors and value lists are rejected (400/422) without
  echoing the input. Instruction-like text cannot become an identifier (schema pattern) and is returned as
  `untrusted` data in free-text fields.
- Poison rows: 50 malformed journal rows ahead of one valid event are all accounted for (25 quarantined,
  25 rejected) and the valid event is processed in the same pass.

Evidence: `apps/server/test/boundaries-r00.test.ts` (7 tests), `packages/contracts/test/agent-schemas.test.ts`
(+1). Query *cost* budgets beyond page/size/interval limits are not implemented (R01.5).

## Candidate checks (sandbox, 2026-10-22 ~20:55 CDT)

| Check | Result | Log |
|---|---|---|
| `pnpm typecheck` | exit 0 | sandbox `/workspace/work/r00/typecheck.txt` |
| `npx vitest run` | **411 passed / 46 files**, exit 0 (baseline 376/43) | `vitest-full.txt` |
| `pnpm validate:fixtures` | exit 0 | `fixtures.txt` |
| `pnpm build` | exit 0 | `build.txt` |
| Source inspector (static demo, Chromium/SwiftShader) | renders "Identity namespace: idp:castle-gate" for src-auth and "Private to this source…" for src-falco; no page errors | `docs/roadmap/img/r00-source-namespaces.png` |
| Playwright pilot / redesign suites | not run locally (sandbox camera/lifetime tests fail on old main too); CI is authoritative | — |
| CI on candidate head | see "CI" below | — |

## CI

Filled after push: see `docs/roadmap/STATUS.json` (`head`, `ci_run`) and the commit that records it.

## Next eligible work

R01.1 (versioned domain facts) and R01.4 (concurrency preconditions), then R01.2/R01.3, per the roadmap's
batch 2. R10 operational work may start in parallel. R00.5 waits on a human reviewer and physical devices.
