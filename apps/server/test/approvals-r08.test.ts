import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** R08.1 subject-bound, policy-required approvals. */
type Ctx = Awaited<ReturnType<typeof setup>>;
const post = (ctx: Ctx, url: string, payload: unknown, t: string) => ctx.app.inject({ method: "POST", url: `/api/projects/demo-castle${url}`, headers: ctx.h(t), payload: payload as object });
async function propose(ctx: Ctx, token: string) {
  const findings = ctx.store.listFindings("demo-castle");
  const graph = ctx.store.getGraph("demo-castle")!;
  for (const f of findings) for (const a of ctx.store.containmentCatalog("demo-castle")) {
    if (!a.applies_to_kinds.some((k) => f.affected_asset_ids.some((id) => graph.assets.find((x) => x.id === id)?.kind === k))) continue;
    const r = await post(ctx, "/containment", { finding_id: f.id, action_id: a.id, rationale: "subject-binding test" }, token);
    if (r.statusCode === 200) return r.json();
  }
  throw new Error("no applicable action");
}
const mint = async (ctx: Ctx, body: Record<string, unknown>) => (await ctx.app.inject({ method: "POST", url: "/api/tokens", headers: ctx.h(ctx.admin), payload: body })).json();

describe("R08.1 approvals bound to real subjects", () => {
  it("two tokens for the same person do not satisfy a two-person requirement", async () => {
    const ctx = await setup();
    expect((await post(ctx, "/approval-policy", { approvals_required: 2 }, ctx.admin)).statusCode).toBe(200);
    const alice1 = await mint(ctx, { name: "alice laptop", role: "admin", subject: "alice@corp", projects: ["demo-castle"] });
    const alice2 = await mint(ctx, { name: "alice phone", role: "admin", subject: "alice@corp", projects: ["demo-castle"] });
    const bob = await mint(ctx, { name: "bob", role: "admin", subject: "bob@corp", projects: ["demo-castle"] });
    const c = await propose(ctx, ctx.analyst);
    expect((await post(ctx, `/containment/${c.id}/decision`, { decision: "approved" }, alice1.token)).json()).toMatchObject({ status: "pending", approvals: [{ subject: "person:alice@corp" }] });
    const dup = await post(ctx, `/containment/${c.id}/decision`, { decision: "approved" }, alice2.token);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toMatch(/different person/);
    const done = (await post(ctx, `/containment/${c.id}/decision`, { decision: "approved" }, bob.token)).json();
    expect(done.status).toBe("approved");
    const audit = ctx.store.listAudit("demo-castle", 20).find((a) => a.action === "containment.approved")!;
    expect(String(audit.detail)).toMatch(/person:alice@corp.*person:bob@corp/); // audit names actual subjects
    expect(String(audit.actor)).toMatch(/\[person:bob@corp\]/);
  });

  it("the requester's subject can never approve, even with another token", async () => {
    const ctx = await setup();
    const carol1 = await mint(ctx, { name: "carol a", role: "admin", subject: "carol@corp", projects: ["demo-castle"] });
    const carol2 = await mint(ctx, { name: "carol b", role: "admin", subject: "carol@corp", projects: ["demo-castle"] });
    const c = await propose(ctx, carol1.token);
    expect((await post(ctx, `/containment/${c.id}/decision`, { decision: "approved" }, carol2.token)).statusCode).toBe(403);
  });

  it("an agent cannot approve, change approval policy or disable its verifier", async () => {
    const ctx = await setup();
    const agent = await mint(ctx, { name: "agent", role: "analyst", principal_type: "service", projects: ["demo-castle"] });
    const c = await propose(ctx, agent.token);
    expect((await post(ctx, `/containment/${c.id}/decision`, { decision: "approved" }, agent.token)).statusCode).toBe(403);
    expect((await post(ctx, "/approval-policy", { approvals_required: 1 }, agent.token)).statusCode).toBe(403);
    const src = ctx.store.listSources("demo-castle")[0]!;
    expect((await post(ctx, `/sources/${src.id}/state`, { disabled: true, expected_revision: src.config_revision, reason: "go dark" }, agent.token)).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "POST", url: "/api/tokens", headers: ctx.h(agent.token), payload: { name: "x", role: "admin" } })).statusCode).toBe(403);
    const scoped = await mint(ctx, { name: "project admin", role: "admin", projects: ["demo-castle"] });
    expect((await post(ctx, "/approval-policy", { approvals_required: 1 }, scoped.token)).statusCode).toBe(403); // installation admin only
  });

  it("revocation or a policy change invalidates stale approvals", async () => {
    const ctx = await setup();
    await post(ctx, "/approval-policy", { approvals_required: 2 }, ctx.admin);
    const dan = await mint(ctx, { name: "dan", role: "admin", subject: "dan@corp", projects: ["demo-castle"] });
    const eve = await mint(ctx, { name: "eve", role: "admin", subject: "eve@corp", projects: ["demo-castle"] });
    const c = await propose(ctx, ctx.analyst);
    await post(ctx, `/containment/${c.id}/decision`, { decision: "approved" }, dan.token);
    await ctx.app.inject({ method: "POST", url: `/api/tokens/${dan.id}/revoke`, headers: ctx.h(ctx.admin) });
    expect((await post(ctx, `/containment/${c.id}/decision`, { decision: "approved" }, eve.token)).json()).toMatchObject({ status: "pending", approvals: [{ subject: "person:eve@corp" }] });
    // policy change: eve's approval was made under approvals_required=2; changing policy makes the request stale
    await post(ctx, "/approval-policy", { approvals_required: 3 }, ctx.admin);
    const listed = ctx.store.listContainment("demo-castle").find((x) => x.id === c.id) as unknown as { approvable: boolean; renewal_reason: string; approvals: unknown[] };
    expect(listed.approvable).toBe(false);
    expect(listed.renewal_reason).toMatch(/policy changed/);
    expect(listed.approvals).toEqual([]);
  });
});
