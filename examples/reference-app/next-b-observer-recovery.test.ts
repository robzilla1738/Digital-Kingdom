import { afterEach, describe, expect, it } from "vitest";
import { compileWorld, EffectVerifier, instantiateBlueprint, probeOf, RunRefusal, Supervisor, verifyObserverRecovery, type VerificationProbe } from "@dk/local-world";
import { BUILTIN_SERVICES } from "./src/world/services.ts";
import { repairLab, weakStorefront } from "./repair-lab.ts";

/**
 * li-next B — observer capability state and the restart-test-observer recovery, on real supervisor-owned runs.
 *
 * - The run reports each observer's capability (running / stopped / misconfigured / absent), what it observes and
 *   since when, from the supervisor's own observer objects — never from scenario truth.
 * - A leased `restart_test_observer` action is executed only through the existing lease + typed operation + journal.
 * - Recovery is verified by an independent observation HANDSHAKE: after the restart a controlled probe operation must
 *   be observed by the restarted observer. Success is claimed only when that observation actually arrives.
 * - Stopping an observer never makes a prohibited operation look successfully blocked.
 */
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });
const verifierFor = (t: { sup: { issue: (r: string, s: { resources: "*"; actions: ("request_route" | "read_effects")[] }) => string }; run: { run_id: string } }) => t.sup.issue(t.run.run_id, { resources: "*", actions: ["request_route", "read_effects"] });
const probes = (sessionA: string) => {
  const h = { "x-world-session": sessionA };
  return {
    cross: { id: "cross-tenant-read", expectation: "prohibited", request: { resource: "ingress", method: "GET", path: "/tenants/tenant-b/records", headers: h }, effect: { observer: "audit", resource: "tenant-db" } } as VerificationProbe,
    own: { id: "own-tenant-read", expectation: "permitted", request: { resource: "ingress", method: "GET", path: "/tenants/tenant-a/records", headers: h }, effect: { observer: "audit", resource: "tenant-db" } } as VerificationProbe,
  };
};

describe("next-B: observer capability state from the supervisor", () => {
  it("reports running, stopped (with since and history) and misconfigured observers, and absent ones from the compiled world", async () => {
    const s = await weakStorefront(cleanups, "nb-cap");
    const r0 = s.run.observerCapabilities(s.operatorToken);
    expect(r0.schema).toBe("dk.local.observer_state.v1");
    expect(r0.run_id).toBe(s.run.run_id);
    expect(r0.observers.map((o) => [o.observer_id, o.state, o.declared, o.observes, o.revision])).toEqual([["audit", "running", ["artifacts", "tenant-db"], ["artifacts", "tenant-db"], "audit:observer-up-h1"]]);
    s.run.observer(s.operatorToken, "audit").stop("audit pipeline outage");
    const r1 = s.run.observerCapabilities(s.operatorToken);
    const a1 = r1.observers[0]!;
    expect(a1).toMatchObject({ observer_id: "audit", state: "stopped", observes: [], declared: ["artifacts", "tenant-db"], revision: "audit:observer-down-h2", reason: "audit pipeline outage" });
    expect(Date.parse(a1.since)).toBeGreaterThan(0);
    expect(a1.history.map((h) => h.state)).toEqual(["running", "stopped"]);
    // a misconfiguration: running but detached from a declared resource
    s.run.observer(s.operatorToken, "audit").restart("operator restart");
    s.run.observer(s.operatorToken, "audit").detach("tenant-db", "tap detached from tenant-db");
    const a2 = s.run.observerCapabilities(s.operatorToken).observers[0]!;
    expect(a2).toMatchObject({ state: "misconfigured", observes: ["artifacts"], declared: ["artifacts", "tenant-db"], reason: "tap detached from tenant-db" });
    expect(a2.revision).toBe("audit:observer-misconfigured-h3-c1");
    expect(a2.history.map((h) => h.state)).toEqual(["running", "stopped", "running", "misconfigured"]);
    // capability reports are operator (snapshot) side only: a verifier or controller cannot read them
    expect(() => s.run.observerCapabilities(verifierFor(s))).toThrow(RunRefusal);
    expect(() => s.run.observerCapabilities(s.ctl)).toThrow(RunRefusal);
    // nothing from private truth in the report
    expect(JSON.stringify(s.run.observerCapabilities(s.operatorToken))).not.toMatch(/truth|canary|tenant-b\/records/);
  });

  it("an observer disabled in the compiled world is reported absent (not stopped): it observes nothing and has no revision to restart", async () => {
    const sup = new Supervisor({ services: BUILTIN_SERVICES, labActions: "leased" });
    const inst = instantiateBlueprint("saas-storefront", { seed: "nb-absent" });
    const plan = JSON.parse(JSON.stringify(inst)) as typeof inst;
    const audit = (plan as unknown as { resources: { id: string; settings?: Record<string, unknown> }[] }).resources.find((r) => r.id === "audit")!;
    audit.settings = { ...(audit.settings ?? {}), audit_enabled: false };
    const { run, operatorToken } = await sup.start(compileWorld(plan));
    cleanups.push(async () => { if (run.state === "running") await run.stop(operatorToken); run.cleanup(); });
    const rep = run.observerCapabilities(operatorToken);
    expect(rep.observers.map((o) => [o.observer_id, o.state, o.observes, o.revision])).toEqual([["audit", "absent", [], null]]);
  });
});

describe("next-B: leased restart + independent observation handshake", () => {
  it("restart through the lease/typed op/journal, then a controlled probe must be observed: verified only when the observation arrives", async () => {
    const s = await weakStorefront(cleanups, "nb-restart");
    const pr = probes(s.sessionA);
    s.run.observer(s.operatorToken, "audit").stop("audit pipeline outage");
    const plan = s.plan([s.action({ id: "a1", target_resource_id: "audit", type: "restart_test_observer", parameters: { observer_ref: "audit" } })]);
    expect(plan.actions[0]!.expected_target_revision).toBe("audit:observer-down-h2");
    const exec = await s.controller().execute(s.lease(plan).token, plan);
    expect(exec.state).toBe("completed");
    expect(exec.actions[0]).toMatchObject({ state: "applied", from_revision: "audit:observer-down-h2", to_revision: "audit:observer-up-h3" });
    expect(s.repairOps().map((r) => r.record.type)).toEqual(["restart_test_observer"]);
    const journal = s.run.readJournal(s.ctl).map((e) => e.kind);
    expect(journal).toEqual(expect.arrayContaining(["started", "planned", "applying", "applied", "receipt"]));
    const v = await verifyObserverRecovery(s.run, verifierFor(s), { plan, execution: exec, handshake: [pr.own] });
    expect(v.schema).toBe("dk.local.observer_recovery_verification.v1");
    expect(v.outcome).toBe("verified");
    expect(v.success).toBe(true);
    expect(v.observers).toEqual([expect.objectContaining({ observer_id: "audit", outcome: "restored" })]);
    expect(v.observers[0]!.observations.every((o) => o.actual_effect === "observed" && o.operation_id.length > 0)).toBe(true);
    expect(v.basis).toMatch(/handshake/);
  });

  it("restart with no handshake probe is unknown, never success", async () => {
    const s = await weakStorefront(cleanups, "nb-nohs");
    s.run.observer(s.operatorToken, "audit").stop("outage");
    const plan = s.plan([s.action({ id: "a1", target_resource_id: "audit", type: "restart_test_observer", parameters: { observer_ref: "audit" } })]);
    const exec = await s.controller().execute(s.lease(plan).token, plan);
    expect(exec.state).toBe("completed"); // the controller says applied …
    const v = await verifyObserverRecovery(s.run, verifierFor(s), { plan, execution: exec, handshake: [] });
    expect(v.outcome).toBe("unknown"); // … but nothing was observed, so recovery is not verified
    expect(v.success).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/no handshake/);
  });

  it("a restart whose observer goes down again before the handshake is unknown; a handshake on an unobserved resource is unknown", async () => {
    const s = await weakStorefront(cleanups, "nb-down-again");
    const pr = probes(s.sessionA);
    s.run.observer(s.operatorToken, "audit").stop("outage");
    const plan = s.plan([s.action({ id: "a1", target_resource_id: "audit", type: "restart_test_observer", parameters: { observer_ref: "audit" } })]);
    const exec = await s.controller().execute(s.lease(plan).token, plan);
    s.run.observer(s.operatorToken, "audit").stop("crashed again");
    const v = await verifyObserverRecovery(s.run, verifierFor(s), { plan, execution: exec, handshake: [pr.own] });
    expect(v.outcome).toBe("unknown");
    expect(v.success).toBe(false);
    // the handshake must land where the restarted observer is declared to observe
    const s2 = await weakStorefront(cleanups, "nb-wrong-res");
    s2.run.observer(s2.operatorToken, "audit").stop("outage");
    const p2 = s2.plan([s2.action({ id: "a1", target_resource_id: "audit", type: "restart_test_observer", parameters: { observer_ref: "audit" } })]);
    const e2 = await s2.controller().execute(s2.lease(p2).token, p2);
    const off = { ...probes(s2.sessionA).own, effect: { observer: "audit", resource: "queue" } };
    const v2 = await verifyObserverRecovery(s2.run, verifierFor(s2), { plan: p2, execution: e2, handshake: [off] });
    expect(v2.outcome).toBe("unknown");
    // a prohibited operation cannot serve as a handshake (its absence would prove nothing)
    await expect(verifyObserverRecovery(s2.run, verifierFor(s2), { plan: p2, execution: e2, handshake: [probes(s2.sessionA).cross] })).rejects.toThrow(/permitted/);
    // the executor cannot verify its own restart
    await expect(verifyObserverRecovery(s2.run, s2.ctl, { plan: p2, execution: e2, handshake: [off] })).rejects.toBeInstanceOf(RunRefusal);
  });

  it("a misconfigured (detached) observer is restored by the restart: reattached, then the handshake is observed", async () => {
    const s = await weakStorefront(cleanups, "nb-misconf");
    const pr = probes(s.sessionA);
    s.run.observer(s.operatorToken, "audit").detach("tenant-db", "tap detached");
    const plan = s.plan([s.action({ id: "a1", target_resource_id: "audit", type: "restart_test_observer", parameters: { observer_ref: "audit" } })]);
    const exec = await s.controller().execute(s.lease(plan).token, plan);
    expect(exec.state).toBe("completed");
    expect(s.run.observerCapabilities(s.operatorToken).observers[0]!.state).toBe("running");
    const v = await verifyObserverRecovery(s.run, verifierFor(s), { plan, execution: exec, handshake: [pr.own] });
    expect(v.outcome).toBe("verified");
  });
});

describe("next-B negative: absence of observation is never 'blocked'", () => {
  it("with the observer stopped, the still-open prohibited read is unknown/inconclusive — never not_observed, never as_expected", async () => {
    const s = await weakStorefront(cleanups, "nb-neg-open");
    const pr = probes(s.sessionA);
    s.run.observer(s.operatorToken, "audit").stop("outage");
    const v = new EffectVerifier(s.run, verifierFor(s));
    const obs = await v.observe([pr.cross], { repeats: 2, settle_ms: 200 });
    expect(obs.map((o) => o.status)).toEqual([200, 200]); // the weak API really served the cross-tenant read
    expect(obs.map((o) => o.answer.status)).toEqual(["unknown", "unknown"]);
    for (const o of obs) expect(probeOf({ operation_id: o.operation_id, expectation: "prohibited", answer: o.answer, evidence_refs: [], status: o.status }).result).toBe("inconclusive");
  });

  it("a policy repair verified while the observer is stopped is inconclusive, not pass", async () => {
    const s = await weakStorefront(cleanups, "nb-neg-repair");
    const pr = probes(s.sessionA);
    const v = new EffectVerifier(s.run, verifierFor(s));
    const before = await v.observe([pr.cross, pr.own], { repeats: 1 });
    const plan = s.plan([s.action({ id: "a1", target_resource_id: "api", type: "set_gateway_policy", parameters: { policy_ref: "policy:baseline" } })]);
    const exec = await s.controller().execute(s.lease(plan).token, plan);
    s.run.observer(s.operatorToken, "audit").stop("outage after the repair");
    const r = await v.verify({ plan, execution: exec, probes: [pr.cross, pr.own], before, settle_ms: 200 });
    expect(r.security_verdict).not.toBe("pass");
    expect(r.whole_run.success).toBe(false);
    expect(r.verification_receipt.probes.some((p) => p.result === "as_expected" && p.expectation === "prohibited")).toBe(false);
  });

  it("restarting an observer is not a security repair: the handshake verifies observation only, and the prohibited read stays observed", async () => {
    const s = await weakStorefront(cleanups, "nb-neg-only-obs");
    const pr = probes(s.sessionA);
    s.run.observer(s.operatorToken, "audit").stop("outage");
    const plan = s.plan([s.action({ id: "a1", target_resource_id: "audit", type: "restart_test_observer", parameters: { observer_ref: "audit" } })]);
    const exec = await s.controller().execute(s.lease(plan).token, plan);
    const v = await verifyObserverRecovery(s.run, verifierFor(s), { plan, execution: exec, handshake: [pr.own] });
    expect(v.outcome).toBe("verified");
    expect(v.not_claimed.join(" ")).toMatch(/not a security repair/i);
    const after = await new EffectVerifier(s.run, verifierFor(s)).observe([pr.cross], { repeats: 1 });
    expect(after[0]!.answer.status).toBe("observed"); // the defect is still there and is now visible
  });
});
