import type { CompiledScene, Graph } from "@dk/contracts";
import { buildHierarchy, hierarchyTrail, type HierarchyNode, type WorldHierarchy } from "@dk/scene-compiler";

/**
 * LP16 client view of the semantic world. The hierarchy is computed by the SAME function the server's
 * `/scene/hierarchy` and MCP `dk_world_hierarchy` use, from the same graph and compiled scene, so the castle, the 2D
 * graph and the navigator list never disagree about membership. Groups are presentation only.
 */
let cache: { key: string; h: WorldHierarchy } | null = null;
export function worldHierarchy(graph: Graph, scene: CompiledScene): WorldHierarchy {
  const key = `${graph.project_id}|${graph.graph_revision}|${scene.digest}|${scene.layout_version ?? 1}|${(scene.historical_rooms ?? []).length}|${graph.assets.length}`;
  if (cache?.key !== key) cache = { key, h: buildHierarchy(graph, scene) };
  return cache.h;
}

/** Presentation-group key used by the castle and graph for a hierarchy district id, or null for other levels. */
export function districtGroupKey(nodeId: string | null | undefined): string | null {
  const m = /^env:(.+)\/district:([a-z_]+)$/.exec(nodeId ?? "");
  return m ? JSON.stringify([m[2], m[1]]) : null;
}

/** Assets a focus id covers: realm and environments cover their members; a structure covers its asset. */
export function focusMembers(h: WorldHierarchy, focus: string | null | undefined): { node: HierarchyNode; trail: HierarchyNode[]; assetIds: Set<string> } | null {
  if (!focus) return null;
  const trail = hierarchyTrail(h, focus);
  if (!trail) return null;
  const node = trail[trail.length - 1]!;
  return { node, trail, assetIds: new Set(node.asset_ids) };
}

export type WorldViewMode = "current" | "historical" | "branch";
/**
 * Current / historical / branch view label (LP16 deliverable). Historical replay pins findings and events to the
 * playhead under the chosen time basis; coverage stays current metadata. A branch is model-only unless an executed
 * local receipt says otherwise.
 */
export function worldViewLabel(o: { isLatest: boolean; at: string; basis: "known" | "occurred"; graphRevision: string; layoutVersion?: number; branch?: { label: string } | null }): { mode: WorldViewMode; text: string } {
  if (o.branch) return { mode: "branch", text: `Branch · ${o.branch.label}` };
  if (!o.isLatest) return { mode: "historical", text: `Historical · ${o.basis === "known" ? "as known at" : "as occurred at"} ${o.at} · coverage remains current` };
  return { mode: "current", text: `Current · graph ${o.graphRevision}${o.layoutVersion ? ` · layout v${o.layoutVersion}` : ""}` };
}
