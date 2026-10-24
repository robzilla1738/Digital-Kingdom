import type { ConclusionClaim, InvestigationContract } from "@dk/contracts";
import type { Store } from "../store.ts";

/**
 * Claim-local uncertainty (li-next item A).
 *
 * An unmet obligation is evidence about ONE thing: a coverage gap says an asset's action could not have been recorded
 * during particular spans; an incomplete retrieval says some stored records of one asset may be missing. So it limits
 * exactly the claims that rest on that thing:
 *
 * - absence / negative / universal claims about that asset and action, during the uncovered spans (or anywhere, when
 *   no span information is available or no source is configured), stay refused: unknown is the honest answer there;
 * - an absence claim about the SAME asset and action, confined (predicate after/before) to a sub-interval that the
 *   coverage result itself shows as covered, with complete activity retrieval, is assessable;
 * - a recorded positive observation (a delivered record that shows something) is never weakened by any coverage gap;
 * - claims about other assets or actions are untouched by this obligation.
 *
 * Everything here is derived from the contract and the coverage results delivered under it (same-scope revisions);
 * nothing reads private scenario truth and nothing changes the stored contract.
 */
export interface Span { from: string; to: string }
export interface CoverageScope { ref: string; asset_id: string; action: string; after: string; before: string; status: string; configured: boolean; uncovered: Span[]; spans_complete: boolean }
export interface AbsenceAssessment { assessable: boolean; scope: "whole_interval" | "sub_interval"; reason: string }

export const SPAN_LIST_CAP = 20;

/** The latest coverage result per asset:action delivered under a same-scope revision of the contract. */
export function coverageScopes(store: Store, contractId: string, revs: Set<number>): Map<string, CoverageScope> {
  const rows = store.db.prepare("SELECT ref, detail, contract_revision FROM investigation_deliveries WHERE contract_id = ? AND kind = 'coverage' ORDER BY id").all(contractId) as { ref: string; detail: string; contract_revision: number }[];
  const out = new Map<string, CoverageScope>();
  for (const r of rows) {
    if (!revs.has(r.contract_revision)) continue;
    const d = JSON.parse(r.detail) as Record<string, unknown>;
    const spans = Array.isArray(d.uncovered_spans) ? (d.uncovered_spans as Span[]).map((s) => ({ from: String(s.from), to: String(s.to) })) : [];
    const total = typeof d.uncovered_spans_total === "number" ? d.uncovered_spans_total : null;
    out.set(`${d.asset_id}:${d.action}`, {
      ref: r.ref, asset_id: String(d.asset_id), action: String(d.action), after: String(d.after), before: String(d.before), status: String(d.status),
      configured: d.configured === true, uncovered: spans,
      // older results did not record the total; a list at the cap may have been cut, so it cannot scope anything
      spans_complete: total !== null ? total === spans.length : spans.length < SPAN_LIST_CAP,
    });
  }
  return out;
}

const ms = (s: string) => Date.parse(s);
const iso = (n: number) => new Date(n).toISOString();

/** The covered sub-intervals of [after, before] given its uncovered spans (closed spans; covered pieces exclude them). */
export function coveredWithin(after: string, before: string, uncovered: Span[]): Span[] {
  const a = ms(after), b = ms(before);
  const gaps = uncovered.map((s) => [Math.max(a, ms(s.from)), Math.min(b, ms(s.to))] as const).filter(([f, t]) => t >= f).sort((x, y) => x[0] - y[0]);
  const out: Span[] = [];
  let cur = a;
  for (const [f, t] of gaps) {
    if (f > cur) out.push({ from: iso(cur), to: iso(f - 1) });
    cur = Math.max(cur, t + 1);
  }
  if (cur <= b) out.push({ from: iso(cur), to: iso(b) });
  return out;
}

/** Can an absence claim about `action` on `asset` be assessed for [after, before] (default: the whole interval)? */
export function assessAbsence(contract: InvestigationContract, scopes: Map<string, CoverageScope>, asset: string, action: string, after?: string, before?: string): AbsenceAssessment {
  const req = contract.negative_claim_requirements.find((n) => n.asset_id === asset && n.action === action);
  if (!req) return { assessable: false, scope: "whole_interval", reason: `no negative-claim requirement exists for ${action} on ${asset}` };
  const whole = !after && !before;
  const a = after ?? contract.scope.after, b = before ?? contract.scope.before;
  if (ms(a) < ms(contract.scope.after) || ms(b) > ms(contract.scope.before)) return { assessable: false, scope: "sub_interval", reason: "the claim's interval extends beyond the contract interval" };
  if (req.assessable) return { assessable: true, scope: whole ? "whole_interval" : "sub_interval", reason: req.reason };
  const by = new Map(contract.obligations.map((o) => [o.id, o]));
  const act = by.get(`activity:${asset}`), cov = by.get(`coverage:${asset}:${action}`);
  if (!act || act.status !== "satisfied") return { assessable: false, scope: whole ? "whole_interval" : "sub_interval", reason: `activity retrieval on ${asset} is ${act?.status ?? "missing"}${act?.reason ? ` (${act.reason})` : ""}: stored records may be missing anywhere in the interval` };
  if (whole) return { assessable: false, scope: "whole_interval", reason: req.reason };
  const s = scopes.get(`${asset}:${action}`);
  const why = (r: string): AbsenceAssessment => ({ assessable: false, scope: "sub_interval", reason: `absence of ${action} on ${asset} in ${a}..${b} is not assessable: ${r}` });
  if (!cov || !["unavailable", "partial"].includes(cov.status)) return why(`coverage:${asset}:${action} is ${cov?.status ?? "missing"}`);
  if (!s || !cov.query_refs.includes(s.ref)) return why("no current coverage result decides that obligation");
  if (!s.configured) return why("no source is configured to observe this asset and event class");
  if (!s.spans_complete) return why("the coverage result lists too many uncovered spans to scope a sub-interval");
  if (s.after !== contract.scope.after || s.before !== contract.scope.before) return why("the coverage result was computed for a different interval");
  const hit = s.uncovered.find((g) => ms(g.from) <= ms(b) && ms(a) <= ms(g.to));
  if (hit) return why(`it overlaps the uncovered span ${hit.from}..${hit.to} (${cov.reason})`);
  return { assessable: true, scope: "sub_interval", reason: `Activity retrieval on ${asset} is complete and the coverage result shows ${action} on ${asset} covered throughout ${a}..${b} (the uncovered span(s) of ${s.ref} lie outside it); absence in stored records within this sub-interval only.` };
}

/** Unmet obligations that actually bear on a claim, by its asset, action and interval. Positive observations: none. */
export function bearingUnmet(contract: InvestigationContract, scopes: Map<string, CoverageScope>, cl: ConclusionClaim): string[] {
  if (cl.type !== "not_observed_in_scope") return [];
  const p = cl.predicate;
  const target = p ? { asset: p.asset_id, action: p.action } : (() => {
    const cov = cl.obligation_ids.map((id) => contract.obligations.find((o) => o.id === id)).filter((o) => o?.kind === "coverage");
    return cov.length === 1 ? { asset: cov[0]!.target.asset_id!, action: cov[0]!.target.action! } : null;
  })();
  if (!target) return [];
  if (assessAbsence(contract, scopes, target.asset, target.action, p?.after, p?.before).assessable) return [];
  return [`activity:${target.asset}`, `coverage:${target.asset}:${target.action}`].filter((id) => { const o = contract.obligations.find((x) => x.id === id); return o && o.status !== "satisfied"; });
}

export const CLAIM_SCOPING_NOTE = "Uncertainty is claim-local. An unmet obligation blocks absence, negative or universal claims only about its own asset and action (and, for a coverage gap, only in its uncovered spans; unknown is honest there). It never weakens a recorded positive observation (a delivered record shows what it states: an access, a denial, the rule that decided it), other assets or actions, or an absence claim whose predicate after/before lies inside negative_claims[].assessable_within.";
