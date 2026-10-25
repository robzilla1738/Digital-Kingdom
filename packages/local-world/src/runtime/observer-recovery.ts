import { canonicalJson, type RepairExecution, type RepairPlan } from "@dk/contracts";
import { sha256 } from "../catalog.ts";
import { planDigest } from "./lease.ts";
import { EffectVerifier, type ObserveOptions, type VerificationProbe } from "./effects.ts";
import { RunRefusal, type Run } from "./supervisor.ts";

/**
 * li-next B: independent verification of a `restart_test_observer` repair by an OBSERVATION HANDSHAKE.
 *
 * "The controller says applied" and "the observer's revision says up" are self-reports of the supervisor side. Recovery
 * of observation is verified only when a controlled operation, sent after the restart by the verifier identity (its
 * own token: request_route + read_effects, never repair_execute), lands at a resource the restarted observer is
 * declared to observe AND that observer reports the effect for exactly that supervisor-signed operation id.
 *
 * - The handshake operation must be a PERMITTED operation (one that produces an effect). A prohibited operation can
 *   never be a handshake: its absence of an effect would say nothing about whether the observer sees anything.
 * - No handshake probe for a restarted observer ⇒ `unknown`. Any `unknown` answer (observer down again, not attached
 *   to the probe's resource) ⇒ `unknown`. Observer up throughout yet the controlled effect not seen ⇒ `failed`.
 *   Only every handshake observation `observed` ⇒ `restored`; the whole verification is `verified` only when every
 *   restarted observer is restored and the execution completed.
 * - This verifies OBSERVATION, not security: restarting an observer blocks nothing. A prohibited operation that was
 *   open before is still open (and now visible); that is the policy repair's job and its own LP22 verification.
 */
export const OBSERVER_RECOVERY_VERIFICATION = "dk.local.observer_recovery_verification.v1";
export interface ObserverRecoveryInput extends ObserveOptions { plan: RepairPlan; execution: RepairExecution; handshake: VerificationProbe[] }
export interface ObserverRecoveryVerification {
  schema: typeof OBSERVER_RECOVERY_VERIFICATION; run_id: string; plan_id: string; plan_digest: string; verifier_id: string;
  execution: { state: RepairExecution["state"]; receipt_digest: string };
  observers: { observer_id: string; handshake_probes: string[]; outcome: "restored" | "not_restored" | "unknown"; observations: { probe_id: string; repeat: number; operation_id: string; status: number; actual_effect: "observed" | "not_observed" | "unknown"; observation_digest: string; reason: string }[] }[];
  outcome: "verified" | "failed" | "unknown"; success: boolean; reasons: string[];
  basis: string; not_claimed: string[]; scope: "local_run_only";
}

export async function verifyObserverRecovery(run: Run, verifierToken: string, i: ObserverRecoveryInput): Promise<ObserverRecoveryVerification> {
  const verifier = new EffectVerifier(run, verifierToken); // refuses an executor identity (repair_execute)
  const digest = planDigest(i.plan);
  if (i.execution.run_id !== run.run_id || i.execution.plan_digest !== digest) throw new RunRefusal("wrong_run", "the execution receipt is not this run's execution of this plan");
  if (i.execution.controller_id === verifier.verifier_id) throw new RunRefusal("unauthorized", "the verifier identity is the executor's identity");
  const restarted = [...new Set(i.plan.actions.filter((a) => a.type === "restart_test_observer").map((a) => a.target_resource_id))].sort();
  if (!restarted.length) throw new RunRefusal("scope", "the plan restarts no observer; use the LP22 effect verifier for other actions");
  for (const p of i.handshake) {
    if (p.expectation !== "permitted") throw new RunRefusal("scope", `handshake ${p.id}: a handshake must be a permitted operation that produces an effect (absence of a prohibited effect proves nothing about observation)`);
    if (!restarted.includes(p.effect.observer)) throw new RunRefusal("scope", `handshake ${p.id}: ${p.effect.observer} is not an observer this plan restarted`);
  }
  const reasons: string[] = [];
  const observed = i.handshake.length ? await verifier.observe(i.handshake, { repeats: i.repeats ?? 1, settle_ms: i.settle_ms ?? 600 }) : [];
  const declaredOf = (id: string) => run.world.plan.resources.find((r) => r.id === id)?.depends_on ?? [];
  const observers = restarted.map((id) => {
    const mine = observed.filter((o) => o.probe.effect.observer === id);
    const observations = mine.map((o) => ({ probe_id: o.probe.id, repeat: o.repeat, operation_id: o.operation_id, status: o.status, actual_effect: o.answer.status, observation_digest: o.observation_digest, reason: o.answer.reason.slice(0, 1000) }));
    let outcome: "restored" | "not_restored" | "unknown";
    if (!mine.length) { outcome = "unknown"; reasons.push(`${id}: no handshake operation was sent for this observer; a restart without an observed controlled operation is not verified`); }
    else if (mine.some((o) => !declaredOf(id).includes(o.probe.effect.resource))) { outcome = "unknown"; reasons.push(`${id}: a handshake effect lands at a resource the observer is not declared to observe`); }
    else if (mine.some((o) => o.answer.status === "unknown" || o.status === 0 || o.status >= 500)) { outcome = "unknown"; for (const o of mine.filter((x) => x.answer.status === "unknown")) reasons.push(`${id}/${o.probe.id}#${o.repeat}: ${o.answer.reason}`.slice(0, 1000)); }
    else if (mine.every((o) => o.answer.status === "observed" && o.answer.effects.every((e) => e.op_id === o.operation_id))) outcome = "restored";
    else { outcome = "not_restored"; reasons.push(`${id}: the observer was up throughout yet did not report the controlled operation's effect`); }
    return { observer_id: id, handshake_probes: [...new Set(mine.map((o) => o.probe.id))], outcome, observations };
  });
  if (i.execution.state !== "completed") reasons.push(`execution state is ${i.execution.state}`);
  const outcome: ObserverRecoveryVerification["outcome"] = observers.some((o) => o.outcome === "not_restored") ? "failed" : observers.every((o) => o.outcome === "restored") && i.execution.state === "completed" ? "verified" : "unknown";
  return {
    schema: OBSERVER_RECOVERY_VERIFICATION, run_id: run.run_id, plan_id: i.plan.plan_id, plan_digest: digest, verifier_id: verifier.verifier_id,
    execution: { state: i.execution.state, receipt_digest: sha256(canonicalJson(i.execution)) },
    observers, outcome, success: outcome === "verified", reasons: reasons.slice(0, 30),
    basis: "observation handshake: a controlled permitted operation sent after the restart by a separate verifier identity, whose effect the restarted observer reported for the same supervisor-signed operation id; not the controller receipt, the observer's revision or the target's own reports",
    not_claimed: ["Restarting an observer is not a security repair: no prohibited operation is blocked by it.", "Effects that happened while the observer was stopped stay unknown; the restart does not recover them.", "Host-process mode, trusted built-in templates only; not an OS isolation boundary."],
    scope: "local_run_only",
  };
}
