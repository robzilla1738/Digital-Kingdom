import type { EventAction, Finding, SecurityEvent } from "@dk/contracts";
import { identityOf, namespaces, sameIdentity, type CorrelationIdentity, type CorrelationRefType, type Namespaces } from "@dk/detections";
import { HttpError, type Store } from "./store.ts";
import { parseSearchQuery, searchEvents } from "./investigate.ts";
import { coverageHistory } from "./coverage-history.ts";

/**
 * Deterministic investigation recipes (roadmap R03.2; hardened in Local Intelligence Phase LP02).
 *
 * A recipe turns a finding into competing explanations instead of one persuasive narrative. Each version states
 * the evidence an explanation needs, the alternates, the bounded follow-on queries it runs (including events that
 * no finding references), the coverage questions that must be answerable, and stop conditions that block a
 * conclusion when the needed observer is missing. Recipes only read; attaching results to a case is explicit.
 *
 * v2 (dk.recipe_run.v2) makes incomplete work explicit:
 * - every query and coverage question is an obligation with a status; budget exhaustion, a failed page, a null
 *   coverage answer and a store with no observer are `not_started` / `failed` / `unavailable`, never "observable";
 * - queries follow signed continuation pages within the budget; anything left is `outstanding` with its cursor;
 * - actor/session/run pivots are bounded by the declared correlation namespace (R00.2): the same raw string from an
 *   unrelated authority is reported separately and never supports a hypothesis;
 * - hypotheses are typed `observable`, `intent` or `authorization`. Telemetry can support an observable
 *   proposition; intent and approval stay open until a record outside the telemetry (owner, approver) settles them.
 * `conclusion_allowed` is true only when no stop condition triggered and every obligation is satisfied or
 * inapplicable. Even then it permits a bounded statement about the observable propositions, not about intent.
 */
export const RECIPE_SCHEMA = "dk.recipe_run.v2";
export const RECIPE_PAGE = 100;

export type HypKind = "observable" | "intent" | "authorization";
type Hyp = { id: string; kind: HypKind; statement: string; status: "open" | "supported" | "weakened" | "unresolved"; supporting_event_ids: string[]; counter_event_ids: string[]; needs: string; notes: string[] };
export type QueryStatus = "complete" | "partial" | "failed" | "not_run";
type Scope = { type: CorrelationRefType; namespace: string; value: string } | { type: "locator" | "asset" | "route" | "window"; note: string };
type Query = {
  purpose: string; params: Record<string, string>; scope: Scope; status: QueryStatus; pages: number; matched: number | null;
  complete: boolean; follow_on_event_ids: string[]; other_authority_event_ids: string[]; error?: string;
  continuation?: { params: Record<string, string>; cursor: string } | null;
};
type CovStatus = "covered" | "partial" | "unknown" | "failed" | "not_run";
type Cov = { question: string; asset: string; action: EventAction; status: CovStatus; unknown_ms: number; partial_ms: number; covered_ms: number; error?: string };
type Stop = { condition: string; triggered: boolean; reason: string };
export type ObligationStatus = "not_started" | "satisfied" | "partial" | "unavailable" | "inapplicable_with_reason" | "failed";
type Obligation = { id: string; kind: "retrieve" | "coverage"; purpose: string; status: ObligationStatus; reason: string };

interface Ctx {
  store: Store; projectId: string; secret: string; f: Finding; events: SecurityEvent[]; ns: Namespaces;
  budget: { max: number; used: number };
  /** Bounded, paged retrieval. `pivot` binds actor/session/run filters to one correlation identity. */
  query(purpose: string, params: Record<string, string>, pivot?: CorrelationIdentity): Query;
  coverage(question: string, asset: string, action: EventAction, after: string, before: string): Cov;
  /** Record an obligation that could not even be asked (e.g. nothing to ask about). */
  unavailable(id: string, purpose: string, reason: string): void;
  /** Identity of the finding's own events for a reference type, if any. */
  identity(type: CorrelationRefType): CorrelationIdentity | null;
}

interface Recipe {
  id: string; version: number; title: string; applies_to: Finding["kind"][]; alternates: string[];
  run(c: Ctx): { hypotheses: Hyp[]; stops: Stop[]; next: { purpose: string; params: Record<string, string> }[]; notes: string[] };
}

const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const uniq = <T>(a: T[]) => [...new Set(a)];
const H = 3600_000;
const done = (q: Query) => q.status === "complete";
const covered = (c: Cov) => c.status === "covered";
const covReason = (c: Cov) => c.status === "not_run" ? "the coverage question was not asked (query budget exhausted)" : c.status === "failed" ? `the coverage question failed (${c.error ?? "error"})` : c.status === "unknown" ? `${Math.round(c.unknown_ms / 60000)} minute(s) of unknown coverage` : c.status === "partial" ? "coverage was only partial (sampled or liveness unverifiable)" : "covered";

/** Shared-locator check used by several recipes: a client IP alone never attributes. */
function sharedLocator(c: Ctx): { hyp: Hyp; next: { purpose: string; params: Record<string, string> }[] } | null {
  const ips = uniq(c.events.map((e) => e.client_ip).filter((x): x is string => !!x));
  if (!ips.length) return null;
  const q = c.query(`Other activity from ${ips[0]} (network locator, not identity)`, { client_ip: ips[0]!, after: plus(c.f.first_seen, -2 * H), before: plus(c.f.last_seen, 2 * H) });
  const others = q.follow_on_event_ids;
  const ownActors = new Set(c.events.map((e) => e.actor_ref).filter(Boolean));
  return {
    hyp: {
      id: "shared_locator", kind: "observable", statement: `Activity sharing ${ips[0]} with this finding comes from the same actor.`,
      status: "unresolved", supporting_event_ids: [], counter_event_ids: [], needs: "an identity link (same session or account in one declared authority), not a shared IP",
      notes: [`${others.length}${done(q) ? "" : "+ (incomplete)"} other event(s) share the address; ${ownActors.size ? "they are not joined to this finding's actor by IP alone" : "this finding has no actor to compare"}. NAT, proxies and shared egress make IP matches non-attributable.`],
    },
    next: [{ purpose: "Pivot on an identity, not the IP", params: { session_ref: "<session from an event above>", after: plus(c.f.first_seen, -2 * H), before: plus(c.f.last_seen, 2 * H) } }],
  };
}

export const RECIPES: Recipe[] = [
  {
    id: "auth-burst-then-success", version: 2, title: "Repeated authentication failures, then what?", applies_to: ["repeated_auth_failure"],
    alternates: ["A legitimate user mistyping or a stale saved password", "An automated client retrying with an expired credential", "Credential guessing that did or did not succeed"],
    run(c) {
      const who = c.identity("actor");
      const own = (e: SecurityEvent) => !!who && sameIdentity(identityOf(e, "actor", c.ns), who);
      const success = c.events.filter((e) => e.action === "authentication" && e.outcome === "success" && own(e));
      const asset = c.f.affected_asset_ids[0]!;
      const follow = who ? c.query("What the same identity did after the last failure", { actor_ref: who.value, after: c.f.last_seen, before: plus(c.f.last_seen, 2 * H) }, who) : null;
      if (!who) c.unavailable("retrieve:follow-on-identity", "What the same identity did after the last failure", "no event in the finding carries an actor_ref");
      const reads = c.query("Data access on any asset after the burst", { action: "data_access", after: c.f.first_seen, before: plus(c.f.last_seen, 2 * H) });
      const authCov = c.coverage("Could authentication outcomes have been recorded during the burst?", asset, "authentication", c.f.first_seen, plus(c.f.last_seen, 1000));
      const dataAssets = c.store.getGraph(c.projectId)!.assets.filter((a) => a.kind === "database" || a.kind === "storage").map((a) => a.id);
      const dataCov = dataAssets.map((d) => c.coverage(`Could reads of ${d} have been recorded afterwards?`, d, "data_access", c.f.last_seen, plus(c.f.last_seen, 2 * H)));
      if (!dataAssets.length) c.unavailable("coverage:data_access:none", "Could reads of a data store have been recorded afterwards?", "the graph declares no data store, so data access cannot be assessed");
      const followOn = follow ? follow.follow_on_event_ids : [];
      const followDone = !!follow && done(follow);
      const observable: Hyp = {
        id: "failures_then_success_same_identity", kind: "observable",
        statement: "Repeated failures were followed by a successful sign-in for the same identity (one declared authority), and that identity was then active.",
        status: !success.length ? (authCov.status === "covered" ? "weakened" : "unresolved") : followOn.length ? "supported" : followDone ? "open" : "unresolved",
        supporting_event_ids: [...success.map((e) => e.id), ...followOn], counter_event_ids: [],
        needs: "a success and follow-on activity attributed to the same identity inside one declared identity namespace",
        notes: [
          ...(success.length ? [] : ["No success for the same identity is part of the finding."]),
          ...(follow && !followDone ? [`The follow-on search is ${follow.status}; more activity by this identity may exist.`] : []),
          ...(follow?.other_authority_event_ids.length ? [`${follow.other_authority_event_ids.length} event(s) carry the same raw actor string from a different authority and are not counted.`] : []),
        ],
      };
      const hyps: Hyp[] = [
        observable,
        { id: "credential_guessing", kind: "intent", statement: "The failures were credential guessing by someone other than the account owner.", status: "open", supporting_event_ids: [], counter_event_ids: [],
          needs: "a record of who made the attempts (owner denial, an unfamiliar client or device in the same authority); failures followed by a success and ordinary activity do not establish guessing",
          notes: [observable.status === "supported" ? "The observable sequence is consistent with guessing AND with an owner who mistyped; it does not distinguish them." : "The observable sequence is not established either."] },
        { id: "legitimate_mistyping", kind: "intent", statement: "A legitimate user mistyped, then signed in normally.", status: "open", supporting_event_ids: [], counter_event_ids: [],
          needs: "confirmation from the account owner or an expected-test/maintenance record; telemetry alone cannot settle intent", notes: success.length ? [`${success.length} success event(s) are consistent with this.`] : [] },
      ];
      const loc = sharedLocator(c);
      if (loc) hyps.push(loc.hyp);
      const dataNotCovered = dataCov.filter((d) => !covered(d));
      const stops: Stop[] = [
        { condition: "authentication observer live for the burst", triggered: !covered(authCov), reason: covered(authCov) ? "Authentication was observable for the burst." : `Authentication visibility is not established: ${covReason(authCov)}; failures or a success may be missing.` },
        { condition: "data-access observer live afterwards", triggered: !dataAssets.length || dataNotCovered.length > 0,
          reason: !dataAssets.length ? "No data store is declared in the graph; no conclusion about data access is possible." : dataNotCovered.length ? `No conclusion that data was NOT accessed: ${dataNotCovered.map((d) => `${d.asset} (${covReason(d)})`).join(", ")}.` : "Data access was observable afterwards for every declared data store." },
      ];
      return { hypotheses: hyps, stops, next: [...(loc?.next ?? []), ...(who ? [] : [{ purpose: "Find the account involved (no actor_ref on these events)", params: { action: "authentication", after: c.f.first_seen, before: c.f.last_seen } }])],
        notes: [`${reads.matched ?? "?"} data-access event(s) in the window (${reads.status}), ${reads.follow_on_event_ids.length} retrieved and not referenced by this finding.`] };
    },
  },
  {
    id: "blocked-request-scope", version: 2, title: "Blocked requests: did anything get through?", applies_to: ["blocked_request_reported"],
    alternates: ["Automated scanning that was fully blocked", "An authorized security test or maintenance probe", "A blocked probe followed by a successful variant"],
    run(c) {
      const routes = uniq(c.events.map((e) => e.route).filter((x): x is string => !!x)).slice(0, 2);
      const allowed = routes.map((r) => c.query(`Allowed requests to ${r} around the burst`, { route: r, outcome: "allowed", after: plus(c.f.first_seen, -H), before: plus(c.f.last_seen, H) }));
      if (!routes.length) c.unavailable("retrieve:allowed-same-route", "Allowed requests to the same route", "the finding's events carry no route");
      const through = uniq(allowed.flatMap((q) => q.follow_on_event_ids));
      const allDone = routes.length > 0 && allowed.every(done);
      const loc = sharedLocator(c);
      const hyps: Hyp[] = [
        { id: "fully_blocked", kind: "observable", statement: "Every request in the burst was blocked and no allowed request to the same route(s) was recorded.", status: through.length ? "weakened" : allDone ? "open" : "unresolved", supporting_event_ids: c.f.event_ids, counter_event_ids: through, needs: "application-side telemetry for the same routes; a WAF block alone cannot show what was not sent", notes: allDone ? [] : ["The allowed-request search did not complete; requests that got through may be missing."] },
        { id: "authorized_test", kind: "authorization", statement: "This was an authorized test or maintenance probe.", status: "open", supporting_event_ids: [], counter_event_ids: [], needs: "an operator record (test window, approver); telemetry cannot establish authorization", notes: ["Resolve by answering the case question; no fact changes are needed."] },
      ];
      if (loc) hyps.push(loc.hyp);
      return { hypotheses: hyps, stops: [{ condition: "application-side visibility", triggered: !allDone, reason: allDone ? "Allowed-request search completed; absence of matches is not proof nothing else was sent." : !routes.length ? "No route to search; whether anything got through is unknown." : `Allowed-request search is incomplete (${allowed.map((q) => q.status).join(", ")}); do not conclude nothing got through.` }], next: loc?.next ?? [], notes: through.length ? [`${through.length} allowed request(s) to the same route(s) are not part of the finding; review them.`] : [] };
    },
  },
  {
    id: "agent-effect-attribution", version: 2, title: "Agent effect: wrapper path or bypass?", applies_to: ["agent_effect_observed", "agent_action_denied"],
    alternates: ["The effect matches an allowed tool call", "The agent acted outside the instrumented wrapper", "An unrelated runtime reused the run identifier"],
    run(c) {
      const run = c.identity("run");
      const q = run ? c.query("Every event carrying this run id in the same run namespace", { run_id: run.value, after: plus(c.f.first_seen, -H), before: plus(c.f.last_seen, H) }, run) : null;
      if (!run) c.unavailable("retrieve:run", "Every event carrying this run id", "no event in the finding carries a run_id");
      const effects = c.events.filter((e) => e.action === "side_effect_observed");
      const independent = effects.filter((e) => e.agent?.origin === "independent_observer");
      const asset = effects[0]?.asset_ids[0] ?? c.f.affected_asset_ids[0]!;
      const cov = c.coverage("Could effects have been recorded independently?", asset, "side_effect_observed", plus(c.f.first_seen, -H), plus(c.f.last_seen, H));
      const corroborated = c.f.evidence_level === "corroborated";
      return {
        hypotheses: [
          { id: "effect_matches_allowed_call", kind: "observable", statement: "The observed effect corresponds to a tool call the policy enforcer allowed and the wrapper reported, in one declared run namespace.", status: corroborated ? "supported" : "open", supporting_event_ids: corroborated ? c.f.event_ids : [], counter_event_ids: [], needs: "an execution report and an independent effect observation in one declared run namespace", notes: ["An allowed call is a policy decision, not an approval of this use."] },
          { id: "call_was_approved", kind: "authorization", statement: "This use of the tool was approved by a responsible person for this purpose.", status: "open", supporting_event_ids: [], counter_event_ids: [], needs: "an approval or task record from the initiating principal or owner; an allowed policy decision and an observed effect do not establish approval", notes: [] },
          { id: "bypass", kind: "observable", statement: "The agent acted outside the instrumented wrapper.", status: corroborated && covered(cov) ? "weakened" : "open", supporting_event_ids: [], counter_event_ids: [], needs: "an independently observed effect with no matching execution report", notes: independent.length ? [] : ["No effect here is from a declared independent observer."] },
        ],
        stops: [{ condition: "independent effect observer live", triggered: !covered(cov), reason: covered(cov) ? "Effects were independently observable." : `Effect visibility was not continuous (${covReason(cov)}); a bypass cannot be ruled out.` }],
        next: [], notes: q ? [`${q.matched ?? "?"} event(s) carry the run id (${q.status}); ${q.follow_on_event_ids.length} in the same run namespace are not in this finding; ${q.other_authority_event_ids.length} reuse the id from another runtime.`] : ["No run id on these events."],
      };
    },
  },
  {
    id: "change-or-maintenance", version: 2, title: "Planned change or unexplained change?", applies_to: ["sensitive_privilege_change", "runtime_alert_reported", "source_contradiction", "coverage_loss", "decoy_credential_used"],
    alternates: ["A planned, approved change or maintenance window", "An unplanned or unauthorized change"],
    run(c) {
      const asset = c.f.affected_asset_ids[0]!;
      const q = c.query("Other activity on the affected asset around the change", { asset_id: asset, after: plus(c.f.first_seen, -H), before: plus(c.f.last_seen, H) });
      return {
        hypotheses: [
          { id: "planned", kind: "authorization", statement: "This was a planned, approved change or maintenance.", status: "open", supporting_event_ids: [], counter_event_ids: [], needs: "a change record or approver; answer the case question to resolve. Facts do not need to change.", notes: [] },
          { id: "unplanned", kind: "authorization", statement: "This change was not planned.", status: "open", supporting_event_ids: [], counter_event_ids: [], needs: "the absence of any change record, confirmed by its owner", notes: [`${c.f.event_ids.length} recorded event(s) show the change happened; they do not show whether it was planned.`] },
        ],
        stops: [], next: [], notes: [`${q.follow_on_event_ids.length}${done(q) ? "" : "+ (search " + q.status + ")"} nearby event(s) on ${asset} are not referenced by this finding.`],
      };
    },
  },
];

export interface RecipeDeps { search?: typeof searchEvents }

export function runRecipe(store: Store, projectId: string, recipeId: string, findingId: string, secret: string, maxQueries = 6, deps: RecipeDeps = {}) {
  const r = RECIPES.find((x) => x.id === recipeId);
  if (!r) throw new HttpError(404, `unknown recipe ${recipeId}`, RECIPES.map((x) => x.id));
  const f = store.listFindings(projectId).find((x) => x.id === findingId);
  if (!f) throw new HttpError(404, "finding not found");
  if (!r.applies_to.includes(f.kind)) throw new HttpError(422, `${r.id} does not apply to ${f.kind} findings`, RECIPES.filter((x) => x.applies_to.includes(f.kind)).map((x) => x.id));
  const search = deps.search ?? searchEvents;
  const refs = new Set([...f.event_ids, ...f.counterevidence_event_ids]);
  const cited = new Set(store.listFindings(projectId).flatMap((x) => [...x.event_ids, ...x.counterevidence_event_ids]));
  const budget = { max: Math.min(Math.max(maxQueries, 1), 12), used: 0 };
  const ns = namespaces(store.listSources(projectId));
  const queries: Query[] = [], coverage: Cov[] = [], obligations: Obligation[] = [];
  const events = store.eventsByIds(projectId, [...refs]);
  const ctx: Ctx = {
    store, projectId, secret, f, events, ns, budget,
    identity(type) { for (const e of events) { const i = identityOf(e, type, ns); if (i) return i; } return null; },
    query(purpose, params, pivot) {
      const { after, before, ...rest } = params;
      const window = Date.parse(before!) - Date.parse(after!);
      const clamp = window > 31 * 86_400_000 ? plus(before!, -31 * 86_400_000) : after!;
      const searchParams = { after: clamp, before: before!, limit: String(RECIPE_PAGE), ...rest };
      const scope: Scope = pivot ? { type: pivot.type, namespace: pivot.namespace, value: pivot.value } : rest.client_ip ? { type: "locator", note: "network locator, not identity" } : rest.asset_id ? { type: "asset", note: "asset as mapped by its sources" } : rest.route ? { type: "route", note: "normalized route; many callers share one" } : { type: "window", note: "all stored events matching the filters" };
      const q: Query = { purpose, params, scope, status: "not_run", pages: 0, matched: null, complete: false, follow_on_event_ids: [], other_authority_event_ids: [], continuation: null };
      queries.push(q);
      let cursor: string | undefined;
      for (;;) {
        if (budget.used >= budget.max) { if (q.pages > 0) q.status = "partial"; q.continuation = q.pages > 0 && cursor ? { params: searchParams, cursor } : null; break; }
        budget.used++;
        let res: ReturnType<typeof searchEvents>;
        try { res = search(store, projectId, parseSearchQuery(searchParams).query, secret, cursor); }
        catch (e) { q.status = "failed"; q.error = (e as Error).message.slice(0, 300); q.continuation = cursor ? { params: searchParams, cursor } : null; break; }
        q.pages++;
        q.matched = res.query_completeness.matching_in_snapshot;
        for (const e of res.events) {
          if (refs.has(e.id)) continue;
          // pivots are bounded by the declared correlation authority; the same raw string elsewhere is not the same principal
          if (pivot && !sameIdentity(identityOf(e, pivot.type, ns), pivot)) { q.other_authority_event_ids.push(e.id); continue; }
          q.follow_on_event_ids.push(e.id);
        }
        if (res.query_completeness.complete) { q.status = "complete"; q.complete = true; break; }
        if (!res.page.next_cursor) { q.status = "partial"; q.error = res.query_completeness.note; break; }
        cursor = res.page.next_cursor;
      }
      const ob: Obligation = { id: `retrieve:${queries.length}`, kind: "retrieve", purpose, status: q.status === "complete" ? "satisfied" : q.status === "partial" ? "partial" : q.status === "failed" ? "failed" : "not_started",
        reason: q.status === "complete" ? `${q.pages} page(s), every match returned${pivot ? ` within ${pivot.namespace}` : ""}` : q.status === "not_run" ? "query budget exhausted before this query ran" : q.status === "failed" ? `page ${q.pages + 1} failed: ${q.error}` : q.continuation ? `stopped after ${q.pages} page(s): query budget exhausted; resume with the continuation cursor` : `incomplete after ${q.pages} page(s): ${q.error ?? "results not complete"}` };
      obligations.push(ob);
      return q;
    },
    coverage(question, asset, action, after, before) {
      const c: Cov = { question, asset, action, status: "not_run", unknown_ms: Date.parse(before) - Date.parse(after), partial_ms: 0, covered_ms: 0 };
      coverage.push(c);
      const ob: Obligation = { id: `coverage:${action}:${asset}`, kind: "coverage", purpose: question, status: "not_started", reason: "query budget exhausted before this coverage question ran" };
      obligations.push(ob);
      if (budget.used >= budget.max) return c;
      budget.used++;
      try {
        const h = coverageHistory(store, projectId, { asset, action, after, before });
        Object.assign(c, { unknown_ms: h.totals_ms.unknown, partial_ms: h.totals_ms.partial, covered_ms: h.totals_ms.covered });
        const configured = h.sources.length > 0 && h.spans.some((s) => s.sources.length > 0);
        c.status = !configured ? "unknown" : h.totals_ms.unknown > 0 ? "unknown" : h.totals_ms.partial > 0 ? "partial" : "covered";
        Object.assign(ob, c.status === "covered" ? { status: "satisfied", reason: "covered for the whole interval" } : c.status === "partial" ? { status: "partial", reason: "partially covered (sampling or unverifiable liveness)" } : { status: "unavailable", reason: configured ? `${Math.round(c.unknown_ms / 60000)} minute(s) with no capable live observer` : "no source is configured to observe this asset and event class" });
      } catch (e) { c.status = "failed"; c.error = (e as Error).message.slice(0, 300); Object.assign(ob, { status: "failed", reason: c.error }); }
      return c;
    },
    unavailable(id, purpose, reason) { obligations.push({ id, kind: id.startsWith("coverage") ? "coverage" : "retrieve", purpose, status: "unavailable", reason }); },
  };
  const out = r.run(ctx);
  const outstanding = [
    ...queries.filter((q) => q.status !== "complete").map((q) => ({ purpose: q.purpose, status: q.status, reason: q.status === "not_run" ? "query budget exhausted before this query ran" : q.status === "failed" ? `failed: ${q.error}` : q.continuation ? "query budget exhausted; more pages exist" : (q.error ?? "incomplete"), continuation: q.continuation ?? null, params: q.params })),
    ...coverage.filter((c) => c.status === "not_run" || c.status === "failed").map((c) => ({ purpose: c.question, status: c.status, reason: c.status === "not_run" ? "query budget exhausted before this coverage question ran" : `failed: ${c.error}`, continuation: null, params: { asset: c.asset, action: c.action } })),
  ];
  const unfinished = obligations.filter((o) => o.status !== "satisfied" && o.status !== "inapplicable_with_reason");
  const stopped = out.stops.some((s) => s.triggered);
  return {
    schema: RECIPE_SCHEMA, recipe: { id: r.id, version: r.version, title: r.title },
    subject: { finding_id: f.id, revision: f.revision, kind: f.kind },
    hypotheses: out.hypotheses, alternate_explanations: r.alternates,
    obligations, queries, coverage_checks: coverage, stop_conditions: out.stops,
    completeness: unfinished.length ? ("partial" as const) : ("complete" as const),
    outstanding,
    conclusion_allowed: !stopped && unfinished.length === 0,
    conclusion_scope: "observable propositions only; intent and authorization hypotheses need a record outside the telemetry",
    next_queries: out.next, notes: out.notes,
    unlinked_follow_on_event_ids: uniq(queries.flatMap((q) => q.follow_on_event_ids)).filter((id) => !cited.has(id)),
    other_authority_event_ids: uniq(queries.flatMap((q) => q.other_authority_event_ids)),
    budget: { max_queries: budget.max, used: budget.used, exhausted: budget.used >= budget.max, unit: "one search page or one coverage question", incomplete_queries: queries.filter((q) => q.status !== "complete").length },
    limits: ["A recipe ranks explanations; it does not decide intent or authorization.", "Query results are bounded and say when they are incomplete; outstanding work is listed with continuation cursors.", "A stop condition means do not conclude, not that the worst case happened.", "Actor, session and run pivots only count events in the same declared correlation namespace."],
  };
}
