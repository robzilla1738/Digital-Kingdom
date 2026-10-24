import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts"; // first: db.ts and change-review.ts import each other
import { validateRepairPlan } from "@dk/contracts";
import { compileWorld, instantiateBlueprint } from "@dk/local-world";

/**
 * li-next B (server): observer capability state in the local analysis model and the reviewed, plan-only
 * `restart-supervised-observer` candidate.
 *
 * The supervisor side (the launcher, holding the run's operator token) reports `dk.local.observer_state.v1` — each
 * observer's state (running / stopped / misconfigured / absent), what it is declared to observe, what it observes now
 * and since when. Digital Kingdom records every report append-only (history), turns the latest into `observer`
 * elements of the analysis state, and the generator proposes a typed `restart_test_observer` plan for a stopped or
 * misconfigured observer named by an `observer_gap` objective. Nothing here reads scenario truth.
 */
const RUN = "run-nextb0001";
const world = compileWorld(instantiateBlueprint("saas-storefront", { seed: "next-b" }));
const provenance = { schema: "dk.local.run_provenance.v1", run_id: RUN, world_plan_id: world.plan.plan_id, catalog_version: world.catalog.version, execution_mode: "local_runtime", data_origin: "synthetic_local", scope: "local_run_only", external_validation: "not_performed", started_at: "Sat 2026-10-24 3:00 PM CDT (UTC-05:00)", label: "Local laboratory — synthetic people and data" };
const config = (apiVariant: string, apiRev = `api:policy-${apiVariant}-r2`) => ({ schema: "dk.local.config_snapshot.v1", run_id: RUN, resources: [
  { resource_id: "api", template: "api", policy_variant: apiVariant, tenant_mode: "isolated", revision: apiRev },
  { resource_id: "ingress", template: "gateway", policy_variant: "baseline", revision: "ingress:policy-baseline-r1" },
] });
const SINCE = "2026-10-24T20:00:00.000Z";
const observers = (state: string, o: { observes?: string[]; revision?: string | null; reason?: string } = {}) => ({ schema: "dk.local.observer_state.v1", run_id: RUN, observers: [{
  observer_id: "audit", state, declared: ["artifacts", "tenant-db"], observes: o.observes ?? (state === "running" ? ["artifacts", "tenant-db"] : state === "misconfigured" ? ["artifacts"] : []),
  since: SINCE, revision: o.revision === undefined ? `audit:observer-${state === "running" ? "up" : state === "stopped" ? "down" : state}-h2` : o.revision, reason: o.reason ?? `${state} (reported by the supervisor)`,
  history: [{ state: "running", since: "2026-10-24T19:59:00.000Z", until: SINCE, reason: "started with the run" }, { state, since: SINCE, until: null, reason: o.reason ?? state }],
}] });
const CROSS = { id: "cross-tenant-read", kind: "tenant_access", from: "ingress", to: "tenant-db", tenant: "tenant-a", target_tenant: "tenant-b" };
const OWN = { id: "own-tenant-read", kind: "tenant_access", from: "ingress", to: "tenant-db", tenant: "tenant-a", target_tenant: "tenant-a" };
const GAP = { id: "audit-observer-gap", kind: "observer_gap", source_id: "audit" };

async function localProject() {
  const ctx = await setup();
  const { app, admin, analyst, h } = ctx;
  const P = "lw-observer";
  expect((await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: P, name: "Local world", dataset_kind: "live", local_run: provenance } })).statusCode).toBe(200);
  expect((await app.inject({ method: "POST", url: `/api/projects/${P}/graph`, headers: h(admin), payload: { ...world.graph, project_id: P } })).statusCode).toBe(200);
  const kase = (await app.inject({ method: "POST", url: `/api/projects/${P}/cases`, headers: h(analyst), payload: { title: "Audit observer", scope: { question: "Is the tenant store independently observed?", asset_ids: ["tenant-db"] }, closure_criteria: "Observation restored and verified" } })).json();
  const api = (method: "GET" | "POST", url: string, payload?: unknown, token = admin) => app.inject({ method, url: `/api/projects/${P}${url}`, headers: h(token), ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  const state = async () => (await api("GET", "/analysis/state", undefined, ctx.viewer)).json();
  const generate = async (objective: { prohibited: unknown[]; permitted: unknown[] }) => (await api("POST", `/cases/${kase.id}/repairs`, { base_state_hash: (await state()).state_hash, objective }, analyst)).json();
  return { ctx, P, kase, api, state, generate };
}
type Cand = { template: { id: string }; target: string; valid: boolean; breaks_permitted: boolean; rank: number; plan: { actions: unknown[]; authority: string; verification_test_ids: string[] }; verification: Record<string, unknown>; patch: { changes: unknown[] } };
const summary = (r: { candidates: Cand[] }) => r.candidates.map((c) => [c.template.id, c.target, c.valid, c.breaks_permitted]);

describe("next-B: observer capability state in the analysis model", () => {
  it("records supervisor observer reports append-only and exposes the latest as observer elements, with history", async () => {
    const t = await localProject();
    const before = await t.state();
    expect((await t.api("POST", "/local-observers", observers("running"))).statusCode).toBe(200);
    const r = await t.api("POST", "/local-observers", observers("stopped"));
    expect(r.statusCode, r.body).toBe(200);
    const st = await t.state();
    expect(st.state_hash).not.toBe(before.state_hash);
    const el = st.state.elements.filter((e: { kind: string }) => e.kind === "observer");
    expect(el).toHaveLength(1);
    expect(el[0]).toMatchObject({ kind: "observer", id: "audit#observer", attrs: { observer_id: "audit", state: "stopped", declared: ["artifacts", "tenant-db"], observes: [], since: SINCE, revision: "audit:observer-down-h2", asset_ids: ["artifacts", "tenant-db"] } });
    expect(st.state.base.local_observers.id).toMatch(/^lobs_/);
    const hist = (await t.api("GET", "/local-observers/history", undefined, t.ctx.analyst)).json();
    expect(hist.observers.audit.reports.map((x: { state: string }) => x.state)).toEqual(["running", "stopped"]);
    expect(hist.observers.audit.current).toMatchObject({ state: "stopped", since: SINCE });
    expect(hist.observers.audit.supervisor_history.map((x: { state: string }) => x.state)).toEqual(["running", "stopped"]);
  });

  it("refuses reports for other runs, unknown states, undeclared observed resources and non-admins; non-local projects untouched", async () => {
    const t = await localProject();
    expect((await t.api("POST", "/local-observers", { ...observers("stopped"), run_id: "run-other" })).statusCode).toBe(409);
    expect((await t.api("POST", "/local-observers", observers("sleeping"))).statusCode).toBe(422);
    expect((await t.api("POST", "/local-observers", { ...observers("stopped"), observers: [{ ...observers("stopped").observers[0], declared: ["nope"] }] })).statusCode).toBe(422);
    expect((await t.api("POST", "/local-observers", { ...observers("stopped"), observers: [{ ...observers("stopped").observers[0], observer_id: "api" }] })).statusCode).toBe(422); // a service is not an observer
    expect((await t.api("POST", "/local-observers", { ...observers("stopped"), truth: [] })).statusCode).toBe(422);
    expect((await t.api("POST", "/local-observers", observers("stopped"), t.ctx.analyst)).statusCode).toBe(403);
    // no report: the analysis state has no observer elements and no new base field
    const st = await t.state();
    expect(st.state.elements.some((e: { kind: string }) => e.kind === "observer")).toBe(false);
    expect("local_observers" in st.state.base).toBe(false);
  });
});

describe("next-B: restart-supervised-observer candidate", () => {
  it("a stopped supervisor-owned observer yields a reviewed, typed, plan-only restart_test_observer candidate bound to the observer revision", async () => {
    const t = await localProject();
    expect((await t.api("POST", "/local-observers", observers("stopped"))).statusCode).toBe(200);
    const r = await t.generate({ prohibited: [GAP], permitted: [OWN] });
    expect(r.status, JSON.stringify(r.reasons)).toBe("single_candidate");
    expect(summary(r)).toEqual([["restart-supervised-observer", "audit", true, false]]);
    const c = r.candidates[0];
    expect(c.plan.authority).toBe("plan_only");
    expect(c.plan.actions).toEqual([{ id: "action-1", target_resource_id: "audit", type: "restart_test_observer", parameters: { observer_ref: "audit" }, expected_target_revision: "audit:observer-down-h2" }]);
    expect(validateRepairPlan(c.plan, { now: Date.now() }).ok).toBe(true);
    expect(c.patch.changes).toEqual([{ op: "modify", kind: "observer", authority: `${t.P}/local`, id: "audit#observer", attrs: { state: "running", observes: ["artifacts", "tenant-db"] } }]);
    expect(String(c.verification.executed_local)).toMatch(/observation handshake/);
    expect(String(c.verification.executed_local)).not.toMatch(/verified|success/i);
    // ranked-candidate listing without persisting (for a selection benchmark)
    const listed = (await t.api("POST", `/cases/${t.kase.id}/repairs/ranked`, { base_state_hash: (await t.state()).state_hash, objective: { prohibited: [GAP], permitted: [OWN] } }, t.ctx.analyst)).json();
    expect(listed.persisted).toBe(false);
    expect(listed.candidates.map((x: Cand) => [x.rank, x.template.id, x.target])).toEqual([[1, "restart-supervised-observer", "audit"]]);
  });

  it("a misconfigured observer also yields the restart candidate; a running one yields none (no_repair_needed)", async () => {
    const t = await localProject();
    expect((await t.api("POST", "/local-observers", observers("misconfigured"))).statusCode).toBe(200);
    expect(summary(await t.generate({ prohibited: [GAP], permitted: [OWN] }))).toEqual([["restart-supervised-observer", "audit", true, false]]);
    expect((await t.api("POST", "/local-observers", observers("running"))).statusCode).toBe(200);
    const none = await t.generate({ prohibited: [GAP], permitted: [OWN] });
    expect(none.status).toBe("no_repair_needed");
    expect(none.candidates).toEqual([]);
  });

  it("an unsupported observer state (absent from the compiled world) is an explicit no-applicable-candidate outcome", async () => {
    const t = await localProject();
    expect((await t.api("POST", "/local-observers", observers("absent", { revision: null }))).statusCode).toBe(200);
    const r = await t.generate({ prohibited: [GAP], permitted: [OWN] });
    expect(r.status).toBe("no_supported_repair");
    expect(r.candidates.filter((c: Cand) => c.valid)).toEqual([]);
    expect(r.reasons.join(" ")).toMatch(/audit-observer-gap: .*absent.*no applicable candidate/);
  });

  it("stopping the observer never makes the prohibited cross-tenant read look blocked; gateway-policy candidates are unchanged", async () => {
    const t = await localProject();
    expect((await t.api("POST", "/local-configuration", config("deliberately_weak"))).statusCode).toBe(200);
    const baseline = await t.generate({ prohibited: [CROSS], permitted: [OWN] });
    expect((await t.api("POST", "/local-observers", observers("stopped"))).statusCode).toBe(200);
    const r = await t.generate({ prohibited: [CROSS], permitted: [OWN] });
    // the model still says the prohibited read HOLDS (an unobserved read is not a refused read)
    expect(r.candidates[0].expected_impact.find((x: { probe: string }) => x.probe === "cross-tenant-read").before.holds).toBe("holds");
    expect(r.status).toBe(baseline.status);
    // the same gateway-policy candidates, same plans (only the run-independent fields differ: revision-bound plan ids)
    expect(summary(r)).toEqual(summary(baseline));
    expect(summary(r)).toEqual([["restore-reviewed-policy", "api@policy:baseline", true, false], ["restore-reviewed-policy", "api@policy:candidate", true, false]]);
    expect(r.candidates.map((c: Cand) => c.plan.actions)).toEqual(baseline.candidates.map((c: Cand) => c.plan.actions));
    // … and the executed verification is flagged as needing observation first
    expect(r.observation_prerequisites.map((x: { observer_id: string; state: string; probes: string[] }) => [x.observer_id, x.state, x.probes])).toEqual([["audit", "stopped", ["cross-tenant-read", "own-tenant-read"]]]);
    expect(baseline.observation_prerequisites).toBeUndefined();
    // with the observer gap in the objective too, the restart candidate joins the set (and a combination)
    const both = await t.generate({ prohibited: [CROSS, GAP], permitted: [OWN] });
    expect(summary(both).map((x) => x[0])).toEqual(expect.arrayContaining(["restore-reviewed-policy", "restart-supervised-observer", "combined"]));
    const restart = both.candidates.find((c: Cand) => c.template.id === "restart-supervised-observer");
    // restarting the observer alone does not block the cross-tenant read
    expect(restart.expected_impact.find((x: { probe: string }) => x.probe === "cross-tenant-read").after.holds).toBe("holds");
    expect(restart.tradeoffs.objective_coverage.still_possible).toEqual(["cross-tenant-read"]);
  });

  it("without any observer report, the existing behaviour is exactly unchanged (no observer elements, no prerequisites field)", async () => {
    const t = await localProject();
    expect((await t.api("POST", "/local-configuration", config("deliberately_weak"))).statusCode).toBe(200);
    const r = await t.generate({ prohibited: [CROSS], permitted: [OWN] });
    expect(summary(r)).toEqual([["restore-reviewed-policy", "api@policy:baseline", true, false], ["restore-reviewed-policy", "api@policy:candidate", true, false]]);
    expect("observation_prerequisites" in r).toBe(false);
    // the legacy source-based observer_gap path (no supervisor report) is untouched: unknown observer -> no candidate
    const g = await t.generate({ prohibited: [GAP], permitted: [OWN] });
    expect(g.candidates.filter((c: Cand) => c.template.id === "restart-supervised-observer")).toEqual([]);
  });
});
