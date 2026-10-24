/**
 * li-next B — the observer-recovery leg of the local loop (no model call, 127.0.0.1 only, synthetic data only).
 *
 * In ONE leased LW-01 world (the storefront scenario that already contains an audit-observer outage):
 *   the launcher stops the run's audit observer (fault injection on the supervisor side) → the supervisor's observer
 *   capability state (dk.local.observer_state.v1) is reported to Digital Kingdom → LP14 generates candidates for the
 *   case objective "the audit observer gap must not hold; tenant-a's own read must keep working" → the rank-1 generated
 *   plan (restart-supervised-observer, typed restart_test_observer), unmodified, is leased and executed by the
 *   RepairController → an independent verifier runs the OBSERVATION HANDSHAKE (a controlled tenant-a read must be
 *   reported by the restarted observer for its own operation id) → the post-restart observer state is reported and the
 *   model agrees no observer repair is needed.
 *
 * It also records the negative control: while the observer is stopped, a cross-tenant read probe is `unknown`, never
 * `not_observed` — absence of an observation is not evidence that anything was blocked.
 *
 * Kept separate from the LP31 integrated loop so that loop's stages, baseline digests and receipt stay unchanged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { canonicalJson, EffectVerifier, RepairController, verifyObserverRecovery, type VerificationProbe } from "../../packages/local-world/src/index.ts";
import type { RepairPlan } from "../../packages/contracts/src/index.ts";
import { startLocalCase, type LocalCase } from "./controller.ts";

const ROOT = join(import.meta.dirname, "../..");
const sha = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : canonicalJson(v)).digest("hex");

export interface ObserverLoopStage { stage: string; outcome: string; detail: Record<string, unknown> }
export interface ObserverLoopReceipt { schema: "dk.local.observer_recovery_loop_receipt.v1"; run_id: string | null; stages: ObserverLoopStage[]; ok: boolean; model: { used: false; spend_usd: 0 }; scope: "local_only_synthetic"; limitations: string[] }

export async function runObserverRecoveryLoop(): Promise<ObserverLoopReceipt> {
  const stages: ObserverLoopStage[] = [];
  const add = (s: ObserverLoopStage) => { stages.push(s); return s; };
  let c: LocalCase | null = null;
  let runId: string | null = null;
  try {
    const doc = JSON.parse(readFileSync(join(ROOT, "scenarios/local-world/dsl/LW-01.scenario.json"), "utf8"));
    c = await startLocalCase(doc, { lab: "leased", guided: false });
    const w = c.private.world, run = w.run, lab = c.private.lab!;
    runId = run.run_id;
    c.revokeInvestigator();
    const P = `/api/projects/${c.public.project}`;
    const sessionA = await w.login("acct:tenant-a:user");
    const h = { "x-world-session": sessionA };
    const own: VerificationProbe = { id: "own-tenant-read", expectation: "permitted", request: { resource: "ingress", method: "GET", path: "/tenants/tenant-a/records", headers: h }, effect: { observer: "audit", resource: "tenant-db" } };
    const cross: VerificationProbe = { id: "cross-tenant-read", expectation: "prohibited", request: { resource: "ingress", method: "GET", path: "/tenants/tenant-b/records", headers: h }, effect: { observer: "audit", resource: "tenant-db" } };
    const verifierToken = w.supervisor.issue(run.run_id, { resources: "*", actions: ["request_route", "read_effects"] });

    // 1. supervisor-side fault: the run's audit observer stops; its capability state is reported (operator side)
    run.observer(w.operatorToken, "audit").stop("observer-recovery loop: audit observer outage");
    const rep = run.observerCapabilities(w.operatorToken);
    const posted = await c.adminApi("POST", `${P}/local-observers`, rep);
    const cfg = await c.adminApi("POST", `${P}/local-configuration`, run.configuration(w.operatorToken));
    add({ stage: "observer_state_reported", outcome: posted.status === 200 ? rep.observers.map((o) => `${o.observer_id}:${o.state}`).join(",") : `http_${posted.status}`, detail: { run_id: run.run_id, http: posted.status, config_http: cfg.status, observers: rep.observers.map((o) => ({ id: o.observer_id, state: o.state, observes: o.observes, declared: o.declared, revision: o.revision })) } });

    // negative control: absence of observation is not "blocked"
    const neg = await new EffectVerifier(run, verifierToken).observe([cross], { repeats: 1, settle_ms: 200 });
    add({ stage: "negative_absence_is_not_blocked", outcome: neg.every((o) => o.answer.status === "unknown") ? "unknown_as_required" : `UNEXPECTED_${neg.map((o) => o.answer.status).join(",")}`, detail: { run_id: run.run_id, http: neg.map((o) => o.status), actual_effect: neg.map((o) => o.answer.status) } });

    // 2. LP14 candidates for the observer-gap objective, on the same case
    const objective = { prohibited: [{ id: "audit-observer-gap", kind: "observer_gap", source_id: "audit" }], permitted: [{ id: "own-tenant-read", kind: "tenant_access", from: "ingress", to: "tenant-db", tenant: "tenant-a", target_tenant: "tenant-a" }] };
    const st = await c.adminApi("GET", `${P}/analysis/state`);
    const gen = await c.adminApi("POST", `${P}/cases/${c.public.case_id}/repairs`, { base_state_hash: st.json?.state_hash, objective });
    type Cand = { candidate_id: string; rank: number; valid: boolean; template: { id: string }; plan: RepairPlan };
    const cands = (gen.json?.candidates ?? []) as Cand[];
    const chosen = cands.find((x) => x.valid && x.rank === 1) ?? null;
    add({ stage: "observer_candidates", outcome: gen.status === 200 ? `${String(gen.json.status)}:${chosen?.template.id ?? "none"}` : `http_${gen.status}`, detail: { run_id: run.run_id, candidates: cands.map((x) => ({ id: x.candidate_id, rank: x.rank, valid: x.valid, template: x.template.id, actions: x.plan.actions.map((a) => `${a.type}@${a.target_resource_id} ${a.expected_target_revision}`) })), plan_digest: chosen ? sha(chosen.plan) : null } });
    if (!chosen || chosen.template.id !== "restart-supervised-observer") throw new Error("no rank-1 restart-supervised-observer candidate");

    // 3. lease → typed restart through the controller (journal) in the SAME run
    const ctl = w.supervisor.issueControllerToken(lab.operator, run.run_id);
    const lease = w.supervisor.issueLease(lab.operator, { run_id: run.run_id, plan: chosen.plan, controller_token: ctl });
    const execution = await new RepairController(run, ctl).execute(lease.token, chosen.plan);
    add({ stage: "leased_restart", outcome: execution.state, detail: { run_id: execution.run_id, lease_id: lease.lease.lease_id, plan_digest: sha(chosen.plan), plan_source: "LP14 generated candidate (rank 1), unmodified", actions: execution.actions.map((a) => `${a.state} ${a.from_revision} -> ${a.to_revision}`) } });

    // 4. independent observation handshake
    const hs = await verifyObserverRecovery(run, verifierToken, { plan: chosen.plan, execution, handshake: [own] });
    add({ stage: "observation_handshake", outcome: hs.outcome, detail: { run_id: hs.run_id, success: hs.success, observers: hs.observers.map((o) => ({ id: o.observer_id, outcome: o.outcome, effects: o.observations.map((x) => x.actual_effect) })), reasons: hs.reasons, basis: hs.basis } });

    // 5. the model agrees after the restart
    const rep2 = run.observerCapabilities(w.operatorToken);
    await c.adminApi("POST", `${P}/local-observers`, rep2);
    const st2 = await c.adminApi("GET", `${P}/analysis/state`);
    const gen2 = await c.adminApi("POST", `${P}/cases/${c.public.case_id}/repairs`, { base_state_hash: st2.json?.state_hash, objective });
    add({ stage: "post_restart_model_check", outcome: gen2.status === 200 ? String(gen2.json.status) : `http_${gen2.status}`, detail: { run_id: run.run_id, observers: rep2.observers.map((o) => `${o.observer_id}:${o.state}`) } });
  } catch (e) {
    add({ stage: "error", outcome: "failed", detail: { message: String((e as Error).message).slice(0, 500) } });
  } finally {
    await c?.stop();
  }
  const want: Record<string, (o: string) => boolean> = {
    observer_state_reported: (o) => o === "audit:stopped", negative_absence_is_not_blocked: (o) => o === "unknown_as_required",
    observer_candidates: (o) => o.endsWith(":restart-supervised-observer"), leased_restart: (o) => o === "completed",
    observation_handshake: (o) => o === "verified", post_restart_model_check: (o) => o === "no_repair_needed",
  };
  return {
    schema: "dk.local.observer_recovery_loop_receipt.v1", run_id: runId, stages, model: { used: false, spend_usd: 0 }, scope: "local_only_synthetic",
    limitations: ["Host-process mode: trusted built-in templates only; not an OS isolation boundary.", "The observer state report is launcher-reported and not attested (like the configuration snapshot).", "Restoring observation is not a security repair; effects during the outage stay unknown."],
    ok: Object.entries(want).every(([k, f]) => { const s = stages.find((x) => x.stage === k); return !!s && f(s.outcome); }) && !stages.some((s) => s.stage === "error"),
  };
}
