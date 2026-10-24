import { describe, expect, it } from "vitest";
import type { Asset, Graph } from "@dk/contracts";
import { buildHierarchy, compileScene, defaultProposal, hierarchyNodes, hierarchyTrail, locateAsset, searchWorld, semanticLevelForScale, structureNodeFor } from "@dk/scene-compiler";
import { liveGraph, setup } from "./helpers.ts";
import { parseNavigation, serializeNavigation } from "../../web/src/lib/navigation.ts";
import { reducer, type UiState } from "../../web/src/lib/state.tsx";
import { districtGroupKey, focusMembers, worldViewLabel } from "../../web/src/lib/world.ts";

const P = "/api/projects/demo-castle";
const kinds = ["edge", "auth", "service", "worker", "database", "agent", "tool_server", "pipeline", "third_party"] as const;
const zoneOf: Record<string, string> = { edge: "public", auth: "public", service: "application", worker: "application", database: "data", agent: "automation", tool_server: "automation", pipeline: "delivery", third_party: "external" };
function scaleGraph(n: number): Graph {
  const assets: Asset[] = [];
  for (let i = 1; i <= n; i++) {
    const kind = kinds[(i - 1) % kinds.length]!;
    assets.push({ id: `a-${String(i).padStart(3, "0")}`, name: `Synthetic ${kind} ${i}`, kind, environment: i % 4 === 0 ? "staging" : "prod", allowed_zone_ids: [zoneOf[kind] as Asset["allowed_zone_ids"][number]], source_refs: ["fixture:lp16"], aliases: [`alias-${i}`], ...(i % 7 === 0 ? { provider_ref: { scope: "acct-1", id: `res-${i}` } } : {}) });
  }
  return { schema_version: "0.2", dataset_kind: "live", project_id: "scale", graph_revision: `scale-${n}`, assets, relationships: [] } as Graph;
}

describe("LP16 world hierarchy and semantic zoom", () => {
  it("A1: adding a service keeps unrelated coordinates and records a layout version; reflow is previewed, bound and versioned", async () => {
    const ctx = await setup();
    const before = ctx.store.getScene("demo-castle")!;
    const graph = ctx.store.getGraph("demo-castle")!;
    const layouts0 = (await ctx.app.inject({ url: `${P}/scene/layouts`, headers: ctx.h(ctx.viewer) })).json();
    expect(layouts0.layouts.length).toBeGreaterThanOrEqual(1);
    const next = { ...graph, graph_revision: graph.graph_revision + "-svc", assets: [...graph.assets, { id: "ledger", name: "ledger-api", kind: "service", environment: "demo", allowed_zone_ids: ["application"], source_refs: ["manifest"] }] } as Graph;
    expect((await ctx.app.inject({ method: "POST", url: `${P}/graph`, headers: ctx.h(ctx.admin), payload: next })).statusCode).toBe(200);
    const after = ctx.store.getScene("demo-castle")!;
    if (!after.reflow_zones.length) for (const r of before.rooms) expect(after.rooms.find((x) => x.asset_id === r.asset_id)!.position, r.asset_id).toEqual(r.position);
    else for (const r of before.rooms.filter((x) => !after.reflow_zones.includes(x.zone_id))) expect(after.rooms.find((x) => x.asset_id === r.asset_id)!.position).toEqual(r.position);
    const layouts1 = (await ctx.app.inject({ url: `${P}/scene/layouts`, headers: ctx.h(ctx.viewer) })).json();
    expect(layouts1.layouts[0]).toMatchObject({ reason: "graph", graph_revision: next.graph_revision, scene_digest: after.digest, diff: { added: ["ledger"], moved_count: 0 } });

    // preview: analyst only, nothing stored
    expect((await ctx.app.inject({ url: `${P}/scene/reflow/preview`, headers: ctx.h(ctx.viewer) })).statusCode).toBe(403);
    const preview = (await ctx.app.inject({ url: `${P}/scene/reflow/preview`, headers: ctx.h(ctx.analyst) })).json();
    expect(preview.applied).toBe(false);
    expect(preview.diff.from_layout_version).toBe(after.layout_version);
    expect(preview.diff.to_layout_version).toBe((after.layout_version ?? 1) + 1);
    expect(preview.diff.moved.length + preview.diff.unchanged).toBe(after.rooms.length);
    for (const m of preview.diff.moved) expect(m.from).not.toEqual(m.to);
    expect(ctx.store.getScene("demo-castle")!.digest).toBe(after.digest);
    expect((await ctx.app.inject({ url: `${P}/scene/layouts`, headers: ctx.h(ctx.viewer) })).json().layouts.length).toBe(layouts1.layouts.length);

    // a stale preview cannot be applied; the matching preview applies exactly what was shown
    const stale = await ctx.app.inject({ method: "POST", url: `${P}/scene/reflow`, headers: ctx.h(ctx.admin), payload: { preview_digest: "0".repeat(64) } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current.preview_digest).toBe(preview.preview_digest);
    const applied = await ctx.app.inject({ method: "POST", url: `${P}/scene/reflow`, headers: ctx.h(ctx.admin), payload: { preview_digest: preview.preview_digest } });
    expect(applied.statusCode, applied.body).toBe(200);
    const reflowed = ctx.store.getScene("demo-castle")!;
    expect(reflowed.layout_version).toBe(preview.diff.to_layout_version);
    expect(reflowed.digest).toBe(preview.diff.to_digest);
    const layouts2 = (await ctx.app.inject({ url: `${P}/scene/layouts`, headers: ctx.h(ctx.viewer) })).json();
    expect(layouts2.current_layout_version).toBe(preview.diff.to_layout_version);
    expect(layouts2.layouts[0]).toMatchObject({ reason: "reflow", layout_version: preview.diff.to_layout_version });
    expect(layouts2.layouts[0].diff.moved).toEqual(preview.diff.moved);
    // the history is append-only
    expect(() => ctx.db.prepare("DELETE FROM scene_layouts").run()).toThrow(/append-only/);
  });

  it("A2: removed and recreated resources resolve to their own incarnation and historical location", async () => {
    const g1 = liveGraph() as unknown as Graph;
    const s1 = compileScene(g1, defaultProposal(g1));
    expect(s1.incarnations!.db).toEqual({ id: "db~1", provider_id: null, since_revision: "r1" });
    const g2 = { ...g1, graph_revision: "r2", assets: g1.assets.filter((a) => a.id !== "db"), relationships: g1.relationships.filter((r) => r.target_id !== "db") } as Graph;
    const s2 = compileScene(g2, defaultProposal(g2), { previous: s1 });
    expect(s2.historical_rooms).toEqual([expect.objectContaining({ asset_id: "db", incarnation_id: "db~1", retired_in_revision: "r2", position: s1.rooms.find((r) => r.asset_id === "db")!.position })]);
    // recreated with a different declared provider identity
    const g3 = { ...g1, graph_revision: "r3", assets: g1.assets.map((a) => a.id === "db" ? { ...a, provider_ref: { scope: "acct-9", id: "db-cluster-2" } } : a) } as Graph;
    const s3 = compileScene(g3, defaultProposal(g3), { previous: s2 });
    const loc = locateAsset(s3, "db");
    expect(loc.current!.incarnation).toEqual({ id: "db~2", provider_id: "acct-9/db-cluster-2", since_revision: "r3" });
    expect(loc.history.map((h) => [h.incarnation_id, h.retired_in_revision])).toEqual([["db~1", "r2"]]);
    expect(loc.history[0]!.room.position).toEqual(s1.rooms.find((r) => r.asset_id === "db")!.position);
    // unchanged assets keep their incarnation across revisions
    expect(s3.incarnations!.api).toEqual(s1.incarnations!.api);
    // provider identity change under the same id (never removed) retires the old entity at its position
    const g4 = { ...g3, graph_revision: "r4", assets: g3.assets.map((a) => a.id === "db" ? { ...a, provider_ref: { scope: "acct-9", id: "db-cluster-3" } } : a) } as Graph;
    const s4 = compileScene(g4, defaultProposal(g4), { previous: s3 });
    expect(locateAsset(s4, "db").current!.incarnation.id).toBe("db~3");
    expect(locateAsset(s4, "db").history.map((h) => h.incarnation_id)).toEqual(["db~2", "db~1"]);
    // a legacy stored scene (no incarnation map) adopts its current assets as incarnation 1 instead of re-identifying them
    const legacy = structuredClone(s1) as typeof s1; delete legacy.incarnations;
    const s5 = compileScene({ ...g3, graph_revision: "r5" } as Graph, defaultProposal({ ...g3, graph_revision: "r5" } as Graph), { previous: legacy });
    expect(s5.incarnations!.db!.id).toBe("db~1");
    expect(s5.historical_rooms ?? []).toEqual([]);
    // geometry digest is unaffected by incarnation metadata
    const { incarnations: _i, ...noInc } = s1;
    expect(compileScene(g1, defaultProposal(g1)).digest).toBe(noInc.digest);

    // the API resolves each incarnation to its own location, and history is never a live structure
    const ctx = await setup();
    const graph = ctx.store.getGraph("demo-castle")!;
    const without = { ...graph, graph_revision: graph.graph_revision + "-minus", assets: graph.assets.filter((a) => a.id !== "blob"), relationships: graph.relationships.filter((r) => r.source_id !== "blob" && r.target_id !== "blob") };
    expect((await ctx.app.inject({ method: "POST", url: `${P}/graph`, headers: ctx.h(ctx.admin), payload: without })).statusCode).toBe(200);
    const blobRoom = ctx.store.getScene("demo-castle")!.historical_rooms!.find((r) => r.asset_id === "blob")!;
    const back = { ...graph, graph_revision: graph.graph_revision + "-again" };
    expect((await ctx.app.inject({ method: "POST", url: `${P}/graph`, headers: ctx.h(ctx.admin), payload: back })).statusCode).toBe(200);
    const cur = (await ctx.app.inject({ url: `${P}/scene/locate/blob`, headers: ctx.h(ctx.viewer) })).json();
    expect(cur).toMatchObject({ state: "current", incarnation: { id: "blob~2" } });
    expect(cur.incarnations.map((i: { incarnation_id: string; state: string }) => [i.incarnation_id, i.state])).toEqual([["blob~2", "current"], ["blob~1", "historical"]]);
    const old = (await ctx.app.inject({ url: `${P}/scene/locate/blob?incarnation=blob~1`, headers: ctx.h(ctx.viewer) })).json();
    expect(old).toMatchObject({ state: "historical", incarnation_id: "blob~1", room: { position: blobRoom.position } });
    expect(old.note).toMatch(/not a live structure/);
    expect((await ctx.app.inject({ url: `${P}/scene/locate/blob?incarnation=blob~9`, headers: ctx.h(ctx.viewer) })).statusCode).toBe(404);
  });

  it("A3: every aggregated district keeps its complete membership and every asset is searchable (200 assets)", async () => {
    const g = scaleGraph(200);
    const scene = compileScene(g, defaultProposal(g));
    const h = buildHierarchy(g, scene);
    const districts = hierarchyNodes(h).filter((n) => n.kind === "district");
    const members = districts.flatMap((d) => d.asset_ids);
    expect(members.length).toBe(200);
    expect(new Set(members).size).toBe(200); // each asset in exactly one district
    for (const d of districts) {
      expect(d.children.map((c) => c.asset_ids[0])).toEqual(d.asset_ids); // the membership list is the structures, complete
      expect(districtGroupKey(d.id)).toBe(JSON.stringify([d.id.split("/district:")[1], d.id.split("/district:")[0]!.slice(4)]));
    }
    for (const a of g.assets) {
      expect(searchWorld(h, a.id).results.map((r) => r.asset_id)).toContain(a.id);
      expect(searchWorld(h, a.aliases![0]!).results.map((r) => r.asset_id)).toContain(a.id);
      const node = structureNodeFor(h, a.id)!;
      expect(hierarchyTrail(h, node.id)!.map((n) => n.kind)).toEqual(["realm", "environment", "district", "structure"]);
      expect(focusMembers(h, node.id)!.assetIds).toEqual(new Set([a.id]));
    }
    const all = searchWorld(h, "synthetic");
    expect(all.total).toBe(200);
    expect(searchWorld(h, "synthetic", 10)).toMatchObject({ total: 200 });
    expect(searchWorld(h, "synthetic", 10).results.length).toBe(10);
    // groups and search never read findings or activity
    expect(JSON.stringify([h.realm, h.index])).not.toMatch(/finding|incident|severity/);
    // archived incarnations are searchable and labelled after current structures
    const g2 = { ...g, graph_revision: "scale-200-b", assets: g.assets.filter((a) => a.id !== "a-007") } as Graph;
    const h2 = buildHierarchy(g2, compileScene(g2, defaultProposal(g2), { previous: scene }));
    expect(searchWorld(h2, "a-007").results).toEqual([expect.objectContaining({ asset_id: "a-007", state: "archived", tombstoned: true, incarnation_id: "a-007~1", retired_in_revision: "scale-200-b" })]);

    // the API search is the same function over the stored scene, with an honest total
    const ctx = await setup();
    const r = (await ctx.app.inject({ url: `${P}/scene/search?q=demo&limit=2`, headers: ctx.h(ctx.viewer) })).json();
    const h3 = buildHierarchy(ctx.store.getGraph("demo-castle")!, ctx.store.getScene("demo-castle")!);
    expect(r.total).toBe(searchWorld(h3, "demo").total);
    expect(r.results.length).toBe(Math.min(2, r.total));
    expect(r.truncated).toBe(r.total > 2);
    expect(r.results[0]).not.toHaveProperty("search");
  });

  it("A4: case and evidence scope survive WebGL loss, resize, back navigation, view switching and selection changes", () => {
    const base = parseNavigation("#v=2&workspace=kingdom&view=castle&sel=asset:db&case=case-7&wf=env:demo/district:data&t=2026-10-20T14:00:00.000Z&basis=known");
    expect(base).toMatchObject({ caseId: "case-7", focus: "env:demo/district:data", selection: { kind: "asset", id: "db" }, basis: "known" });
    expect(parseNavigation(serializeNavigation({ ...base, view: "graph" }))).toEqual({ ...base, view: "graph" });
    // malformed focus/case values are dropped, not guessed
    expect(parseNavigation("#case=../../x&wf=javascript:alert(1)")).toMatchObject({ caseId: null, focus: null });
    const ui = { ...base, hover: null, playing: false, speed: 30, roofs: true, layers: { runtime: true, identity: false, data: true, deployment: false, tools: true }, showHypothetical: false, focusMode: "none", reducedMotion: false, reduceAutomaticAnnouncements: false,
      query: "", tab: "findings", webglFailed: null, announce: "", sidebar: true, inspector: true, focusRevision: 0, focusHandledRevision: 0, quality: "medium", shortcuts: false, resolvedEvent: null, eventAssetFilter: null, inspectorSection: "summary", updateRevision: 0,
      historyMode: "replace", navigationRevision: 0, showArchived: false, caseScope: { id: "case-7", title: "Data read", assetIds: ["db"] } } as UiState;
    // WebGL context loss: falls back to the graph with the same case, focus, selection and playhead
    const lost = reducer(ui, { type: "webglFailed", reason: "The graphics context was lost." });
    expect(lost).toMatchObject({ view: "graph", caseId: "case-7", focus: base.focus, selection: base.selection, playhead: base.playhead, basis: "known", caseScope: ui.caseScope });
    expect(reducer(lost, { type: "retryWebgl" })).toMatchObject({ view: "castle", caseId: "case-7", selection: base.selection });
    // selection change + world focus change are history entries; Back restores the earlier state, case intact
    const sel = reducer(ui, { type: "select", selection: { kind: "asset", id: "api" } });
    const foc = reducer(sel, { type: "worldFocus", focus: "env:demo/district:application" });
    expect(foc.historyMode).toBe("push");
    expect(foc.caseId).toBe("case-7");
    const restored = reducer(foc, { type: "restoreNavigation", state: parseNavigation("#" + serializeNavigation(ui)) });
    expect(restored).toMatchObject({ selection: { kind: "asset", id: "db" }, focus: "env:demo/district:data", caseId: "case-7", caseScope: ui.caseScope, historyMode: "none" });
    // Back to a state without the case clears the case display details too
    expect(reducer(foc, { type: "restoreNavigation", state: parseNavigation("#v=2&workspace=kingdom&view=castle") })).toMatchObject({ caseId: null, caseScope: null });
    // opening a different case is a navigation entry; refreshing the same case's details is not
    expect(reducer(ui, { type: "caseScope", scope: { id: "case-8", title: "Other", assetIds: [] } })).toMatchObject({ caseId: "case-8", historyMode: "push" });
    expect(reducer(ui, { type: "caseScope", scope: { id: "case-7", title: "Data read (renamed)", assetIds: ["db"] } }).navigationRevision).toBe(ui.navigationRevision);
  });

  it("semantic levels and view labels are explicit", () => {
    expect([3, 10, 20, 40, 60].map((z) => semanticLevelForScale(z))).toEqual(["realm", "environment", "district", "structure", "structure"]);
    expect(semanticLevelForScale(60, true)).toBe("interior");
    expect(worldViewLabel({ isLatest: true, at: "x", basis: "occurred", graphRevision: "r9", layoutVersion: 3 })).toEqual({ mode: "current", text: "Current · graph r9 · layout v3" });
    expect(worldViewLabel({ isLatest: false, at: "9:00", basis: "known", graphRevision: "r9" }).text).toMatch(/^Historical · as known at 9:00 · coverage remains current$/);
    expect(worldViewLabel({ isLatest: true, at: "x", basis: "occurred", graphRevision: "r9", branch: { label: "model-only" } }).mode).toBe("branch");
  });
});
