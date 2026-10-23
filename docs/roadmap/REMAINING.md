# What remains on the forward roadmap

Historical CI baseline: `main` bbff323 (2026-10-23). Local follow-up: [`COMPLETION-2026-10-23.md`](../quality/COMPLETION-2026-10-23.md). Machine-readable ledger: [`STATUS.json`](STATUS.json). Per-package evidence: `R0x-RECEIPT.md`.

**The historical ledger records 45 of 52 packages as CI-verified. Seven retain external completion gates.** Local follow-up fixes, visual checks and integration evidence are recorded separately; they do not confer new CI or human approval. The owner explicitly deferred AWS and all notification destinations, including Slack.

## External completion gates (7)

| Package | What it is | What unblocks it |
|---|---|---|
| R00.5 | Close the remaining design release gates | Humans run the prepared packet (`R00.5-MANUAL-REVIEW-PACKET.md`): screen reader, keyboard, real GPUs/devices. |
| R06.4 | Polish composition with measured usability and performance | Usability sessions and physical-device performance measurements. |
| R08.3 | Laboratory-only containment executor | Explicit owner authorization plus an isolated lab environment. R08.4 verification is already built. |
| R10.3 | Team-scale storage | A measured workload showing SQLite is no longer enough. Building it before then is out of policy. |
| R10.4 | Multi-environment federation | Authorization and access to two or more real environments. |
| R11.2 | Approved model evaluation with independent review | Muse Spark provider/budget approved and local evaluation work recorded in the completion receipt; independent human review remains required. |
| R11.3 | Outside-user utility validation | External participants. |

## Integrations with remaining external verification

The historical checks use fixtures. The completion receipt adds one public OSV feed check and approved model evaluation; neither establishes production deployment readiness for other integrations.

| Package | Gate | What clearing it means |
|---|---|---|
| R02.4 | authorized_provider_access | Read-only access to a real cloud identity/audit source. |
| R03.5 | authorized_notification_destination | Deferred by the owner; no destination configured or contacted. |
| R04.2 | external_feed_access | Public OSV format verified with synthetic SBOMs; real inventory and other feed integrations remain unverified. |
| R05.4 | model_provider_and_budget_approval | A model provider and budget for the optional case assistant. |
| R09.1–R09.4 | authorized_provider_access | Read-only access to real edge, workload, data and SaaS providers. |
| R10.1 | identity_provider_for_live_verification | A real identity provider for deployment sign-in. |
| R10.5 | owner_release_settings | Owner turns on release signing, provenance attestation, tag protection and the proposed branch ruleset. |

## Also outstanding (not roadmap packages)

- Human confirmation of the agent eval v1 review packet (`eval/review/v1-human-review-packet.md`).
- Rapid timeline keyboard scrubbing and redundant findings-queue updates were fixed locally, with Castle/Graph browser regressions. See the completion receipt for verification.
- Browser readiness and resource diagnostics received local fixes; new CI results and physical-device review are still required.
