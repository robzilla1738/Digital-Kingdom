# Digital Kingdom: current-main forward roadmap

This package continues the integrated main implementation at
`14d205fc295d0d8584f8c81d183193c4d75dc96d`. It does not replace the repository,
request a rebuild or authorize deployment.

## Read in this order

1. `ROADMAP_FROM_MAIN.md`: current state, source-traced correctness work, full
   product direction, twelve workstreams, milestones and first implementation batches.
2. `CAPABILITY_GAP_MATRIX.json`: how the existing 24-capability product blueprint
   maps to the inspected current code rather than an assumed empty project.
3. `IMPLEMENTATION_BACKLOG.md` or `BACKLOG.json`: 52 dependency-aware implementation
   packages with files, deliverables, tests and gates.
4. `SURFACE_EXPANSION_MATRIX.json`: all 28 proposed security surfaces and how they
   should enter the castle only with accurate operational backing.
5. `AGENT_CONTINUE_FROM_MAIN.md`: the prompt for the implementation agent.
6. `CURRENT_MAIN_EVIDENCE.json`, `INSPECTION_SCOPE.md`, `SOURCES.md`: what was actually
   reviewed, exact CI results and limits.

`CONTROLLED_SCENARIOS.json` preserves the 16 previously proposed scenario designs.
It is a design reference, not a results file. `CURRENT_MAIN_OVERVIEW.jpg` is a
synthetic screenshot from the reviewed main's CI artifact, not a newly designed
mockup or live customer environment.

All backlog statuses start `proposed_not_started`. They refer to work recommended
by this review, not a claim that the current repository has no corresponding
foundations. Reconcile against any newer code before implementation.

Manual usability/accessibility, real-device measurements, provider verification,
paid evaluations and production execution retain their own external gates.
Independent local work may continue around a blocked gate without claiming that
the gate passed. Response-dependent scenarios are not prerequisites that must
be falsely passed before the executor exists.

The manifest checks packaged-file integrity and the validation report checks
plan structure. Neither proves that future implementation is correct or secure.
