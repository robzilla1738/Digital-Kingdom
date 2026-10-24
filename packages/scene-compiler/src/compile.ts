import {
  CATALOG_VERSION, MODULE_CATALOG, ZONE_IDS, ZONE_LABELS, digest, fnv1a,
  type CompiledScene, type Graph, type SceneIncarnation, type SceneProposal, type ScenePath, type SceneRoom, type SceneZone, type Vec3, type ZoneId,
} from "@dk/contracts";
import { validateProposal } from "./validate.ts";

export const COMPILER_VERSION = "dk-scene-compiler-2.0.0";

const CELL_X = 5.6;
const CELL_Z = 5.4;
const GAP = 2.2;
const DEFAULT_CAPACITY: Record<ZoneId, number> = { public: 3, application: 9, data: 4, automation: 4, delivery: 2, external: 3 };

export interface CompileOptions {
  /** Previously approved scene: its pins and capacities keep unrelated rooms stable. */
  previous?: (Pick<CompiledScene, "pins" | "capacities"> & Partial<Pick<CompiledScene, "rooms" | "historical_rooms" | "layout_version" | "incarnations">>) | null;
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
  // R06.1 + LP16: positions of assets that left the graph stay available for historical lookup (never re-placed), and
  // an approved reflow or capacity growth starts a new layout version. History is kept per INCARNATION: an asset id
  // that is removed and later recreated (or whose declared provider identity changes) is a new incarnation, and the
  // earlier one keeps its own retired location. All of this is metadata outside the geometry digest.
  const prior = opts.previous ?? null;
  const { incarnations, retired } = trackIncarnations(graph, rooms, prior);
  const historical = [...(prior?.historical_rooms ?? []), ...retired]
    .filter((r, i, all) => all.findIndex((x) => historyKey(x) === historyKey(r)) === i).slice(-500);
  const layoutVersion = (prior?.layout_version ?? 1) + (opts.reflow || reflow.length ? 1 : 0);
  return { ...body, layout_version: layoutVersion, ...(historical.length ? { historical_rooms: historical } : {}), incarnations, digest: digest({ ...body, proposal_source: undefined }) };
}

const historyKey = (r: { asset_id: string; incarnation_id?: string; retired_in_revision: string }) => r.incarnation_id ?? `${r.asset_id}@${r.retired_in_revision}`;
const providerIdentity = (a: Graph["assets"][number] | undefined) => a?.provider_ref ? `${a.provider_ref.scope}/${a.provider_ref.id}` : null;
const ordinal = (id: string | undefined) => { const m = /~(\d+)$/.exec(id ?? ""); return m ? Number(m[1]) : 0; };

/**
 * LP16-A2: incarnation identity. A current asset keeps its prior incarnation while it stays in the graph with the
 * same declared provider identity. It gets a NEW incarnation (`<id>~<n+1>`) when it reappears after removal or when
 * its provider identity changes; the replaced incarnation is retired with its own last position. A scene stored
 * before LP16 has no incarnation map: each of its current assets is treated as incarnation 1 with an unknown
 * provider identity, which is adopted rather than read as a change.
 */
export function trackIncarnations(graph: Graph, rooms: SceneRoom[], prior: CompileOptions["previous"]): { incarnations: Record<string, SceneIncarnation>; retired: (SceneRoom & { retired_in_revision: string; incarnation_id: string })[] } {
  const assets = new Map(graph.assets.map((a) => [a.id, a]));
  const priorRooms = new Map((prior?.rooms ?? []).map((r) => [r.asset_id, r]));
  const legacy = !!prior && !prior.incarnations;
  const priorInc = (id: string): SceneIncarnation | undefined => prior?.incarnations?.[id] ?? (legacy && priorRooms.has(id) ? { id: `${id}~1`, provider_id: null, since_revision: "legacy" } : undefined);
  const highest = new Map<string, number>();
  for (const h of prior?.historical_rooms ?? []) highest.set(h.asset_id, Math.max(highest.get(h.asset_id) ?? 0, ordinal(h.incarnation_id) || 1));
  for (const [id] of priorRooms) highest.set(id, Math.max(highest.get(id) ?? 0, ordinal(priorInc(id)?.id)));
  const incarnations: Record<string, SceneIncarnation> = {};
  const retired: (SceneRoom & { retired_in_revision: string; incarnation_id: string })[] = [];
  const retire = (room: SceneRoom, inc: SceneIncarnation | undefined) => retired.push({ ...room, retired_in_revision: graph.graph_revision, incarnation_id: inc?.id ?? `${room.asset_id}~1` });
  for (const room of rooms) {
    const provider = providerIdentity(assets.get(room.asset_id));
    const was = priorRooms.get(room.asset_id), inc = was ? priorInc(room.asset_id) : undefined;
    if (was && inc && (inc.provider_id === provider || (inc.since_revision === "legacy" && inc.provider_id === null))) { incarnations[room.asset_id] = { ...inc, provider_id: provider }; continue; }
    if (was) retire(was, inc); // provider identity changed under the same asset id: the old entity retires here
    const n = (highest.get(room.asset_id) ?? 0) + 1;
    incarnations[room.asset_id] = { id: `${room.asset_id}~${n}`, provider_id: provider, since_revision: graph.graph_revision };
  }
  for (const [id, room] of priorRooms) if (!incarnations[id]) retire(room, priorInc(id));
  return { incarnations, retired };
}

/** LP16-A2: every recorded incarnation of an asset id, current first. Historical rooms are never live structures. */
export function locateAsset(scene: Pick<CompiledScene, "rooms" | "historical_rooms" | "incarnations">, assetId: string) {
  const room = scene.rooms.find((r) => r.asset_id === assetId) ?? null;
  const current = room ? { incarnation: scene.incarnations?.[assetId] ?? { id: `${assetId}~1`, provider_id: null, since_revision: "legacy" }, room } : null;
  const history = (scene.historical_rooms ?? []).filter((r) => r.asset_id === assetId)
    .map((r) => ({ incarnation_id: r.incarnation_id ?? null, retired_in_revision: r.retired_in_revision, room: r }))
    .sort((a, b) => ordinal(b.incarnation_id ?? undefined) - ordinal(a.incarnation_id ?? undefined));
  return { asset_id: assetId, current, history };
}

/**
 * LP16-A1: what a layout change does, room by room. Used to PREVIEW an intentional reflow before it is applied and to
 * record each applied layout version. Positions only; it never reads findings or activity.
 */
export function layoutDiff(before: Pick<CompiledScene, "rooms" | "layout_version" | "digest"> | null | undefined, after: Pick<CompiledScene, "rooms" | "layout_version" | "digest">) {
  const prev = new Map((before?.rooms ?? []).map((r) => [r.asset_id, r]));
  const next = new Map(after.rooms.map((r) => [r.asset_id, r]));
  const moved: { asset_id: string; from: { x: number; z: number; zone_id: string }; to: { x: number; z: number; zone_id: string } }[] = [];
  const module_changed: { asset_id: string; from: string; to: string }[] = [];
  let unchanged = 0;
  for (const [id, r] of next) {
    const p = prev.get(id); if (!p) continue;
    if (p.position.x !== r.position.x || p.position.z !== r.position.z || p.zone_id !== r.zone_id) moved.push({ asset_id: id, from: { x: p.position.x, z: p.position.z, zone_id: p.zone_id }, to: { x: r.position.x, z: r.position.z, zone_id: r.zone_id } });
    else unchanged++;
    if (p.module_id !== r.module_id) module_changed.push({ asset_id: id, from: p.module_id, to: r.module_id });
  }
  return {
    from_layout_version: before?.layout_version ?? null, to_layout_version: after.layout_version ?? 1,
    from_digest: before?.digest ?? null, to_digest: after.digest,
    added: [...next.keys()].filter((id) => !prev.has(id)).sort(), retired: [...prev.keys()].filter((id) => !next.has(id)).sort(),
    moved: moved.sort((a, b) => a.asset_id.localeCompare(b.asset_id)), module_changed, unchanged,
  };
}

function route(a: Vec3, b: Vec3, h: number): Vec3[] {
  const lift = 0.35 + (h % 7) * 0.04;
  const mid = { x: round((a.x + b.x) / 2), y: round(1.6 + (h % 5) * 0.25), z: round((a.z + b.z) / 2) };
  return [{ x: a.x, y: lift, z: a.z }, mid, { x: b.x, y: lift, z: b.z }];
}
