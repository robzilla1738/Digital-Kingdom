import { describe, expect, it } from "vitest";
import { buildHierarchy } from "@dk/scene-compiler";
import type { CompiledScene, Graph, SceneRoom } from "@dk/contracts";
import { demoGraph } from "../../../../fixtures/testing/load.ts";
import { applyRedesignFixture } from "../../../../fixtures/redesign/offline.ts";
import { REALM_ENVIRONMENT_GAP, packEnvironments, presentationCollisions, presentationScene, realmPresentation } from "./scenePresentation.ts";

/**
 * next-C follow-up: the realm overview packs environment regions with a bounded gap. Display only: the stored scene,
 * its rooms and its geometry digest are never changed, and every room keeps its offset inside its environment.
 */
function fixture(id: "F15" | "F01") {
  const graph = demoGraph();
  const base = { mode: "offline-demo", project: { id: graph.project_id, name: "x", dataset_kind: "synthetic" }, projects: [], graph, sources: [], events: [], evidence: {}, findings: [], coverage: [], unobserved_asset_ids: [] } as never;
  return applyRedesignFixture(base, id) as { graph: Graph; scene: CompiledScene };
}
function extents(rooms: SceneRoom[], graph: Graph) {
  const env = new Map(graph.assets.map((a) => [a.id, a.environment]));
  const out = new Map<string, { min: number; max: number }>();
  for (const r of rooms) {
    const e = env.get(r.asset_id)!, x = out.get(e) ?? { min: Infinity, max: -Infinity };
    x.min = Math.min(x.min, r.position.x - r.footprint.w / 2); x.max = Math.max(x.max, r.position.x + r.footprint.w / 2); out.set(e, x);
  }
  return [...out].sort((a, b) => a[1].min - b[1].min);
}

describe("next-C realm overview packing (presentation only)", () => {
  it("bounds the empty gap between environments in the F15 mixed world", () => {
    const { graph, scene } = fixture("F15");
    const before = extents(presentationScene(scene).rooms, graph);
    expect(before.length).toBe(2);
    // the stored layout has a large gap (the compiler's environment stride); this is what the overview used to show
    expect(before[1]![1].min - before[0]![1].max).toBeGreaterThan(REALM_ENVIRONMENT_GAP * 3);
    const packed = realmPresentation(scene, graph);
    const after = extents(packed.rooms, graph);
    for (let i = 1; i < after.length; i++) {
      const gap = after[i]![1].min - after[i - 1]![1].max;
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(REALM_ENVIRONMENT_GAP + 1e-9);
    }
    // the populated union is now mostly buildings, not empty lawn
    const span = packed.bounds.maxX - packed.bounds.minX, occupied = after.reduce((s, [, x]) => s + x.max - x.min, 0);
    expect(occupied / span).toBeGreaterThan(0.7);
    expect(presentationCollisions(packed.rooms)).toEqual([]);
  });

  it("preserves every room's offset inside its environment and the environment order", () => {
    const { graph, scene } = fixture("F15");
    const plain = presentationScene(scene), packed = realmPresentation(scene, graph);
    const env = new Map(graph.assets.map((a) => [a.id, a.environment]));
    const shift = new Map<string, number>();
    for (const r of plain.rooms) {
      const p = packed.rooms.find((q) => q.asset_id === r.asset_id)!;
      expect(p.position.z).toBe(r.position.z); expect(p.position.y).toBe(r.position.y);
      expect(p.footprint).toEqual(r.footprint); expect(p.zone_id).toBe(r.zone_id); expect(p.slot).toBe(r.slot);
      expect(p.label_anchor.x - p.position.x).toBeCloseTo(r.label_anchor.x - r.position.x, 9);
      const d = p.position.x - r.position.x, e = env.get(r.asset_id)!;
      if (shift.has(e)) expect(d).toBeCloseTo(shift.get(e)!, 9); else shift.set(e, d);
    }
    // environment order (left to right) is unchanged and matches the world hierarchy the 2D graph and navigator use
    const order = (rooms: SceneRoom[]) => extents(rooms, graph).map(([e]) => `env:${e}`);
    expect(order(packed.rooms)).toEqual(order(plain.rooms));
    const h = buildHierarchy(graph, scene);
    expect(order(packed.rooms)).toEqual(h.realm.children.filter((n) => n.kind === "environment" && n.asset_ids.length).map((n) => n.id));
    // relationship endpoints stay attached to their (moved) buildings
    for (const p of packed.paths) {
      const s = packed.rooms.find((r) => r.asset_id === p.source_asset_id)!, t = packed.rooms.find((r) => r.asset_id === p.target_asset_id)!;
      const sp = plain.paths.find((q) => q.relationship_id === p.relationship_id)!;
      const ps = plain.rooms.find((r) => r.asset_id === p.source_asset_id)!, pt = plain.rooms.find((r) => r.asset_id === p.target_asset_id)!;
      expect(p.points[0]!.x - s.position.x).toBeCloseTo(sp.points[0]!.x - ps.position.x, 6);
      expect(p.points.at(-1)!.x - t.position.x).toBeCloseTo(sp.points.at(-1)!.x - pt.position.x, 6);
      for (let i = 1; i < p.points.length; i++) expect(Math.sign(p.points[i]!.x - p.points[i - 1]!.x)).toBe(Math.sign(sp.points[i]!.x - sp.points[i - 1]!.x));
    }
  });

  it("never writes the stored scene: rooms, pins and the geometry digest are unchanged", () => {
    const { graph, scene } = fixture("F15");
    const snapshot = JSON.stringify(scene), digest = scene.digest;
    const packed = realmPresentation(scene, graph);
    expect(JSON.stringify(scene)).toBe(snapshot);
    expect(packed.digest).toBe(digest);
    expect(packed.pins).toEqual(scene.pins);
    expect(packed.rooms).not.toBe(scene.rooms);
  });

  it("is the identity for a single-environment world and idempotent", () => {
    const { graph, scene } = fixture("F01");
    const plain = presentationScene(scene);
    expect(realmPresentation(scene, graph)).toEqual(plain);
    const { graph: g15, scene: s15 } = fixture("F15");
    const once = realmPresentation(s15, g15);
    expect(packEnvironments(once, g15)).toEqual(once);
  });
});
