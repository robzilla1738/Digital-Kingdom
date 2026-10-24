import { latestLocalConfig, POLICY_VARIANTS, type PolicyVariant } from "./local-config.ts";
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { canonicalJson, type Graph, type Relationship } from "@dk/contracts";
import { sha256 } from "./security.ts";
import { HttpError, type Store } from "./store.ts";
import type { Role } from "./security.ts";
import { accessPaths, evaluate, EVALUATOR_VERSION, type AuthSnapshot, type Decision, type PolicyDoc, type Statement } from "./access/aws-policy.ts";
import { reviewChange, type Side } from "./change-review.ts";
import { worldComparison } from "./world-comparison.ts";

/**
 * LP13 bounded path and change exploration.
 *
 * - `dk.analysis_state.v1`: a canonical, hashable view of what the project declares — grants (every statement of every
 *   authorization layer in the stored snapshot), declared routes, agent tool links, deployed artifacts and telemetry
 *   sources. Every element is identified by (kind, authority, id): the same name under a different account, registry
 *   or environment is a different element, everywhere.
 * - A candidate is a finite list of typed changes applied to a CLONE of that state in an analysis namespace
 *   (`branch:<hash>`). It is stored only in `analysis_comparisons` (append-only). It never writes facts, findings,
 *   graph revisions, scenes, approvals or change reviews, and never fabricates observed traffic.
 * - Comparisons are model-only (declared/configured change under a supported evaluator). Executed-local comparison is
 *   LP16+ and external effectiveness is deferred (EXT01).
 * - Every comparison has a deterministic receipt (`dk.analysis_receipt.v1`): exact base and candidate state hashes,
 *   evaluator/policy version, the conditions encountered and every unassessed path. The same inputs give the same
 *   receipt digest.
 * - `dk.path_explanation.v1` answers "why can this reach that?" with provenance per hop. Only a relationship whose
 *   own evidence level is `observed` with evidence references is observed activity; configured permission (even
 *   feasible) and conditional permission are never presented as observed use, and semantics outside the evaluator's
 *   support stay unresolved with the missing prerequisite named.
 */
export const ANALYSIS_STATE = "dk.analysis_state.v1";
export const ANALYSIS_RECEIPT = "dk.analysis_receipt.v1";
export const PATH_EXPLANATION = "dk.path_explanation.v1";
export const ANALYSIS_LIMITS = { max_changes: 50, max_probes: 20, max_graph_hops: 6, max_paths: 20 } as const;

export const ANALYSIS_MIGRATION = `
CREATE TABLE analysis_comparisons (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, namespace TEXT NOT NULL, base_state_hash TEXT NOT NULL, candidate_state_hash TEXT NOT NULL, proposal TEXT NOT NULL, candidate_state TEXT NOT NULL, comparison TEXT NOT NULL, receipt TEXT NOT NULL, receipt_digest TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX analysis_comparisons_project ON analysis_comparisons (project_id, created_at);
CREATE TRIGGER analysis_comparisons_append_only_u BEFORE UPDATE ON analysis_comparisons BEGIN SELECT RAISE(ABORT, 'analysis comparisons are append-only'); END;
CREATE TRIGGER analysis_comparisons_append_only_d BEFORE DELETE ON analysis_comparisons BEGIN SELECT RAISE(ABORT, 'analysis comparisons are append-only'); END;`;

export type ElementKind = "grant" | "credential" | "route" | "tool" | "artifact" | "source" | "policy";
export const ELEMENT_KINDS: ElementKind[] = ["grant", "credential", "route", "tool", "artifact", "source", "policy"];
export interface Element { kind: ElementKind; authority: string; id: string; attrs: Record<string, unknown>; provenance: string[] }
export interface AnalysisState {
  schema: typeof ANALYSIS_STATE; project_id: string; namespace: string;
  base: { graph_revision: string | null; snapshot_id: string | null; snapshot_digest: string | null; source_revisions: Record<string, number>; local_config?: { id: string; digest: string } };
  policy_version: string; elements: Element[];
}
export const keyOf = (e: Pick<Element, "kind" | "authority" | "id">) => `${e.kind}|${e.authority}|${e.id}`;
export const stateHash = (s: AnalysisState) => sha256(canonicalJson({ ...s, namespace: undefined }));
const ID_RE = /^[^\u0000-\u001f]{1,400}$/;
const LAYERS = ["identity", "boundary", "trust", "resource", "scp"] as const;
type Layer = (typeof LAYERS)[number];

// ------------------------------------------------------------------------------------------------ baseline state
/** An ARN's resource part (`user/deployer`, `acme-exports`): the name within its authority (the account). */
const nameInAuthority = (arn: string) => arn.startsWith("arn:") ? arn.split(":").slice(5).join(":") || arn : arn;
export function grantElements(snap: AuthSnapshot): Element[] {
  const out: Element[] = [];
  const docs = (layer: Layer, owner: string, authority: string, d: PolicyDoc | PolicyDoc[] | "unknown" | null | undefined) => {
    if (d === undefined || d === null) return;
    if (d === "unknown") { out.push({ kind: "grant", authority, id: `${nameInAuthority(owner)}#${layer}#unknown`, attrs: { layer, owner, unknown: true }, provenance: [`snapshot:${snap.snapshot_id}`] }); return; }
    for (const doc of Array.isArray(d) ? d : [d]) doc.Statement.forEach((st, i) => out.push({ kind: "grant", authority, id: `${nameInAuthority(owner)}#${layer}#${doc.id}#${st.Sid ?? i}`, attrs: { layer, owner, doc: doc.id, order: i, statement: st, conditional: !!st.Condition && Object.keys(st.Condition).length > 0 }, provenance: [`snapshot:${snap.snapshot_id}`, `policy:${doc.id}`] }));
  };
  for (const p of snap.principals) {
    docs("identity", p.arn, p.account, p.policies); docs("boundary", p.arn, p.account, p.boundary); if (p.type === "role") docs("trust", p.arn, p.account, p.trust);
    // credential references only (key id + status); secret values never exist in a snapshot or here
    for (const k of p.access_keys ?? []) out.push({ kind: "credential", authority: p.account, id: `${nameInAuthority(p.arn)}#key#${k.id}`, attrs: { owner: p.arn, key_id: k.id, status: k.status }, provenance: [`snapshot:${snap.snapshot_id}`] });
  }
  for (const r of snap.resources) docs("resource", r.arn, r.account, r.policy);
  if (snap.organization) docs("scp", "organization", "organization", snap.organization.scps);
  return out;
}
const authorityOfAsset = (g: Graph, assetId: string, projectId: string) => { const a = g.assets.find((x) => x.id === assetId); return a?.provider_ref?.scope ?? `${projectId}/${a?.environment ?? "unknown"}`; };
/** A deployment reference `registry/name:tag@sha256:…` → authority (registry), name, version. */
export function parseArtifact(ref: string): { authority: string; name: string; version: string } {
  const at = ref.indexOf("@"); const digest = at >= 0 ? ref.slice(at + 1) : ""; const base = at >= 0 ? ref.slice(0, at) : ref;
  const slash = base.indexOf("/"); const host = slash > 0 && /[.:]|^localhost$/.test(base.slice(0, slash)) ? base.slice(0, slash) : "unqualified";
  const rest = host === "unqualified" ? base : base.slice(slash + 1);
  const colon = rest.lastIndexOf(":"); const name = colon > 0 ? rest.slice(0, colon) : rest; const tag = colon > 0 ? rest.slice(colon + 1) : "";
  return { authority: host, name, version: digest || tag || "unversioned" };
}

export function baselineState(store: Store, projectId: string, snap: AuthSnapshot | null): AnalysisState {
  const g = store.getGraph(projectId) ?? { schema_version: "0.2", project_id: projectId, graph_revision: "not-imported", dataset_kind: "live", assets: [], relationships: [] } as unknown as Graph;
  const elements: Element[] = [];
  if (snap) elements.push(...grantElements(snap));
  for (const a of g.assets) for (const r of a.routes ?? []) elements.push({ kind: "route", authority: authorityOfAsset(g, a.id, projectId), id: `${a.id} ${(r.methods ?? []).join(",") || "*"} ${r.path}${r.hosts?.length ? ` @${r.hosts.join(",")}` : ""}`, attrs: { asset_id: a.id, path: r.path, ...(r.methods ? { methods: r.methods } : {}), ...(r.hosts ? { hosts: r.hosts } : {}) }, provenance: [`graph:${g.graph_revision}`] });
  for (const r of g.relationships.filter((x) => x.kind === "invokes_tool")) elements.push({ kind: "tool", authority: authorityOfAsset(g, r.source_id, projectId), id: `${r.source_id}->${r.target_id}`, attrs: { agent: r.source_id, tool: r.target_id, evidence_level: r.evidence_level }, provenance: [`graph:${g.graph_revision}`, `relationship:${r.id}`] });
  for (const a of g.assets.filter((x) => x.deployment)) { const p = parseArtifact(a.deployment!); elements.push({ kind: "artifact", authority: p.authority, id: `${a.id}:${p.name}`, attrs: { asset_id: a.id, name: p.name, version: p.version, reference: a.deployment }, provenance: [`graph:${g.graph_revision}`] }); }
  // declared policy variants of a local run's enforcement points (latest dk.local.config_snapshot.v1; local runs only)
  const cfg = latestLocalConfig(store, projectId);
  for (const r of cfg?.resources ?? []) elements.push({ kind: "policy", authority: authorityOfAsset(g, r.resource_id, projectId), id: `${r.resource_id}#policy`, attrs: { asset_id: r.resource_id, template: r.template, variant: r.policy_variant, ...(r.tenant_mode ? { tenant_mode: r.tenant_mode } : {}), revision: r.revision }, provenance: [`local_config:${cfg!.id}`] });
  for (const s of store.listSources(projectId)) elements.push({ kind: "source", authority: projectId, id: s.id, attrs: { asset_ids: [...(s.asset_ids ?? [])].sort(), disabled: !!(s as { disabled?: boolean }).disabled, kind: (s as { kind?: string }).kind ?? "generic" }, provenance: [`source:${s.id}`] });
  elements.sort((x, y) => keyOf(x).localeCompare(keyOf(y)));
  const revs = Object.fromEntries((store.db.prepare("SELECT id, config_revision FROM sources WHERE project_id = ? ORDER BY id").all(projectId) as { id: string; config_revision: number }[]).map((r) => [r.id, Number(r.config_revision ?? 0)]));
  return { schema: ANALYSIS_STATE, project_id: projectId, namespace: "baseline", base: { graph_revision: g.graph_revision ?? null, snapshot_id: snap?.snapshot_id ?? null, snapshot_digest: snap ? sha256(canonicalJson(snap)) : null, source_revisions: revs, ...(cfg ? { local_config: { id: cfg.id, digest: cfg.digest } } : {}) }, policy_version: EVALUATOR_VERSION, elements };
}

// ------------------------------------------------------------------------------------------------ candidates
export interface Change { op: "add" | "remove" | "modify"; kind: ElementKind; authority: string; id: string; attrs?: Record<string, unknown> }
const ALLOWED_ATTRS: Record<ElementKind, string[]> = {
  grant: ["layer", "owner", "doc", "order", "statement"],
  credential: ["status"],
  route: ["asset_id", "path", "methods", "hosts"],
  tool: ["agent", "tool", "gateway", "policy_ref"],
  artifact: ["asset_id", "name", "version", "reference"],
  source: ["asset_ids", "disabled"],
  policy: ["asset_id", "template", "variant", "tenant_mode", "revision"],
};
const STATEMENT_KEYS = new Set(["Sid", "Effect", "Action", "NotAction", "Resource", "NotResource", "Principal", "Condition", "NotPrincipal"]);
function checkChange(c: unknown, i: number): Change {
  if (!c || typeof c !== "object" || Array.isArray(c)) throw new HttpError(422, `changes[${i}] must be an object`);
  const o = c as Record<string, unknown>;
  const bad = Object.keys(o).filter((k) => !["op", "kind", "authority", "id", "attrs"].includes(k));
  if (bad.length) throw new HttpError(422, `changes[${i}] unsupported field(s) ${bad.join(", ")}`);
  if (!["add", "remove", "modify"].includes(o.op as string)) throw new HttpError(422, `changes[${i}].op must be add, remove or modify`);
  if (!ELEMENT_KINDS.includes(o.kind as ElementKind)) throw new HttpError(422, `changes[${i}].kind must be one of ${ELEMENT_KINDS.join(", ")}`);
  for (const k of ["authority", "id"]) if (typeof o[k] !== "string" || !ID_RE.test(o[k] as string)) throw new HttpError(422, `changes[${i}].${k} must be a string of 1-400 printable characters`);
  const kind = o.kind as ElementKind;
  if (o.op !== "remove") {
    if (!o.attrs || typeof o.attrs !== "object" || Array.isArray(o.attrs)) throw new HttpError(422, `changes[${i}].attrs is required for ${String(o.op)}`);
    const extra = Object.keys(o.attrs).filter((k) => !ALLOWED_ATTRS[kind].includes(k));
    if (extra.length) throw new HttpError(422, `changes[${i}].attrs unsupported for ${kind}: ${extra.join(", ")}`, [`allowed: ${ALLOWED_ATTRS[kind].join(", ")}`]);
    const a = o.attrs as Record<string, unknown>;
    if (kind === "grant" && a.statement !== undefined) {
      const st = a.statement as Record<string, unknown>;
      if (!st || typeof st !== "object" || Array.isArray(st) || (st.Effect !== "Allow" && st.Effect !== "Deny")) throw new HttpError(422, `changes[${i}].attrs.statement needs Effect Allow or Deny`);
      const unknown = Object.keys(st).filter((k) => !STATEMENT_KEYS.has(k));
      if (unknown.length) throw new HttpError(422, `changes[${i}].attrs.statement unsupported key(s) ${unknown.join(", ")}`);
    }
    if (kind === "credential" && a.status !== "Active" && a.status !== "Inactive") throw new HttpError(422, `changes[${i}].attrs.status must be Active or Inactive`);
    if (kind === "tool" && a.gateway !== undefined && a.gateway !== "allow" && a.gateway !== "deny") throw new HttpError(422, `changes[${i}].attrs.gateway must be allow or deny`);
    if (kind === "policy" && a.variant !== undefined && !POLICY_VARIANTS.includes(a.variant as PolicyVariant)) throw new HttpError(422, `changes[${i}].attrs.variant must be one of ${POLICY_VARIANTS.join(", ")}`);
    if (kind === "grant" && a.layer !== undefined && !LAYERS.includes(a.layer as Layer)) throw new HttpError(422, `changes[${i}].attrs.layer must be one of ${LAYERS.join(", ")}`);
    if (canonicalJson(a).length > 20_000) throw new HttpError(413, `changes[${i}].attrs too large`);
  }
  return { op: o.op as Change["op"], kind, authority: o.authority as string, id: o.id as string, ...(o.attrs ? { attrs: o.attrs as Record<string, unknown> } : {}) };
}

export function applyChanges(base: AnalysisState, changes: Change[], namespace: string): AnalysisState {
  const map = new Map(base.elements.map((e) => [keyOf(e), structuredClone(e)]));
  for (const [i, c] of changes.entries()) {
    const k = keyOf(c); const cur = map.get(k);
    if (c.op === "add") { if (cur) throw new HttpError(409, `changes[${i}] adds ${k}, which already exists`); map.set(k, { kind: c.kind, authority: c.authority, id: c.id, attrs: { ...c.attrs }, provenance: [`proposal:${namespace}`] }); }
    else if (!cur) throw new HttpError(409, `changes[${i}] ${c.op}s ${k}, which does not exist in the base state (same name under another authority is a different element)`);
    else if (c.op === "remove") map.delete(k);
    else map.set(k, { ...cur, attrs: { ...cur.attrs, ...c.attrs, ...(c.kind === "grant" && c.attrs?.statement ? { conditional: !!(c.attrs.statement as Statement).Condition && Object.keys((c.attrs.statement as Statement).Condition ?? {}).length > 0 } : {}) }, provenance: [...cur.provenance, `proposal:${namespace}`] });
  }
  const elements = [...map.values()].sort((x, y) => keyOf(x).localeCompare(keyOf(y)));
  return { ...structuredClone(base), namespace, elements };
}

/** Rebuild an authorization snapshot from a state's grant elements (layer, owner, doc, order). */
export function snapshotFromState(baseSnap: AuthSnapshot | null, s: AnalysisState): AuthSnapshot | null {
  if (!baseSnap) return null;
  const snap = structuredClone(baseSnap);
  const grants = s.elements.filter((e) => e.kind === "grant");
  const docsFor = (layer: Layer, owner: string): PolicyDoc[] | "unknown" | null => {
    const mine = grants.filter((g) => g.attrs.layer === layer && g.attrs.owner === owner);
    if (mine.some((g) => g.attrs.unknown)) return "unknown";
    if (!mine.length) return null;
    const byDoc = new Map<string, Element[]>();
    for (const g of mine) { const d = String(g.attrs.doc); byDoc.set(d, [...(byDoc.get(d) ?? []), g]); }
    return [...byDoc].sort(([a], [b]) => a.localeCompare(b)).map(([id, els]) => ({ id, Statement: els.sort((x, y) => Number(x.attrs.order ?? 0) - Number(y.attrs.order ?? 0)).map((x) => x.attrs.statement as Statement) }));
  };
  for (const p of snap.principals) {
    if (p.access_keys) p.access_keys = p.access_keys.map((k) => { const e = s.elements.find((x) => x.kind === "credential" && x.attrs.owner === p.arn && x.attrs.key_id === k.id); return { ...k, status: (e?.attrs.status as "Active" | "Inactive" | undefined) ?? k.status }; });
    const id = docsFor("identity", p.arn); p.policies = id === null ? [] : id;
    if (p.boundary !== undefined) { const b = docsFor("boundary", p.arn); p.boundary = b === null ? null : b === "unknown" ? "unknown" : b[0]!; }
    if (p.type === "role" && p.trust !== undefined) { const t = docsFor("trust", p.arn); p.trust = t === null ? { id: "none", Statement: [] } : t === "unknown" ? "unknown" : t[0]!; }
  }
  for (const r of snap.resources) if (r.policy !== undefined) { const d = docsFor("resource", r.arn); r.policy = d === null ? null : d === "unknown" ? "unknown" : d[0]!; }
  if (snap.organization) { const d = docsFor("scp", "organization"); snap.organization.scps = d === null ? [] : d; }
  return snap;
}

/** The graph a state implies: declared routes and agent tool links come from the state, everything else from the base graph. */
export function graphFromState(base: Graph, s: AnalysisState): Graph {
  const g = structuredClone(base);
  for (const a of g.assets) {
    const routes = s.elements.filter((e) => e.kind === "route" && e.attrs.asset_id === a.id).map((e) => ({ path: e.attrs.path, ...(e.attrs.methods ? { methods: e.attrs.methods } : {}), ...(e.attrs.hosts ? { hosts: e.attrs.hosts } : {}) }));
    if (routes.length || a.routes) (a as { routes?: unknown }).routes = routes;
    const art = s.elements.find((e) => e.kind === "artifact" && e.attrs.asset_id === a.id);
    if (art) a.deployment = String(art.attrs.reference ?? `${art.authority}/${String(art.attrs.name)}@${String(art.attrs.version)}`);
  }
  // a tool link whose gateway policy denies it is not a path in that state
  const tools = s.elements.filter((e) => e.kind === "tool" && e.attrs.gateway !== "deny");
  g.relationships = g.relationships.filter((r) => r.kind !== "invokes_tool" || tools.some((t) => t.attrs.agent === r.source_id && t.attrs.tool === r.target_id));
  for (const t of tools) if (!g.relationships.some((r) => r.kind === "invokes_tool" && r.source_id === t.attrs.agent && r.target_id === t.attrs.tool))
    g.relationships.push({ id: `proposed:${t.attrs.agent}->${t.attrs.tool}`, source_id: String(t.attrs.agent), target_id: String(t.attrs.tool), kind: "invokes_tool", evidence_level: "hypothetical", evidence_refs: [] } as unknown as Relationship);
  return g;
}

// ------------------------------------------------------------------------------------------------ comparison
export interface Probe { principal: string; action: string; resource: string }
/**
 * `evaluate`, plus one declared fact the evaluator does not use: an IAM user whose every access key is Inactive has no
 * usable long-term credential, so its configured permission is not usable through a key (blocked, reason stated).
 * A user with no keys listed is evaluated unchanged (keys may simply not be in the snapshot).
 */
export function evaluateWithCredentials(snap: AuthSnapshot, principal: string, action: string, resource: string): Decision {
  const d = evaluate(snap, principal, action, resource);
  const p = snap.principals.find((x) => x.arn === principal);
  if (p && p.type === "user" && p.access_keys?.length && p.access_keys.every((k) => k.status === "Inactive") && d.result !== "blocked")
    return { ...d, result: "blocked", reasons: [`every access key of ${principal} is Inactive: no usable credential (configured permission was ${d.result})`, ...d.reasons] };
  return d;
}
const SUPPORTED_ACTION = (a: string) => /^s3:/i.test(a) || a.toLowerCase() === "sts:assumerole";
export function compareStates(input: { base: AnalysisState; candidate: AnalysisState; baseSnap: AuthSnapshot | null; baseGraph: Graph; probes: Probe[]; sources: { id: string; asset_ids: string[] }[] }) {
  const { base, candidate } = input;
  const bm = new Map(base.elements.map((e) => [keyOf(e), e])), cm = new Map(candidate.elements.map((e) => [keyOf(e), e]));
  const added = [...cm.keys()].filter((k) => !bm.has(k)).sort(), removed = [...bm.keys()].filter((k) => !cm.has(k)).sort();
  const modified = [...cm.keys()].filter((k) => bm.has(k) && canonicalJson(bm.get(k)!.attrs) !== canonicalJson(cm.get(k)!.attrs)).sort().map((k) => ({ key: k, before: bm.get(k)!.attrs, after: cm.get(k)!.attrs }));
  const changedKeys = [...added, ...removed, ...modified.map((m) => m.key)];
  const cSnap = snapshotFromState(input.baseSnap, candidate);
  const decisions = input.probes.map((p) => {
    if (!SUPPORTED_ACTION(p.action) || !/^arn:aws:/.test(p.resource) || !/^arn:aws:/.test(p.principal)) return { probe: p, supported: false, base: null, candidate: null, reason: `${p.action} on ${p.resource}: provider/action semantics outside ${EVALUATOR_VERSION} (AWS S3 actions and sts:AssumeRole only); unresolved` };
    if (!input.baseSnap || !cSnap) return { probe: p, supported: true, base: null, candidate: null, reason: "no authorization snapshot stored; unresolved" };
    return { probe: p, supported: true, base: evaluateWithCredentials(input.baseSnap, p.principal, p.action, p.resource), candidate: evaluateWithCredentials(cSnap, p.principal, p.action, p.resource), reason: null };
  });
  const condition_keys = [...new Set([
    ...decisions.flatMap((d) => [...(d.base?.condition_keys ?? []), ...(d.candidate?.condition_keys ?? [])]),
    ...candidate.elements.filter((e) => e.kind === "grant" && e.attrs.conditional && changedKeys.includes(keyOf(e))).flatMap((e) => Object.values((e.attrs.statement as Statement).Condition ?? {}).flatMap((v) => Object.keys(v as object))),
  ])].sort();
  const unassessed: string[] = [];
  for (const d of decisions) {
    if (!d.base || !d.candidate) unassessed.push(d.reason!);
    else { if (d.candidate.result === "unresolved") unassessed.push(`${d.probe.principal} ${d.probe.action} ${d.probe.resource}: unresolved in the candidate (${d.candidate.reasons[0] ?? ""})`); if (d.candidate.result === "conditional") unassessed.push(`${d.probe.principal} ${d.probe.action} ${d.probe.resource}: conditional on ${d.candidate.condition_keys.join(", ") || "conditions"} (conditions are not evaluated)`); }
  }
  const probedOwners = new Set(input.probes.flatMap((p) => [p.principal, p.resource]));
  for (const k of changedKeys.filter((x) => x.startsWith("grant|") || x.startsWith("credential|"))) { const e = cm.get(k) ?? bm.get(k)!; if (!probedOwners.has(String(e.attrs.owner))) unassessed.push(`${k}: changed ${k.split("|")[0]} not exercised by any probe`); }
  for (const k of changedKeys.filter((x) => !x.startsWith("grant|") && !x.startsWith("credential|"))) unassessed.push(`${k}: declared change only; its runtime behaviour was not executed (model-only comparison)`);
  const side = (s: AnalysisState, snap: AuthSnapshot | null): Side => ({ commit: `state:${stateHash(s).slice(0, 16)}`, graph: graphFromState(input.baseGraph, s), snapshot: snap,
    sources: s.elements.filter((e) => e.kind === "source" && !e.attrs.disabled).map((e) => ({ id: e.id, asset_ids: e.attrs.asset_ids as string[] })),
    artifacts: Object.fromEntries(s.elements.filter((e) => e.kind === "artifact").map((e) => [String(e.attrs.asset_id), `${e.authority}/${String(e.attrs.name)}@${String(e.attrs.version)}`])),
    agents: [] });
  const review = reviewChange({ base: side(base, input.baseSnap), candidate: side(candidate, cSnap), probes: input.probes.filter((p) => SUPPORTED_ACTION(p.action)) });
  return {
    mode: "model_only" as const,
    added, removed, modified,
    access: decisions.map((d) => ({ probe: d.probe, supported: d.supported, base: d.base && pick(d.base), candidate: d.candidate && pick(d.candidate), ...(d.reason ? { reason: d.reason } : {}), basis: "configured_permission" as const, observed_use: false as const })),
    review: { posture: review.posture, changes: review.changes, unknowns: review.unknowns },
    condition_keys, unassessed_paths: [...new Set(unassessed)],
    not_claimed: ["Model-only: declared/configured relationships under a supported evaluator. Nothing here was executed or observed.", "An unresolved or conditional path is not closed.", "No baseline fact, finding, scene or approval was changed."],
  };
}
const pick = (d: Decision) => ({ result: d.result, reasons: d.reasons, condition_keys: d.condition_keys, unsupported: d.unsupported, evaluator: d.evaluator });

// ------------------------------------------------------------------------------------------------ path explanation
interface Hop { kind: "relationship" | "permission"; from: string; to: string; ref: string; relationship_kind?: string; evidence_level?: string; result?: string; basis: "observed_activity" | "declared_relationship" | "inferred_relationship" | "proposed_relationship" | "configured_permission"; observed: boolean; provenance: string[]; condition_keys: string[]; presentation: { animate: boolean; line: "solid_observed" | "dashed_declared" | "dashed_inferred" | "dashed_conditional" | "dashed_configured" | "dotted_proposed" } }
export function explainPath(input: { graph: Graph; snap: AuthSnapshot | null; namespace: string; from: string; to: string; principal?: string; action?: string; resource?: string; maxHops?: number }) {
  const { graph } = input;
  const maxHops = Math.min(ANALYSIS_LIMITS.max_graph_hops, Math.max(1, input.maxHops ?? 4));
  const known = new Set(graph.assets.map((a) => a.id));
  const unresolved: string[] = [];
  if (!known.has(input.from)) unresolved.push(`asset ${input.from} is not in the ${input.namespace} inventory`);
  if (!known.has(input.to)) unresolved.push(`asset ${input.to} is not in the ${input.namespace} inventory`);
  const relHop = (r: Relationship): Hop => {
    const observed = r.evidence_level === "observed" && (r.evidence_refs ?? []).length > 0;
    const proposed = r.id.startsWith("proposed:");
    const basis = proposed ? "proposed_relationship" : observed ? "observed_activity" : r.evidence_level === "inferred" ? "inferred_relationship" : "declared_relationship";
    return { kind: "relationship", from: r.source_id, to: r.target_id, ref: r.id, relationship_kind: r.kind, evidence_level: r.evidence_level, basis, observed: observed && !proposed, provenance: [...(r.evidence_refs ?? [])], condition_keys: [],
      presentation: { animate: observed && !proposed, line: proposed ? "dotted_proposed" : observed ? "solid_observed" : r.evidence_level === "inferred" ? "dashed_inferred" : "dashed_declared" } };
  };
  const paths: { hops: Hop[]; result: string }[] = [];
  if (!unresolved.length) {
    const walk = (at: string, seen: string[], hops: Hop[]) => {
      if (paths.length >= ANALYSIS_LIMITS.max_paths) return;
      if (at === input.to && hops.length) { paths.push({ hops, result: hops.every((h) => h.observed) ? "observed" : "declared" }); return; }
      if (hops.length >= maxHops) return;
      for (const r of graph.relationships.filter((x) => x.source_id === at && !seen.includes(x.target_id)).sort((a, b) => a.id.localeCompare(b.id))) walk(r.target_id, [...seen, r.target_id], [...hops, relHop(r)]);
    };
    walk(input.from, [input.from], []);
  }
  let permission: null | { result: string; paths: { hops: Hop[]; result: string; reasons: string[]; unsupported: string[] }[]; unresolved_prerequisites: string[] } = null;
  if (input.principal || input.action || input.resource) {
    const prereq: string[] = [];
    if (!input.principal || !input.action || !input.resource) prereq.push("principal, action and resource are all required for a permission path");
    else if (!SUPPORTED_ACTION(input.action) || !/^arn:aws:/.test(input.resource) || !/^arn:aws:/.test(input.principal)) prereq.push(`${input.action} on ${input.resource}: provider/action semantics outside ${EVALUATOR_VERSION} (AWS S3 actions and sts:AssumeRole only)`);
    else if (!input.snap) prereq.push("no authorization snapshot is stored for this state");
    if (prereq.length) permission = { result: "unresolved", paths: [], unresolved_prerequisites: prereq };
    else {
      const ap = accessPaths(input.snap!, input.principal!, input.action!, input.resource!, 2).slice(0, ANALYSIS_LIMITS.max_paths);
      const toHops = (hops: string[], d: Decision): Hop[] => hops.map((h, i) => ({ kind: "permission" as const, from: h, to: hops[i + 1] ?? input.resource!, ref: `${input.action}`, result: d.result, basis: "configured_permission" as const, observed: false, provenance: d.evidence.slice(0, 20), condition_keys: d.condition_keys,
        presentation: { animate: false, line: d.result === "conditional" ? "dashed_conditional" as const : "dashed_configured" as const } }));
      const pre = new Set<string>();
      for (const p of ap) { for (const u of p.decision.unsupported) pre.add(`unsupported construct: ${u}`); if (p.decision.result === "unresolved") for (const r of p.decision.reasons) pre.add(r); if (p.decision.result === "conditional") pre.add(`conditions not evaluated: ${p.decision.condition_keys.join(", ") || "(keys not stated)"} must hold`); }
      permission = { result: ap[0]?.decision.result ?? "unresolved", paths: ap.map((p) => ({ hops: toHops(p.hops, p.decision), result: p.decision.result, reasons: p.decision.reasons, unsupported: p.decision.unsupported })), unresolved_prerequisites: [...pre] };
    }
  }
  return {
    schema: PATH_EXPLANATION, namespace: input.namespace, from: input.from, to: input.to, evaluator: EVALUATOR_VERSION,
    reachable: paths.length ? (paths.some((p) => p.result === "observed") ? "observed_path_exists" : "declared_path_exists") : unresolved.length ? "unresolved" : "no_declared_path_found",
    paths, unresolved_prerequisites: unresolved, permission,
    note: "Relationships are declared/inferred unless their own evidence level is observed with evidence references. Configured or conditional permission is never observed use, and is never animated as such.",
  };
}

// ------------------------------------------------------------------------------------------------ service + routes
export class Exploration {
  constructor(private readonly store: Store) {}
  latestSnapshot(projectId: string): AuthSnapshot | null { const r = this.store.db.prepare("SELECT body FROM access_snapshots WHERE project_id = ? ORDER BY taken_at DESC, stored_at DESC LIMIT 1").get(projectId) as { body: string } | undefined; return r ? JSON.parse(r.body) : null; }
  baseline(projectId: string) { const s = baselineState(this.store, projectId, this.latestSnapshot(projectId)); return { state: s, state_hash: stateHash(s) }; }
  compare(projectId: string, body: Record<string, unknown>, actor: string) {
    const bad = Object.keys(body).filter((k) => !["base_state_hash", "changes", "probes", "label"].includes(k));
    if (bad.length) throw new HttpError(422, `unsupported field(s) ${bad.join(", ")}`);
    if (typeof body.base_state_hash !== "string" || !/^[a-f0-9]{64}$/.test(body.base_state_hash)) throw new HttpError(428, "base_state_hash (the baseline state you reviewed) is required");
    if (!Array.isArray(body.changes) || !body.changes.length || body.changes.length > ANALYSIS_LIMITS.max_changes) throw new HttpError(422, `changes must list 1-${ANALYSIS_LIMITS.max_changes} typed changes`);
    const probesIn = body.probes ?? [];
    if (!Array.isArray(probesIn) || probesIn.length > ANALYSIS_LIMITS.max_probes) throw new HttpError(422, `probes must be a list of at most ${ANALYSIS_LIMITS.max_probes}`);
    const probes = probesIn.map((p, i) => { const o = p as Record<string, unknown>; if (!o || typeof o.principal !== "string" || typeof o.action !== "string" || typeof o.resource !== "string" || Object.keys(o).some((k) => !["principal", "action", "resource"].includes(k))) throw new HttpError(422, `probes[${i}] needs exactly principal, action and resource`); return { principal: o.principal, action: o.action, resource: o.resource }; });
    const changes = body.changes.map(checkChange);
    const snap = this.latestSnapshot(projectId);
    const base = baselineState(this.store, projectId, snap);
    const baseHash = stateHash(base);
    if (baseHash !== body.base_state_hash) throw new HttpError(409, "the baseline changed since you reviewed it; compare against the current state", [`current base_state_hash ${baseHash}`], { current: { base_state_hash: baseHash } });
    const proposalDigest = sha256(canonicalJson({ base: baseHash, changes, probes }));
    const namespace = `branch:${proposalDigest.slice(0, 16)}`;
    const candidate = applyChanges(base, changes, namespace);
    const candHash = stateHash(candidate);
    const baseGraph = this.store.getGraph(projectId) ?? { schema_version: "0.2", project_id: projectId, graph_revision: "not-imported", dataset_kind: "live", assets: [], relationships: [] } as unknown as Graph;
    const comparison = compareStates({ base, candidate, baseSnap: snap, baseGraph, probes, sources: [] });
    const receiptBody = {
      schema: ANALYSIS_RECEIPT, project_id: projectId, namespace, mode: comparison.mode,
      base_state_hash: baseHash, candidate_state_hash: candHash, proposal_digest: proposalDigest,
      state: { schema: ANALYSIS_STATE, graph_revision: base.base.graph_revision, snapshot_id: base.base.snapshot_id, snapshot_digest: base.base.snapshot_digest, source_revisions: base.base.source_revisions },
      policy_version: EVALUATOR_VERSION, condition_keys: comparison.condition_keys, unassessed_paths: comparison.unassessed_paths,
      changes: { added: comparison.added, removed: comparison.removed, modified: comparison.modified.map((m) => m.key) },
      access: comparison.access.map((a) => ({ probe: a.probe, base: a.base?.result ?? "unresolved", candidate: a.candidate?.result ?? "unresolved" })),
    };
    const receiptDigest = sha256(canonicalJson(receiptBody));
    const receipt = { ...receiptBody, receipt_digest: receiptDigest };
    const id = `cmp_${randomBytes(8).toString("hex")}`;
    this.store.db.prepare("INSERT INTO analysis_comparisons (id, project_id, namespace, base_state_hash, candidate_state_hash, proposal, candidate_state, comparison, receipt, receipt_digest, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, projectId, namespace, baseHash, candHash, canonicalJson({ changes, probes, label: typeof body.label === "string" ? body.label.slice(0, 200) : null }), canonicalJson(candidate), canonicalJson(comparison), canonicalJson(receipt), receiptDigest, actor, this.store.now().toISOString());
    this.store.audit(actor, "analysis.compare", projectId, id, { namespace, base_state_hash: baseHash, candidate_state_hash: candHash });
    return { id, namespace, base_state_hash: baseHash, candidate_state_hash: candHash, comparison, receipt };
  }
  get(projectId: string, id: string) {
    const r = this.store.db.prepare("SELECT * FROM analysis_comparisons WHERE project_id = ? AND id = ?").get(projectId, id) as Record<string, string> | undefined;
    if (!r) throw new HttpError(404, "comparison not found");
    return { id: r.id!, namespace: r.namespace!, base_state_hash: r.base_state_hash!, candidate_state_hash: r.candidate_state_hash!, proposal: JSON.parse(r.proposal!), candidate_state: JSON.parse(r.candidate_state!) as AnalysisState, comparison: JSON.parse(r.comparison!), receipt: JSON.parse(r.receipt!), created_by: r.created_by!, created_at: r.created_at! };
  }
  /** Re-derive a stored comparison's receipt from its proposal against its own base; equal digests prove determinism. */
  recheck(projectId: string, id: string) {
    const c = this.get(projectId, id);
    const snap = this.latestSnapshot(projectId);
    const base = baselineState(this.store, projectId, snap);
    const baseHash = stateHash(base);
    if (baseHash !== c.base_state_hash) return { id, reproducible: false, reason: "the baseline has changed since this comparison; its receipt describes the earlier state", stored_base_state_hash: c.base_state_hash, current_base_state_hash: baseHash };
    const candidate = applyChanges(base, c.proposal.changes as Change[], c.namespace);
    return { id, reproducible: stateHash(candidate) === c.candidate_state_hash, candidate_state_hash: stateHash(candidate), stored_candidate_state_hash: c.candidate_state_hash };
  }
  explain(projectId: string, q: Record<string, unknown>) {
    const bad = Object.keys(q).filter((k) => !["from", "to", "principal", "action", "resource", "comparison", "max_hops"].includes(k));
    if (bad.length) throw new HttpError(422, `unsupported parameter(s) ${bad.join(", ")}`);
    for (const k of ["from", "to"]) if (typeof q[k] !== "string" || !ID_RE.test(q[k] as string)) throw new HttpError(400, `${k} (an asset id) is required`);
    for (const k of ["principal", "action", "resource", "comparison"]) if (q[k] !== undefined && (typeof q[k] !== "string" || !ID_RE.test(q[k] as string))) throw new HttpError(400, `${k} must be a string`);
    const snap = this.latestSnapshot(projectId);
    const baseGraph = this.store.getGraph(projectId) ?? { schema_version: "0.2", project_id: projectId, graph_revision: "not-imported", dataset_kind: "live", assets: [], relationships: [] } as unknown as Graph;
    let graph = baseGraph, s = snap, namespace = "baseline", stateHashUsed = this.baseline(projectId).state_hash;
    if (q.comparison) { const c = this.get(projectId, q.comparison as string); graph = graphFromState(baseGraph, c.candidate_state); s = snapshotFromState(snap, c.candidate_state); namespace = c.namespace; stateHashUsed = c.candidate_state_hash; }
    return { ...explainPath({ graph, snap: s, namespace, from: q.from as string, to: q.to as string, principal: q.principal as string | undefined, action: q.action as string | undefined, resource: q.resource as string | undefined, maxHops: q.max_hops === undefined ? undefined : Number(q.max_hops) }), state_hash: stateHashUsed };
  }
}

export function registerExplorationRoutes(app: FastifyInstance, d: { store: Store; authed: (minRole?: Role) => (req: FastifyRequest) => Promise<void>; who: (req: FastifyRequest) => string }) {
  const x = new Exploration(d.store);
  const P = (req: FastifyRequest) => (req.params as { p: string }).p;
  app.get("/api/projects/:p/analysis/state", { preHandler: d.authed() }, async (req) => x.baseline(d.store.require(req.principal!, P(req), "viewer").id));
  app.post("/api/projects/:p/analysis/comparisons", { preHandler: d.authed("analyst"), bodyLimit: 1_048_576 }, async (req) => x.compare(d.store.require(req.principal!, P(req), "analyst").id, (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>, d.who(req)));
  app.get("/api/projects/:p/analysis/comparisons/:id", { preHandler: d.authed() }, async (req) => x.get(d.store.require(req.principal!, P(req), "viewer").id, (req.params as { id: string }).id));
  app.get("/api/projects/:p/analysis/comparisons/:id/recheck", { preHandler: d.authed() }, async (req) => x.recheck(d.store.require(req.principal!, P(req), "viewer").id, (req.params as { id: string }).id));
  // LP19: the comparison projected onto the canonical baseline world (read-only; nothing stored or recompiled).
  app.get("/api/projects/:p/analysis/comparisons/:id/world", { preHandler: d.authed() }, async (req, reply) => {
    const projectId = d.store.require(req.principal!, P(req), "viewer").id, id = (req.params as { id: string }).id;
    const body = worldComparison(d.store, x, projectId, id);
    if ((req.query as { download?: string }).download === "1") reply.header("content-disposition", `attachment; filename="world-comparison-${id}.json"`);
    return body;
  });
  app.get("/api/projects/:p/analysis/paths", { preHandler: d.authed() }, async (req) => x.explain(d.store.require(req.principal!, P(req), "viewer").id, req.query as Record<string, unknown>));
  return x;
}
