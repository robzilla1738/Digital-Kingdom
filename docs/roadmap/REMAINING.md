# What remains on the forward roadmap

As of `main` bbff323 (2026-10-23). Machine-readable ledger: [`STATUS.json`](STATUS.json). Per-package evidence: `R0x-RECEIPT.md`.

**45 of 52 packages are CI-verified. 7 are blocked on decisions or resources only the owner or outside people can provide.** No further work can be completed honestly inside the repository alone.

## Blocked — not started (7)

| Package | What it is | What unblocks it |
|---|---|---|
| R00.5 | Close the remaining design release gates | Humans run the prepared packet (`R00.5-MANUAL-REVIEW-PACKET.md`): screen reader, keyboard, real GPUs/devices. |
| R06.4 | Polish composition with measured usability and performance | Usability sessions and physical-device performance measurements. |
| R08.3 | Laboratory-only containment executor | Explicit owner authorization plus an isolated lab environment. R08.4 verification is already built. |
| R10.3 | Team-scale storage | A measured workload showing SQLite is no longer enough. Building it before then is out of policy. |
| R10.4 | Multi-environment federation | Authorization and access to two or more real environments. |
| R11.2 | Approved model evaluation with independent review | A provider and budget approval (about $5 proposed for eval v2) and a human reviewer. |
| R11.3 | Outside-user utility validation | External participants. |

## Built and CI-verified, but only against fixtures (external gate still open)

These work locally and in CI. They are **not** validated against real systems until the gate is cleared.

| Package | Gate | What clearing it means |
|---|---|---|
| R02.4 | authorized_provider_access | Read-only access to a real cloud identity/audit source. |
| R03.5 | authorized_notification_destination | A real webhook/alert destination the owner approves. |
| R04.2 | external_feed_access | Access to a live vulnerability feed. |
| R05.4 | model_provider_and_budget_approval | A model provider and budget for the optional case assistant. |
| R09.1–R09.4 | authorized_provider_access | Read-only access to real edge, workload, data and SaaS providers. |
| R10.1 | identity_provider_for_live_verification | A real identity provider for deployment sign-in. |
| R10.5 | owner_release_settings | Owner turns on release signing, provenance attestation, tag protection and the proposed branch ruleset. |

## Also outstanding (not roadmap packages)

- Human confirmation of the agent eval v1 review packet (`eval/review/v1-human-review-packet.md`).
- Known bug: very rapid timeline keyboard scrubbing can trigger React error #185.
- Redesign browser suite has occasional CI flakes.
