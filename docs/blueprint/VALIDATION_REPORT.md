# Planning package validation

Executed against the supplied synthetic examples only.

- PASS: Graph schema and synthetic fixture pass
- PASS: Scene schema, membership, allowed zones, and module constraints pass
- PASS: Graph relationship and provenance references resolve
- PASS: All 4 synthetic events validate and resolve evidence
- PASS: Rejected invented asset
- PASS: Rejected duplicate asset membership
- PASS: Rejected unauthorized zone
- PASS: Rejected incompatible module
- PASS: Rejected model-supplied security status
- PASS: Rejected executable-content field
- PASS: Rejected graph revision mismatch
- PASS: Rejected omitted asset

Not tested: a working app, renderer, live collection, identity correlation, geometric layout, throughput, cryptographic evidence, production authorization, or real infrastructure.
