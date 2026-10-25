import { canonicalJson, validateConclusion, type Conclusion, type ConclusionClaim, type InvestigationContract, type SecurityEvent } from "@dk/contracts";
import { sha256 } from "../security.ts";
import type { Store } from "../store.ts";
import type { InvestigationContracts } from "./contracts.ts";
import { checkAgainstContract } from "./conclusions.ts";
import { sameScopeRevisions } from "./packets.ts";
import { assessAbsence, bearingUnmet, coverageScopes, type CoverageScope } from "./scoping.ts";

/**
 * Structured claim checker (Local Intelligence Phase LP10).
 *
 * Checks, separately and per claim: the conclusion schema; the contract rules (LP08); every cited reference for
 * EXISTENCE (a stored record of this project, or a coverage result of this contract), SCOPE (this project/run, inside
 * the contract's assets and interval, or delivered under a finding-bound obligation, and retrieved under a contract
 * revision with the SAME scope) and AVAILABILITY (actually delivered to the investigator through a job, a packet page
 * or an inspection — existing is not enough); and the optional structured predicate against the cited, available
 * records (for an absence claim, against the complete retrieval of that asset).
 *
 * Natural-language text is never machine-checked. A claim whose references pass but has no predicate is
 * `references_checked_narrative_unverified`; only a holding predicate earns `predicate_checked`, and that label
 * covers the predicate alone, not nearby prose. Intent/authorization and absolute wording are flagged as unsupported
 * narrative and keep the conclusion a `draft` that needs semantic review (deferred gate EXT05). Nothing here is ever
 * labelled "machine proved", and nothing closes a case or approves an action.
 */
export const CLAIM_CHECK_SCHEMA = "dk.claim_check.v1";
export type SupportLevel = "predicate_checked" | "references_checked_narrative_unverified" | "unresolved_documented" | "failed";

const NARRATIVE_FLAGS: { id: string; re: RegExp; why: string }[] = [
  { id: "intent_or_attribution", re: /\b(malicious(ly)?|attack(er|ers)?|adversar(y|ies)|intentional(ly)?|deliberate(ly)?|insider|threat actor|hacker|compromis(e|ed|ing)|exfiltrat\w*|st(o|ea)le|theft|breach(ed)?)\b/i, why: "intent, attribution or impact cannot be established from telemetry by this checker" },
  { id: "authorization_judgement", re: /\b(unauthori[sz]ed|authori[sz]ed|approved|permitted by policy|legitimate|benign|sanctioned)\b/i, why: "authorization and approval need a record outside the telemetry (owner, approver, change record)" },
  { id: "absolute_or_proof", re: /\b(proves?|proven|definitely|certainly|conclusively|guaranteed?|without doubt|no doubt|always|impossible)\b/i, why: "absolute or proof language is not supported by bounded, scoped records" },
];
const NEGATION = /\b(no|not|never|nothing|none|neither|nor|without)\b/i;

interface RefCheck { ref: string; kind: "event" | "coverage" | "unknown"; exists: boolean; in_scope: boolean; available: boolean; problems: string[] }
export interface ClaimResult {
  claim_id: string; type: ConclusionClaim["type"]; support_level: SupportLevel; machine_proved: false;
  references: RefCheck[]; coverage_refs: RefCheck[];
  predicate: { present: boolean; holds: boolean | null; detail: string; matching_refs?: string[]; contradicting_refs?: string[] };
  narrative: { machine_checked: false; flags: { id: string; phrase: string; why: string }[] };
  /** li-next A: which unmet obligations actually bear on this claim (by asset, action, interval); none for positive observations. */
  uncertainty_scope: { bearing_unmet_obligations: string[]; note: string };
  problems: string[];
}

export class ClaimChecker {
  constructor(private readonly store: Store, private readonly contracts: InvestigationContracts) {}
  private get db() { return this.store.db; }

  check(projectId: string, caseId: string, raw: unknown) {
    const v = validateConclusion(raw);
    const view = this.contracts.view(projectId, caseId);
    const contract = view.contract;
    if (!v.ok) return this.result(contract, raw, "rejected", [], [`schema: ${v.errors.join("; ")}`], view.stale);
    const c = v.value!;
    const revs = sameScopeRevisions(this.store, contract.id, contract.revision);
    const scopes = coverageScopes(this.store, contract.id, revs);
    const base = checkAgainstContract(contract, c, (asset, action, after, before) => assessAbsence(contract, scopes, asset, action, after, before));
    // every delivery under this contract, with the revision it was delivered under and its channel
    const deliveries = this.db.prepare("SELECT ref, kind, contract_revision, channel, channel_id, step_id FROM investigation_deliveries WHERE contract_id = ?").all(contract.id) as { ref: string; kind: string; contract_revision: number; channel: string; channel_id: string; step_id: string }[];
    const byRef = new Map<string, typeof deliveries>();
    for (const d of deliveries) { const a = byRef.get(d.ref) ?? []; a.push(d); byRef.set(d.ref, a); }
    const findingBoundSteps = new Set((this.db.prepare("SELECT s.job_id || ':' || s.step_id AS k FROM investigation_job_steps s JOIN investigation_jobs j ON j.id = s.job_id WHERE j.contract_id = ? AND s.kind IN ('recipe','bundle_read','linked_events')").all(contract.id) as { k: string }[]).map((r) => r.k));
    const allRefs = [...new Set(c.claims.flatMap((cl) => [...cl.evidence_refs, ...cl.coverage_refs]))];
    const events = new Map(this.store.eventsByIds(projectId, allRefs).map((e) => [e.id, e]));
    const elsewhere = new Set(allRefs.filter((r) => !events.has(r)).filter((r) => this.db.prepare("SELECT 1 FROM events WHERE id = ? AND project_id <> ?").get(r, projectId)));
    const a = Date.parse(contract.scope.after), b = Date.parse(contract.scope.before);

    const checkRef = (ref: string, expect: "event" | "coverage" | "any"): RefCheck => {
      const ds = byRef.get(ref) ?? [];
      const e = events.get(ref);
      const covDelivery = ds.filter((d) => d.kind === "coverage");
      const kind: RefCheck["kind"] = e ? "event" : covDelivery.length ? "coverage" : "unknown";
      const p: string[] = [];
      if (kind === "unknown") {
        if (elsewhere.has(ref)) return { ref, kind, exists: true, in_scope: false, available: false, problems: [`scope: ${ref} belongs to another project/run, not ${projectId}`] };
        return { ref, kind, exists: false, in_scope: false, available: false, problems: [`existence: no stored record or coverage result named ${ref} in this project`] };
      }
      if (expect === "coverage" && kind !== "coverage") p.push(`${ref} is not a coverage result; coverage_refs must name coverage results (cov:...) of this contract`);
      if (expect === "event" && kind === "coverage") p.push(`${ref} is a coverage result, not a record; cite it in coverage_refs`);
      const sameScope = ds.filter((d) => revs.has(d.contract_revision));
      const otherScope = ds.filter((d) => !revs.has(d.contract_revision));
      let inScope = true;
      if (kind === "event") {
        const touches = e!.asset_ids.some((x) => contract.scope.asset_ids.includes(x)) && Date.parse(e!.occurred_at) >= a && Date.parse(e!.occurred_at) <= b;
        const findingBound = sameScope.some((d) => d.channel === "job" && findingBoundSteps.has(`${d.channel_id}:${d.step_id}`)) || this.isLinkedFindingEvent(caseId, projectId, ref);
        if (!touches && !findingBound) { inScope = false; p.push(`scope: ${ref} is outside the contract's assets/interval and is not evidence of a linked finding`); }
      }
      if (!sameScope.length && otherScope.length) { inScope = false; p.push(`scope: ${ref} was retrieved under contract revision ${otherScope.map((d) => d.contract_revision).join(", ")}, whose scope differs from revision ${contract.revision}`); }
      const available = sameScope.length > 0;
      if (!available && !otherScope.length) p.push(`availability: ${ref} exists but was never delivered to the investigator under this contract (job, packet page or inspection)`);
      return { ref, kind, exists: true, in_scope: inScope, available, problems: p };
    };

    const claims: ClaimResult[] = c.claims.map((cl) => {
      const problems = [...(base.claims.find((x) => x.claim_id === cl.id)?.problems ?? [])];
      const references = cl.evidence_refs.map((r) => checkRef(r, "event"));
      const coverage = cl.coverage_refs.map((r) => checkRef(r, "coverage"));
      for (const r of [...references, ...coverage]) problems.push(...r.problems);
      const flags = NARRATIVE_FLAGS.flatMap((f) => { const m = cl.text.match(f.re); return m ? [{ id: f.id, phrase: m[0], why: f.why }] : []; });
      if (cl.type === "observed" && NEGATION.test(cl.text)) flags.push({ id: "negation_in_observed_claim", phrase: cl.text.match(NEGATION)![0], why: "an observed claim states what a record shows; absence belongs in a not_observed_in_scope claim with coverage" });
      const predicate = this.predicate(contract, cl, references, events, deliveries, revs, scopes);
      if (predicate.present && predicate.holds === false) problems.push(`predicate does not hold: ${predicate.detail}`);
      const failed = problems.length > 0;
      const support: SupportLevel = failed ? "failed" : cl.type === "unresolved" ? "unresolved_documented" : predicate.present && predicate.holds ? "predicate_checked" : "references_checked_narrative_unverified";
      const bearing = bearingUnmet(contract, scopes, cl);
      const uncertainty_scope = { bearing_unmet_obligations: bearing, note: cl.type === "observed" ? "a recorded positive observation: no coverage gap or unmet obligation weakens what a delivered record shows" : cl.type === "unresolved" ? "documents an unmet obligation" : bearing.length ? `absence here rests on unmet obligation(s): ${bearing.join(", ")}` : "no unmet obligation bears on this claim's asset, action and interval" };
      return { claim_id: cl.id, type: cl.type, support_level: support, machine_proved: false, references, coverage_refs: coverage, predicate, narrative: { machine_checked: false, flags }, uncertainty_scope, problems: [...new Set(problems)] };
    });
    const failed = !base.ok || claims.some((x) => x.support_level === "failed");
    const flagged = claims.some((x) => x.narrative.flags.length);
    const status = failed ? "rejected" : flagged ? "draft" : c.claims.some((x) => x.type === "unresolved") || contract.readiness === "unresolved_answer_ready" ? "unresolved" : "machine_checked_structured";
    return this.result(contract, c, status, claims, base.problems, view.stale);
  }

  private isLinkedFindingEvent(caseId: string, projectId: string, ref: string) {
    const items = this.db.prepare("SELECT ref, body FROM case_items WHERE case_id = ? AND kind = 'finding' AND removed_at IS NULL").all(caseId) as { ref: string; body: string }[];
    for (const it of items) {
      const rev = (JSON.parse(it.body) as { revision?: number }).revision;
      const row = this.db.prepare("SELECT body FROM finding_revisions WHERE project_id = ? AND finding_id = ? AND revision = ?").get(projectId, it.ref, rev ?? -1) as { body: string } | undefined;
      if (row) { const f = JSON.parse(row.body) as { event_ids: string[]; counterevidence_event_ids: string[] }; if (f.event_ids.includes(ref) || f.counterevidence_event_ids.includes(ref)) return true; }
    }
    return false;
  }

  private predicate(contract: InvestigationContract, cl: ConclusionClaim, refs: RefCheck[], events: Map<string, SecurityEvent>, deliveries: { ref: string; kind: string; contract_revision: number; channel: string; channel_id: string; step_id: string }[], revs: Set<number>, scopes: Map<string, CoverageScope>): ClaimResult["predicate"] {
    const p = cl.predicate;
    if (!p) return { present: false, holds: null, detail: "no structured predicate: only references were checked; the text is not machine-checked" };
    const after = Date.parse(p.after ?? contract.scope.after), before = Date.parse(p.before ?? contract.scope.before);
    if (!contract.scope.asset_ids.includes(p.asset_id)) return { present: true, holds: false, detail: `asset ${p.asset_id} is outside the contract scope` };
    if (after < Date.parse(contract.scope.after) || before > Date.parse(contract.scope.before)) return { present: true, holds: false, detail: "predicate interval extends beyond the contract interval" };
    const matches = (e: SecurityEvent) => e.asset_ids.includes(p.asset_id) && e.action === p.action && (!p.outcome || e.outcome === p.outcome) && (!p.actor_ref || e.actor_ref === p.actor_ref) && Date.parse(e.occurred_at) >= after && Date.parse(e.occurred_at) <= before;
    if (p.kind === "action_observed") {
      const usable = refs.filter((r) => r.kind === "event" && r.available && r.in_scope).map((r) => events.get(r.ref)!).filter(Boolean);
      const m = usable.filter(matches).map((e) => e.id);
      return m.length ? { present: true, holds: true, detail: `${m.length} cited, delivered, in-scope record(s) match ${p.action} on ${p.asset_id}${p.outcome ? ` (${p.outcome})` : ""}${p.actor_ref ? ` by ${p.actor_ref} within its source namespace` : ""}`, matching_refs: m }
        : { present: true, holds: false, detail: `no cited, delivered, in-scope record matches ${p.action} on ${p.asset_id}${p.outcome ? ` (${p.outcome})` : ""}${p.actor_ref ? ` by ${p.actor_ref}` : ""} in the interval` };
    }
    // action_not_observed: the negative requirement (complete retrieval + coverage) is checked by the contract rules;
    // here the complete retrieval itself is searched for a contradicting record.
    // assessable for the whole interval, or (li-next A) for the claim's own covered sub-interval
    const ass = assessAbsence(contract, scopes, p.asset_id, p.action, p.after, p.before);
    if (!ass.assessable) return { present: true, holds: false, detail: `absence of ${p.action} on ${p.asset_id} is not assessable (${ass.reason})` };
    const act = contract.obligations.find((o) => o.id === `activity:${p.asset_id}`)!;
    const stepRefs = new Set(act.query_refs);
    const retrieved = deliveries.filter((d) => d.channel === "job" && d.kind === "event" && revs.has(d.contract_revision) && stepRefs.has(`${d.channel_id}:${d.step_id}`)).map((d) => d.ref);
    const stored = new Map(this.store.eventsByIds(contract.project_id, retrieved).map((e) => [e.id, e]));
    const contra = retrieved.filter((id) => stored.get(id) && matches(stored.get(id)!));
    return contra.length ? { present: true, holds: false, detail: `${contra.length} record(s) in the complete retrieval of ${p.asset_id} show ${p.action}`, contradicting_refs: contra.slice(0, 50) }
      : { present: true, holds: true, detail: `no record matching ${p.action} on ${p.asset_id} in the complete retrieval (${retrieved.length} record(s)) while coverage was continuous${ass.scope === "sub_interval" ? ` in ${p.after ?? contract.scope.after}..${p.before ?? contract.scope.before}` : ""}; this is absence in stored records within ${ass.scope === "sub_interval" ? "that sub-interval" : "the interval"} only` };
  }

  private result(contract: InvestigationContract, conclusion: unknown, status: "rejected" | "draft" | "unresolved" | "machine_checked_structured", claims: ClaimResult[], problems: string[], stale: boolean) {
    return {
      schema: CLAIM_CHECK_SCHEMA, conclusion_digest: sha256(canonicalJson(conclusion ?? null)), contract: { id: contract.id, revision: contract.revision, readiness: contract.readiness, stale },
      status, semantic_review: "not_reviewed" as const, claims, problems,
      labels: { machine_proved: false as const, semantic_entailment_checked: false as const },
      notes: [
        "predicate_checked covers the structured predicate only; prose is never machine-checked.",
        "references_checked_narrative_unverified means the cited records exist, are in scope and were delivered; it does not mean they support the text.",
        "Flagged narrative keeps the conclusion a draft that needs semantic review (deferred: EXT05). No result here approves an action or closes the case.",
      ],
    };
  }
}

/** Persisted conclusion proposals (analyst write): the conclusion plus the check result at proposal time. */
export function proposeConclusion(store: Store, checker: ClaimChecker, projectId: string, caseId: string, conclusion: unknown, actor: string, principalType: string, contractId: string) {
  return store.transaction(() => {
    const check = checker.check(projectId, caseId, conclusion);
    const id = "cp_" + sha256(`${projectId}:${caseId}:${check.conclusion_digest}:${store.now().toISOString()}:${Math.random()}`).slice(0, 16);
    store.db.prepare("INSERT INTO investigation_conclusions (id, project_id, case_id, contract_id, contract_revision, body, check_result, status, created_by, principal_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, projectId, caseId, contractId, check.contract.revision, canonicalJson(conclusion ?? null), canonicalJson(check), check.status, actor, principalType, store.now().toISOString());
    store.audit(actor, "investigation_conclusion.propose", projectId, id, { case_id: caseId, status: check.status });
    store.emit(projectId, "investigation_conclusion", { id, case_id: caseId, status: check.status });
    return { id, status: check.status, check, note: "Proposal recorded with its deterministic check. It does not close the case, answer a question or approve any action." };
  });
}

export function listConclusions(store: Store, projectId: string, caseId: string) {
  return (store.db.prepare("SELECT id, contract_revision, status, created_by, principal_type, created_at, body, check_result FROM investigation_conclusions WHERE project_id = ? AND case_id = ? ORDER BY created_at DESC LIMIT 50").all(projectId, caseId) as Record<string, string>[])
    .map((r) => ({ ...r, body: JSON.parse(r.body!), check_result: JSON.parse(r.check_result!) }));
}

export type { Conclusion };
