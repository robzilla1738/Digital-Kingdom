# li-next B — observer capability state + restart-test-observer candidate (receipt)

Date: 2026-10-24 (America/Chicago). Branch `phase/li-next-b`, cut from main `b0b4a20`. Pushed only this branch; no PR, no merge, no deploy.
Brief: `work/next/NEXT_BRIEF.md`; review `STATUS_REVIEW.md` §C ("Observer gaps are not in the local analysis state, so restarting a stopped test observer is not generated as a repair candidate") and §D (host-process isolation boundary).
No model or provider call was made (no AI Gateway use). Scripted runs only.

## What changed

### 1. Observer capability state + history (supervisor facts, never scenario truth)
- `packages/local-world/src/runtime/observer.ts`: `EffectObserver` now has a fixed `declared` attachment and a current `attached` set, a capability history (`running` / `stopped` / `misconfigured`, `since`, `until`, `reason`), a `detach(resource, reason)` fault (running but detached = misconfigured; effects there are answered `unknown`, "not attached"), and `restart()` re-attaches exactly the declared set. Health intervals (up/down) and their semantics are unchanged.
- `packages/local-world/src/runtime/supervisor.ts`: `Run.observerCapabilities(operatorToken)` → `dk.local.observer_state.v1` (operator/snapshot action only; a verifier or controller identity is refused). Lists every observer resource of the plan; one with no live observer in the compiled world (audit disabled) is `absent` with `revision: null`. Observer revision string is unchanged for up/down (`audit:observer-up-h1`, `audit:observer-down-h2`) and gains `misconfigured` / `-c<n>` only when an attachment changed. The typed operation's "desired" state for `restart_test_observer` is now *healthy* (up AND attached to everything declared).
- `apps/server/src/local-observers.ts` (new): `POST /api/projects/:p/local-observers` (admin = launcher), `GET …/local-observers` and `GET …/local-observers/history` (analyst). Append-only table `local_observer_reports` (migration appended at the end of `MIGRATIONS`). Accepted only for a project with valid local-run provenance and the same run id; observed/declared resources must be graph assets; an observer id that is a service asset or a source registered as anything other than `effect_observer` is refused; states outside `running|stopped|misconfigured|absent|unknown` are refused (422).
- `apps/server/src/exploration.ts`: the latest report becomes `observer` elements (`<id>#observer`, attrs `observer_id, state, declared, observes, asset_ids, since, revision`) and `base.local_observers {id,digest}`. Both appear ONLY when a report exists, so every existing state hash is unchanged.

### 2. Reviewed, typed, plan-only candidate
- `apps/server/src/repair.ts`: new reviewed template `restart-supervised-observer` v1 (appended to `REPAIR_TEMPLATES`; action `restart_test_observer`, applies to `observer_gap`). For an `observer_gap` objective probe naming an observer the supervisor reports `stopped` or `misconfigured`, the generator emits a plan with `{ target_resource_id: <observer>, type: "restart_test_observer", parameters: { observer_ref: <observer> }, expected_target_revision: <reported revision> }` — exactly what the LP20 lease precondition and the LP21 typed operation check. `executed_local` says it needs a lease and an observation handshake; nothing claims verification.
- Unsupported states (`absent`, `unknown`) ⇒ the probe is `unknown` and the set is `no_supported_repair` with the reason "… no applicable candidate".
- When a reported observer is not running and declares a resource an objective probe touches, the result carries `observation_prerequisites` (executed verification of those probes would be unknown/inconclusive). Field present only when a report exists.
- Clean listing for the selection benchmark: `Repairs.rank(projectId, caseId, { base_state_hash, objective })` returns the full ranked candidate set without persisting or emitting; `generate()` stores exactly that result. HTTP: `POST /api/projects/:p/cases/:id/repairs/ranked` (analyst) → same body + `persisted: false`. The legacy server-source observer_gap path (`restart-test-observer` template) is untouched.

### 3. Execution + independent observation handshake
- Execution is only `RepairController` → `Run.leasedOperation` (lease + typed op + journal); no new execution path.
- `packages/local-world/src/runtime/observer-recovery.ts` (new): `verifyObserverRecovery(run, verifierToken, { plan, execution, handshake })` → `dk.local.observer_recovery_verification.v1`. The verifier holds its own identity (`request_route` + `read_effects`; `repair_execute` refused). After the restart a controlled PERMITTED operation is sent; `verified` only when the restarted observer reports that effect for the same supervisor-signed operation id. No handshake ⇒ `unknown`; observer down again / handshake on a resource the observer is not declared to observe ⇒ `unknown`; observer up yet effect not reported ⇒ `failed`; a prohibited operation as handshake is refused. `not_claimed` states that restarting an observer is not a security repair.

### 4. Loop / scenarios
- `eval/local/observer-recovery-loop.ts` (new) + `scripts/local-loop.ts`: `pnpm loop:local` now also runs an observer-recovery leg in its own leased LW-01 world: stop audit (launcher-side fault) → report state → negative control → LP14 candidates → rank-1 plan unmodified → lease → typed restart → handshake → post-restart model check. The LP31 integrated loop's stages, required outcomes and receipt fields are unchanged; the receipt file gains a top-level `observer_recovery` object and the script exits 0 only if both pass.
- `scenarios/local-world/LW-01.json`: three test references added (LW-01 already models the audit-observer outage), so `pnpm scenarios` exercises them.
- `apps/server/test/hardening.test.ts`: the v0.2-upgrade rewind also drops the new table (same pattern as every earlier migration).

## Tests — failing first, then passing
New: `examples/reference-app/next-b-observer-recovery.test.ts` (9), `apps/server/test/next-b-observer-candidates.test.ts` (7).
- Before (commit `64a92b3`, tests only): **14 failed | 2 passed (16)**. The 2 passing-before tests are regression guards on existing LP06/LP22 behaviour (stopped observer ⇒ `unknown`/`inconclusive`, never `not_observed`/`pass`), kept as the explicit negative tests this item asks for.
- After: **16 passed (16)**.
Negative tests covered: stopping the observer never makes a prohibited op look blocked (runtime probe `unknown`→`inconclusive`; policy repair verified with observer stopped ⇒ not `pass`; model still says the cross-tenant read `holds`); restart with no handshake ⇒ `unknown`; observer down again ⇒ `unknown`; no stopped observer ⇒ no observer candidate (`no_repair_needed`); `absent` ⇒ explicit no-applicable-candidate; gateway-policy candidates identical (same template/target/validity/actions) with and without an observer report, and existing LP13/LP14/LP19/LP20/LP21/LP22/LP23/LP31 suites pass unmodified.

Full suite: main `b0b4a20` = 976 tests (975 passed, 1 skipped) per this branch's CI minus the 16 new tests; branch = 992 (991 passed, 1 skipped) — see CI below.
`pnpm typecheck` clean; `pnpm validate:fixtures` PASS; `pnpm scenarios` exit 0 (LW-01/02/03 passed; DK-T06/T10/T11 `unavailable` and DK-T13 `partial_passed` as on main); `pnpm loop:local` → `LOOP OK` (LP31 stages all as before; observer leg: `audit:stopped` → `unknown_as_required` → `single_candidate:restart-supervised-observer` → `completed` (`audit:observer-down-h4 -> audit:observer-up-h5`) → handshake `verified` → `no_repair_needed`).

## CI
- run 40133037585 (`00d0e5f`): failure — `hardening.test.ts` v0.2 rewind did not drop the new table ("table local_observer_reports already exists"); 990 passed / 1 failed. Fixed in `fbb727f`.
- run 40133539256 (`fbb727f`): job `check` **success** — Test Files 141 passed | 1 skipped (142); Tests **991 passed | 1 skipped (992)** (+ the 1-test follow-up suite). Job `browser-pilot` was still running when this receipt was committed; its result and the receipt-commit run are reported in the agent's report-back (this file is append-only for that reason).

## Limitations (unchanged boundaries, stated plainly)
- Host-process mode only: trusted built-in templates and typed operations; no OS-level egress filtering, CPU quota or hostile-code isolation (review §D). Not authority to run AI-generated programs.
- The observer state report, like the configuration snapshot, is launcher-reported and NOT attested. The server checks run id, provenance, graph assets and states, not the truth of the report. The handshake (executed, independent) is the only evidence that observation was restored.
- Restarting an observer restores observation only. Effects during the outage stay unknown; it is never counted as blocking a prohibited operation.
- `misconfigured` is modelled as "running but detached from a declared resource"; other misconfiguration kinds (wrong independence group, wrong key) are out of scope and would be reported `unknown` ⇒ no applicable candidate.
- No AI selection was exercised; `rank()` / `/repairs/ranked` is the hook for the planned selection benchmark.

## Commits
`64a92b3` failing tests first · `a3ae245` runtime · `2533bc3` server · `00d0e5f` loop + scenarios · `fbb727f` hardening rewind · (this receipt commit).
STATUS.json not edited.
