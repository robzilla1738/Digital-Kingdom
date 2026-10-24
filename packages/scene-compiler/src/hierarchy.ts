import type { CompiledScene, Graph, SceneRoom, ZoneId } from "@dk/contracts";

/**
 * Semantic world hierarchy (roadmap R06.1): realm (project) > environment > district (zone) > structure (room)
 * > interior. Groups are PRESENTATION ONLY: membership comes from declared environment, zone and provider account,
 * never from findings, so a group can never read as an incident. Identities are stable strings derived from those
 * declarations (`env:prod`, `env:prod/district:data`), not from positions, so a new resource never renames or
 * reorders an unrelated group. The flat `index` is the searchable list equivalent of the 3D and 2D views.
 */
export interface HierarchyNode {
  id: string;
  kind: "realm" | "environment" | "account" | "district" | "structure";
  label: string;
  presentation_only: true;
  asset_ids: string[];
  children: HierarchyNode[];
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export interface WorldIndexEntry {
  asset_id: string; path: string; group_ids: string[]; tombstoned: boolean;
  /** LP16: `current` structures are live; `archived` entries are retired incarnations at their last position. */
  state?: "current" | "archived"; incarnation_id?: string | null; label?: string; retired_in_revision?: string;
  /** Lower-cased search text: name, id, aliases, owner, provider identity and path. Never findings or activity. */
  search?: string;
}
export interface WorldHierarchy {
  realm: HierarchyNode;
  index: WorldIndexEntry[];
  boundaries: { environment: string; accounts: string[] }[];
  notes: string[];
}

const boundsOf = (rooms: SceneRoom[]) => rooms.length ? {
  minX: Math.min(...rooms.map((r) => r.position.x - r.footprint.w / 2)), maxX: Math.max(...rooms.map((r) => r.position.x + r.footprint.w / 2)),
  minZ: Math.min(...rooms.map((r) => r.position.z - r.footprint.d / 2)), maxZ: Math.max(...rooms.map((r) => r.position.z + r.footprint.d / 2)),
} : undefined;

export function buildHierarchy(graph: Graph, scene: CompiledScene): WorldHierarchy {
  const rooms = new Map(scene.rooms.map((r) => [r.asset_id, r]));
  const zoneLabel = new Map(scene.zones.map((z) => [z.zone_id, z.label]));
  const live = graph.assets.filter((a) => a.lifecycle !== "tombstoned");
  const envs = [...new Set(live.map((a) => a.environment))].sort();
  const index: WorldHierarchy["index"] = [];
  const boundaries: WorldHierarchy["boundaries"] = [];
  const envNodes: HierarchyNode[] = envs.map((env) => {
    const members = live.filter((a) => a.environment === env);
    const accounts = [...new Set(members.map((a) => a.provider_ref?.scope).filter((s): s is string => !!s))].sort();
    boundaries.push({ environment: env, accounts });
    const zones = [...new Set(members.map((a) => rooms.get(a.id)?.zone_id).filter((z): z is ZoneId => !!z))].sort();
    const districts: HierarchyNode[] = zones.map((z) => {
      const inZone = members.filter((a) => rooms.get(a.id)?.zone_id === z).sort((x, y) => x.id.localeCompare(y.id));
      const id = `env:${env}/district:${z}`;
      const structures: HierarchyNode[] = inZone.map((a) => {
        const sid = `${id}/structure:${a.id}`;
        const path = `${env} / ${zoneLabel.get(z) ?? z} / ${a.name}`;
        index.push({ asset_id: a.id, path, group_ids: [`env:${env}`, ...(a.provider_ref ? [`env:${env}/account:${a.provider_ref.scope}`] : []), id], tombstoned: false,
          state: "current", incarnation_id: scene.incarnations?.[a.id]?.id ?? null, label: a.name,
          search: [a.name, a.id, ...(a.aliases ?? []), a.owner ?? "", a.provider_ref?.id ?? "", path].join(" ").toLowerCase() });
        return { id: sid, kind: "structure", label: a.name, presentation_only: true, asset_ids: [a.id], children: [], ...(rooms.get(a.id) ? { bounds: boundsOf([rooms.get(a.id)!]) } : {}) };
      });
      return { id, kind: "district", label: zoneLabel.get(z) ?? z, presentation_only: true, asset_ids: inZone.map((a) => a.id), children: structures, bounds: boundsOf(inZone.map((a) => rooms.get(a.id)!).filter(Boolean)) };
    });
    const accountNodes: HierarchyNode[] = accounts.map((acc) => ({ id: `env:${env}/account:${acc}`, kind: "account", label: acc, presentation_only: true, asset_ids: members.filter((a) => a.provider_ref?.scope === acc).map((a) => a.id).sort(), children: [] }));
    return { id: `env:${env}`, kind: "environment", label: env, presentation_only: true, asset_ids: members.map((a) => a.id).sort(), children: [...accountNodes, ...districts], bounds: boundsOf(members.map((a) => rooms.get(a.id)!).filter(Boolean)) };
  });
  for (const h of scene.historical_rooms ?? []) {
    const path = `historical / ${h.asset_id}`;
    index.push({ asset_id: h.asset_id, path, group_ids: [], tombstoned: true, state: "archived", incarnation_id: h.incarnation_id ?? null, label: `${h.asset_id} (archived)`, retired_in_revision: h.retired_in_revision,
      search: [h.asset_id, h.incarnation_id ?? "", "archived historical", zoneLabel.get(h.zone_id) ?? h.zone_id, path].join(" ").toLowerCase() });
  }
  return {
    realm: { id: `realm:${graph.project_id}`, kind: "realm", label: graph.project_id, presentation_only: true, asset_ids: live.map((a) => a.id).sort(), children: envNodes },
    index: index.sort((a, b) => a.path.localeCompare(b.path)), boundaries,
    notes: ["Groups are presentation only. They come from declared environment, account and zone, never from findings or activity."],
  };
}

/** Footprint overlaps between rooms (for legacy stored scenes): reported, never silently moved. */
export function footprintCollisions(scene: Pick<CompiledScene, "rooms">): { a: string; b: string }[] {
  const out: { a: string; b: string }[] = [];
  const rs = scene.rooms;
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i]!, b = rs[j]!;
    if (Math.abs(a.position.x - b.position.x) * 2 < a.footprint.w + b.footprint.w - 1e-6 && Math.abs(a.position.z - b.position.z) * 2 < a.footprint.d + b.footprint.d - 1e-6) out.push({ a: a.asset_id, b: b.asset_id });
  }
  return out;
}

/**
 * LP16 semantic levels (05_CASTLE_WORLD_SPEC §2). Zoom is semantic: a distant level suppresses detail, never the
 * existence of relevant findings or unobserved resources, and every grouped asset stays searchable.
 */
export const SEMANTIC_LEVELS = ["realm", "environment", "district", "structure", "interior", "evidence"] as const;
export type SemanticLevel = (typeof SEMANTIC_LEVELS)[number];

/** Level implied by the on-screen size of one kit cell (pixels per metre of an orthographic camera). */
export function semanticLevelForScale(pixelsPerMetre: number, roofsOff = false): SemanticLevel {
  if (pixelsPerMetre < 7) return "realm";
  if (pixelsPerMetre < 13) return "environment";
  if (pixelsPerMetre < 30) return "district";
  return roofsOff && pixelsPerMetre >= 45 ? "interior" : "structure";
}



/** Every node in the tree, depth first. */
export function hierarchyNodes(h: WorldHierarchy): HierarchyNode[] {
  const out: HierarchyNode[] = [];
  const walk = (n: HierarchyNode) => { out.push(n); n.children.forEach(walk); };
  walk(h.realm); return out;
}

/** A node and its ancestors (realm first), by stable id. Unknown ids resolve to null, never to a neighbour. */
export function hierarchyTrail(h: WorldHierarchy, id: string): HierarchyNode[] | null {
  const trail: HierarchyNode[] = [];
  const walk = (n: HierarchyNode): boolean => { trail.push(n); if (n.id === id) return true; for (const c of n.children) if (walk(c)) return true; trail.pop(); return false; };
  return walk(h.realm) ? trail : null;
}

/** Stable focus id for a structure, independent of its district: `asset:<id>` resolves to its current node. */
export function structureNodeFor(h: WorldHierarchy, assetId: string): HierarchyNode | null {
  return hierarchyNodes(h).find((n) => n.kind === "structure" && n.asset_ids[0] === assetId) ?? null;
}

/**
 * Asset search over the complete index (LP16-A3). Matches name, id, aliases, owner, provider identity and path;
 * archived incarnations are returned labelled, after current structures. Unlimited unless a limit is given, and the
 * total is always reported so a capped list never reads as complete.
 */
export function searchWorld(h: WorldHierarchy, query: string, limit = Infinity) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = h.index.filter((e) => terms.every((t) => (e.search ?? `${e.asset_id} ${e.path}`.toLowerCase()).includes(t)))
    .sort((a, b) => Number(a.tombstoned) - Number(b.tombstoned) || a.path.localeCompare(b.path));
  return { query, total: hits.length, results: hits.slice(0, limit) };
}
