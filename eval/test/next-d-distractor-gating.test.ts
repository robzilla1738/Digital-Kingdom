/**
 * li-next D: benchmark distractor policy variants (overbroad / residual) are reachable ONLY on a supervisor started with
 * `benchmarkDistractorVariants: true`, only through an exact lease + typed operation, and behave as declared.
 */
import { describe, expect, it } from "vitest";
import { compileWorld, instantiateBlueprint, RepairController, Supervisor } from "../../packages/local-world/src/index.ts";
import { BUILTIN_SERVICES, syntheticPassword } from "../../examples/reference-app/src/world/services.ts";

async function world(distractors: boolean) {
  const sup = new Supervisor({ services: BUILTIN_SERVICES, labActions: "leased", ...(distractors ? { benchmarkDistractorVariants: true } : {}) });
  const op = sup.operatorCredential();
  const { run, operatorToken } = await sup.start(compileWorld(instantiateBlueprint("saas-storefront", { seed: "next-d-gating" })));
  const login = async (account: string) => ((await run.request(operatorToken, { resource: "ingress", method: "POST", path: "/login", headers: {}, body: { account, password: syntheticPassword(run.world, account) } })).body as { session: string }).session;
  const read = async (session: string, tenant: string) => (await run.request(operatorToken, { resource: "ingress", method: "GET", path: `/tenants/${tenant}/records`, headers: { "x-world-session": session } })).status;
  const plan = (ref: string) => ({ schema: "dk.local.repair_plan.v1" as const, plan_id: `rp-${ref.replace(/[^a-z]/g, "")}`, run_id: run.run_id, case_id: "next-d", baseline_digest: "a".repeat(64), candidate_digest: "b".repeat(64),
    actions: [{ id: "action-1", target_resource_id: "api", type: "set_gateway_policy" as const, parameters: { policy_ref: ref }, expected_target_revision: run.revisionOf("api") }],
    verification_test_ids: ["x"], positive_control_ids: ["y"], residual_unknowns: [], authority: "plan_only" as const, expires_at: new Date(Date.now() + 600_000).toISOString() });
  const lease = (ref: string) => { const ctl = sup.issueControllerToken(op, run.run_id); const pl = plan(ref); return { l: sup.issueLease(op, { run_id: run.run_id, plan: pl, controller_token: ctl }), ctl, pl }; };
  return { sup, run, operatorToken, login, read, lease, stop: async () => { await run.stop(operatorToken); run.cleanup(); } };
}

describe("li-next D benchmark distractor variants", () => {
  it("a default leased supervisor refuses the distractor references (they are not reviewed repairs)", async () => {
    const w = await world(false);
    try {
      expect(() => w.lease("policy:bench_overbroad")).toThrow(/not a run-owned reference/);
      expect(() => w.lease("policy:bench_residual")).toThrow(/not a run-owned reference/);
      expect(() => w.lease("policy:bench_misbound")).toThrow(/not a run-owned reference/);
      expect(() => w.lease("policy:deliberately_weak")).toThrow(/not a run-owned reference/);
    } finally { await w.stop(); }
  });
  it("on a benchmark supervisor: misbound (the MISLEADING-prediction distractor) guards the wrong route, so cross-tenant reads stay open", async () => {
    const w = await world(true);
    try {
      const a = await w.login("acct:tenant-a:user"), b = await w.login("acct:tenant-b:user");
      const write = async (session: string, tenant: string) => (await w.run.request(w.operatorToken, { resource: "ingress", method: "POST", path: `/tenants/${tenant}/jobs`, headers: { "x-world-session": session }, body: {} })).status; // the ingress forwards POST /jobs (not POST /records)
      const m = w.lease("policy:bench_misbound");
      expect((await new RepairController(w.run, m.ctl).execute(m.l.token, m.pl as never)).state).toBe("completed");
      expect(await w.read(a, "tenant-b")).toBe(200); // the prohibited read is still possible
      expect(await w.read(b, "tenant-a")).toBe(200);
      expect(await w.read(a, "tenant-a")).toBe(200);
      expect(await write(a, "tenant-b")).toBe(403); // the policy is bound to the non-read (write/job) routes only
    } finally { await w.stop(); }
  });
  it("on a benchmark supervisor: overbroad breaks own-tenant reads; residual leaves tenant-a readable cross-tenant", async () => {
    const w = await world(true);
    try {
      const a = await w.login("acct:tenant-a:user"), b = await w.login("acct:tenant-b:user");
      expect(() => w.lease("policy:deliberately_weak")).toThrow(/not a run-owned reference/);
      const o = w.lease("policy:bench_overbroad");
      expect((await new RepairController(w.run, o.ctl).execute(o.l.token, o.pl as never)).state).toBe("completed");
      expect(await w.read(a, "tenant-a")).toBe(403);
      expect(await w.read(a, "tenant-b")).toBe(403);
      const r = w.lease("policy:bench_residual");
      expect((await new RepairController(w.run, r.ctl).execute(r.l.token, r.pl as never)).state).toBe("completed");
      expect(await w.read(a, "tenant-b")).toBe(403);
      expect(await w.read(b, "tenant-a")).toBe(200); // residual access
      expect(await w.read(a, "tenant-a")).toBe(200);
    } finally { await w.stop(); }
  });
});
