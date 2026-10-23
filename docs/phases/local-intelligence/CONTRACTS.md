# Local Intelligence Phase — contracts, provenance and support matrix (LP03)

Adopted from the phase package's proposals (`package/contracts/`) and adapted to the existing `@dk/contracts`
conventions: JSON Schema 2020-12 in `packages/contracts/schemas/local/`, precompiled by `pnpm generate:validators`
(no runtime code generation), wrapped with semantic checks in `packages/contracts/src/local.ts`.

| Contract id | Schema | Purpose | Semantic checks beyond the schema |
|---|---|---|---|
| `dk.local.run_provenance.v1` | `run-provenance.v1.schema.json` | A project's records come from a local synthetic run | consts: `data_origin: synthetic_local`, `scope: local_run_only`, `external_validation: not_performed` |
| `dk.local.world_plan.v1` | `world-plan.v1.schema.json` | Blueprint instance: finite catalog templates, bounded settings and budgets | unique ids, every dependency resolves, no self-dependency, no cycles |
| `dk.local.verification_receipt.v1` | `verification-receipt.v1.schema.json` | Observed outcome of a repair in one local run | unique operation per probe; `as_expected` needs the right effect, sufficient observer scope and evidence; `pass` needs a prohibited and a permitted probe all as expected; overall `pass` needs completed/unneeded cleanup |
| `dk.local.capability_receipt.v1` | `capability-receipt.v1.schema.json` | One scoped record supporting a capability tier for one surface + asset + project | known surface; basis must match the level (`declared_inventory`→declared, `source_delivery`→instrumented, `control_test`/`local_verification_receipt`→local_verified, `external_validation`→externally_verified); local_verified needs a run id |

Every object in every schema has `additionalProperties: false`; tests inject 17 executable/credential/target field
names (`command`, `script`, `image`, `url`, `endpoint`, `host`, `port`, `token`, `api_key`, `password`, `secret`,
`credential`, `env`, `mount`, …) at every object level and require rejection. The package's negative fixtures
(`invalid-contracts.json`, `invalid-semantics.json`) for the adopted contracts are rejected.

The investigation-contract, conclusion and repair-plan proposals are NOT adopted here; they belong to the packages
that implement those behaviours (LP04+), which must adopt them the same way.

## Provenance is orthogonal to dataset_kind

`dataset_kind` keeps its v0.1/v0.2 meaning and enum (`synthetic` | `live`); the graph and event schemas are unchanged
and reject any third value or a `provenance` field on events. A project MAY carry `meta.local_run`
(`dk.local.run_provenance.v1`), supplied at `POST /api/projects` (`local_run`) and validated; invalid input is a 422.
The reference pack now creates its `local` project with `dataset_kind: "live"` (it uses real keys and live ingestion)
and a local run record.

Every project-scoped read that returns recorded activity exposes `provenance` — `GET /api/projects`, snapshot,
overview, event search, event detail, bundle events, recipe runs, and the signed manifest of both export formats
(finding export `digital-kingdom-case/1`, case export `digital-kingdom-case/2`). MCP tools return those API bodies, so
`dk_overview`, `dk_search_events`, `dk_get_event`, `dk_get_bundle_events`, `dk_run_recipe` carry it unchanged. A
local project reports `local_run: true`, `qualifiers: ["synthetic_data", "local_scope"]` and the label
"Local laboratory — synthetic people and data"; any other project reports `local_run: false` (a stored record that
fails validation also reports `local_run: false` with a note, never a guessed local label). The console shows a
"Local lab" pill and a banner for local-run projects; the dataset pill is unchanged.

## Migration proposal

- **Database**: none required. `projects.meta` is an existing JSON column; projects created before LP03 have no
  `local_run` and report `local_run: false` (tested on the genuine v0.3 fixture). No event, finding or evidence row is
  rewritten or re-identified.
- **Proposal ids → v1**: the package examples used `dk.local.*.proposed.v1`. The adopted ids drop `proposed`; a
  proposal-id document is rejected by v1 validators until migrated by changing only `schema` (tested). No silent
  acceptance of the old id.
- **Future**: if a run ever needs per-event provenance (e.g. mixed fixture delivery and runtime events in one
  project), add a nullable `events.run_ref` column in a new additive migration and a new event schema version; do
  not overload `dataset_kind`.
- **Export formats**: manifests gained a signed `provenance` member; the format ids stay `/1` and `/2` because the
  change is additive and verification (`verifyCase`) is unchanged.

## Support matrix: five tiers

| Tier | Means | Derived from (scoped receipts only) |
|---|---|---|
| `rendered` | Drawn in the castle/2D view; no capability claimed | always |
| `declared` | In the project's declared inventory | the asset in the current graph revision |
| `instrumented` | A source assigned to this asset has actually delivered events in this project | coverage record with `last_event_at` |
| `local_verified` | A behavioural test passed for this asset inside a local-run project | a `tested` control on the asset, project has local run provenance |
| `externally_verified` | Verified against a real external environment | **deferred (EXT01)**: rejected by default in this phase |

Registry levels (R06.2 `SUPPORT_LEVELS`) map onto tiers via `SUPPORT_TIER_OF` (not_implemented→rendered,
declared/discovered→declared, instrumented/analyzed→instrumented, lab_verified→local_verified,
live_verified→externally_verified). The registry level is a product-wide **ceiling** for a surface family and is
never a per-asset badge: `GET /api/projects/:p/surfaces` keeps `support` (registry, unchanged) and adds
`capability` = `deriveCapability(scope, receipts)` with accepted basis, rejected receipts and the ceiling. Receipts
that are malformed, out of project/asset/surface scope, model-authored, or externally_verified are rejected and
listed. A tier is capped at the ceiling (the note says so).
