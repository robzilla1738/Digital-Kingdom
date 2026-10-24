import labLeaseSchema from "../schemas/local/lab-lease.v1.schema.json" with { type: "json" };
import repairExecutionSchema from "../schemas/local/repair-execution.v1.schema.json" with { type: "json" };
import * as generated from "./generated/validators.js";
import { formatErrors, type ValidationResult } from "./validate.ts";
import type { RepairActionType } from "./repair.ts";

/**
 * Local Intelligence Phase LP20: local lab leases (`dk.local.lab_lease.v1`).
 *
 * A lab lease is the ONLY authority under which a typed local repair may run. It lives in its own authorization
 * namespace (`dk.local.lab_authorization`), is issued by the run supervisor (never by an investigator, a service
 * token or the controller that will hold it), is scoped to one run, one plan digest, one controller identity and the
 * exact actions/targets/parameter digests of that plan, expires on the monotonic clock and carries an operation
 * budget. Its constants say what it is NOT: it never counts as human approval and never authorizes the
 * production-facing response path.
 */
export const LAB_CONTRACTS = { lab_lease: "dk.local.lab_lease.v1", repair_execution: "dk.local.repair_execution.v1" } as const;
export const LAB_AUTHORIZATION_NAMESPACE = "dk.local.lab_authorization" as const;
export interface LabLeaseAction { action_id: string; type: RepairActionType; target_resource_id: string; parameter_digest: string; expected_target_revision: string }
export interface LabLease {
  schema: "dk.local.lab_lease.v1"; namespace: typeof LAB_AUTHORIZATION_NAMESPACE;
  lease_id: string; run_id: string; project_id: string; plan_id: string; plan_digest: string; baseline_digest: string; candidate_digest: string;
  controller_id: string; actions: LabLeaseAction[]; issued_at: string; expires_at: string; ttl_ms: number; budget: { max_operations: number };
  issuer: "supervisor"; approval_kind: "local_lab_lease"; counts_as_human_approval: false;
  authorizes: "typed_repair_actions_on_run_owned_disposable_resources"; production_path: "not_authorized";
}

const g = generated as unknown as Record<string, ((d: unknown) => boolean) & { errors?: unknown }>;
export function validateLabLease(d: unknown): ValidationResult<LabLease> {
  const fn = g.validateLabLease!;
  if (!fn(d)) return { ok: false, errors: formatErrors(fn.errors as never) };
  const l = d as LabLease;
  const errors: string[] = [];
  const ids = l.actions.map((a) => a.action_id);
  if (new Set(ids).size !== ids.length) errors.push("/actions duplicate action id");
  if (!(Date.parse(l.expires_at) > Date.parse(l.issued_at))) errors.push("/expires_at must be after issued_at");
  return errors.length ? { ok: false, errors } : { ok: true, value: l, errors: [] };
}
/**
 * Is this a human approval? Never for a lab lease or anything in the lab namespace, whatever fields a caller adds.
 * Human approval is recorded only by the existing human-admin containment decision path (and its recording for
 * repairs is deferred, EXT05), so no object handed to local-phase code ever qualifies.
 */
export function isHumanApproval(_x: unknown): false { return false; }
/**
 * LP21: what a leased controller actually applied (`dk.local.repair_execution.v1`). An execution receipt is NOT a
 * security verdict (that is LP22's independent verification); it records execution state, per-action revisions,
 * compensation, quota, cancellation, crash recovery and cleanup, all separately.
 */
export type RepairExecutionState = "completed" | "partially_applied" | "failed" | "cancelled" | "refused";
export type RepairActionState = "applied" | "already_applied" | "reconciled" | "not_run" | "refused" | "failed" | "cancelled";
export interface RepairExecution {
  schema: "dk.local.repair_execution.v1"; run_id: string; plan_id: string; plan_digest: string; lease_id: string; controller_id: string; state: RepairExecutionState;
  actions: { action_id: string; type: RepairActionType; target_resource_id: string; state: RepairActionState; from_revision: string | null; to_revision: string | null; operation_id: string | null; idempotency_key: string; apply_count: 0 | 1; reason: string }[];
  compensation: { action_id: string; outcome: "restored_previous" | "not_restored" | "not_needed" | "failed"; reason: string }[];
  revisions_before: Record<string, string>; revisions_after: Record<string, string>; untargeted_changes: string[];
  quota: { max_operations: number; used: number; exhausted: boolean }; cancellation: { requested: boolean; reason: string | null };
  recovery: { reconciled_actions: string[]; journal_entries: number }; cleanup: { outcome: "not_needed" | "completed" | "failed" | "pending"; notes: string };
  counts_as_human_approval: false; scope: "local_run_only";
}
export function validateRepairExecution(d: unknown): ValidationResult<RepairExecution> {
  const fn = g.validateRepairExecution!;
  if (!fn(d)) return { ok: false, errors: formatErrors(fn.errors as never) };
  const r = d as RepairExecution;
  const errors: string[] = [];
  const done = (s: RepairActionState) => s === "applied" || s === "already_applied" || s === "reconciled";
  if (r.state === "completed" && !r.actions.every((a) => done(a.state))) errors.push("/state completed requires every action applied, already applied or reconciled");
  if (r.state === "partially_applied" && !(r.actions.some((a) => done(a.state)) && r.actions.some((a) => !done(a.state)))) errors.push("/state partially_applied requires some applied and some unapplied actions");
  for (const [i, a] of r.actions.entries()) if ((a.state === "applied" || a.state === "reconciled") && (a.apply_count !== 1 || !a.to_revision)) errors.push(`/actions/${i} ${a.state} requires apply_count 1 and a to_revision`);
  if (r.actions.some((a) => a.state === "cancelled") && !r.cancellation.requested) errors.push("/actions a cancelled action requires a recorded cancellation");
  return errors.length ? { ok: false, errors } : { ok: true, value: r, errors: [] };
}
export const labSchemas = { labLease: labLeaseSchema, repairExecution: repairExecutionSchema };
