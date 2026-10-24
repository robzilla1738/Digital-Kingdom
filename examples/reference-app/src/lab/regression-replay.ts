import { checkRegression, compileWorld, EffectVerifier, instantiateBlueprint, RepairController, type RegressionTools, regressionValidity, Supervisor, type RepairRegression, type RepairVerification, type VerificationProbe } from "@dk/local-world";
import { BUILTIN_SERVICES, syntheticPassword } from "../world/services.ts";

/**
 * LP23 replay of a `dk.local.repair_regression.v1` descriptor. No model, no network beyond the run's own 127.0.0.1
 * listeners, no executable content: the descriptor is data. Steps, each in a FRESH disposable supervisor-owned run:
 *  1. validate (schema, semantics, digest, leak scan) and check the pinned versions against the world compiled now
 *     (stale versions are reported, never replayed as if current);
 *  2. rebuild the world from blueprint + public seed, apply the typed defect prerequisite, sign the synthetic
 *     principals in (sessions exist only inside the run);
 *  3. baseline: every probe once through an independent verifier — the descriptor's expected baseline must reproduce
 *     (prohibited effect observed, positive control working);
 *  4. without repair: the prohibited effect is observed again (the regression is sensitive to the defect);
 *  5. with repair: the typed actions run under a fresh supervisor lease held by a separate controller identity, then a
 *     fresh verifier checks every probe (repeated) against the baseline; the run is stopped and cleaned and the
 *     verification finalized, so whole-run success includes cleanup.
 * `reproduced` is true only when baseline, without-repair and after-repair all match the descriptor.
 */
export interface ReplayResult {
  regression_id: string; descriptor_digest: string; llm: "not_used";
  validity: { status: "valid" | "stale"; changed: string[] };
  baseline: { matches: boolean; observed: { probe_id: string; actual_effect: string }[] };
  without_repair: { prohibited_observed: boolean };
  after_repair: { security_verdict: RepairVerification["security_verdict"]; whole_run: RepairVerification["whole_run"]["outcome"]; residual_access: string[]; disruption: string[]; revisions_match: boolean } | null;
  reproduced: boolean; reasons: string[];
}

export async function replayRegression(descriptor: unknown, o: { tools?: Partial<RegressionTools> } = {}): Promise<ReplayResult> {
  const chk = checkRegression(descriptor);
  if (!chk.ok) throw new Error(`regression refused: ${chk.errors.join("; ")}`);
  const d: RepairRegression = chk.value;
  const world = compileWorld(instantiateBlueprint(d.world.blueprint, { seed: d.world.seed }));
  const validity = regressionValidity(d, { world, ...(o.tools ? { tools: o.tools } : {}) });
  const base = { regression_id: d.regression_id, descriptor_digest: d.descriptor_digest, llm: "not_used" as const, validity };
  if (validity.status === "stale") return { ...base, baseline: { matches: false, observed: [] }, without_repair: { prohibited_observed: false }, after_repair: null, reproduced: false, reasons: [`stale: ${validity.changed.join(", ")}; the earlier validation does not apply to the current versions`] };

  const sup = new Supervisor({ services: BUILTIN_SERVICES, labActions: "leased" });
  const { run, operatorToken } = await sup.start(world);
  const reasons: string[] = [];
  try {
    for (const dft of d.prerequisites.defect) run.configure(operatorToken, dft.resource_id, { policy_variant: dft.value });
    const headers = new Map<string, Record<string, string>>();
    for (const p of d.prerequisites.principals) {
      const r = await run.request(operatorToken, { resource: "ingress", method: "POST", path: "/login", headers: {}, body: { account: p.account, password: syntheticPassword(run.world, p.account) } });
      const session = (r.body as { session?: string } | undefined)?.session;
      if (r.status !== 200 || !session) throw new Error(`principal ${p.ref} could not sign in to the synthetic world`);
      headers.set(p.ref, { "x-world-session": session });
    }
    const probes: VerificationProbe[] = d.probes.map((p) => ({ id: p.id, expectation: p.expectation, request: { resource: p.request.resource, method: p.request.method, path: p.request.path, headers: headers.get(p.request.principal)! }, effect: { ...p.effect } }));
    const vtok = () => sup.issue(run.run_id, { resources: "*", actions: ["request_route", "read_effects"] });
    const v = new EffectVerifier(run, vtok());
    const before = await v.observe(probes, { repeats: 1 });
    const observed = before.map((b) => ({ probe_id: b.probe.id, actual_effect: b.answer.status }));
    const want = new Map(d.expected.baseline.map((b) => [b.probe_id, b.actual_effect]));
    const matches = observed.every((x) => want.get(x.probe_id) === x.actual_effect);
    if (!matches) reasons.push("baseline did not reproduce: the defect or the positive control behaves differently than when the regression was captured");
    const again = await new EffectVerifier(run, vtok()).observe(probes.filter((p) => p.expectation === "prohibited"), { repeats: 1 });
    const prohibitedObserved = again.every((x) => x.answer.status === "observed");
    if (!prohibitedObserved) reasons.push("without the repair the prohibited effect was not observed: the regression is not sensitive to the defect here");

    const revisionsMatch = d.repair.actions.every((a) => run.revisionOf(a.target_resource_id) === a.expected_target_revision);
    if (!revisionsMatch) reasons.push("a repair target's revision differs from the pinned revision; the typed action would be refused as stale");
    const plan = {
      schema: "dk.local.repair_plan.v1" as const, plan_id: `replay-${d.regression_id}`, run_id: run.run_id, case_id: "regression-replay", baseline_digest: d.world.plan_digest, candidate_digest: d.linkage.plan_digest,
      actions: d.repair.actions.map((a) => ({ id: a.action_id, target_resource_id: a.target_resource_id, type: a.type, parameters: { ...a.parameters }, expected_target_revision: run.revisionOf(a.target_resource_id) })),
      verification_test_ids: d.probes.filter((p) => p.control === "negative").map((p) => p.id), positive_control_ids: d.probes.filter((p) => p.control === "positive").map((p) => p.id),
      residual_unknowns: [], authority: "plan_only" as const, expires_at: new Date(Date.now() + 600_000).toISOString(),
    };
    const op = sup.operatorCredential();
    const ctl = sup.issueControllerToken(op, run.run_id);
    const lease = sup.issueLease(op, { run_id: run.run_id, plan, controller_token: ctl });
    const exec = await new RepairController(run, ctl).execute(lease.token, plan as never);
    let r = await v.verify({ plan: plan as never, execution: exec, probes, before });
    await run.stop(operatorToken); run.cleanup();
    r = v.finalize(r);
    const after = { security_verdict: r.security_verdict, whole_run: r.whole_run.outcome, residual_access: r.residual_access, disruption: r.disruption, revisions_match: revisionsMatch };
    if (r.security_verdict !== d.expected.after_repair.security_verdict || r.whole_run.outcome !== d.expected.after_repair.whole_run) reasons.push(`after repair: ${r.security_verdict} / ${r.whole_run.outcome}, expected pass / success`);
    return { ...base, baseline: { matches, observed }, without_repair: { prohibited_observed: prohibitedObserved }, after_repair: after, reproduced: reasons.length === 0, reasons };
  } finally {
    if (run.state === "running" || run.state === "paused") await run.stop(operatorToken);
    if (run.state === "stopped" || run.state === "aborted") { try { run.cleanup(); } catch { /* cleanup outcome is reported by the run */ } }
  }
}
