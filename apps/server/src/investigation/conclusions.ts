import { INVESTIGATION_CONTRACTS, validateConclusion, type Conclusion, type ConclusionClaim, type InvestigationContract } from "@dk/contracts";

/**
 * Contract-level conclusion rules (LP08). The evidence-level checker (availability, scope, predicates, narrative
 * flags) builds on these in claims.ts (LP10).
 *
 * - `not_observed_in_scope` needs an assessable negative-claim requirement: complete activity retrieval AND covered
 *   coverage for that asset and action. Otherwise it is refused, however it is worded. With an assessor (li-next A), a
 *   claim whose predicate interval lies inside a sub-interval the coverage result shows as covered is assessable even
 *   when the whole interval is not; any window touching an uncovered span is still refused.
 * - `unresolved` needs at least one cited obligation that is genuinely unmet (unavailable, partial, failed or not yet
 *   attempted) with a reason; it may not cite only satisfied obligations to dodge a bounded answer.
 * - Every cited obligation must exist in the cited contract revision.
 * - No conclusion closes a case, approves an action or settles intent; those fields do not exist.
 */
export interface ContractClaimCheck { claim_id: string; ok: boolean; problems: string[] }

/** Sub-interval absence assessment (li-next A); without it only whole-interval requirements are used. */
export type AbsenceAssessor = (asset: string, action: string, after?: string, before?: string) => { assessable: boolean; reason: string };

export function checkAgainstContract(contract: InvestigationContract, conclusion: Conclusion, assess?: AbsenceAssessor): { ok: boolean; claims: ContractClaimCheck[]; problems: string[] } {
  const problems: string[] = [];
  if (conclusion.case_id !== contract.case_id) problems.push(`conclusion is for case ${conclusion.case_id}, contract is for ${contract.case_id}`);
  if (conclusion.run_id !== contract.run_id) problems.push(`conclusion names run ${conclusion.run_id ?? "(none)"}, contract run is ${contract.run_id ?? "(none)"}`);
  if (conclusion.contract_revision !== contract.revision) problems.push(`conclusion cites contract revision ${conclusion.contract_revision}; the current revision is ${contract.revision}`);
  const obligations = new Map(contract.obligations.map((o) => [o.id, o]));
  const claims = conclusion.claims.map((cl): ContractClaimCheck => {
    const p: string[] = [];
    const cited = cl.obligation_ids.map((id) => ({ id, o: obligations.get(id) }));
    for (const c of cited) if (!c.o) p.push(`cites unknown obligation ${c.id}`);
    if (cl.type === "not_observed_in_scope") {
      const target = negativeTarget(cl, contract);
      if (!target) p.push("a not_observed_in_scope claim must name (by predicate or cited coverage obligation) one asset and action in the contract scope");
      else {
        const req = contract.negative_claim_requirements.find((n) => n.asset_id === target.asset_id && n.action === target.action);
        if (!req) p.push(`no negative-claim requirement exists for ${target.action} on ${target.asset_id}; the contract cannot support that absence claim`);
        else if (!req.assessable) {
          // a claim confined (predicate after/before) to a covered sub-interval may be assessable although the whole interval is not
          const sub = assess && cl.predicate && (cl.predicate.after || cl.predicate.before) ? assess(target.asset_id, target.action, cl.predicate.after, cl.predicate.before) : null;
          if (!sub?.assessable) p.push(`negative claim not assessable: ${sub ? sub.reason : req.reason}`);
          else for (const r of req.requires) if (!cl.obligation_ids.includes(r)) p.push(`a negative claim must cite every obligation it rests on (${req.requires.join(", ")})`);
        } else for (const r of req.requires) if (!cl.obligation_ids.includes(r)) p.push(`a negative claim must cite every obligation it rests on (${req.requires.join(", ")})`);
      }
    }
    if (cl.type === "unresolved") {
      const unmet = cited.filter((c) => c.o && c.o.status !== "satisfied" && c.o.status !== "inapplicable_with_reason");
      if (!unmet.length) p.push("an unresolved claim must cite at least one obligation that is actually unmet");
    }
    if (cl.type === "observed" && cited.length && cited.every((c) => c.o && c.o.status === "inapplicable_with_reason")) p.push("an observed claim cannot rest only on obligations decided inapplicable");
    return { claim_id: cl.id, ok: p.length === 0, problems: [...new Set(p)] };
  });
  if (conclusion.requested_next_step === "bounded_conclusion" && contract.readiness !== "bounded_answer_ready") problems.push(`a bounded conclusion is requested but the contract is ${contract.readiness}: ${contract.readiness_reason}`);
  return { ok: problems.length === 0 && claims.every((c) => c.ok), claims, problems };
}

function negativeTarget(cl: ConclusionClaim, contract: InvestigationContract): { asset_id: string; action: string } | null {
  if (cl.predicate) return contract.scope.asset_ids.includes(cl.predicate.asset_id) ? { asset_id: cl.predicate.asset_id, action: cl.predicate.action } : null;
  const cov = cl.obligation_ids.map((id) => contract.obligations.find((o) => o.id === id)).filter((o) => o?.kind === "coverage");
  return cov.length === 1 ? { asset_id: cov[0]!.target.asset_id!, action: cov[0]!.target.action! } : null;
}

/**
 * The honest answer for an incomplete investigation, drafted deterministically from the contract alone: one
 * unresolved claim per unmet obligation (with its reason as the uncertainty), observable propositions only, no
 * negative claim and no statement about intent. Status `unresolved`; semantic review `not_reviewed`.
 */
export function draftUnresolvedConclusion(contract: InvestigationContract): Conclusion {
  const unmet = contract.obligations.filter((o) => o.status !== "satisfied" && o.status !== "inapplicable_with_reason");
  const claims: ConclusionClaim[] = unmet.slice(0, 50).map((o, i) => ({
    id: `unresolved-${i + 1}`, type: "unresolved",
    text: `${o.question} This part of the case question is not assessable from the records retrieved so far.`.slice(0, 2000),
    evidence_refs: [], coverage_refs: o.kind === "coverage" ? o.query_refs.filter((q) => q.startsWith("cov:")).slice(0, 200) : [], obligation_ids: [o.id],
    uncertainty: (o.reason || `obligation is ${o.status}`).slice(0, 1000).trim() || `obligation is ${o.status}`,
  }));
  const conclusion: Conclusion = {
    schema: INVESTIGATION_CONTRACTS.conclusion as "dk.local.conclusion.v1", case_id: contract.case_id, run_id: contract.run_id, contract_revision: contract.revision,
    claims: claims.length ? claims : [{ id: "unresolved-1", type: "unresolved", text: "No obligation is unmet; this draft is not needed.", evidence_refs: [], coverage_refs: [], obligation_ids: [contract.obligations[0]!.id], uncertainty: "nothing unresolved" }],
    status: "unresolved", semantic_review: "not_reviewed",
    scope_note: `Bounded to ${contract.scope.asset_ids.join(", ")} between ${contract.scope.after} and ${contract.scope.before}, contract revision ${contract.revision} (${contract.readiness}). A recording or retrieval gap is not proof that nothing happened, and nothing here states intent or authorization.`.slice(0, 2000),
    requested_next_step: contract.readiness === "collecting" || contract.readiness === "not_started" ? "retrieve_more" : "inspect_configuration",
  };
  const v = validateConclusion(conclusion);
  if (!v.ok) throw new Error(`internal: drafted conclusion failed validation: ${v.errors.join("; ")}`);
  return conclusion;
}
