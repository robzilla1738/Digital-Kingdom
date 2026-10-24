import type { Graph } from "@dk/contracts";
import { HttpError, type Store } from "./store.ts";
import { keyOf, type Exploration } from "./exploration.ts";

/**
 * LP19 baseline-versus-repair world comparison (`dk.world_comparison.v1`). A stored, append-only LP13 comparison is
 * projected onto the CANONICAL baseline scene: every changed element key is resolved to the asset(s) it belongs to and
 * that asset's baseline room is marked added / removed / changed with the exact element references. Nothing is
 * recompiled, re-placed or stored: the baseline scene, graph, coverage and facts are read, never written. Geometry and
 * placement are presentation; the change list and its unresolved conditions are the facts. A model-only comparison is
 * never an executed or verified control: executed-local results are a separate list (empty unless a run is linked).
 */
export const WORLD_COMPARISON = "dk.world_comparison.v1";
type Change = "added" | "removed" | "changed";
interface El { kind: string; authority: string; id: string; attrs: Record<string, unknown> }

/** Asset ids an analysis element belongs to, from its declared attributes only (never from geometry). */
export function elementAssets(e: El, graph: Graph): string[] {
  const out = new Set<string>();
  const a = e.attrs;
  if (typeof a.asset_id === "string") out.add(a.asset_id);
  if (Array.isArray(a.asset_ids)) for (const x of a.asset_ids) if (typeof x === "string") out.add(x);
  for (const f of ["source_id", "target_id"]) if (typeof a[f] === "string") out.add(a[f] as string);
  if (typeof a.owner === "string") for (const g of graph.assets) if (g.provider_ref?.id === a.owner) out.add(g.id);
  if (e.kind === "asset") out.add(e.id);
  if (e.kind === "route") { const first = e.id.split(" ")[0]!; if (graph.assets.some((g) => g.id === first)) out.add(first); }
  return [...out].filter((id) => graph.assets.some((g) => g.id === id) || e.kind === "asset").sort();
}

export function worldComparison(store: Store, x: Exploration, projectId: string, id: string) {
  const c = x.get(projectId, id);
  const graph = store.getGraph(projectId), scene = store.getScene(projectId);
  if (!graph || !scene) throw new HttpError(404, "project has no graph or scene");
  const baseline = x.baseline(projectId);
  const baselineCurrent = baseline.state_hash === c.base_state_hash;
  const candidate = new Map(c.candidate_state.elements.map((e) => [keyOf(e), e as El]));
  const base = new Map(baseline.state.elements.map((e) => [keyOf(e), e as El]));
  const cmp = c.comparison as { mode: "model_only"; added: string[]; removed: string[]; modified: { key: string }[]; access: { probe: unknown; supported: boolean; base: { result: string } | null; candidate: { result: string } | null; reason?: string }[]; condition_keys: string[]; unassessed_paths: string[]; not_claimed: string[] };
  const unresolvedText = (key: string) => cmp.unassessed_paths.filter((u) => u.startsWith(`${key}:`));
  const changes = ([...cmp.added.map((k) => [k, "added"]), ...cmp.removed.map((k) => [k, "removed"]), ...cmp.modified.map((m) => [m.key, "changed"])] as [string, Change][]).map(([key, op]) => {
    const el = op === "removed" ? (baselineCurrent ? base.get(key) : undefined) : candidate.get(key);
    const assets = el ? elementAssets(el, graph) : [];
    const [kind, authority, ...rest] = key.split("|");
    return { key, op, kind: kind!, authority: authority!, element_id: rest.join("|"), asset_ids: assets,
      resolved_to_asset: assets.length > 0, unresolved: unresolvedText(key),
      ...(el ? {} : { note: "the removed element's baseline record is no longer current; its asset cannot be resolved" }) };
  });
  const byAsset = new Map<string, { change: Change; refs: string[] }>();
  for (const ch of changes) for (const a of ch.asset_ids) {
    const cur = byAsset.get(a);
    const next: Change = !cur ? ch.op : cur.change === ch.op ? ch.op : "changed";
    byAsset.set(a, { change: next, refs: [...(cur?.refs ?? []), ch.key] });
  }
  const rooms = [...byAsset.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([asset_id, v]) => {
    const room = scene.rooms.find((r) => r.asset_id === asset_id);
    return { asset_id, change: v.change, refs: v.refs.sort(), baseline_position: room ? room.position : null, placement: room ? "baseline_room" : "not_in_baseline_scene" };
  });
  const warnings = [
    ...(baselineCurrent ? [] : ["The baseline changed since this comparison was made; it describes the earlier state and does not reproduce now."]),
    ...(changes.some((ch) => !ch.resolved_to_asset) ? [`${changes.filter((ch) => !ch.resolved_to_asset).length} change(s) do not resolve to an asset in the castle and appear only in the change list.`] : []),
    ...(cmp.unassessed_paths.length ? [`${cmp.unassessed_paths.length} unassessed or unresolved condition(s); an unresolved or conditional path is not closed.`] : []),
  ];
  return {
    schema: WORLD_COMPARISON, project_id: projectId, comparison_id: c.id, namespace: c.namespace, mode: cmp.mode,
    revisions: {
      baseline: { state_hash: c.base_state_hash, graph_revision: graph.graph_revision, scene_digest: scene.digest, layout_version: scene.layout_version ?? null, current: baselineCurrent },
      candidate: { state_hash: c.candidate_state_hash, namespace: c.namespace, receipt_digest: (c.receipt as { receipt_digest: string }).receipt_digest },
    },
    layout: "common: the candidate is drawn on the baseline layout and camera; no room is moved or re-placed",
    rooms, changes,
    model_only: { access: cmp.access.map((a) => ({ probe: a.probe, supported: a.supported, base: a.base?.result ?? "unresolved", candidate: a.candidate?.result ?? "unresolved", ...(a.reason ? { reason: a.reason } : {}), basis: "configured_permission", executed: false, verified: false })),
      condition_keys: cmp.condition_keys, unassessed_paths: cmp.unassessed_paths },
    executed_local: { results: [] as unknown[], note: "No executed local result is linked to this model-only comparison. A simulated blocked path is not a verified executed control." },
    warnings,
    not_claimed: [...cmp.not_claimed, "Castle geometry, placement and colour are presentation, never a security fact.", "Viewing or exporting this comparison changes no baseline state, source coverage, finding or scene."],
  };
}
