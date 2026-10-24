# Receipt — Local Intelligence Phase merged to `main` (current-main addendum)

Appended 2026-10-24. This receipt **adds** to the branch-era record; it does not replace any earlier receipt.
`PHASE_REPORT.md` and `receipts/LP31.md` intentionally keep their branch-stage statements ("not merged; no PR
opened; main untouched") because they were true when written.

## Merge

| Item | Value |
|---|---|
| Pull request | #4 "Local Intelligence Phase (LP00–LP31)" |
| Merged by owner authorization | Robert Courson, 2026-10-24 ("Yes if everything is done") |
| Merged at | 2026-10-24 13:23 CDT (18:23 UTC) |
| Merge commit on `main` | `b0b4a20913d8e341c6b33104d69f8cfdb1f665aa` |
| Previous `main` | `9fec7ed24dea46157af8a7c0ef09bee77c2ffa88` (phase baseline) |
| Branch head merged | `d516c244dd9c35e669091d3371354e4bbbac54db` (CI 40083744325 success) |
| Method | GitHub merge commit; no force-push; no settings changed |

## Exact-head checks on `main` (`b0b4a20`)

| Workflow | Run | Result |
|---|---|---|
| ci (`check` + `browser-pilot`) | [40120502170](https://github.com/robzilla1738/Digital-Kingdom/actions/runs/40120502170) | success (13:23–13:39 CDT) |
| demo-pages (served-build check + deploy) | [40120502164](https://github.com/robzilla1738/Digital-Kingdom/actions/runs/40120502164) | success |

Counts from the CI logs and the downloaded exact-head artifact, as recorded by the external post-merge review
(inspected, not rerun by that review):

- Main vitest invocation: 975 passed / 1 skipped across 140 files; collector test passed in its separate
  checksum-verified 0.112.0 step.
- Browser pilot: 11 passed, 0 failed, 0 flaky. Redesign suite: 110 passed, 1 skipped, 0 failed, 0 flaky.
- Scenario runner: 15 passed, 1 partial, 3 unavailable. Unavailable scenarios stay unavailable; they are not passes.
- Typecheck, fixture validation, build, dependency inventory and release-manifest verification passed.
- CI artifact 12571696491 SHA-256 `6712be84f3d8b0b2c7be50fccfddc48788f93dcf25a07b29c009ee45b12fab1a` matched GitHub's digest.

## How to read current status

- **Integrated loop (`pnpm loop:local`) is scripted.** It records `ai_loop: not_exercised_in_this_run`. Model-driven
  investigation results come from separate evaluations and are not an end-to-end AI repair demonstration.
- **Current model performance**: use the fresh held-out report only (`artifacts/local-intelligence/m7-fresh-eval/REPORT.md`,
  preregistration `li-m7-7f4a12cd`): C1 11/12, C2 11/12, C3 8/12; retrieval 108/108; 0 unsupported affirmatives;
  C3's 10 underclaims all answered "unknown" after unavailable-coverage information. The earlier LP26 run with
  lost records and the corrected cost-attribution incident stay recorded in their own receipts and are not pooled
  into any headline rate.
- External gates EXT01–EXT09 remain deferred by the owner. Nothing here is a production-readiness, GPU,
  outside-user or human-review claim.

## Follow-on work

The post-merge review's next batch (claim-local uncertainty, observer-recovery repair candidates, an AI-selected
local repair benchmark, active-environment framing and attention compaction) is tracked on branch `phase/li-next`
with receipts `receipts/next-*.md`.
