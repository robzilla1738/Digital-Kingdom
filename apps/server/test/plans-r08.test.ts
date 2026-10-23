import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** R08.2 exact response plans and revalidation. */
type Ctx = Awaited<ReturnType<typeof setup>>;
const PARAMS: Record<string, Record<string, unknown>> = {
  "edge.tighten_rate_limit": { route: "/login", requests_per_minute: 30 }, "edge.block_source_range": { cidr: "203.0.113.0/24", duration_minutes: 60 },
  "auth.force_reauth": { account_ref: "acct-1" }, "auth.revert_privilege_change": { account_ref: "acct-1", grant: "admin" },
  "secrets.rotate_credentials": { credential_ref: "deploy-key" }, "agent.suspend_tool": { tool: "email.send" }, "deploy.pause_rollout": { reason: "investigating" }, "data.restrict_access": { principal_ref: "etl" },
};
const post = (ctx: Ctx, url: string, payload: unknown, t = ctx.analyst) => ctx.app.inject({ method: "POST", url: `/api/projects/demo-castle${url}`, headers: ctx.h(t), payload: payload as object });
async function proposal(ctx: Ctx, want?: (id: string) => boolean) {
  const graph = ctx.store.getGraph("demo-castle")!;
  for (const f of ctx.store.listFindings("demo-castle")) for (const a of ctx.store.containmentCatalog("demo-castle")) {
    if (want && !want(a.id)) continue;
    const target = f.affected_asset_ids.find((id) => a.applies_to_kinds.includes(graph.assets.find((x) => x.id === id)!.kind));
    if (!target) continue;
    const r = await post(ctx, "/containment", { finding_id: f.id, action_id: a.id, rationale: "plan test rationale" });
    if (r.statusCode === 200) return { c: r.json(), action: a, target };
  }
  return null;
}

describe("R08.2 response plans", () => {
  it("changing target or parameters produces a new plan digest that cannot reuse approval", async () => {
    const ctx = await setup();
    await post(ctx, "/approval-policy", { approvals_required: 2 }, ctx.admin);
    const p = (await proposal(ctx))!;
    const plan1 = (await post(ctx, `/containment/${p.c.id}/plan`, { targets: [p.target], parameters: PARAMS[p.action.id] })).json();
    expect(plan1.plan).toMatchObject({ schema: "dk.response_plan.v1", targets: [{ asset_id: p.target }] });
    const a1 = (await post(ctx, `/containment/${p.c.id}/decision`, { decision: "approved" }, ctx.admin)).json();
    expect(a1.approvals).toHaveLength(1);
    const changed = { ...PARAMS[p.action.id] }; const k = Object.keys(changed)[0]!; changed[k] = typeof changed[k] === "number" ? 999 : "something-else";
    const plan2 = (await post(ctx, `/containment/${p.c.id}/plan`, { targets: [p.target], parameters: changed })).json();
    expect(plan2.plan.digest).not.toBe(plan1.plan.digest);
    expect(plan2.approvals).toEqual([]); // the earlier approval bound the old plan
  });

  it("an artifact digest change or target drift fails the precheck", async () => {
    const ctx = await setup();
    const p = (await proposal(ctx))!;
    await post(ctx, `/containment/${p.c.id}/plan`, { targets: [p.target], parameters: PARAMS[p.action.id], artifact_digest: `sha256:${"a".repeat(64)}` });
    expect((await ctx.app.inject({ url: `/api/projects/demo-castle/containment/${p.c.id}/precheck`, headers: ctx.h(ctx.viewer) })).json().ok).toBe(true);
    const g = ctx.store.getGraph("demo-castle")!;
    const drifted = { ...g, graph_revision: g.graph_revision + "-drift", assets: g.assets.map((a) => a.id === p.target ? { ...a, provider_ref: { scope: "aws:111122223333", id: "arn:aws:new-resource" } } : a) };
    await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/graph", headers: ctx.h(ctx.admin), payload: drifted });
    const pc = (await ctx.app.inject({ url: `/api/projects/demo-castle/containment/${p.c.id}/precheck`, headers: ctx.h(ctx.viewer) })).json();
    expect(pc.ok).toBe(false);
    expect(pc.problems.join(" ")).toMatch(/target state changed|different provider resource/);
    expect((await post(ctx, `/containment/${p.c.id}/decision`, { decision: "approved" }, ctx.admin)).statusCode).toBe(409);
  });

  it("a key revocation is not labelled reversible and carries compensation", async () => {
    const ctx = await setup();
    const p = await proposal(ctx, (id) => id === "secrets.rotate_credentials");
    if (!p) { const plan = (await import("../src/response-plan.ts")).buildPlan({ action: ctx.store.containmentCatalog("demo-castle").find((a) => a.id === "secrets.rotate_credentials")!, graph: ctx.store.getGraph("demo-castle")!, targets: [ctx.store.getGraph("demo-castle")!.assets.find((a) => ["agent", "tool_server", "service", "worker", "pipeline"].includes(a.kind))!.id], parameters: PARAMS["secrets.rotate_credentials"], policy_revision: "x", effectObservers: () => [] }); expect(plan.reversibility).toMatchObject({ reversible: false, rollback: [] }); expect(plan.reversibility.compensation[0]).toMatch(/cannot be restored/); return; }
    const plan = (await post(ctx, `/containment/${p.c.id}/plan`, { targets: [p.target], parameters: PARAMS["secrets.rotate_credentials"] })).json().plan;
    expect(plan.reversibility).toMatchObject({ reversible: false, rollback: [] });
    expect(plan.reversibility.compensation[0]).toMatch(/cannot be restored/);
  });

  it("missing effect observer blocks verified success; unsupported parameters never become commands", async () => {
    const ctx = await setup();
    const p = (await proposal(ctx))!;
    const plan = (await post(ctx, `/containment/${p.c.id}/plan`, { targets: [p.target], parameters: PARAMS[p.action.id] })).json().plan;
    if (!plan.verification.effect_observer_source_ids.length) expect(plan.verification).toMatchObject({ verified_success_possible: false, reason: expect.stringMatching(/never verified/) });
    expect((await post(ctx, `/containment/${p.c.id}/plan`, { targets: [p.target], parameters: { ...PARAMS[p.action.id], command: "rm -rf /" } })).json().error).toMatch(/unsupported parameters: command/);
    const k = Object.keys(PARAMS[p.action.id]!).find((x) => typeof PARAMS[p.action.id]![x] === "string");
    if (k) expect((await post(ctx, `/containment/${p.c.id}/plan`, { targets: [p.target], parameters: { ...PARAMS[p.action.id], [k]: "x; curl evil" } })).statusCode).toBe(422);
    expect((await ctx.app.inject({ url: `/api/projects/demo-castle/containment/${p.c.id}/precheck`, headers: ctx.h(ctx.viewer) })).json().executor).toMatch(/does not execute/);
  });
});
