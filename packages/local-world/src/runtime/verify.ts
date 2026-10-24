import { validateVerificationReceipt, type VerificationReceipt } from "@dk/contracts";
import type { EffectAnswer } from "./observer.ts";

/**
 * LP06: turning independent observations into probe results and a dk.local.verification_receipt.v1, and checking
 * corroboration by DECLARED source authority (server-side source records), never by what a payload says about itself.
 */
export interface ProbeInput { operation_id: string; expectation: "prohibited" | "permitted"; answer: EffectAnswer; evidence_refs: string[]; status: number }

export function probeOf(p: ProbeInput): VerificationReceipt["probes"][number] {
  const actual_effect = p.answer.status === "observed" ? "observed" : p.answer.status === "not_observed" ? "not_observed" : "unknown";
  const observer_scope = p.answer.status === "unknown" ? "unavailable" : "sufficient";
  const expected = p.expectation === "prohibited" ? "not_observed" : "observed";
  // An availability failure of the target is not enforcement, and an unknown effect is never "as expected".
  const result = actual_effect === "unknown" || p.status >= 500 || p.status === 0 ? "inconclusive" : actual_effect === expected && p.evidence_refs.length ? "as_expected" : actual_effect === expected ? "inconclusive" : "unexpected";
  return { operation_id: p.operation_id, expectation: p.expectation, actual_effect, observer_scope, evidence_refs: p.evidence_refs, result };
}

export function verificationReceipt(i: { run_id: string; plan_id: string; tested_target_revision: string; probes: VerificationReceipt["probes"]; cleanup: VerificationReceipt["cleanup"]; unassessed_paths?: string[] }): VerificationReceipt {
  const hasBoth = i.probes.some((p) => p.expectation === "prohibited") && i.probes.some((p) => p.expectation === "permitted");
  const security_verdict: VerificationReceipt["security_verdict"] = i.probes.some((p) => p.result === "unexpected") ? "fail" : hasBoth && i.probes.every((p) => p.result === "as_expected") ? "pass" : "inconclusive";
  const cleanOk = i.cleanup.outcome === "completed" || i.cleanup.outcome === "not_needed";
  const overall_outcome: VerificationReceipt["overall_outcome"] = security_verdict === "pass" && !cleanOk ? "inconclusive" : security_verdict;
  const r: VerificationReceipt = { schema: "dk.local.verification_receipt.v1", run_id: i.run_id, plan_id: i.plan_id, tested_target_revision: i.tested_target_revision, probes: i.probes, security_verdict, cleanup: i.cleanup, overall_outcome, scope: "local_run_only", unassessed_paths: i.unassessed_paths ?? [] };
  const v = validateVerificationReceipt(r);
  if (!v.ok) throw new Error(`verification receipt invalid: ${v.errors.join("; ")}`);
  return r;
}

export interface SourceAuthority { id: string; kind?: string; independence_group?: string | null; disabled?: boolean }
export interface EvidenceEvent { id: string; source_id: string; action: string; request_id?: string }

/**
 * Corroboration of one operation: self-reports (application/gateway instrumentation) are corroborated only by an
 * effect record from a source whose REGISTERED kind is effect_observer and whose independence group differs from
 * every self-reporting source's group. A relayed or self-reported record never corroborates itself.
 */
export function corroboration(events: EvidenceEvent[], sources: SourceAuthority[]) {
  const by = new Map(sources.map((s) => [s.id, s]));
  const group = (id: string) => by.get(id)?.independence_group || id;
  const selfReports = events.filter((e) => by.get(e.source_id)?.kind !== "effect_observer");
  const selfGroups = new Set(selfReports.map((e) => group(e.source_id)));
  const observerRecords = events.filter((e) => by.get(e.source_id)?.kind === "effect_observer");
  const independent = observerRecords.filter((e) => !selfGroups.has(group(e.source_id)));
  const sameGroup = observerRecords.filter((e) => selfGroups.has(group(e.source_id)));
  return {
    corroborated: selfReports.length > 0 && independent.length > 0,
    self_report_sources: [...new Set(selfReports.map((e) => e.source_id))].sort(),
    independent_sources: [...new Set(independent.map((e) => e.source_id))].sort(),
    not_independent: [...new Set(sameGroup.map((e) => e.source_id))].sort().map((s) => ({ source_id: s, reason: `shares independence group ${group(s)} with a self-reporting source` })),
    undeclared: [...new Set(events.filter((e) => !by.has(e.source_id)).map((e) => e.source_id))].sort(),
  };
}
