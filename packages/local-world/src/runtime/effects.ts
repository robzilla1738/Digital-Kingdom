import { randomBytes } from "node:crypto";
import { canonicalJson, validateRepairVerification, type HttpMethod, type RepairExecution, type RepairPlan, type RepairVerification, type VerificationReceipt } from "@dk/contracts";
import { sha256 } from "../catalog.ts";
import { identityRef, planDigest } from "./lease.ts";
import type { EffectAnswer } from "./observer.ts";
import { monoMs, RunRefusal, type Run } from "./supervisor.ts";
import { probeOf, verificationReceipt } from "./verify.ts";

/**
 * LP22: verify a local repair's EFFECTS independently of whoever executed it.
 *
 * "The API said 200" and "the controller says applied" are not defense. The verifier:
 * - holds its own run identity (request_route + read_effects; never `repair_execute`, never the controller's token)
 *   and reads effects only from the run's registered independent OBSERVERS (template `observer`), never from the
 *   target's own reports, the controller's receipt or response bodies;
 * - sends each probe as a fresh supervisor operation (unique, signed operation id) with a per-probe nonce, and
 *   correlates effects by operation id only, so concurrent unrelated operations are never attributed to a probe and
 *   delayed effects (e.g. a background worker acting for a queued job) are attributed to the operation that caused
 *   them once they land;
 * - settles within a bounded window (monotonic clock, 200 ms–5 s, background work ticked), repeats every probe
 *   (repeated health checks of the positive controls) and digests every observation;
 * - maps an unavailable or partial observer to `unknown` → `inconclusive`, never to "not observed" and never to pass;
 * - compares with a pre-repair baseline when one is given (an action whose target behaves as before fails; a
 *   baseline that never showed the prohibited effect cannot support a pass);
 * - keeps the security verdict, the execution state and the cleanup outcome separate, and reports whole-run success
 *   only when all three are good. Residual access (prohibited effects still observed) and disruption (permitted
 *   operations broken) are listed by probe.
 */
export const EFFECT_VERIFY_LIMITS = { min_settle_ms: 200, max_settle_ms: 5_000, max_repeats: 5, max_probes: 20 } as const;
export interface VerificationProbe {
  id: string; expectation: "prohibited" | "permitted";
  request: { resource: string; method: HttpMethod; path: string; headers?: Record<string, string>; body?: unknown };
  /** Where the effect would land, and which independent observer must report it. */
  effect: { observer: string; resource: string };
}
export interface VerifyInput { plan: RepairPlan; execution: RepairExecution; probes: VerificationProbe[]; before?: Observation[] | null; unassessed_paths?: string[] }
export interface ObserveOptions { repeats?: number; settle_ms?: number; concurrently?: () => Promise<unknown> }
export interface Observation { probe: VerificationProbe; repeat: number; operation_id: string; nonce_digest: string; status: number; answer: EffectAnswer; settled_ms: number; observation_digest: string; evidence_ref: string }

const PROBE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export class EffectVerifier {
  readonly verifier_id: string;
  private readonly asController: string;
  constructor(private readonly run: Run, private readonly token: string) {
    // describeToken requires read_effects; a controller identity (repair_execute only) is refused here
    let d: ReturnType<Run["describeVerifier"]>;
    try { d = run.describeVerifier(token); } catch (e) { throw new RunRefusal("unauthorized", `verifier identity refused: ${(e as Error).message}`); }
    if (d.actions.includes("repair_execute")) throw new RunRefusal("unauthorized", "a verifier must not hold repair_execute: the executor cannot verify its own effects");
    if (!d.actions.includes("request_route")) throw new RunRefusal("scope", "a verifier needs request_route to send its probes");
    this.verifier_id = identityRef("vrf", d.id);
    this.asController = identityRef("ctl", d.id);
  }

  /** Send every probe `repeats` times and read the independent observers' per-operation answers. */
  async observe(probes: VerificationProbe[], o: ObserveOptions = {}): Promise<Observation[]> {
    const repeats = o.repeats ?? 2, settle = o.settle_ms ?? 600;
    if (!Number.isInteger(repeats) || repeats < 1 || repeats > EFFECT_VERIFY_LIMITS.max_repeats) throw new RunRefusal("scope", `repeats must be 1 to ${EFFECT_VERIFY_LIMITS.max_repeats}`);
    if (!Number.isInteger(settle) || settle < EFFECT_VERIFY_LIMITS.min_settle_ms || settle > EFFECT_VERIFY_LIMITS.max_settle_ms) throw new RunRefusal("scope", `settle_ms must be ${EFFECT_VERIFY_LIMITS.min_settle_ms} to ${EFFECT_VERIFY_LIMITS.max_settle_ms} (a shorter window could miss delayed effects and pass falsely)`);
    if (!probes.length || probes.length > EFFECT_VERIFY_LIMITS.max_probes || new Set(probes.map((p) => p.id)).size !== probes.length || probes.some((p) => !PROBE_ID.test(p.id))) throw new RunRefusal("scope", `1 to ${EFFECT_VERIFY_LIMITS.max_probes} probes with unique plain ids`);
    for (const p of probes) {
      const obs = this.run.world.plan.resources.find((r) => r.id === p.effect.observer);
      if (!obs || obs.template !== "observer") throw new RunRefusal("unregistered", `probe ${p.id}: ${p.effect.observer} is not an independent observer of this run (a target's own reports cannot verify it)`);
    }
    const out: Observation[] = [];
    for (let rep = 0; rep < repeats; rep++) for (const p of probes) out.push(await this.one(p, rep, settle, o.concurrently));
    return out;
  }

  private async one(p: VerificationProbe, repeat: number, settle: number, concurrently?: () => Promise<unknown>): Promise<Observation> {
    const nonce = randomBytes(16).toString("hex");
    let status = 0, op_id = "", from = monoMs(), to = from;
    try {
      const [r] = await Promise.all([
        this.run.request(this.token, { resource: p.request.resource, method: p.request.method, path: p.request.path, headers: { ...(p.request.headers ?? {}), "x-world-probe-nonce": nonce }, ...(p.request.body !== undefined ? { body: p.request.body } : {}) }),
        concurrently ? concurrently().catch(() => undefined) : Promise.resolve(undefined),
      ]);
      status = r.status; op_id = r.op_id; from = r.started_mono_ms; to = r.ended_mono_ms;
    } catch (e) {
      if (!(e instanceof RunRefusal)) throw e;
      op_id = `refused-${sha256(nonce).slice(0, 12)}`;
    }
    // bounded settling: background work is ticked; stop early only once the effect is seen
    const start = monoMs();
    let answer: EffectAnswer = { status: "unknown", effects: [], observer: p.effect.observer, reason: "probe request was refused before reaching the run", health: [] };
    if (status !== 0) {
      for (;;) {
        await this.run.settleFor(this.token, 1);
        const waited = monoMs() - start;
        answer = this.run.observerAnswer(this.token, p.effect.observer, op_id, { from_mono_ms: from, to_mono_ms: to }, p.effect.resource, waited);
        if (answer.status === "observed" || waited >= settle) break;
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    const settled_ms = Math.max(0, Math.round(monoMs() - start));
    const observation_digest = sha256(canonicalJson({ op_id, observer: answer.observer, status: answer.status, effects: answer.effects.map((e) => ({ op: e.op_id, resource: e.resource_id, revision: e.resource_revision, action: e.action, detail: e.detail })), down: answer.health.filter((h) => h.state === "down").map((h) => h.reason) }));
    const evidence_ref = answer.status === "observed" ? `obs-${observation_digest.slice(0, 16)}` : answer.status === "not_observed" ? `health-${observation_digest.slice(0, 16)}` : `unknown-${observation_digest.slice(0, 16)}`;
    return { probe: p, repeat, operation_id: op_id, nonce_digest: sha256(nonce), status, answer, settled_ms, observation_digest, evidence_ref };
  }

  /**
   * Verify an executed plan. `before` is an observation of the same probes taken before execution (strongly
   * recommended); without it the unchanged-behavior check is listed as unassessed.
   */
  async verify(i: VerifyInput & ObserveOptions): Promise<RepairVerification> {
    const digest = planDigest(i.plan);
    if (i.execution.run_id !== this.run.run_id || i.execution.plan_digest !== digest) throw new RunRefusal("wrong_run", "the execution receipt is not this run's execution of this plan");
    if (i.execution.controller_id === this.asController || i.execution.controller_id === this.verifier_id) throw new RunRefusal("unauthorized", "the verifier identity is the executor's identity");
    if (!i.probes.some((p) => p.expectation === "prohibited") || !i.probes.some((p) => p.expectation === "permitted")) throw new RunRefusal("scope", "verification needs at least one prohibited operation and one permitted operation (positive control)");
    const observed = await this.observe(i.probes, i);
    const v = assemble({ run: this.run, plan: i.plan, digest, execution: i.execution, verifier_id: this.verifier_id, probes: i.probes, observed, before: i.before ?? null, unassessed: i.unassessed_paths ?? [] });
    this.made.set(v, { observed, input: i });
    return v;
  }
  /**
   * Re-evaluate cleanup and whole-run success after the run owner stopped and cleaned the run. Uses only the
   * observations this verifier made (no new probes; the run is gone) and the run's own cleanup record.
   */
  finalize(v: RepairVerification): RepairVerification {
    const m = this.made.get(v);
    if (!m) throw new RunRefusal("scope", "not a verification made by this verifier");
    const out = assemble({ run: this.run, plan: m.input.plan, digest: v.plan_digest, execution: m.input.execution, verifier_id: this.verifier_id, probes: m.input.probes, observed: m.observed, before: m.input.before ?? null, unassessed: m.input.unassessed_paths ?? [] });
    this.made.set(out, m);
    return out;
  }
  private readonly made = new WeakMap<RepairVerification, { observed: Observation[]; input: VerifyInput }>();
}

interface AssembleInput { run: Run; plan: RepairPlan; digest: string; execution: RepairExecution; verifier_id: string; probes: VerificationProbe[]; observed: Observation[]; before: Observation[] | null; unassessed: string[] }
function cleanupOf(run: Run): VerificationReceipt["cleanup"] {
  const c = run.cleanupRecord;
  if (c.outcome === "pending") return { outcome: "pending", notes: `run ${run.state}; cleanup has not run yet` };
  return { outcome: c.outcome, notes: c.failures.map((f) => `${f.path}: ${f.reason}`).join("; ").slice(0, 2000) || `removed ${c.removed.length} owned path(s)` };
}
const testedRevision = (run: Run, plan: RepairPlan) => {
  const targets = [...new Set(plan.actions.map((a) => a.target_resource_id))];
  const revs = targets.map((t) => { try { return run.revisionOf(t); } catch { return `${t}:gone`; } });
  return revs.length === 1 && revs[0]!.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(revs[0]!) ? revs[0]! : `targets-${sha256(revs.join("|")).slice(0, 24)}`;
};

function assemble(i: AssembleInput): RepairVerification {
  const reasons: string[] = [];
  const probes = i.observed.map((o) => probeOf({ operation_id: o.operation_id, expectation: o.probe.expectation, answer: o.answer, evidence_refs: o.answer.status === "unknown" ? [] : [o.evidence_ref], status: o.status }));
  const unassessed = [...i.unassessed];
  // baseline comparison
  let baselineBlocksPass = false;
  if (i.before) {
    for (const p of i.probes) {
      const b = i.before.filter((o) => o.probe.id === p.id).map((o) => o.answer.status);
      const a = i.observed.filter((o) => o.probe.id === p.id).map((o) => o.answer.status);
      if (!b.length) { unassessed.push(`no baseline for probe ${p.id}`); baselineBlocksPass = true; continue; }
      if (b.includes("unknown")) { reasons.push(`baseline for ${p.id} is unknown (observer unavailable before the repair)`); baselineBlocksPass = true; }
      if (p.expectation === "prohibited" && !b.includes("observed") && !b.includes("unknown")) { reasons.push(`baseline never showed the prohibited effect of ${p.id}; a pass would prove nothing about the repair`); baselineBlocksPass = true; }
      if (p.expectation === "prohibited" && b.includes("observed") && a.includes("observed")) reasons.push(`target behavior unchanged for ${p.id}: the prohibited effect is observed before and after the accepted action`);
      if (p.expectation === "permitted" && b.some((x) => x !== "observed")) { reasons.push(`positive control ${p.id} was not working before the repair; disruption cannot be attributed`); baselineBlocksPass = true; }
    }
  } else unassessed.push("no pre-repair baseline: the unchanged-behavior check was not performed");
  for (const o of i.observed) if (o.answer.status === "unknown") reasons.push(`${o.probe.id}#${o.repeat}: ${o.answer.reason}`.slice(0, 1000));
  const residual = [...new Set(i.observed.filter((o) => o.probe.expectation === "prohibited" && o.answer.status === "observed").map((o) => o.probe.id))];
  const disruption = [...new Set(i.observed.filter((o) => o.probe.expectation === "permitted" && (o.answer.status === "not_observed" || (o.status >= 400 && o.status < 500))).map((o) => o.probe.id))];
  if (residual.length) reasons.push(`residual access: prohibited effect still observed for ${residual.join(", ")}`);
  if (disruption.length) reasons.push(`disruption: permitted operation broken for ${disruption.join(", ")} (blocking the prohibited behaviour by breaking legitimate behaviour is not a verified repair)`);
  const tested = testedRevision(i.run, i.plan);
  const executed = i.execution.actions.map((a) => a.to_revision).filter((x): x is string => !!x);
  const targetMoved = i.plan.actions.length === 1 && executed.length === 1 && executed[0] !== tested;
  if (targetMoved) { reasons.push(`the tested target revision ${tested} is not the executed revision ${executed[0]}`); baselineBlocksPass = true; }
  const cleanup = cleanupOf(i.run);
  let receipt = verificationReceipt({ run_id: i.run.run_id, plan_id: i.plan.plan_id, tested_target_revision: tested, probes, cleanup, unassessed_paths: unassessed.slice(0, 100) });
  if (receipt.security_verdict === "pass" && baselineBlocksPass) receipt = { ...receipt, security_verdict: "inconclusive", overall_outcome: "inconclusive" };
  const sv = receipt.security_verdict;
  const cleanOk = cleanup.outcome === "completed" || cleanup.outcome === "not_needed";
  const outcome: RepairVerification["whole_run"]["outcome"] = sv === "refused" ? "refused" : i.execution.state !== "completed" ? "execution_incomplete" : sv === "fail" ? "security_failed" : sv === "inconclusive" ? "inconclusive" : !cleanOk ? (cleanup.outcome === "pending" ? "cleanup_pending" : "cleanup_failed") : "success";
  if (i.execution.state !== "completed") reasons.push(`execution state is ${i.execution.state}`);
  if (sv === "pass" && cleanup.outcome === "failed") reasons.push(`security assertion passed but cleanup failed: ${cleanup.notes}`.slice(0, 1000));
  if (sv === "pass" && cleanup.outcome === "pending") reasons.push("security assertion passed; cleanup has not run yet");
  const v: RepairVerification = {
    schema: "dk.local.repair_verification.v1", run_id: i.run.run_id, plan_id: i.plan.plan_id, plan_digest: i.digest,
    execution: { state: i.execution.state, receipt_digest: sha256(canonicalJson(i.execution)) }, verifier_id: i.verifier_id,
    independence: { verifier_is_executor: false, observers: [...new Set(i.probes.map((p) => p.effect.observer))].sort(), basis: "effects read only from registered observer resources of this run, correlated by supervisor-signed operation id; not from target self-reports, response bodies or the execution receipt" },
    observations: i.observed.map((o) => ({ probe_id: o.probe.id, repeat: o.repeat, operation_id: o.operation_id, nonce_digest: o.nonce_digest, observation_digest: o.observation_digest, status: o.status, actual_effect: o.answer.status, observer: o.answer.observer, settled_ms: o.settled_ms, reason: o.answer.reason.slice(0, 1000) })),
    before: i.before ? i.before.filter((o) => o.repeat === 0).map((o) => ({ probe_id: o.probe.id, actual_effect: o.answer.status })) : null,
    residual_access: residual, disruption, security_verdict: sv, verification_receipt: receipt, cleanup,
    whole_run: { outcome, success: outcome === "success", reasons: reasons.slice(0, 30) }, scope: "local_run_only",
  };
  const vv = validateRepairVerification(v);
  if (!vv.ok) throw new Error(`repair verification invalid: ${vv.errors.join("; ")}`);
  return v;
}
