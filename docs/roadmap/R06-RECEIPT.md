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
