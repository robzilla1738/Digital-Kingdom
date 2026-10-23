import { describe, expect, it } from "vitest";
import type { Graph } from "@dk/contracts";
import { buildHierarchy, compileScene, defaultProposal, footprintCollisions } from "@dk/scene-compiler";
import { setup } from "./helpers.ts";
import { parseNavigation, serializeNavigation } from "../../web/src/lib/navigation.ts";

/** R06.1 semantic world hierarchy without remapping history. */
describe("R06.1 world hierarchy", () => {
  it("adding a resource does not rearrange unrelated districts or rename groups", async () => {
    const ctx = await setup();
    const graph = ctx.store.getGraph("demo-castle")!;
    const before = ctx.store.getScene("demo-castle")!;
    const hBefore = buildHierarchy(graph, before);
    const next: Graph = { ...graph, graph_revision: graph.graph_revision + "-plus", assets: [...graph.assets, { id: "cache2", name: "session-cache", kind: "database", environment: graph.assets[0]!.environment, allowed_zone_ids: ["data"], source_refs: ["manifest"] }] } as Graph;
    const r = await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/graph", headers: ctx.h(ctx.admin), payload: next });
    expect(r.statusCode, r.body).toBe(200);
    const after = ctx.store.getScene("demo-castle")!;
    const newZone = after.rooms.find((x) => x.asset_id === "cache2")!.zone_id;
    for (const room of before.rooms) {
      const now = after.rooms.find((x) => x.asset_id === room.asset_id)!;
      if (room.zone_id !== newZone || !after.reflow_zones.includes(room.zone_id)) expect(now.position, room.asset_id).toEqual(room.position);
    }
    const hAfter = buildHierarchy(next, after);
    const ids = (h: typeof hBefore) => h.realm.children.flatMap((e) => [e.id, ...e.children.map((d) => d.id)]);
    for (const id of ids(hBefore)) expect(ids(hAfter)).toContain(id);
  });

  it("groups are presentation only and do not depend on activity or findings", async () => {
    const ctx = await setup();
    const graph = ctx.store.getGraph("demo-castle")!, scene = ctx.store.getScene("demo-castle")!;
    const h = buildHierarchy(graph, scene);
    const all = (n: typeof h.realm): (typeof h.realm)[] => [n, ...n.children.flatMap(all)];
    expect(all(h.realm).every((n) => n.presentation_only)).toBe(true);
    expect(JSON.stringify([h.realm, h.index])).not.toMatch(/finding|incident|severity/);
    expect(h.index.map((i) => i.asset_id).sort()).toEqual(graph.assets.filter((a) => a.lifecycle !== "tombstoned").map((a) => a.id).sort()); // searchable list equals the views
    const api = (await ctx.app.inject({ url: "/api/projects/demo-castle/scene/hierarchy", headers: ctx.h(ctx.viewer) })).json();
    expect(api.realm).toEqual(h.realm);
    expect(api.collisions).toEqual([]);
    expect(api.layout_version).toBeGreaterThanOrEqual(1);
  });

  it("selection survives 3D/2D switching and historical lookup of a removed asset", async () => {
    const nav = parseNavigation(new URLSearchParams({ v: "2", workspace: "kingdom", view: "castle", sel: "asset:db" }).toString());
    const switched = parseNavigation(serializeNavigation({ ...nav, view: "graph" }));
    expect(switched.selection).toEqual({ kind: "asset", id: "db" });
    const ctx = await setup();
    const graph = ctx.store.getGraph("demo-castle")!;
    const without = { ...graph, graph_revision: graph.graph_revision + "-minus", assets: graph.assets.filter((a) => a.id !== "blob"), relationships: graph.relationships.filter((r) => r.source_id !== "blob" && r.target_id !== "blob") };
    expect((await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/graph", headers: ctx.h(ctx.admin), payload: without })).statusCode).toBe(200);
    const loc = (await ctx.app.inject({ url: "/api/projects/demo-castle/scene/locate/blob", headers: ctx.h(ctx.viewer) })).json();
    expect(loc).toMatchObject({ state: "historical", room: { asset_id: "blob", retired_in_revision: without.graph_revision } });
    expect((await ctx.app.inject({ url: "/api/projects/demo-castle/scene/locate/api", headers: ctx.h(ctx.viewer) })).json().state).toBe("current");
    expect(ctx.store.getScene("demo-castle")!.rooms.some((r) => r.asset_id === "blob")).toBe(false); // never rendered live
  });

  it("legacy stored scenes keep supported positions and report footprint collisions instead of moving rooms", async () => {
    const ctx = await setup();
    const graph = ctx.store.getGraph("demo-castle")!;
    const legacy = structuredClone(ctx.store.getScene("demo-castle")!) as ReturnType<typeof ctx.store.getScene> & { layout_version?: number };
    delete legacy!.layout_version;
    const [a, b] = legacy!.rooms;
    b!.position = { ...a!.position }; // a stored overlap from an older compiler
    expect(footprintCollisions(legacy!)).toEqual([{ a: a!.asset_id, b: b!.asset_id }]);
    const recompiled = compileScene(graph, defaultProposal(graph, legacy!.seed), { previous: legacy!, source: "default" });
    for (const r of legacy!.rooms.filter((x) => x.asset_id !== b!.asset_id)) expect(recompiled.rooms.find((x) => x.asset_id === r.asset_id)!.position).toEqual(r.position);
    expect(recompiled.layout_version).toBe(1 + (recompiled.reflow_zones.length ? 1 : 0));
  });
});
