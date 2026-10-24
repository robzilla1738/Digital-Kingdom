import { compileWorld, grantRef, instantiateBlueprint, RepairController, Supervisor, type RepairAction, type Run } from "@dk/local-world";
import { BUILTIN_SERVICES, syntheticPassword } from "./src/world/services.ts";

/**
 * Test harness for LP21/LP22: one disposable supervisor-owned run with leased local actions enabled, the operator
 * credential held by the harness (the launcher), a separate controller identity and helpers to build plan-only
 * `dk.local.repair_plan.v1` documents. No server is needed; everything runs on 127.0.0.1 listeners the run owns.
 */
export type Lab = Awaited<ReturnType<typeof repairLab>>;
export async function repairLab(blueprint: "saas-storefront" | "agent-workspace" | "delivery-identity", cleanups: (() => Promise<void> | void)[], seed = "m5") {
  const sup = new Supervisor({ services: BUILTIN_SERVICES, labActions: "leased" });
  const world = compileWorld(instantiateBlueprint(blueprint, { seed }));
  const { run, operatorToken } = await sup.start(world);
  cleanups.push(async () => { if (run.state === "running" || run.state === "paused") await run.stop(operatorToken); if (run.state === "stopped" || run.state === "aborted") run.cleanup(); });
  const op = sup.operatorCredential();
  const ctl = sup.issueControllerToken(op, run.run_id);
  const req = (resource: string, method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}) => run.request(operatorToken, { resource, method, path, headers, ...(body !== undefined ? { body } : {}) });
  const action = (a: Omit<RepairAction, "expected_target_revision"> & { expected_target_revision?: string }): RepairAction => ({ ...a, expected_target_revision: a.expected_target_revision ?? run.revisionOf(a.target_resource_id) });
  let n = 0;
  const plan = (actions: RepairAction[], over: Record<string, unknown> = {}) => ({
    schema: "dk.local.repair_plan.v1" as const, plan_id: `plan-m5-${++n}`, run_id: run.run_id, case_id: "case-m5", baseline_digest: "a".repeat(64), candidate_digest: "b".repeat(64),
    actions, verification_test_ids: ["probe-prohibited"], positive_control_ids: ["probe-permitted"], residual_unknowns: [], authority: "plan_only" as const,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(), ...over,
  });
  const lease = (p: unknown, o: { ttl_ms?: number; max_operations?: number; controller?: string } = {}) => sup.issueLease(op, { run_id: run.run_id, plan: p, controller_token: o.controller ?? ctl, ...(o.ttl_ms ? { ttl_ms: o.ttl_ms } : {}), ...(o.max_operations ? { max_operations: o.max_operations } : {}) });
  const controller = (o: ConstructorParameters<typeof RepairController>[2] = {}) => new RepairController(run, ctl, o);
  const repairOps = () => run.truth.filter((t) => t.record.event === "repair_operation");
  return { sup, run, operatorToken, op, ctl, req, action, plan, lease, controller, repairOps };
}

/** delivery-identity: a compromised credential (cred-1) and a legitimate one (cred-2) for svc:deployer, both granted. */
export async function deliveryWithCredentials(cleanups: (() => Promise<void> | void)[], seed = "m5-delivery") {
  const t = await repairLab("delivery-identity", cleanups, seed);
  const issue = async () => (await t.req("issuer", "POST", "/credentials", { subject: "svc:deployer", scope: ["read"] })).body as { id: string; secret: string };
  const leaked = await issue(), legit = await issue();
  if ((await t.req("issuer", "POST", "/grants", { subject: "svc:deployer", grant: "read:deploy-data", op: "add" })).status !== 200) throw new Error("grant setup failed");
  const fixed = (await t.req("depot", "POST", "/artifacts", { name: "build-fixed", content: "synthetic fixed build" }, { "x-world-actor": "svc:builder" })).body as { digest: string };
  const read = (c: { id: string; secret: string }) => t.req("deploy", "GET", "/tenants/release/records", undefined, { "x-world-credential-id": c.id, "x-world-credential": c.secret });
  return { ...t, leaked, legit, fixedDigest: fixed.digest, read, deployGrant: grantRef("svc:deployer", "read:deploy-data") };
}

/** saas-storefront with the tenant API weakened (the lab defect): cross-tenant reads succeed until repaired. */
export async function weakStorefront(cleanups: (() => Promise<void> | void)[], seed = "m5-saas") {
  const t = await repairLab("saas-storefront", cleanups, seed);
  t.run.configure(t.operatorToken, "api", { policy_variant: "deliberately_weak" });
  const login = async (account: string) => (await t.req("ingress", "POST", "/login", { account, password: syntheticPassword(t.run.world, account) })).body as { session: string };
  const a = (await login("acct:tenant-a:user")).session, b = (await login("acct:tenant-b:user")).session;
  const read = (session: string, tenant: string) => t.req("ingress", "GET", `/tenants/${tenant}/records`, undefined, { "x-world-session": session });
  return { ...t, sessionA: a, sessionB: b, read };
}
export type { Run };
