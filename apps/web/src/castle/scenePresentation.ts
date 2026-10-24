import { MODULE_CATALOG, SURFACES, type CompiledScene, type Graph, type ModuleId, type ModuleSpec, type SceneRoom, type Severity, type SupportLevel } from "@dk/contracts";
import type { AssetStatus, Selection, ViewModel } from "../lib/state.tsx";

export const SEVERITY_COLOR: Record<Severity, string> = { critical: "#FF8F98", high: "#F19A85", medium: "#E8BE78", low: "#92B9FF", info: "#B2BBC8" };
export function selectionAssets(selection: Selection, vm: Pick<ViewModel, "findings" | "data" | "latestData" | "selectedEventAssets">): Set<string> {
  if (selection?.kind === "asset") return new Set([selection.id]);
  if (selection?.kind === "finding") return new Set(vm.findings.find(f => f.id === selection.id)?.affected_asset_ids ?? []);
  if (selection?.kind === "event") return new Set(vm.selectedEventAssets);
  if (selection?.kind === "source") {
    // Source administration is current, even while graph/findings remain pinned for replay or review.
    const present = new Set(vm.data.graph.assets.map(asset => asset.id));
    return new Set((vm.latestData.sources.find(source => source.id === selection.id)?.asset_ids ?? []).filter(id => present.has(id)));
  }
  if ((selection?.kind === "path" || selection?.kind === "relationship")) {
    const p = vm.data.graph.relationships.find(r => r.id === selection.id);
    return new Set(p ? [p.source_id, p.target_id] : []);
  }
  return new Set();
}
export interface PresentationGroup {
  key: string; zoneId: SceneRoom["zone_id"]; environment: string; label: string;
  rooms: SceneRoom[]; bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}
/** Groups are view-only membership lists, not fabricated canonical assets. */
export function presentationGroups(scene: CompiledScene, graph: Graph): PresentationGroup[] {
  const assets = new Map(graph.assets.map(a => [a.id, a]));
  const groups = new Map<string, PresentationGroup>();
  for (const room of scene.rooms) {
    const asset = assets.get(room.asset_id); if (!asset) continue;
    const key = JSON.stringify([room.zone_id, asset.environment]);
    let group = groups.get(key);
    if (!group) { group = { key, zoneId: room.zone_id, environment: asset.environment, label: scene.zones.find(z => z.zone_id === room.zone_id)?.label ?? room.zone_id, rooms: [], bounds: { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity } }; groups.set(key, group); }
    group.rooms.push(room);
    group.bounds.minX = Math.min(group.bounds.minX, room.position.x - room.footprint.w / 2 - 0.65);
    group.bounds.maxX = Math.max(group.bounds.maxX, room.position.x + room.footprint.w / 2 + 0.65);
    group.bounds.minZ = Math.min(group.bounds.minZ, room.position.z - room.footprint.d / 2 - 0.65);
    group.bounds.maxZ = Math.max(group.bounds.maxZ, room.position.z + room.footprint.d / 2 + 0.65);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}
const FOCUS_GROUP_PREFIX = "selection-groups:";
/** View-only key remembers every relevant group at explicit Focus time. It is never a canonical asset. */
export function selectionDistrictKey(groups: PresentationGroup[], selected: ReadonlySet<string>): string | null {
  const keys = groups.filter(group => group.rooms.some(room => selected.has(room.asset_id))).map(group => group.key);
  return keys.length > 1 ? FOCUS_GROUP_PREFIX + JSON.stringify(keys) : keys[0] ?? null;
}
/** Keep selected assets/endpoints before contextual members. Full real membership is never truncated. */
export function presentationMembers(groups: PresentationGroup[], district: string | null, selected: ReadonlySet<string>, limit = 50) {
  let keys: string[] = district ? [district] : [];
  if (district?.startsWith(FOCUS_GROUP_PREFIX)) {
    try { const parsed: unknown = JSON.parse(district.slice(FOCUS_GROUP_PREFIX.length)); keys = Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : []; } catch { keys = []; }
  }
  const expanded = groups.filter(group => keys.includes(group.key));
  const members = [...new Map(expanded.flatMap(group => group.rooms).map(room => [room.asset_id, room])).values()];
  const selectedMembers = members.filter(room => selected.has(room.asset_id));
  const cap = Math.max(0, Math.floor(limit));
  return { groups: expanded, members, visible: [...selectedMembers, ...members.filter(room => !selected.has(room.asset_id))].slice(0, cap), selectedCount: selectedMembers.length, selectedOverflow: Math.max(0, selectedMembers.length - cap) };
}

export function groupSummary(group: PresentationGroup, statuses: Map<string, AssetStatus>) {
  const findings = new Set<string>(), coverage: Record<string, number> = {}, severity: Record<string, number> = {};
  for (const r of group.rooms) {
    const s = statuses.get(r.asset_id); if (!s) continue;
    s.findingIds.forEach(id => findings.add(id)); coverage[s.coverage] = (coverage[s.coverage] ?? 0) + 1;
    if (s.severity) severity[s.severity] = (severity[s.severity] ?? 0) + 1;
  }
  return { findings: findings.size, coverage, severity };
}
export function relationshipPattern(evidence: string) {
  return evidence === "hypothetical" ? "2 6" : evidence === "inferred" ? "10 4 2 4" : evidence === "declared" ? "8 5" : undefined;
}

/** Presentation metadata migration for persisted v1 scenes. Never writes scene state or moves assets. */
export function presentationScene(scene: CompiledScene): CompiledScene {
  const rooms = scene.rooms.map(r => {
    const spec = MODULE_CATALOG[r.module_id] as ModuleSpec | undefined, rotated = Math.abs(r.rotation_y) % 180 === 90;
    // LP17: a scene stored by a newer kit can name a module this build does not know. Keep the asset, its stored
    // footprint and height (never re-place or drop it); the castle draws a labelled placeholder for it.
    if (!spec) return { ...r, label_anchor: { x: r.position.x, y: r.height + 0.8, z: r.position.z } };
    return { ...r, footprint: rotated ? { w: spec.footprint.d, d: spec.footprint.w } : spec.footprint, height: spec.height, label_anchor: { x: r.position.x, y: spec.label_height, z: r.position.z } };
  });
  return { ...scene, rooms, bounds: rooms.length ? {
    minX: Math.min(...rooms.map(r => r.position.x - r.footprint.w / 2)) - 1.6,
    maxX: Math.max(...rooms.map(r => r.position.x + r.footprint.w / 2)) + 1.6,
    minZ: Math.min(...rooms.map(r => r.position.z - r.footprint.d / 2)) - 1.6,
    maxZ: Math.max(...rooms.map(r => r.position.z + r.footprint.d / 2)) + 1.6,
  } : scene.bounds };
}
export function presentationCollisions(rooms: SceneRoom[]): [string, string][] {
  const hits: [string, string][] = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i]!, b = rooms[j]!;
    if (Math.abs(a.position.x - b.position.x) < (a.footprint.w + b.footprint.w) / 2 && Math.abs(a.position.z - b.position.z) < (a.footprint.d + b.footprint.d) / 2) hits.push([a.asset_id, b.asset_id]);
  }
  return hits;
}

/** Stable presentation dependency keys. Event/status-only snapshots do not rebuild static decoration. */
export function presentationTopologyKey(scene: CompiledScene): string {
  return JSON.stringify([scene.project_id, scene.graph_revision, scene.style_profile, scene.rooms, scene.zones, scene.paths, scene.bounds]);
}
export function groupMembershipKey(graph: Graph): string {
  return graph.assets.map(a => `${a.id.length}:${a.id}:${a.environment}`).sort().join("|");
}

/**
 * LP17-A2: the click target for a placed module, in module space (before rotation). With roofs on it is the module's
 * full footprint volume; with roofs off (interior scale) it shrinks to a low plinth under the floor line so interior
 * objects stay clickable and nothing above the floor is intercepted. Never larger than the footprint.
 */
export function selectionProxy(spec: Pick<ModuleSpec, "footprint" | "height">, roofs: boolean): { w: number; d: number; h: number; y: number } {
  if (roofs) return { w: spec.footprint.w, d: spec.footprint.d, h: spec.height, y: spec.height / 2 };
  const h = 0.24;
  return { w: spec.footprint.w, d: spec.footprint.d, h, y: h / 2 };
}

/** LP17-A4: the registry surface each new architectural family depicts (support level lives in SURFACES). */
export const FAMILY_SURFACE: Record<"dns_registry" | "dispatch_house" | "key_registry" | "supply_depot" | "archive" | "outpost", string> = {
  dns_registry: "DK-S-dns", dispatch_house: "DK-S-queue", key_registry: "DK-S-machine_identity",
  supply_depot: "DK-S-registry", archive: "DK-S-storage", outpost: "DK-S-device",
};
/** Honest capability line for a family, separate from the drawing; null for the original ten modules. */
export function familyCapability(id: string): { surface: string; support: SupportLevel; text: string } | null {
  const sid = (FAMILY_SURFACE as Record<string, string>)[id];
  if (!sid) return null;
  const s = SURFACES.find((x) => x.id === sid)!, label = MODULE_CATALOG[id as ModuleId]?.label ?? id;
  const dns = id === "dns_registry" ? " Declared names and route aliases only; no Internet discovery." : "";
  return { surface: sid, support: s.support, text: `${label} depicts ${s.name}: support ${s.support.replace(/_/g, " ")} (${s.support_evidence}).${dns} Drawing this family does not mean this asset is discovered, monitored or protected.` };
}
