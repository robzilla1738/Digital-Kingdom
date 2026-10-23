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

export interface WorldHierarchy {
  realm: HierarchyNode;
  index: { asset_id: string; path: string; group_ids: string[]; tombstoned: boolean }[];
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
        index.push({ asset_id: a.id, path: `${env} / ${zoneLabel.get(z) ?? z} / ${a.name}`, group_ids: [`env:${env}`, ...(a.provider_ref ? [`env:${env}/account:${a.provider_ref.scope}`] : []), id], tombstoned: false });
        return { id: sid, kind: "structure", label: a.name, presentation_only: true, asset_ids: [a.id], children: [], ...(rooms.get(a.id) ? { bounds: boundsOf([rooms.get(a.id)!]) } : {}) };
      });
      return { id, kind: "district", label: zoneLabel.get(z) ?? z, presentation_only: true, asset_ids: inZone.map((a) => a.id), children: structures, bounds: boundsOf(inZone.map((a) => rooms.get(a.id)!).filter(Boolean)) };
    });
    const accountNodes: HierarchyNode[] = accounts.map((acc) => ({ id: `env:${env}/account:${acc}`, kind: "account", label: acc, presentation_only: true, asset_ids: members.filter((a) => a.provider_ref?.scope === acc).map((a) => a.id).sort(), children: [] }));
    return { id: `env:${env}`, kind: "environment", label: env, presentation_only: true, asset_ids: members.map((a) => a.id).sort(), children: [...accountNodes, ...districts], bounds: boundsOf(members.map((a) => rooms.get(a.id)!).filter(Boolean)) };
  });
  for (const h of scene.historical_rooms ?? []) index.push({ asset_id: h.asset_id, path: `historical / ${h.asset_id}`, group_ids: [], tombstoned: true });
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
