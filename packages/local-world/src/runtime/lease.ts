import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { canonicalJson, LAB_AUTHORIZATION_NAMESPACE, REPAIR_ACTION_PARAMETER, validateLabLease, validateRepairPlan, type LabLease, type RepairAction, type RepairActionType, type RepairPlan } from "@dk/contracts";
import { sha256, type WorldTemplate } from "../catalog.ts";
import { monoMs, RunRefusal, type Run } from "./supervisor.ts";

/**
 * LP20: run-scoped local authority leases.
 *
 * Authority hierarchy (06_SECURITY_AND_AUTHORITY.md): the operator controls whether local lab actions exist at all;
 * the supervisor allocates runs and issues leases; a controller receives an expiring lease for exact run-owned
 * actions; observers report effects and grant nothing. Concretely:
 *
 * - Default is PLAN-ONLY. A supervisor constructed without `labActions: "leased"` refuses every lease, and the
 *   operator kill switch returns it to plan-only for good (revoking every outstanding lease).
 * - Only the holder of the supervisor's one-time OPERATOR CREDENTIAL can issue a lease, mint a controller identity,
 *   revoke someone else's lease or pull the kill switch. Run tokens (including the launcher's all-actions token),
 *   Digital Kingdom server tokens, controller tokens and the lease itself are all refused for those operations; there
 *   is no extend operation (a longer lease is a new issuance by the operator).
 * - A lease names one run, one controller identity, the canonical digest of one `dk.local.repair_plan.v1` and, per
 *   action, the type, the registered target, a parameter digest and the expected target revision. It expires on the
 *   monotonic clock and carries an operation budget. Every check happens again at use: expiry, revocation, run state,
 *   controller identity, plan digest (changed parameters), target revision (stale state), single use per action
 *   (replay), budget.
 * - Targets must be resources of the run's supervisor-compiled world with the template the action type is reviewed
 *   for. Provider identifiers (ARNs, account ids, cloud resource ids) and anything not in the run are refused.
 * - Every transition is appended to the supervisor's audit log and the run's private truth.
 *
 * A lease is not a human approval (`counts_as_human_approval: false`) and cannot authorize the production-facing
 * response path: nothing in the server accepts it, and this module never imports the server.
 */
export const LAB_LEASE_LIMITS = { min_ttl_ms: 100, max_ttl_ms: 900_000, default_ttl_ms: 120_000, max_operations: 50 } as const;

/** Which run-owned templates each reviewed repair action type may target. */
export const REPAIR_TARGET_TEMPLATES: Record<RepairActionType, WorldTemplate[]> = {
  set_gateway_policy: ["gateway", "agent_gateway", "api"],
  deactivate_test_token: ["local_issuer"],
  remove_test_grant: ["local_issuer"],
  select_test_artifact: ["artifact_depot"],
  restart_test_observer: ["observer"],
};
/** The shape of each reference inside a local run. Policy references are reviewed variants only (never the weak one). */
export const REPAIR_REF_PATTERN: Record<RepairActionType, RegExp> = {
  set_gateway_policy: /^policy:(baseline|candidate)$/,
  deactivate_test_token: /^cred-\d{1,6}$/,
  remove_test_grant: /^grant-[0-9a-f]{12}$/,
  select_test_artifact: /^[0-9a-f]{64}$/,
  restart_test_observer: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/,
};
/** Provider identifiers that must never become a lab target, even when they fit the plain-id pattern. */
const PROVIDER_ID = /^(arn|aws|gcp|gcloud|azure|projects|subscriptions|k8s|kubernetes)[:.]|:\d{12}(:|$)|^\d{12}$|^(i|sg|vpc|subnet|ami|vol|eni|igw|nat|rtb|acl|snap)-[0-9a-f]{8,17}$/i;
export const grantRef = (subject: string, grant: string) => `grant-${sha256(`${subject}|${grant}`).slice(0, 12)}`;
export const planDigest = (plan: RepairPlan) => sha256(canonicalJson(plan));
const paramDigest = (a: RepairAction) => sha256(canonicalJson({ type: a.type, parameters: a.parameters }));

export type LeaseState = "active" | "revoked" | "expired" | "exhausted";
export type LeaseTransition = "issued" | "refused" | "used" | "replay_refused" | "applied_confirmed" | "revoked" | "expired" | "exhausted" | "kill_switch";
export interface LeaseAudit { seq: number; at: string; at_mono_ms: number; transition: LeaseTransition; lease_id: string | null; run_id: string | null; by: "operator" | "controller" | "supervisor" | "unknown"; detail: string }
/** @internal */
export interface LeaseRecord {
  lease: LabLease; state: LeaseState; expires_mono_ms: number; controller_token_id: string; operations: number;
  consumed: Map<string, string>; applied: Set<string>; expected: Map<string, string>; reason: string | null;
}
export interface IssueLeaseRequest { run_id: string; plan: unknown; controller_token: string; ttl_ms?: number; max_operations?: number }

/** The host the registry needs from the supervisor (kept narrow so the registry cannot reach anything else). */
export interface LeaseHost {
  secret: Buffer; labActions(): "plan_only" | "leased"; run(id: string): Run | undefined;
  controllerTokenId(token: string, runId: string): string; // throws unless a valid repair_execute token of that run
}

export class LeaseRegistry {
  private readonly records = new Map<string, LeaseRecord>();
  private readonly log: LeaseAudit[] = [];
  constructor(private readonly host: LeaseHost) {}

  audit(): LeaseAudit[] { return this.log.map((e) => ({ ...e })); }
  private note(transition: LeaseTransition, lease_id: string | null, run_id: string | null, by: LeaseAudit["by"], detail: string) {
    const e: LeaseAudit = { seq: this.log.length + 1, at: new Date().toISOString(), at_mono_ms: monoMs(), transition, lease_id, run_id, by, detail: detail.slice(0, 300) };
    this.log.push(e);
    if (run_id) this.host.run(run_id)?.recordLeaseTransition(e);
  }
  /** @internal a refused operator-level request (no credential) still leaves an audit transition */
  noteRefusal(run_id: string | null, detail: string) { this.note("refused", null, run_id && this.host.run(run_id) ? run_id : null, "unknown", detail); }
  private refuse(code: RunRefusal["code"], msg: string, lease_id: string | null, run_id: string | null, by: LeaseAudit["by"] = "unknown", transition: LeaseTransition = "refused"): never {
    this.note(transition, lease_id, run_id, by, msg);
    throw new RunRefusal(code, msg);
  }
  private mac(id: string, digest: string, run: string) { return createHmac("sha256", this.host.secret).update(`lease|${id}|${digest}|${run}`).digest("base64url"); }

  /** Operator-only (the supervisor checks the operator credential before calling this). */
  issue(req: IssueLeaseRequest): { token: string; lease: LabLease } {
    const runId = typeof req?.run_id === "string" ? req.run_id : "";
    if (this.host.labActions() !== "leased") this.refuse("scope", "local lab actions are plan-only on this supervisor (default, or the operator kill switch was used); no lease can be issued", null, runId || null, "operator");
    const run = this.host.run(runId);
    if (!run) this.refuse("wrong_run", `${runId.slice(0, 80)} is not a run of this supervisor; leases target supervisor-owned runs only`, null, null, "operator");
    if (run.state !== "running" && run.state !== "paused") this.refuse("state", `run is ${run.state}; leases are issued for active runs only`, null, runId, "operator");
    const v = validateRepairPlan(req.plan, { now: Date.now() });
    if (!v.ok) this.refuse("scope", `not a valid plan-only dk.local.repair_plan.v1: ${v.errors.slice(0, 4).join("; ")}`, null, runId, "operator");
    const plan = v.value!;
    if (plan.run_id !== run.run_id) this.refuse("wrong_run", `plan names run ${plan.run_id.slice(0, 80)}, not ${run.run_id}`, null, runId, "operator");
    let controllerId: string;
    try { controllerId = this.host.controllerTokenId(req.controller_token, run.run_id); }
    catch (e) { this.refuse("unauthorized", `controller identity refused: ${(e as Error).message}`, null, runId, "operator"); }
    const firstRevision = new Map<string, string>();
    for (const a of plan.actions) {
      if (PROVIDER_ID.test(a.target_resource_id)) this.refuse("unregistered", `action ${a.id} targets a provider identifier (${a.target_resource_id.slice(0, 80)}); only supervisor-owned run resources can be lab targets`, null, runId, "operator");
      const res = run.world.plan.resources.find((r) => r.id === a.target_resource_id);
      if (!res) this.refuse("unregistered", `action ${a.id} targets ${a.target_resource_id.slice(0, 80)}, which is not a resource of ${run.run_id}`, null, runId, "operator");
      if (!REPAIR_TARGET_TEMPLATES[a.type].includes(res.template as WorldTemplate)) this.refuse("scope", `action ${a.id} (${a.type}) cannot target a ${res.template}; reviewed targets are ${REPAIR_TARGET_TEMPLATES[a.type].join(", ")}`, null, runId, "operator");
      const ref = a.parameters[REPAIR_ACTION_PARAMETER[a.type]]!;
      if (!REPAIR_REF_PATTERN[a.type].test(ref) || (a.type === "restart_test_observer" && ref !== a.target_resource_id)) this.refuse("scope", `action ${a.id}: ${REPAIR_ACTION_PARAMETER[a.type]} ${ref.slice(0, 80)} is not a run-owned reference for ${a.type}`, null, runId, "operator");
      const prev = firstRevision.get(a.target_resource_id);
      if (prev !== undefined && prev !== a.expected_target_revision) this.refuse("state", `actions on ${a.target_resource_id} must share one expected starting revision`, null, runId, "operator");
      firstRevision.set(a.target_resource_id, a.expected_target_revision);
      const cur = run.revisionOf(a.target_resource_id);
      if (cur !== a.expected_target_revision) this.refuse("state", `precondition failed: ${a.target_resource_id} is at ${cur}, the plan expects ${a.expected_target_revision}`, null, runId, "operator");
    }
    const ttl = req.ttl_ms ?? LAB_LEASE_LIMITS.default_ttl_ms;
    if (!Number.isInteger(ttl) || ttl < LAB_LEASE_LIMITS.min_ttl_ms || ttl > LAB_LEASE_LIMITS.max_ttl_ms) this.refuse("scope", `ttl_ms must be an integer from ${LAB_LEASE_LIMITS.min_ttl_ms} to ${LAB_LEASE_LIMITS.max_ttl_ms}`, null, runId, "operator");
    const maxOps = req.max_operations ?? plan.actions.length;
    if (!Number.isInteger(maxOps) || maxOps < 1 || maxOps > LAB_LEASE_LIMITS.max_operations) this.refuse("scope", `max_operations must be 1 to ${LAB_LEASE_LIMITS.max_operations}`, null, runId, "operator");
    const id = `lease-${randomBytes(8).toString("hex")}`, digest = planDigest(plan), now = Date.now();
    const lease: LabLease = {
      schema: "dk.local.lab_lease.v1", namespace: LAB_AUTHORIZATION_NAMESPACE, lease_id: id, run_id: run.run_id, project_id: run.project_id, plan_id: plan.plan_id,
      plan_digest: digest, baseline_digest: plan.baseline_digest, candidate_digest: plan.candidate_digest, controller_id: controllerId,
      actions: plan.actions.map((a) => ({ action_id: a.id, type: a.type, target_resource_id: a.target_resource_id, parameter_digest: paramDigest(a), expected_target_revision: a.expected_target_revision })),
      issued_at: new Date(now).toISOString(), expires_at: new Date(now + ttl).toISOString(), ttl_ms: ttl, budget: { max_operations: maxOps },
      issuer: "supervisor", approval_kind: "local_lab_lease", counts_as_human_approval: false,
      authorizes: "typed_repair_actions_on_run_owned_disposable_resources", production_path: "not_authorized",
    };
    const lv = validateLabLease(lease);
    if (!lv.ok) throw new Error(`lease invalid: ${lv.errors.join("; ")}`);
    this.records.set(id, { lease, state: "active", expires_mono_ms: monoMs() + ttl, controller_token_id: controllerId, operations: 0, consumed: new Map(), applied: new Set(), expected: new Map(firstRevision), reason: null });
    this.note("issued", id, run.run_id, "operator", `plan ${plan.plan_id} (${digest.slice(0, 12)}), ${plan.actions.length} action(s), ttl ${ttl} ms, budget ${maxOps}`);
    return { token: `dklease_v1.${id}.${this.mac(id, digest, run.run_id)}`, lease: structuredClone(lease) };
  }

  private record(token: unknown, by: LeaseAudit["by"]): LeaseRecord {
    const m = /^dklease_v1\.(lease-[0-9a-f]{16})\.([A-Za-z0-9_-]{43})$/.exec(typeof token === "string" ? token : "");
    if (!m) this.refuse("unauthorized", "not a lab lease (an approval descriptor, run token, server token or human approval is not a lease)", null, null, by);
    const rec = this.records.get(m[1]!);
    const want = rec ? Buffer.from(this.mac(rec.lease.lease_id, rec.lease.plan_digest, rec.lease.run_id)) : Buffer.alloc(43);
    const got = Buffer.from(m[2]!);
    if (!rec || want.length !== got.length || !timingSafeEqual(want, got)) this.refuse("unauthorized", "lease signature invalid or lease unknown", m[1]!, null, by);
    return rec;
  }
  private live(rec: LeaseRecord, by: LeaseAudit["by"]) {
    const id = rec.lease.lease_id, run = rec.lease.run_id;
    if (rec.state === "active" && monoMs() > rec.expires_mono_ms) { rec.state = "expired"; rec.reason = "ttl elapsed (monotonic clock)"; this.note("expired", id, run, "supervisor", `ttl ${rec.lease.ttl_ms} ms elapsed on the monotonic clock`); }
    if (rec.state !== "active") this.refuse("unauthorized", `lease ${id} is ${rec.state}${rec.reason ? ` (${rec.reason})` : ""}`, id, run, by);
    if (this.host.labActions() !== "leased") this.refuse("unauthorized", "local lab actions were switched off by the operator (kill switch)", id, run, by);
  }

  /**
   * Use-time check for one action. Refuses: unknown/forged/expired/revoked leases, another run, another controller,
   * a plan whose canonical digest differs (any changed parameter), an action outside the lease, a target whose
   * current revision is not the expected one (stale), a second use of the same action (replay) unless it is the
   * journalled re-application of the same idempotency key after a crash, and an exhausted operation budget.
   */
  authorizeAction(token: unknown, c: { run: Run; plan: RepairPlan; action_id: string; controller_token_id: string; idempotency_key: string; reapply?: boolean }): { rec: LeaseRecord; action: RepairAction } {
    const rec = this.record(token, "controller");
    const id = rec.lease.lease_id;
    this.live(rec, "controller");
    if (rec.lease.run_id !== c.run.run_id) this.refuse("wrong_run", `lease ${id} belongs to ${rec.lease.run_id}, not ${c.run.run_id}`, id, c.run.run_id, "controller", "replay_refused");
    if (c.run.state !== "running" && c.run.state !== "paused") this.refuse("state", `run is ${c.run.state}`, id, c.run.run_id, "controller");
    if (c.controller_token_id !== rec.controller_token_id) this.refuse("unauthorized", `lease ${id} is held by another controller identity`, id, c.run.run_id, "controller");
    if (planDigest(c.plan) !== rec.lease.plan_digest) this.refuse("scope", `plan digest differs from the leased plan ${rec.lease.plan_digest.slice(0, 12)} (changed parameters need a new plan and a new lease)`, id, c.run.run_id, "controller");
    const v = validateRepairPlan(c.plan, { now: Date.now() });
    if (!v.ok) this.refuse("scope", `plan no longer valid: ${v.errors.slice(0, 3).join("; ")}`, id, c.run.run_id, "controller");
    const action = c.plan.actions.find((a) => a.id === c.action_id);
    const leased = rec.lease.actions.find((a) => a.action_id === c.action_id);
    if (!action || !leased || leased.parameter_digest !== paramDigest(action) || leased.target_resource_id !== action.target_resource_id) this.refuse("scope", `action ${String(c.action_id).slice(0, 80)} is not leased as given`, id, c.run.run_id, "controller");
    const prior = rec.consumed.get(action.id);
    if (prior !== undefined && !(c.reapply && prior === c.idempotency_key && !rec.applied.has(action.id))) this.refuse("unauthorized", `action ${action.id} of lease ${id} was already used (replay refused)`, id, c.run.run_id, "controller", "replay_refused");
    const expected = rec.expected.get(action.target_resource_id)!;
    const cur = c.run.revisionOf(action.target_resource_id);
    if (cur !== expected) this.refuse("state", `stale: ${action.target_resource_id} is at ${cur}, the lease expects ${expected}`, id, c.run.run_id, "controller");
    if (prior === undefined && rec.operations >= rec.lease.budget.max_operations) {
      rec.state = "exhausted"; rec.reason = `operation budget ${rec.lease.budget.max_operations} used`;
      this.refuse("budget", `lease ${id} operation budget ${rec.lease.budget.max_operations} exhausted`, id, c.run.run_id, "controller", "exhausted");
    }
    return { rec, action };
  }
  /** Record the use (before the operation is attempted, so a crash cannot hide a use). */
  consume(rec: LeaseRecord, action_id: string, key: string) {
    if (!rec.consumed.has(action_id)) { rec.consumed.set(action_id, key); rec.operations++; }
    this.note("used", rec.lease.lease_id, rec.lease.run_id, "controller", `action ${action_id} (${rec.operations}/${rec.lease.budget.max_operations})`);
  }
  /** The controller confirms the effect landed at a new revision: later actions on the same target expect it. */
  confirmApplied(rec: LeaseRecord, action: RepairAction, to_revision: string) {
    rec.applied.add(action.id); rec.expected.set(action.target_resource_id, to_revision);
    this.note("applied_confirmed", rec.lease.lease_id, rec.lease.run_id, "controller", `action ${action.id} -> ${to_revision}`);
  }
  /** Compensation stays inside the same lease and target; it is checked like an action but does not reuse budget. */
  authorizeCompensation(token: unknown, c: { run: Run; action_id: string; controller_token_id: string }): LeaseRecord {
    const rec = this.record(token, "controller");
    if (rec.lease.run_id !== c.run.run_id || c.controller_token_id !== rec.controller_token_id || !rec.applied.has(c.action_id)) this.refuse("unauthorized", `compensation for ${String(c.action_id).slice(0, 80)} is not covered by lease ${rec.lease.lease_id}`, rec.lease.lease_id, c.run.run_id, "controller");
    if (this.host.labActions() !== "leased") this.refuse("unauthorized", "local lab actions were switched off by the operator (kill switch)", rec.lease.lease_id, c.run.run_id, "controller");
    return rec;
  }
  view(token: unknown): { lease: LabLease; state: LeaseState; operations: number; reason: string | null } {
    const rec = this.record(token, "unknown");
    if (rec.state === "active" && monoMs() > rec.expires_mono_ms) this.live(rec, "unknown");
    return { lease: structuredClone(rec.lease), state: rec.state, operations: rec.operations, reason: rec.reason };
  }
  /** The holder may give up its own lease (authority only shrinks); the operator may revoke any. */
  revoke(lease_id: string, reason: string, by: "operator" | "controller", holder?: string) {
    const rec = this.records.get(lease_id);
    if (!rec) this.refuse("unauthorized", "unknown lease", null, null, by);
    if (by === "controller" && holder !== rec.controller_token_id) this.refuse("unauthorized", "only the holder or the operator can revoke a lease", lease_id, rec.lease.run_id, by);
    if (rec.state === "active") { rec.state = "revoked"; rec.reason = reason.slice(0, 200); this.note("revoked", lease_id, rec.lease.run_id, by, reason); }
  }
  revokeToken(token: unknown, reason: string, holder: string) { const rec = this.record(token, "controller"); this.revoke(rec.lease.lease_id, reason, "controller", holder); }
  revokeRun(runId: string, reason: string) { for (const r of this.records.values()) if (r.lease.run_id === runId && r.state === "active") { r.state = "revoked"; r.reason = reason.slice(0, 200); this.note("revoked", r.lease.lease_id, runId, "supervisor", reason); } }
  kill(reason: string) {
    this.note("kill_switch", null, null, "operator", reason);
    for (const r of this.records.values()) if (r.state === "active") { r.state = "revoked"; r.reason = `kill switch: ${reason}`.slice(0, 200); this.note("revoked", r.lease.lease_id, r.lease.run_id, "operator", `kill switch: ${reason}`); }
  }
}
