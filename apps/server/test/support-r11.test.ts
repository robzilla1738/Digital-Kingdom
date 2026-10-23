import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONNECTORS } from "../src/adapters/connectors.ts";
import { setup } from "./helpers.ts";

/** R11.4 support matrix, model-free core and one golden source -> case -> verification path. */
const ROOT = resolve(import.meta.dirname, "../../..");
const M = JSON.parse(readFileSync(join(ROOT, "support-matrix/SUPPORT_MATRIX.json"), "utf8"));
const LEVELS = ["declared", "discovered", "instrumented", "analyzed", "lab_verified", "live_verified"];

describe("R11.4 support matrix", () => {
  it("no integration is shown without a declared support level, and every cited test exists", () => {
    const ids = new Set(M.integrations.map((i: { id: string }) => i.id));
    for (const c of CONNECTORS) expect(ids, c.id).toContain(c.id);
    const ui = readFileSync(join(ROOT, "apps/web/src/workspaces/integrations/IntegrationsWorkspace.tsx"), "utf8");
    for (const [, route] of ui.matchAll(/route: "([^"]+)"/g)) expect(ids, route).toContain(M.ui_routes[route!]);
    for (const i of M.integrations) {
      expect(LEVELS, i.id).toContain(i.level);
      expect(i.level, `${i.id}: nothing in this release is lab- or live-verified`).not.toMatch(/verified$/);
      for (const t of i.tests) expect(existsSync(join(ROOT, t)), `${i.id} cites ${t}`).toBe(true);
      for (const k of ["permissions", "limits", "troubleshooting", "uninstall"]) expect(typeof i[k], `${i.id}.${k}`).toBe("string");
    }
    expect(M.tiers.map((t: { id: string }) => t.id)).toEqual(["local-reference", "read-only-pilot", "team-investigation", "lab-response"]);
    expect(M.model_service_required).toBe(false);
  });

  it("the open-source core runs a full source -> finding -> case -> plan -> verification -> closure path with no model", async () => {
    const ctx = await setup({ planner: null });
    const post = (url: string, payload: unknown, t = ctx.analyst) => ctx.app.inject({ method: "POST", url: `/api/projects/demo-castle${url}`, headers: ctx.h(t), payload: payload as object });
    const ok = async (p: ReturnType<typeof post>) => { const r = await p; expect(r.statusCode, r.body).toBe(200); return r.json(); };
    const graph = ctx.store.getGraph("demo-castle")!;
    const f = ctx.store.listFindings("demo-castle").find((x) => x.rule_id === "auth.repeated_failure")!;
    expect(f.event_ids.length).toBeGreaterThan(0); // source events produced a finding
    let c = await ok(post("/cases", { title: "golden path", scope: { question: "Was the spray contained?", asset_ids: f.affected_asset_ids }, closure_criteria: "containment verified or gap accepted" }));
    c = await ok(post(`/cases/${c.id}/items`, { kind: "finding", ref: f.id, expected_version: c.version }));
    const assist = await ok(post(`/cases/${c.id}/assist`, {}, ctx.viewer));
    expect(assist.mode).toBe("deterministic");
    const action = ctx.store.containmentCatalog("demo-castle").find((a) => f.affected_asset_ids.some((id) => a.applies_to_kinds.includes(graph.assets.find((x) => x.id === id)!.kind)) && (a.id === "auth.force_reauth" || a.id === "edge.tighten_rate_limit"))!;
    const target = f.affected_asset_ids.find((id) => action.applies_to_kinds.includes(graph.assets.find((x) => x.id === id)!.kind))!;
    const req = await ok(post("/containment", { finding_id: f.id, action_id: action.id, rationale: "golden path containment" }));
    await ok(post(`/containment/${req.id}/plan`, { targets: [target], parameters: action.id === "auth.force_reauth" ? { account_ref: "acct-1" } : { route: "/login", requests_per_minute: 30 } }));
    expect((await ok(post(`/containment/${req.id}/decision`, { decision: "approved" }, ctx.admin))).status).toBe("approved");
    const v = await ok(post(`/containment/${req.id}/verify`, { report: { provider_accepted: true, accepted_at: new Date(ctx.store.now().getTime() - 3600_000).toISOString() } }));
    expect(v.tested_scope.target_asset_ids).toEqual([target]);
    c = await ok(post(`/cases/${c.id}/items`, { kind: "note", text: `verification ${v.id}: ${v.containment.state}`, expected_version: c.version }));
    const closed = await ok(post(`/cases/${c.id}/status`, { status: "closed", statement: `Containment ${v.containment.state} for the tested scope; unassessed: ${v.unassessed.length} path(s).`, expected_version: c.version }));
    expect(closed.status).toBe("closed");
  });
});
