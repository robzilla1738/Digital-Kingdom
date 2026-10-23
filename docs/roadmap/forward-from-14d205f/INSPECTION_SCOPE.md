# Inspection scope

## Actually checked

- Resolved main through the connected GitHub API to
  `14d205fc295d0d8584f8c81d183193c4d75dc96d`, enumerated its recursive tree and
  read current change history, implementation notes, capability/acceptance docs,
  selected core contracts and important backend/MCP/frontend paths.
- Inspected exact-head CI workflow/job status and the check-job log, rather than
  relying only on the README's test count.
- Downloaded CI artifact `12467382603` from run `39872878689` through the connector.
- Parsed the actual pilot/redesign JSON results and checked build/hash metadata
  for five selected screenshots.
- Visually inspected the selected current synthetic screenshots. The included
  overview JPEG is a conversion of the reviewed PNG, not an image-generation
  mockup. PNG hash references in CURRENT_MAIN_EVIDENCE.json refer to original
  artifact PNGs; FILE_MANIFEST.json covers the packaged JPEG separately.
- Read previous product/design specifications as intended scope and reconciled
  their 24 capabilities and 28 surface mappings with the reviewed current code.
- Rechecked main before completing the roadmap; it was unchanged.

## Not performed

No repository writes, merges, deployments, paid model calls, provider probes,
production tests, full independent local test rerun, interactive new browser run,
physical-device/GPU benchmark, human usability approval, or exhaustive line-by-line
security audit. Local source-archive download was unavailable; connected source
reads and actual CI artifacts were used instead.

## How to interpret the two source-traced findings

The correlation predicates and route-ownership heuristic were read in the pinned
source. Their potential misleading outcomes are reasoned from that code, not a
claim that a customer incident occurred or that a complete integration exploit
was executed. The first engineering task is a focused failing regression, followed
by the minimal coherent fix and full required checks.

## Artifact results versus acceptance

The exact-head automation passed, with one recorded redesign skip. That does not
close manual visual/assistive-technology/hardware gates. The earlier frozen 86-item
ledger describes its own candidate and remains historical. Main integration should
get a new receipt rather than overwrite that evidence.

The roadmap's future work packages have not been executed by this review. Its
package validation checks file integrity, valid JSON, dependency acyclicity and
cross-references, not software correctness or security.
