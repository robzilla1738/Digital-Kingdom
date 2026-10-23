import worldPlanSchema from "../schemas/local/world-plan.v1.schema.json" with { type: "json" };
import runProvenanceSchema from "../schemas/local/run-provenance.v1.schema.json" with { type: "json" };
import verificationReceiptSchema from "../schemas/local/verification-receipt.v1.schema.json" with { type: "json" };
import capabilityReceiptSchema from "../schemas/local/capability-receipt.v1.schema.json" with { type: "json" };
import * as generated from "./generated/validators.js";
import { formatErrors, type ValidationResult } from "./validate.ts";
import { SURFACES, type SupportLevel } from "./surfaces.ts";

/**
 * Local Intelligence Phase contracts (LP03): local run provenance, world plans (blueprint instances), verification
 * receipts and capability receipts.
 *
 * Run provenance is ORTHOGONAL to `dataset_kind`. `dataset_kind` keeps its v0.1/v0.2 meaning (synthetic demo data vs a
 * project that accepts live ingestion with real source keys); a project may additionally carry a local run
 * provenance record that says its records come from a locally running synthetic world. Nothing is relabelled: a
 * project without provenance reports `local_run: false`, never a guessed value.
 *
 * Every schema rejects unknown fields (so no command, image, script, URL, port, host or credential field can ride
 * along), and the semantic checks below add what JSON Schema cannot express.
 */
export const LOCAL_CONTRACTS = {
  world_plan: "dk.local.world_plan.v1",
  run_provenance: "dk.local.run_provenance.v1",
  verification_receipt: "dk.local.verification_receipt.v1",
  capability_receipt: "dk.local.capability_receipt.v1",
} as const;
export const LOCAL_LAB_LABEL = "Local laboratory — synthetic people and data";

export interface RunProvenance {
  schema: "dk.local.run_provenance.v1";
  run_id: string; world_plan_id: string; catalog_version: string;
  execution_mode: "local_runtime" | "fixture_delivery" | "scripted_replay";
  data_origin: "synthetic_local"; scope: "local_run_only"; external_validation: "not_performed";
  started_at?: string; label?: string;
}
export interface WorldPlan {
  schema: "dk.local.world_plan.v1"; plan_id: string; project_id: string; data_origin: "synthetic_local"; seed_commitment: string; catalog_version: string;
  resources: { id: string; template: string; depends_on: string[]; settings: { audit_enabled?: boolean; policy_variant?: "baseline" | "candidate" | "deliberately_weak"; tenant_mode?: "single" | "isolated" } }[];
  budget: { max_requests: number; max_seconds: number; max_parallel_operations: number; max_evidence_bytes: number };
  runtime_mode: "trusted_builtin_processes" | "operator_isolated_containers"; external_network: false;
}
export interface VerificationReceipt {
  schema: "dk.local.verification_receipt.v1"; run_id: string; plan_id: string; tested_target_revision: string;
  probes: { operation_id: string; expectation: "prohibited" | "permitted"; actual_effect: "observed" | "not_observed" | "unknown"; observer_scope: "sufficient" | "partial" | "unavailable"; evidence_refs: string[]; result: "as_expected" | "unexpected" | "inconclusive" }[];
  security_verdict: Verdict; cleanup: { outcome: "not_needed" | "completed" | "failed" | "pending"; notes: string }; overall_outcome: Verdict; scope: "local_run_only"; unassessed_paths: string[];
}
type Verdict = "pass" | "fail" | "inconclusive" | "refused";
export const CAPABILITY_TIERS = ["rendered", "declared", "instrumented", "local_verified", "externally_verified"] as const;
export type CapabilityTier = (typeof CAPABILITY_TIERS)[number];
export interface CapabilityReceipt {
  schema: "dk.local.capability_receipt.v1"; surface_id: string; level: Exclude<CapabilityTier, "rendered">;
  scope: { project_id: string; asset_id: string; run_id?: string };
  basis: "declared_inventory" | "source_delivery" | "control_test" | "local_verification_receipt" | "external_validation";
  evidence_refs: string[]; recorded_at: string;
}

const g = generated as unknown as Record<string, ((d: unknown) => boolean) & { errors?: unknown }>;
const schemaCheck = <T>(fn: ((d: unknown) => boolean) & { errors?: unknown }, data: unknown): ValidationResult<T> => fn(data) ? { ok: true, value: data as T, errors: [] } : { ok: false, errors: formatErrors(fn.errors as never) };
const withSemantics = <T>(r: ValidationResult<T>, sem: (v: T) => string[]): ValidationResult<T> => { if (!r.ok) return r; const e = sem(r.value!); return e.length ? { ok: false, errors: e } : r; };

export function validateRunProvenance(d: unknown): ValidationResult<RunProvenance> { return schemaCheck<RunProvenance>(g.validateRunProvenance!, d); }

export function validateWorldPlan(d: unknown): ValidationResult<WorldPlan> {
  return withSemantics(schemaCheck<WorldPlan>(g.validateWorldPlan!, d), (p) => {
    const errors: string[] = [];
    const ids = p.resources.map((r) => r.id);
    for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) errors.push(`/resources duplicate resource id ${id}`);
    for (const r of p.resources) for (const dep of r.depends_on) {
      if (!ids.includes(dep)) errors.push(`/resources/${r.id} depends on absent resource ${dep}`);
      if (dep === r.id) errors.push(`/resources/${r.id} depends on itself`);
    }
    // cycle detection (DFS)
    const state = new Map<string, 0 | 1 | 2>();
    const deps = new Map(p.resources.map((r) => [r.id, r.depends_on.filter((x) => ids.includes(x))]));
    const visit = (id: string, path: string[]): void => {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) { errors.push(`/resources dependency cycle ${[...path.slice(path.indexOf(id)), id].join(" -> ")}`); return; }
      state.set(id, 1); for (const d2 of deps.get(id) ?? []) visit(d2, [...path, id]); state.set(id, 2);
    };
    for (const id of ids) visit(id, []);
    return [...new Set(errors)];
  });
}

export function validateVerificationReceipt(d: unknown): ValidationResult<VerificationReceipt> {
  return withSemantics(schemaCheck<VerificationReceipt>(g.validateVerificationReceipt!, d), (v) => {
    const errors: string[] = [];
    const ops = v.probes.map((p) => p.operation_id);
    if (new Set(ops).size !== ops.length) errors.push("/probes each probe must correlate to a unique operation_id");
    const prohibited = v.probes.filter((p) => p.expectation === "prohibited"), permitted = v.probes.filter((p) => p.expectation === "permitted");
    for (const [i, p] of v.probes.entries()) {
      const expected = p.expectation === "prohibited" ? "not_observed" : "observed";
      if (p.result === "as_expected" && (p.actual_effect !== expected || p.observer_scope !== "sufficient")) errors.push(`/probes/${i} as_expected requires actual_effect ${expected} with sufficient observer scope`);
      if (p.result === "as_expected" && !p.evidence_refs.length) errors.push(`/probes/${i} as_expected requires evidence_refs`);
    }
    if (v.security_verdict === "pass") {
      if (!prohibited.length || !permitted.length) errors.push("/security_verdict pass requires at least one prohibited and one permitted probe");
      if (v.probes.some((p) => p.result !== "as_expected")) errors.push("/security_verdict pass requires every probe as_expected");
    }
    if (v.overall_outcome === "pass" && (v.security_verdict !== "pass" || (v.cleanup.outcome !== "completed" && v.cleanup.outcome !== "not_needed"))) errors.push("/overall_outcome pass requires a passing security verdict and completed (or unneeded) cleanup");
    return errors;
  });
}

export function validateCapabilityReceipt(d: unknown): ValidationResult<CapabilityReceipt> {
  return withSemantics(schemaCheck<CapabilityReceipt>(g.validateCapabilityReceipt!, d), (r) => {
    const errors: string[] = [];
    if (!SURFACES.some((s) => s.id === r.surface_id)) errors.push(`/surface_id unknown surface ${r.surface_id}`);
    const allowed: Record<CapabilityReceipt["level"], CapabilityReceipt["basis"][]> = { declared: ["declared_inventory"], instrumented: ["source_delivery"], local_verified: ["control_test", "local_verification_receipt"], externally_verified: ["external_validation"] };
    if (!allowed[r.level].includes(r.basis)) errors.push(`/basis ${r.basis} cannot support level ${r.level}`);
    if (r.level === "local_verified" && !r.scope.run_id) errors.push("/scope local_verified requires the local run_id it was verified in");
    return errors;
  });
}

/**
 * Support matrix: how the existing R06.2 registry levels map onto the phase's five tiers. The registry level is a
 * product-wide ceiling for a surface family; it is never a badge for a specific asset.
 */
export const SUPPORT_TIER_OF: Record<SupportLevel, CapabilityTier> = {
  not_implemented: "rendered", declared: "declared", discovered: "declared", instrumented: "instrumented", analyzed: "instrumented", lab_verified: "local_verified", live_verified: "externally_verified",
};

export interface CapabilityBadge {
  surface_id: string; asset_id: string; tier: CapabilityTier; rendered: true;
  basis: { level: CapabilityTier; ref: string[]; basis: string }[];
  rejected: { reason: string; receipt: unknown }[];
  registry_ceiling: CapabilityTier; note: string;
}

/**
 * Derive one asset's capability badge from scoped receipts ONLY. The surface family, the registry text and any
 * model-authored statement are not inputs. Receipts outside the project/asset/surface scope, malformed receipts and
 * externally_verified receipts (deferred gate EXT01; no external validation exists in this phase unless the caller
 * explicitly allows it) are rejected and listed. A tier is never raised above the registry ceiling for the surface.
 */
export function deriveCapability(scope: { project_id: string; asset_id: string; surface_id: string }, receipts: unknown[], opts: { allowExternal?: boolean } = {}): CapabilityBadge {
  const surface = SURFACES.find((s) => s.id === scope.surface_id);
  const ceiling = surface ? SUPPORT_TIER_OF[surface.support] : "rendered";
  const accepted: CapabilityReceipt[] = [], rejected: { reason: string; receipt: unknown }[] = [];
  for (const raw of receipts) {
    const v = validateCapabilityReceipt(raw);
    if (!v.ok) { rejected.push({ reason: v.errors.join("; "), receipt: raw }); continue; }
    const r = v.value!;
    if (r.scope.project_id !== scope.project_id || r.scope.asset_id !== scope.asset_id || r.surface_id !== scope.surface_id) { rejected.push({ reason: "out of scope for this project, asset or surface", receipt: raw }); continue; }
    if (r.level === "externally_verified" && !opts.allowExternal) { rejected.push({ reason: "external validation is a deferred gate (EXT01); not accepted in this phase", receipt: raw }); continue; }
    accepted.push(r);
  }
  const rank = (t: CapabilityTier) => CAPABILITY_TIERS.indexOf(t);
  const best = accepted.reduce<CapabilityTier>((b, r) => (rank(r.level) > rank(b) ? r.level : b), "rendered");
  const tier = rank(best) > rank(ceiling) ? ceiling : best;
  return {
    surface_id: scope.surface_id, asset_id: scope.asset_id, tier, rendered: true,
    basis: accepted.map((r) => ({ level: r.level, ref: r.evidence_refs, basis: r.basis })), rejected, registry_ceiling: ceiling,
    note: tier === "rendered" ? "Drawn only; no scoped record supports any capability." : rank(best) > rank(ceiling) ? `Receipts reach ${best}, capped at the registry ceiling ${ceiling} for this surface.` : `Supported by ${accepted.filter((r) => r.level === tier).length} scoped receipt(s) at ${tier}.`,
  };
}

export const localSchemas = { worldPlan: worldPlanSchema, runProvenance: runProvenanceSchema, verificationReceipt: verificationReceiptSchema, capabilityReceipt: capabilityReceiptSchema };
