import {
  canonicalJson, deriveReadiness, INVESTIGATION_CONTRACTS, validateInvestigationContract, CONTRACT_MAX_INTERVAL_DAYS,
  type AssetKind, type ContractObligation, type EventAction, type InvestigationContract, type ObligationState, type SecurityEvent,
} from "@dk/contracts";
import { sha256 } from "../security.ts";
import { HttpError, type Store } from "../store.ts";
import { RECIPES } from "../recipes.ts";
import { provenanceOf } from "../provenance.ts";

/**
 * Investigation contracts and obligations (Local Intelligence Phase LP08).
 *
 * A contract turns a case question into auditable evidence requirements. It is derived ONLY from public inputs:
 * the case scope (question, asset ids, interval), the case's linked findings and events, the declared kind of each
 * scoped asset, the versioned recipes that apply to the linked findings, and the obligation catalog below. Nothing
 * here reads scenario definitions, oracles or seeds; `derivation.inputs` lists every input and `inputs_digest`
 * commits to their values.
 *
 * - An obligation becomes `satisfied` only through `applyResults` with a result whose scope equals the obligation's
 *   own required scope (same project, contract revision, asset, action, interval, finding revision) and that carries
 *   the step/query references that produced it; or `inapplicable_with_reason` through an explicit analyst decision
 *   with a documented reason. No caller can assert "satisfied" directly.
 * - Negative claims ("X did not happen on A") have explicit coverage requirements: the asset's activity retrieval
 *   must be complete AND the coverage question for that action must be covered for the whole interval.
 * - Revisions and the transition ledger are append-only. A scope change or new/changed evidence never overwrites a
 *   decision: the effective view marks the affected obligations invalidated immediately, and the next write records
 *   a new revision whose ledger entries name the old decision and why it no longer holds.
 */
export const CONTRACT_SCHEMA = INVESTIGATION_CONTRACTS.investigation_contract;
export const OBLIGATION_CATALOG = INVESTIGATION_CONTRACTS.obligation_catalog;
export const CONTRACT_MAX_ASSETS = 20;

/**
 * dk.obligation_catalog.v1: which event classes make a negative claim about an asset meaningful, by DECLARED asset
 * kind. Public and versioned; it never depends on what any scenario actually did.
 */
export const COVERAGE_ACTIONS_BY_KIND: Record<AssetKind, EventAction[]> = {
  edge: ["request_received", "waf_match"], auth: ["authentication", "authorization_change"], service: ["request_received", "authentication"],
  worker: ["tool_invocation", "runtime_alert"], database: ["data_access"], storage: ["data_access"], agent: ["tool_invocation", "side_effect_observed"],
  tool_server: ["tool_invocation", "side_effect_observed"], pipeline: ["runtime_alert", "authorization_change"], third_party: ["request_received"],
};
const INPUTS = ["case.scope", "case.linked_findings", "case.linked_events", "graph.asset_kinds", "recipes.applies_to", "obligation_catalog"] as const;

type CaseView = {
  id: string; version: number; status: string;
  scope: { question: string; asset_ids: string[]; after?: string; before?: string };
  items: { item_id: string; kind: string; ref: string; removed?: unknown; revision?: unknown; bundle_id?: unknown; bundle_digest?: unknown; event_digest?: unknown; status?: unknown; text?: unknown }[];
};
type CaseLoader = (projectId: string, caseId: string) => CaseView;

export interface ObligationResult {
  obligation_id: string;
  status: Exclude<ObligationState, "not_started" | "inapplicable_with_reason">;
  evidence_refs: string[]; evidence_ref_count?: number; query_refs: string[]; reason: string;
  validity?: ContractObligation["validity"];
  /** The scope the result was actually produced under; must equal the obligation's required scope to count. */
  scope: { project_id: string; contract_revision: number; asset_id?: string; action?: EventAction; after?: string; before?: string; finding_id?: string; finding_revision?: number; bundle_id?: string; recipe?: string };
}
export interface Invalidation { obligation_id: string; from_status: ObligationState; reason: string; cause: "scope_changed" | "evidence_changed" | "withdrawn"; decided_at_revision?: number }

const nowIso = (store: Store) => store.now().toISOString();
const eventDigest = (e: SecurityEvent) => sha256(canonicalJson(e));
const cap = <T>(a: T[], n = 200) => a.slice(0, n);
const uniq = <T>(a: T[]) => [...new Set(a)];

export class InvestigationContracts {
  constructor(private readonly store: Store, private readonly loadCase: CaseLoader) {}
  private get db() { return this.store.db; }

  // ------------------------------------------------------------------ derivation (public inputs only)

  /** Fresh obligations (all not_started) from the case's public scope, linked items, asset kinds and recipes. */
  derive(projectId: string, c: CaseView): Omit<InvestigationContract, "id" | "revision"> {
    const s = c.scope;
    if (!s.after || !s.before) throw new HttpError(422, "an investigation contract needs a bounded interval: set scope.after and scope.before on the case", ["contracts cover at most 31 days"]);
    const a = Date.parse(s.after), b = Date.parse(s.before);
    if (!(b > a) || b - a > CONTRACT_MAX_INTERVAL_DAYS * 86_400_000) throw new HttpError(422, `the case interval must be ordered and at most ${CONTRACT_MAX_INTERVAL_DAYS} days`);
    if (!s.asset_ids.length) throw new HttpError(422, "an investigation contract needs at least one scoped asset id on the case");
    if (s.asset_ids.length > CONTRACT_MAX_ASSETS) throw new HttpError(422, `an investigation contract covers at most ${CONTRACT_MAX_ASSETS} assets; narrow the case scope`);
    const graph = this.store.getGraph(projectId);
    const kinds = new Map((graph?.assets ?? []).map((x) => [x.id, x.kind]));
    const missing = s.asset_ids.filter((id) => !kinds.has(id));
    if (missing.length) throw new HttpError(422, `scoped asset(s) not in the current graph: ${missing.join(", ")}`);
    const live = c.items.filter((i) => !i.removed);
    const findings = live.filter((i) => i.kind === "finding");
    const events = live.filter((i) => i.kind === "event");
    const obligations: ContractObligation[] = [];
    const negatives: InvestigationContract["negative_claim_requirements"] = [];
    const ob = (o: Omit<ContractObligation, "status" | "evidence_refs" | "query_refs" | "reason">): ContractObligation => ({ ...o, status: "not_started", evidence_refs: [], query_refs: [], reason: "" });
    for (const asset of s.asset_ids) {
      const kind = kinds.get(asset)!;
      obligations.push(ob({ id: `activity:${asset}`, kind: "retrieve_activity", question: `Retrieve every stored event on ${asset} in the case interval under one pinned snapshot.`, target: { asset_id: asset }, basis: "case.scope", supports_negative_claims: true }));
      for (const action of COVERAGE_ACTIONS_BY_KIND[kind] ?? []) {
        obligations.push(ob({ id: `coverage:${asset}:${action}`, kind: "coverage", question: `Could ${action} on ${asset} have been recorded for the whole interval (capable, assigned, live source)?`, target: { asset_id: asset, action }, basis: `${OBLIGATION_CATALOG}:${kind}`, supports_negative_claims: true }));
        negatives.push({ id: `negative:${asset}:${action}`, asset_id: asset, action, requires: [`activity:${asset}`, `coverage:${asset}:${action}`], assessable: false, reason: "" });
      }
    }
    for (const f of findings) {
      const finding = this.store.listFindings(projectId).find((x) => x.id === f.ref);
      const rev = Number(f.revision);
      if (typeof f.bundle_id === "string") obligations.push(ob({ id: `bundle:${f.ref}`, kind: "bundle_integrity", question: `Read every record pinned for ${f.ref} revision ${rev} and confirm each still matches its pinned digest.`, target: { finding_id: f.ref, finding_revision: rev, bundle_id: f.bundle_id }, basis: "case.linked_findings", supports_negative_claims: false }));
      if (!finding) continue;
      for (const r of RECIPES.filter((x) => x.applies_to.includes(finding.kind))) {
        obligations.push(ob({ id: `recipe:${r.id}:${f.ref}`, kind: "recipe", question: `Run ${r.id}@${r.version} on ${f.ref}: weigh "${r.title}" with every query and coverage question it needs.`, target: { finding_id: f.ref, finding_revision: rev, recipe: `${r.id}@${r.version}` }, basis: `recipes.applies_to:${finding.kind}`, supports_negative_claims: false }));
      }
    }
    if (events.length) obligations.push(ob({ id: "linked-events", kind: "linked_events", question: `Confirm the ${events.length} independently linked event(s) are still stored exactly as linked.`, target: { event_ids: cap(events.map((e) => e.ref)) }, basis: "case.linked_events", supports_negative_claims: false }));
    if (obligations.length > 100) throw new HttpError(422, `this case would need ${obligations.length} obligations (limit 100); narrow its scope or split it`);
    const recipes = uniq(obligations.filter((o) => o.kind === "recipe").map((o) => o.target.recipe!)).sort();
    const inputs = {
      scope: { question: s.question, asset_ids: s.asset_ids, after: s.after, before: s.before },
      linked_findings: findings.map((f) => ({ id: f.ref, revision: f.revision, bundle_id: f.bundle_id ?? null })),
      linked_events: events.map((e) => e.ref).sort(),
      asset_kinds: Object.fromEntries(s.asset_ids.map((id) => [id, kinds.get(id)])),
      recipes, catalog: { id: OBLIGATION_CATALOG, actions: COVERAGE_ACTIONS_BY_KIND },
    };
    const project = this.store.getProject(projectId)!;
    const prov = provenanceOf(project);
    const contract = {
      schema: CONTRACT_SCHEMA, case_id: c.id, project_id: projectId, run_id: prov.local_run ? prov.run_id : null,
      question: s.question, scope: { asset_ids: s.asset_ids, after: s.after, before: s.before },
      derivation: { catalog: OBLIGATION_CATALOG, case_version: c.version, graph_revision: graph?.graph_revision ?? null, recipes, inputs: [...INPUTS], inputs_digest: sha256(canonicalJson(inputs)) },
      obligations, negative_claim_requirements: negatives, closure_prerequisites: [] as InvestigationContract["closure_prerequisites"],
      readiness: "not_started" as const, readiness_reason: "", snapshot_refs: [] as string[], private_truth_access: false as const,
    };
    return contract;
  }

  /** Recompute everything that is a function of obligation states and the case (never stored decisions). */
  private finish(projectId: string, c: CaseView, body: InvestigationContract, resumable: ReadonlySet<string> = this.resumable(body.id)): InvestigationContract {
    const by = new Map(body.obligations.map((o) => [o.id, o]));
    for (const n of body.negative_claim_requirements) {
      const unmet = n.requires.map((r) => by.get(r)!).filter((o) => o.status !== "satisfied");
      n.assessable = unmet.length === 0;
      n.reason = n.assessable ? `Activity retrieval on ${n.asset_id} is complete and ${n.action} was covered for the whole interval; a not_observed_in_scope claim about it is assessable (absence in stored records within this interval only).`
        : `A claim that ${n.action} did not happen on ${n.asset_id} cannot be made: ${unmet.map((o) => `${o.id} is ${o.status}${o.reason ? ` (${o.reason})` : ""}`).join("; ")}.`;
    }
    const questions = c.items.filter((i) => !i.removed && (i.kind === "question" || i.kind === "hypothesis"));
    const openQ = questions.filter((q) => q.status === "open");
    const unfinished = body.obligations.filter((o) => o.status !== "satisfied" && o.status !== "inapplicable_with_reason");
    body.closure_prerequisites = [
      { id: "obligations-resolved", requirement: "Every obligation satisfied by scoped evidence or documented as inapplicable (otherwise only an unresolved answer is possible).", met: unfinished.length === 0, reason: unfinished.length ? `${unfinished.length} obligation(s) not satisfied: ${unfinished.slice(0, 8).map((o) => `${o.id}=${o.status}`).join(", ")}` : "all obligations resolved" },
      { id: "questions-settled", requirement: "Every case question and hypothesis answered or explicitly accepted as unresolved by an analyst (telemetry cannot settle intent or authorization).", met: openQ.length === 0, reason: openQ.length ? `${openQ.length} open question(s)/hypotheses` : `${questions.length} question(s) settled` },
      { id: "human-closure", requirement: "Closing the case remains an explicit owner/administrator action with a closure statement; a contract or conclusion never closes it.", met: c.status === "closed", reason: `case status is ${c.status}` },
    ];
    const r = deriveReadiness(body.obligations, resumable);
    body.readiness = r.readiness; body.readiness_reason = r.reason;
    body.snapshot_refs = cap(uniq(body.obligations.filter((o) => o.validity?.snapshot_seq !== undefined && o.status !== "not_started").map((o) => `snapshot:${o.validity!.snapshot_seq}`)));
    const v = validateInvestigationContract(body);
    if (!v.ok) throw new Error(`internal: contract failed its own validation: ${v.errors.join("; ")}`);
    return body;
  }

  /** Obligations with committed resumable work (LP09 jobs register these); none by default. */
  resumable: (contractId: string) => ReadonlySet<string> = () => new Set();

  // ------------------------------------------------------------------ persistence

  private pointer(projectId: string, caseId: string) {
    return this.db.prepare("SELECT * FROM investigation_contracts WHERE project_id = ? AND case_id = ?").get(projectId, caseId) as { id: string; revision: number; created_at: string; created_by: string } | undefined;
  }
  private revisionBody(contractId: string, revision: number): InvestigationContract {
    const r = this.db.prepare("SELECT body FROM investigation_contract_revisions WHERE contract_id = ? AND revision = ?").get(contractId, revision) as { body: string } | undefined;
    if (!r) throw new HttpError(404, `contract revision ${revision} not found`);
    return JSON.parse(r.body) as InvestigationContract;
  }
  private write(projectId: string, body: InvestigationContract, cause: string, actor: string, transitions: { obligation_id: string; from: ObligationState | null; to: string; cause: string; reason: string; evidence_refs?: string[]; query_refs?: string[] }[]) {
    const at = nowIso(this.store);
    const json = canonicalJson(body);
    this.db.prepare("INSERT INTO investigation_contract_revisions (contract_id, project_id, revision, body, digest, cause, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(body.id, projectId, body.revision, json, sha256(json), cause.slice(0, 300), actor, at);
    const ins = this.db.prepare("INSERT INTO investigation_transitions (project_id, contract_id, revision, obligation_id, from_status, to_status, cause, reason, evidence_refs, query_refs, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const t of transitions) ins.run(projectId, body.id, body.revision, t.obligation_id, t.from, t.to, t.cause, t.reason.slice(0, 2000), JSON.stringify(cap(t.evidence_refs ?? [])), JSON.stringify(cap(t.query_refs ?? [])), actor, at);
    this.db.prepare("UPDATE investigation_contracts SET revision = ?, updated_at = ? WHERE id = ?").run(body.revision, at, body.id);
    this.store.emit(projectId, "investigation_contract", { id: body.id, case_id: body.case_id, revision: body.revision, readiness: body.readiness });
  }

  /** Create the contract for a case (revision 1). Idempotent: an existing contract is refreshed instead. */
  open(projectId: string, caseId: string, actor: string) {
    return this.store.transaction(() => {
      const existing = this.pointer(projectId, caseId);
      if (existing) return this.refresh(projectId, caseId, actor, "reopened");
      const c = this.loadCase(projectId, caseId);
      const id = "ic_" + sha256(`${projectId}:${caseId}`).slice(0, 16);
      const at = nowIso(this.store);
      this.db.prepare("INSERT INTO investigation_contracts (id, project_id, case_id, revision, created_at, created_by, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)").run(id, projectId, caseId, at, actor, at);
      const body = this.finish(projectId, c, { ...this.derive(projectId, c), id, revision: 1 });
      this.write(projectId, body, "derived from case scope", actor, body.obligations.map((o) => ({ obligation_id: o.id, from: null, to: o.status, cause: "derived", reason: `derived from ${o.basis}` })));
      this.store.audit(actor, "investigation_contract.open", projectId, id, { case_id: caseId, obligations: body.obligations.length });
      return this.view(projectId, caseId);
    });
  }

  contractId(projectId: string, caseId: string): string {
    const p = this.pointer(projectId, caseId);
    if (!p) throw new HttpError(404, "no investigation contract for this case; open one first (analyst)");
    return p.id;
  }

  /** The stored latest revision, exactly as written. */
  stored(projectId: string, caseId: string): InvestigationContract {
    const p = this.pointer(projectId, caseId);
    if (!p) throw new HttpError(404, "no investigation contract for this case; open one first (analyst)");
    return this.revisionBody(p.id, p.revision);
  }

  revision(projectId: string, caseId: string, revision: number): InvestigationContract {
    return this.revisionBody(this.contractId(projectId, caseId), revision);
  }

  revisions(projectId: string, caseId: string) {
    const id = this.contractId(projectId, caseId);
    return (this.db.prepare("SELECT revision, digest, cause, actor, created_at FROM investigation_contract_revisions WHERE contract_id = ? ORDER BY revision").all(id) as Record<string, unknown>[]);
  }

  ledger(projectId: string, caseId: string, opts: { obligation?: string; limit?: number } = {}) {
    const id = this.contractId(projectId, caseId);
    const lim = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
    const rows = (opts.obligation
      ? this.db.prepare("SELECT * FROM investigation_transitions WHERE contract_id = ? AND obligation_id = ? ORDER BY id LIMIT ?").all(id, opts.obligation, lim)
      : this.db.prepare("SELECT * FROM investigation_transitions WHERE contract_id = ? ORDER BY id LIMIT ?").all(id, lim)) as Record<string, unknown>[];
    return rows.map((r) => ({ id: r.id, revision: r.revision, obligation_id: r.obligation_id, from_status: r.from_status, to_status: r.to_status, cause: r.cause, reason: r.reason, evidence_refs: JSON.parse(String(r.evidence_refs)), query_refs: JSON.parse(String(r.query_refs)), actor: r.actor, at: r.at }));
  }

  // ------------------------------------------------------------------ invalidation

  /**
   * Merge the stored revision with a fresh derivation and re-check the validity of every decided obligation.
   * Returns the effective body (not yet stored) and the invalidations it implies.
   */
  private reconcile(projectId: string, c: CaseView, stored: InvestigationContract): { body: InvestigationContract; invalidations: Invalidation[]; added: string[] } {
    const fresh = this.derive(projectId, c);
    const old = new Map(stored.obligations.map((o) => [o.id, o]));
    const invalidations: Invalidation[] = [], added: string[] = [];
    const scopeChanged = stored.scope.after !== fresh.scope.after || stored.scope.before !== fresh.scope.before;
    const obligations = fresh.obligations.map((f): ContractObligation => {
      const o = old.get(f.id);
      if (!o) { added.push(f.id); return f; }
      if (o.status === "not_started") return { ...f, reason: o.reason };
      const sameTarget = canonicalJson(o.target) === canonicalJson(f.target);
      const intervalBound = f.kind === "retrieve_activity" || f.kind === "coverage";
      if (!sameTarget || (intervalBound && scopeChanged)) {
        invalidations.push({ obligation_id: f.id, from_status: o.status, cause: "scope_changed", decided_at_revision: o.decided_at_revision, reason: !sameTarget ? `target changed (${canonicalJson(o.target)} -> ${canonicalJson(f.target)})` : `case interval changed (${stored.scope.after}..${stored.scope.before} -> ${fresh.scope.after}..${fresh.scope.before})` });
        return { ...f };
      }
      const why = o.status === "inapplicable_with_reason" ? null : this.stillValid(projectId, fresh.scope, o);
      if (why) { invalidations.push({ obligation_id: f.id, from_status: o.status, cause: "evidence_changed", decided_at_revision: o.decided_at_revision, reason: why }); return { ...f }; }
      return { ...o, question: f.question, basis: f.basis };
    });
    for (const o of stored.obligations) if (!fresh.obligations.some((f) => f.id === o.id)) invalidations.push({ obligation_id: o.id, from_status: o.status, cause: "withdrawn", decided_at_revision: o.decided_at_revision, reason: "no longer required by the case scope or linked items" });
    for (const inv of invalidations) {
      const o = obligations.find((x) => x.id === inv.obligation_id);
      if (o) o.reason = `invalidated (${inv.cause}): ${inv.reason}; the previous ${inv.from_status} decision is kept at revision ${inv.decided_at_revision ?? stored.revision}`.slice(0, 2000);
    }
    const body = this.finish(projectId, c, { ...fresh, id: stored.id, revision: stored.revision, obligations });
    return { body, invalidations, added };
  }

  /** Why a decided obligation no longer holds given current evidence, or null when it still holds. */
  private stillValid(projectId: string, scope: InvestigationContract["scope"], o: ContractObligation): string | null {
    const v = o.validity ?? {};
    const assetWhere = "project_id = ? AND occurred_at >= ? AND occurred_at <= ? AND EXISTS (SELECT 1 FROM json_each(events.asset_ids) WHERE value = ?)";
    const count = (extra: string, ...args: (string | number)[]) => Number((this.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE ${assetWhere} ${extra}`).get(projectId, scope.after, scope.before, o.target.asset_id!, ...args) as { n: number }).n);
    if (o.kind === "retrieve_activity" && v.snapshot_seq !== undefined) {
      const later = count("AND seq > ?", v.snapshot_seq);
      if (later) return `${later} matching record(s) on ${o.target.asset_id} arrived after the retrieval snapshot ${v.snapshot_seq}`;
      if (v.matched !== undefined && o.status === "satisfied") { const now = count("AND seq <= ?", v.snapshot_seq); if (now !== v.matched) return `the pinned snapshot now holds ${now} record(s), not the ${v.matched} retrieved (records removed)`; }
    }
    if (o.kind === "coverage") {
      const cur = this.sourceRevisions(projectId);
      if (v.source_config_revisions && canonicalJson(cur) !== canonicalJson(v.source_config_revisions)) return "a source configuration changed since coverage was assessed";
      if (v.snapshot_seq !== undefined) { const later = count("AND seq > ?", v.snapshot_seq); if (later) return `${later} record(s) on ${o.target.asset_id} arrived after coverage was assessed (liveness may differ)`; }
    }
    if (o.kind === "recipe" && v.finding_revision !== undefined) {
      const f = this.store.listFindings(projectId).find((x) => x.id === o.target.finding_id);
      if (!f) return "the finding no longer exists";
      if (f.revision !== v.finding_revision) return `the finding moved from revision ${v.finding_revision} to ${f.revision}`;
    }
    if (o.kind === "bundle_integrity" && o.status === "satisfied") {
      const b = this.db.prepare("SELECT digest, body FROM bundles WHERE project_id = ? AND id = ?").get(projectId, o.target.bundle_id!) as { digest: string; body: string } | undefined;
      if (!b) return "the pinned bundle no longer exists";
      if (v.bundle_digest && b.digest !== v.bundle_digest) return "the pinned bundle digest differs from the one read";
      const refs = (JSON.parse(b.body) as { references: { event_id: string; digest: string | null }[] }).references;
      const stored = new Map(this.store.eventsByIds(projectId, refs.map((r) => r.event_id)).map((e) => [e.id, eventDigest(e)]));
      const bad = refs.filter((r) => r.digest && stored.get(r.event_id) !== r.digest);
      if (bad.length) return `${bad.length} pinned record(s) are now missing or changed`;
    }
    if (o.kind === "linked_events" && v.digest) {
      const ids = o.target.event_ids ?? [];
      const d = this.linkedDigest(projectId, ids);
      if (d !== v.digest) return "a linked event is missing or changed since it was confirmed";
    }
    return null;
  }

  sourceRevisions(projectId: string): Record<string, number> {
    return Object.fromEntries(this.store.listSources(projectId).map((s) => [s.id, s.config_revision]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  }
  linkedDigest(projectId: string, ids: string[]) {
    const m = new Map(this.store.eventsByIds(projectId, ids).map((e) => [e.id, eventDigest(e)]));
    return sha256(canonicalJson([...ids].sort().map((id) => [id, m.get(id) ?? null])));
  }

  /**
   * The effective contract a reader should act on: the stored revision with every invalidation implied by the
   * current case scope and evidence already applied. Never writes; `stale` says a refresh would record them.
   */
  view(projectId: string, caseId: string) {
    const stored = this.stored(projectId, caseId);
    const c = this.loadCase(projectId, caseId);
    const { body, invalidations, added } = this.reconcile(projectId, c, stored);
    const changed = invalidations.length > 0 || added.length > 0 || canonicalJson(body.scope) !== canonicalJson(stored.scope) || body.question !== stored.question || body.derivation.inputs_digest !== stored.derivation.inputs_digest;
    return {
      schema: "dk.investigation_contract_view.v1", contract: body, stored_revision: stored.revision, stale: changed,
      pending_invalidations: invalidations, pending_additions: added,
      note: changed ? "The case scope or evidence changed since this revision was stored. The contract shown already treats affected obligations as invalidated; the next analyst write (refresh, job step or decision) records a new revision. Earlier revisions are never modified." : "The stored revision is current.",
      provenance: provenanceOf(this.store.getProject(projectId)!),
    };
  }

  /** Record the effective view as a new revision when anything changed (scope, evidence, linked items). */
  refresh(projectId: string, caseId: string, actor: string, cause = "refresh", expectedRevision?: number) {
    return this.store.transaction(() => {
      const stored = this.stored(projectId, caseId);
      if (expectedRevision !== undefined && expectedRevision !== stored.revision) throw new HttpError(409, "the contract changed since you loaded it", [`current revision is ${stored.revision}`], { current: { revision: stored.revision } });
      const c = this.loadCase(projectId, caseId);
      const { body, invalidations, added } = this.reconcile(projectId, c, stored);
      const changed = invalidations.length > 0 || added.length > 0 || body.derivation.inputs_digest !== stored.derivation.inputs_digest || body.readiness !== stored.readiness;
      if (!changed) return this.view(projectId, caseId);
      body.revision = stored.revision + 1;
      this.finish(projectId, c, body);
      this.write(projectId, body, cause, actor, [
        ...invalidations.map((i) => ({ obligation_id: i.obligation_id, from: i.from_status, to: i.cause === "withdrawn" ? "withdrawn" : "not_started", cause: i.cause, reason: `${i.reason}; previous decision kept at revision ${i.decided_at_revision ?? stored.revision}` })),
        ...added.map((id) => ({ obligation_id: id, from: null, to: "not_started" as string, cause: "derived", reason: "newly required by the case scope or linked items" })),
      ]);
      return this.view(projectId, caseId);
    });
  }

  // ------------------------------------------------------------------ decisions

  /**
   * Apply step results. Each result counts only when its scope equals the obligation's required scope; a result
   * produced under another contract revision, project, asset, action, interval or finding revision is refused (and
   * listed), never silently applied. Pending invalidations are recorded first.
   */
  applyResults(projectId: string, caseId: string, results: ObligationResult[], actor: string, cause: string) {
    return this.store.transaction(() => {
      this.refresh(projectId, caseId, actor, "evidence or scope changed before applying results");
      const current = this.stored(projectId, caseId);
      const c = this.loadCase(projectId, caseId);
      const body: InvestigationContract = JSON.parse(JSON.stringify(current));
      const refused: { obligation_id: string; reason: string }[] = [];
      const transitions: Parameters<InvestigationContracts["write"]>[4] = [];
      for (const r of results) {
        const o = body.obligations.find((x) => x.id === r.obligation_id);
        if (!o) { refused.push({ obligation_id: r.obligation_id, reason: "no such obligation in the current revision" }); continue; }
        const why = this.scopeMismatch(body, o, r);
        if (why) { refused.push({ obligation_id: o.id, reason: why }); continue; }
        if (r.status === "satisfied" && !r.query_refs.length) { refused.push({ obligation_id: o.id, reason: "a satisfied result must name the query/step references that produced it" }); continue; }
        if (o.status === "inapplicable_with_reason") { refused.push({ obligation_id: o.id, reason: "already decided inapplicable by an analyst; reopen it by changing the case scope" }); continue; }
        const from = o.status;
        Object.assign(o, { status: r.status, evidence_refs: cap(r.evidence_refs), evidence_ref_count: r.evidence_ref_count ?? r.evidence_refs.length, query_refs: cap(uniq([...r.query_refs])), reason: r.reason.slice(0, 2000), validity: r.validity, decided_at_revision: current.revision + 1 });
        transitions.push({ obligation_id: o.id, from, to: r.status, cause, reason: r.reason, evidence_refs: r.evidence_refs, query_refs: r.query_refs });
      }
      if (!transitions.length) return { view: this.view(projectId, caseId), applied: 0, refused };
      body.revision = current.revision + 1;
      this.finish(projectId, c, body);
      this.write(projectId, body, cause, actor, transitions);
      return { view: this.view(projectId, caseId), applied: transitions.length, refused };
    });
  }

  private scopeMismatch(body: InvestigationContract, o: ContractObligation, r: ObligationResult): string | null {
    const s = r.scope;
    if (s.project_id !== body.project_id) return `result produced in project ${s.project_id}, not ${body.project_id}`;
    if (s.contract_revision !== body.revision) return `result produced under contract revision ${s.contract_revision}; the current revision is ${body.revision} (re-run under the current scope)`;
    const t = o.target;
    if (t.asset_id !== undefined && s.asset_id !== t.asset_id) return `result scoped to asset ${s.asset_id ?? "(none)"}, obligation requires ${t.asset_id}`;
    if (t.action !== undefined && s.action !== t.action) return `result scoped to action ${s.action ?? "(none)"}, obligation requires ${t.action}`;
    if ((o.kind === "retrieve_activity" || o.kind === "coverage") && (s.after !== body.scope.after || s.before !== body.scope.before)) return `result covers ${s.after ?? "?"}..${s.before ?? "?"}, obligation requires exactly ${body.scope.after}..${body.scope.before}`;
    if (t.finding_id !== undefined && s.finding_id !== t.finding_id) return `result is about finding ${s.finding_id ?? "(none)"}, obligation requires ${t.finding_id}`;
    if (t.recipe !== undefined && s.recipe !== t.recipe) return `result came from ${s.recipe ?? "(none)"}, obligation requires ${t.recipe}`;
    if (t.bundle_id !== undefined && s.bundle_id !== t.bundle_id) return `result read bundle ${s.bundle_id ?? "(none)"}, obligation requires ${t.bundle_id}`;
    if (o.kind === "bundle_integrity" && s.finding_revision !== t.finding_revision) return `result read revision ${s.finding_revision ?? "?"}, obligation requires revision ${t.finding_revision}`;
    return null;
  }

  /** Analyst decision: an obligation does not apply, with a documented reason (recorded in the ledger). */
  markInapplicable(projectId: string, caseId: string, obligationId: string, body: { reason?: unknown; expected_revision?: unknown }, actor: string) {
    return this.store.transaction(() => {
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (reason.length < 10 || reason.length > 2000) throw new HttpError(400, "reason is required: document why this obligation does not apply (10 to 2000 characters)");
      const current = this.stored(projectId, caseId);
      if (typeof body.expected_revision !== "number") throw new HttpError(428, "expected_revision is required", [`current revision is ${current.revision}`]);
      if (body.expected_revision !== current.revision) throw new HttpError(409, "the contract changed since you loaded it", [`current revision is ${current.revision}`], { current: { revision: current.revision } });
      const view = this.view(projectId, caseId);
      if (view.stale) throw new HttpError(409, "the case scope or evidence changed; refresh the contract and review it before deciding", view.pending_invalidations.map((i) => `${i.obligation_id}: ${i.reason}`));
      const next: InvestigationContract = JSON.parse(JSON.stringify(current));
      const o = next.obligations.find((x) => x.id === obligationId);
      if (!o) throw new HttpError(404, "obligation not found in the current revision");
      if (o.status === "satisfied") throw new HttpError(409, "the obligation is already satisfied by scoped evidence");
      const from = o.status;
      Object.assign(o, { status: "inapplicable_with_reason", reason, decided_at_revision: current.revision + 1 });
      next.revision = current.revision + 1;
      this.finish(projectId, this.loadCase(projectId, caseId), next);
      this.write(projectId, next, `inapplicable: ${obligationId}`, actor, [{ obligation_id: obligationId, from, to: "inapplicable_with_reason", cause: "analyst_decision", reason }]);
      this.store.audit(actor, "investigation_contract.inapplicable", projectId, next.id, { obligation: obligationId });
      return this.view(projectId, caseId);
    });
  }
}
