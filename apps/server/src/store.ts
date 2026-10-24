import {
  canonicalJson, digest,
  EVENT_ACTIONS, EVENT_OUTCOMES, type EventAction, type IngestEvent,
  type CompiledScene, type DatasetKind, type Finding, type Graph, type SceneProposal, type SecurityEvent,
} from "@dk/contracts";
import { GraphIndex, validateGraph } from "@dk/graph-core";
import { compileScene, defaultProposal, layoutDiff, validateProposal } from "@dk/scene-compiler";
import type { LayoutReason } from "./world-layout.ts";
import { checkCapability, deriveCoverage, evaluate, RULESET_VERSION, redactString, type SourceState, validateNamespace, minimizeIngest, normalizeIngest, sanitizeStoredRedaction, sourceCapabilities, toStoredRedaction, type StoredRedaction, SOURCE_KINDS, type SourceConfig } from "@dk/detections";
import { tx, type DB } from "./db.ts";
import { Facts } from "./facts.ts";
import { checkInstallScopes, COLLECTION_STATUSES, CONNECTORS } from "./adapters/connectors.ts";
import { atLeast, newToken, sha256, type Role } from "./security.ts";
import { CONTAINMENT_CATALOG, type ContainmentAction } from "./containment.ts";
import { buildPlan, precheck, type ResponsePlan } from "./response-plan.ts";

export interface Principal {
  kind: "token" | "anonymous-demo" | "source";
  id: string;
  name: string;
  role: Role;
  projects: "*" | string[];
  /** Whether the token belongs to a person or to an automated caller (agent, CI). */
  principalType: "human" | "service";
  /** R08.1: the authenticated subject (SSO issuer#subject, an admin-bound person label, or the token itself). */
  subject?: string;
}

export interface ProjectRow { id: string; name: string; dataset_kind: DatasetKind; created_at: string; meta: Record<string, unknown> }

export interface StoreOptions {
  now?: () => Date;
  /** Fault injection for tests: called inside the processing transaction after events are written. */
  faultHook?: (stage: "record" | "after_events" | "after_findings") => void;
  /** Tests only: open a legacy database without running the v0.2 journal minimization. */
  skipLegacyMinimization?: boolean;
  eventWindow?: number;
  /** Containment proposals expire for approval after this many hours (R01.4). Default 72. */
  containmentTtlHours?: number;
  /** R10.2 per-source admission budget (events per rolling minute). Default 6000. */
  sourceBudgetPerMinute?: number;
}

const J = <T>(s: string | null | undefined, fallback: T): T => (s ? (JSON.parse(s) as T) : fallback);

export class Store {
  private indexCache = new Map<string, { revision: string; index: GraphIndex; graph: Graph }>();
  readonly now: () => Date;
  /** Bitemporal entities and assertions (R01.1). */
  readonly facts: Facts;

  constructor(readonly db: DB, private readonly opts: StoreOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.facts = new Facts(db, this.now);
    if (!opts.skipLegacyMinimization) this.minimizeLegacyJournal();
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
      this.saveScene(projectId, scene, proposal, previous, "graph", actor);
      this.facts.recordGraph(projectId, graph, actor, this.iso());
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
      this.saveScene(projectId, scene, proposal as SceneProposal, previous, reflow ? "reflow" : "proposal", actor);
      this.audit(actor, reflow ? "scene.reflow" : "scene.apply", projectId, scene.digest, { source });
      this.emit(projectId, "scene", { digest: scene.digest });
    });
    return scene;
  }

  private saveScene(projectId: string, scene: CompiledScene, proposal: SceneProposal, previous: CompiledScene | undefined, reason: LayoutReason, actor: string) {
    this.db.prepare("INSERT OR REPLACE INTO scenes (project_id, graph_revision, scene, proposal, created_at) VALUES (?, ?, ?, ?, ?)").run(projectId, scene.graph_revision, JSON.stringify(scene), JSON.stringify(proposal), this.iso());
    // LP16-A1: append the layout version with its room-by-room diff (positions only).
    const diff = layoutDiff(previous ?? null, scene);
    if (!previous || previous.digest !== scene.digest || previous.layout_version !== scene.layout_version)
      this.db.prepare("INSERT INTO scene_layouts (project_id, layout_version, graph_revision, scene_digest, reason, diff, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(projectId, scene.layout_version ?? 1, scene.graph_revision, scene.digest, reason, JSON.stringify(diff), actor, this.iso());
  }

  /** LP16-A1: the append-only layout history, newest first. */
  layoutHistory(projectId: string, limit = 50) {
    return (this.db.prepare("SELECT layout_version, graph_revision, scene_digest, reason, diff, created_by, created_at FROM scene_layouts WHERE project_id = ? ORDER BY id DESC LIMIT ?").all(projectId, Math.max(1, Math.min(200, limit))) as { layout_version: number; graph_revision: string; scene_digest: string; reason: string; diff: string; created_by: string; created_at: string }[])
      .map((r) => { const d = JSON.parse(r.diff) as ReturnType<typeof layoutDiff>; return { ...r, diff: { ...d, moved_count: d.moved.length } }; });
  }

  // ---------------- sources ----------------

  upsertSource(projectId: string, cfg: SourceConfig & { kind?: string; dataset_kind?: DatasetKind; connector_id?: string; granted_scopes?: string[] }, actor: string, opts: { expectedRevision?: number; requirePrecondition?: boolean } = {}): { id: string; key: string; config_revision: number } {
    const proj = this.mustProject(projectId);
    if (!cfg.asset_ids?.length) throw new HttpError(400, "a source must be assigned at least one asset (asset_ids)");
    if (cfg.kind && !SOURCE_KINDS.includes(cfg.kind)) throw new HttpError(400, `unknown source kind ${cfg.kind} (known: ${SOURCE_KINDS.join(", ")})`);
    if (cfg.allowed_actions?.some((a) => !EVENT_ACTIONS.includes(a))) throw new HttpError(400, "allowed_actions contains an unknown action");
    const graph = this.getGraph(projectId);
    if (graph) { const unknown = cfg.asset_ids.filter((a) => !graph.assets.some((x) => x.id === a)); if (unknown.length) throw new HttpError(422, `unknown asset ids: ${unknown.join(", ")}`); }
    if (cfg.dataset_kind && cfg.dataset_kind !== proj.dataset_kind) throw new HttpError(422, `a ${cfg.dataset_kind} source cannot write to a ${proj.dataset_kind} project`);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(cfg.id)) throw new HttpError(400, "invalid source id");
    for (const f of ["identity_namespace", "run_namespace"] as const) { const err = validateNamespace(cfg[f]); if (err) throw new HttpError(400, `${f}: ${err}`); }
    if (cfg.sampling_ratio !== undefined && !(typeof cfg.sampling_ratio === "number" && cfg.sampling_ratio > 0 && cfg.sampling_ratio <= 1)) throw new HttpError(400, "sampling_ratio must be a number in (0, 1]");
    if (cfg.retention_days !== undefined && !(Number.isInteger(cfg.retention_days) && cfg.retention_days > 0 && cfg.retention_days <= 36500)) throw new HttpError(400, "retention_days must be a positive integer");
    if (cfg.outcomes_reported !== undefined && (!Array.isArray(cfg.outcomes_reported) || !cfg.outcomes_reported.length || cfg.outcomes_reported.some((o) => !EVENT_OUTCOMES.includes(o as never)))) throw new HttpError(400, `outcomes_reported must be a non-empty list of: ${EVENT_OUTCOMES.join(", ")}`);
    // R02.1: a source is bound to a connector manifest; scopes must be its read scopes, never administrative.
    const connector = CONNECTORS.find((c) => c.id === (cfg.connector_id ?? "dk.events.http"));
    if (!connector) throw new HttpError(400, `unknown connector ${cfg.connector_id} (known: ${CONNECTORS.map((c) => c.id).join(", ")})`);
    if (!connector.source_kinds.includes(cfg.kind ?? "generic")) throw new HttpError(422, `connector ${connector.id} does not support source kind ${cfg.kind ?? "generic"}`);
    const scopes = checkInstallScopes(connector, cfg.granted_scopes);
    if (scopes.problems.length) throw new HttpError(422, "requested scopes are not allowed", scopes.problems);
    const existing = this.db.prepare("SELECT config_revision, disabled FROM sources WHERE project_id = ? AND id = ?").get(projectId, cfg.id) as { config_revision: number; disabled: number } | undefined;
    if (existing && opts.requirePrecondition && opts.expectedRevision === undefined) throw new HttpError(428, `source ${cfg.id} exists: expected_revision is required to change it`, [`current config_revision is ${existing.config_revision}`], { current: { config_revision: Number(existing.config_revision) } });
    if (existing && opts.expectedRevision !== undefined && opts.expectedRevision !== Number(existing.config_revision)) throw new HttpError(409, `source ${cfg.id} was changed since revision ${opts.expectedRevision}`, ["review the current configuration and its history, then resubmit"], { current: { config_revision: Number(existing.config_revision) }, history: this.sourceHistory(projectId, cfg.id).filter((h) => h.revision > opts.expectedRevision!) });
    if (!existing && opts.expectedRevision !== undefined && opts.expectedRevision !== 0) throw new HttpError(409, `source ${cfg.id} does not exist (expected_revision must be 0 or omitted to create it)`);
    const revision = existing ? Number(existing.config_revision) + 1 : 1;
    const key = newToken(proj.dataset_kind === "synthetic" ? "dks_demo" : "dks");
    return tx(this.db, () => {
    this.db.prepare(`INSERT INTO sources (id, project_id, label, kind, asset_ids, trusts_request_ids, stale_after_seconds, key_hash, created_at, allowed_actions, independence_group, identity_namespace, run_namespace) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (project_id, id) DO UPDATE SET label = excluded.label, kind = excluded.kind, asset_ids = excluded.asset_ids, trusts_request_ids = excluded.trusts_request_ids, stale_after_seconds = excluded.stale_after_seconds, key_hash = excluded.key_hash, allowed_actions = excluded.allowed_actions, independence_group = excluded.independence_group, identity_namespace = excluded.identity_namespace, run_namespace = excluded.run_namespace`)
      .run(cfg.id, projectId, cfg.label.slice(0, 120), cfg.kind ?? "generic", JSON.stringify(cfg.asset_ids), cfg.trusts_request_ids ? 1 : 0, cfg.stale_after_seconds ?? null, sha256(key), this.iso(), cfg.allowed_actions?.length ? JSON.stringify(cfg.allowed_actions) : null, cfg.independence_group ?? null, cfg.identity_namespace ?? null, cfg.run_namespace ?? null);
    this.db.prepare("UPDATE sources SET config_revision = ?, sampling_ratio = ?, retention_days = ?, outcomes_reported = ?, connector_id = ?, granted_scopes = ? WHERE project_id = ? AND id = ?").run(revision, cfg.sampling_ratio ?? null, cfg.retention_days ?? null, cfg.outcomes_reported ? JSON.stringify(cfg.outcomes_reported) : null, connector.id, JSON.stringify(scopes.granted), projectId, cfg.id);
    this.recordSourceRevision(projectId, cfg.id, revision, actor, existing ? "updated (key rotated)" : "created", this.iso());
    this.audit(actor, "source.key_issued", projectId, cfg.id, { kind: cfg.kind ?? "generic", config_revision: revision });
    return { id: cfg.id, key, config_revision: revision };
    });
  }

  /**
   * A collector's own account of a collection window (R02.1): complete, partial pagination, permission denied,
   * throttled, scope revoked or error. Idempotent per report_id, so replays do not double count. Historical
   * coverage treats any window that was not complete as partial or unknown.
   */
  recordCollectionReport(projectId: string, sourceId: string, body: Record<string, unknown>) {
    const iso = (v: unknown) => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) && /T.*(Z|[+-]\d{2}:?\d{2})$/.test(v);
    const id = body.report_id;
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id)) throw new HttpError(400, "report_id: 1-128 safe characters");
    if (!iso(body.window_start) || !iso(body.window_end)) throw new HttpError(400, "window_start and window_end must be ISO 8601 with an offset");
    const ws = new Date(Date.parse(body.window_start as string)).toISOString(), we = new Date(Date.parse(body.window_end as string)).toISOString();
    if (we <= ws) throw new HttpError(400, "window_end must be later than window_start");
    if (Date.parse(we) > this.now().getTime() + 60_000) throw new HttpError(400, "window_end cannot be in the future");
    if (!COLLECTION_STATUSES.includes(body.status as never)) throw new HttpError(400, `status must be one of ${COLLECTION_STATUSES.join(", ")}`);
    const detail = { ...(typeof body.detail === "string" ? { detail: redactString(body.detail.slice(0, 500)) } : {}), ...(Number.isInteger(body.pages_fetched) ? { pages_fetched: body.pages_fetched } : {}), ...(typeof body.cursor === "string" ? { cursor_present: true } : {}) };
    const r = this.db.prepare("INSERT OR IGNORE INTO collection_reports (project_id, source_id, report_id, window_start, window_end, status, detail, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(projectId, sourceId, id, ws, we, body.status as string, canonicalJson(detail), this.iso());
    return { report_id: id, duplicate: Number(r.changes) === 0, status: body.status, window: { start: ws, end: we } };
  }

  collectionReports(projectId: string, sourceId: string, from: string, to: string) {
    return this.db.prepare("SELECT report_id, window_start, window_end, status, detail, received_at FROM collection_reports WHERE project_id = ? AND source_id = ? AND window_end > ? AND window_start < ? ORDER BY window_start").all(projectId, sourceId, from, to) as { report_id: string; window_start: string; window_end: string; status: string; detail: string; received_at: string }[];
  }

  /** Snapshot the source's current configuration (never its key) as a revision with an effective time (R01.2/R01.4). */
  private recordSourceRevision(projectId: string, sourceId: string, revision: number, actor: string, reason: string, effectiveAt: string) {
    const cfg = this.listSources(projectId).find((x) => x.id === sourceId)!;
    this.db.prepare("INSERT INTO source_revisions (project_id, source_id, revision, config, actor, reason, recorded_at, effective_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(projectId, sourceId, revision, canonicalJson(cfg), actor, reason.slice(0, 300), this.iso(), effectiveAt);
  }

  sourceHistory(projectId: string, sourceId: string) {
    return (this.db.prepare("SELECT revision, config, actor, reason, recorded_at, effective_at FROM source_revisions WHERE project_id = ? AND source_id = ? ORDER BY revision").all(projectId, sourceId) as { revision: number; config: string; actor: string; reason: string; recorded_at: string; effective_at: string }[])
      .map((r) => ({ revision: r.revision, config: JSON.parse(r.config) as SourceConfig & { disabled: boolean; kind: string }, actor: r.actor, reason: r.reason, recorded_at: r.recorded_at, effective_at: r.effective_at }));
  }

  /**
   * Administrative enable/disable with a precondition and an effective time (R01.2/R01.4). `effectiveAt` may be
   * in the past (recording a known outage window late) but never in the future; the recording time is kept
   * separately, so what was known earlier is not rewritten.
   */
  setSourceState(projectId: string, sourceId: string, disabled: boolean, actor: string, opts: { expectedRevision: number; reason: string; effectiveAt?: string }) {
    return tx(this.db, () => {
      const cur = this.db.prepare("SELECT config_revision, disabled FROM sources WHERE project_id = ? AND id = ?").get(projectId, sourceId) as { config_revision: number; disabled: number } | undefined;
      if (!cur) throw new HttpError(404, "source not found");
      if (opts.expectedRevision !== Number(cur.config_revision)) throw new HttpError(409, `source ${sourceId} was changed since revision ${opts.expectedRevision}`, [], { current: { config_revision: Number(cur.config_revision), disabled: cur.disabled === 1 }, history: this.sourceHistory(projectId, sourceId).filter((h) => h.revision > opts.expectedRevision) });
      const effective = opts.effectiveAt ?? this.iso();
      if (Date.parse(effective) > this.now().getTime() + 1000) throw new HttpError(400, "effective_at cannot be in the future");
      const revision = Number(cur.config_revision) + 1;
      this.db.prepare("UPDATE sources SET disabled = ?, config_revision = ? WHERE project_id = ? AND id = ?").run(disabled ? 1 : 0, revision, projectId, sourceId);
      this.recordSourceRevision(projectId, sourceId, revision, actor, `${disabled ? "disabled" : "enabled"}: ${opts.reason}`, new Date(Date.parse(effective)).toISOString());
      this.audit(actor, disabled ? "source.disabled" : "source.enabled", projectId, sourceId, { config_revision: revision, effective_at: effective, reason: opts.reason.slice(0, 300) });
      this.emit(projectId, "source", { id: sourceId, disabled, config_revision: revision });
      return { id: sourceId, disabled, config_revision: revision, effective_at: new Date(Date.parse(effective)).toISOString() };
    });
  }

  listSources(projectId: string): (SourceConfig & { kind: string; disabled: boolean; config_revision: number; created_at: string; connector_id: string; granted_scopes: string[] })[] {
    return (this.db.prepare("SELECT * FROM sources WHERE project_id = ? ORDER BY id").all(projectId) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id), label: String(r.label), kind: String(r.kind), asset_ids: J(String(r.asset_ids), [] as string[]),
      trusts_request_ids: r.trusts_request_ids === 1, ...(r.stale_after_seconds ? { stale_after_seconds: Number(r.stale_after_seconds) } : {}), disabled: r.disabled === 1,
      config_revision: Number(r.config_revision ?? 1),
      ...(r.allowed_actions ? { allowed_actions: J(String(r.allowed_actions), [] as EventAction[]) } : {}),
      ...(r.independence_group ? { independence_group: String(r.independence_group) } : {}),
      ...(r.identity_namespace ? { identity_namespace: String(r.identity_namespace) } : {}),
      ...(r.run_namespace ? { run_namespace: String(r.run_namespace) } : {}),
      ...(r.sampling_ratio !== null && r.sampling_ratio !== undefined ? { sampling_ratio: Number(r.sampling_ratio) } : {}),
      ...(r.retention_days ? { retention_days: Number(r.retention_days) } : {}),
      ...(r.outcomes_reported ? { outcomes_reported: J(String(r.outcomes_reported), [] as string[]) } : {}),
      connector_id: r.connector_id ? String(r.connector_id) : "dk.events.http",
      granted_scopes: J(r.granted_scopes ? String(r.granted_scopes) : null, ["source-key:ingest"]),
      created_at: String(r.created_at),
    }));
  }

  /** Receive-time authorization of a source's assertion (assets resolved via the graph; categories by kind/grant). */
  checkCapability(projectId: string, sourceId: string, e: IngestEvent): { reason: string; detail: string } | null {
    const src = this.listSources(projectId).find((s) => s.id === sourceId);
    if (!src) return { reason: "unknown_source", detail: "source is not registered" };
    const ix = this.index(projectId);
    const resolved = ix ? e.asset_ids.map((a) => ix.index.resolve(a)).filter((x): x is string => !!x) : [];
    return checkCapability(sourceCapabilities(src), sourceId, e.action, resolved);
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
    // Minimize + redact BEFORE the first durable write. The raw payload never reaches disk.
    const m = minimizeIngest(payload);
    if (!m.ok) { this.reject(projectId, sourceId, "receive", "schema", m.detail); return { status: "rejected", reason: "schema", detail: safeDetail(m.detail) }; }
    const cap = this.checkCapability(projectId, sourceId, m.event);
    if (cap) { this.reject(projectId, sourceId, "receive", cap.reason, cap.detail); return { status: "rejected", reason: cap.reason, detail: safeDetail(cap.detail) }; }
    const p = m.event;
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
      const r = this.db.prepare("INSERT INTO journal (project_id, source_id, source_event_id, payload, received_at, meta, minimized) VALUES (?, ?, ?, ?, ?, ?, 1)").run(projectId, sourceId, p.source_event_id, JSON.stringify(p), receivedAtOverride ?? this.iso(), JSON.stringify({ redaction: toStoredRedaction(m.redaction) }));
      this.count(projectId, sourceId, "accepted");
      return { status: "accepted" as const, seq: Number(r.lastInsertRowid) };
    });
  }

  reject(projectId: string, sourceId: string, stage: string, reason: string, detail: string) {
    tx(this.db, () => {
      this.db.prepare("INSERT INTO rejections (project_id, source_id, stage, reason, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(projectId, sourceId, stage, reason, safeDetail(detail), this.iso());
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

  private admission = new Map<string, { windowStart: number; used: number; throttled: number }>();
  /**
   * R10.2 per-source admission control: each source gets its own rolling-minute budget, so one noisy source is
   * throttled (and its loss counted as rejected:throttled) instead of filling the journal ahead of everyone else.
   */
  admit(projectId: string, sourceId: string): boolean {
    const key = `${projectId}\u0000${sourceId}`, now = this.now().getTime();
    const budget = this.opts.sourceBudgetPerMinute ?? 6000;
    let a = this.admission.get(key);
    if (!a || now - a.windowStart >= 60_000) { if (a?.throttled) this.reject(projectId, sourceId, "receive", "throttled", `${a.throttled} event(s) refused in the previous minute: source budget ${budget}/min`); a = { windowStart: now, used: 0, throttled: 0 }; this.admission.set(key, a); }
    if (a.used >= budget) { a.throttled++; this.count(projectId, sourceId, "rejected:throttled"); return false; }
    a.used++;
    return true;
  }

  backlog(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM journal WHERE seq > ?").get(this.checkpoint()) as { n: number }).n);
  }

  /**
   * Process up to `limit` journal rows in ONE transaction: normalize, insert events, re-evaluate findings
   * for affected projects, publish outbox messages, advance the checkpoint. A crash anywhere rolls the
   * whole batch back, and the next run reprocesses it idempotently (event ids are deterministic).
   */
  /**
   * Process the next batch of journal entries in one transaction. A record that fails DETERMINISTICALLY
   * (malformed content, a processing bug) is rolled back to its own savepoint, quarantined and counted, so
   * good records behind it still make progress. Database/infrastructure errors are not swallowed: the whole
   * batch rolls back, the checkpoint does not move, and the worker retries.
   */
  processBatch(limit = 200): { processed: number; projects: string[]; quarantined: number } {
    const from = this.checkpoint();
    const rows = this.db.prepare("SELECT * FROM journal WHERE seq > ? ORDER BY seq LIMIT ?").all(from, limit) as { seq: number; project_id: string; source_id: string; source_event_id: string; payload: string; received_at: string; meta: string | null }[];
    if (!rows.length) return { processed: 0, projects: [], quarantined: 0 };
    const touched = new Set<string>();
    let quarantined = 0;
    tx(this.db, () => {
      for (const row of rows) {
        this.db.exec("SAVEPOINT rec");
        try {
          this.opts.faultHook?.("record");
          if (this.processRecord(row)) touched.add(row.project_id);
          this.db.exec("RELEASE rec");
        } catch (err) {
          this.db.exec("ROLLBACK TO rec"); this.db.exec("RELEASE rec");
          if (isInfrastructureError(err)) throw err;
          const msg = safeDetail(String((err as Error)?.message ?? err)).slice(0, 300);
          this.db.prepare("INSERT OR REPLACE INTO quarantine (journal_seq, project_id, source_id, source_event_id, error, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(row.seq, row.project_id, row.source_id, row.source_event_id, msg, this.iso());
          this.db.prepare("INSERT INTO rejections (project_id, source_id, stage, reason, detail, created_at) VALUES (?, ?, 'process', 'quarantined', ?, ?)").run(row.project_id, row.source_id, safeDetail(`journal seq ${row.seq}: ${msg}`), this.iso());
          this.count(row.project_id, row.source_id, "rejected:quarantined");
          this.audit("system", "journal.quarantine", row.project_id, String(row.seq), { error: msg });
          quarantined++;
        }
      }
      this.opts.faultHook?.("after_events");
      for (const p of touched) this.evaluateInTx(p);
      this.opts.faultHook?.("after_findings");
      this.db.prepare("INSERT INTO checkpoints (name, last_seq) VALUES ('normalizer', ?) ON CONFLICT (name) DO UPDATE SET last_seq = excluded.last_seq").run(rows[rows.length - 1]!.seq);
    });
    return { processed: rows.length, projects: [...touched], quarantined };
  }

  private processRecord(row: { seq: number; project_id: string; source_id: string; payload: string; received_at: string; meta: string | null }): boolean {
    const ix = this.index(row.project_id);
    const proj = this.getProject(row.project_id);
    const src = this.listSources(row.project_id).find((s) => s.id === row.source_id);
    if (!ix || !proj || !src) { this.rejectInTx(row.project_id, row.source_id, "unmapped_asset", "project has no graph or source was removed"); return false; }
    const meta = row.meta ? (JSON.parse(row.meta) as { redaction?: unknown }) : {};
    const r = normalizeIngest(JSON.parse(row.payload), { projectId: row.project_id, sourceId: row.source_id, datasetKind: proj.dataset_kind, receivedAt: row.received_at, trustsRequestIds: !!src.trusts_request_ids, index: ix.index, capabilities: sourceCapabilities(src), priorRedaction: meta?.redaction });
    if (!r.ok) { this.rejectInTx(row.project_id, row.source_id, r.reason, r.detail); return false; }
    const e = r.event;
    const ins = this.db.prepare("INSERT OR IGNORE INTO events (id, seq, project_id, source_id, occurred_at, received_at, action, outcome, asset_ids, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(e.id, row.seq, e.project_id, e.source_id, e.occurred_at, e.received_at, e.action, e.outcome, JSON.stringify(e.asset_ids), JSON.stringify(e));
    if (r.evidence) this.db.prepare("INSERT OR IGNORE INTO evidence (ref, project_id, event_id, body, redacted, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(`evidence:${e.id}`, e.project_id, e.id, JSON.stringify(r.evidence), r.evidence.redacted ? 1 : 0, this.iso());
    if (Number(ins.changes) > 0) this.emit(e.project_id, "event", { id: e.id, asset_ids: e.asset_ids, action: e.action, outcome: e.outcome, occurred_at: e.occurred_at, source_id: e.source_id });
    return true;
  }

  listQuarantine(projectId: string) {
    return this.db.prepare("SELECT journal_seq, source_id, source_event_id, error, created_at FROM quarantine WHERE project_id = ? ORDER BY journal_seq DESC LIMIT 500").all(projectId);
  }

  /**
   * Upgrade path for databases written by v0.2, which journaled raw payloads. Re-minimizes every legacy
   * journal row in place (same seq, same source_event_id, so deduplication and the checkpoint are
   * unchanged). A row that no longer validates is replaced by a tombstone and quarantined if still pending.
   * secure_delete overwrites the freed content, and the WAL is checkpointed and truncated afterwards.
   * This cannot reach copies outside this database file (backups, snapshots, old disks).
   */
  minimizeLegacyJournal(): { rewritten: number; tombstoned: number } {
    const rows = this.db.prepare("SELECT seq, payload FROM journal WHERE minimized = 0").all() as { seq: number; payload: string }[];
    if (!rows.length) return { rewritten: 0, tombstoned: 0 };
    let rewritten = 0, tombstoned = 0;
    tx(this.db, () => {
      for (const r of rows) {
        let parsed: unknown = null;
        try { parsed = JSON.parse(r.payload); } catch { /* tombstone */ }
        const conv = convertLegacyPayload(parsed);
        const m = conv ? minimizeIngest(conv.payload) : { ok: false as const, detail: "unparseable" };
        if (m.ok && conv) {
          const redaction = toStoredRedaction({ removedKeys: [...conv.historical.removed_keys, ...m.redaction.removedKeys], maskedValues: conv.historical.masked_values + m.redaction.maskedValues, truncated: false });
          const meta = { redaction, legacy: true, ...(conv.format ? { legacy_format: conv.format, legacy_redaction_note: "carried from the pre-0.3.1 payload; type-checked, not independently verified" } : {}) };
          this.db.prepare("UPDATE journal SET payload = ?, meta = ?, minimized = 1 WHERE seq = ?").run(JSON.stringify(m.event), JSON.stringify(meta), r.seq);
          rewritten++;
        } else {
          this.db.prepare("UPDATE journal SET payload = ?, meta = ?, minimized = 2 WHERE seq = ?").run(JSON.stringify({ _tombstone: true }), JSON.stringify({ legacy: true, tombstone: ("detail" in m ? m.detail : "unconvertible").slice(0, 200) }), r.seq);
          tombstoned++;
        }
      }
      this.audit("system", "journal.legacy_minimized", null, null, { rewritten, tombstoned });
    });
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return { rewritten, tombstoned };
  }

  private rejectInTx(projectId: string, sourceId: string, reason: string, detail: string) {
    this.db.prepare("INSERT INTO rejections (project_id, source_id, stage, reason, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(projectId, sourceId, "normalize", reason, safeDetail(detail), this.iso());
    this.count(projectId, sourceId, `rejected:${reason}`);
  }

  /** Re-evaluate coverage staleness on a timer (silence is a signal too). */
  evaluateProject(projectId: string) { tx(this.db, () => this.evaluateInTx(projectId)); }

  private evaluateInTx(projectId: string) {
    const ix = this.index(projectId);
    const proj = this.getProject(projectId);
    if (!ix || !proj) return;
    const events = this.listEvents(projectId, { limit: this.opts.eventWindow ?? 50_000 });
    const result = evaluate(ix.graph, events, { sources: this.listSources(projectId), sourceState: this.sourceState(projectId), ...(proj.dataset_kind === "live" ? { now: this.iso() } : {}) });
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

  /**
   * Route observations over stored events (R00.3), independent of the evaluation window: which assets
   * recorded a matching route and how often. Bounded to the newest `scanLimit` routed events.
   */
  routeObservations(projectId: string, matches: (route: string) => boolean, scanLimit = 200_000): { byAsset: Map<string, number>; eventIds: string[]; scanned: number; limited: boolean } {
    const rows = this.db.prepare("SELECT id, asset_ids, json_extract(body, '$.route') AS route FROM events WHERE project_id = ? AND json_extract(body, '$.route') IS NOT NULL ORDER BY seq DESC LIMIT ?").all(projectId, scanLimit + 1) as { id: string; asset_ids: string; route: string }[];
    const limited = rows.length > scanLimit;
    const byAsset = new Map<string, number>();
    const eventIds: string[] = [];
    for (const r of rows.slice(0, scanLimit)) {
      if (!matches(String(r.route).split(/[?#]/, 1)[0]!)) continue;
      if (eventIds.length < 5000) eventIds.push(r.id);
      for (const a of J(r.asset_ids, [] as string[])) byAsset.set(a, (byAsset.get(a) ?? 0) + 1);
    }
    return { byAsset, eventIds, scanned: Math.min(rows.length, scanLimit), limited };
  }

  /** Last receipt, last occurrence and last health report per source over ALL stored events (R01.2). */
  sourceState(projectId: string): Record<string, SourceState> {
    // R01.5: one index seek per declared source (events_source_received / events_source_time / events_source_action)
    // instead of aggregating every stored event on each request.
    const out: Record<string, SourceState> = {};
    const lastRecv = this.db.prepare("SELECT MAX(received_at) AS r FROM events WHERE project_id = ? AND source_id = ?");
    const lastOcc = this.db.prepare("SELECT MAX(occurred_at) AS o FROM events WHERE project_id = ? AND source_id = ?");
    // one equality seek per health action on events_source_action (an IN list made SQLite sort a whole source)
    const healthOf = this.db.prepare("SELECT id, action, occurred_at, received_at, json_extract(body, '$.coverage_note') AS note FROM events INDEXED BY events_source_action WHERE project_id = ? AND source_id = ? AND action = ? ORDER BY occurred_at DESC, received_at DESC LIMIT 1");
    type H = { id: string; action: "sensor_unavailable" | "sensor_restored"; occurred_at: string; received_at: string; note: string | null };
    const health = { get: (p: string, src: string): H | undefined => {
      const a = healthOf.get(p, src, "sensor_unavailable") as H | undefined, b = healthOf.get(p, src, "sensor_restored") as H | undefined;
      if (!a || !b) return a ?? b;
      return a.occurred_at > b.occurred_at || (a.occurred_at === b.occurred_at && a.received_at > b.received_at) ? a : b;
    } };
    for (const { id } of this.db.prepare("SELECT id FROM sources WHERE project_id = ?").all(projectId) as { id: string }[]) {
      const r = (lastRecv.get(projectId, id) as { r: string | null }).r;
      if (!r) continue;
      const st: SourceState = { last_received_at: r, last_occurred_at: (lastOcc.get(projectId, id) as { o: string }).o };
      const h = health.get(projectId, id);
      if (h) st.last_health = { id: h.id, action: h.action, occurred_at: h.occurred_at, ...(h.note ? { coverage_note: h.note } : {}) };
      out[id] = st;
    }
    return out;
  }

  /** Exact, project-scoped lookup by event id (chunked), independent of any recency window. */
  eventsByIds(projectId: string, ids: string[]): SecurityEvent[] {
    const out: SecurityEvent[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = this.db.prepare(`SELECT body FROM events WHERE project_id = ? AND id IN (${chunk.map(() => "?").join(",")})`).all(projectId, ...chunk) as { body: string }[];
      out.push(...rows.map((r) => JSON.parse(r.body) as SecurityEvent));
    }
    return out.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id));
  }

  /**
   * A finding's complete supporting record, paginated by its own event references. Always reports what
   * was expected, what was returned, and what is missing, so a partial bundle can never look complete.
   */
  findingEvidence(projectId: string, findingId: string, offset = 0, limit = 200) {
    const d = this.getFinding(projectId, findingId);
    if (!d) throw new HttpError(404, "finding not found");
    const lim = Math.min(Math.max(limit, 1), 500);
    const counter = new Set(d.finding.counterevidence_event_ids);
    const allIds = [...new Set([...d.finding.event_ids, ...d.finding.counterevidence_event_ids])];
    const pageIds = allIds.slice(offset, offset + lim);
    const events = this.eventsByIds(projectId, pageIds);
    const found = new Set(events.map((e) => e.id));
    const refs = [...new Set(events.flatMap((e) => e.evidence_refs))];
    const storedRefs = refs.filter((r) => r.startsWith("evidence:"));
    const evidence: Record<string, Record<string, unknown>> = {};
    const missingEvidence: string[] = [];
    for (const r of storedRefs) { const e = this.getEvidence(projectId, r); if (e) evidence[r] = e; else missingEvidence.push(r); }
    const next = offset + lim < allIds.length ? offset + lim : null;
    return {
      finding_id: findingId,
      expected_event_count: allIds.length,
      offset, limit: lim,
      returned_event_count: events.length,
      events: events.map((e) => ({ ...e, role: counter.has(e.id) ? "counterevidence" : "supporting" })),
      missing_event_ids: pageIds.filter((id) => !found.has(id)),
      expected_evidence_records: storedRefs.length,
      evidence,
      missing_evidence_refs: missingEvidence,
      reference_only_refs: refs.filter((r) => !r.startsWith("evidence:")),
      next_offset: next,
      complete: next === null && events.length === pageIds.length && missingEvidence.length === 0 && offset === 0,
    };
  }

  getEvidence(projectId: string, ref: string): Record<string, unknown> | undefined {
    const r = this.db.prepare("SELECT body FROM evidence WHERE project_id = ? AND ref = ?").get(projectId, ref) as { body: string } | undefined;
    return r ? JSON.parse(r.body) : undefined;
  }

  evidenceFor(projectId: string, refs: string[]): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const ref of refs) { if (!ref.startsWith("evidence:")) continue; const e = this.getEvidence(projectId, ref); if (e) out[ref] = e; }
    return out;
  }

  listFindings(projectId: string): Finding[] {
    return (this.db.prepare("SELECT body, lifecycle, disposition, state_version FROM findings WHERE project_id = ?").all(projectId) as { body: string; lifecycle: Finding["lifecycle"]; disposition: Finding["disposition"]; state_version: number }[])
      .map((r) => ({ ...(JSON.parse(r.body) as Finding), lifecycle: r.lifecycle, disposition: r.disposition, state_version: Number(r.state_version) }))
      .sort((a, b) => a.first_seen.localeCompare(b.first_seen) || a.id.localeCompare(b.id));
  }

  /**
   * A finding with its revision history and analyst annotations. Annotations are CURRENT by default and say so
   * (`annotations.basis`). With `asOf`, notes recorded after that instant are excluded and the analyst state is
   * reconstructed from the recorded state changes, so historical replay never presents current notes as
   * historical ones (R01.4).
   */
  getFinding(projectId: string, id: string, opts: { asOf?: string } = {}) {
    const f = this.listFindings(projectId).find((x) => x.id === id);
    if (!f) return undefined;
    const revisions = (this.db.prepare("SELECT revision, reason, created_at, body FROM finding_revisions WHERE project_id = ? AND finding_id = ? ORDER BY revision").all(projectId, id) as { revision: number; reason: string; created_at: string; body: string }[])
      .map((r) => ({ revision: r.revision, reason: r.reason, created_at: r.created_at, event_count: (JSON.parse(r.body) as Finding).event_count, evidence_level: (JSON.parse(r.body) as Finding).evidence_level }));
    const allNotes = this.db.prepare("SELECT author, note, created_at FROM analyst_notes WHERE project_id = ? AND finding_id = ? ORDER BY id").all(projectId, id) as { author: string; note: string; created_at: string }[];
    const changes = this.stateChanges(projectId, "finding", id);
    if (!opts.asOf) {
      return { finding: f, revisions, notes: allNotes, state_changes: changes, annotations: { basis: "current" as const, note: "Notes, lifecycle and disposition are current annotations, not a reconstruction of any earlier moment." } };
    }
    const t = Date.parse(opts.asOf);
    const notes = allNotes.filter((n) => Date.parse(n.created_at) <= t);
    const before = changes.filter((c) => Date.parse(c.at) <= t).at(-1);
    const state = before ? (before.after as { lifecycle: string; disposition: string }) : (changes[0]?.before as { lifecycle: string; disposition: string } | undefined) ?? { lifecycle: f.lifecycle, disposition: f.disposition };
    return {
      finding: f, revisions, notes, state_changes: changes.filter((c) => Date.parse(c.at) <= t),
      annotations: { basis: "as_of" as const, as_of: new Date(t).toISOString(), lifecycle: state.lifecycle, disposition: state.disposition, excluded_later_notes: allNotes.length - notes.length,
        note: "Notes and analyst state as recorded at as_of. The finding body is the current revision; use the revision list for evidence history." },
    };
  }

  stateChanges(projectId: string, subjectType: string, subjectId: string) {
    return (this.db.prepare("SELECT version, actor, before, after, reason, at FROM state_changes WHERE project_id = ? AND subject_type = ? AND subject_id = ? ORDER BY id").all(projectId, subjectType, subjectId) as { version: number; actor: string; before: string; after: string; reason: string | null; at: string }[])
      .map((r) => ({ version: r.version, actor: r.actor, before: JSON.parse(r.before) as Record<string, unknown>, after: JSON.parse(r.after) as Record<string, unknown>, reason: r.reason, at: r.at }));
  }

  private recordChange(projectId: string, subjectType: string, subjectId: string, version: number, actor: string, before: unknown, after: unknown, reason?: string) {
    this.db.prepare("INSERT INTO state_changes (project_id, subject_type, subject_id, version, actor, before, after, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(projectId, subjectType, subjectId, version, actor, canonicalJson(before), canonicalJson(after), reason ?? null, this.iso());
  }

  /**
   * Analyst review with an optimistic-concurrency precondition (R01.4). Changing lifecycle or disposition
   * requires `expected_state_version`; a stale version gets 409 with the current state and the changes made
   * since, never a silent last-writer-wins. Appending a note alone needs no precondition (notes never overwrite).
   */
  setDisposition(projectId: string, id: string, actor: string, d: { lifecycle?: Finding["lifecycle"]; disposition?: Finding["disposition"]; note?: string; expected_state_version?: number }) {
    return tx(this.db, () => {
      const cur = this.db.prepare("SELECT lifecycle, disposition, state_version FROM findings WHERE project_id = ? AND id = ?").get(projectId, id) as { lifecycle: string; disposition: string; state_version: number } | undefined;
      if (!cur) throw new HttpError(404, "finding not found");
      const changesState = (d.lifecycle !== undefined && d.lifecycle !== cur.lifecycle) || (d.disposition !== undefined && d.disposition !== cur.disposition);
      if (d.lifecycle !== undefined || d.disposition !== undefined) {
        if (d.expected_state_version === undefined) throw new HttpError(428, "expected_state_version is required to change lifecycle or disposition", [`current state_version is ${cur.state_version}; reload the finding and resend with it`], { current: { lifecycle: cur.lifecycle, disposition: cur.disposition, state_version: Number(cur.state_version) } });
        if (d.expected_state_version !== Number(cur.state_version)) {
          throw new HttpError(409, "this finding was reviewed by someone else since you loaded it", ["review the current state and the changes since your version, then resubmit"], {
            current: { lifecycle: cur.lifecycle, disposition: cur.disposition, state_version: Number(cur.state_version) },
            changes_since: this.stateChanges(projectId, "finding", id).filter((c) => c.version > d.expected_state_version!),
          });
        }
      }
      if (changesState) {
        const after = { lifecycle: d.lifecycle ?? cur.lifecycle, disposition: d.disposition ?? cur.disposition };
        const version = Number(cur.state_version) + 1;
        this.db.prepare("UPDATE findings SET lifecycle = ?, disposition = ?, state_version = ? WHERE project_id = ? AND id = ?").run(after.lifecycle, after.disposition, version, projectId, id);
        this.recordChange(projectId, "finding", id, version, actor, { lifecycle: cur.lifecycle, disposition: cur.disposition }, after, d.note?.slice(0, 200));
      }
      if (d.note) this.db.prepare("INSERT INTO analyst_notes (project_id, finding_id, author, note, created_at) VALUES (?, ?, ?, ?, ?)").run(projectId, id, actor, d.note.slice(0, 4000), this.iso());
      this.audit(actor, "finding.disposition", projectId, id, { lifecycle: d.lifecycle, disposition: d.disposition, note: !!d.note, expected_state_version: d.expected_state_version });
      this.emit(projectId, "finding", { id, analyst_update: true });
      return this.getFinding(projectId, id)!;
    });
  }

  evaluation(projectId: string) {
    const ix = this.index(projectId);
    const proj = this.mustProject(projectId);
    if (!ix) return { coverage: [], unobserved_asset_ids: [], ruleset_version: "" };
    // R01.5: current coverage needs only source declarations and per-source state, not a rule run over the
    // event window. This is the same derivation evaluate() uses, at a fraction of the cost per request.
    const coverage = deriveCoverage(ix.graph, [], { sources: this.listSources(projectId), sourceState: this.sourceState(projectId), ...(proj.dataset_kind === "live" ? { now: this.iso() } : {}) });
    const covered = new Set(coverage.flatMap((c) => c.asset_ids));
    return { coverage, unobserved_asset_ids: ix.graph.assets.map((a) => a.id).filter((id) => !covered.has(id)), ruleset_version: RULESET_VERSION };
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

  /** Run `fn` in one SQLite transaction (nested calls join the outer one). */
  transaction<T>(fn: () => T): T { return tx(this.db, fn); }

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

  createToken(name: string, role: Role, projects: "*" | string[] = "*", raw?: string, principalType: "human" | "service" = "human", opts: { expiresAt?: string; oidc?: { issuer: string; subject: string }; subject?: string } = {}): { id: string; token: string; expires_at: string | null } {
    const token = raw ?? newToken(principalType === "service" ? "dks_svc" : "dku");
    const id = "tok_" + sha256(token).slice(0, 12);
    this.db.prepare("INSERT OR IGNORE INTO api_tokens (id, name, role, token_hash, project_ids, created_at, principal_type, expires_at, oidc_issuer, oidc_subject, subject) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, name.slice(0, 80), role, sha256(token), projects === "*" ? "*" : JSON.stringify(projects), this.iso(), principalType, opts.expiresAt ?? null, opts.oidc?.issuer ?? null, opts.oidc?.subject ?? null, opts.subject ?? null);
    return { id, token, expires_at: opts.expiresAt ?? null };
  }

  /**
   * Rotate a token (R10.1): a new secret with the same role, scope, type and remaining policy; the old one is
   * revoked at once (with its sessions) and points at its successor. Audited.
   */
  rotateToken(id: string, actor: string, expiresAt?: string): { id: string; token: string; expires_at: string | null } {
    return tx(this.db, () => {
      const r = this.db.prepare("SELECT * FROM api_tokens WHERE id = ? AND revoked = 0").get(id) as Record<string, string> | undefined;
      if (!r) throw new HttpError(404, "unknown or revoked token");
      if (r.oidc_subject) throw new HttpError(409, "SSO sessions are not rotated; sign in again");
      const projects = r.project_ids === "*" ? "*" as const : J(r.project_ids, [] as string[]);
      const next = this.createToken(`${r.name}`.slice(0, 80), r.role as Role, projects, undefined, (r.principal_type as "human" | "service") ?? "human", { ...(expiresAt ?? r.expires_at ? { expiresAt: expiresAt ?? r.expires_at! } : {}), ...(r.subject ? { subject: r.subject } : {}) });
      this.db.prepare("UPDATE api_tokens SET revoked = 1, rotated_to = ? WHERE id = ?").run(next.id, id);
      this.db.prepare("DELETE FROM sessions WHERE token_id = ?").run(id);
      this.audit(actor, "token.rotate", null, id, { successor: next.id });
      return next;
    });
  }

  /** OIDC subject -> access mapping (R10.1). No mapping, no access. */
  mapOidcSubject(issuer: string, subject: string, name: string, role: Role, projects: "*" | string[], actor: string) {
    this.db.prepare("INSERT INTO oidc_subjects (issuer, subject, name, role, project_ids, created_at, created_by, revoked) VALUES (?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT (issuer, subject) DO UPDATE SET name = excluded.name, role = excluded.role, project_ids = excluded.project_ids, revoked = 0")
      .run(issuer, subject, name.slice(0, 80), role, projects === "*" ? "*" : JSON.stringify(projects), this.iso(), actor);
    // existing SSO sessions pick up the change at their next sign-in; revoke them now so a scope change applies at once
    for (const t of this.db.prepare("SELECT id FROM api_tokens WHERE oidc_issuer = ? AND oidc_subject = ? AND revoked = 0").all(issuer, subject) as { id: string }[]) this.revokeToken(t.id, actor);
    this.audit(actor, "oidc.subject_mapped", null, `${issuer}#${subject}`, { role, projects });
  }

  unmapOidcSubject(issuer: string, subject: string, actor: string) {
    this.db.prepare("UPDATE oidc_subjects SET revoked = 1 WHERE issuer = ? AND subject = ?").run(issuer, subject);
    for (const t of this.db.prepare("SELECT id FROM api_tokens WHERE oidc_issuer = ? AND oidc_subject = ? AND revoked = 0").all(issuer, subject) as { id: string }[]) this.revokeToken(t.id, actor);
    this.audit(actor, "oidc.subject_unmapped", null, `${issuer}#${subject}`, {});
  }

  /** A verified SSO subject's principal: an internal, unusable-secret token row bound to the mapping. */
  oidcPrincipalToken(issuer: string, subject: string): { id: string; name: string; role: Role } {
    const m = this.db.prepare("SELECT * FROM oidc_subjects WHERE issuer = ? AND subject = ? AND revoked = 0").get(issuer, subject) as Record<string, string> | undefined;
    if (!m) throw new HttpError(403, "this identity has no access to Digital Kingdom; ask an administrator to map it");
    const existing = this.db.prepare("SELECT id, name, role FROM api_tokens WHERE oidc_issuer = ? AND oidc_subject = ? AND revoked = 0").get(issuer, subject) as { id: string; name: string; role: Role } | undefined;
    if (existing) return existing;
    const t = this.createToken(`sso:${m.name}`, m.role as Role, m.project_ids === "*" ? "*" : J(m.project_ids, [] as string[]), undefined, "human", { oidc: { issuer, subject } });
    return { id: t.id, name: `sso:${m.name}`, role: m.role as Role };
  }

  hasLiveProjects(): boolean { return !!this.db.prepare("SELECT 1 FROM projects WHERE dataset_kind = 'live' LIMIT 1").get(); }

  /** Token metadata for authorization decisions (never the hash). */
  getTokenMeta(id: string): { id: string; role: Role; projects: "*" | string[]; revoked: boolean; principalType: "human" | "service" } | undefined {
    const r = this.db.prepare("SELECT id, role, project_ids, revoked, principal_type FROM api_tokens WHERE id = ?").get(id) as Record<string, string | number> | undefined;
    if (!r) return undefined;
    return { id: String(r.id), role: r.role as Role, projects: r.project_ids === "*" ? "*" : J(String(r.project_ids), [] as string[]), revoked: r.revoked === 1, principalType: (r.principal_type as "human" | "service") ?? "human" };
  }

  /**
   * Revoke a token immediately (R00.4): its bearer use and every browser session derived from it stop at
   * the next request, including requests that resume an event-search cursor issued while it was valid.
   */
  revokeToken(id: string, actor: string): boolean {
    return tx(this.db, () => {
      const changed = this.db.prepare("UPDATE api_tokens SET revoked = 1 WHERE id = ? AND revoked = 0").run(id).changes > 0;
      this.db.prepare("DELETE FROM sessions WHERE token_id = ?").run(id);
      if (changed) this.audit(actor, "token.revoke", null, id, {});
      return changed;
    });
  }

  hasAdmin(): boolean {
    return !!this.db.prepare("SELECT 1 FROM api_tokens WHERE role = 'admin' AND revoked = 0 LIMIT 1").get();
  }

  authenticateToken(raw: string | undefined): Principal | undefined {
    if (!raw) return undefined;
    const r = this.db.prepare("SELECT * FROM api_tokens WHERE token_hash = ? AND revoked = 0 AND (expires_at IS NULL OR expires_at > ?)").get(sha256(raw), this.iso()) as Record<string, string> | undefined;
    if (!r) return undefined;
    return { kind: "token", id: r.id!, name: r.name!, role: r.role as Role, projects: r.project_ids === "*" ? "*" : J(r.project_ids, [] as string[]), principalType: (r.principal_type as "human" | "service") ?? "human", subject: r.oidc_issuer && r.oidc_subject ? `oidc:${r.oidc_issuer}#${r.oidc_subject}` : r.subject ? `person:${r.subject}` : `token:${r.id}` };
  }

  createSession(tokenId: string, ttlHours = 12): string {
    const sid = newToken("dksess");
    this.db.prepare("INSERT INTO sessions (id_hash, token_id, expires_at) VALUES (?, ?, ?)").run(sha256(sid), tokenId, new Date(this.now().getTime() + ttlHours * 3600_000).toISOString());
    return sid;
  }

  authenticateSession(sid: string | undefined): Principal | undefined {
    if (!sid) return undefined;
    const r = this.db.prepare("SELECT t.* FROM sessions s JOIN api_tokens t ON t.id = s.token_id WHERE s.id_hash = ? AND s.expires_at > ? AND t.revoked = 0 AND (t.expires_at IS NULL OR t.expires_at > ?)").get(sha256(sid), this.iso(), this.iso()) as Record<string, string> | undefined;
    return r ? { kind: "token", id: r.id!, name: r.name!, role: r.role as Role, projects: r.project_ids === "*" ? "*" : J(r.project_ids, [] as string[]), principalType: (r.principal_type as "human" | "service") ?? "human", subject: r.oidc_issuer && r.oidc_subject ? `oidc:${r.oidc_issuer}#${r.oidc_subject}` : r.subject ? `person:${r.subject}` : `token:${r.id}` } : undefined;
  }

  deleteSession(sid: string): string | null {
    const r = this.db.prepare("SELECT token_id FROM sessions WHERE id_hash = ?").get(sha256(sid)) as { token_id: string } | undefined;
    this.db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(sha256(sid));
    return r?.token_id ?? null;
  }

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

  requestContainment(projectId: string, findingId: string, actionId: string, rationale: string, actor: string, requesterType: "human" | "service" = "human", requesterSubject?: string) {
    const f = this.getFinding(projectId, findingId);
    if (!f) throw new HttpError(404, "finding not found");
    const action = this.containmentCatalog(projectId).find((a) => a.id === actionId);
    if (!action) throw new HttpError(422, `containment action ${actionId} is not permitted in this project`);
    const graph = this.getGraph(projectId)!;
    const kinds = new Set(f.finding.affected_asset_ids.map((id) => graph.assets.find((a) => a.id === id)?.kind));
    if (!action.applies_to_kinds.some((k) => kinds.has(k))) throw new HttpError(422, `${actionId} does not apply to the assets in this finding`);
    const id = "cr_" + sha256(`${projectId}:${findingId}:${actionId}:${this.iso()}:${Math.random()}`).slice(0, 16);
    const expires = new Date(this.now().getTime() + (this.opts.containmentTtlHours ?? 72) * 3600_000).toISOString();
    tx(this.db, () => {
      this.db.prepare("INSERT INTO containment_requests (id, project_id, finding_id, action_id, requested_by, rationale, status, created_at, requested_by_type, finding_revision, policy_digest, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)")
        .run(id, projectId, findingId, actionId, actor, rationale.slice(0, 2000), this.iso(), requesterType, f.finding.revision, this.containmentPolicyDigest(projectId, actionId), expires);
      if (requesterSubject) this.db.prepare("UPDATE containment_requests SET requested_subject = ? WHERE id = ?").run(requesterSubject, id);
      this.audit(actor, "containment.requested", projectId, id, { findingId, actionId, subject: requesterSubject ?? null });
      this.emit(projectId, "containment", { id, status: "pending" });
    });
    return this.getContainment(projectId, id)!;
  }

  /**
   * Record a decision. What this proves: a different, HUMAN-typed token decided it. It does not prove two
   * distinct people (one person could hold two tokens); bind tokens to an identity provider before any
   * executor is ever introduced. Service tokens (agents, CI) can request but never decide.
   */
  /**
   * Record a decision (R08.1). Approvals are counted per authenticated SUBJECT, not per token: two tokens bound
   * to the same person, or the same SSO identity, count once. The requester's subject can never approve. Each
   * approval binds the exact plan digest (action, permitted set, approval policy, finding revision) and stops
   * counting when its token is revoked or the plan changes. Service tokens (agents, CI) can request, never decide.
   */
  decideContainment(projectId: string, id: string, decision: "approved" | "rejected", actor: string, principalId: string, principalType: "human" | "service" = "human", subject = `token:${principalId}`) {
    const c = this.getContainment(projectId, id);
    if (!c) throw new HttpError(404, "containment request not found");
    if (c.status !== "pending") throw new HttpError(409, "already decided");
    if (principalType !== "human") throw new HttpError(403, "service tokens cannot decide containment requests");
    if (c.requested_by === actor || c.requested_by === principalId || String(c.requested_by).endsWith(`(${principalId})`) || (c.requested_subject && c.requested_subject === subject)) throw new HttpError(403, "the requesting subject cannot decide its own containment request");
    if (decision === "rejected") {
      tx(this.db, () => {
        this.db.prepare("UPDATE containment_requests SET status = 'rejected', decided_by = ?, decided_at = ? WHERE id = ?").run(actor, this.iso(), id);
        this.audit(actor, "containment.rejected", projectId, id, { subject });
        this.emit(projectId, "containment", { id, status: "rejected" });
      });
      return this.getContainment(projectId, id)!;
    }
    const stale = this.containmentStaleness(projectId, c);
    if (stale) throw new HttpError(409, `cannot approve: ${stale}`, ["reject this proposal or request it again so the current policy and evidence are reviewed"], { renewal_required: true });
    const plan = this.containmentPlanDigest(projectId, c);
    if (this.validApprovals(projectId, id, plan).some((a) => a.subject === subject)) throw new HttpError(409, "this subject has already approved; a different person must approve");
    tx(this.db, () => {
      this.db.prepare("INSERT INTO containment_approvals (request_id, project_id, subject, token_id, plan_digest, approved_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (request_id, subject) DO UPDATE SET token_id = excluded.token_id, plan_digest = excluded.plan_digest, approved_at = excluded.approved_at").run(id, projectId, subject, principalId, plan, this.iso());
      const have = this.validApprovals(projectId, id, plan).length, need = this.approvalsRequired(projectId);
      this.audit(actor, "containment.approval", projectId, id, { subject, have, need, plan_digest: plan });
      if (have >= need) {
        this.db.prepare("UPDATE containment_requests SET status = 'approved', decided_by = ?, decided_at = ? WHERE id = ?").run(actor, this.iso(), id);
        this.audit(actor, "containment.approved", projectId, id, { subjects: this.validApprovals(projectId, id, plan).map((a) => a.subject) });
        this.emit(projectId, "containment", { id, status: "approved" });
      }
    });
    return this.getContainment(projectId, id)!;
  }

  /** R08.2: attach an exact plan to a pending request. Its digest becomes part of what approvals bind. */
  setContainmentPlan(projectId: string, id: string, body: Record<string, unknown>, actor: string) {
    const c = this.getContainment(projectId, id);
    if (!c) throw new HttpError(404, "containment request not found");
    if (c.status !== "pending") throw new HttpError(409, "plans can only change while the request is pending");
    const action = this.containmentCatalog(projectId).find((a) => a.id === c.action_id);
    if (!action) throw new HttpError(422, "the action is no longer permitted");
    const graph = this.getGraph(projectId)!;
    const plan = buildPlan({ action, graph, targets: body.targets, parameters: body.parameters, artifact_digest: body.artifact_digest, evidence_bundle_id: body.evidence_bundle_id, ttl_seconds: body.ttl_seconds, policy_revision: this.containmentPolicyDigest(projectId, action.id),
      effectObservers: (ids) => this.listSources(projectId).filter((s) => s.kind === "effect_observer" && !s.disabled && s.asset_ids.some((a) => ids.includes(a))).map((s) => s.id) });
    this.db.prepare("UPDATE containment_requests SET plan = ?, plan_created_at = ? WHERE id = ?").run(JSON.stringify(plan), this.iso(), id);
    this.audit(actor, "containment.plan", projectId, id, { plan_digest: plan.digest });
    return { ...this.getContainment(projectId, id)!, plan };
  }

  containmentPrecheck(projectId: string, id: string) {
    const c = this.getContainment(projectId, id);
    if (!c) throw new HttpError(404, "containment request not found");
    if (!c.plan) return { ok: false, problems: ["no exact plan is attached"], verified_success_possible: false, executor: "none: Digital Kingdom does not execute response actions" };
    return precheck(JSON.parse(String(c.plan)) as ResponsePlan, { graph: this.getGraph(projectId)!, policy_revision: this.containmentPolicyDigest(projectId, String(c.action_id)), now: this.now(), created_at: String(c.plan_created_at) });
  }

  approvalsRequired(projectId: string): number { const n = Number(this.mustProject(projectId).meta.approvals_required ?? 1); return n >= 1 && n <= 3 ? n : 1; }

  /** R08.1: only a human installation admin may change approval policy; the change invalidates pending approvals. */
  setApprovalPolicy(projectId: string, approvalsRequired: number, actor: string) {
    if (!Number.isInteger(approvalsRequired) || approvalsRequired < 1 || approvalsRequired > 3) throw new HttpError(400, "approvals_required must be 1, 2 or 3");
    const p = this.mustProject(projectId);
    this.db.prepare("UPDATE projects SET meta = ? WHERE id = ?").run(JSON.stringify({ ...p.meta, approvals_required: approvalsRequired }), projectId);
    this.audit(actor, "approval_policy.set", projectId, null, { approvals_required: approvalsRequired });
  }

  private containmentPlanDigest(projectId: string, c: Record<string, unknown>) {
    const plan = c.plan ? (JSON.parse(String(c.plan)) as { digest: string }).digest : null;
    return digest({ policy: this.containmentPolicyDigest(projectId, String(c.action_id)), finding: c.finding_id, revision: Number(c.finding_revision), approvals_required: this.approvalsRequired(projectId), ...(plan ? { plan } : {}) });
  }

  /** Approvals that still count: same plan digest and a token that is neither revoked nor expired. */
  validApprovals(projectId: string, requestId: string, plan?: string) {
    const rows = this.db.prepare("SELECT a.subject, a.token_id, a.plan_digest, a.approved_at FROM containment_approvals a JOIN api_tokens t ON t.id = a.token_id WHERE a.project_id = ? AND a.request_id = ? AND t.revoked = 0 AND (t.expires_at IS NULL OR t.expires_at > ?)").all(projectId, requestId, this.iso()) as { subject: string; token_id: string; plan_digest: string; approved_at: string }[];
    return plan ? rows.filter((r) => r.plan_digest === plan) : rows;
  }

  /** Digest of what a reviewer approves against: the catalog entry and the project's permitted action set. */
  containmentPolicyDigest(projectId: string, actionId: string): string {
    const proj = this.mustProject(projectId);
    return digest({ action: this.containmentCatalog(projectId).find((a) => a.id === actionId) ?? null, permitted: proj.meta.containment_action_ids ?? null, ...(proj.meta.approvals_required !== undefined ? { approvals_required: proj.meta.approvals_required } : {}) });
  }

  /** Why a pending request can no longer be approved as reviewed, or null. */
  private containmentStaleness(projectId: string, c: Record<string, unknown>): string | null {
    if (!c.policy_digest || !c.expires_at) return "this proposal predates policy snapshots";
    if (this.now().getTime() > Date.parse(String(c.expires_at))) return `the proposal expired at ${c.expires_at}`;
    if (this.containmentPolicyDigest(projectId, String(c.action_id)) !== c.policy_digest) return "the containment policy changed since the proposal was made";
    const f = this.getFinding(projectId, String(c.finding_id));
    if (!f || f.finding.revision !== Number(c.finding_revision)) return `the finding changed since the proposal (revision ${c.finding_revision} -> ${f?.finding.revision ?? "missing"})`;
    if (c.plan) { const pc = precheck(JSON.parse(String(c.plan)) as ResponsePlan, { graph: this.getGraph(projectId)!, policy_revision: this.containmentPolicyDigest(projectId, String(c.action_id)), now: this.now(), created_at: String(c.plan_created_at) }); if (!pc.ok) return `the plan no longer matches: ${pc.problems.join("; ")}`; }
    return null;
  }

  getContainment(projectId: string, id: string) {
    const r = this.db.prepare("SELECT * FROM containment_requests WHERE project_id = ? AND id = ?").get(projectId, id) as Record<string, string> | undefined;
    return r ? this.annotateContainment(projectId, r) : undefined;
  }

  listContainment(projectId: string) {
    return (this.db.prepare("SELECT * FROM containment_requests WHERE project_id = ? ORDER BY created_at DESC LIMIT 200").all(projectId) as Record<string, string>[]).map((r) => this.annotateContainment(projectId, r));
  }

  private annotateContainment(projectId: string, r: Record<string, string>): Record<string, string> {
    const approvals = this.validApprovals(projectId, r.id!, r.status === "pending" ? this.containmentPlanDigest(projectId, r) : undefined).map((a) => ({ subject: a.subject, at: a.approved_at }));
    if (r.status !== "pending") return { ...r, approvals } as unknown as Record<string, string>;
    const why = this.containmentStaleness(projectId, r);
    return { ...r, approvable: why === null, renewal_reason: why, approvals, approvals_required: this.approvalsRequired(projectId) } as unknown as Record<string, string>;
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

/**
 * Versioned conversion for journal payloads written before v0.3.1 (never used for live ingestion, whose
 * reserved-field check stays strict). v0.3 stored its own redaction report inside the payload as
 * evidence._dk_redaction; it is lifted out, type-sanitized and returned separately. v0.3 also kept an
 * otherwise-empty evidence object when it existed only to carry that report; that shape is preserved so
 * the normalized event matches what v0.3 would have produced. Any other _dk_ key still fails minimization.
 */
export function convertLegacyPayload(v: unknown): { payload: Record<string, unknown>; historical: StoredRedaction; format: "v0.3-evidence-redaction" | null } | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const payload = { ...(v as Record<string, unknown>) };
  const ev = payload.evidence;
  if (ev !== null && typeof ev === "object" && !Array.isArray(ev) && Object.prototype.hasOwnProperty.call(ev, "_dk_redaction")) {
    const { _dk_redaction: historical, ...rest } = ev as Record<string, unknown>;
    payload.evidence = rest;
    return { payload, historical: sanitizeStoredRedaction(historical), format: "v0.3-evidence-redaction" };
  }
  return { payload, historical: { removed_keys: [], masked_values: 0 }, format: null };
}

/** SQLite / I/O failures must be retried with durability preserved, never quarantined as "bad data". */
export function isInfrastructureError(err: unknown): boolean {
  const e = err as { code?: string; errcode?: number; message?: string };
  return (typeof e?.code === "string" && /SQLITE|ERR_SQLITE|EIO|ENOSPC/.test(e.code)) || typeof e?.errcode === "number" || /database is locked|disk I\/O|SQLITE_/i.test(String(e?.message ?? ""));
}

/**
 * Rejection and quarantine details echo producer-supplied values (asset ids, parser messages). Token-shaped
 * values are masked before they are stored or returned (R00.4), and details stay bounded.
 */
export function safeDetail(detail: string): string { return redactString(detail.slice(0, 2000)).slice(0, 500); }

export class HttpError extends Error {
  /** `extra` is merged into the JSON error body (for example the current state on a 409 conflict). */
  constructor(readonly status: number, message: string, readonly details: string[] = [], readonly extra?: Record<string, unknown>) { super(message); }
}
