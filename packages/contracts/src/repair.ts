import repairPlanSchema from "../schemas/local/repair-plan.v1.schema.json" with { type: "json" };
import * as generated from "./generated/validators.js";
import { formatErrors, type ValidationResult } from "./validate.ts";

/**
 * Local Intelligence Phase LP14 repair plans (`dk.local.repair_plan.v1`), adopted from the phase package proposal
 * (`dk.local.repair_plan.proposed.v1`) the same way LP03/LP08 adopted theirs: the id drops `proposed`, every object
 * rejects unknown fields, and the semantic checks below add what JSON Schema cannot express.
 *
 * A repair plan is PLAN-ONLY. It names finite local action types against run-owned test resources, is bound to an
 * exact baseline digest and candidate digest, and carries the tests that must show the prohibited operation refused
 * and the permitted operation still working. Nothing in this contract executes, approves or publishes anything.
 */
export const REPAIR_CONTRACTS = { repair_plan: "dk.local.repair_plan.v1" } as const;
export const REPAIR_ACTION_TYPES = ["set_gateway_policy", "deactivate_test_token", "remove_test_grant", "select_test_artifact", "restart_test_observer"] as const;
export type RepairActionType = (typeof REPAIR_ACTION_TYPES)[number];
/** The single parameter each action type takes. */
export const REPAIR_ACTION_PARAMETER: Record<RepairActionType, "policy_ref" | "token_ref" | "grant_ref" | "artifact_ref" | "observer_ref"> = {
  set_gateway_policy: "policy_ref", deactivate_test_token: "token_ref", remove_test_grant: "grant_ref", select_test_artifact: "artifact_ref", restart_test_observer: "observer_ref",
};
export interface RepairAction { id: string; target_resource_id: string; type: RepairActionType; parameters: Partial<Record<"policy_ref" | "token_ref" | "grant_ref" | "artifact_ref" | "observer_ref", string>>; expected_target_revision: string }
export interface RepairPlan {
  schema: "dk.local.repair_plan.v1"; plan_id: string; run_id: string; case_id: string; baseline_digest: string; candidate_digest: string;
  actions: RepairAction[]; verification_test_ids: string[]; positive_control_ids: string[]; residual_unknowns: string[]; authority: "plan_only"; expires_at: string;
}

const g = generated as unknown as Record<string, ((d: unknown) => boolean) & { errors?: unknown }>;
/** Schema + semantics. `now` (ms) checks expiry when given. */
export function validateRepairPlan(d: unknown, opts: { now?: number } = {}): ValidationResult<RepairPlan> {
  const fn = g.validateRepairPlan!;
  if (!fn(d)) return { ok: false, errors: formatErrors(fn.errors as never) };
  const p = d as RepairPlan;
  const errors: string[] = [];
  const ids = p.actions.map((a) => a.id);
  if (new Set(ids).size !== ids.length) errors.push("/actions duplicate action id");
  for (const [i, a] of p.actions.entries()) {
    const want = REPAIR_ACTION_PARAMETER[a.type];
    const keys = Object.keys(a.parameters);
    if (keys.length !== 1 || keys[0] !== want) errors.push(`/actions/${i} ${a.type} takes exactly one parameter, ${want}`);
  }
  if (p.baseline_digest === p.candidate_digest) errors.push("/candidate_digest must differ from baseline_digest (a plan must change something)");
  const overlap = p.verification_test_ids.filter((t) => p.positive_control_ids.includes(t));
  if (overlap.length) errors.push(`/positive_control_ids overlap verification tests: ${overlap.join(", ")} (a positive control must be a different, permitted operation)`);
  if (opts.now !== undefined && !(Date.parse(p.expires_at) > opts.now)) errors.push("/expires_at is in the past");
  return errors.length ? { ok: false, errors } : { ok: true, value: p, errors: [] };
}
export const repairSchemas = { repairPlan: repairPlanSchema };
