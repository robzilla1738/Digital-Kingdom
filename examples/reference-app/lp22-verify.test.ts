import { afterEach, describe, expect, it } from "vitest";
import { linkSync } from "node:fs";
import { join } from "node:path";
import { EffectVerifier, RunRefusal, validateRepairVerification, type VerificationProbe } from "@dk/local-world";
import { deliveryWithCredentials, weakStorefront } from "./repair-lab.ts";

/**
 * LP22 — independent effect verification. Real runs, real leased repairs (LP21) and the run's independent observers;
 * the verifier has its own identity and reads effects only from observers, by operation id.
 */
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });
const verifierFor = (t: { sup: { issue: (r: string, s: { resources: "*"; actions: ("request_route" | "read_effects")[] }) => string }; run: { run_id: string } }) => t.sup.issue(t.run.run_id, { resources: "*", actions: ["request_route", "read_effects"] });

function storefrontProbes(s: { sessionA: string }): Record<string, VerificationProbe> {
  const h = { "x-world-session": s.sessionA };
  return {
    cross: { id: "cross-tenant-read", expectation: "prohibited", request: { resource: "ingress", method: "GET", path: "/tenants/tenant-b/records", headers: h }, effect: { observer: "audit", resource: "tenant-db" } },
    own: { id: "own-tenant-read", expectation: "permitted", request: { resource: "ingress", method: "GET", path: "/tenants/tenant-a/records", headers: h }, effect: { observer: "audit", resource: "tenant-db" } },
    crossJob: { id: "cross-tenant-job", expectation: "prohibited", request: { resource: "ingress", method: "POST", path: "/tenants/tenant-b/jobs", headers: h }, effect: { observer: "audit", resource: "tenant-db" } },
    ownJob: { id: "own-tenant-job", expectation: "permitted", request: { resource: "ingress", method: "POST", path: "/tenants/tenant-a/jobs", headers: h }, effect: { observer: "audit", resource: "tenant-db" } },
  };
}
function credentialProbes(d: { leaked: { id: string; secret: string }; legit: { id: string; secret: string } }): VerificationProbe[] {
  const read = (c: { id: string; secret: string }) => ({ resource: "deploy", method: "GET" as const, path: "/tenants/release/records", headers: { "x-world-credential-id": c.id, "x-world-credential": c.secret } });
  return [
    { id: "leaked-credential-read", expectation: "prohibited", request: read(d.leaked), effect: { observer: "use-observer", resource: "deploy-data" } },
    { id: "legit-credential-read", expectation: "permitted", request: read(d.legit), effect: { observer: "use-observer", resource: "deploy-data" } },
  ];
}

describe("LP22-A1: an accepted action with unchanged target behavior fails verification", () => {
  it("the wrong repair is applied (completed, revision moved) yet the prohibited effect is still observed: fail, residual access", async () => {
    const s = await weakStorefront(cleanups);
    const pr = storefrontProbes(s);
    const v = new EffectVerifier(s.run, verifierFor(s));
    const before = await v.observe([pr.cross!, pr.own!], { repeats: 1 });
    expect(before.map((o) => o.answer.status)).toEqual(["observed", "observed"]); // the defect is real
    // accepted action: the edge now requires a session — but the cross-tenant read carries one
    const plan = s.plan([s.action({ id: "a1", target_resource_id: "ingress", type: "set_gateway_policy", parameters: { policy_ref: "policy:candidate" } })]);
    const exec = await s.controller().execute(s.lease(plan).token, plan);
    expect(exec.state).toBe("completed");
    expect(exec.actions[0]).toMatchObject({ state: "applied", from_revision: "ingress:policy-baseline-r1", to_revision: "ingress:policy-candidate-r2" });
    const r = await v.verify({ plan, execution: exec, probes: [pr.cross!, pr.own!], before });
    expect(validateRepairVerification(r).errors).toEqual([]);
    expect(r.security_verdict).toBe("fail");
    expect(r.residual_access).toEqual(["cross-tenant-read"]);
    expect(r.whole_run).toMatchObject({ outcome: "security_failed", success: false });
    expect(r.whole_run.reasons.join(" | ")).toMatch(/target behavior unchanged for cross-tenant-read/);
    expect(r.verification_receipt).toMatchObject({ tested_target_revision: "ingress:policy-candidate-r2", overall_outcome: "fail", scope: "local_run_only" });
    expect(r.observations.filter((o) => o.probe_id === "cross-tenant-read").map((o) => [o.status, o.actual_effect])).toEqual([[200, "observed"], [200, "observed"]]);
    expect(new Set(r.observations.map((o) => o.nonce_digest)).size).toBe(r.observations.length);
  });

  it("the right repair passes; a baseline that never showed the prohibited effect cannot support a pass", async () => {
    const s = await weakStorefront(cleanups, "m5-saas-right");
    const pr = storefrontProbes(s);
    const v = new EffectVerifier(s.run, verifierFor(s));
    const before = await v.observe([pr.cross!, pr.own!], { repeats: 1 });
    const plan = s.plan([s.action({ id: "a1", target_resource_id: "api", type: "set_gateway_policy", parameters: { policy_ref: "policy:baseline" } })]);
    const exec = await s.controller().execute(s.lease(plan).token, plan);
    const r = await v.verify({ plan, execution: exec, probes: [pr.cross!, pr.own!], before });
    expect(r.security_verdict).toBe("pass");
    expect(r.residual_access).toEqual([]); expect(r.disruption).toEqual([]);
    expect(r.observations.filter((o) => o.probe_id === "cross-tenant-read").map((o) => [o.status, o.actual_effect])).toEqual([[403, "not_observed"], [403, "not_observed"]]);
    expect(r.whole_run.outcome).toBe("cleanup_pending"); // not success until the run is cleaned
    await s.run.stop(s.operatorToken); s.run.cleanup();
    const fin = v.finalize(r);
    expect(fin.whole_run).toMatchObject({ outcome: "success", success: true });
    expect(fin.verification_receipt.overall_outcome).toBe("pass");

    // a world without the defect: the "repair" can only be inconclusive, never verified
    const ok = await weakStorefront(cleanups, "m5-saas-nodefect");
    ok.run.configure(ok.operatorToken, "api", { policy_variant: "baseline" });
    const pk = storefrontProbes(ok);
    const vk = new EffectVerifier(ok.run, verifierFor(ok));
    const b2 = await vk.observe([pk.cross!, pk.own!], { repeats: 1 });
    expect(b2[0]!.answer.status).toBe("not_observed");
    const p2 = ok.plan([ok.action({ id: "a1", target_resource_id: "api", type: "set_gateway_policy", parameters: { policy_ref: "policy:candidate" } })]);
    const e2 = await ok.controller().execute(ok.lease(p2).token, p2);
    const r2 = await vk.verify({ plan: p2, execution: e2, probes: [pk.cross!, pk.own!], before: b2 });
    expect(r2.security_verdict).toBe("inconclusive");
    expect(r2.whole_run.reasons.join(" | ")).toMatch(/baseline never showed the prohibited effect/);
    // and without any baseline the check is listed as unassessed
    const r3 = await vk.verify({ plan: p2, execution: e2, probes: [pk.cross!, pk.own!] });
    expect(r3.verification_receipt.unassessed_paths).toContain("no pre-repair baseline: the unchanged-behavior check was not performed");
  });
});

describe("LP22-A2: delayed and unrelated concurrent effects are correlated correctly; an unavailable observer is inconclusive", () => {
  it("a delayed worker effect is attributed to the job that caused it; concurrent tenant-b traffic is never attributed to a probe", async () => {
    const s = await weakStorefront(cleanups, "m5-saas-delayed");
    const pr = storefrontProbes(s);
    const v = new EffectVerifier(s.run, verifierFor(s));
    const unrelated = async () => { await s.read(s.sessionB, "tenant-b"); };
    // before the repair the cross-tenant job's effect lands later, via the worker, and is correlated to the job
    const before = await v.observe([pr.crossJob!, pr.ownJob!], { repeats: 1, settle_ms: 1500, concurrently: unrelated });
    const cj = before.find((o) => o.probe.id === "cross-tenant-job")!;
    expect(cj.status).toBe(202);
    expect(cj.answer.status).toBe("observed");
    expect(cj.settled_ms).toBeGreaterThan(0);
    expect(cj.answer.effects.every((e) => e.op_id === cj.operation_id && e.detail.tenant === "tenant-b" && e.detail.by === "worker")).toBe(true);
    // the observer DID see the concurrent tenant-b reads, under their own operation ids
    const all = s.run.observer(s.operatorToken, "audit").effects();
    const foreign = all.filter((e) => e.resource_id === "tenant-db" && e.detail.tenant === "tenant-b" && e.op_id !== cj.operation_id);
    expect(foreign.length).toBeGreaterThanOrEqual(1);
    // repair, then verify with the same concurrent noise: the prohibited job is refused and nothing is mis-attributed
    const plan = s.plan([s.action({ id: "a1", target_resource_id: "api", type: "set_gateway_policy", parameters: { policy_ref: "policy:baseline" } })]);
    const exec = await s.controller().execute(s.lease(plan).token, plan);
    const r = await v.verify({ plan, execution: exec, probes: [pr.crossJob!, pr.ownJob!], before, settle_ms: 1500, concurrently: unrelated });
    expect(r.security_verdict).toBe("pass");
    const after = r.observations.filter((o) => o.probe_id === "cross-tenant-job");
    expect(after.map((o) => [o.status, o.actual_effect])).toEqual([[403, "not_observed"], [403, "not_observed"]]);
    expect(after.every((o) => o.settled_ms >= 1500)).toBe(true); // absence is only claimed after the full window
    expect(r.observations.filter((o) => o.probe_id === "own-tenant-job").every((o) => o.actual_effect === "observed")).toBe(true);
    // a settling window too short to see delayed effects is refused rather than allowed to pass falsely
    await expect(v.observe([pr.crossJob!], { settle_ms: 0 })).rejects.toThrow(/settle_ms must be 200/);
  });

  it("an unavailable observer yields unknown/inconclusive even though the target answered 403", async () => {
    const s = await weakStorefront(cleanups, "m5-saas-outage");
    const pr = storefrontProbes(s);
    const v = new EffectVerifier(s.run, verifierFor(s));
    const before = await v.observe([pr.cross!, pr.own!], { repeats: 1 });
    const plan = s.plan([s.action({ id: "a1", target_resource_id: "api", type: "set_gateway_policy", parameters: { policy_ref: "policy:baseline" } })]);
    const exec = await s.controller().execute(s.lease(plan).token, plan);
    s.run.observer(s.operatorToken, "audit").stop("audit pipeline outage");
    const r = await v.verify({ plan, execution: exec, probes: [pr.cross!, pr.own!], before });
    expect(r.observations.map((o) => o.actual_effect)).toEqual(["unknown", "unknown", "unknown", "unknown"]);
    expect(r.observations.find((o) => o.probe_id === "cross-tenant-read")!.status).toBe(403);
    expect(r.security_verdict).toBe("inconclusive");
    expect(r.verification_receipt.probes.every((p) => p.observer_scope === "unavailable" && p.result === "inconclusive")).toBe(true);
    expect(r.whole_run).toMatchObject({ outcome: "inconclusive", success: false });
    expect(r.whole_run.reasons.join(" | ")).toMatch(/absence of an effect is not evidence of no effect/);
  });

  it("the verifier is independent: no controller identity, no target self-report, no foreign execution receipt", async () => {
    const s = await weakStorefront(cleanups, "m5-saas-indep");
    const pr = storefrontProbes(s);
    expect(() => new EffectVerifier(s.run, s.ctl)).toThrow(/verifier identity refused/);
    const v = new EffectVerifier(s.run, verifierFor(s));
    await expect(v.observe([{ ...pr.cross!, effect: { observer: "api", resource: "tenant-db" } }])).rejects.toThrow(/not an independent observer/);
    await expect(v.observe([{ ...pr.cross!, effect: { observer: "ingress", resource: "ingress" } }])).rejects.toBeInstanceOf(RunRefusal);
    const plan = s.plan([s.action({ id: "a1", target_resource_id: "api", type: "set_gateway_policy", parameters: { policy_ref: "policy:baseline" } })]);
    const exec = await s.controller().execute(s.lease(plan).token, plan);
    await expect(v.verify({ plan: { ...plan, plan_id: "plan-other" }, execution: exec, probes: [pr.cross!, pr.own!] })).rejects.toThrow(/not this run's execution of this plan/);
    await expect(v.verify({ plan, execution: { ...exec, controller_id: v.verifier_id }, probes: [pr.cross!, pr.own!] })).rejects.toThrow(/executor's identity/);
    await expect(v.verify({ plan, execution: exec, probes: [pr.cross!] })).rejects.toThrow(/positive control/);
  });
});

describe("LP22-A3: prohibited behavior blocked while legitimate behavior broken cannot be a verified repair", () => {
  it("removing the shared grant blocks the leaked credential and the legitimate one: fail with disruption; deactivating the leaked token passes", async () => {
    const d = await deliveryWithCredentials(cleanups);
    const probes = credentialProbes(d);
    const v = new EffectVerifier(d.run, verifierFor(d));
    const before = await v.observe(probes, { repeats: 1 });
    expect(before.map((o) => o.answer.status)).toEqual(["observed", "observed"]);
    const plan = d.plan([d.action({ id: "a1", target_resource_id: "issuer", type: "remove_test_grant", parameters: { grant_ref: d.deployGrant } })]);
    const exec = await d.controller().execute(d.lease(plan).token, plan);
    expect(exec.state).toBe("completed");
    const r = await v.verify({ plan, execution: exec, probes, before });
    expect(r.observations.filter((o) => o.probe_id === "leaked-credential-read").every((o) => o.actual_effect === "not_observed")).toBe(true); // blocked...
    expect(r.observations.filter((o) => o.probe_id === "legit-credential-read").map((o) => [o.status, o.actual_effect])).toEqual([[403, "not_observed"], [403, "not_observed"]]); // ...and broken
    expect(r.security_verdict).toBe("fail");
    expect(r.disruption).toEqual(["legit-credential-read"]);
    expect(r.residual_access).toEqual([]);
    expect(r.whole_run.outcome).toBe("security_failed");
    expect(r.whole_run.reasons.join(" | ")).toMatch(/is not a verified repair/);

    const e = await deliveryWithCredentials(cleanups, "m5-delivery-good");
    const pe = credentialProbes(e);
    const ve = new EffectVerifier(e.run, verifierFor(e));
    const b2 = await ve.observe(pe, { repeats: 1 });
    const p2 = e.plan([e.action({ id: "a1", target_resource_id: "issuer", type: "deactivate_test_token", parameters: { token_ref: e.leaked.id } })]);
    const x2 = await e.controller().execute(e.lease(p2).token, p2);
    const r2 = await ve.verify({ plan: p2, execution: x2, probes: pe, before: b2, repeats: 3 });
    expect(r2.security_verdict).toBe("pass");
    expect(r2.observations.filter((o) => o.probe_id === "legit-credential-read")).toHaveLength(3); // repeated health check
    expect(r2.disruption).toEqual([]);
  });
});

describe("LP22-A4: cleanup failure stays visible and prevents whole-run success even when the security assertion passed", () => {
  it("security pass + failed cleanup = cleanup_failed (not success); security pass + partial execution = execution_incomplete", async () => {
    const d = await deliveryWithCredentials(cleanups, "m5-delivery-cleanup");
    const probes = credentialProbes(d);
    const v = new EffectVerifier(d.run, verifierFor(d));
    const before = await v.observe(probes, { repeats: 1 });
    const plan = d.plan([d.action({ id: "a1", target_resource_id: "issuer", type: "deactivate_test_token", parameters: { token_ref: d.leaked.id } })]);
    const exec = await d.controller().execute(d.lease(plan).token, plan);
    const r = await v.verify({ plan, execution: exec, probes, before });
    expect(r.security_verdict).toBe("pass");
    linkSync(join(d.run.dir, "repair-journal.jsonl"), join(d.sup.root, "outside-link"));
    await d.run.stop(d.operatorToken); d.run.cleanup();
    const fin = v.finalize(r);
    expect(validateRepairVerification(fin).ok).toBe(true);
    expect(fin.security_verdict).toBe("pass");
    expect(fin.cleanup.outcome).toBe("failed");
    expect(fin.cleanup.notes).toMatch(/hard links/);
    expect(fin.whole_run).toMatchObject({ outcome: "cleanup_failed", success: false });
    expect(fin.verification_receipt.overall_outcome).not.toBe("pass");
    expect(fin.whole_run.reasons.join(" | ")).toMatch(/security assertion passed but cleanup failed/);
    // a forged "success" with failed cleanup does not validate
    expect(validateRepairVerification({ ...fin, whole_run: { outcome: "success", success: true, reasons: [] } }).ok).toBe(false);

    // the security effect achieved by a partially applied plan is still not whole-run success
    const q = await deliveryWithCredentials(cleanups, "m5-delivery-partial");
    const pq = credentialProbes(q);
    const vq = new EffectVerifier(q.run, verifierFor(q));
    const bq = await vq.observe(pq, { repeats: 1 });
    const plan2 = q.plan([
      q.action({ id: "a1", target_resource_id: "issuer", type: "deactivate_test_token", parameters: { token_ref: q.leaked.id } }),
      q.action({ id: "a2", target_resource_id: "depot", type: "select_test_artifact", parameters: { artifact_ref: q.fixedDigest } }),
    ]);
    const x2 = await q.controller().execute(q.lease(plan2, { max_operations: 1 }).token, plan2);
    expect(x2.state).toBe("partially_applied");
    const r2 = await vq.verify({ plan: plan2, execution: x2, probes: pq, before: bq });
    expect(r2.security_verdict).toBe("pass");
    expect(r2.whole_run).toMatchObject({ outcome: "execution_incomplete", success: false });
  });
});
