import { validateRepairExecution, validateRepairPlan, type RepairExecution, type RepairPlan } from "@dk/contracts";
import { sha256 } from "../catalog.ts";
import { planDigest } from "./lease.ts";
import { RunRefusal, type Run } from "./supervisor.ts";

/**
 * LP21: the repair controller — a journalled state machine that closes the action loop ONLY inside one disposable,
 * supervisor-owned run.
 *
 * - Identity: a controller token minted by the operator (`repair_execute` only). It cannot send stimulus, configure,
 *   control observers or the run lifecycle; everything it changes goes through `Run.leasedOperation`, which re-checks
 *   the lease and executes one of the five reviewed typed operations (`repair-ops.ts`). This module imports no
 *   process, network or file API: it has no shell, URL, host path or provider adapter to call.
 * - Journal: before each action `planned` (idempotency key = sha256(lease|plan digest|action), target, expected
 *   revision) and `applying`; after it `applied` (from/to revision, operation id); finally `receipt`. The journal is a
 *   run-owned file, so a new controller instance (after a crash) reads the same history.
 * - Idempotency and recovery: an action already `applied` is never applied again. An action left at `applying` (a
 *   crash after application but before the receipt) is reconciled against ACTUAL state: if the effect is present it
 *   is recorded as `reconciled` without re-applying; if the target is still at the expected revision it was not
 *   applied and is applied once (the lease admits only the same idempotency key); anything else is drift and fails.
 * - Cancellation stops new actions and gives the lease up; a quota (lease budget or run request budget) or a failed
 *   action stops the plan and is surfaced; partial application triggers compensation of reversible actions only —
 *   compromised authority (a deactivated token, a removed grant, a suspect artifact, a weak policy) is never
 *   restored as rollback. Cleanup is the run's and is reported separately (`withRunCleanup`).
 * - An execution receipt is not a verdict: whether the change achieved anything is LP22's independent verification.
 */
export class SimulatedCrash extends Error { constructor(at: string) { super(`simulated controller crash ${at}`); this.name = "SimulatedCrash"; } }
export interface ControllerOptions {
  /** Test-only fault injection: crash (throw, losing in-memory state) right after the named action was applied, before its journal entry. */
  faults?: { crashAfterApply?: string; crashBeforeApply?: string };
  /** Called after each applied action (e.g. to cancel mid-plan). */
  onActionApplied?: (actionId: string) => void | Promise<void>;
  /** Compensate reversible actions when the plan is only partially applied (default) or leave everything as is. */
  compensation?: "reversible" | "none";
}
type J = Record<string, unknown> & { kind: string; key?: string; action_id?: string };

export class RepairController {
  private cancelReason: string | null = null;
  constructor(private readonly run: Run, private readonly token: string, private readonly o: ControllerOptions = {}) {}
  /** Stop starting new actions; the lease is given up at the next step boundary. */
  cancel(reason: string) { this.cancelReason = reason.slice(0, 300) || "cancelled"; }

  async execute(leaseToken: string, planInput: unknown): Promise<RepairExecution> {
    const v = validateRepairPlan(planInput, { now: Date.now() });
    if (!v.ok) throw new RunRefusal("scope", `not a valid plan-only dk.local.repair_plan.v1 (no other request is executable): ${v.errors.slice(0, 4).join("; ")}`);
    const plan: RepairPlan = v.value!;
    const view = this.run.leaseOf(this.token, leaseToken); // controller identity + lease signature
    const lease = view.lease, digest = planDigest(plan);
    if (view.state !== "active") throw new RunRefusal("unauthorized", `lease ${lease.lease_id} is ${view.state}${view.reason ? ` (${view.reason})` : ""}; nothing is executed or reconciled under it`);
    if (lease.plan_digest !== digest) throw new RunRefusal("scope", `plan digest differs from the leased plan ${lease.plan_digest.slice(0, 12)}`);
    const journal = () => (this.run.readJournal(this.token) as J[]).filter((e) => e.lease_id === lease.lease_id && e.plan_digest === digest);
    const log = (kind: string, extra: Record<string, unknown> = {}) => this.run.appendJournal(this.token, { kind, lease_id: lease.lease_id, plan_id: plan.plan_id, plan_digest: digest, ...extra });
    const prior = journal();
    const firstBefore = prior.find((e) => e.kind === "started")?.revisions_before as Record<string, string> | undefined;
    const before = firstBefore ?? this.run.revisions();
    if (!firstBefore) log("started", { revisions_before: before });
    else log("resumed", { reason: "journal found for this lease and plan; reconciling before continuing" });

    const actions: RepairExecution["actions"] = [];
    const reconciled: string[] = [];
    let stop: { why: string; state: "refused" | "failed" | "cancelled"; quota: boolean } | null = null;
    for (const a of plan.actions) {
      const key = sha256(`${lease.lease_id}|${digest}|${a.id}`);
      const mine = journal().filter((e) => e.key === key);
      const base = { action_id: a.id, type: a.type, target_resource_id: a.target_resource_id, idempotency_key: key };
      const applied = mine.find((e) => e.kind === "applied");
      if (applied) { actions.push({ ...base, state: "already_applied", from_revision: applied.from_revision as string, to_revision: applied.to_revision as string, operation_id: (applied.operation_id as string | null) ?? null, apply_count: 1, reason: "applied by an earlier execution of this lease (idempotent: not applied again)" }); continue; }
      if (stop) { actions.push({ ...base, state: stop.state === "cancelled" ? "cancelled" : "not_run", from_revision: null, to_revision: null, operation_id: null, apply_count: 0, reason: stop.state === "cancelled" ? `cancelled: ${stop.why}` : `not run: ${stop.why}` }); continue; }
      if (this.cancelReason) { stop = { why: this.cancelReason, state: "cancelled", quota: false }; log("cancelled", { key, action_id: a.id, reason: this.cancelReason }); actions.push({ ...base, state: "cancelled", from_revision: null, to_revision: null, operation_id: null, apply_count: 0, reason: `cancelled: ${this.cancelReason}` }); continue; }
      let reapply = false;
      const applying = mine.filter((e) => e.kind === "applying");
      if (applying.length) {
        // crash recovery: the journal says we started this action but never recorded its result
        const obs = this.run.repairObservation(this.token, a);
        const expected = applying[0]!.expected_revision as string;
        if (obs.desired && obs.revision !== expected) {
          log("reconciled", { key, action_id: a.id, observed_revision: obs.revision, note: "effect present after a crash; not applied again" });
          log("applied", { key, action_id: a.id, from_revision: expected, to_revision: obs.revision, operation_id: null, reconciled: true });
          reconciled.push(a.id);
          actions.push({ ...base, state: "reconciled", from_revision: expected, to_revision: obs.revision, operation_id: null, apply_count: 1, reason: "the controller crashed after application and before its receipt; actual state shows the effect, so it was recorded without re-applying" });
          continue;
        }
        if (obs.revision === expected && !obs.desired) { log("not_applied_before_crash", { key, action_id: a.id }); reapply = true; }
        else {
          stop = { why: `drift on ${a.target_resource_id}: at ${obs.revision}, neither the expected ${expected} nor the leased effect`, state: "failed", quota: false };
          log("failed", { key, action_id: a.id, reason: stop.why });
          actions.push({ ...base, state: "failed", from_revision: expected, to_revision: obs.revision, operation_id: null, apply_count: 0, reason: `${stop.why}; manual local recovery needed` });
          continue;
        }
      }
      // already in the desired state before anything was done: nothing to apply, nothing consumed
      const pre = this.run.repairObservation(this.token, a);
      if (!reapply && pre.desired) { log("already_in_desired_state", { key, action_id: a.id, revision: pre.revision }); actions.push({ ...base, state: "already_applied", from_revision: pre.revision, to_revision: pre.revision, operation_id: null, apply_count: 0, reason: "target already in the desired state; nothing applied" }); continue; }
      if (!mine.some((e) => e.kind === "planned")) log("planned", { key, action_id: a.id, type: a.type, target: a.target_resource_id, target_fingerprint: sha256(`${this.run.run_id}|${a.target_resource_id}|${pre.revision}`), expected_revision: a.expected_target_revision });
      log("applying", { key, action_id: a.id, expected_revision: pre.revision });
      if (this.o.faults?.crashBeforeApply === a.id) throw new SimulatedCrash(`before applying ${a.id}`);
      let r: Awaited<ReturnType<Run["leasedOperation"]>>;
      try { r = await this.run.leasedOperation(this.token, leaseToken, plan, a.id, { idempotency_key: key, ...(reapply ? { reapply: true } : {}) }); }
      catch (e) {
        if (!(e instanceof RunRefusal)) throw e;
        const quota = e.code === "budget";
        stop = { why: `${e.code}: ${e.message}`, state: quota || e.code !== "deadline" ? "refused" : "failed", quota };
        log("refused", { key, action_id: a.id, code: e.code, reason: e.message.slice(0, 300) });
        actions.push({ ...base, state: "refused", from_revision: pre.revision, to_revision: null, operation_id: null, apply_count: 0, reason: `${quota ? "quota: " : ""}${e.message}`.slice(0, 1000) });
        continue;
      }
      if (this.o.faults?.crashAfterApply === a.id) throw new SimulatedCrash(`after applying ${a.id}, before its receipt`);
      if (!r.desired || r.to_revision === r.from_revision) {
        stop = { why: `action ${a.id} was accepted (status ${r.status}) but its effect is not present`, state: "failed", quota: false };
        log("failed", { key, action_id: a.id, status: r.status, reason: stop.why });
        actions.push({ ...base, state: "failed", from_revision: r.from_revision, to_revision: r.to_revision, operation_id: r.op_id, apply_count: 0, reason: stop.why });
        continue;
      }
      log("applied", { key, action_id: a.id, from_revision: r.from_revision, to_revision: r.to_revision, operation_id: r.op_id });
      actions.push({ ...base, state: "applied", from_revision: r.from_revision, to_revision: r.to_revision, operation_id: r.op_id, apply_count: 1, reason: `applied once (status ${r.status})` });
      await this.o.onActionApplied?.(a.id);
    }
    const done = (s: string) => s === "applied" || s === "already_applied" || s === "reconciled";
    const anyDone = actions.some((x) => done(x.state)), allDone = actions.every((x) => done(x.state));
    const state: RepairExecution["state"] = allDone ? "completed" : stop?.state === "cancelled" ? "cancelled" : anyDone ? "partially_applied" : stop?.state === "refused" ? "refused" : "failed";
    const compensation: RepairExecution["compensation"] = [];
    if (!allDone && anyDone && (this.o.compensation ?? "reversible") === "reversible" && state !== "cancelled") {
      for (const x of [...actions].reverse().filter((y) => y.state === "applied" || y.state === "reconciled")) {
        let c: RepairExecution["compensation"][number];
        try { const r = await this.run.compensateAction(this.token, leaseToken, plan, x.action_id); c = { action_id: x.action_id, outcome: r.outcome, reason: r.reason.slice(0, 1000) }; }
        catch (e) { c = { action_id: x.action_id, outcome: "failed", reason: `compensation refused: ${(e as Error).message}`.slice(0, 1000) }; }
        compensation.push(c); log("compensation", { action_id: x.action_id, outcome: c.outcome, reason: c.reason });
      }
    }
    if (stop?.state === "cancelled") { try { this.run.relinquishLease(this.token, leaseToken, `cancelled: ${stop.why}`); } catch { /* already revoked */ } }
    const after = this.run.revisions();
    const targets = new Set(plan.actions.map((x) => x.target_resource_id));
    const lv = (() => { try { return this.run.leaseOf(this.token, leaseToken); } catch { return null; } })();
    const receipt: RepairExecution = {
      schema: "dk.local.repair_execution.v1", run_id: this.run.run_id, plan_id: plan.plan_id, plan_digest: digest, lease_id: lease.lease_id, controller_id: lease.controller_id, state, actions, compensation,
      revisions_before: before, revisions_after: after, untargeted_changes: Object.keys(after).filter((k) => !targets.has(k) && after[k] !== before[k]).sort(),
      quota: { max_operations: lease.budget.max_operations, used: lv?.operations ?? view.operations, exhausted: !!stop?.quota || lv?.state === "exhausted" },
      cancellation: { requested: this.cancelReason !== null, reason: this.cancelReason },
      recovery: { reconciled_actions: reconciled, journal_entries: journal().length + 1 },
      cleanup: runCleanup(this.run), counts_as_human_approval: false, scope: "local_run_only",
    };
    const rv = validateRepairExecution(receipt);
    if (!rv.ok) throw new Error(`execution receipt invalid: ${rv.errors.join("; ")}`);
    log("receipt", { state, digest: sha256(JSON.stringify(receipt)) });
    return receipt;
  }
}

function runCleanup(run: Run): RepairExecution["cleanup"] {
  const c = run.cleanupRecord;
  if (c.outcome === "pending") return { outcome: "pending", notes: `run ${run.state}; cleanup runs when the run owner stops and cleans the run` };
  return { outcome: c.outcome, notes: c.failures.map((f) => `${f.path}: ${f.reason}`).join("; ").slice(0, 2000) || `removed ${c.removed.length} owned path(s)` };
}
/** Re-read the run's cleanup outcome into a receipt (cleanup happens after execution, by the run owner). */
export function withRunCleanup(receipt: RepairExecution, run: Run): RepairExecution { return { ...receipt, cleanup: runCleanup(run) }; }
