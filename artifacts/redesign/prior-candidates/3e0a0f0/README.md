# Superseded candidate 3e0a0f0

Application/test source: `3e0a0f0c6423b6b3645c0397f30b59d617edb8c8`.

Automation reported **60 passed, 1 skipped**. This was not complete design acceptance. Actual V04 pixel and prose review found two required presentation gaps:

- Specification 9.1: “expanded” finding detail remained a narrow right inspector instead of occupying the primary content area with a compact queue.
- Specification 9.4: horizontal evidence rows clipped source/action and lacked in-context raw normalized data expansion.

The retained V04a/V04b PNGs and metadata document those failures, not approved final visuals. The test summary preserves the passing automated result and its original report hash without relabeling inadequate assertions as proof of these requirements. The one genuine hidden-tab lifecycle test was skipped because headless Chromium kept both actual tabs visible.

All screenshots use local explicit synthetic data in headless Chromium/SwiftShader. They are neither live-production evidence nor physical-GPU or human approval.

The complete earlier corpus is retained locally under ignored `artifacts/redesign/nonfinal/prior-3e0a0f0`. Raw archives are excluded from publication. Replacement evidence must be bound to a new complete source identity.
