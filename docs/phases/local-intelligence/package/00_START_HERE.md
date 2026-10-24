# Digital Kingdom — Local Intelligence Phase

**Continue, do not rebuild.** This package is grounded in main `9fec7ed24dea46157af8a7c0ef09bee77c2ffa88`, rechecked on 2026-10-23. Recheck actual HEAD before implementing.

## The next product milestone

An AI and a person can investigate an incident, compare repairs, apply an authorized repair to a disposable local application, independently verify the effect, and replay the whole case in a richer castle—all without connecting a third-party infrastructure account.

The laboratory proves scoped engineering behavior. The same investigation features remain useful on ordinary authorized evidence; this is not a pivot into only a game or simulator.

## Contents

| File | Purpose |
|---|---|
| `01_PHASE_SPEC.md` | Complete product, architecture and behavior specification |
| `02_AGENT_HANDOFF.md` | Durable instructions for the implementing agent |
| `03_IMPLEMENTATION_BACKLOG.md` / `BACKLOG.json` | 32 dependency-linked work packages |
| `04_AI_LOOP_AND_EVALUATION.md` | Agent loop, private truth, permissions and scoring |
| `05_CASTLE_WORLD_SPEC.md` | Hierarchy, six new families, interiors, layers and comparison |
| `06_SECURITY_AND_AUTHORITY.md` | Run ownership, isolation, leases, privacy and model limits |
| `07_CONTRACTS_AND_COMPATIBILITY.md` | Proposed schemas and semantic/runtime requirements |
| `ACCEPTANCE.json` | 128 requirements, all initially not_run |
| `SCENARIOS.json` / `SCENARIO_CATALOG.md` | 24 local scenario families; not executed tests |
| `DEFERRALS.json` | External gates deliberately deferred without blocking this phase |
| `CURRENT_MAIN_BASELINE.json` | Reuse anchors, reviewed risks and inspection scope |
| `contracts/` and `examples/` | Five proposed schemas, illustrative examples and negative data fixtures |
| `prompts/M0.md` … `M7.md` | Eight implementation milestone prompts |
| `MASTER_PROMPT.md` / `CONTINUE_PROMPT.md` | Paste-ready starting/continuation instructions |
| `SOURCES.md` / `SOURCES.json` | Pinned repository and primary documentation sources |
| `tools/validate_handoff.py` | Package consistency, dependency and example validation only |
| `VALIDATION_REPORT.json` / `FILE_MANIFEST.json` | Generated handoff checks and hashes |

## What is deferred

Cloud/identity/SaaS accounts, remote notifications, production actions, outside-user testing, manual human review, physical-device certification, federation/team storage without need, new paid provider calls without approval, and merge/deployment administration.

Deferral does not erase normal automated engineering tests. It also does not grant those external capabilities or turn pending acceptance into a pass.

## Start

Give the agent this folder and `MASTER_PROMPT.md`. It recovers the existing work, starts LP00, and progresses through ready packages. Use `CONTINUE_PROMPT.md` between sessions. No old from-scratch prompt is needed.

The package’s examples include fictional IDs, digests and verdicts solely to demonstrate schema shapes. They are not real test outcomes, authorization leases or provider evidence.

## Package checking

With Python 3 and `jsonschema` available, run:

```text
python tools/validate_handoff.py
```

It validates this handoff, not Digital Kingdom. Application, model, browser and local-runtime checks happen during implementation and must have separate receipts.
