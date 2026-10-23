# R08 receipt

## R08.1 bind response authorization to real subjects and policy

Delivered: token `subject` binding, Principal.subject (`oidc:`, `person:`, `token:`), migration 17 (subject columns, `containment_approvals`), per-subject approval counting, approval policy route, subject in audit actor.

Acceptance (`apps/server/test/approvals-r08.test.ts`, 4 tests):
- With two approvals required, two tokens bound to alice@corp count once (409 on the second); bob@corp completes it; the audit names both subjects.
- A requester using a second token for the same person is refused.
- A service (agent) token cannot approve, change approval policy, disable a source or mint tokens; a project-scoped admin cannot change approval policy.
- Revoking an approver's token drops their approval; changing the policy makes the request stale and no earlier approval counts.

Break-glass: the only emergency path is filesystem-level `pnpm admin:recover` (R10.1), which grants no approval and is audited. No executor exists (R08.3 is gated).
