import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Graph } from "@dk/contracts";
import { digest } from "@dk/contracts";
import { HttpError } from "./store.ts";
import { evaluate, type AuthSnapshot } from "./access/aws-policy.ts";

/**
 * Security change review (roadmap R04.4). A ChangePlan pins base and candidate: commits, artifact digests, the
 * declared graph, the authorization snapshot, telemetry sources and agent tool/model routes. The review looks for
 * what the change ADDS even when there is no finding: new ingress, broader effective grants, changed tools or
 * model routes, and lost telemetry. Anything the candidate does not state is unknown and never favourable.
 * An owner review binds the candidate digest; a changed candidate needs a new review, and the post-deploy check
 * compares what is observed running with what was reviewed.
 */
export const CHANGE_MIGRATION = `CREATE TABLE change_reviews (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, candidate_digest TEXT NOT NULL, plan TEXT NOT NULL, review TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, owner_decision TEXT, owner TEXT, owner_at TEXT, post_deploy TEXT);`;

export interface Side { commit: string; graph: Graph; snapshot?: AuthSnapshot | null; sources: { id: string; asset_ids: string[] }[]; artifacts: Record<string, string>; agents?: { asset_id: string; model_route: string; tools: string[] }[] }
export interface ChangePlanInput { base: Side; candidate: Side; probes?: { principal: string; action: string; resource: string }[] }

const PUBLIC = (g: Graph, id: string) => !!g.assets.find((a) => a.id === id && (a.kind === "edge" || a.allowed_zone_ids.includes("public")));
const exposedFrom = (g: Graph) => { const out = new Set<string>(); const q = g.assets.filter((a) => PUBLIC(g, a.id)).map((a) => a.id); q.forEach((x) => out.add(x)); while (q.length) { const c = q.shift()!; for (const r of g.relationships) if (r.source_id === c && (r.kind === "calls" || r.kind === "invokes_tool") && !out.has(r.target_id)) { out.add(r.target_id); q.push(r.target_id); } } return out; };

export function reviewChange(input: ChangePlanInput) {
  const { base, candidate } = input;
  const unknowns: string[] = [];
  const changes: { kind: string; detail: string; assets: string[] }[] = [];
  // ingress: assets reachable from a public entry point
  const be = exposedFrom(base.graph), ce = exposedFrom(candidate.graph);
  for (const a of ce) if (!be.has(a)) changes.push({ kind: "new_ingress", detail: `${a} becomes reachable from a public entry point`, assets: [a] });
  // authority: probes evaluated on both snapshots, plus newly added wildcard statements
  if (!candidate.snapshot) unknowns.push("the candidate's authorization snapshot was not supplied: effective authority is unknown");
  if (!base.snapshot) unknowns.push("the base authorization snapshot was not supplied: grant changes cannot be compared");
  const rank: Record<string, number> = { blocked: 0, unresolved: 1, conditional: 2, feasible: 3 };
  if (candidate.snapshot && base.snapshot) {
    for (const p of input.probes ?? []) {
      const b = evaluate(base.snapshot, p.principal, p.action, p.resource), c = evaluate(candidate.snapshot, p.principal, p.action, p.resource);
      if (c.result === "unresolved") unknowns.push(`${p.principal} ${p.action} ${p.resource}: unresolved in the candidate (${c.reasons[0]})`);
      else if (rank[c.result]! > rank[b.result]!) changes.push({ kind: "broader_grant", detail: `${p.principal} ${p.action} on ${p.resource}: ${b.result} -> ${c.result}`, assets: [] });
    }
    const stmts = (s: AuthSnapshot) => new Set(s.principals.flatMap((pr) => pr.policies === "unknown" ? [] : pr.policies.flatMap((d) => d.Statement.filter((st) => st.Effect === "Allow").map((st) => `${pr.arn}|${JSON.stringify(st.Action ?? st.NotAction)}|${JSON.stringify(st.Resource ?? st.NotResource)}`))));
    const bs = stmts(base.snapshot);
    for (const k of stmts(candidate.snapshot)) if (!bs.has(k) && /\*/.test(k.split("|").slice(1).join("|"))) changes.push({ kind: "broader_grant", detail: `new wildcard allow for ${k.split("|")[0]}: ${k.split("|").slice(1).join(" on ")}`, assets: [] });
  }
  // agent tools and model routes
  const ba = new Map((base.agents ?? []).map((a) => [a.asset_id, a])), ca = new Map((candidate.agents ?? []).map((a) => [a.asset_id, a]));
  for (const [id, c] of ca) { const b = ba.get(id); if (!b) { changes.push({ kind: "tool_change", detail: `new agent ${id} with tools ${c.tools.join(", ")}`, assets: [id] }); continue; }
    const added = c.tools.filter((t) => !b.tools.includes(t)); if (added.length) changes.push({ kind: "tool_change", detail: `${id} gains tools ${added.join(", ")}`, assets: [id] });
    if (b.model_route !== c.model_route) changes.push({ kind: "model_route_change", detail: `${id} model route ${b.model_route} -> ${c.model_route}`, assets: [id] }); }
  for (const r of candidate.graph.relationships.filter((r) => r.kind === "invokes_tool")) if (!base.graph.relationships.some((x) => x.kind === "invokes_tool" && x.source_id === r.source_id && x.target_id === r.target_id)) changes.push({ kind: "tool_change", detail: `${r.source_id} may now invoke ${r.target_id}`, assets: [r.source_id, r.target_id] });
  // telemetry
  const covered = (s: Side) => new Set(s.sources.flatMap((x) => x.asset_ids));
  const bc = covered(base), cc = covered(candidate);
  for (const a of bc) if (!cc.has(a) && candidate.graph.assets.some((x) => x.id === a)) changes.push({ kind: "lost_telemetry", detail: `${a} loses all telemetry sources`, assets: [a] });
  for (const a of candidate.graph.assets) if (!cc.has(a.id) && !base.graph.assets.some((x) => x.id === a.id)) changes.push({ kind: "lost_telemetry", detail: `new asset ${a.id} has no telemetry source`, assets: [a.id] });
  for (const a of candidate.graph.assets) if (candidate.artifacts[a.id] === undefined && base.artifacts[a.id] !== undefined) unknowns.push(`candidate artifact for ${a.id} is not stated`);
  const tests = changes.flatMap((c) => c.kind === "new_ingress" ? [{ for: c.detail, negative: `unauthenticated request from outside to ${c.assets[0]} is refused`, positive: `an intended authenticated request to ${c.assets[0]} succeeds` }]
    : c.kind === "broader_grant" ? [{ for: c.detail, negative: "an identity outside the intended scope is denied the action", positive: "the intended identity performs the action" }]
    : c.kind === "tool_change" || c.kind === "model_route_change" ? [{ for: c.detail, negative: "a prohibited destination via the new tool is denied by the gateway", positive: "the intended tool call completes and is independently observed" }]
    : [{ for: c.detail, negative: "n/a", positive: `a test event from ${c.assets[0]} arrives at Digital Kingdom` }]);
  const posture = changes.length || unknowns.length ? "review_required" : "no_material_change_found";
  const candidateDigest = digest({ commit: candidate.commit, graph: candidate.graph, snapshot: candidate.snapshot ?? null, sources: candidate.sources, artifacts: candidate.artifacts, agents: candidate.agents ?? [] });
  return { schema: "dk.change_review.v1", base_commit: base.commit, candidate_commit: candidate.commit, candidate_digest: candidateDigest, posture, changes, unknowns, suggested_tests: tests,
    note: posture === "no_material_change_found" ? "No new ingress, grant, tool, model-route or telemetry change was found in the stated inputs; this is not a statement that the change is safe." : "Unknown scope is never treated as favourable." };
}

export class ChangeReviews {
  constructor(private readonly db: DatabaseSync, private readonly now: () => Date) {}
  create(projectId: string, input: ChangePlanInput, actor: string) {
    if (!input?.base?.graph || !input?.candidate?.graph || typeof input.candidate.commit !== "string") throw new HttpError(400, "base and candidate (commit, graph, sources, artifacts) are required");
    const r = reviewChange(input);
    const id = `chg_${randomBytes(8).toString("hex")}`;
    this.db.prepare("INSERT INTO change_reviews (id, project_id, candidate_digest, plan, review, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, projectId, r.candidate_digest, JSON.stringify(input), JSON.stringify(r), this.now().toISOString(), actor);
    return { id, ...r };
  }
  private row(projectId: string, id: string) { const r = this.db.prepare("SELECT * FROM change_reviews WHERE id = ? AND project_id = ?").get(id, projectId) as Record<string, string> | undefined; if (!r) throw new HttpError(404, "change review not found"); return r; }
  ownerReview(projectId: string, id: string, b: { decision?: unknown; candidate_digest?: unknown }, actor: string, principalType: string) {
    if (principalType !== "human") throw new HttpError(403, "only a person can review a change");
    const r = this.row(projectId, id);
    if (b.candidate_digest !== r.candidate_digest) throw new HttpError(409, "the candidate changed since this review; create a new review for the new candidate");
    if (b.decision !== "accepted" && b.decision !== "rejected") throw new HttpError(400, "decision must be accepted or rejected");
    if (r.created_by === actor) throw new HttpError(403, "the author of the review cannot accept it");
    this.db.prepare("UPDATE change_reviews SET owner_decision = ?, owner = ?, owner_at = ? WHERE id = ?").run(String(b.decision), actor, this.now().toISOString(), id);
    return this.get(projectId, id);
  }
  postDeploy(projectId: string, id: string, observed: { commit?: string; artifacts?: Record<string, string>; graph?: Graph; snapshot?: AuthSnapshot | null }) {
    const r = this.row(projectId, id);
    const plan = JSON.parse(r.plan!) as ChangePlanInput;
    const drift: string[] = [];
    if (observed.commit !== plan.candidate.commit) drift.push(`running commit ${String(observed.commit ?? "unknown")} is not the reviewed ${plan.candidate.commit}`);
    for (const [asset, d] of Object.entries(plan.candidate.artifacts)) { const o = observed.artifacts?.[asset]; if (o !== d) drift.push(`${asset} runs ${o ?? "an unobserved artifact"}, reviewed ${d}`); }
    if (observed.graph && digest(observed.graph.assets.map((a) => a.id).sort()) !== digest(plan.candidate.graph.assets.map((a) => a.id).sort())) drift.push("the observed inventory differs from the reviewed candidate");
    if (observed.snapshot !== undefined && digest(observed.snapshot) !== digest(plan.candidate.snapshot ?? null)) drift.push("the observed authorization snapshot differs from the reviewed one");
    const result = { checked_at: this.now().toISOString(), matches_review: drift.length === 0, drift };
    this.db.prepare("UPDATE change_reviews SET post_deploy = ? WHERE id = ?").run(JSON.stringify(result), id);
    return result;
  }
  get(projectId: string, id: string) { const r = this.row(projectId, id); return { id, ...JSON.parse(r.review!), owner_decision: r.owner_decision ?? null, owner: r.owner ?? null, post_deploy: r.post_deploy ? JSON.parse(r.post_deploy) : null }; }
}
