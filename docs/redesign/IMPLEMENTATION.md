# Digital Kingdom redesign implementation

## Review status

This is an implementation and verification branch, not release approval. The 86-criterion acceptance ledger starts with `not_run`; criteria are updated only with specific evidence. Human usability, manual assistive-technology checks, and real-device performance are separate gates. The captured verification phase performed no merge, deployment, paid evaluation, or human approval. The user subsequently authorized putting the necessary task/dependency work onto main after green checks, including monitoring main’s automatic Pages deployment. This does not close any human, accessibility or hardware gate.

## Base and dependency check

- Repository: `robzilla1738/Digital-Kingdom`.
- Implementation branch: `improve/ui-castle-redesign`.
- Inspected base: `fix/investigation-quality-gates` at `453b2db522780361405c388f036d7874041cb005`.
- Existing PR #2 is open and unmerged, based on `improve/investigation-honesty` (`812a9575e5682be0ae915f3f2cf8f74c86d395a6`). The redesign is stacked on the quality-gates branch rather than pretending its dependencies are on main.
- Working tree was clean before implementation. Existing repository contribution and security guidance was read.
- `pages.yml` publishes only a push to `main` or explicit workflow dispatch. Neither was performed during the captured verification phase. Ordinary branch/PR CI runs checks and the isolated browser pilot, not paid agent evaluations.

## Package sequence

1. Read handoff, complete product specification, tokens/contrast/module contracts, work packages, and acceptance criteria.
2. Record base/dependencies, isolate an immutable base, and run baseline checks. Secure real before images before implementation capture.
3. Add presentation-only severity/coverage selectors, privacy-safe navigation, cancellation/generation guards, exact-evidence retention, and explicit empty/error states.
4. Build tokens and component states, four workspace shell, event-first investigation, and shared evidence workflows using existing authorized APIs.
5. Create representative gatehouse, hall, and observatory geometry, inspect their rendered comparisons, and iterate the ten-module kit and large-scene representations. These automated inspections are not the required human visual gate.
6. Exercise semantic, authorization, replay, navigation, accessibility, performance, and frozen-record regression gates. Attach results and limitations to the acceptance ledger.

## Preserved boundaries

- Detection, normalization, redaction, server authorization, event search, exact evidence retrieval, MCP, containment policy, and frozen evaluation records remain authoritative.
- Current source coverage is not a historical coverage reconstruction. Browser connection, stored-query completeness, finding confidence, and source reporting remain separate.
- Offline design fixtures are explicitly synthetic, opt-in, and rejected for server/live data. Failed backend requests do not silently become demos.
- The existing finding-evidence endpoint does not pin arbitrary revisions. Retrieval is bracketed with revision checks and any drift is incomplete. This limitation is shown in the UI.
- Existing mutation endpoints have no optimistic-concurrency precondition. The UI states this rather than claiming conflict safety.
- No browser token persistence, external fonts, analytics, runtime model calls, paid evaluations, or automatic remediation were added.

## Baseline evidence

See [`artifacts/redesign/baseline/README.md`](../../artifacts/redesign/baseline/README.md). Typecheck, fixture validation, build, 223 tests, and 11 unchanged real-server/MCP browser pilot scenarios passed. Baseline test normalization fixes the execution environment's inherited 1% OTLP sampler to `always_on`; it is not a source-code change. Browser evidence uses Chromium headless shell and SwiftShader software WebGL, not a physical GPU benchmark.

## Verification and release gates

Final results, screenshot index, measured conditions, and open limitations are recorded in this directory and `artifacts/redesign`. All unexecuted criteria remain visibly open. A clean automated run cannot substitute for the required human formative-usability and real-hardware gates.

## Frozen source and clean-checkout proof

The tested application/source candidate is `5ce7487c76c87be2b53f6520690987d2c5bdd063`. Typecheck, **376 unit/integration tests**, fixture validation, API and offline production builds, and **all 11 original isolated pilot scenarios** pass. A fresh `git archive` passes the same type/unit/fixture/build checks. Installed external packages are shared, but every `@dk` workspace dependency is relinked to source inside that archive. This validates a clean source checkout, not a fresh dependency download or a different operating system. See the [command receipt](../../artifacts/redesign/final/final-commands.log) and [archive receipt](../../artifacts/redesign/final/clean-archive-receipt.json).

The frozen supplemental browser run passes **77 cases**, with **one explicit hidden-tab skip** and no failures. Exact-source screenshots, accessibility checks and measured conditions are linked from [the evidence index](../../artifacts/redesign/README.md). The acceptance ledger is authoritative about which release gates remain open; successful automated checks do not clear human gates.

## Corrections discovered during review

Initial candidate `e570556` was not deliverable: a broad `coverage` ignore rule omitted required workspace source, and review identified camera return, grouped multi-asset focus, environment placement and current-source selection defects. Those were corrected with reproducing regressions and clean-archive checks.

Candidate `3e0a0f0` passed its automated suites but was subsequently rejected on actual prose/pixel review for missing primary-area finding expansion and complete in-context evidence cards. Its [preserved receipt](../../artifacts/redesign/prior-candidates/3e0a0f0/README.md) records the failures rather than relabeling the old screenshots. A consolidated mandatory-prose audit also identified setup, integration/unknown-assessment disclosure, bounded event display, announcement preference, per-module recovery and operational card typography omissions. The current source implements these corrections and adds direct workflow proofs. The finding comparison remains mounted during expansion, and explicit snapshot loading remains necessary when an operator has pinned an investigation.

Candidate `66ce8f3` passed the expanded-workflow suites but still omitted attributable shader compile-failure isolation under §15.3. Its [superseded receipt](../../artifacts/redesign/prior-candidates/66ce8f3/README.md) preserves that gap. The replacement isolates body, roof and directional-depth programs by canonical module family, checks matching shader-stage ownership and defers recovery outside the renderer stack. Real invalid-GLSL tests exercise native compile/link failure, shared-family notification, healthy replacement and cleanup, rather than dispatching a synthetic success callback.

## Resource-lifetime investigation

A warmed 40-switch comparison isolated retained renderer registrations from ordinary cache warm-up. Final module-owner cleanup now releases GPU registrations on shared geometry/materials while keeping reusable CPU buffers; renderer teardown is guarded against StrictMode replay. DOM/listener counts plateaued after the fix, and the last-ten-switch heap slope fell from approximately 190 to 9 KB per switch. A graph-only control retained a small similar residual slope. This diagnostic used an explicitly recorded working build; the frozen candidate has separate teardown and warmed-switch regression receipts. Neither result proves zero retained memory, native process-wide GPU allocation, or unlimited-duration stability. See [conditions and raw measurements](../../artifacts/redesign/diagnostics/warmed-project-switch-memory.md).

## Explicit remaining limits

- Human architecture/visual judgment, representative-human formative usability, manual assistive-technology tasks, cross-browser/physical-device checks and reference-hardware performance are not approved or simulated.
- Headless Chromium did not produce genuine hidden-tab visibility in the background-tab experiment. That test remains skipped, not a passing suspension claim.
- Software-WebGL timings are workload observations, not physical GPU benchmarks. Main-pass renderer counters exclude shadows; the separate native draw probe explicitly counts the complete default 13-asset frame. Scope and instrumentation overhead are recorded with each result.
- Local visual recovery covers CPU geometry/model construction, React visual-render exceptions, and compile/link failures of explicitly owned body, roof and directional-depth programs. Ownership is bounded to 30 reusable materials across ten module families, never per-asset shader clones. Both shader-stage markers must match a registered material; every affected owner is notified. Unowned scene shader failures use Graph. Arbitrary asynchronous driver faults and invalid stored module IDs are not claimed as individually attributable neutral-block recovery. Actual whole-WebGL context loss has a separate tested Graph fallback.
- Exact evidence uses the current authorized server contract. Arbitrary historical evidence revisions, historical topology/source administration and optimistic-concurrency mutation preconditions are unavailable and disclosed rather than fabricated.
- All design captures use explicitly labeled synthetic data. The isolated original pilot additionally exercises real SDK ingestion and MCP against controlled local reference applications, not a production environment.
- Delivery starts as a stacked review branch and draft PR. The user’s subsequent instruction authorizes integrating only the necessary task/dependency branches onto main after green checks and respecting repository protections, then monitoring main’s automatic Pages deployment. It does not authorize paid evaluations, unrelated work, protection bypasses or human approval claims.

## Delivery-only workflow delta

The application and tests remain byte-identical to the tested source candidate. Delivery adds the evidence/documents plus one CI artifact-hygiene step: after checkout, the browser job preserves the checked-in frozen `final` directory in its unique runner-temporary directory and creates a fresh output directory before installation or tests. Thus a failed or successful new CI run cannot upload old handoff screenshots/seals mixed with new results. The original tracked evidence remains in Git. Workflow triggers, permissions, test commands and deployment scope are unchanged. Shell behavior is checked in an isolated temporary fixture, and CI on the actual delivered head is a separate execution record. See [source binding](SOURCE_BINDING.json).
