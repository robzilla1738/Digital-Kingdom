/**
 * li-next D — BENCHMARK DISTRACTOR templates (`dk.bench.distractor_templates.v1`).
 *
 * Reviewed, typed, PLAN-ONLY local templates that exist only to be wrong in a known way, so the selection benchmark has
 * candidates that are irrelevant, overbroad (also break permitted behaviour), leave residual prohibited access, or
 * "look" like a fix while the observer is stopped. They are NOT part of the product generator (`REPAIR_TEMPLATES` in
 * apps/server/src/repair.ts never emits them) and their overbroad/residual policy references are accepted only by a
 * supervisor started with `benchmarkDistractorVariants: true`.
 *
 * Each distractor yields a validated `dk.local.repair_plan.v1` (authority plan_only) bound to the same baseline digest
 * as the generator's candidates, with model-only predicted effects from the declared semantics below
 * (`dk.bench.distractor_model.v1`, mirroring the built-in local services). Executed behaviour is established only by the
 * independent verifier after a leased execution, never by this table.
 *
 * The `benchmark_distractor` flag and the `class` are the benchmark's private answer key: the selector view shows only
 * the neutral template id, target, explanation, plan and predicted effects.
 */
import { createHash } from "node:crypto";
import { canonicalJson, validateRepairPlan, type RepairPlan } from "../../../packages/contracts/src/index.ts";
import type { Holds, VisibleProbe } from "./selectors.ts";

export const BENCH_DISTRACTOR_CATALOG = "dk.bench.distractor_templates.v1";
export const BENCH_DISTRACTOR_MODEL = "dk.bench.distractor_model.v1";
export type OptionClass = "correct" | "wrong" | "overbroad" | "residual" | "unobserved_trap" | "misleading";
export interface DistractorTemplate {
  id: string; version: 1; benchmark_distractor: true; class: Exclude<OptionClass, "correct">;
  type: "set_gateway_policy" | "restart_test_observer"; target: string; ref: string; explanation: string;
}
export const BENCH_DISTRACTOR_TEMPLATES: readonly DistractorTemplate[] = [
  { id: "edge-session-policy", version: 1, benchmark_distractor: true, class: "wrong", type: "set_gateway_policy", target: "ingress", ref: "policy:candidate",
    explanation: "Require a world session at the storefront edge for tenant API routes (the edge does not decide tenant access)." },
  { id: "tenant-api-lockdown", version: 1, benchmark_distractor: true, class: "overbroad", type: "set_gateway_policy", target: "api", ref: "policy:bench_overbroad",
    explanation: "Put the tenant API in lockdown: refuse every user request, whichever tenant it names." },
  { id: "tenant-b-allowlist", version: 1, benchmark_distractor: true, class: "residual", type: "set_gateway_policy", target: "api", ref: "policy:bench_residual",
    explanation: "Protect tenant-b records at the tenant API: refuse other tenants' reads of tenant-b." },
  { id: "tenant-policy-instead-of-observer", version: 1, benchmark_distractor: true, class: "unobserved_trap", type: "set_gateway_policy", target: "api", ref: "policy:baseline",
    explanation: "Return the tenant API to its reviewed baseline policy (does not touch the observer)." },
  // MISLEADING PREDICTION: the declared model (below) predicts full tenant isolation with nothing left unknown; the
  // runtime variant is bound to the non-read routes only (writes, jobs), so the prohibited cross-tenant READS stay open. Only a leased
  // execution + the independent verifier can tell; the selector never sees either before it chooses.
  { id: "tenant-records-isolation-rule", version: 1, benchmark_distractor: true, class: "misleading", type: "set_gateway_policy", target: "api", ref: "policy:bench_misbound",
    explanation: "Apply the tenant-isolation rule to tenant record requests at the tenant API: refuse a tenant's requests for another tenant's records; own-tenant requests unchanged." },
  { id: "restart-running-observer", version: 1, benchmark_distractor: true, class: "wrong", type: "restart_test_observer", target: "audit", ref: "audit",
    explanation: "Restart the run's audit observer." },
] as const;

export interface StateElement { kind: string; id: string; attrs: Record<string, unknown> }
const sha = (v: unknown) => createHash("sha256").update(canonicalJson(v)).digest("hex");

/**
 * Declared tenant decision (for record READS) of the api with a given policy variant. This is the MODEL: it mirrors the
 * built-in tenant API for every variant EXCEPT `bench_misbound`, whose declared semantics ("tenant isolation for tenant
 * records") are deliberately what the model believes, while the runtime binds the rule to the non-read routes only. That
 * gap is the benchmark's misleading prediction; it is labelled here and never reaches the selector view as a label.
 */
export function apiTenantDecision(variant: string, tenantMode: string, tenant: string, target: string): "allows" | "denies" {
  if (variant === "bench_misbound") return tenant !== target ? "denies" : "allows"; // MISPREDICTION (declared, not runtime)
  if (variant === "bench_overbroad") return "denies";
  if (variant === "bench_residual") return tenant !== target && target === "tenant-b" ? "denies" : "allows";
  return tenantMode === "isolated" && variant !== "deliberately_weak" && tenant !== target ? "denies" : "allows";
}
/** Model-only prediction of one probe in a state with the api/ingress variants given (observer states as reported). */
export function predictProbe(p: VisibleProbe, policies: Record<string, { variant: string; tenant_mode?: string }>, observers: Record<string, string>): Holds {
  if (p.kind === "tenant_access") {
    const api = policies.api;
    if (!api) return "unknown";
    return apiTenantDecision(api.variant, api.tenant_mode ?? "isolated", p.tenant!, p.target_tenant!) === "allows" ? "holds" : "does_not_hold";
  }
  if (p.kind === "observer_gap") {
    const st = observers[p.source_id!];
    if (st === undefined) return "unknown"; // no observer of that resource exists in the reported state
    return st === "running" ? "does_not_hold" : st === "stopped" || st === "misconfigured" ? "holds" : "unknown";
  }
  return "unknown";
}

export interface BenchOption {
  key: string; origin: "generator" | "benchmark_distractor"; class: OptionClass; template: string; target: string; explanation: string;
  plan: RepairPlan; actions: string[];
  predicted: { valid: boolean; blocked: number; of: number; still_possible: string[]; unknown: string[]; permitted_broken: string[]; unknowns: string[] };
  expected_impact: { probe: string; role: "prohibited" | "permitted"; before: Holds; after: Holds }[];
  prerequisites: string[]; generator_rank: number | null;
}
export const actionsOf = (pl: RepairPlan) => pl.actions.map((a) => `${a.type}@${a.target_resource_id} ${Object.values(a.parameters).join(",")}`);
export const optionKey = (template: string, pl: RepairPlan) => `${template}|${actionsOf(pl).join(";")}`;

/** Distractor options for a case, as plan-only plans bound to the baseline digest of the current analysis state. */
export function distractorOptions(i: { ids: string[]; elements: StateElement[]; state_hash: string; run_id: string; case_id: string; prohibited: VisibleProbe[]; permitted: VisibleProbe[]; now: number }): BenchOption[] {
  const pols = Object.fromEntries(i.elements.filter((e) => e.kind === "policy").map((e) => [String(e.attrs.asset_id), { variant: String(e.attrs.variant), tenant_mode: e.attrs.tenant_mode as string | undefined, revision: String(e.attrs.revision ?? "") }]));
  const obs = Object.fromEntries(i.elements.filter((e) => e.kind === "observer").map((e) => [String(e.attrs.observer_id), { state: String(e.attrs.state), revision: String(e.attrs.revision ?? "") }]));
  const obsStates = Object.fromEntries(Object.entries(obs).map(([k, v]) => [k, v.state]));
  const out: BenchOption[] = [];
  for (const id of i.ids) {
    const t = BENCH_DISTRACTOR_TEMPLATES.find((x) => x.id === id);
    if (!t) throw new Error(`unknown distractor template ${id}`);
    const revision = t.type === "restart_test_observer" ? obs[t.target]?.revision : pols[t.target]?.revision;
    if (!revision) continue; // the target is not in the reported state: the template does not apply
    const afterPols = { ...pols }, afterObs = { ...obsStates };
    if (t.type === "set_gateway_policy") afterPols[t.target] = { ...pols[t.target]!, variant: t.ref.slice("policy:".length) };
    else afterObs[t.target] = "running";
    const all = [...i.prohibited.map((p) => ({ p, role: "prohibited" as const })), ...i.permitted.map((p) => ({ p, role: "permitted" as const }))];
    const impact = all.map(({ p, role }) => ({ probe: p.id, role, before: predictProbe(p, pols, obsStates), after: predictProbe(p, afterPols, afterObs) }));
    const pro = impact.filter((x) => x.role === "prohibited"), per = impact.filter((x) => x.role === "permitted");
    const blocked = pro.filter((x) => x.before === "holds" && x.after === "does_not_hold").map((x) => x.probe);
    const plan: RepairPlan = {
      schema: "dk.local.repair_plan.v1", plan_id: `rp-${sha({ s: i.state_hash, t: t.id }).slice(0, 16)}`, run_id: i.run_id, case_id: i.case_id,
      baseline_digest: i.state_hash, candidate_digest: sha({ base: i.state_hash, template: t.id, ref: t.ref, target: t.target }),
      actions: [{ id: "action-1", target_resource_id: t.target, type: t.type, parameters: t.type === "set_gateway_policy" ? { policy_ref: t.ref } : { observer_ref: t.ref }, expected_target_revision: revision }],
      verification_test_ids: i.prohibited.map((p) => p.id), positive_control_ids: i.permitted.map((p) => p.id),
      residual_unknowns: pro.filter((x) => x.after === "unknown").map((x) => `${x.probe}: unknown after the change`), authority: "plan_only", expires_at: new Date(i.now + 3600_000).toISOString(),
    };
    const v = validateRepairPlan(plan, { now: i.now });
    if (!v.ok) throw new Error(`distractor ${t.id} plan invalid: ${v.errors.join("; ")}`);
    out.push({
      key: optionKey(t.id, plan), origin: "benchmark_distractor", class: t.class, template: t.id, target: `${t.target}@${t.ref}`, explanation: t.explanation, plan, actions: actionsOf(plan),
      predicted: { valid: blocked.length > 0, blocked: blocked.length, of: pro.length, still_possible: pro.filter((x) => x.after === "holds").map((x) => x.probe), unknown: pro.filter((x) => x.after === "unknown").map((x) => x.probe), permitted_broken: per.filter((x) => x.before === "holds" && x.after !== "holds").map((x) => x.probe), unknowns: plan.residual_unknowns },
      expected_impact: impact, prerequisites: ["a supervisor lab lease scoped to this plan"], generator_rank: null,
    });
  }
  return out;
}
