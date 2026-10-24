import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MODULE_CATALOG, MODULES_BY_KIND, ORIGINAL_MODULE_IDS, SURFACES, CATALOG_VERSION, SUPPORTED_CATALOG_VERSIONS, recordModuleFor, type ModuleId, type Graph } from "@dk/contracts";
import { compileScene, defaultProposal, recordProposal, validateProposal } from "@dk/scene-compiler";
import { moduleGeometry, type DetailLevel } from "./geometry.ts";
import { geometryDigest } from "./geometryDigest.ts";
import { FAMILY_SURFACE, familyCapability, presentationScene, presentationCollisions, selectionProxy } from "./scenePresentation.ts";
import { demoGraph } from "../../../../fixtures/testing/load.ts";
import { applyRedesignFixture } from "../../../../fixtures/redesign/offline.ts";
import { loadOfflineDemo } from "../lib/data.ts";

const FAMILIES = ["dns_registry", "dispatch_house", "key_registry", "supply_depot", "archive", "outpost"] as const satisfies readonly ModuleId[];
const LODS: DetailLevel[] = ["low", "medium", "high"];
const ALL = Object.keys(MODULE_CATALOG) as ModuleId[];

/** Top-down height field over a fixed 12×12 grid of the module's own footprint (max Y per cell, normalised). */
function heightField(id: ModuleId, lod: DetailLevel = "medium") {
  const g = moduleGeometry(id, lod), s = MODULE_CATALOG[id], n = 12, cells = new Float32Array(n * n);
  for (const geo of Object.values(g.groups)) {
    const pos = geo!.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const cx = Math.min(n - 1, Math.max(0, Math.floor((pos.getX(i) / s.footprint.w + 0.5) * n)));
      const cz = Math.min(n - 1, Math.max(0, Math.floor((pos.getZ(i) / s.footprint.d + 0.5) * n)));
      cells[cz * n + cx] = Math.max(cells[cz * n + cx]!, pos.getY(i));
    }
  }
  return cells;
}
const fieldDistance = (a: Float32Array, b: Float32Array) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i]! - b[i]!); return d / a.length; };

describe("LP17-A1: six families with readable, unique, in-bounds silhouettes at every supported LOD", () => {
  it("the catalog is versioned: 16 modules, ten original from 2.0.0, six families from 2.1.0", () => {
    expect(CATALOG_VERSION).toBe("dk-castle-kit-2.1.0");
    expect(SUPPORTED_CATALOG_VERSIONS).toContain("dk-castle-kit-2.0.0");
    expect(ALL).toHaveLength(16);
    for (const id of ORIGINAL_MODULE_IDS) expect(MODULE_CATALOG[id].since_catalog).toBe("2.0.0");
    for (const id of FAMILIES) expect(MODULE_CATALOG[id].since_catalog).toBe("2.1.0");
  });
  for (const id of FAMILIES) for (const lod of LODS) it(`${id} ${lod}: in bounds, within budget, four merged groups at most, real roof and structure`, () => {
    const g = moduleGeometry(id, lod), s = MODULE_CATALOG[id], eps = 1e-5;
    expect(g.triangles).toBeLessThanOrEqual(s.lod_metadata[lod]);
    expect(g.bounds.min.x).toBeGreaterThanOrEqual(-s.footprint.w / 2 - eps); expect(g.bounds.max.x).toBeLessThanOrEqual(s.footprint.w / 2 + eps);
    expect(g.bounds.min.z).toBeGreaterThanOrEqual(-s.footprint.d / 2 - eps); expect(g.bounds.max.z).toBeLessThanOrEqual(s.footprint.d / 2 + eps);
    expect(g.bounds.min.y).toBeGreaterThanOrEqual(-eps); expect(g.bounds.max.y).toBeLessThanOrEqual(s.height + eps);
    expect(Object.keys(g.groups).length).toBeLessThanOrEqual(4);
    expect(g.groups.structure).toBeDefined(); expect(g.groups.roof).toBeDefined(); expect(g.groups["interior-structure"]).toBeDefined();
    // Not a placeholder cube: many parts, and the footprint is far from a filled box (recesses, courts, roofs).
    expect(g.triangles).toBeGreaterThan(lod === "low" ? 200 : 600);
    const filled = (g.bounds.max.x - g.bounds.min.x) * (g.bounds.max.y - g.bounds.min.y) * (g.bounds.max.z - g.bounds.min.z);
    const field = heightField(id, lod), mean = field.reduce((a, b) => a + b, 0) / field.length;
    expect(mean * s.footprint.w * s.footprint.d).toBeLessThan(filled * 0.8);
    expect(s.label_height).toBeGreaterThan(s.height);
  });
  it("every family's silhouette differs from every other module (height-field distance)", () => {
    const fields = new Map(ALL.map((id) => [id, heightField(id)]));
    const pairs: { a: string; b: string; d: number }[] = [];
    for (const a of FAMILIES) for (const b of ALL) if (a !== b) pairs.push({ a, b, d: fieldDistance(fields.get(a)!, fields.get(b)!) });
    const nearest = pairs.sort((x, y) => x.d - y.d)[0]!;
    expect(nearest.d, `${nearest.a} vs ${nearest.b}`).toBeGreaterThan(0.12);
    // footprint + height signatures are unique too
    const sig = new Set(ALL.map((id) => { const s = MODULE_CATALOG[id]; return `${s.footprint.w}x${s.footprint.d}x${s.height}`; }));
    expect(sig.size).toBe(ALL.length);
  });
  it("architectural depth: open doorways/bays through masonry and an exposed floor with roofs off", () => {
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const nonRoof = (id: ModuleId, lod: DetailLevel) => Object.entries(moduleGeometry(id, lod).groups).filter(([n]) => n !== "roof").map(([, g]) => { const m = new THREE.Mesh(g!, material); m.updateMatrixWorld(); return m; });
    // horizontal rays through the doorways reach the interior (they hit the back wall, not the front wall)
    for (const [id, x, y, backZ] of [["dispatch_house", -0.98, 0.45, -0.9], ["dispatch_house", 0.98, 0.45, -0.9], ["archive", 0, 0.45, -0.95], ["key_registry", 0, 0.5, -1.0], ["supply_depot", -0.65, 0.4, -1.2], ["dns_registry", 0.4, 0.4, -1.1], ["outpost", -0.1, 0.72, -0.6]] as [ModuleId, number, number, number][]) {
      const hit = new THREE.Raycaster(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1)).intersectObjects(nonRoof(id, "medium"))[0];
      expect(hit, `${id} has an open entrance at x=${x}`).toBeDefined();
      expect(hit!.point.z, `${id} entrance is recessed, not a painted door`).toBeLessThan(backZ + 0.75);
    }
    for (const lod of LODS) for (const [id, x, z] of [["dispatch_house", -0.6, -0.4], ["key_registry", 0, 0.2], ["archive", 0, 0.1], ["supply_depot", -0.65, 0.2], ["dns_registry", 0.4, -0.3], ["outpost", -0.1, -0.1]] as [ModuleId, number, number][]) {
      const hit = new THREE.Raycaster(new THREE.Vector3(x, 9, z), new THREE.Vector3(0, -1, 0)).intersectObjects(nonRoof(id, lod))[0];
      expect(hit, `${id} ${lod} exposes an interior floor`).toBeDefined();
      expect(hit!.point.y, `${id} ${lod} has no ceiling over its floor`).toBeLessThan(0.6);
    }
    material.dispose();
  });
});

describe("LP17-A2: selection proxies at overview and interior scales never intercept unrelated clicks", () => {
  for (const id of ALL) it(`${id}: proxy stays inside the footprint; roofs-off proxy is a low plinth that leaves the interior open`, () => {
    const s = MODULE_CATALOG[id];
    const over = selectionProxy(s, true), inside = selectionProxy(s, false);
    for (const p of [over, inside]) { expect(p.w).toBeLessThanOrEqual(s.footprint.w + 1e-9); expect(p.d).toBeLessThanOrEqual(s.footprint.d + 1e-9); expect(p.y - p.h / 2).toBeGreaterThanOrEqual(-1e-9); }
    expect(over.h).toBe(s.height);
    expect(inside.y + inside.h / 2).toBeLessThanOrEqual(0.3);
    // a ray from above into the interior anchor passes the roofs-off proxy without hitting it above floor level
    const box = new THREE.Box3(new THREE.Vector3(-inside.w / 2, inside.y - inside.h / 2, -inside.d / 2), new THREE.Vector3(inside.w / 2, inside.y + inside.h / 2, inside.d / 2));
    const hit = new THREE.Ray(new THREE.Vector3(0, 9, 0), new THREE.Vector3(0, -1, 0)).intersectBox(box, new THREE.Vector3());
    expect(hit!.y).toBeLessThanOrEqual(s.interior_anchor.position[1] + 1e-9);
  });
  it("a ground point between two placed buildings hits no proxy (overview and roofs-off)", () => {
    const g = demoGraph(), scene = presentationScene(compileScene(g, defaultProposal(g)));
    // two rooms on the same row with clear ground between them (no footprint covers the midpoint)
    const covers = (x: number, z: number) => scene.rooms.some((r) => Math.abs(x - r.position.x) < r.footprint.w / 2 && Math.abs(z - r.position.z) < r.footprint.d / 2);
    let a: (typeof scene.rooms)[number] | undefined, b: typeof a, gapX = 0;
    for (const x of scene.rooms) for (const y of scene.rooms) {
      if (a || x === y || Math.abs(x.position.z - y.position.z) > 0.01 || x.position.x >= y.position.x) continue;
      const left = x.position.x + x.footprint.w / 2, right = y.position.x - y.footprint.w / 2;
      if (right - left > 0.2 && !covers((left + right) / 2, x.position.z)) { a = x; b = y; gapX = (left + right) / 2; }
    }
    expect(a && b, "a row pair with clear ground between them").toBeTruthy();
    for (const roofs of [true, false]) for (const r of scene.rooms) {
      const p = selectionProxy(MODULE_CATALOG[r.module_id], roofs), rot = Math.abs(r.rotation_y) % 180 === 90;
      const w = rot ? p.d : p.w, d = rot ? p.w : p.d;
      const box = new THREE.Box3(new THREE.Vector3(r.position.x - w / 2, p.y - p.h / 2, r.position.z - d / 2), new THREE.Vector3(r.position.x + w / 2, p.y + p.h / 2, r.position.z + d / 2));
      expect(new THREE.Ray(new THREE.Vector3(gapX, 30, a!.position.z), new THREE.Vector3(0, -1, 0)).intersectsBox(box), `${r.asset_id} roofs=${roofs}`).toBe(false);
    }
  });
});

describe("LP17-A3: geometry, material and manifest hashes and licenses are recorded; no font files are distributed", () => {
  const root = new URL("../../../../", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("assets/castle-kit/MANIFEST.json", root), "utf8"));
  it("the manifest lists all 16 modules with per-LOD triangle counts, bounds and geometry digests that match the code", () => {
    expect(manifest.catalog_version).toBe(CATALOG_VERSION);
    expect(manifest.modules.map((m: { id: string }) => m.id).sort()).toEqual([...ALL].sort());
    for (const m of manifest.modules as { id: ModuleId; license: string; since_catalog: string; lods: Record<DetailLevel, { triangles: number; geometry_sha256: string }> }[]) {
      expect(m.license).toBe("Apache-2.0");
      expect(m.since_catalog).toBe(MODULE_CATALOG[m.id].since_catalog);
      for (const lod of LODS) { expect(m.lods[lod].triangles).toBe(moduleGeometry(m.id, lod).triangles); expect(m.lods[lod].geometry_sha256).toBe(geometryDigest(m.id, lod)); }
    }
    expect(manifest.materials_sha256).toBe("sha256:" + createHash("sha256").update(JSON.stringify(manifest.materials)).digest("hex"));
    const hash = createHash("sha256").update(JSON.stringify({ ...manifest, manifest_sha256: undefined })).digest("hex");
    expect(manifest.manifest_sha256).toBe("sha256:" + hash);
  });
  it("the kit ships no font, texture, mesh or remote asset; screenshot evidence and exports carry no font files", () => {
    const kit = readdirSync(new URL("assets/castle-kit/", root));
    expect(kit).toEqual(["MANIFEST.json"]);
    expect(JSON.stringify(manifest)).not.toMatch(/\.(woff2?|ttf|otf|glb|gltf|fbx|obj)\b|https?:\/\//i);
    const walk = (dir: string): string[] => { try { return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; }); } catch { return []; } };
    const evidence = walk(new URL("artifacts/phase-local-intelligence/M4/", root).pathname).filter((p) => !p.includes("test-results"));
    expect(evidence.filter((p) => /\.(woff2?|ttf|otf)$/i.test(p))).toEqual([]);
  });
});

describe("LP17-A4: families never imply discovery or verification; unsupported surfaces show honest capability", () => {
  it("records choose families only through declared/supported fields, and only modules the kind allows", () => {
    expect(recordModuleFor({ kind: "storage", secondary_label: "queue@1.0.0" })).toBe("dispatch_house");
    expect(recordModuleFor({ kind: "pipeline", secondary_label: "artifact_depot@1.1.0" })).toBe("supply_depot");
    expect(recordModuleFor({ kind: "auth", secondary_label: "local_issuer@1.1.0" })).toBe("key_registry");
    expect(recordModuleFor({ kind: "storage", secondary_label: "receiver@1.0.0" })).toBe("outpost");
    expect(recordModuleFor({ kind: "storage", provider_ref: { scope: "111122223333", id: "arn:aws:s3:::bucket" } })).toBe("archive");
    expect(recordModuleFor({ kind: "auth", provider_ref: { scope: "111122223333", id: "arn:aws:iam::111122223333:role/x" } })).toBe("key_registry");
    expect(recordModuleFor({ kind: "edge", routes: [{ hosts: ["shop.local.test"] }] })).toBe("dns_registry");
    // a template stamp for a kind that may not use the family is ignored, never forced
    expect(recordModuleFor({ kind: "service", secondary_label: "queue@1.0.0" })).toBeNull();
    for (const kind of Object.keys(MODULES_BY_KIND) as (keyof typeof MODULES_BY_KIND)[]) for (const m of MODULES_BY_KIND[kind]) expect(MODULE_CATALOG[m]).toBeDefined();
  });
  it("the default proposal is unchanged (existing projects are never re-skinned); recordProposal changes modules only", () => {
    const g = demoGraph();
    expect(defaultProposal(g).placements.every((p) => (ORIGINAL_MODULE_IDS as readonly string[]).includes(p.module_id))).toBe(true);
    const fixture = applyRedesignFixture(loadOfflineDemo(), "F15");
    const rec = recordProposal(fixture.graph, 3), def = defaultProposal(fixture.graph, 3);
    expect(validateProposal(fixture.graph, rec).ok).toBe(true);
    expect(rec.placements.map((p) => [p.asset_id, p.zone_id])).toEqual(def.placements.map((p) => [p.asset_id, p.zone_id]));
    expect(new Set(fixture.scene.rooms.map((r) => r.module_id))).toEqual(expect.objectContaining({}));
    for (const f of FAMILIES) expect(fixture.scene.rooms.some((r) => r.module_id === f), f).toBe(true);
    expect(presentationCollisions(presentationScene(fixture.scene).rooms)).toEqual([]);
  });
  it("each family states the registry support of the surface it depicts, separately from the drawing", () => {
    for (const f of FAMILIES) {
      const cap = familyCapability(f)!;
      const surface = SURFACES.find((s) => s.id === FAMILY_SURFACE[f])!;
      expect(cap.support).toBe(surface.support);
      expect(cap.text).toContain(surface.support_evidence);
      expect(cap.text).toMatch(/does not mean (it is|this asset is) discovered, monitored or protected/);
    }
    expect(familyCapability("dns_registry")!.support).toBe("not_implemented");
    expect(familyCapability("dns_registry")!.text).toMatch(/no Internet discovery/);
    expect(familyCapability("hall")).toBeNull();
  });
  it("a stored scene that names an unknown (future) module keeps its asset and stored footprint, labelled as a placeholder", () => {
    const g = demoGraph(), scene = compileScene(g, defaultProposal(g));
    const odd = structuredClone(scene); (odd.rooms[0] as { module_id: string }).module_id = "observatory_v9";
    const p = presentationScene(odd as Parameters<typeof presentationScene>[0]);
    expect(p.rooms[0]!.asset_id).toBe(scene.rooms[0]!.asset_id);
    expect(p.rooms[0]!.footprint).toEqual(scene.rooms[0]!.footprint);
    expect(p.rooms.length).toBe(scene.rooms.length);
    const legacy = structuredClone(scene) as Graph & typeof scene; legacy.catalog_version = "dk-castle-kit-2.0.0";
    expect(presentationScene(legacy).rooms.map((r) => r.module_id)).toEqual(scene.rooms.map((r) => r.module_id));
  });
});
