# Local completion and quality review — 2026-10-23

Scope: complete the authorized repository work and polish the application. The owner explicitly deferred AWS and notification services (including Slack). No cloud accounts, notification destinations, production systems, deployment settings, or release protection rules were changed.

## Changes

- Refined every workspace around a shared charcoal/glass visual system, locally bundled Inter Variable and Lucide controls. Pills, fields, tables, navigation, menus, inspector sections and mobile layouts now share consistent spacing and styling. Semantic outcome shapes remain distinct from decorative navigation icons.
- Findings default to four columns; filters and extra evidence/timestamp columns are deliberate controls. Secondary explanations, inventory import, connection setup, new-case fields and additional review guidance use native disclosures. Active warnings, evidence completeness and source disagreement remain visible. Map labels prioritize selected and urgent assets with fewer ordinary labels.
- Replaced slogan headings with direct workspace names, shortened repeated chrome, preserved full accessible names, and removed duplicate finding identifiers. The browser command rebuilds both authenticated and offline bundles to prevent stale-build verification.
- Guided inventory entry points open the correct integration tab and focus the import disclosure, including when another integration tab was previously active. Closing the disclosure remains a native keyboard-accessible action.
- Rapid keyboard replay advances from the reducer’s current position, preserving every keypress. The findings queue only updates when its contents change; replay no longer feeds redundant updates back into the shell. Exact-position input derives its displayed time without an effect on every tick.
- Pinning a finding bundle now reads the immutable bundle endpoint and verifies page identity, revision, digest and reference counts. Changed/missing records remain incomplete, and retries use the same bundle instead of merging current snapshot evidence.
- Failed case creation and item saves preserve drafts. Case switching discards stale reads and resets per-case editors. A successful save followed by a list-refresh failure is explicitly reported as saved, preventing duplicate retries.
- Export previews can close during a pending request, allowing sign-out. Existing authorization-epoch checks still abort requests and prevent stale privileged downloads.
- Inspector section counts have consistent spacing. Desktop Castle, expanded investigation, and 320/390-pixel evidence views were visually inspected; no physical-device or human accessibility approval is implied.
- Optional assistant timeouts abort the provider request; provider error details are withheld. `evidence_linked` means the cited IDs were retrieved, not that a model’s claims are semantically supported.
- Vulnerability applicability uses SemVer precedence and preserves unknown range semantics, ecosystem identity and multiple runtime versions. Unsupported ordering cannot establish remediation.
- Decoy placement parsing accepts all base64url suffixes, including a trailing hyphen. Migration text is independent of Store import order; its SQL is unchanged.
- A stationary Castle remount schedules one follow-up frame so diagnostic counters describe its completed render instead of remaining at their initial zero values. Demand rendering still becomes idle.
- Browser layout checks wait for the renderer's asynchronous resize observer before measuring canvas bounds. Minimum canvas width, no-overlap, accessibility and resource limits remain unchanged.
- The v2 evaluation runner uses real HTTP/MCP transports, scoped service-viewer credentials, fixed clocks, evidence-equivalence preflight, per-call cost reservations and explicit pending human review. The amendment log records all changes made after development inspection and before held-out calls.

## Verification record

| Check | Result | Source revision |
|---|---|---|
| Typecheck, unit/integration tests, fixture validation | Passed; 621 tests across 90 files, including the real Collector test | `d4b7ead` |
| Production and static-demo builds | Passed | UI through `07e33cc` |
| Refined UI browser coverage | 86 unique checks passed across the full run and focused corrections; one hidden-tab check skipped in headless Chromium | `d4b7ead` + `07e33cc` |
| Final focused setup/navigation run | 12/12 passed, including every prior full-run failure and bounded listeners/heap across project switches | `07e33cc` |
| Independent SDK → server → browser → MCP pilot | 11/11 passed | `d4b7ead` |
| Final inventory-shortcut typecheck | Passed | `07e33cc` |

[Verification receipts](../../artifacts/completion/verification.json) retain log hashes; the [browser receipt](../../artifacts/completion/browser-verification.json) lists every check and its source run. The full UI run recorded 81 passed, five failed and one skipped. Disclosure-aware test corrections and a direct inventory-navigation fix were then verified in the focused 12-test run. This is combined coverage, **not** a claim that the original full run passed. Intermediate failed and interrupted runs remain in ignored local artifacts.

Node 22.23.4 and pnpm 10.12.1 were used. Final UI browsers use pinned Playwright 1.56.1 / Chromium 141.0.7390.37 with SwiftShader. The earlier independent pilot used a newer local Chromium; the final 11-test pilot was rerun on the pinned browser. Browser checks include 320/390px layouts, desktop, automated accessibility, reduced motion, forced colors, keyboard focus, exact evidence, export authorization and renderer/resource lifetime. They do not replace human accessibility or physical-device review.

The 11-test independent browser pilot passed. The pinned OpenTelemetry Collector 0.112.0 also passed real local export, retry during an outage, restart, and decompression-bound checks; its [archive checksum](../../artifacts/completion/collector-binary.json) was verified before execution. A 10,000-delivery local exercise accepted 7,000 and throttled 3,000 under its configured source budget, processed the accepted records, and verified encrypted backup/restore (`restore_ok: true`). This is a functional local exercise on a busy development machine, not a production throughput benchmark.

The [soak receipt](../../artifacts/completion/soak-receipt.json) retains those measurements. The [scenario receipt](../../artifacts/completion/scenario-receipt.json) records 12 passed scenarios, three unavailable scenarios (provider discovery and the authorized containment lab), and one partial pass pending model review. Unavailable scenarios are not counted as passes.

A public OSV query was tested against synthetic lodash source/runtime SBOMs. [The receipt](../../artifacts/completion/osv-live-receipt.json) records the advisory, fetch timestamp, response hash, affected version and fixed version. This proves one live public feed format, not a real installation or KEV/EPSS integration. Range handling follows the [OSV specification](https://ossf.github.io/osv-schema/#affectedrangestype-field).

## Approved model evaluation

The [full Muse Spark report](../../artifacts/completion/evaluation/REPORT.md) records 408/408 attempts with no run halt: 378 completed, 29 completed after exhausting their tool allowance, and one reached its model-call limit. Automatic objective criteria marked 41 attempts unsuccessful. These outcomes remain in the denominators; completing a provider call is not equivalent to a successful investigation.

The total shared ledger charge was **$0.939669258 of the approved $5**, including the 36-attempt development run and the 13-attempt interrupted launch. No reservations remain. The interrupted launch exposed a preflight response-envelope comparison bug during regression testing; it was fixed before held-out calls. Its receipt is retained separately.

Independent semantic review remains pending. The prepared packet selects 132 attempts, including all 59 flagged attempts and a seeded sample of unflagged responses. No human judgments, end-to-end accuracy, interface-superiority result or injection-immunity claim is fabricated. [Provenance and review instructions](../../artifacts/completion/evaluation/README.md) identify the original local transcripts and hashes.

## Gates deliberately still open

- Independent human semantic review of model outputs, and the existing v1 review packet.
- Human screen-reader/keyboard review, usability sessions and physical GPU/device measurements.
- Outside-user utility validation.
- Authorized containment lab and multiple real environments for federation.
- Team-scale storage migration only after a measured need.
- Real provider/identity integrations, notification delivery and owner-controlled release signing/protection settings. AWS and notification work were explicitly deferred.

These gates are not replaced by synthetic tests, software-rendered browser screenshots, or an automated model score. The historical roadmap’s CI receipts remain historical; local follow-up checks do not silently become new CI approval.

## Visual review

The refined interface was inspected in both the static demo and an authenticated isolated server:

- [Findings](../../artifacts/completion/ui/investigate.png), [mobile findings](../../artifacts/completion/ui/mobile.png), and [expanded investigation](../../artifacts/completion/ui/expanded.png).
- [Castle](../../artifacts/completion/ui/castle.png), [Graph](../../artifacts/completion/ui/kingdom.png), and [inspector](../../artifacts/completion/ui/inspector.png).
- [Coverage](../../artifacts/completion/ui/coverage.png), [Integrations](../../artifacts/completion/ui/integrations.png), [Cases](../../artifacts/completion/ui/cases.png), and [new-case disclosure](../../artifacts/completion/ui/new-case.png).

Adjacent metadata records viewport, browser, build and image hashes. Earlier screenshots remain under `artifacts/completion/before-ui/` for comparison. All screenshots use synthetic data and software rendering.
