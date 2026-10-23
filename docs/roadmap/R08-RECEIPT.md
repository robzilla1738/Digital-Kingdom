# R08 receipt

## R08.1 bind response authorization to real subjects and policy

Delivered: token `subject` binding, Principal.subject (`oidc:`, `person:`, `token:`), migration 17 (subject columns, `containment_approvals`), per-subject approval counting, approval policy route, subject in audit actor.

Acceptance (`apps/server/test/approvals-r08.test.ts`, 4 tests):
- With two approvals required, two tokens bound to alice@corp count once (409 on the second); bob@corp completes it; the audit names both subjects.
- A requester using a second token for the same person is refused.
- A service (agent) token cannot approve, change approval policy, disable a source or mint tokens; a project-scoped admin cannot change approval policy.
- Revoking an approver's token drops their approval; changing the policy makes the request stale and no earlier approval counts.

Break-glass: the only emergency path is filesystem-level `pnpm admin:recover` (R10.1), which grants no approval and is audited. No executor exists (R08.3 is gated).

## R08.2 exact response plans and revalidation

Delivered: `apps/server/src/response-plan.ts` (`buildPlan`, `precheck`, `targetFingerprint`), plan columns on containment requests, plan and precheck routes, plan digest folded into the approval plan digest and staleness.

Acceptance (`apps/server/test/plans-r08.test.ts`, 4 tests):
- Changing a parameter yields a new plan digest and the earlier approval no longer counts.
- A target that becomes a different provider resource fails precheck and approval (409).
- `secrets.rotate_credentials` is irreversible, with no rollback and explicit compensation.
- Without an independent effect observer on the targets, `verified_success_possible` is false; an extra `command` parameter or shell metacharacters are refused; precheck states there is no executor.

## R08.4 containment verification

- Candidate: roadmap/batch4 (commit follows this receipt).
- Changed: apps/server/src/verification.ts (new), db.ts (inline migration; verification.ts imports the store so importing it from db.ts would be circular), app.ts routes, test/verification-r08.test.ts, hardening teardown.
- Commands: pnpm -s typecheck (clean); npx vitest run apps/server/test/verification-r08.test.ts (5 passed); npx vitest run (577 passed, 1 skipped, 81 files).
- Acceptance: (1) provider accepted, observer records the attacker's success after the window: failed, case remains unresolved; (2) descendant key with surviving permission: failed and named; (3) legitimate traffic present before, absent after while the observer reports: disruption_detected; (4) results carry tested_scope (targets, observers, window, identities, actions) and unassessed paths (downstream assets without observers).
- Scope: verification of a change made outside Digital Kingdom and reported by the operator (provider_accepted, accepted_at). There is no executor (R08.3 stays gated); nothing here calls a provider.
- Migration/rollback: adds containment_verifications only.
- Next: R08.3 lab executor (needs explicit lab execution authorization) would feed reports automatically.
