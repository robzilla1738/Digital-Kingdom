import type { EventAction, Finding, SecurityEvent } from "@dk/contracts";
import { HttpError, type Store } from "./store.ts";
import { parseSearchQuery, searchEvents } from "./investigate.ts";
import { coverageHistory } from "./coverage-history.ts";

/**
 * Deterministic investigation recipes (roadmap R03.2).
 *
 * A recipe turns a finding into competing explanations instead of one persuasive narrative. Each version states
 * the evidence an explanation needs, the alternates, the bounded follow-on queries it runs (including events that
 * no finding references), the coverage questions that must be answerable, and stop conditions that block a
 * conclusion when the needed observer is missing. Recipes only read; attaching results to a case is explicit.
 */
export const RECIPE_SCHEMA = "dk.recipe_run.v1";

type Hyp = { id: string; statement: string; status: "open" | "supported" | "weakened" | "unresolved"; supporting_event_ids: string[]; counter_event_ids: string[]; needs: string; notes: string[] };
type Query = { purpose: string; params: Record<string, string>; matched: number; complete: boolean; follow_on_event_ids: string[] };
type Cov = { question: string; asset: string; action: EventAction; unknown_ms: number; partial_ms: number; covered_ms: number };
type Stop = { condition: string; triggered: boolean; reason: string };

interface Ctx {
  store: Store; projectId: string; secret: string; f: Finding; events: SecurityEvent[];
  budget: { max: number; used: number };
  query(purpose: string, params: Record<string, string>): Query | null;
  coverage(question: string, asset: string, action: EventAction, after: string, before: string): Cov | null;
}

interface Recipe {
  id: string; version: number; title: string; applies_to: Finding["kind"][]; alternates: string[];
  run(c: Ctx): { hypotheses: Hyp[]; stops: Stop[]; next: { purpose: string; params: Record<string, string> }[]; notes: string[] };
}

const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const uniq = <T>(a: T[]) => [...new Set(a)];
const H = 3600_000;

/** Shared-locator check used by several recipes: a client IP alone never attributes. */
function sharedLocator(c: Ctx): { hyp: Hyp; next: { purpose: string; params: Record<string, string> }[] } | null {
  const ips = uniq(c.events.map((e) => e.client_ip).filter((x): x is string => !!x));
  if (!ips.length) return null;
  const q = c.query(`Other activity from ${ips[0]} (network locator, not identity)`, { client_ip: ips[0]!, after: plus(c.f.first_seen, -2 * H), before: plus(c.f.last_seen, 2 * H) });
  const others = q ? q.follow_on_event_ids : [];
  const ownActors = new Set(c.events.map((e) => e.actor_ref).filter(Boolean));
  return {
    hyp: {
      id: "shared_locator", statement: `Activity sharing ${ips[0]} with this finding comes from the same actor.`,
      status: "unresolved", supporting_event_ids: [], counter_event_ids: [], needs: "an identity link (same session or account in one declared authority), not a shared IP",
      notes: [`${others.length} other event(s) share the address; ${ownActors.size ? "they are not joined to this finding's actor by IP alone" : "this finding has no actor to compare"}. NAT, proxies and shared egress make IP matches non-attributable.`],
    },
    next: [{ purpose: "Pivot on an identity, not the IP", params: { session_ref: "<session from an event above>", after: plus(c.f.first_seen, -2 * H), before: plus(c.f.last_seen, 2 * H) } }],
  };
}

export const RECIPES: Recipe[] = [
  {
    id: "auth-burst-then-success", version: 1, title: "Repeated authentication failures, then what?", applies_to: ["repeated_auth_failure"],
    alternates: ["A legitimate user mistyping or a stale saved password", "An automated client retrying with an expired credential", "Credential guessing that did or did not succeed"],
    run(c) {
      const actor = c.events.find((e) => e.actor_ref)?.actor_ref;
      const success = c.events.filter((e) => e.action === "authentication" && e.outcome === "success");
      const failures = c.events.filter((e) => e.action === "authentication" && e.outcome === "failure");
      const asset = c.f.affected_asset_ids[0]!;
      const follow = actor ? c.query(`What the account did after the last failure`, { actor_ref: actor, after: c.f.last_seen, before: plus(c.f.last_seen, 2 * H) }) : null;
      const reads = c.query("Data access on affected assets after the burst", { action: "data_access", after: c.f.first_seen, before: plus(c.f.last_seen, 2 * H) });
      const authCov = c.coverage("Could authentication outcomes have been recorded during the burst?", asset, "authentication", c.f.first_seen, plus(c.f.last_seen, 1000));
      const dataAssets = c.store.getGraph(c.projectId)!.assets.filter((a) => a.kind === "database" || a.kind === "storage").map((a) => a.id);
      const dataCov = dataAssets.map((d) => c.coverage(`Could reads of ${d} have been recorded afterwards?`, d, "data_access", c.f.last_seen, plus(c.f.last_seen, 2 * H))).filter((x): x is Cov => !!x);
      const followOn = follow?.follow_on_event_ids ?? [];
      const hyps: Hyp[] = [
        { id: "guessing_succeeded", statement: "Credential guessing succeeded and the account was then used.", status: success.length ? (followOn.length ? "supported" : "open") : "weakened",
          supporting_event_ids: [...success.map((e) => e.id), ...followOn], counter_event_ids: success.length ? [] : failures.map((e) => e.id), needs: "a success in the same identity authority and follow-on activity by that account",
          notes: success.length ? [] : ["No success in the same authority was recorded in the finding."] },
        { id: "legitimate_mistyping", statement: "A legitimate user mistyped, then signed in normally.", status: "open", supporting_event_ids: success.map((e) => e.id), counter_event_ids: [],
          needs: "confirmation from the account owner or an expected-test/maintenance record; telemetry alone cannot settle intent", notes: [] },
      ];
      const loc = sharedLocator(c);
      if (loc) hyps.push(loc.hyp);
      const dataUnknown = dataCov.filter((d) => d.unknown_ms > 0);
      const stops: Stop[] = [
        { condition: "authentication observer live for the burst", triggered: !!authCov && authCov.unknown_ms > 0, reason: authCov && authCov.unknown_ms > 0 ? "Part of the burst falls in an unknown coverage span; failures or a success may be missing." : "Authentication was observable." },
        { condition: "data-access observer live afterwards", triggered: dataUnknown.length > 0, reason: dataUnknown.length ? `No conclusion that data was NOT accessed: ${dataUnknown.map((d) => d.asset).join(", ")} had unknown read coverage after the burst.` : "Data access was observable afterwards." },
      ];
      return { hypotheses: hyps, stops, next: [...(loc?.next ?? []), ...(actor ? [] : [{ purpose: "Find the account involved (no actor_ref on these events)", params: { action: "authentication", after: c.f.first_seen, before: c.f.last_seen } }])],
        notes: reads ? [`${reads.matched} data-access event(s) in the window, ${reads.follow_on_event_ids.length} not referenced by any finding.`] : [] };
    },
  },
  {
    id: "blocked-request-scope", version: 1, title: "Blocked requests: did anything get through?", applies_to: ["blocked_request_reported"],
    alternates: ["Automated scanning that was fully blocked", "An authorized security test or maintenance probe", "A blocked probe followed by a successful variant"],
    run(c) {
      const routes = uniq(c.events.map((e) => e.route).filter((x): x is string => !!x)).slice(0, 2);
      const allowed = routes.map((r) => c.query(`Allowed requests to ${r} around the burst`, { route: r, outcome: "allowed", after: plus(c.f.first_seen, -H), before: plus(c.f.last_seen, H) })).filter((q): q is Query => !!q);
      const through = uniq(allowed.flatMap((q) => q.follow_on_event_ids));
      const loc = sharedLocator(c);
      const hyps: Hyp[] = [
        { id: "fully_blocked", statement: "Every request in the burst was blocked and nothing reached the application.", status: through.length ? "weakened" : "open", supporting_event_ids: c.f.event_ids, counter_event_ids: through, needs: "application-side telemetry for the same routes; a WAF block alone cannot show what was not sent", notes: [] },
        { id: "authorized_test", statement: "This was an authorized test or maintenance probe.", status: "open", supporting_event_ids: [], counter_event_ids: [], needs: "an operator record (test window, approver); telemetry cannot establish authorization", notes: ["Resolve by answering the case question; no fact changes are needed."] },
      ];
      if (loc) hyps.push(loc.hyp);
      return { hypotheses: hyps, stops: [{ condition: "application-side visibility", triggered: false, reason: "Allowed-request search ran; absence of matches is not proof nothing else was sent." }], next: loc?.next ?? [], notes: through.length ? [`${through.length} allowed request(s) to the same route(s) are not part of the finding; review them.`] : [] };
    },
  },
  {
    id: "agent-effect-attribution", version: 1, title: "Agent effect: wrapper path or bypass?", applies_to: ["agent_effect_observed", "agent_action_denied"],
    alternates: ["The effect matches an approved tool call", "The agent acted outside the instrumented wrapper", "An unrelated runtime reused the run identifier"],
    run(c) {
      const run = c.events.find((e) => e.run_id)?.run_id;
      const q = run ? c.query("Every event carrying this run id", { run_id: run, after: plus(c.f.first_seen, -H), before: plus(c.f.last_seen, H) }) : null;
      const effects = c.events.filter((e) => e.action === "side_effect_observed");
      const independent = effects.filter((e) => e.agent?.origin === "independent_observer");
      const asset = effects[0]?.asset_ids[0] ?? c.f.affected_asset_ids[0]!;
      const cov = c.coverage("Could effects have been recorded independently?", asset, "side_effect_observed", plus(c.f.first_seen, -H), plus(c.f.last_seen, H));
      return {
        hypotheses: [
          { id: "approved_call", statement: "The observed effect is the result of a reported, allowed tool call.", status: c.f.evidence_level === "corroborated" ? "supported" : "open", supporting_event_ids: c.f.event_ids, counter_event_ids: [], needs: "an execution report and an independent effect observation in one declared run namespace", notes: [] },
          { id: "bypass", statement: "The agent acted outside the instrumented wrapper.", status: c.f.evidence_level === "corroborated" ? "weakened" : "open", supporting_event_ids: [], counter_event_ids: [], needs: "an independently observed effect with no matching execution report", notes: independent.length ? [] : ["No effect here is from a declared independent observer."] },
        ],
        stops: [{ condition: "independent effect observer live", triggered: !cov || cov.unknown_ms > 0, reason: !cov || cov.unknown_ms > 0 ? "Effect visibility was not continuous; a bypass cannot be ruled out." : "Effects were independently observable." }],
        next: [], notes: q ? [`${q.matched} event(s) carry the run id; ${q.follow_on_event_ids.length} are not in this finding.`] : ["No run id on these events."],
      };
    },
  },
  {
    id: "change-or-maintenance", version: 1, title: "Planned change or unexplained change?", applies_to: ["sensitive_privilege_change", "runtime_alert_reported", "source_contradiction", "coverage_loss", "decoy_credential_used"],
    alternates: ["A planned, approved change or maintenance window", "An unplanned or unauthorized change"],
    run(c) {
      const asset = c.f.affected_asset_ids[0]!;
      const q = c.query("Other activity on the affected asset around the change", { asset_id: asset, after: plus(c.f.first_seen, -H), before: plus(c.f.last_seen, H) });
      return {
        hypotheses: [
          { id: "planned", statement: "This was a planned, approved change or maintenance.", status: "open", supporting_event_ids: [], counter_event_ids: [], needs: "a change record or approver; answer the case question to resolve. Facts do not need to change.", notes: [] },
          { id: "unplanned", statement: "This change was not planned.", status: "open", supporting_event_ids: c.f.event_ids, counter_event_ids: [], needs: "the absence of any change record, confirmed by its owner", notes: [] },
        ],
        stops: [], next: [], notes: q ? [`${q.follow_on_event_ids.length} nearby event(s) on ${asset} are not referenced by any finding.`] : [],
      };
    },
  },
];

export function runRecipe(store: Store, projectId: string, recipeId: string, findingId: string, secret: string, maxQueries = 6) {
  const r = RECIPES.find((x) => x.id === recipeId);
  if (!r) throw new HttpError(404, `unknown recipe ${recipeId}`, RECIPES.map((x) => x.id));
  const f = store.listFindings(projectId).find((x) => x.id === findingId);
  if (!f) throw new HttpError(404, "finding not found");
  if (!r.applies_to.includes(f.kind)) throw new HttpError(422, `${r.id} does not apply to ${f.kind} findings`, RECIPES.filter((x) => x.applies_to.includes(f.kind)).map((x) => x.id));
  const refs = new Set([...f.event_ids, ...f.counterevidence_event_ids]);
  const cited = new Set(store.listFindings(projectId).flatMap((x) => [...x.event_ids, ...x.counterevidence_event_ids]));
  const budget = { max: Math.min(Math.max(maxQueries, 1), 12), used: 0 };
  const queries: Query[] = [], coverage: Cov[] = [];
  const ctx: Ctx = {
    store, projectId, secret, f, events: store.eventsByIds(projectId, [...refs]), budget,
    query(purpose, params) {
      if (budget.used >= budget.max) return null;
      budget.used++;
      const { after, before, ...rest } = params;
      const window = Date.parse(before!) - Date.parse(after!);
      const clamp = window > 31 * 86_400_000 ? plus(before!, -31 * 86_400_000) : after!;
      const res = searchEvents(store, projectId, parseSearchQuery({ after: clamp, before, limit: "100", ...rest }).query, secret);
      // follow-on: matching events this finding does not reference (and which no finding may reference at all)
      const q: Query = { purpose, params, matched: res.query_completeness.matching_in_snapshot, complete: res.query_completeness.complete, follow_on_event_ids: res.events.filter((e) => !refs.has(e.id)).map((e) => e.id) };
      queries.push(q);
      return q;
    },
    coverage(question, asset, action, after, before) {
      if (budget.used >= budget.max) return null;
      budget.used++;
      try {
        const h = coverageHistory(store, projectId, { asset, action, after, before });
        const c: Cov = { question, asset, action, unknown_ms: h.totals_ms.unknown, partial_ms: h.totals_ms.partial, covered_ms: h.totals_ms.covered };
        coverage.push(c);
        return c;
      } catch { const c: Cov = { question, asset, action, unknown_ms: Date.parse(before) - Date.parse(after), partial_ms: 0, covered_ms: 0 }; coverage.push(c); return c; }
    },
  };
  const out = r.run(ctx);
  const truncated = queries.filter((q) => !q.complete).length;
  return {
    schema: RECIPE_SCHEMA, recipe: { id: r.id, version: r.version, title: r.title },
    subject: { finding_id: f.id, revision: f.revision, kind: f.kind },
    hypotheses: out.hypotheses, alternate_explanations: r.alternates,
    queries, coverage_checks: coverage, stop_conditions: out.stops,
    conclusion_allowed: !out.stops.some((s) => s.triggered),
    next_queries: out.next, notes: out.notes,
    unlinked_follow_on_event_ids: uniq(queries.flatMap((q) => q.follow_on_event_ids)).filter((id) => !cited.has(id)),
    budget: { max_queries: budget.max, used: budget.used, exhausted: budget.used >= budget.max, incomplete_queries: truncated },
    limits: ["A recipe ranks explanations; it does not decide intent or authorization.", "Query results are bounded and say when they are incomplete.", "A stop condition means do not conclude, not that the worst case happened."],
  };
}
