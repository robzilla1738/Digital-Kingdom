# Deterministic synthetic redesign fixtures

These fixtures are separate from frozen evaluation cases. They are available only in the explicit offline synthetic build; applying them to a server-backed or live Dataset throws. Fixed clock: 2026-10-20T14:13:00.000Z. Layout seed: 20261022. Evidence identifiers remain canonical within the base synthetic corpus.

- F01/reference: 13 existing synthetic assets, valid service/great_hall presentation to show all ten module types. No evidence changes.
- F02/F03/F05/F07/F09: existing bundled source-reported block, contradiction, unobserved asset, shared address, and late-arrival records. Browser tests select those exact records; no detection result is fabricated.
- F04/partial: one extra disabled source on an asset with a reporting source. Administrative disability never counts as reporting.
- F06/unlinked: one ordinary successful data-access record with no finding association, a harmless synthetic report-read payload.
- F11/untrusted: long Unicode and HTML-like asset label rendered as text.
- F12/scale50 and F13/scale200: deterministic additional inventory-only assets, explicitly unobserved; no synthetic evidence is implied for them.
- F14/empty: empty inventory and records, explicit not-compiled-empty-project presentation.
- F08/F10/F15/F16: API-backed browser tests use canonical seeded synthetic records in a fresh temporary/in-memory server, role-scoped temporary tokens, and explicit network fault injection. These are not production-backend fallback mechanisms.

The browser suite keeps screenshot evidence separate from the unchanged isolated-live pilot. A screenshot is not human approval, a source-to-screen proof, or a real-GPU benchmark.
