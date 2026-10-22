# Castle and interaction design specification

## 1. Visual direction

Build a polished isometric architectural diorama, not a first-person game. Use recognizable silhouettes, restrained stone/slate materials, deliberate lighting, clean typography in HTML overlays, and selective animated highlights. The center is a readable map; the evidence pane is always one click away.

Start with an orthographic/isometric camera. Orbit and zoom are optional. Do not require walking an avatar through doors. A cutaway or roof-hide mode reveals interiors. Keep a search box, asset list, incident list, timeline, coverage summary, and 2D switch visible.

The user may enjoy the castle, but operational labels use real terms: `checkout-api`, `production`, `database`, `denied`, `sensor offline`. Decorative medieval names can be secondary labels. Accessibility never depends on knowing the metaphor.

## 2. Semantic mapping

| System concept | Default representation | Important limitation |
|---|---|---|
| Application/environment | One castle/compound | Separate environments must not be blended |
| Edge gateway | Gatehouse | A gate image is not proof of effective protection |
| Authentication | Guardhouse | Successful login is not automatically an intrusion |
| Logical service | Hall or room | Replicas are grouped under the stable logical service |
| Worker or scheduler | Workshop | Queues and asynchronous paths need explicit labels |
| Database/storage | Vault | Sensitivity comes from supplied classification |
| Agent and tool service | Observatory/tower and attached rooms | Permissions and effects remain evidence-backed |
| Build/deployment pipeline | Forge | A code repository is not the same object as a deployed artifact |
| Third-party service | External labeled building/portal | Do not invent visibility into its interior |
| Declared trust boundary | Distinct enclosure/overlay | Do not imply one simple external perimeter protects everything |
| Sensor gap | Hatched/fogged overlay plus text | Unknown is not safe or compromised |

A service-to-service edge can cross walls; identity and software-supply-chain paths may originate inside the castle. The metaphor must accommodate those paths instead of forcing every attack through the front door.

## 3. Asset kit, not one generated object

Use a modular kit with approximately 25–40 curated reusable modules for the first art pass: walls/corners, halls, floors, gates, towers, vaults, workshops, bridge sections, sockets, roofs, alert markers, and boundary overlays.

Kenney's Castle Kit provides a CC0 starting point; verify the downloaded package's manifest and preserve provenance. Use it for layout and initial polish, then add custom technical-art refinements if needed. Other assets require explicit redistribution permission. Generating an asset with AI does not automatically establish its redistribution rights.

Each module needs a stable ID, source file, license, dimensions, consistent units and origin, supported rotations, attachment sockets, label anchors, visibility/occlusion hints, material limits, and low/medium/high detail variants. Include selectable proxy geometry that matches the displayed asset.

A technical artist should ensure material consistency, eliminate accidental seams and excessive geometry, and produce source files contributors can edit. AI-assisted Blender scripting can accelerate offline work, but scripts run in a disposable environment without secrets or network access and are reviewed before execution.

Export a conservative, tested glTF/GLB feature subset and validate each release. Restrict texture dimensions, geometry counts, and extensions; reject unexpected external resource URIs. Asset validation is a build step, not an unchecked runtime download.

## 4. AI-to-scene workflow

1. Build a canonical graph from supported, reviewed metadata.
2. Derive allowed zones and asset/module compatibility using trusted rules.
3. Produce a deterministic default scene plan.
4. Optionally let AI suggest groupings, approved module variants, and a style profile using sanitized metadata.
5. Validate the proposal against schema and semantic constraints.
6. Run the trusted layout compiler, placing logical rooms on a stable grid and resolving permitted connectors.
7. Verify room collisions, visibility, label budgets, and selectable-object identity.
8. Render a preview; apply user overrides without changing security data.
9. Save the seed, compiler version, graph revision, and positions.
10. Apply incremental topology changes without regenerating the whole castle.

The model does not emit Three.js source, executable shaders, arbitrary mesh URLs, attack labels, or security controls. It does not decide whether a service exists. The core works without any AI call.

## 5. Layout algorithm

Use a hierarchical arrangement of environments, zones, services, and instances. A graph-layout library such as ELK can help order groups and route connections, but a castle-specific placement layer still owns module sockets, geometry, and stability.

Persist placements by logical asset ID. When adding one service, use reserved slots or expand the affected wing. Keep unaffected rooms at their previous coordinates unless the user accepts a reflow. Pinned rooms remain pinned. Show a diff before major restructuring.

At organization scale, show multiple castles or clusters, not ten thousand detailed rooms in one view. The data layer can contain more assets than the current detail level displays. Distances and room sizes must have declared semantics; visual closeness is not attack probability.

Relationships are toggled by layer: runtime calls, identity/permissions, deployment, and potential exposure. Do not draw every edge at once. Select a room to reveal its relevant paths. Dashed or patterned paths mark hypotheses, while observed paths include source/event references.

## 6. Animation vocabulary

Render ordinary throughput quietly as aggregated flow. Security findings use restrained markers and a readable label. Separate requested, blocked, allowed, source-reported suspicious, independently observed effect, and analyst-confirmed impact.

Do not explode a wall because a URL returned 404. Do not render every authentication success as an intruder. Avoid identifying an animated actor as a particular person based on IP or user-agent.

Every security animation stores its backing event/finding IDs and time interval. Cluster similar events and show counts. Provide pause, reduced motion, keyboard interaction, and text equivalents. Color is redundant with shape, pattern, label, and list entry.

A lost sensor changes coverage styling. It does not remove the room or turn it green. A silent feed cannot be interpreted as no attacks.

## 7. Operational interaction

Clicking a room opens: real name, environment, owner, stable ID, deployment/source metadata, coverage, relevant findings, evidence references, and a timeline. A user can inspect raw authorized evidence or a clearly labeled redacted derivative.

Clicking a path opens the relationship type, direction, effective time, evidence, and assumptions. Clicking a finding opens the claim, source, rule version, correlated events, missing sources, analyst notes, and review steps.

The timeline supports live mode, pause, bounded rewind, and a clearly labeled historical snapshot. Late-arriving events revise history with visible provenance. Incident replay should not silently use today's topology for yesterday's events.

Keep selection and filters consistent across 3D and 2D. Users can copy an authenticated deep link to the same asset/finding/time view. Export does not publish architecture automatically.

## 8. Proposed performance budgets

These are acceptance targets, not measured performance:

- Critical first-load scene assets: no more than 6 MB compressed; detailed modules load afterward.
- Full initial kit transfer target: no more than 25 MB, with reusable materials and textures.
- Default detailed view: at most 50 room-level assets and roughly 300 draw calls.
- Interactive target: at least 30 FPS on a named integrated-GPU reference laptop at 1080p; 60 FPS is a stretch target.
- First interactive map: within five seconds in a specified warm-server, 20-Mbps test condition.
- A pure scene-compile target of two seconds for a 200-asset fixture on specified hardware, excluding optional AI latency.

Use instancing, shared geometry/materials, level of detail, visibility culling, bounded particles, and adaptive pixel ratio. Avoid repeated heavy post-processing and per-event scene reconstruction. The renderer should automatically reduce visual detail before sacrificing evidence interaction.

Provide a 2D fallback for unavailable or lost graphics contexts. Frame rate and memory are monitored independently of ingestion throughput. A background browser tab should pause decorative work and resume from a current snapshot.

## 9. Visual acceptance

Maintain golden scenes for small, medium, dense, missing-data, and active-incident layouts. Test roof removal, long names, localized labels, color-vision differences, high zoom, keyboard-only interaction, and reduced motion.

A screenshot comparison helps detect regressions; it does not establish usability. Test whether users locate an asset, identify a blocked request, and recognize missing evidence correctly. A graphic that improves appearance but reduces those outcomes should not ship as the default.

See SOURCES.md for glTF, React Three Fiber performance, ELK constraints, and the licensed starter asset kit.
