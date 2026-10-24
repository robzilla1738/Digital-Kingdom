import {
  MODULES_BY_KIND, DEFAULT_MODULE_BY_KIND, recordModuleFor, validateSceneProposalSchema,
  type Graph, type SceneProposal,
} from "@dk/contracts";

export interface ProposalValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a scene proposal (from a user or an AI planner) against the schema and trusted semantics.
 * A proposal may only arrange existing assets into allowed zones using approved modules. It can never
 * add assets, relationships, findings, URLs, or code (the schema forbids unknown fields outright).
 */
export function validateProposal(graph: Graph, proposal: unknown): ProposalValidation {
  const schema = validateSceneProposalSchema(proposal);
  if (!schema.ok) return { ok: false, errors: schema.errors.map((e) => "schema: " + e) };
  const p = proposal as SceneProposal;
  const errors: string[] = [];
  if (p.graph_revision !== graph.graph_revision) errors.push(`graph revision mismatch: proposal ${p.graph_revision}, graph ${graph.graph_revision}`);
  const assets = new Map(graph.assets.map((a) => [a.id, a]));
  if (assets.size !== graph.assets.length) errors.push("graph contains duplicate asset ids");
  const seen = new Map<string, number>();
  for (const pl of p.placements) {
    seen.set(pl.asset_id, (seen.get(pl.asset_id) ?? 0) + 1);
    const a = assets.get(pl.asset_id);
    if (!a) { errors.push(`unknown asset ${pl.asset_id}: proposals cannot invent assets`); continue; }
    if (!a.allowed_zone_ids.includes(pl.zone_id)) errors.push(`asset ${a.id} may not be placed in zone ${pl.zone_id} (allowed: ${a.allowed_zone_ids.join(", ")})`);
    if (!MODULES_BY_KIND[a.kind].includes(pl.module_id)) errors.push(`module ${pl.module_id} cannot represent ${a.kind} asset ${a.id} (allowed: ${MODULES_BY_KIND[a.kind].join(", ")})`);
  }
  for (const [id, n] of seen) if (n > 1) errors.push(`asset ${id} appears ${n} times; each asset must appear exactly once`);
  for (const id of assets.keys()) if (!seen.has(id)) errors.push(`asset ${id} is missing from the proposal`);
  return { ok: errors.length === 0, errors };
}

/** The deterministic default proposal. Requires no AI and no network. */
export function defaultProposal(graph: Graph, seed = 1): SceneProposal {
  return {
    schema_version: "0.2",
    graph_revision: graph.graph_revision,
    seed,
    style_profile: "stone-slate-v1",
    camera_profile: "isometric-v1",
    placements: graph.assets.map((a) => ({ asset_id: a.id, zone_id: a.allowed_zone_ids[0]!, module_id: DEFAULT_MODULE_BY_KIND[a.kind] })),
  };
}

/**
 * LP17: the default proposal with architectural families chosen from declared/supported record fields
 * (`recordModuleFor`). Positions, zones and seeds are identical to `defaultProposal`; only the module may differ, and
 * only to one the asset kind allows. Used for newly compiled local worlds and explicit family fixtures; existing
 * projects keep `defaultProposal`, so a saved scene of the original ten modules is never silently re-skinned.
 */
export function recordProposal(graph: Graph, seed = 1): SceneProposal {
  const p = defaultProposal(graph, seed);
  const byId = new Map(graph.assets.map((a) => [a.id, a]));
  return { ...p, placements: p.placements.map((pl) => ({ ...pl, module_id: recordModuleFor(byId.get(pl.asset_id)!) ?? pl.module_id })) };
}
