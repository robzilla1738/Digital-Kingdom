import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { sampleFrameBudget, type FrameBudget } from "./frameBudget.ts";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MODULE_CATALOG, type ModuleId } from "@dk/contracts";
import { architectureMaterials, cachedModuleGeometryCount, moduleGeometry, retainArchitectureResources, type DetailLevel } from "./geometry.ts";
import { compileScene, defaultProposal } from "@dk/scene-compiler";
import { demoGraph } from "../../../../fixtures/testing/load.ts";
import { presentationGroups, presentationScene, presentationCollisions, relationshipPattern, groupSummary, selectionAssets } from "./scenePresentation.ts";

const ids = Object.keys(MODULE_CATALOG) as ModuleId[];

describe("shared architecture GPU lifetime", () => {
  it("releases renderer registrations only after its final module, preserving cached CPU buffers", () => {
    const geometry = moduleGeometry("hall"), group = geometry.groups.structure!, positions = group.getAttribute("position").array;
    const count = cachedModuleGeometryCount(), renderer = {};
    let disposed = 0;
    const geometryListener = () => { disposed++; group.removeEventListener("dispose", geometryListener); };
    const materialListener = () => { disposed++; architectureMaterials.body.removeEventListener("dispose", materialListener); };
    group.addEventListener("dispose", geometryListener); architectureMaterials.body.addEventListener("dispose", materialListener);
    const first = retainArchitectureResources(renderer, () => {}), second = retainArchitectureResources(renderer, () => {});
    first(); expect(disposed).toBe(0);
    second(); expect(disposed).toBe(2);
    second(); first(); expect(disposed).toBe(2);
    expect(group.hasEventListener("dispose", geometryListener)).toBe(false);
    expect(architectureMaterials.body.hasEventListener("dispose", materialListener)).toBe(false);
    expect(moduleGeometry("hall")).toBe(geometry); expect(group.getAttribute("position").array).toBe(positions);
    expect(cachedModuleGeometryCount()).toBe(count);
  });
  it("refreshes overlapping live canvases after shared GPU disposal, without retaining departed renderers", () => {
    const group = moduleGeometry("hall").groups.structure!;
    let departedRefreshes = 0, liveRefreshes = 0;
    const departedListener = () => group.removeEventListener("dispose", departedListener);
    const liveListener = () => group.removeEventListener("dispose", liveListener);
    group.addEventListener("dispose", departedListener); group.addEventListener("dispose", liveListener);
    const departed = retainArchitectureResources({}, () => { departedRefreshes++; });
    const live = retainArchitectureResources({}, () => { liveRefreshes++; group.addEventListener("dispose", liveListener); });
    departed();
    expect(departedRefreshes).toBe(0); expect(liveRefreshes).toBe(1);
    expect(group.hasEventListener("dispose", departedListener)).toBe(false);
    expect(group.hasEventListener("dispose", liveListener)).toBe(true);
    live(); expect(group.hasEventListener("dispose", liveListener)).toBe(false);
    expect(liveRefreshes).toBe(1);
  });
});
describe("architectural kit release geometry", () => {
  for (const id of ids) for (const lod of ["low", "medium", "high"] as DetailLevel[]) it(`${id} ${lod} is within actual declared bounds and budget`, () => {
    const g = moduleGeometry(id, lod), s = MODULE_CATALOG[id], eps = 1e-5;
    expect(g.triangles).toBeLessThanOrEqual(s.lod_metadata[lod]);
    expect(g.bounds.min.x).toBeGreaterThanOrEqual(-s.footprint.w / 2 - eps);
    expect(g.bounds.max.x).toBeLessThanOrEqual(s.footprint.w / 2 + eps);
    expect(g.bounds.min.z).toBeGreaterThanOrEqual(-s.footprint.d / 2 - eps);
    expect(g.bounds.max.z).toBeLessThanOrEqual(s.footprint.d / 2 + eps);
    expect(g.bounds.min.y).toBeGreaterThanOrEqual(-eps);
    expect(g.bounds.max.y).toBeLessThanOrEqual(s.height + eps);
    expect(Object.keys(g.groups).length).toBeLessThanOrEqual(4);
    expect(g.groups.structure).toBeDefined(); expect(g.groups.roof).toBeDefined();
    expect(moduleGeometry(id, lod)).toBe(g);
    expect(s.label_height).toBeGreaterThan(s.height);
  });
  it("gatehouse and portal have physical open passages through the masonry", () => {
    for (const id of ["gatehouse", "portal"] as ModuleId[]) {
      const mesh = new THREE.Mesh(moduleGeometry(id).groups.structure!, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      mesh.updateMatrixWorld();
      const ray = new THREE.Raycaster(new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, 0, -1));
      expect(ray.intersectObject(mesh)).toHaveLength(0);
      ray.set(new THREE.Vector3(id === "gatehouse" ? 1.25 : 1.1, 1, 5), new THREE.Vector3(0, 0, -1));
      expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
      (mesh.material as THREE.Material).dispose();
    }
  });
  for (const lod of ["low", "medium", "high"] as DetailLevel[]) it(`roof-off ${lod} exposes neutral floors, not hidden solid ceilings`, () => {
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    for (const [id, x, z, floorY] of [["hall", 0, 0, 0.245], ["great_hall", 0, 0, 0.245], ["gatehouse", 1.26, -0.1, 0.5], ["vault", 0, 0, 0.465]] as [ModuleId, number, number, number][]) {
      const geometry = moduleGeometry(id, lod);
      const meshes = Object.entries(geometry.groups).filter(([name]) => name !== "roof").map(([, g]) => new THREE.Mesh(g!, material));
      meshes.forEach(mesh => mesh.updateMatrixWorld());
      const hit = new THREE.Raycaster(new THREE.Vector3(x, 8, z), new THREE.Vector3(0, -1, 0)).intersectObjects(meshes)[0];
      expect(hit, `${id} ${lod} has an exposed interior floor`).toBeDefined();
      expect(hit!.point.y, `${id} ${lod} has no ceiling obscuring its floor`).toBeCloseTo(floorY, 4);
    }
    // Vault storage is intentionally low and leaves a clear central aisle.
    const bays = new THREE.Mesh(moduleGeometry("vault", lod).groups["interior-structure"]!, material); bays.updateMatrixWorld();
    const hit = new THREE.Raycaster(new THREE.Vector3(0.86, 8, -0.48), new THREE.Vector3(0, -1, 0)).intersectObject(bays)[0]!;
    expect(hit.point.y).toBeGreaterThan(0.9); expect(hit.point.y).toBeLessThan(1.1);
    material.dispose();
  });
  it("roof-off retains architecture, without new logical assets", () => {
    const g = moduleGeometry("hall");
    const roof = g.groups.roof!; const wall = g.groups.structure!;
    expect(roof.boundingBox!.max.y).toBeGreaterThan(wall.boundingBox!.max.y);
    expect(g.groups["interior-structure"]).toBeDefined();
    expect(ids).toHaveLength(16); // kit 2.1.0: ten original modules + six LP17 families
  });
});
describe("scene presentation", () => {
  it("all assets have explicit environment+zone memberships and noncolliding geometry", () => {
    const g = demoGraph(), scene = presentationScene(compileScene(g, defaultProposal(g))), groups = presentationGroups(scene, g);
    expect(groups.flatMap(g => g.rooms.map(r => r.asset_id)).sort()).toEqual(g.assets.map(a => a.id).sort());
    expect(presentationCollisions(scene.rooms)).toEqual([]);
    expect(groups.every(x => x.rooms.every(r => g.assets.find(a => a.id === r.asset_id)!.environment === x.environment))).toBe(true);
  });
  it("an event-only update reuses compiled positions and immutable module geometry", () => {
    const g = demoGraph(), scene = compileScene(g, defaultProposal(g));
    const positions = JSON.stringify(scene.rooms.map(r => r.position)), geometry = moduleGeometry("hall");
    presentationGroups(scene, g);
    expect(JSON.stringify(scene.rooms.map(r => r.position))).toBe(positions);
    expect(moduleGeometry("hall")).toBe(geometry);
  });
  it("archived events use authorized exact metadata rather than the recent window", () => {
    const graph = demoGraph();
    const vm = { findings: [], selectedEventAssets: [graph.assets[0]!.id], data: { graph, events: [], sources: [] } } as unknown as Parameters<typeof selectionAssets>[1];
    expect([...selectionAssets({ kind: "event", id: "archived" }, vm)]).toEqual([graph.assets[0]!.id]);
    const relationship = graph.relationships[0]!;
    expect(selectionAssets({ kind: "relationship", id: relationship.id }, vm)).toEqual(selectionAssets({ kind: "path", id: relationship.id }, vm));
  });
  it("observed/declared/inferred/hypothetical pattern vocabulary is distinct", () => {
    expect(new Set(["observed", "declared", "inferred", "hypothetical"].map(relationshipPattern)).size).toBe(4);
  });
  it("group summaries count distinct findings and never erase partial coverage", () => {
    const graph = demoGraph(), scene = compileScene(graph, defaultProposal(graph)), group = presentationGroups(scene, graph)[0]!;
    const statuses = new Map(group.rooms.map(r => [r.asset_id, { worst: null, severity: null, findingIds: ["same-finding"], coverage: "partial" as const, configuredSources: 2, reportingSources: 1, recentEventIds: [] }]));
    const summary = groupSummary(group, statuses);
    expect(summary.findings).toBe(1); expect(summary.coverage.partial).toBe(group.rooms.length);
  });
});

describe("demand render adaptive quality", () => {
  it("ignores idle gaps and the first active frame after one", () => {
    let state: FrameBudget = { active: false, samples: 0, slow: 0 };
    for (let i=0;i<100;i++) { const step=sampleFrameBudget(state, 30, false); state=step.state; expect(step.reduce).toBe(false); }
    const first=sampleFrameBudget(state,30,true);expect(first.reduce).toBe(false);expect(first.state.samples).toBe(0);
  });
  it("reduces detail for sustained active frames slower than 250ms", () => {
    let state: FrameBudget = { active: true, samples: 0, slow: 0 }, reduced=false;
    for(let i=0;i<21;i++){const step=sampleFrameBudget(state,0.5,true);state=step.state;reduced ||= step.reduce;}
    expect(reduced).toBe(true);
  });
  it("never reduces for healthy active 60fps samples", () => {
    let state: FrameBudget = { active: true, samples: 0, slow: 0 };
    for(let i=0;i<200;i++){const step=sampleFrameBudget(state,1/60,true);state=step.state;expect(step.reduce).toBe(false);}
  });
});

describe("castle asset provenance", () => {
  it("matches checked-in content hashes and all actual LOD triangle counts", () => {
    const root = new URL("../../../../", import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL("assets/castle-kit/MANIFEST.json", root), "utf8"));
    const digest = createHash("sha256");
    for (const path of manifest.provenance.editable_source_paths as string[]) {
      const bytes = readFileSync(new URL(path, root));
      const file = manifest.provenance.source_files.find((f: {path:string}) => f.path === path);
      expect(file.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      digest.update(path + "\0").update(bytes).update("\0");
    }
    expect(manifest.provenance.content_hash).toBe("sha256:" + digest.digest("hex"));
    expect(manifest.modules.map((m: {id:string}) => m.id).sort()).toEqual([...ids].sort());
    for (const id of ids) for (const lod of ["low", "medium", "high"] as DetailLevel[])
      expect(manifest.modules.find((m: {id:string}) => m.id === id).lods[lod].triangles).toBe(moduleGeometry(id, lod).triangles);
  });
});
