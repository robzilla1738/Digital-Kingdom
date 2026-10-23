import { canonicalJson, type Asset, type Graph, type Relationship } from "@dk/contracts";
import { sha256 as sha256Hex } from "./security.ts";
import { tx, type DB } from "./db.ts";
import { HttpError } from "./store.ts";

/**
 * Versioned domain facts (roadmap R01.1).
 *
 * A stored graph revision says what the project looks like now. It cannot say what was known earlier, keep two
 * sources' disagreement, or tell a recreated resource from the original. Facts add that:
 *
 * - **Entities** are stable application identities with incarnations. An asset id that is retired and later
 *   declared again, or that reappears with a different provider-native id, becomes a NEW incarnation
 *   (`ent:<project>:asset:<id>#2`). Only a matching provider_ref proves the same resource came back.
 * - **Assertions** are append-only and bitemporal: `valid_from`/`valid_to` (when it is true in the world) and
 *   `recorded_at` (when Digital Kingdom learned it), plus `observed_at` and provenance. They are typed:
 *   declared_config, observed_config, inferred_relationship, hypothesis, test_result.
 * - A **view** at (valid_at, known_at) uses only assertions recorded by known_at, so learning something late
 *   never rewrites what was known earlier. Per source, the assertion with the latest valid_from <= valid_at wins.
 *   Different sources that disagree are reported as a conflict, never resolved by recency.
 * - **Reconciliations** are explicit, attributed decisions choosing one candidate; they go stale (and the
 *   conflict reappears) when the chosen assertion is no longer current.
 *
 * Graph imports record under source `graph` (provenance keeps the importer's source_refs and the revision).
 * Projects created before this history began are backfilled from their stored graph revisions with
 * `method: legacy_backfill` and unknown observation time.
 */
export const ASSERTION_TYPES = ["declared_config", "observed_config", "inferred_relationship", "hypothesis", "test_result"] as const;
export type AssertionType = (typeof ASSERTION_TYPES)[number];
export type EntityKind = "asset" | "relationship";

export interface Assertion {
  id: string;
  entity_ref: string;
  assertion_type: AssertionType;
  attribute: string;
  value: unknown;
  valid_from: string | null;
  valid_to: string | null;
  observed_at: string | null;
  recorded_at: string;
  source_ref: string;
  method: string;
  provenance: Record<string, unknown>;
}

const ASSET_ATTRS = ["name", "kind", "environment", "owner", "sensitivity", "deployment", "aliases", "routes", "provider_ref", "instance_count"] as const;
const REL_ATTRS = ["endpoints", "evidence_level", "assumptions"] as const;
const SOURCE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9_.:\/-]{0,95}$/;
const ATTR_RE = /^[a-z][a-z0-9_]{0,63}$/;

export { FACTS_MIGRATION } from "./schema-r01.ts";

const iso = (s: string) => new Date(Date.parse(s)).toISOString();
const ms = (s: string | null) => (s === null ? Number.NEGATIVE_INFINITY : Date.parse(s));

export class Facts {
  constructor(private readonly db: DB, private readonly now: () => Date) {}

  // ------------------------------------------------------------------ recording

  /** Record a graph declaration. Called inside the putGraph transaction. */
  recordGraph(projectId: string, graph: Graph, actor: string, recordedAt = this.now().toISOString()) {
    this.ensureBackfilled(projectId, graph.graph_revision);
    this.recordGraphInner(projectId, graph, recordedAt, "graph_import", actor);
  }

  private recordGraphInner(projectId: string, graph: Graph, recordedAt: string, method: string, actor: string) {
    const declaredAt = graph.created_at ? iso(graph.created_at) : null;
    const prov = (refs: string[]) => ({ graph_revision: graph.graph_revision, source_refs: refs, actor, ...(method === "legacy_backfill" ? { note: "Recorded before fact history began; observation time unknown." } : {}) });
    const removalAt = declaredAt ?? recordedAt;
    const seenAssets = new Set<string>();
    for (const a of graph.assets as Asset[]) {
      seenAssets.add(a.id);
      const tombstoned = a.lifecycle === "tombstoned";
      const ent = this.resolveEntity(projectId, "asset", a.id, a.provider_ref, a.valid_from ?? declaredAt, recordedAt, tombstoned);
      // Explicit valid_from wins. Otherwise a first declaration has an unknown start (null) and a later change
      // takes effect at the declaring graph's time, so a new value is never back-dated to "always".
      const from: string | { changeAt: string } = a.valid_from ? iso(a.valid_from) : { changeAt: removalAt };
      const p = prov(a.source_refs);
      if (!tombstoned) this.assertIfChanged(projectId, ent, "declared_config", "exists", true, from, declaredAt, recordedAt, "graph", method, p);
      for (const k of ASSET_ATTRS) if (a[k] !== undefined) this.assertIfChanged(projectId, ent, "declared_config", k, a[k], from, declaredAt, recordedAt, "graph", method, p);
      const endAt = a.valid_to ? iso(a.valid_to) : tombstoned ? removalAt : null;
      if (endAt) this.assertIfChanged(projectId, ent, "declared_config", "exists", false, endAt, declaredAt, recordedAt, "graph", method, p);
    }
    for (const r of graph.relationships as Relationship[]) {
      const ent = this.resolveEntity(projectId, "relationship", r.id, undefined, r.valid_from ?? declaredAt, recordedAt, false);
      const type: AssertionType = r.evidence_level === "observed" ? "observed_config" : r.evidence_level === "inferred" ? "inferred_relationship" : r.evidence_level === "hypothetical" ? "hypothesis" : "declared_config";
      const from: string | { changeAt: string } = r.valid_from ? iso(r.valid_from) : { changeAt: removalAt };
      const p = prov(r.evidence_refs);
      this.assertIfChanged(projectId, ent, type, "exists", true, from, declaredAt, recordedAt, "graph", method, p);
      const vals: Record<(typeof REL_ATTRS)[number], unknown> = { endpoints: { source: r.source_id, target: r.target_id, kind: r.kind }, evidence_level: r.evidence_level, assumptions: r.assumptions };
      for (const k of REL_ATTRS) if (vals[k] !== undefined) this.assertIfChanged(projectId, ent, type, k, vals[k], from, declaredAt, recordedAt, "graph", method, p);
      if (r.valid_to) this.assertIfChanged(projectId, ent, type, "exists", false, iso(r.valid_to), declaredAt, recordedAt, "graph", method, p);
    }
    // Declared absence: an entity the graph previously declared and this graph omits stops existing per the graph.
    for (const kind of ["asset", "relationship"] as const) {
      const present = kind === "asset" ? seenAssets : new Set(graph.relationships.map((r) => r.id));
      for (const e of this.latestIncarnations(projectId, kind)) {
        if (present.has(e.app_id)) continue;
        const cur = this.currentValue(projectId, e.entity_ref, "exists", "graph");
        if (cur && cur.value === true) this.insertAssertion(projectId, e.entity_ref, cur.assertion_type, "exists", false, removalAt, declaredAt, recordedAt, "graph", method, { graph_revision: graph.graph_revision, actor, reason: "omitted from the declared graph" });
      }
    }
  }

  /** Lazily convert stored graph revisions into legacy facts (unknown provenance) the first time facts are used. */
  ensureBackfilled(projectId: string, excludeRevision?: string) {
    const has = this.db.prepare("SELECT 1 FROM assertions WHERE project_id = ? LIMIT 1").get(projectId);
    if (has) return;
    const revs = this.db.prepare("SELECT revision, graph, created_at FROM graph_revisions WHERE project_id = ? ORDER BY created_at, revision").all(projectId) as { revision: string; graph: string; created_at: string }[];
    for (const r of revs) if (r.revision !== excludeRevision) this.recordGraphInner(projectId, JSON.parse(r.graph) as Graph, r.created_at, "legacy_backfill", "system");
  }

  /**
   * Record an externally supplied assertion (observed configuration, hypothesis, test result) for an existing
   * entity. The caller's source_ref is its own namespace; it cannot write as `graph`.
   */
  recordAssertion(projectId: string, input: Record<string, unknown>, actor: string) {
    this.ensureBackfilled(projectId);
    const type = input.assertion_type as AssertionType;
    if (!ASSERTION_TYPES.includes(type)) throw new HttpError(400, `assertion_type must be one of ${ASSERTION_TYPES.join(", ")}`);
    const src = input.source_ref;
    if (typeof src !== "string" || !SOURCE_REF_RE.test(src) || src === "graph") throw new HttpError(400, "source_ref must be 1-96 characters of letters, digits and _ . : / - and not 'graph'");
    if (typeof input.attribute !== "string" || !ATTR_RE.test(input.attribute)) throw new HttpError(400, "attribute must be lower_snake_case");
    if (!("value" in input)) throw new HttpError(400, "value is required");
    const valueJson = canonicalJson(input.value ?? null);
    if (valueJson.length > 8000) throw new HttpError(413, "value larger than 8000 bytes");
    const t = (k: string, required: boolean) => {
      const v = input[k];
      if (v === undefined || v === null) { if (required) throw new HttpError(400, `${k} is required`); return null; }
      if (typeof v !== "string" || Number.isNaN(Date.parse(v)) || !/T.*(Z|[+-]\d{2}:?\d{2})$/.test(v)) throw new HttpError(400, `${k} must be an ISO 8601 timestamp with an offset`);
      return iso(v);
    };
    const validFrom = t("valid_from", true), validTo = t("valid_to", false), observedAt = t("observed_at", false);
    const recordedAt = this.now().toISOString();
    if (validTo && ms(validTo) <= ms(validFrom)) throw new HttpError(400, "valid_to must be later than valid_from");
    if (observedAt && ms(observedAt) > Date.parse(recordedAt) + 1000) throw new HttpError(400, "observed_at cannot be in the future");
    const ent = this.findEntity(projectId, input.entity_ref, input.kind, input.app_id);
    return tx(this.db, () => {
      const prov = { actor, ...(typeof input.evidence_ref === "string" ? { evidence_ref: input.evidence_ref.slice(0, 300) } : {}) };
      const a = this.insertAssertion(projectId, ent, type, input.attribute as string, input.value ?? null, validFrom, observedAt, recordedAt, src, "api", prov);
      if (validTo) this.insertAssertion(projectId, ent, type, input.attribute as string, null, validTo, observedAt, recordedAt, src, "api", { ...prov, closes: a.id });
      return a;
    });
  }

  /** Choose one candidate for a conflicting attribute; optimistic on the subject's reconciliation version. */
  reconcile(projectId: string, input: Record<string, unknown>, actor: string) {
    const ent = this.findEntity(projectId, input.entity_ref);
    if (typeof input.attribute !== "string" || !ATTR_RE.test(input.attribute)) throw new HttpError(400, "attribute must be lower_snake_case");
    if (typeof input.chosen_assertion_id !== "string") throw new HttpError(400, "chosen_assertion_id is required");
    if (typeof input.rationale !== "string" || !input.rationale.trim()) throw new HttpError(400, "rationale is required");
    if (typeof input.expected_version !== "number" || !Number.isInteger(input.expected_version)) throw new HttpError(428, "expected_version is required (0 for the first decision)");
    const attribute = input.attribute, chosenId = input.chosen_assertion_id, rationale = input.rationale;
    return tx(this.db, () => {
      const prev = this.db.prepare("SELECT version FROM reconciliations WHERE project_id = ? AND entity_ref = ? AND attribute = ? ORDER BY version DESC LIMIT 1").get(projectId, ent, attribute) as { version: number } | undefined;
      const curVersion = prev ? Number(prev.version) : 0;
      if (input.expected_version !== curVersion) throw new HttpError(409, "another reconciliation was recorded since you loaded this conflict", [], { current: { version: curVersion } });
      const view = this.attributeView(projectId, ent, input.attribute as string, this.now().toISOString(), this.now().toISOString());
      if (!view) throw new HttpError(404, "attribute has no current assertions");
      if (!view.candidates.some((c) => c.assertion_id === input.chosen_assertion_id)) throw new HttpError(422, "chosen_assertion_id is not one of the current candidates", view.candidates.map((c) => c.assertion_id));
      const id = "rec_" + sha256Hex(`${projectId}:${ent}:${input.attribute}:${curVersion + 1}`).slice(0, 16);
      this.db.prepare("INSERT INTO reconciliations (id, project_id, entity_ref, attribute, chosen_assertion_id, considered, rationale, decided_by, decided_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, projectId, ent, attribute, chosenId, canonicalJson(view.candidates.map((c) => c.assertion_id)), rationale.slice(0, 2000), actor, this.now().toISOString(), curVersion + 1);
      return { id, entity_ref: ent, attribute, chosen_assertion_id: chosenId, version: curVersion + 1 };
    });
  }

  // ------------------------------------------------------------------ reading

  /**
   * The world as it was at `validAt`, as Digital Kingdom knew it at `knownAt`. Defaults: both now.
   * Entities with no assertion recorded by knownAt are absent from the view, not "known not to exist".
   */
  view(projectId: string, opts: { validAt?: string; knownAt?: string; entityRef?: string; includeRetired?: boolean } = {}) {
    this.ensureBackfilled(projectId);
    const now = this.now().toISOString();
    const validAt = opts.validAt ? iso(opts.validAt) : now, knownAt = opts.knownAt ? iso(opts.knownAt) : now;
    const ents = (opts.entityRef
      ? this.db.prepare("SELECT * FROM entities WHERE project_id = ? AND entity_ref = ?").all(projectId, opts.entityRef)
      : this.db.prepare("SELECT * FROM entities WHERE project_id = ? ORDER BY kind, app_id, incarnation").all(projectId)) as { entity_ref: string; kind: EntityKind; app_id: string; incarnation: number; provider_scope: string | null; provider_id: string | null }[];
    const attrs = this.db.prepare("SELECT DISTINCT attribute FROM assertions WHERE project_id = ? AND entity_ref = ? AND recorded_at <= ?");
    const out = [];
    let conflicts = 0;
    for (const e of ents) {
      const attributes: Record<string, ReturnType<Facts["attributeView"]>> = {};
      for (const { attribute } of attrs.all(projectId, e.entity_ref, knownAt) as { attribute: string }[]) {
        const v = this.attributeView(projectId, e.entity_ref, attribute, validAt, knownAt);
        if (v) { attributes[attribute] = v; if (v.state === "conflict") conflicts++; }
      }
      if (!Object.keys(attributes).length) continue;
      const exists = attributes.exists;
      const live = exists?.state !== "conflict" && exists?.value === true;
      if (!live && !opts.includeRetired && exists?.state !== "conflict") continue;
      out.push({ entity_ref: e.entity_ref, kind: e.kind, app_id: e.app_id, incarnation: e.incarnation, ...(e.provider_id ? { provider_ref: { scope: e.provider_scope, id: e.provider_id } } : {}), exists: exists ? (exists.state === "conflict" ? "conflict" : exists.value === true) : "unknown", attributes });
    }
    return { valid_at: validAt, known_at: knownAt, entities: out, conflicts,
      notes: ["A view is bitemporal: valid_at selects when facts held in the world; known_at limits them to what had been recorded by then.", "Conflicting sources are reported, never resolved by recency; a reconciliation is an explicit, attributed decision."] };
  }

  history(projectId: string, entityRef: string) {
    this.ensureBackfilled(projectId);
    const e = this.db.prepare("SELECT * FROM entities WHERE project_id = ? AND entity_ref = ?").get(projectId, entityRef);
    if (!e) throw new HttpError(404, "entity not found");
    const assertions = (this.db.prepare("SELECT * FROM assertions WHERE project_id = ? AND entity_ref = ? ORDER BY seq").all(projectId, entityRef) as Record<string, string>[]).map(rowToAssertion);
    const reconciliations = this.db.prepare("SELECT id, attribute, chosen_assertion_id, considered, rationale, decided_by, decided_at, version FROM reconciliations WHERE project_id = ? AND entity_ref = ? ORDER BY decided_at").all(projectId, entityRef);
    const incarnations = this.db.prepare("SELECT entity_ref, incarnation, provider_scope, provider_id, created_recorded_at FROM entities WHERE project_id = ? AND kind = ? AND app_id = ? ORDER BY incarnation").all(projectId, (e as { kind: string }).kind, (e as { app_id: string }).app_id);
    return { entity: e, incarnations, assertions, reconciliations };
  }

  conflicts(projectId: string, opts: { validAt?: string; knownAt?: string } = {}) {
    const v = this.view(projectId, { ...opts, includeRetired: true });
    return { valid_at: v.valid_at, known_at: v.known_at, conflicts: v.entities.flatMap((e) => Object.entries(e.attributes).filter(([, a]) => a!.state === "conflict").map(([attribute, a]) => ({ entity_ref: e.entity_ref, app_id: e.app_id, attribute, candidates: a!.candidates, stale_reconciliation: a!.stale_reconciliation ?? null, reconciliation_version: a!.reconciliation_version }))) };
  }

  /** Per source: latest assertion with valid_from <= validAt recorded by knownAt. Then compare across sources. */
  attributeView(projectId: string, entityRef: string, attribute: string, validAt: string, knownAt: string) {
    const rows = (this.db.prepare("SELECT * FROM assertions WHERE project_id = ? AND entity_ref = ? AND attribute = ? AND recorded_at <= ? ORDER BY seq").all(projectId, entityRef, attribute, knownAt) as Record<string, string>[]).map(rowToAssertion);
    const t = Date.parse(validAt);
    const bySource = new Map<string, Assertion>();
    for (const a of rows) {
      if (ms(a.valid_from) > t) continue;
      const cur = bySource.get(a.source_ref);
      if (!cur || ms(a.valid_from) > ms(cur.valid_from) || (ms(a.valid_from) === ms(cur.valid_from) && a.recorded_at >= cur.recorded_at)) bySource.set(a.source_ref, a);
    }
    // a closing assertion (value null written by valid_to) ends that source's claim
    const candidates = [...bySource.values()].filter((a) => !(a.method === "api" && a.value === null && (a.provenance as { closes?: string }).closes));
    if (!candidates.length) return null;
    const cand = candidates.map((a) => ({ assertion_id: a.id, source_ref: a.source_ref, assertion_type: a.assertion_type, value: a.value, valid_from: a.valid_from, recorded_at: a.recorded_at, observed_at: a.observed_at, method: a.method }));
    const distinct = new Set(candidates.map((a) => canonicalJson(a.value)));
    const rec = this.db.prepare("SELECT id, chosen_assertion_id, version, decided_by, decided_at, rationale FROM reconciliations WHERE project_id = ? AND entity_ref = ? AND attribute = ? AND decided_at <= ? ORDER BY version DESC LIMIT 1").get(projectId, entityRef, attribute, knownAt) as { id: string; chosen_assertion_id: string; version: number; decided_by: string; decided_at: string; rationale: string } | undefined;
    const recVersion = rec ? Number(rec.version) : 0;
    if (distinct.size === 1) return { state: "single" as const, value: candidates[0]!.value, candidates: cand, reconciliation_version: recVersion };
    if (rec) {
      const chosen = candidates.find((a) => a.id === rec.chosen_assertion_id);
      if (chosen) return { state: "reconciled" as const, value: chosen.value, candidates: cand, reconciliation: rec, reconciliation_version: recVersion };
      return { state: "conflict" as const, value: undefined, candidates: cand, stale_reconciliation: { ...rec, reason: "the chosen assertion is no longer current for this time" }, reconciliation_version: recVersion };
    }
    return { state: "conflict" as const, value: undefined, candidates: cand, reconciliation_version: recVersion };
  }

  // ------------------------------------------------------------------ internals

  private findEntity(projectId: string, entityRef: unknown, kind?: unknown, appId?: unknown): string {
    if (typeof entityRef === "string") {
      const e = this.db.prepare("SELECT entity_ref FROM entities WHERE project_id = ? AND entity_ref = ?").get(projectId, entityRef) as { entity_ref: string } | undefined;
      if (!e) throw new HttpError(404, "entity not found");
      return e.entity_ref;
    }
    if ((kind === "asset" || kind === "relationship") && typeof appId === "string") {
      const e = this.latestIncarnations(projectId, kind).find((x) => x.app_id === appId);
      if (!e) throw new HttpError(404, `no ${kind} ${appId} has been declared`);
      return e.entity_ref;
    }
    throw new HttpError(400, "provide entity_ref, or kind and app_id");
  }

  private latestIncarnations(projectId: string, kind: EntityKind) {
    return this.db.prepare("SELECT e.* FROM entities e WHERE e.project_id = ? AND e.kind = ? AND e.incarnation = (SELECT MAX(incarnation) FROM entities x WHERE x.project_id = e.project_id AND x.kind = e.kind AND x.app_id = e.app_id)").all(projectId, kind) as { entity_ref: string; app_id: string; incarnation: number; provider_scope: string | null; provider_id: string | null }[];
  }

  /**
   * Identity rule: reuse the latest incarnation while it is live and its provider identity is compatible.
   * A retired entity, or a different provider id, starts a new incarnation; the old one is retired.
   */
  private resolveEntity(projectId: string, kind: EntityKind, appId: string, providerRef: { scope: string; id: string } | undefined, validFrom: string | null, recordedAt: string, tombstoned: boolean): string {
    const latest = this.latestIncarnations(projectId, kind).find((e) => e.app_id === appId);
    const create = (inc: number) => {
      const ref = `ent:${projectId}:${kind}:${appId}${inc > 1 ? `#${inc}` : ""}`;
      this.db.prepare("INSERT INTO entities (entity_ref, project_id, kind, app_id, incarnation, provider_scope, provider_id, created_recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(ref, projectId, kind, appId, inc, providerRef?.scope ?? null, providerRef?.id ?? null, recordedAt);
      return ref;
    };
    if (!latest) return create(1);
    const sameProvider = providerRef && latest.provider_id && latest.provider_scope === providerRef.scope && latest.provider_id === providerRef.id;
    const differentProvider = providerRef && latest.provider_id && !sameProvider;
    if (differentProvider) {
      const cur = this.currentValue(projectId, latest.entity_ref, "exists", "graph");
      if (cur?.value === true) this.insertAssertion(projectId, latest.entity_ref, "declared_config", "exists", false, validFrom ? iso(validFrom) : recordedAt, null, recordedAt, "graph", "identity_rule", { reason: `provider id changed to ${providerRef!.scope}/${providerRef!.id}` });
      return create(latest.incarnation + 1);
    }
    const cur = this.currentValue(projectId, latest.entity_ref, "exists", "graph");
    if (cur?.value === false && !tombstoned && !sameProvider) return create(latest.incarnation + 1);
    if (providerRef && !latest.provider_id) this.db.prepare("UPDATE entities SET provider_scope = ?, provider_id = ? WHERE entity_ref = ?").run(providerRef.scope, providerRef.id, latest.entity_ref);
    return latest.entity_ref;
  }

  /** Latest-recorded, latest-valid assertion from one source, regardless of valid time (for change detection). */
  private currentValue(projectId: string, entityRef: string, attribute: string, sourceRef: string): Assertion | undefined {
    const r = this.db.prepare("SELECT * FROM assertions WHERE project_id = ? AND entity_ref = ? AND attribute = ? AND source_ref = ? ORDER BY CASE WHEN valid_from IS NULL THEN 0 ELSE 1 END DESC, valid_from DESC, seq DESC LIMIT 1").get(projectId, entityRef, attribute, sourceRef) as Record<string, string> | undefined;
    return r ? rowToAssertion(r) : undefined;
  }

  private assertIfChanged(projectId: string, entityRef: string, type: AssertionType, attribute: string, value: unknown, fromSpec: string | null | { changeAt: string }, observedAt: string | null, recordedAt: string, sourceRef: string, method: string, provenance: Record<string, unknown>) {
    const rows = (this.db.prepare("SELECT * FROM assertions WHERE project_id = ? AND entity_ref = ? AND attribute = ? AND source_ref = ? ORDER BY seq").all(projectId, entityRef, attribute, sourceRef) as Record<string, string>[]).map(rowToAssertion);
    const validFrom = typeof fromSpec === "object" && fromSpec !== null ? (rows.length || entityRef.includes("#") ? fromSpec.changeAt : null) : fromSpec;
    // Effective value at validFrom per what is already recorded: unchanged declarations add nothing.
    const t = ms(validFrom);
    let eff: Assertion | undefined;
    for (const a of rows) if (ms(a.valid_from) <= t && (!eff || ms(a.valid_from) > ms(eff.valid_from) || (ms(a.valid_from) === ms(eff.valid_from) && a.recorded_at >= eff.recorded_at))) eff = a;
    if (eff && canonicalJson(eff.value) === canonicalJson(value) && eff.assertion_type === type) return;
    this.insertAssertion(projectId, entityRef, type, attribute, value, validFrom, observedAt, recordedAt, sourceRef, method, provenance);
  }

  private insertAssertion(projectId: string, entityRef: string, type: AssertionType, attribute: string, value: unknown, validFrom: string | null, observedAt: string | null, recordedAt: string, sourceRef: string, method: string, provenance: Record<string, unknown>): Assertion {
    const body = { entityRef, type, attribute, value, validFrom, observedAt, recordedAt, sourceRef, method };
    const id = "as_" + sha256Hex(`${projectId}:${canonicalJson(body)}:${(this.db.prepare("SELECT COUNT(*) AS n FROM assertions WHERE project_id = ?").get(projectId) as { n: number }).n}`).slice(0, 20);
    this.db.prepare("INSERT INTO assertions (id, project_id, entity_ref, assertion_type, attribute, value, valid_from, valid_to, observed_at, recorded_at, source_ref, method, provenance) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)")
      .run(id, projectId, entityRef, type, attribute, canonicalJson(value ?? null), validFrom, observedAt, recordedAt, sourceRef, method, canonicalJson(provenance));
    return { id, entity_ref: entityRef, assertion_type: type, attribute, value: value ?? null, valid_from: validFrom, valid_to: null, observed_at: observedAt, recorded_at: recordedAt, source_ref: sourceRef, method, provenance };
  }
}

function rowToAssertion(r: Record<string, string>): Assertion {
  return { id: r.id!, entity_ref: r.entity_ref!, assertion_type: r.assertion_type as AssertionType, attribute: r.attribute!, value: JSON.parse(r.value!), valid_from: r.valid_from ?? null, valid_to: r.valid_to ?? null, observed_at: r.observed_at ?? null, recorded_at: r.recorded_at!, source_ref: r.source_ref!, method: r.method!, provenance: JSON.parse(r.provenance!) as Record<string, unknown> };
}
