import type { Graph } from "@dk/contracts";
import { RELATIONSHIP_LAYER, type Layer } from "./vocab.ts";

/**
 * Security layers, relationship meaning and service interiors (roadmap R06.3). Shared by the castle, the 2D graph
 * and the inspector so every view (including reduced motion and lists) says the same thing.
 *
 * - A permission (runs_as, may_assume, invokes_tool as a capability) is what MAY happen. Observed activity is what
 *   a source recorded. They never share a label, and a permission line never uses the observed (solid) style.
 * - Hypothetical movement is drawn in a neutral colour with the densest dash and labelled "not recorded", so it
 *   cannot read as a recorded intrusion.
 * - Focus modes filter what is drawn; they never move the camera.
 */
export type FocusMode = "none" | "evidence" | "change";
export const FOCUS_LABEL: Record<FocusMode, string> = { none: "All selected-layer relationships", evidence: "Evidence focus: observed relationships only", change: "Proposed-change focus: hypothetical relationships only" };
export const HYPOTHETICAL_COLOR = "#8A929C";
const PERMISSION_KINDS = new Set(["runs_as", "may_assume", "invokes_tool"]);

export interface PathLike { relationship_id: string; source_asset_id: string; target_asset_id: string; kind: string; evidence_level: string }

export function relationshipMeaning(kind: string, level: string) {
  const verb = kind.replaceAll("_", " ");
  if (level === "hypothetical") return { category: "hypothetical" as const, label: `Hypothetical ${verb}: not recorded`, note: "a possibility under review; no source recorded it" };
  if (PERMISSION_KINDS.has(kind)) return { category: "permission" as const, label: `Permission: ${verb}`, note: level === "observed" ? "a grant whose use a source recorded" : "a grant or capability; not observed use" };
  if (level === "observed") return { category: "activity" as const, label: `Observed ${verb}`, note: "recorded by a connected source" };
  return { category: "structure" as const, label: `${level === "inferred" ? "Inferred" : "Declared"} ${verb}`, note: level === "inferred" ? "derived from other evidence, not directly recorded" : "declared in the inventory, not observed" };
}

/** Line style: observed activity is the only solid style; permissions get their own dash; hypothetical is neutral. */
export function relationshipStyle(kind: string, level: string, layerColor: string) {
  const m = relationshipMeaning(kind, level);
  if (m.category === "hypothetical") return { color: HYPOTHETICAL_COLOR, dashed: true, dashSize: 0.06, gapSize: 0.25, dash2d: "2 6" };
  if (m.category === "permission") return { color: layerColor, dashed: true, dashSize: 0.18, gapSize: 0.12, dash2d: "6 3 1 3" };
  if (m.category === "activity") return { color: layerColor, dashed: false, dashSize: 0, gapSize: 0, dash2d: "" };
  return { color: layerColor, dashed: true, dashSize: level === "inferred" ? 0.35 : 0.48, gapSize: level === "inferred" ? 0.17 : 0.28, dash2d: level === "inferred" ? "10 4 2 4" : "8 5" };
}

/** One visibility rule for every view. */
export function pathVisible(p: PathLike, o: { layers: Record<Layer, boolean>; showHypothetical: boolean; focusMode: FocusMode; focusAssets: Set<string>; selectedId: string | null }) {
  if (o.selectedId === p.relationship_id) return true;
  const hyp = p.evidence_level === "hypothetical";
  if (o.focusMode === "evidence" && p.evidence_level !== "observed") return false;
  if (o.focusMode === "change" && !hyp) return false;
  if (hyp && !o.showHypothetical && o.focusMode !== "change") return false;
  const layer = RELATIONSHIP_LAYER[p.kind] ?? "runtime";
  return o.layers[layer] && (o.focusAssets.has(p.source_asset_id) || o.focusAssets.has(p.target_asset_id));
}

/** Service interior: what the inventory says about routes, deployment, instances, permissions and tools. */
export function serviceInterior(graph: Graph, assetId: string) {
  const a = graph.assets.find((x) => x.id === assetId);
  if (!a) return null;
  const name = (id: string) => graph.assets.find((x) => x.id === id)?.name ?? id;
  const out = (kind: string) => graph.relationships.filter((r) => r.source_id === assetId && r.kind === kind);
  const inc = (kind: string) => graph.relationships.filter((r) => r.target_id === assetId && r.kind === kind);
  const routes = (a.routes ?? []).map((r) => ({ method: (r as { methods?: string[] }).methods?.join(", ") ?? "ANY", path: r.path }));
  return {
    routes: routes.length ? routes : null,
    deployed_by: inc("deploys").map((r) => ({ name: name(r.source_id), evidence: r.evidence_level })),
    instances: a.instance_count ?? null,
    permissions: [...out("runs_as"), ...out("may_assume")].map((r) => ({ label: relationshipMeaning(r.kind, r.evidence_level).label, target: name(r.target_id), evidence: r.evidence_level })),
    tools: out("invokes_tool").map((r) => ({ tool: name(r.target_id), evidence: r.evidence_level, meaning: relationshipMeaning(r.kind, r.evidence_level).note })),
    note: "Declared inventory unless marked observed. Instances are the declared count; live replicas are not tracked here.",
  };
}
