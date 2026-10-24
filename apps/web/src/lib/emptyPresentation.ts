import type { CompiledScene, Graph } from "@dk/contracts";

/** Local empty viewport only. This is not a compiled server inventory or an evidence record. */
export function emptyPresentation(graph: Graph): CompiledScene {
  return { scene_schema_version: "0.2", compiler_version: "not-compiled", catalog_version: "not-compiled", graph_revision: graph.graph_revision,
    project_id: graph.project_id, seed: 1, style_profile: "stone-slate-v1", camera_profile: "isometric-v1", proposal_source: "default", rooms: [], zones: [], paths: [], pins: {},
    capacities: { public: 0, application: 0, data: 0, automation: 0, delivery: 0, external: 0 }, reflow_zones: [],
    wall: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, digest: "not-compiled-empty-project" };
}
