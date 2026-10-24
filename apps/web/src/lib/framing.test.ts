import { describe, expect, it } from "vitest";
import { buildHierarchy } from "@dk/scene-compiler";
import { demoGraph } from "../../../../fixtures/testing/load.ts";
import { applyRedesignFixture } from "../../../../fixtures/redesign/offline.ts";
import { activeEnvironment, effectiveWorldFocus, environmentRanking } from "./framing.ts";
import type { AssetStatus } from "./presentation.ts";

function f15() {
  const graph = demoGraph();
  const base = { mode: "offline-demo", project: { id: graph.project_id, name: "x", dataset_kind: "synthetic" }, projects: [], graph, sources: [], events: [], evidence: {}, findings: [], coverage: [], unobserved_asset_ids: [] } as never;
  const d = applyRedesignFixture(base, "F15");
  return { d, h: buildHierarchy(d.graph, d.scene) };
}
const st = (severity: AssetStatus["severity"], findingIds: string[] = []): AssetStatus => ({ worst: null, severity, findingIds, coverage: "reporting" } as AssetStatus);

describe("next-C active-environment framing", () => {
  it("a single-environment world has no implicit framing (unchanged behavior)", () => {
    const graph = demoGraph();
    const base = { mode: "offline-demo", project: { id: graph.project_id, name: "x", dataset_kind: "synthetic" }, projects: [], graph, sources: [], events: [], evidence: {}, findings: [], coverage: [], unobserved_asset_ids: [] } as never;
    const d = applyRedesignFixture(base, "F01");
    const h = buildHierarchy(d.graph, d.scene);
    expect(activeEnvironment(h, new Map())).toBeNull();
    expect(effectiveWorldFocus(h, null, new Map())).toEqual({ id: null, implicit: false, environments: 1 });
  });

  it("the mixed F15 world defaults to the environment with the most urgent findings, then findings, then assets", () => {
    const { d, h } = f15();
    const demoAssets = d.graph.assets.filter((a) => a.environment !== "synthetic-design");
    const statuses = new Map<string, AssetStatus>([[demoAssets[0]!.id, st("high", ["f1"])], ["families-depot", st("medium", ["f2", "f3"])]]);
    expect(activeEnvironment(h, statuses)).toBe(`env:${demoAssets[0]!.environment}`);
    // more urgent findings in the other environment wins
    const statuses2 = new Map<string, AssetStatus>([[demoAssets[0]!.id, st("medium", ["f1"])], ["families-depot", st("critical", ["f2"])]]);
    expect(activeEnvironment(h, statuses2)).toBe("env:synthetic-design");
    // no findings anywhere: the most populated environment
    const rank = environmentRanking(h, new Map());
    expect(rank[0]!.assetCount).toBeGreaterThanOrEqual(rank[1]!.assetCount);
    expect(activeEnvironment(h, new Map())).toBe(rank[0]!.id);
  });

  it("an explicit world focus (including realm overview) always wins over the implicit default", () => {
    const { h } = f15();
    const implicit = effectiveWorldFocus(h, null, new Map());
    expect(implicit.implicit).toBe(true);
    expect(implicit.id).toMatch(/^env:/);
    expect(implicit.environments).toBe(2);
    expect(effectiveWorldFocus(h, h.realm.id, new Map())).toEqual({ id: h.realm.id, implicit: false, environments: 2 });
    expect(effectiveWorldFocus(h, "env:synthetic-design", new Map())).toEqual({ id: "env:synthetic-design", implicit: false, environments: 2 });
    // an unknown/stale focus id falls back to the default rather than framing nothing
    expect(effectiveWorldFocus(h, "env:gone", new Map()).implicit).toBe(true);
  });
});
