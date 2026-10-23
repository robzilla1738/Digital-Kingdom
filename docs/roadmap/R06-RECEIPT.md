# R06 receipt

## R06.1 semantic world hierarchy without remapping history

Delivered: `packages/scene-compiler/src/hierarchy.ts` (`buildHierarchy`, `footprintCollisions`), `historical_rooms`
and `layout_version` in compiled scenes (outside the digest), `GET /scene/hierarchy`, `GET /scene/locate/:asset`,
MCP `dk_world_hierarchy`.

Acceptance (`apps/server/test/hierarchy-r06.test.ts`, 4 tests):
- Adding a resource leaves every room outside a reflowed zone where it was, and every existing group id survives.
- Groups are presentation only (flag on every node; built from declared environment, account and zone; no finding
  or severity data), and the searchable index lists exactly the non-tombstoned assets.
- Selection survives castle/graph switching (navigation round trip) and a removed asset resolves to its historical
  position without being rendered live.
- A legacy stored scene keeps supported positions on recompilation and its footprint overlap is reported.

Limitations: the web app does not yet render a hierarchy list or semantic zoom levels (the API and MCP provide the
equivalent list); interior views are R06.3; composition polish needs device testing (R06.4).

## R06.2 extend all 28 surface mappings with capability-aware architecture

Delivered: surface registry, `surfaceForAsset`, two routes.

Acceptance (`apps/server/test/surfaces-r06.test.ts`, 4 tests):
- The registry lists exactly the 28 surfaces of the handoff matrix, each with a support level from a fixed set and evidence text.
- An asset without a covering source gets no watchtower; every watchtower names a source assigned to that asset; no shield without a tested control.
- Every selectable structure is a graph asset; decorations are not selectable; environment boundaries say they are not enforcement.
- Resolving surfaces leaves stored events and findings unchanged.

Limits: the castle renderer does not yet draw the new families or overlays (R06.3); support levels are maintained by hand in the registry.

## R06.3 richer castle and security layers

- Implementation: `apps/web/src/lib/layers.ts`, Shell focus control, Data layer, EvidencePane Interior + relationship meaning, Castle3D/Graph2D on shared helpers.
- Tests: `apps/web/src/lib/layers.test.ts` (permission vs observed vs hypothetical styling, focus modes, selection retention, data-layer toggle, service interior). Redesign e2e edge-pattern check updated to the new meaning labels.
- Local: typecheck clean; 606 passed, 1 skipped; build passed.
- Not claimed: human visual/device review of the new styling (R06.4 gate `human_and_physical_device`).
