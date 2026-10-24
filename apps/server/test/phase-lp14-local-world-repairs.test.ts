import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts"; // first: db.ts and change-review.ts import each other
import { validateRepairPlan } from "@dk/contracts";
import { compileWorld, instantiateBlueprint } from "@dk/local-world";

/**
 * LP14 for local worlds: the generator proposes reviewable typed candidates for an LP04 blueprint defect (the tenant API's
 * deliberately weak policy variant in saas-storefront), from the run's declared configuration snapshot
 * (dk.local.config_snapshot.v1), bound to the exact run revision the lease precondition checks.
 */
const RUN = "run-lp14local01";
const world = compileWorld(instantiateBlueprint("saas-storefront", { seed: "lp14-local" }));
const provenance = { schema: "dk.local.run_provenance.v1", run_id: RUN, world_plan_id: world.plan.plan_id, catalog_version: world.catalog.version, execution_mode: "local_runtime", data_origin: "synthetic_local", scope: "local_run_only", external_validation: "not_performed", started_at: "2026-10-24T08:00:00.000Z", label: "Local laboratory — synthetic people and data" };
const config = (apiVariant: string, apiRev = `api:policy-${apiVariant}-r2`) => ({ schema: "dk.local.config_snapshot.v1", run_id: RUN, resources: [
  { resource_id: "api", template: "api", policy_variant: apiVariant, tenant_mode: "isolated", revision: apiRev },
  { resource_id: "ingress", template: "gateway", policy_variant: "baseline", revision: "ingress:policy-baseline-r1" },
] });
const CROSS = { id: "cross-tenant-read", kind: "tenant_access", from: "ingress", to: "tenant-db", tenant: "tenant-a", target_tenant: "tenant-b" };
const OWN = { id: "own-tenant-read", kind: "tenant_access", from: "ingress", to: "tenant-db", tenant: "tenant-a", target_tenant: "tenant-a" };

async function localProject(opts: { local?: boolean } = {}) {
  const ctx = await setup();
  const { app, admin, analyst, h } = ctx;
  const P = "lw-shop";
  expect((await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: P, name: "Local world", dataset_kind: "live", ...(opts.local === false ? {} : { local_run: provenance }) } })).statusCode).toBe(200);
  expect((await app.inject({ method: "POST", url: `/api/projects/${P}/graph`, headers: h(admin), payload: { ...world.graph, project_id: P } })).statusCode).toBe(200);
  const kase = (await app.inject({ method: "POST", url: `/api/projects/${P}/cases`, headers: h(analyst), payload: { title: "Cross-tenant reads", scope: { question: "Can tenant-a read tenant-b records?", asset_ids: ["api"] }, closure_criteria: "Repair verified" } })).json();
  const api = (method: "GET" | "POST", url: string, payload?: unknown, token = admin) => app.inject({ method, url: `/api/projects/${P}${url}`, headers: h(token), ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  const state = async () => (await api("GET", "/analysis/state", undefined, ctx.viewer)).json();
  const generate = async () => (await api("POST", `/cases/${kase.id}/repairs`, { base_state_hash: (await state()).state_hash, objective: { prohibited: [CROSS], permitted: [OWN] } }, analyst)).json();
  return { ctx, P, kase, api, state, generate };
}

describe("LP14 local-world candidates (gateway/API policy defects)", () => {
  it("returns reviewable set_gateway_policy candidates for the weakened tenant API, bound to the run revision", async () => {
    const t = await localProject();
    const stored = await t.api("POST", "/local-configuration", config("deliberately_weak"));
    expect(stored.statusCode, stored.body).toBe(200);
    const st = await t.state();
    expect(st.state.elements.filter((e: { kind: string }) => e.kind === "policy").map((e: { id: string; attrs: { variant: string } }) => `${e.id}=${e.attrs.variant}`)).toEqual(["api#policy=deliberately_weak", "ingress#policy=baseline"]);
    const r = await t.generate();
    expect(r.status, JSON.stringify(r.reasons)).toBe("candidates");
    expect(r.candidates.map((c: { template: { id: string }; target: string; valid: boolean }) => [c.template.id, c.target, c.valid])).toEqual([
      ["restore-reviewed-policy", "api@policy:baseline", true], ["restore-reviewed-policy", "api@policy:candidate", true]]);
    const c1 = r.candidates[0];
    expect(c1.rank).toBe(1);
    expect(c1.plan.run_id).toBe(RUN);
    expect(c1.plan.authority).toBe("plan_only");
    expect(c1.plan.actions).toEqual([{ id: "action-1", target_resource_id: "api", type: "set_gateway_policy", parameters: { policy_ref: "policy:baseline" }, expected_target_revision: "api:policy-deliberately_weak-r2" }]);
    expect(c1.plan.verification_test_ids).toEqual(["cross-tenant-read"]);
    expect(c1.plan.positive_control_ids).toEqual(["own-tenant-read"]);
    expect(validateRepairPlan(c1.plan, { now: Date.now() }).ok).toBe(true);
    expect(c1.expected_impact.map((x: { probe: string; before: { holds: string }; after: { holds: string } }) => [x.probe, x.before.holds, x.after.holds])).toEqual([["cross-tenant-read", "holds", "does_not_hold"], ["own-tenant-read", "holds", "holds"]]);
    expect(c1.breaks_permitted).toBe(false);
    expect(c1.patch.changes).toEqual([{ op: "modify", kind: "policy", authority: `${t.P}/local`, id: "api#policy", attrs: { variant: "baseline" } }]);
    expect(c1.compensation.changes).toEqual([{ op: "modify", kind: "policy", authority: `${t.P}/local`, id: "api#policy", attrs: { variant: "deliberately_weak" } }]);
    expect(c1.patch.files.map((f: { path: string }) => f.path)).toEqual(["local-policies/api.json"]);
    expect(c1.verification.executed_local).toMatch(/^pending/);
    // the LP13 comparison of the candidate's exact change list changes exactly the candidate's element and lands on the api room
    const cmp = await t.api("POST", "/analysis/comparisons", { base_state_hash: st.state_hash, changes: c1.patch.changes, label: "candidate c1" }, t.ctx.analyst);
    expect(cmp.statusCode, cmp.body).toBe(200);
    expect(cmp.json().comparison.modified.map((m: { key: string; before: { variant: string }; after: { variant: string } }) => [m.key, m.before.variant, m.after.variant])).toEqual([[`policy|${t.P}/local|api#policy`, "deliberately_weak", "baseline"]]);
    const w = (await t.api("GET", `/analysis/comparisons/${cmp.json().id}/world`, undefined, t.ctx.viewer)).json();
    expect(w.changes.map((x: { key: string; asset_ids: string[] }) => [x.key, x.asset_ids])).toEqual([[`policy|${t.P}/local|api#policy`, ["api"]]]);
  });

  it("no repair needed once the policy is reviewed again; unknown without a configuration snapshot", async () => {
    const t = await localProject();
    const none = await t.generate();
    expect(none.status).toBe("no_supported_repair");
    expect(none.reasons.join(" ")).toMatch(/no declared local configuration/);
    expect((await t.api("POST", "/local-configuration", config("baseline", "api:policy-baseline-r3"))).statusCode).toBe(200);
    expect((await t.generate()).status).toBe("no_repair_needed");
  });

  it("refuses snapshots for non-local projects, other runs, undeclared resources, wrong templates, non-admins", async () => {
    const nl = await localProject({ local: false });
    expect((await nl.api("POST", "/local-configuration", config("deliberately_weak"))).statusCode).toBe(409);
    const t = await localProject();
    expect((await t.api("POST", "/local-configuration", { ...config("deliberately_weak"), run_id: "run-other" })).statusCode).toBe(409);
    expect((await t.api("POST", "/local-configuration", { ...config("deliberately_weak"), resources: [{ resource_id: "nope", template: "api", policy_variant: "baseline", revision: "x" }] })).statusCode).toBe(422);
    expect((await t.api("POST", "/local-configuration", { ...config("deliberately_weak"), resources: [{ resource_id: "tenant-db", template: "api", policy_variant: "baseline", revision: "x" }] })).statusCode).toBe(422);
    expect((await t.api("POST", "/local-configuration", { ...config("deliberately_weak"), resources: [{ resource_id: "api", template: "api", policy_variant: "wide_open", revision: "x" }] })).statusCode).toBe(422);
    expect((await t.api("POST", "/local-configuration", config("deliberately_weak"), t.ctx.analyst)).statusCode).toBe(403);
    expect((await t.api("GET", "/local-configuration", undefined, t.ctx.viewer)).statusCode).toBe(403);
    // non-local projects keep their exact analysis state (no policy elements, no new base field)
    const st = await nl.state();
    expect(st.state.elements.some((e: { kind: string }) => e.kind === "policy")).toBe(false);
    expect("local_config" in st.state.base).toBe(false);
  });
});

describe("LP14 local-world candidates: agent-workspace tool gateway defect", () => {
  it("proposes restoring the weakened agent tool gateway policy for a prohibited destination path, ranked above denying the whole tool link", async () => {
    const aw = compileWorld(instantiateBlueprint("agent-workspace", { seed: "lp14-local-aw" }));
    const ctx = await setup();
    const { app, admin, analyst, h } = ctx;
    const P = "lw-agents";
    expect((await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: P, name: "Local agents", dataset_kind: "live", local_run: { ...provenance, world_plan_id: aw.plan.plan_id } } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/projects/${P}/graph`, headers: h(admin), payload: { ...aw.graph, project_id: P } })).statusCode).toBe(200);
    const kase = (await app.inject({ method: "POST", url: `/api/projects/${P}/cases`, headers: h(analyst), payload: { title: "Agent sends", scope: { question: "Can the agent reach the blocked receiver?", asset_ids: ["tool-gateway"] }, closure_criteria: "Repair verified" } })).json();
    const objective = { prohibited: [{ id: "send-blocked", kind: "path", from: "workspace", to: "blocked-receiver" }], permitted: [{ id: "send-allowed", kind: "path", from: "workspace", to: "allowed-receiver" }] };
    const gen = async () => { const st = (await app.inject({ url: `/api/projects/${P}/analysis/state`, headers: h(analyst) })).json(); return (await app.inject({ method: "POST", url: `/api/projects/${P}/cases/${kase.id}/repairs`, headers: h(analyst), payload: { base_state_hash: st.state_hash, objective } })).json(); };
    // without a configuration snapshot only the existing tool-link template applies (and it breaks the permitted send)
    const before = await gen();
    expect(before.candidates.map((c: { template: { id: string }; valid: boolean; breaks_permitted: boolean }) => [c.template.id, c.valid, c.breaks_permitted])).toEqual([["set-gateway-policy", true, true]]);
    const snap = { schema: "dk.local.config_snapshot.v1", run_id: RUN, resources: [{ resource_id: "tool-gateway", template: "agent_gateway", policy_variant: "deliberately_weak", revision: "tool-gateway:policy-deliberately_weak-r2" }] };
    expect((await app.inject({ method: "POST", url: `/api/projects/${P}/local-configuration`, headers: h(admin), payload: snap })).statusCode).toBe(200);
    const r = await gen();
    expect(r.candidates.map((c: { template: { id: string }; target: string; valid: boolean; breaks_permitted: boolean }) => [c.template.id, c.target, c.valid, c.breaks_permitted])).toEqual([
      ["restore-reviewed-policy", "tool-gateway@policy:baseline", true, false], ["restore-reviewed-policy", "tool-gateway@policy:candidate", true, false], ["set-gateway-policy", "workspace->tool-gateway", true, true]]);
    expect(r.candidates[0].plan.actions[0]).toMatchObject({ target_resource_id: "tool-gateway", type: "set_gateway_policy", parameters: { policy_ref: "policy:baseline" }, expected_target_revision: "tool-gateway:policy-deliberately_weak-r2" });
    // once the reviewed policy is back, the prohibited destination path is denied by the model
    expect((await app.inject({ method: "POST", url: `/api/projects/${P}/local-configuration`, headers: h(admin), payload: { ...snap, resources: [{ ...snap.resources[0], policy_variant: "baseline", revision: "tool-gateway:policy-baseline-r3" }] } })).statusCode).toBe(200);
    expect((await gen()).status).toBe("no_repair_needed");
  });
});
