import labLeaseSchema from "../schemas/local/lab-lease.v1.schema.json" with { type: "json" };
import repairExecutionSchema from "../schemas/local/repair-execution.v1.schema.json" with { type: "json" };
import repairVerificationSchema from "../schemas/local/repair-verification.v1.schema.json" with { type: "json" };
import repairRegressionSchema from "../schemas/local/repair-regression.v1.schema.json" with { type: "json" };
import { validateVerificationReceipt, type VerificationReceipt } from "./local.ts";
import * as generated from "./generated/validators.js";
import { formatErrors, type ValidationResult } from "./validate.ts";
import { REPAIR_ACTION_PARAMETER, type RepairActionType } from "./repair.ts";

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
export const LAB_CONTRACTS = { lab_lease: "dk.local.lab_lease.v1", repair_execution: "dk.local.repair_execution.v1", repair_verification: "dk.local.repair_verification.v1", repair_regression: "dk.local.repair_regression.v1" } as const;
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
/**
 * LP22: independent verification of a local repair (`dk.local.repair_verification.v1`). Security verdict, execution
 * state and cleanup outcome are separate fields; `whole_run.success` is true only when all three are good.
 */
export type WholeRunOutcome = "success" | "security_failed" | "inconclusive" | "execution_incomplete" | "cleanup_failed" | "cleanup_pending" | "refused";
export interface RepairVerification {
  schema: "dk.local.repair_verification.v1"; run_id: string; plan_id: string; plan_digest: string;
  execution: { state: RepairExecutionState; receipt_digest: string }; verifier_id: string;
  independence: { verifier_is_executor: false; observers: string[]; basis: string };
  observations: { probe_id: string; repeat: number; operation_id: string; nonce_digest: string; observation_digest: string; status: number; actual_effect: "observed" | "not_observed" | "unknown"; observer: string; settled_ms: number; reason: string }[];
  before: { probe_id: string; actual_effect: "observed" | "not_observed" | "unknown" }[] | null;
  residual_access: string[]; disruption: string[];
  security_verdict: "pass" | "fail" | "inconclusive" | "refused"; verification_receipt: VerificationReceipt;
  cleanup: { outcome: "not_needed" | "completed" | "failed" | "pending"; notes: string };
  whole_run: { outcome: WholeRunOutcome; success: boolean; reasons: string[] }; scope: "local_run_only";
}
export function validateRepairVerification(d: unknown): ValidationResult<RepairVerification> {
  const fn = g.validateRepairVerification!;
  if (!fn(d)) return { ok: false, errors: formatErrors(fn.errors as never) };
  const v = d as RepairVerification;
  const errors: string[] = [];
  const inner = validateVerificationReceipt(v.verification_receipt);
  if (!inner.ok) errors.push(...inner.errors.map((e) => `/verification_receipt${e.startsWith("/") ? "" : " "}${e}`));
  else {
    if (v.verification_receipt.security_verdict !== v.security_verdict) errors.push("/security_verdict must equal the verification receipt's security verdict");
    if (v.verification_receipt.run_id !== v.run_id) errors.push("/verification_receipt run differs");
    if (v.verification_receipt.cleanup.outcome !== v.cleanup.outcome) errors.push("/cleanup must equal the verification receipt's cleanup");
  }
  if (v.whole_run.success !== (v.whole_run.outcome === "success")) errors.push("/whole_run success must match its outcome");
  if (v.whole_run.success && (v.security_verdict !== "pass" || v.execution.state !== "completed" || !(v.cleanup.outcome === "completed" || v.cleanup.outcome === "not_needed"))) errors.push("/whole_run success requires a passing security verdict, a completed execution and completed (or unneeded) cleanup");
  if (v.security_verdict === "pass" && v.observations.some((o) => o.actual_effect === "unknown")) errors.push("/security_verdict pass is impossible with an unknown observation");
  return errors.length ? { ok: false, errors } : { ok: true, value: v, errors: [] };
}
/**
 * LP23: a replayable regression captured from an executed AND independently verified local repair
 * (`dk.local.repair_regression.v1`). It carries only typed, sanitized data: the public synthetic world (blueprint,
 * version, public test seed, plan/catalog digests), the defect prerequisite as a typed policy setting, principals as
 * synthetic account references (never a session, credential or header), the typed repair actions, negative
 * (prohibited) and positive (permitted) controls, the expected baseline/without-repair/after-repair boundary results,
 * the pinned policy/tool/artifact versions its validation depends on, linkage digests and explicit residual
 * uncertainty. There is no field for a command, URL, header, secret or private truth (additionalProperties: false).
 * The digest is checked by `@dk/local-world` (this package has no crypto).
 */
export interface RepairRegression {
  schema: "dk.local.repair_regression.v1"; regression_id: string; lesson: string;
  world: { blueprint: "saas-storefront" | "agent-workspace" | "delivery-identity"; blueprint_version: number; seed: string; plan_digest: string; catalog_version: string; catalog_digest: string };
  prerequisites: { defect: { resource_id: string; setting: "policy_variant"; value: "baseline" | "candidate" | "deliberately_weak" }[]; principals: { ref: string; kind: "session"; account: string }[] };
  repair: { actions: { action_id: string; type: RepairActionType; target_resource_id: string; parameters: Record<string, string>; expected_target_revision: string }[] };
  probes: { id: string; expectation: "prohibited" | "permitted"; control: "negative" | "positive"; request: { resource: string; method: "GET" | "POST"; path: string; principal: string }; effect: { observer: string; resource: string } }[];
  expected: { baseline: { probe_id: string; actual_effect: "observed" | "not_observed" | "unknown" }[]; without_repair: { prohibited_effects: "observed" }; after_repair: { security_verdict: "pass"; residual_access: []; disruption: []; whole_run: "success" } };
  versions: { policies: Record<string, { template: string; template_version: string; template_digest: string; revision_at_validation: string }>; tools: { effect_verifier: string; repair_controller: string; repair_operations: string; replayer: string }; artifacts: Record<string, string> };
  linkage: { case_ref: string; control_ids: string[]; plan_digest: string; execution_receipt_digest: string; verification_digest: string; verification_outcome: "success" };
  residual_uncertainty: string[];
  replay: { llm: "not_used"; executor: "typed_repair_controller_under_supervisor_lease"; scope: "local_run_only"; data_origin: "synthetic_local"; private_truth: "not_included" };
  descriptor_digest: string;
}
export function validateRepairRegression(d: unknown): ValidationResult<RepairRegression> {
  const fn = g.validateRepairRegression!;
  if (!fn(d)) return { ok: false, errors: formatErrors(fn.errors as never) };
  const r = d as RepairRegression;
  const errors: string[] = [];
  const refs = new Set(r.prerequisites.principals.map((p) => p.ref));
  if (refs.size !== r.prerequisites.principals.length) errors.push("/prerequisites/principals duplicate ref");
  const ids = r.probes.map((p) => p.id);
  if (new Set(ids).size !== ids.length) errors.push("/probes duplicate probe id");
  for (const [i, p] of r.probes.entries()) {
    if (!refs.has(p.request.principal)) errors.push(`/probes/${i}/request/principal ${p.request.principal} is not a declared principal`);
    if ((p.expectation === "prohibited") !== (p.control === "negative")) errors.push(`/probes/${i} a prohibited probe is a negative control and a permitted probe a positive control`);
  }
  if (!r.probes.some((p) => p.control === "negative")) errors.push("/probes at least one negative (prohibited) control is required");
  if (!r.probes.some((p) => p.control === "positive")) errors.push("/probes at least one positive (permitted) control is required");
  const base = new Map(r.expected.baseline.map((b) => [b.probe_id, b.actual_effect]));
  for (const p of r.probes) {
    if (!base.has(p.id)) errors.push(`/expected/baseline missing probe ${p.id}`);
    else if (base.get(p.id) !== "observed") errors.push(`/expected/baseline ${p.id} must be observed: a regression needs a baseline that shows the prohibited effect and a working positive control`);
  }
  const aids = r.repair.actions.map((a) => a.action_id);
  if (new Set(aids).size !== aids.length) errors.push("/repair/actions duplicate action id");
  for (const [i, a] of r.repair.actions.entries()) { const want = REPAIR_ACTION_PARAMETER[a.type]; const keys = Object.keys(a.parameters); if (keys.length !== 1 || keys[0] !== want) errors.push(`/repair/actions/${i}/parameters ${a.type} takes exactly one parameter, ${want}`); }
  for (const a of r.repair.actions) if (!r.versions.policies[a.target_resource_id]) errors.push(`/versions/policies missing pinned version for repair target ${a.target_resource_id}`);
  for (const dft of r.prerequisites.defect) if (!r.versions.policies[dft.resource_id]) errors.push(`/versions/policies missing pinned version for defect resource ${dft.resource_id}`);
  if (r.linkage.plan_digest === r.linkage.verification_digest) errors.push("/linkage plan and verification digests must differ");
  return errors.length ? { ok: false, errors } : { ok: true, value: r, errors: [] };
}
/** LP28: the manifest of a portable local case capsule (`dk.local.capsule.v1`). Schema only; digests are checked by the importer. */
export function validateCapsuleManifest(d: unknown): ValidationResult<Record<string, unknown>> {
  const fn = g.validateCapsuleManifest!;
  if (!fn(d)) return { ok: false, errors: formatErrors(fn.errors as never) };
  const m = d as { kind: string; sealed: unknown; entries: { path: string; role: string }[] };
  const errors: string[] = [];
  const paths = m.entries.map((e) => e.path);
  if (new Set(paths).size !== paths.length) errors.push("/entries duplicate path");
  const sealedEntries = m.entries.filter((e) => e.role === "sealed_oracle" || e.path.startsWith("sealed/"));
  if (m.kind === "evidence_only" && (m.sealed !== null || sealedEntries.length)) errors.push("/kind an evidence-only capsule carries no oracle or sealed attachment");
  if (m.kind === "training" && (m.sealed === null || sealedEntries.length !== 1)) errors.push("/sealed a training capsule carries exactly one separately sealed oracle attachment");
  for (const e of m.entries) if ((e.role === "sealed_oracle") !== e.path.startsWith("sealed/")) errors.push(`/entries ${e.path} role and location disagree`);
  return errors.length ? { ok: false, errors } : { ok: true, value: d as Record<string, unknown>, errors: [] };
}
export const labSchemas = { labLease: labLeaseSchema, repairExecution: repairExecutionSchema, repairVerification: repairVerificationSchema, repairRegression: repairRegressionSchema };
