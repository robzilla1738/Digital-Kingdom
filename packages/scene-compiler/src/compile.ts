import {
  CATALOG_VERSION, MODULE_CATALOG, ZONE_IDS, ZONE_LABELS, digest, fnv1a,
  type CompiledScene, type Graph, type SceneProposal, type ScenePath, type SceneRoom, type SceneZone, type Vec3, type ZoneId,
} from "@dk/contracts";
import { validateProposal } from "./validate.ts";

export const COMPILER_VERSION = "dk-scene-compiler-2.0.0";

const CELL_X = 5.6;
const CELL_Z = 5.4;
const GAP = 2.2;
const DEFAULT_CAPACITY: Record<ZoneId, number> = { public: 3, application: 9, data: 4, automation: 4, delivery: 2, external: 3 };

export interface CompileOptions {
  /** Previously approved scene: its pins and capacities keep unrelated rooms stable. */
  previous?: (Pick<CompiledScene, "pins" | "capacities"> & Partial<Pick<CompiledScene, "rooms">>) | null;
  /** Discard pins and capacities, and lay the castle out from scratch (an accepted reflow). */
  reflow?: boolean;
  source?: CompiledScene["proposal_source"];
}

export class SceneCompileError extends Error {
  constructor(readonly errors: string[]) { super("scene proposal rejected: " + errors.join("; ")); }
}

interface ZoneGrid { cols: number; rows: number; origin: { x: number; z: number }; colDir: { x: number; z: number }; rowDir: { x: number; z: number }; rotation: number }

function gridShape(zone: ZoneId, cap: number): { cols: number; rows: number } {
  switch (zone) {
    case "application": { const cols = Math.max(3, Math.ceil(Math.sqrt(cap))); return { cols, rows: Math.ceil(cap / cols) }; }
    case "public": { const cols = Math.max(1, Math.min(cap, 5)); return { cols, rows: Math.ceil(cap / cols) }; }
    case "data": { const cols = Math.max(2, Math.min(cap, 4)); return { cols, rows: Math.ceil(cap / cols) }; }
    case "automation": case "delivery": { const rows = Math.max(2, Math.min(cap, 3)); return { rows, cols: Math.ceil(cap / rows) }; }
    case "external": { const rows = Math.max(1, Math.min(cap, 3)); return { rows, cols: Math.ceil(cap / rows) }; }
  }
}

function zoneGrids(caps: Record<ZoneId, number>): Record<ZoneId, ZoneGrid> {
  const app = gridShape("application", caps.application);
  const appW = app.cols * CELL_X, appD = app.rows * CELL_Z;
  const pub = gridShape("public", caps.public);
  const dat = gridShape("data", caps.data);
  const aut = gridShape("automation", caps.automation);
  const del = gridShape("delivery", caps.delivery);
  const ext = gridShape("external", caps.external);
  const autW = aut.cols * CELL_X;
  const datD = dat.rows * CELL_Z;
  return {
    // centered grids: origin is the first cell's center
    application: { ...app, origin: { x: -appW / 2 + CELL_X / 2, z: -appD / 2 + CELL_Z / 2 }, colDir: { x: CELL_X, z: 0 }, rowDir: { x: 0, z: CELL_Z }, rotation: 0 },
    public: { ...pub, origin: { x: -(pub.cols * CELL_X) / 2 + CELL_X / 2, z: appD / 2 + GAP + CELL_Z / 2 }, colDir: { x: CELL_X, z: 0 }, rowDir: { x: 0, z: CELL_Z }, rotation: 0 },
    data: { ...dat, origin: { x: -(dat.cols * CELL_X) / 2 + CELL_X / 2, z: -appD / 2 - GAP - CELL_Z / 2 }, colDir: { x: CELL_X, z: 0 }, rowDir: { x: 0, z: -CELL_Z }, rotation: 0 },
    automation: { ...aut, origin: { x: appW / 2 + GAP + CELL_X / 2, z: -(aut.rows * CELL_Z) / 2 + CELL_Z / 2 }, colDir: { x: CELL_X, z: 0 }, rowDir: { x: 0, z: CELL_Z }, rotation: -90 },
    delivery: { ...del, origin: { x: -appW / 2 - GAP - CELL_X / 2, z: -(del.rows * CELL_Z) / 2 + CELL_Z / 2 }, colDir: { x: -CELL_X, z: 0 }, rowDir: { x: 0, z: CELL_Z }, rotation: 90 },
    external: { ...ext, origin: { x: appW / 2 + GAP + autW + GAP + CELL_X / 2, z: CELL_Z }, colDir: { x: CELL_X, z: 0 }, rowDir: { x: 0, z: CELL_Z }, rotation: -90 },
  };
}

function slotPosition(g: ZoneGrid, slot: number, zone: ZoneId): { x: number; z: number } {
  // rows fill first for side wings, columns first otherwise
  const sideways = zone === "automation" || zone === "delivery" || zone === "external";
  let col = sideways ? Math.floor(slot / g.rows) : slot % g.cols;
  // front and back rows fill from the center outward so a lone gatehouse sits on the castle axis
  if (zone === "public" || zone === "data") col = centerOut(col, g.cols);
  let row = sideways ? slot % g.rows : Math.floor(slot / g.cols);
  // The first application court has an intentionally empty centre, not a uniform filled grid.
  // Stable slots reserve circulation; decoration does not create a graph node.
  if (zone === "application" && g.cols === 3 && slot < 8) {
    const courtyard = [6, 7, 8, 3, 5, 0, 1, 2][slot]!;
    col = courtyard % 3; row = Math.floor(courtyard / 3);
  } else if (zone === "application" && g.cols === 3 && slot >= 8) row += 1;
  return { x: round(g.origin.x + col * g.colDir.x + row * g.rowDir.x), z: round(g.origin.z + col * g.colDir.z + row * g.rowDir.z) };
}

function centerOut(i: number, cols: number): number {
  const mid = Math.floor((cols - 1) / 2);
  const step = Math.ceil(i / 2);
  const c = i % 2 === 1 ? mid + step : mid - step;
  return c < 0 || c >= cols ? i : c;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Trusted, deterministic scene compiler. Same graph + proposal + previous pins + compiler/catalog version
 * => byte-identical scene. Positions are keyed by stable asset id; adding an asset never moves pinned
 * rooms unless its zone exceeds its persisted capacity (reported in reflow_zones).
 */
export function compileScene(graph: Graph, proposal: SceneProposal, opts: CompileOptions = {}): CompiledScene {
  const v = validateProposal(graph, proposal);
  if (!v.ok) throw new SceneCompileError(v.errors);

  const previous = opts.reflow ? null : opts.previous ?? null;
  const byZone = new Map<ZoneId, typeof proposal.placements>();
  for (const z of ZONE_IDS) byZone.set(z, []);
  for (const p of proposal.placements) byZone.get(p.zone_id)!.push(p);

  const caps = {} as Record<ZoneId, number>;
  const reflow: ZoneId[] = [];
  for (const z of ZONE_IDS) {
    const need = byZone.get(z)!.length;
    const prevCap = previous?.capacities?.[z];
    const base = prevCap ?? Math.max(DEFAULT_CAPACITY[z], need);
    // grow in blocks so routine additions don't trigger repeated reflows
    if (need > base) { caps[z] = Math.ceil((need + 2) / 3) * 3; if (prevCap !== undefined) reflow.push(z); }
    else caps[z] = base;
  }
  const grids = zoneGrids(caps);

  const pins: CompiledScene["pins"] = {};
  const priorRooms = new Map((previous?.rooms ?? []).map(r => [r.asset_id, r]));
  const assets = new Map(graph.assets.map(a => [a.id, a]));
  const environments = [...new Set(graph.assets.map(a => a.environment))].sort();
  const environmentStride = Math.max(60, ...Object.values(grids).map(g => Math.abs(g.origin.x) + g.cols * CELL_X)) * 2;
  // Environment names are metadata, not positional indexes. A new lexically earlier name must
  // not take an existing environment's origin while its approved rooms remain pinned there.
  const priorGrids = previous ? zoneGrids(previous.capacities) : grids;
  const environmentOrigins = new Map<string, number>();
  const environmentExtents = new Map<string, { min: number; max: number }>();
  for (const environment of environments) {
    const members = [...priorRooms.values()].filter(r => assets.get(r.asset_id)?.environment === environment);
    if (!members.length) continue;
    // Reconcile the most common prior translation. Capacity growth can leave older pins on
    // an earlier grid, so a minority of displaced slots must not redefine the district.
    const offsets = new Map<number, number>();
    for (const room of members) {
      const offset = round(room.position.x - slotPosition(priorGrids[room.zone_id], room.slot, room.zone_id).x);
      offsets.set(offset, (offsets.get(offset) ?? 0) + 1);
    }
    environmentOrigins.set(environment, [...offsets].sort((a, b) => b[1] - a[1] || Math.abs(a[0]) - Math.abs(b[0]) || a[0] - b[0])[0]![0]);
    environmentExtents.set(environment, { min: Math.min(...members.map(r => r.position.x - r.footprint.w / 2)), max: Math.max(...members.map(r => r.position.x + r.footprint.w / 2)) });
  }
  let nextOrigin = environmentExtents.size
    ? Math.ceil((Math.max(...[...environmentExtents.values()].map(b => b.max)) + environmentStride / 2) / environmentStride) * environmentStride
    : 0;
  for (const environment of environments) if (!environmentOrigins.has(environment)) {
    environmentOrigins.set(environment, nextOrigin);
    environmentExtents.set(environment, { min: nextOrigin, max: nextOrigin });
    nextOrigin += environmentStride;
  }
  // New rooms may grow along Z rather than crossing into a neighboring environment's
  // existing horizontal territory. Retained approved coordinates are never clamped.
  const orderedEnvironments = [...environments].sort((a, b) => {
    const aa = environmentExtents.get(a)!, bb = environmentExtents.get(b)!;
    return (aa.min + aa.max) - (bb.min + bb.max) || a.localeCompare(b);
  });
  const environmentBands = new Map<string, { min: number; max: number }>();
  for (let i = 0; i < orderedEnvironments.length; i++) {
    const name = orderedEnvironments[i]!, extent = environmentExtents.get(name)!;
    const left = i ? environmentExtents.get(orderedEnvironments[i - 1]!) : undefined;
    const right = i + 1 < orderedEnvironments.length ? environmentExtents.get(orderedEnvironments[i + 1]!) : undefined;
    environmentBands.set(name, { min: left ? (left.max + extent.min) / 2 + 9 : -Infinity, max: right ? (extent.max + right.min) / 2 - 9 : Infinity });
  }
  const rooms: SceneRoom[] = [];
  for (const z of ZONE_IDS) {
    const placements = byZone.get(z)!;
    const used = new Set<number>();
    const assigned = new Map<string, number>();
    // 1) keep previous slots for assets still in this zone
    for (const p of placements) {
      const pin = previous?.pins?.[p.asset_id];
      if (pin && pin.zone_id === z && pin.slot < caps[z] && !used.has(pin.slot)) { assigned.set(p.asset_id, pin.slot); used.add(pin.slot); }
    }
    // 2) new assets in stable seeded order take the lowest free slots
    const fresh = placements.filter((p) => !assigned.has(p.asset_id))
      .sort((a, b) => fnv1a(`${proposal.seed}:${a.asset_id}`) - fnv1a(`${proposal.seed}:${b.asset_id}`) || (a.asset_id < b.asset_id ? -1 : 1));
    let next = 0;
    for (const p of fresh) { while (used.has(next)) next++; assigned.set(p.asset_id, next); used.add(next); }
    for (const p of [...placements].sort((a, b) => assigned.get(a.asset_id)! - assigned.get(b.asset_id)! || a.asset_id.localeCompare(b.asset_id))) {
      const slot = assigned.get(p.asset_id)!;
      const spec = MODULE_CATALOG[p.module_id];
      const candidate = slotPosition(grids[z], slot, z);
      const environment = assets.get(p.asset_id)!.environment;
      candidate.x += environmentOrigins.get(environment)!;
      // Preserve approved world coordinates, not merely slot numbers, across district growth.
      const prior = priorRooms.get(p.asset_id);
      const retained = prior && prior.zone_id === z;
      const pos = retained ? { x: prior.position.x, z: prior.position.z } : candidate;
      const rotated = Math.abs(grids[z].rotation) % 180 === 90;
      const footprint = rotated ? { w: spec.footprint.d, d: spec.footprint.w } : spec.footprint;
      if (!retained) {
        const band = environmentBands.get(environment)!;
        pos.x = round(Math.max(band.min + footprint.w / 2, Math.min(band.max - footprint.w / 2, pos.x)));
      }
      // New slots extend rather than overlapping an approved position after capacity growth.
      if (!retained) while ([...rooms, ...priorRooms.values()].some(r => r.asset_id !== p.asset_id && Math.abs(r.position.x - pos.x) < (r.footprint.w + footprint.w) * 0.6 && Math.abs(r.position.z - pos.z) < (r.footprint.d + footprint.d) * 0.6)) pos.z = round(pos.z + CELL_Z);
      pins[p.asset_id] = { zone_id: z, slot };
      rooms.push({
        asset_id: p.asset_id,
        node_id: `room:${p.asset_id}`,
        module_id: p.module_id,
        zone_id: z,
        slot,
        position: { x: pos.x, y: 0, z: pos.z },
        rotation_y: grids[z].rotation,
        footprint,
        height: spec.height,
        label_anchor: { x: pos.x, y: spec.label_height, z: pos.z },
      });
    }
  }
  rooms.sort((a, b) => (a.asset_id < b.asset_id ? -1 : 1));

  const zones: SceneZone[] = ZONE_IDS.filter((z) => byZone.get(z)!.length > 0).map((z) => {
    const members = rooms.filter(r => r.zone_id === z);
    const pad = 1.0;
    return {
      zone_id: z, label: ZONE_LABELS[z],
      bounds: { minX: round(Math.min(...members.map(r => r.position.x - r.footprint.w / 2)) - pad), maxX: round(Math.max(...members.map(r => r.position.x + r.footprint.w / 2)) + pad), minZ: round(Math.min(...members.map(r => r.position.z - r.footprint.d / 2)) - pad), maxZ: round(Math.max(...members.map(r => r.position.z + r.footprint.d / 2)) + pad) },
      // Organizational terraces are never an inferred enforcement perimeter.
      enclosed: false,
    };
  });

  const inner = zones.filter((z) => z.zone_id !== "external");
  const wall = inner.length
    ? { minX: round(Math.min(...inner.map((z) => z.bounds.minX)) - 1.4), maxX: round(Math.max(...inner.map((z) => z.bounds.maxX)) + 1.4), minZ: round(Math.min(...inner.map((z) => z.bounds.minZ)) - 1.4), maxZ: round(Math.max(...inner.map((z) => z.bounds.maxZ)) + 0.2) }
    : { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
  const all = zones.map((z) => z.bounds);
  const bounds = { minX: Math.min(wall.minX, ...all.map((b) => b.minX)), maxX: Math.max(wall.maxX, ...all.map((b) => b.maxX)), minZ: Math.min(wall.minZ, ...all.map((b) => b.minZ)), maxZ: Math.max(wall.maxZ, ...all.map((b) => b.maxZ)) };

  const roomById = new Map(rooms.map((r) => [r.asset_id, r]));
  const paths: ScenePath[] = graph.relationships
    .filter((r) => roomById.has(r.source_id) && roomById.has(r.target_id))
    .map((r) => ({
      relationship_id: r.id, source_asset_id: r.source_id, target_asset_id: r.target_id, kind: r.kind, evidence_level: r.evidence_level,
      points: route(roomById.get(r.source_id)!.position, roomById.get(r.target_id)!.position, fnv1a(r.id)),
    }))
    .sort((a, b) => (a.relationship_id < b.relationship_id ? -1 : 1));

  const body = {
    scene_schema_version: "0.2" as const, compiler_version: COMPILER_VERSION, catalog_version: CATALOG_VERSION,
    graph_revision: graph.graph_revision, project_id: graph.project_id, seed: proposal.seed,
    style_profile: proposal.style_profile, camera_profile: proposal.camera_profile, proposal_source: opts.source ?? "default",
    rooms, zones, paths, pins, capacities: caps, reflow_zones: reflow, wall, bounds,
  };
  return { ...body, digest: digest({ ...body, proposal_source: undefined }) };
}

function route(a: Vec3, b: Vec3, h: number): Vec3[] {
  const lift = 0.35 + (h % 7) * 0.04;
  const mid = { x: round((a.x + b.x) / 2), y: round(1.6 + (h % 5) * 0.25), z: round((a.z + b.z) / 2) };
  return [{ x: a.x, y: lift, z: a.z }, mid, { x: b.x, y: lift, z: b.z }];
}
