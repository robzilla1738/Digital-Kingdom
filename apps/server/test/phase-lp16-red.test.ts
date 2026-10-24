import { describe, expect, it } from "vitest";
import type { Graph } from "@dk/contracts";
import { compileScene, defaultProposal } from "@dk/scene-compiler";
import { liveGraph } from "./helpers.ts";

/** LP16-A2 reproduction (written before the fix): a removed then recreated resource must keep its earlier incarnation. */
describe("LP16-A2 negative reproduction", () => {
  it("a recreated asset id keeps the historical location of its earlier incarnation", () => {
    const g1 = liveGraph() as unknown as Graph;
    const s1 = compileScene(g1, defaultProposal(g1));
    const g2 = { ...g1, graph_revision: "r2", assets: g1.assets.filter((a) => a.id !== "db"), relationships: g1.relationships.filter((r) => r.target_id !== "db") } as Graph;
    const s2 = compileScene(g2, defaultProposal(g2), { previous: s1 });
    expect(s2.historical_rooms?.map((r) => r.asset_id)).toEqual(["db"]);
    const g3 = { ...g1, graph_revision: "r3" } as Graph;
    const s3 = compileScene(g3, defaultProposal(g3), { previous: s2 });
    // the earlier incarnation's retired position must survive the recreation
    expect(s3.historical_rooms?.some((r) => r.asset_id === "db")).toBe(true);
  });
});
