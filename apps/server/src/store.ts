import {
  canonicalJson, digest, validateIngestEventSchema,
  type CompiledScene, type DatasetKind, type Finding, type Graph, type SceneProposal, type SecurityEvent,
} from "@dk/contracts";
import { GraphIndex, validateGraph } from "@dk/graph-core";
import { compileScene, defaultProposal, validateProposal } from "@dk/scene-compiler";
import { evaluate, normalizeIngest, type SourceConfig } from "@dk/detections";
import { tx, type DB } from "./db.ts";
import { atLeast, newToken, sha256, type Role } from "./security.ts";
import { CONTAINMENT_CATALOG, type ContainmentAction } from "./containment.ts";

export interface Principal {
  kind: "token" | "anonymous-demo" | "source";
  id: string;
  name: string;
  role: Role;
  projects: "*" | string[];
}

export interface ProjectRow { id: string; name: string; dataset_kind: DatasetKind; created_at: string; meta: Record<string, unknown> }

export interface StoreOptions {
  now?: () => Date;
  /** Fault injection for tests: called inside the processing transaction after events are written. */
  faultHook?: (stage: "after_events" | "after_findings") => void;
  eventWindow?: number;
}

const J = <T>(s: string | null | undefined, fallback: T): T => (s ? (JSON.parse(s) as T) : fallback);

export class Store {
  private indexCache = new Map<string, { revision: string; index: GraphIndex; graph: Graph }>();
  readonly now: () => Date;

  constructor(readonly db: DB, private readonly opts: StoreOptions = {}) {
    this.now = opts.now ?? (() => new Date());
  }
  private iso() { return this.now().toISOString(); }

  // ---------------- projects / graph / scene ----------------

  createProject(id: string, name: string, dataset_kind: DatasetKind, meta: Record<string, unknown> = {}): ProjectRow {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(id)) throw new HttpError(400, "invalid project id");
    this.db.prepare("INSERT INTO projects (id, name, dataset_kind, created_at, meta) VALUES (?, ?, ?, ?, ?)").run(id, name.slice(0, 120), dataset_kind, this.iso(), JSON.stringify(meta));
    return this.getProject(id)!;
  }

  getProject(id: string): ProjectRow | undefined {
    const r = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, string> | undefined;
    return r ? { id: r.id!, name: r.name!, dataset_kind: r.dataset_kind as DatasetKind, created_at: r.created_at!, meta: J(r.meta, {}) } : undefined;
  }

  listProjects(p: Principal): ProjectRow[] {
    const rows = this.db.prepare("SELECT id FROM projects ORDER BY created_at").all() as { id: string }[];
    return rows.map((r) => this.getProject(r.id)!).filter((proj) => this.canSee(p, proj));
  }

  canSee(p: Principal, proj: ProjectRow | undefined): boolean {
    if (!proj) return false;
    if (p.kind === "anonymous-demo") return proj.dataset_kind === "synthetic";
    return p.projects === "*" || p.projects.includes(proj.id);
  }

  putGraph(projectId: string, graph: Graph, actor: string): { scene: CompiledScene; warnings: string[] } {
    const proj = this.mustProject(projectId);
    const v = validateGraph(graph);
    if (!v.ok) throw new HttpError(422, "graph rejected", v.errors);
    if (graph.project_id !== projectId) throw new HttpError(422, `graph project_id ${graph.project_id} does not match ${projectId}`);
    if (graph.dataset_kind !== proj.dataset_kind) throw new HttpError(422, `graph dataset_kind ${graph.dataset_kind} cannot enter a ${proj.dataset_kind} project`);
    const previous = this.getScene(projectId);
    return tx(this.db, () => {
      this.db.prepare("UPDATE graph_revisions SET current = 0 WHERE project_id = ?").run(projectId);
      this.db.prepare("INSERT OR REPLACE INTO graph_revisions (project_id, revision, graph, created_at, current) VALUES (?, ?, ?, ?, 1)").run(projectId, graph.graph_revision, JSON.stringify(graph), this.iso());
      const proposal = defaultProposal(graph, previous?.seed ?? 1);
      if (previous) proposal.style_profile = previous.style_profile;
      const scene = compileScene(graph, proposal, { previous, source: "default" });
      this.saveScene(projectId, scene, proposal);
      this.audit(actor, "graph.put", projectId, graph.graph_revision, { assets: graph.assets.length, relationships: graph.relationships.length, reflow: scene.reflow_zones });
      this.emit(projectId, "graph", { graph_revision: graph.graph_revision });
      this.indexCache.delete(projectId);
      return { scene, warnings: v.warnings };
    });
  }

  getGraph(projectId: string, revision?: string): Graph | undefined {
    const r = (revision
      ? this.db.prepare("SELECT graph FROM graph_revisions WHERE project_id = ? AND revision = ?").get(projectId, revision)
      : this.db.prepare("SELECT graph FROM graph_revisions WHERE project_id = ? AND current = 1").get(projectId)) as { graph: string } | undefined;
    return r ? (JSON.parse(r.graph) as Graph) : undefined;
  }

  private index(projectId: string) {
    const graph = this.getGraph(projectId);
    if (!graph) return undefined;
    const c = this.indexCache.get(projectId);
    if (c && c.revision === graph.graph_revision) return c;
    const fresh = { revision: graph.graph_revision, index: new GraphIndex(graph), graph };
    this.indexCache.set(projectId, fresh);
    return fresh;
  }

  getScene(projectId: string): CompiledScene | undefined {
    const g = this.getGraph(projectId);
    if (!g) return undefined;
    const r = this.db.prepare("SELECT scene FROM scenes WHERE project_id = ? AND graph_revision = ?").get(projectId, g.graph_revision) as { scene: string } | undefined;
    if (r) return JSON.parse(r.scene) as CompiledScene;
    const last = this.db.prepare("SELECT scene FROM scenes WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(projectId) as { scene: string } | undefined;
    return last ? (JSON.parse(last.scene) as CompiledScene) : undefined;
  }

  applyProposal(projectId: string, proposal: unknown, source: CompiledScene["proposal_source"], actor: string, reflow = false): CompiledScene {
    const graph = this.getGraph(projectId);
    if (!graph) throw new HttpError(404, "project has no graph");
    const v = validateProposal(graph, proposal);
    if (!v.ok) throw new HttpError(422, "scene proposal rejected", v.errors);
    const previous = this.getScene(projectId);
    const scene = compileScene(graph, proposal as SceneProposal, { previous, reflow, source });
    tx(this.db, () => {
      this.saveScene(projectId, scene, proposal as SceneProposal);
      this.audit(actor, reflow ? "scene.reflow" : "scene.apply", projectId, scene.digest, { source });
      this.emit(projectId, "scene", { digest: scene.digest });
    });
    return scene;
  }

  private saveScene(projectId: string, scene: CompiledScene, proposal: SceneProposal) {
    this.db.prepare("INSERT OR REPLACE INTO scenes (project_id, graph_revision, scene, proposal, created_at) VALUES (?, ?, ?, ?, ?)").run(projectId, scene.graph_revision, JSON.stringify(scene), JSON.stringify(proposal), this.iso());
  }

  // ---------------- sources ----------------

  upsertSource(projectId: string, cfg: SourceConfig & { kind?: string; dataset_kind?: DatasetKind }, actor: string): { id: string; key: string } {
    const proj = this.mustProject(projectId);
    if (cfg.dataset_kind && cfg.dataset_kind !== proj.dataset_kind) throw new HttpError(422, `a ${cfg.dataset_kind} source cannot write to a ${proj.dataset_kind} project`);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(cfg.id)) throw new HttpError(400, "invalid source id");
    const key = newToken(proj.dataset_kind === "synthetic" ? "dks_demo" : "dks");
    this.db.prepare(`INSERT INTO sources (id, project_id, label, kind, asset_ids, trusts_request_ids, stale_after_seconds, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (project_id, id) DO UPDATE SET label = excluded.label, kind = excluded.kind, asset_ids = excluded.asset_ids, trusts_request_ids = excluded.trusts_request_ids, stale_after_seconds = excluded.stale_after_seconds, key_hash = excluded.key_hash`)
      .run(cfg.id, projectId, cfg.label.slice(0, 120), cfg.kind ?? "generic", JSON.stringify(cfg.asset_ids ?? []), cfg.trusts_request_ids ? 1 : 0, cfg.stale_after_seconds ?? null, sha256(key), this.iso());
    this.audit(actor, "source.key_issued", projectId, cfg.id, { kind: cfg.kind ?? "generic" });
    return { id: cfg.id, key };
  }

  listSources(projectId: string): (SourceConfig & { kind: string; disabled: boolean })[] {
    return (this.db.prepare("SELECT * FROM sources WHERE project_id = ? ORDER BY id").all(projectId) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id), label: String(r.label), kind: String(r.kind), asset_ids: J(String(r.asset_ids), [] as string[]),
      trusts_request_ids: r.trusts_request_ids === 1, ...(r.stale_after_seconds ? { stale_after_seconds: Number(r.stale_after_seconds) } : {}), disabled: r.disabled === 1,
    }));
  }

  /** Source identity is bound to a project by its key; the payload never chooses the project. */
  authenticateSource(rawKey: string | undefined): { projectId: string; sourceId: string; datasetKind: DatasetKind } | undefined {
    if (!rawKey) return undefined;
    const r = this.db.prepare("SELECT s.id, s.project_id, p.dataset_kind FROM sources s JOIN projects p ON p.id = s.project_id WHERE s.key_hash = ? AND s.disabled = 0").get(sha256(rawKey)) as { id: string; project_id: string; dataset_kind: DatasetKind } | undefined;
    return r ? { projectId: r.project_id, sourceId: r.id, datasetKind: r.dataset_kind } : undefined;
  }

  // ---------------- ingestion (receive -> durable journal) ----------------

  /**
   * Synchronous receive: validate, then durably journal. Acknowledged only after commit. Duplicate
   * deliveries (same source + source_event_id) are counted, never re-journaled.
   */
  receive(projectId: string, sourceId: string, payload: unknown, receivedAtOverride?: string): { status: "accepted" | "duplicate"; seq?: number } | { status: "rejected"; reason: string; detail: string } {
    const v = validateIngestEventSchema(payload);
    if (!v.ok) { this.reject(projectId, sourceId, "receive", "schema", v.errors.join("; ")); return { status: "rejected", reason: "schema", detail: v.errors.join("; ") }; }
    const p = payload as { project_id?: string; source_event_id: string };
    if (p.project_id !== undefined && p.project_id !== projectId) {
      const detail = `source is bound to ${projectId}; payload asserted ${p.project_id}`;
      this.reject(projectId, sourceId, "receive", "project_mismatch", detail);
      return { status: "rejected", reason: "project_mismatch", detail };
    }
    return tx(this.db, () => {
      const existing = this.db.prepare("SELECT seq FROM journal WHERE project_id = ? AND source_id = ? AND source_event_id = ?").get(projectId, sourceId, p.source_event_id) as { seq: number } | undefined;
      if (existing) {
        this.db.prepare("UPDATE journal SET attempts = attempts + 1 WHERE seq = ?").run(existing.seq);
        this.count(projectId, sourceId, "duplicate");
        return { status: "duplicate" as const, seq: existing.seq };
      }
      const r = this.db.prepare("INSERT INTO journal (project_id, source_id, source_event_id, payload, received_at) VALUES (?, ?, ?, ?, ?)").run(projectId, sourceId, p.source_event_id, JSON.stringify(payload), receivedAtOverride ?? this.iso());
      this.count(projectId, sourceId, "accepted");
      return { status: "accepted" as const, seq: Number(r.lastInsertRowid) };
    });
  }

  reject(projectId: string, sourceId: string, stage: string, reason: string, detail: string) {
    tx(this.db, () => {
      this.db.prepare("INSERT INTO rejections (project_id, source_id, stage, reason, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(projectId, sourceId, stage, reason, detail.slice(0, 500), this.iso());
      this.count(projectId, sourceId, `rejected:${reason}`);
    });
  }

  private count(projectId: string, sourceId: string, metric: string, by = 1) {
    this.db.prepare(`INSERT INTO counters (project_id, source_id, metric, value, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (project_id, source_id, metric) DO UPDATE SET value = value + excluded.value, updated_at = excluded.updated_at`).run(projectId, sourceId, metric, by, this.iso());
  }

  // ---------------- processing (journal -> events -> findings -> outbox) ----------------

  checkpoint(name = "normalizer"): number {
    return (this.db.prepare("SELECT last_seq FROM checkpoints WHERE name = ?").get(name) as { last_seq: number } | undefined)?.last_seq ?? 0;
  }

  backlog(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM journal WHERE seq > ?").get(this.checkpoint()) as { n: number }).n);
  }

  /**
   * Process up to `limit` journal rows in ONE transaction: normalize, insert events, re-evaluate findings
   * for affected projects, publish outbox messages, advance the checkpoint. A crash anywhere rolls the
   * whole batch back, and the next run reprocesses it idempotently (event ids are deterministic).
   */
  processBatch(limit = 200): { processed: number; projects: string[] } {
    const from = this.checkpoint();
    const rows = this.db.prepare("SELECT * FROM journal WHERE seq > ? ORDER BY seq LIMIT ?").all(from, limit) as { seq: number; project_id: string; source_id: string; payload: string; received_at: string }[];
    if (!rows.length) return { processed: 0, projects: [] };
    const touched = new Set<string>();
    tx(this.db, () => {
      for (const row of rows) {
        const ix = this.index(row.project_id);
        const proj = this.getProject(row.project_id);
        const src = this.listSources(row.project_id).find((s) => s.id === row.source_id);
        if (!ix || !proj || !src) { this.rejectInTx(row.project_id, row.source_id, "unmapped_asset", "project has no graph or source was removed"); continue; }
        const r = normalizeIngest(JSON.parse(row.payload), { projectId: row.project_id, sourceId: row.source_id, datasetKind: proj.dataset_kind, receivedAt: row.received_at, trustsRequestIds: !!src.trusts_request_ids, index: ix.index });
        if (!r.ok) { this.rejectInTx(row.project_id, row.source_id, r.reason, r.detail); continue; }
        const e = r.event;
        const ins = this.db.prepare("INSERT OR IGNORE INTO events (id, seq, project_id, source_id, occurred_at, received_at, action, outcome, asset_ids, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(e.id, row.seq, e.project_id, e.source_id, e.occurred_at, e.received_at, e.action, e.outcome, JSON.stringify(e.asset_ids), JSON.stringify(e));
        if (r.evidence) this.db.prepare("INSERT OR IGNORE INTO evidence (ref, project_id, event_id, body, redacted, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(`evidence:${e.id}`, e.project_id, e.id, JSON.stringify(r.evidence), r.evidence.redacted ? 1 : 0, this.iso());
        if (Number(ins.changes) > 0) this.emit(e.project_id, "event", { id: e.id, asset_ids: e.asset_ids, action: e.action, outcome: e.outcome, occurred_at: e.occurred_at, source_id: e.source_id });
        touched.add(row.project_id);
      }
      this.opts.faultHook?.("after_events");
      for (const p of touched) this.evaluateInTx(p);
      this.opts.faultHook?.("after_findings");
      this.db.prepare("INSERT INTO checkpoints (name, last_seq) VALUES ('normalizer', ?) ON CONFLICT (name) DO UPDATE SET last_seq = excluded.last_seq").run(rows[rows.length - 1]!.seq);
    });
    return { processed: rows.length, projects: [...touched] };
  }

  private rejectInTx(projectId: string, sourceId: string, reason: string, detail: string) {
    this.db.prepare("INSERT INTO rejections (project_id, source_id, stage, reason, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(projectId, sourceId, "normalize", reason, detail.slice(0, 500), this.iso());
    this.count(projectId, sourceId, `rejected:${reason}`);
  }

  /** Re-evaluate coverage staleness on a timer (silence is a signal too). */
  evaluateProject(projectId: string) { tx(this.db, () => this.evaluateInTx(projectId)); }

  private evaluateInTx(projectId: string) {
    const ix = this.index(projectId);
    const proj = this.getProject(projectId);
    if (!ix || !proj) return;
    const events = this.listEvents(projectId, { limit: this.opts.eventWindow ?? 50_000 });
    const result = evaluate(ix.graph, events, { sources: this.listSources(projectId), ...(proj.dataset_kind === "live" ? { now: this.iso() } : {}) });
    for (const f of result.findings) {
      const { revision: _r, lifecycle: _l, disposition: _d, ...content } = f;
      const cd = digest(content);
      const prev = this.db.prepare("SELECT revision, content_digest FROM findings WHERE project_id = ? AND id = ?").get(projectId, f.id) as { revision: number; content_digest: string } | undefined;
      if (prev && prev.content_digest === cd) continue;
      const revision = (prev?.revision ?? 0) + 1;
      const body = JSON.stringify({ ...f, revision });
      this.db.prepare(`INSERT INTO findings (id, project_id, revision, content_digest, body, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (project_id, id) DO UPDATE SET revision = excluded.revision, content_digest = excluded.content_digest, body = excluded.body, updated_at = excluded.updated_at`).run(f.id, projectId, revision, cd, body, this.iso());
      this.db.prepare("INSERT INTO finding_revisions (project_id, finding_id, revision, body, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(projectId, f.id, revision, body, prev ? "new or late evidence changed this finding" : "created", this.iso());
      this.emit(projectId, "finding", { id: f.id, revision, kind: f.kind, outcome_state: f.outcome_state, affected_asset_ids: f.affected_asset_ids });
    }
    this.db.prepare("INSERT OR REPLACE INTO counters (project_id, source_id, metric, value, updated_at) VALUES (?, '*', 'coverage_digest', 0, ?)").run(projectId, digest(result.coverage));
  }

  // ---------------- reads ----------------

  listEvents(projectId: string, q: { asset?: string; after?: string; before?: string; limit?: number } = {}): SecurityEvent[] {
    const where = ["project_id = ?"]; const args: (string | number)[] = [projectId];
    if (q.after) { where.push("occurred_at >= ?"); args.push(q.after); }
    if (q.before) { where.push("occurred_at <= ?"); args.push(q.before); }
    if (q.asset) { where.push("EXISTS (SELECT 1 FROM json_each(events.asset_ids) WHERE value = ?)"); args.push(q.asset); }
    const limit = Math.min(Math.max(q.limit ?? 5000, 1), 50_000);
    const rows = this.db.prepare(`SELECT body FROM (SELECT body, occurred_at, id FROM events WHERE ${where.join(" AND ")} ORDER BY occurred_at DESC, id DESC LIMIT ?) ORDER BY occurred_at, id`).all(...args, limit) as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as SecurityEvent);
  }

  getEvidence(projectId: string, ref: string): Record<string, unknown> | undefined {
    const r = this.db.prepare("SELECT body FROM evidence WHERE project_id = ? AND ref = ?").get(projectId, ref) as { body: string } | undefined;
    return r ? JSON.parse(r.body) : undefined;
  }

  evidenceFor(projectId: string, refs: string[]): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const ref of refs.slice(0, 2000)) { const e = this.getEvidence(projectId, ref); if (e) out[ref] = e; }
    return out;
  }

  listFindings(projectId: string): Finding[] {
    return (this.db.prepare("SELECT body, lifecycle, disposition FROM findings WHERE project_id = ?").all(projectId) as { body: string; lifecycle: Finding["lifecycle"]; disposition: Finding["disposition"] }[])
      .map((r) => ({ ...(JSON.parse(r.body) as Finding), lifecycle: r.lifecycle, disposition: r.disposition }))
      .sort((a, b) => a.first_seen.localeCompare(b.first_seen) || a.id.localeCompare(b.id));
  }

  getFinding(projectId: string, id: string) {
    const f = this.listFindings(projectId).find((x) => x.id === id);
    if (!f) return undefined;
    const revisions = (this.db.prepare("SELECT revision, reason, created_at, body FROM finding_revisions WHERE project_id = ? AND finding_id = ? ORDER BY revision").all(projectId, id) as { revision: number; reason: string; created_at: string; body: string }[])
      .map((r) => ({ revision: r.revision, reason: r.reason, created_at: r.created_at, event_count: (JSON.parse(r.body) as Finding).event_count, evidence_level: (JSON.parse(r.body) as Finding).evidence_level }));
    const notes = this.db.prepare("SELECT author, note, created_at FROM analyst_notes WHERE project_id = ? AND finding_id = ? ORDER BY id").all(projectId, id);
    return { finding: f, revisions, notes };
  }

  setDisposition(projectId: string, id: string, actor: string, d: { lifecycle?: Finding["lifecycle"]; disposition?: Finding["disposition"]; note?: string }) {
    if (!this.getFinding(projectId, id)) throw new HttpError(404, "finding not found");
    tx(this.db, () => {
      if (d.lifecycle) this.db.prepare("UPDATE findings SET lifecycle = ? WHERE project_id = ? AND id = ?").run(d.lifecycle, projectId, id);
      if (d.disposition) this.db.prepare("UPDATE findings SET disposition = ? WHERE project_id = ? AND id = ?").run(d.disposition, projectId, id);
      if (d.note) this.db.prepare("INSERT INTO analyst_notes (project_id, finding_id, author, note, created_at) VALUES (?, ?, ?, ?, ?)").run(projectId, id, actor, d.note.slice(0, 4000), this.iso());
      this.audit(actor, "finding.disposition", projectId, id, d);
      this.emit(projectId, "finding", { id, analyst_update: true });
    });
    return this.getFinding(projectId, id)!;
  }

  evaluation(projectId: string) {
    const ix = this.index(projectId);
    const proj = this.mustProject(projectId);
    if (!ix) return { coverage: [], unobserved_asset_ids: [], ruleset_version: "" };
    const r = evaluate(ix.graph, this.listEvents(projectId, { limit: this.opts.eventWindow ?? 50_000 }), { sources: this.listSources(projectId), ...(proj.dataset_kind === "live" ? { now: this.iso() } : {}) });
    return { coverage: r.coverage, unobserved_asset_ids: r.unobserved_asset_ids, ruleset_version: r.ruleset_version };
  }

  health(projectId: string) {
    const counters = this.db.prepare("SELECT source_id, metric, value, updated_at FROM counters WHERE project_id = ? AND source_id != '*' ORDER BY source_id, metric").all(projectId) as { source_id: string; metric: string; value: number; updated_at: string }[];
    const bySource: Record<string, Record<string, number>> = {};
    for (const c of counters) (bySource[c.source_id] ??= {})[c.metric] = Number(c.value);
    const recentRejections = this.db.prepare("SELECT source_id, stage, reason, detail, created_at FROM rejections WHERE project_id = ? ORDER BY id DESC LIMIT 20").all(projectId);
    const lagRow = this.db.prepare("SELECT MIN(received_at) AS oldest FROM journal WHERE seq > ? AND project_id = ?").get(this.checkpoint(), projectId) as { oldest: string | null };
    return {
      counters: bySource,
      backlog: this.backlog(),
      oldest_unprocessed_received_at: lagRow.oldest,
      recent_rejections: recentRejections,
      ...this.evaluation(projectId),
    };
  }

  // ---------------- outbox / SSE ----------------

  emit(projectId: string, type: string, payload: unknown) {
    this.db.prepare("INSERT INTO outbox (project_id, type, payload, created_at) VALUES (?, ?, ?, ?)").run(projectId, type, JSON.stringify(payload), this.iso());
  }

  outboxSince(projectId: string, cursor: number, limit = 100): { seq: number; type: string; payload: unknown }[] {
    return (this.db.prepare("SELECT seq, type, payload FROM outbox WHERE project_id = ? AND seq > ? ORDER BY seq LIMIT ?").all(projectId, cursor, limit) as { seq: number; type: string; payload: string }[])
      .map((r) => ({ seq: Number(r.seq), type: r.type, payload: JSON.parse(r.payload) }));
  }

  outboxHead(): { min: number; max: number } {
    const r = this.db.prepare("SELECT MIN(seq) AS min, MAX(seq) AS max FROM outbox").get() as { min: number | null; max: number | null };
    return { min: Number(r.min ?? 0), max: Number(r.max ?? 0) };
  }

  pruneOutbox(keep = 10_000) {
    const { max } = this.outboxHead();
    this.db.prepare("DELETE FROM outbox WHERE seq <= ?").run(max - keep);
  }

  // ---------------- tokens / sessions / audit ----------------

  createToken(name: string, role: Role, projects: "*" | string[] = "*", raw?: string): { id: string; token: string } {
    const token = raw ?? newToken("dku");
    const id = "tok_" + sha256(token).slice(0, 12);
    this.db.prepare("INSERT OR IGNORE INTO api_tokens (id, name, role, token_hash, project_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, name.slice(0, 80), role, sha256(token), projects === "*" ? "*" : JSON.stringify(projects), this.iso());
    return { id, token };
  }

  hasAdmin(): boolean {
    return !!this.db.prepare("SELECT 1 FROM api_tokens WHERE role = 'admin' AND revoked = 0 LIMIT 1").get();
  }

  authenticateToken(raw: string | undefined): Principal | undefined {
    if (!raw) return undefined;
    const r = this.db.prepare("SELECT * FROM api_tokens WHERE token_hash = ? AND revoked = 0").get(sha256(raw)) as Record<string, string> | undefined;
    if (!r) return undefined;
    return { kind: "token", id: r.id!, name: r.name!, role: r.role as Role, projects: r.project_ids === "*" ? "*" : J(r.project_ids, [] as string[]) };
  }

  createSession(tokenId: string, ttlHours = 12): string {
    const sid = newToken("dksess");
    this.db.prepare("INSERT INTO sessions (id_hash, token_id, expires_at) VALUES (?, ?, ?)").run(sha256(sid), tokenId, new Date(this.now().getTime() + ttlHours * 3600_000).toISOString());
    return sid;
  }

  authenticateSession(sid: string | undefined): Principal | undefined {
    if (!sid) return undefined;
    const r = this.db.prepare("SELECT t.* FROM sessions s JOIN api_tokens t ON t.id = s.token_id WHERE s.id_hash = ? AND s.expires_at > ? AND t.revoked = 0").get(sha256(sid), this.iso()) as Record<string, string> | undefined;
    return r ? { kind: "token", id: r.id!, name: r.name!, role: r.role as Role, projects: r.project_ids === "*" ? "*" : J(r.project_ids, [] as string[]) } : undefined;
  }

  deleteSession(sid: string) { this.db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(sha256(sid)); }

  audit(actor: string, action: string, projectId: string | null, target: string | null, detail: unknown) {
    this.db.prepare("INSERT INTO audit_log (at, actor, action, project_id, target, detail) VALUES (?, ?, ?, ?, ?, ?)").run(this.iso(), actor, action, projectId, target, canonicalJson(detail ?? null).slice(0, 4000));
  }

  listAudit(projectId?: string, limit = 200) {
    return projectId
      ? this.db.prepare("SELECT * FROM audit_log WHERE project_id = ? ORDER BY id DESC LIMIT ?").all(projectId, limit)
      : this.db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(limit);
  }

  // ---------------- containment (human-approved proposals only) ----------------

  containmentCatalog(projectId: string): ContainmentAction[] {
    const proj = this.mustProject(projectId);
    const allowed = proj.meta.containment_action_ids as string[] | undefined;
    return CONTAINMENT_CATALOG.filter((a) => !allowed || allowed.includes(a.id));
  }

  requestContainment(projectId: string, findingId: string, actionId: string, rationale: string, actor: string) {
    const f = this.getFinding(projectId, findingId);
    if (!f) throw new HttpError(404, "finding not found");
    const action = this.containmentCatalog(projectId).find((a) => a.id === actionId);
    if (!action) throw new HttpError(422, `containment action ${actionId} is not permitted in this project`);
    const graph = this.getGraph(projectId)!;
    const kinds = new Set(f.finding.affected_asset_ids.map((id) => graph.assets.find((a) => a.id === id)?.kind));
    if (!action.applies_to_kinds.some((k) => kinds.has(k))) throw new HttpError(422, `${actionId} does not apply to the assets in this finding`);
    const id = "cr_" + sha256(`${projectId}:${findingId}:${actionId}:${this.iso()}:${Math.random()}`).slice(0, 16);
    tx(this.db, () => {
      this.db.prepare("INSERT INTO containment_requests (id, project_id, finding_id, action_id, requested_by, rationale, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)").run(id, projectId, findingId, actionId, actor, rationale.slice(0, 2000), this.iso());
      this.audit(actor, "containment.requested", projectId, id, { findingId, actionId });
      this.emit(projectId, "containment", { id, status: "pending" });
    });
    return this.getContainment(projectId, id)!;
  }

  decideContainment(projectId: string, id: string, decision: "approved" | "rejected", actor: string, principalId: string) {
    const c = this.getContainment(projectId, id);
    if (!c) throw new HttpError(404, "containment request not found");
    if (c.status !== "pending") throw new HttpError(409, "already decided");
    if (c.requested_by === actor || c.requested_by === principalId) throw new HttpError(403, "the requester cannot approve their own containment request");
    tx(this.db, () => {
      this.db.prepare("UPDATE containment_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?").run(decision, actor, this.iso(), id);
      this.audit(actor, `containment.${decision}`, projectId, id, {});
      this.emit(projectId, "containment", { id, status: decision });
    });
    return this.getContainment(projectId, id)!;
  }

  getContainment(projectId: string, id: string) {
    return this.db.prepare("SELECT * FROM containment_requests WHERE project_id = ? AND id = ?").get(projectId, id) as Record<string, string> | undefined;
  }

  listContainment(projectId: string) {
    return this.db.prepare("SELECT * FROM containment_requests WHERE project_id = ? ORDER BY created_at DESC LIMIT 200").all(projectId);
  }

  mustProject(id: string): ProjectRow {
    const p = this.getProject(id);
    if (!p) throw new HttpError(404, "project not found");
    return p;
  }

  require(p: Principal, projectId: string, role: Role): ProjectRow {
    const proj = this.getProject(projectId);
    if (!proj || !this.canSee(p, proj)) throw new HttpError(404, "project not found");
    if (!atLeast(p.role, role)) throw new HttpError(403, `requires ${role} role`);
    return proj;
  }
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly details: string[] = []) { super(message); }
}
