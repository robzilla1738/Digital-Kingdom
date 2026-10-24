import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileWorld, instantiateBlueprint, isHumanApproval, planDigest, RunRefusal, Supervisor, validateLabLease, type RepairAction, type Run } from "@dk/local-world";
import { buildApp } from "../../apps/server/src/app.ts";
import { openDb } from "../../apps/server/src/db.ts";
import { Store } from "../../apps/server/src/store.ts";
import { seedDemo } from "../../apps/server/src/seed.ts";
import { BUILTIN_SERVICES } from "./src/world/services.ts";

/**
 * LP20 — run-scoped local authority leases. Negative tests first: every way an investigator, service, controller or
 * forged object could obtain, widen, extend, replay or reuse authority is tried before the one supported issuance.
 * Real supervisor, real built-in services on 127.0.0.1, real Digital Kingdom server for the production-path checks.
 */
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const c of cleanups.splice(0).reverse()) await c(); });

async function lab(o: { labActions?: "plan_only" | "leased"; blueprint?: string; sup?: Supervisor } = {}) {
  const sup = o.sup ?? new Supervisor({ services: BUILTIN_SERVICES, ...(o.labActions ? { labActions: o.labActions } : {}) });
  const world = compileWorld(instantiateBlueprint(o.blueprint ?? "saas-storefront", { seed: "lp20" }));
  const { run, operatorToken } = await sup.start(world);
  cleanups.push(async () => { if (run.state === "running" || run.state === "paused") await run.stop(operatorToken); if (run.state === "stopped" || run.state === "aborted") run.cleanup(); });
  return { sup, run, operatorToken };
}
const action = (run: Run, a: Partial<RepairAction> = {}): RepairAction => ({ id: "a1", target_resource_id: "api", type: "set_gateway_policy", parameters: { policy_ref: "policy:candidate" }, expected_target_revision: run.revisionOf(a.target_resource_id ?? "api"), ...a });
const plan = (run: Run, actions: RepairAction[] = [action(run)], over: Record<string, unknown> = {}) => ({
  schema: "dk.local.repair_plan.v1", plan_id: "plan-lp20", run_id: run.run_id, case_id: "case-lp20", baseline_digest: "a".repeat(64), candidate_digest: "b".repeat(64),
  actions, verification_test_ids: ["probe-cross-tenant"], positive_control_ids: ["probe-own-tenant"], residual_unknowns: [], authority: "plan_only",
  expires_at: new Date(Date.now() + 3_600_000).toISOString(), ...over,
});
const refused = (f: () => unknown, code: RunRefusal["code"], re?: RegExp) => {
  try { f(); } catch (e) { expect(e).toBeInstanceOf(RunRefusal); expect((e as RunRefusal).code, (e as Error).message).toBe(code); if (re) expect((e as Error).message).toMatch(re); return (e as Error).message; }
  throw new Error(`expected a ${code} refusal`);
};

describe("LP20-A1: an investigator, service or controller cannot issue, extend or approve its own lease", () => {
  it("default supervisors are plan-only: even the operator cannot issue a lease", async () => {
    const { sup, run } = await lab();
    expect(sup.labActions).toBe("plan_only");
    const op = sup.operatorCredential();
    const ctl = sup.issueControllerToken(op, run.run_id);
    refused(() => sup.issueLease(op, { run_id: run.run_id, plan: plan(run), controller_token: ctl }), "scope", /plan-only/);
    expect(sup.leaseAudit().map((e) => e.transition)).toEqual(["refused"]);
  });

  it("run tokens, Digital Kingdom tokens, controller tokens, leases and forgeries cannot issue a lease or mint a controller", async () => {
    const { sup, run, operatorToken } = await lab({ labActions: "leased" });
    const store = new Store(openDb(":memory:"));
    cleanups.push(() => store.db.close());
    const dkAdmin = store.createToken("lab admin", "admin").token, dkService = store.createToken("svc", "analyst", "*", undefined, "service").token;
    const investigator = sup.issue(run.run_id, { resources: "*", actions: ["request_route", "read_effects"] });
    const op = sup.operatorCredential();
    refused(() => sup.operatorCredential(), "unauthorized", /already handed out/);
    const ctl = sup.issueControllerToken(op, run.run_id);
    const good = sup.issueLease(op, { run_id: run.run_id, plan: plan(run), controller_token: ctl });
    const forgedOp = `dkop_v1.${"A".repeat(16)}.${"B".repeat(43)}`;
    for (const [cred, kind] of [[operatorToken, /a run token/], [investigator, /a run token/], [ctl, /a run token/], [dkAdmin, /server token|unknown credential/], [dkService, /server token|unknown credential/], [good.token, /a lease/], [forgedOp, /unknown credential/], [undefined, /no credential/]] as const) {
      refused(() => sup.issueLease(cred as string, { run_id: run.run_id, plan: plan(run), controller_token: ctl }), "unauthorized", kind);
      refused(() => sup.issueControllerToken(cred as string, run.run_id), "unauthorized");
      refused(() => sup.revokeLease(cred as string, good.lease.lease_id, "x"), "unauthorized");
      refused(() => sup.killSwitch(cred as string, "x"), "unauthorized");
    }
    // a controller identity cannot be minted through ordinary token issuance either
    refused(() => sup.issue(run.run_id, { resources: "*", actions: ["repair_execute"] }), "unauthorized", /operator/);
    // an investigator token cannot be the controller of a lease (controller identities carry repair_execute only)
    refused(() => sup.issueLease(op, { run_id: run.run_id, plan: plan(run), controller_token: investigator }), "unauthorized", /controller identity refused/);
    refused(() => sup.issueLease(op, { run_id: run.run_id, plan: plan(run), controller_token: operatorToken }), "unauthorized", /controller identity refused/);
    // the controller token itself can do nothing but leased repairs
    refused(() => run.configure(ctl, "api", { policy_variant: "candidate" }), "scope");
    await expect(run.request(ctl, { resource: "ingress", method: "POST", path: "/login", body: {} })).rejects.toMatchObject({ code: "scope" });
    // no extension exists; a longer lease is a new operator issuance. Editing the returned object changes nothing.
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(sup.leases)).filter((n) => /extend|renew|approve|grant/i.test(n))).toEqual([]);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(sup)).filter((n) => /extend|renew|approve/i.test(n))).toEqual([]);
    good.lease.ttl_ms = 900_000; good.lease.budget.max_operations = 50; (good.lease as { counts_as_human_approval: boolean }).counts_as_human_approval = true;
    const view = sup.leases.view(good.token);
    expect(view.lease.ttl_ms).toBe(120_000); expect(view.lease.budget.max_operations).toBe(1); expect(view.lease.counts_as_human_approval).toBe(false);
    // a token re-signed for another lease id or carrying another digest does not verify
    const [, id, mac] = good.token.split(".");
    refused(() => sup.leases.view(`dklease_v1.lease-${"0".repeat(16)}.${mac}`), "unauthorized", /signature invalid|unknown/);
    refused(() => sup.leases.view(`dklease_v1.${id}.${"x".repeat(43)}`), "unauthorized", /signature invalid/);
    // an "approval" cannot be smuggled in: execute authority, an approval block, or an LP14 approval descriptor
    refused(() => sup.issueLease(op, { run_id: run.run_id, plan: plan(run, undefined, { authority: "execute" }), controller_token: ctl }), "scope", /not a valid plan-only/);
    refused(() => sup.issueLease(op, { run_id: run.run_id, plan: { ...plan(run), approval: { approved_by: "agent", human: true } }, controller_token: ctl }), "scope", /not a valid plan-only/);
    refused(() => sup.leases.view({ plan_id: "plan-lp20", baseline_digest: "a".repeat(64), candidate_digest: "b".repeat(64) }), "unauthorized", /not a lab lease/);
    // every refusal is an audit transition, and the supervisor's run truth carries the run-scoped ones
    const audit = sup.leaseAudit();
    expect(audit.filter((e) => e.transition === "issued")).toHaveLength(1);
    expect(audit.filter((e) => e.transition === "refused").length).toBeGreaterThanOrEqual(10);
    expect(run.truth.some((t) => t.record.event === "lease_issued")).toBe(true);
  });
});

describe("LP20-A2: lease targets are supervisor-owned resources only", () => {
  it("provider ARNs, unregistered ids, other runs, other supervisors, forged lab metadata and wrong templates are refused", async () => {
    const { sup, run } = await lab({ labActions: "leased" });
    const other = await lab({ labActions: "leased" }); // a different supervisor
    const op = sup.operatorCredential(), ctl = sup.issueControllerToken(op, run.run_id);
    const issue = (p: unknown, runId = run.run_id, c = ctl) => () => sup.issueLease(op, { run_id: runId, plan: p, controller_token: c });
    const withTarget = (target: string, extra: Partial<RepairAction> = {}) => plan(run, [{ id: "a1", target_resource_id: target, type: "set_gateway_policy", parameters: { policy_ref: "policy:candidate" }, expected_target_revision: "rev-1", ...extra }]);
    refused(issue(withTarget("arn:aws:iam::123456789012:role:prod-admin")), "unregistered", /provider identifier/);
    refused(issue(withTarget("arn:aws:s3:::prod-bucket")), "unregistered", /provider identifier/);
    refused(issue(withTarget("123456789012")), "unregistered", /provider identifier/);
    refused(issue(withTarget("i-0abc123def4567890")), "unregistered", /provider identifier/);
    refused(issue(withTarget("projects:prod:instances:db")), "unregistered", /provider identifier/);
    refused(issue(withTarget("prod-db")), "unregistered", /not a resource of/);
    refused(issue(withTarget("127.0.0.1:8787")), "unregistered", /not a resource of/);
    // a plan for another supervisor's run, or this run's plan presented for a run this supervisor never created
    refused(issue(plan(other.run)), "wrong_run", /names run/);
    refused(issue(plan(other.run), other.run.run_id), "wrong_run", /not a run of this supervisor/);
    refused(issue(plan(run), "run-000000000000"), "wrong_run", /not a run of this supervisor/);
    // forged lab metadata on the plan or its actions is a schema violation, not a hint
    refused(issue({ ...plan(run), lab: true, owner: "supervisor", supervisor_owned: true }), "scope", /not a valid plan-only/);
    refused(issue(plan(run, [{ ...action(run), lab_owned: true } as RepairAction])), "scope", /not a valid plan-only/);
    refused(issue(plan(run, [{ ...action(run), parameters: { policy_ref: "policy:candidate", endpoint: "http://127.0.0.1:1" } } as RepairAction])), "scope", /not a valid plan-only/);
    // reviewed template per action type and run-owned reference shapes only
    refused(issue(plan(run, [action(run, { target_resource_id: "tenant-db", type: "deactivate_test_token", parameters: { token_ref: "cred-1" } })])), "scope", /cannot target a tenant_store/);
    refused(issue(plan(run, [action(run, { target_resource_id: "audit", type: "set_gateway_policy" })])), "scope", /cannot target a observer/);
    refused(issue(plan(run, [action(run, { parameters: { policy_ref: "policy:deliberately_weak" } })])), "scope", /not a run-owned reference/);
    refused(issue(plan(run, [action(run, { target_resource_id: "audit", type: "restart_test_observer", parameters: { observer_ref: "other-observer" } })])), "scope", /not a run-owned reference/);
    // a production response plan is not a local repair plan
    refused(issue({ schema: "dk.response_plan.v1", action_id: "secrets.rotate_credentials", targets: [{ asset_id: "api", provider_id: "arn:aws:iam::123456789012:user:x" }], parameters: {}, digest: "c".repeat(64) }), "scope", /not a valid plan-only/);
    // the supported case: a registered run resource of a reviewed template
    const ok = sup.issueLease(op, { run_id: run.run_id, plan: plan(run), controller_token: ctl });
    expect(validateLabLease(ok.lease).ok).toBe(true);
    expect(ok.lease).toMatchObject({ run_id: run.run_id, project_id: run.project_id, namespace: "dk.local.lab_authorization", issuer: "supervisor", authorizes: "typed_repair_actions_on_run_owned_disposable_resources" });
    expect(ok.lease.actions).toEqual([expect.objectContaining({ action_id: "a1", target_resource_id: "api", expected_target_revision: "api:policy-baseline-r1" })]);
  });
});

describe("LP20-A3: expired, stale, replayed or changed authority cannot authorize execution", () => {
  it("monotonic expiry (with a frozen wall clock), stale target revision, changed parameters and replay are refused at use", async () => {
    const { sup, run, operatorToken } = await lab({ labActions: "leased" });
    const op = sup.operatorCredential(), ctl = sup.issueControllerToken(op, run.run_id), ctlId = sup.controllerTokenId(ctl, run.run_id);
    const p = plan(run);
    const use = (token: string, pl = p, extra: Record<string, unknown> = {}) => () => sup.leases.authorizeAction(token, { run, plan: pl as never, action_id: "a1", controller_token_id: ctlId, idempotency_key: "k".repeat(64), ...extra });
    // issuance precondition: the plan's expected revision must be the target's current revision
    refused(() => sup.issueLease(op, { run_id: run.run_id, plan: plan(run, [action(run, { expected_target_revision: "api:policy-baseline-r0" })]), controller_token: ctl }), "state", /precondition failed/);
    // expiry on the monotonic clock: freezing Date does not keep a lease alive
    const short = sup.issueLease(op, { run_id: run.run_id, plan: p, controller_token: ctl, ttl_ms: 120 });
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(short.lease.issued_at));
    await new Promise((r) => setTimeout(r, 200));
    refused(use(short.token), "unauthorized", /expired/);
    vi.useRealTimers();
    // changed parameters (same lease, edited plan) and another action
    const lease = sup.issueLease(op, { run_id: run.run_id, plan: p, controller_token: ctl });
    refused(use(lease.token, plan(run, [action(run, { parameters: { policy_ref: "policy:baseline" } })])), "scope", /plan digest differs/);
    refused(use(lease.token, { ...p, positive_control_ids: ["probe-other"] }), "scope", /plan digest differs/);
    refused(() => sup.leases.authorizeAction(lease.token, { run, plan: p as never, action_id: "a2", controller_token_id: ctlId, idempotency_key: "k".repeat(64) }), "scope", /not leased/);
    // another controller identity cannot use it
    const ctl2 = sup.issueControllerToken(op, run.run_id);
    refused(use(lease.token, p, { controller_token_id: sup.controllerTokenId(ctl2, run.run_id) }), "unauthorized", /another controller/);
    // stale: the target changed after issuance
    const { rec } = sup.leases.authorizeAction(lease.token, { run, plan: p as never, action_id: "a1", controller_token_id: ctlId, idempotency_key: "k".repeat(64) });
    run.configure(operatorToken, "api", { policy_variant: "deliberately_weak" });
    refused(use(lease.token), "state", /stale: api is at api:policy-deliberately_weak-r2/);
    run.configure(operatorToken, "api", { policy_variant: "baseline" }); // r3: still not the leased revision
    refused(use(lease.token), "state", /stale/);
    expect(rec.lease.plan_digest).toBe(planDigest(p as never));
    // replay: a used action cannot be used again, and a clone run does not accept the source run's lease
    const p2 = plan(run);
    const l2 = sup.issueLease(op, { run_id: run.run_id, plan: p2, controller_token: ctl });
    const first = sup.leases.authorizeAction(l2.token, { run, plan: p2 as never, action_id: "a1", controller_token_id: ctlId, idempotency_key: "k".repeat(64) });
    sup.leases.consume(first.rec, "a1", "k".repeat(64));
    sup.leases.confirmApplied(first.rec, first.action, "api:policy-candidate-r4");
    refused(() => sup.leases.authorizeAction(l2.token, { run, plan: p2 as never, action_id: "a1", controller_token_id: ctlId, idempotency_key: "k".repeat(64), reapply: true }), "unauthorized", /expired|already used|stale|exhausted/);
    const { run: clone } = await sup.clone(operatorToken, run);
    cleanups.push(async () => { if (clone.state === "running") await clone.stop(sup.issue(clone.run_id, { resources: "*", actions: ["lifecycle"] })); clone.cleanup(); });
    refused(() => sup.leases.authorizeAction(l2.token, { run: clone, plan: p2 as never, action_id: "a1", controller_token_id: ctlId, idempotency_key: "k".repeat(64) }), "wrong_run");
    expect(sup.leaseAudit().filter((e) => e.transition === "replay_refused").length).toBeGreaterThanOrEqual(1);
    // operator revocation, then the kill switch: outstanding leases die and the supervisor is plan-only for good
    const p3 = plan(run);
    const l3 = sup.issueLease(op, { run_id: run.run_id, plan: p3, controller_token: ctl });
    sup.revokeLease(op, l3.lease.lease_id, "operator changed their mind");
    refused(() => sup.leases.authorizeAction(l3.token, { run, plan: p3 as never, action_id: "a1", controller_token_id: ctlId, idempotency_key: "k".repeat(64) }), "unauthorized", /revoked/);
    const l4 = sup.issueLease(op, { run_id: run.run_id, plan: p3, controller_token: ctl });
    sup.killSwitch(op, "stop all lab actions");
    expect(sup.labActions).toBe("plan_only");
    refused(() => sup.leases.authorizeAction(l4.token, { run, plan: p3 as never, action_id: "a1", controller_token_id: ctlId, idempotency_key: "k".repeat(64) }), "unauthorized", /revoked.*kill switch/);
    refused(() => sup.issueLease(op, { run_id: run.run_id, plan: p3, controller_token: ctl }), "scope", /plan-only/);
    expect(sup.leaseAudit().map((e) => e.transition)).toEqual(expect.arrayContaining(["issued", "expired", "used", "applied_confirmed", "replay_refused", "revoked", "kill_switch"]));
  });

  it("stopping or aborting the run revokes its leases", async () => {
    const { sup, run, operatorToken } = await lab({ labActions: "leased" });
    const op = sup.operatorCredential(), ctl = sup.issueControllerToken(op, run.run_id), ctlId = sup.controllerTokenId(ctl, run.run_id);
    const p = plan(run);
    const l = sup.issueLease(op, { run_id: run.run_id, plan: p, controller_token: ctl });
    await run.stop(operatorToken);
    expect(sup.leases.view(l.token).state).toBe("revoked");
    refused(() => sup.leases.authorizeAction(l.token, { run, plan: p as never, action_id: "a1", controller_token_id: ctlId, idempotency_key: "k".repeat(64) }), "unauthorized", /revoked/);
    refused(() => sup.issueLease(op, { run_id: run.run_id, plan: p, controller_token: ctl }), "state", /run is stopped/);
  });
});

describe("LP20-A4: a local lease never counts as human approval and cannot reach the production-facing response path", () => {
  it("the lease says so, the validator enforces it, and the server accepts it nowhere", async () => {
    const { sup, run } = await lab({ labActions: "leased" });
    const op = sup.operatorCredential(), ctl = sup.issueControllerToken(op, run.run_id);
    const { token, lease } = sup.issueLease(op, { run_id: run.run_id, plan: plan(run), controller_token: ctl });
    expect(lease).toMatchObject({ approval_kind: "local_lab_lease", counts_as_human_approval: false, production_path: "not_authorized" });
    expect(isHumanApproval(lease)).toBe(false);
    expect(isHumanApproval({ ...lease, counts_as_human_approval: true, approved_by: "human:alice" })).toBe(false);
    expect(validateLabLease({ ...lease, counts_as_human_approval: true }).ok).toBe(false);
    expect(validateLabLease({ ...lease, production_path: "authorized" }).ok).toBe(false);
    expect(validateLabLease({ ...lease, approved_by: "human:alice" }).ok).toBe(false);

    const store = new Store(openDb(":memory:"));
    seedDemo(store);
    const analyst = store.createToken("investigator", "analyst").token, viewer = store.createToken("viewer", "viewer").token;
    const app = await buildApp({ store, secret: "lp20-secret", demoMode: false, webDist: "/nonexistent" });
    cleanups.push(async () => { await app.close(); store.db.close(); });
    const inject = (method: "GET" | "POST", url: string, auth: string, payload?: unknown) => app.inject({ method, url, headers: { authorization: `Bearer ${auth}` }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
    const containment = (await inject("GET", "/api/projects/demo-castle/containment", viewer)).json() as { catalog: { id: string }[] };
    const findingId = (store.listFindings("demo-castle")[0] as { id: string }).id;
    const req = await inject("POST", "/api/projects/demo-castle/containment", analyst, { finding_id: findingId, action_id: containment.catalog[0]!.id, rationale: "lp20" });
    expect(req.statusCode).toBe(200);
    const cid = (req.json() as { id: string }).id;
    // the lease (or the operator credential) as a bearer credential is not a principal
    for (const cred of [token, op, ctl]) expect((await inject("POST", `/api/projects/demo-castle/containment/${cid}/decision`, cred, { decision: "approved" })).statusCode).toBe(401);
    // an analyst carrying the lease in the body still cannot approve the production-facing action
    expect((await inject("POST", `/api/projects/demo-castle/containment/${cid}/decision`, analyst, { decision: "approved", lease, lease_token: token })).statusCode).toBe(403);
    expect(((await inject("GET", "/api/projects/demo-castle/containment", viewer)).json() as { requests: { id: string; status: string }[] }).requests.find((r) => r.id === cid)!.status).not.toBe("approved");
    // there is no lease or lab-execution surface on the server, and runtime policy still says plan-only
    for (const u of ["/api/projects/demo-castle/leases", "/api/projects/demo-castle/lab/leases", "/api/projects/demo-castle/repairs/execute", "/api/lab/execute"]) expect((await inject("POST", u, analyst, { lease_token: token })).statusCode).toBe(404);
    expect(((await inject("GET", "/api/capabilities", viewer)).json() as { runtime_policy: { local_actions: unknown } }).runtime_policy.local_actions).toMatchObject({ mode: "plan_only", executor: "not_available", lease_required: true });
    // and no server/MCP/web source can construct or accept one
    const roots = ["apps/server/src", "apps/mcp/src", "apps/web/src"].map((r) => join(fileURLToPath(new URL("../..", import.meta.url)), r));
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [join(d, e.name)] : []);
    const files = roots.flatMap((r) => walk(r));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/dklease_v1|dkop_v1|issueLease|LeaseRegistry|issueControllerToken|operatorCredential|RepairController|repair_execute/);
  });
});
