# Prior candidate: 66ce8f3

Candidate `66ce8f347fe60bba34b87e7d1b089183e78643cb` passed 369 unit tests, all 11 original pilot scenarios and 73 supplemental browser cases, with one genuine hidden-tab skip. Its 240-target touch audit and 11 shell controls also passed. See [the bounded test summary](test-summary.json).

**It was not delivery-complete.** Specification §15.3 also requires isolation of an attributable shader compile failure. That path remained unimplemented; the passing geometry-construction failure test did not prove shader isolation. This is a missing implementation/proof, not a claimed production incident or an observed failure of the passing tests.

The complete sealed execution corpus, all 73 screenshots, shell receipts, publication audit and summary are preserved unchanged in ignored local `nonfinal/prior-66ce8f3/`. They are superseded evidence, not the replacement final run. Human, hardware, assistive-technology and genuine hidden-tab gates remain unapproved. No deployment or merge occurred.
