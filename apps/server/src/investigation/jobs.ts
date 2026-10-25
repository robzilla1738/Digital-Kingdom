import { canonicalJson, type EventAction, type InvestigationContract, type SecurityEvent } from "@dk/contracts";
import { identityOf, namespaces, sameIdentity, type CorrelationRefType } from "@dk/detections";
import { sha256 } from "../security.ts";
import { HttpError, type Principal, type Store } from "../store.ts";
import { parseSearchQuery, searchEvents } from "../investigate.ts";
import { coverageHistory } from "../coverage-history.ts";
import { SPAN_LIST_CAP } from "./scoping.ts";

/** A duration at a precision that keeps sub-minute gaps visible. */
export const fmtDuration = (n: number) => n < 1000 ? `${Math.round(n)} ms` : n < 120_000 ? `${(n / 1000).toFixed(n < 10_000 ? 2 : 1)} s` : `${Math.round(n / 60_000)} minute(s)`;
import { RECIPES, runRecipe } from "../recipes.ts";
import { bundleEvents } from "../bundles.ts";
import type { InvestigationContracts, ObligationResult } from "./contracts.ts";

/**
 * Bounded investigation plan jobs (Local Intelligence Phase LP09).
 *
 * A job is a typed plan bound to one contract revision: one step per open obligation (plus scope-safe pivots), a
 * unit budget, and committed per-step state. Every unit (one search page, one coverage question, one bundle page,
 * one recipe query) is fetched, then committed in ONE transaction with its deliveries, its cursor and the budget
 * counter. A crash before commit loses only that unit, which the next advance fetches again from the committed
 * cursor under the same pinned snapshot, so pages never duplicate or skip, including at tied timestamps.
 *
 * Step parameters are a closed set of typed fields. There is no raw SQL, path, URL, graph query or credential
 * parameter anywhere; unknown fields are refused. Each advance re-authorizes the caller AND checks that the token
 * that created the job is still valid: cancellation or revocation stops all further work.
 *
 * Budget exhaustion, truncation and errors stay explicit: a step that ran out of budget is `partial_budget` (its
 * obligation becomes `partial`, resumable), a failed page is `failed`, and nothing downstream is marked satisfied.
 */
export const JOB_SCHEMA = "dk.investigation_job.v1";
export const JOB_LIMITS = { max_units_default: 40, max_units_cap: 200, max_units_total_cap: 1000, advance_units_cap: 50, page_limit_default: 50, page_limit_max: 100, active_jobs_per_case: 3, active_jobs_per_project: 20, steps_max: 120, pivots_max: 20 } as const;

export const STEP_KINDS = ["search_activity", "coverage", "recipe", "bundle_read", "linked_events", "pivot"] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export const PIVOT_TYPES = ["actor_ref", "session_ref", "run_id", "request_id", "route", "asset_id"] as const;
export type PivotType = (typeof PIVOT_TYPES)[number];
const ACTIVE = ["queued", "running", "budget_exhausted"];
type JobStatus = "queued" | "running" | "budget_exhausted" | "completed" | "completed_with_errors" | "cancelled" | "revoked";
type StepStatus = "pending" | "running" | "complete" | "partial_budget" | "partial" | "failed" | "unavailable" | "stale" | "cancelled";
const TERMINAL_STEP: StepStatus[] = ["complete", "partial", "failed", "unavailable", "stale", "cancelled"];
/** Field names that are never accepted anywhere in a plan, whatever they are called. */
const FORBIDDEN = /^(sql|query|raw|raw_query|where|path|file|filename|url|uri|endpoint|host|graph|graph_query|cypher|gremlin|sparql|credential|credentials|password|secret|token|api_key|key|command|cmd|script|shell|exec)$/i;

interface StepParams {
  asset_id?: string; action?: EventAction; after?: string; before?: string; page_limit?: number; recipe?: string; finding_id?: string; finding_revision?: number;
  bundle_id?: string; event_ids?: string[]; pivot_type?: PivotType; value?: string; from_ref?: string; namespace?: string | null;
}
interface StepState { cursor?: string | null; snapshot_seq?: number; matched?: number; returned?: number; offset?: number; restarts?: number; complete?: boolean; note?: string; other_authority?: number; detail?: Record<string, unknown> }
interface StepRow { job_id: string; step_id: string; ord: number; kind: StepKind; purpose: string; obligation_id: string | null; params: string; status: StepStatus; state: string; pages: number; units: number; error: string | null; completeness: string | null; result_applied: string | null; started_at: string | null; finished_at: string | null }
interface JobRow { id: string; project_id: string; case_id: string; contract_id: string; contract_revision: number; status: JobStatus; budget: string; created_by: string; created_token: string | null; principal_type: string; created_at: string; updated_at: string; version: number; stop_reason: string | null }
interface Budget { max_units: number; used_units: number; page_limit: number }

export interface JobsOptions {
  /** Tests only: called inside a unit's commit transaction ("before_commit"); throwing simulates a crash before commit. */
  faultHook?: (stage: "before_commit", info: { job_id: string; step_id: string; kind: StepKind }) => void;
}

const nowIso = (s: Store) => s.now().toISOString();
const uniq = <T>(a: T[]) => [...new Set(a)];

export class InvestigationJobs {
  constructor(private readonly store: Store, private readonly secret: string, private readonly contracts: InvestigationContracts, private readonly opts: JobsOptions = {}) {
    contracts.resumable = (contractId) => this.resumableObligations(contractId);
  }
  private get db() { return this.store.db; }

  // ------------------------------------------------------------------ plan validation (closed, typed)

  /** Parse a client-supplied step (pivots are the only steps a client adds; the rest come from the contract). */
  static parseClientStep(raw: unknown, i: number): StepParams & { kind: "pivot" } {
    const where = `steps[${i}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(422, `${where} must be an object`);
    const o = raw as Record<string, unknown>;
    const forbidden = Object.keys(o).filter((k) => FORBIDDEN.test(k));
    if (forbidden.length) throw new HttpError(422, `${where}: field(s) ${forbidden.join(", ")} are not accepted: plans take no raw SQL, paths, URLs, graph queries, commands or credentials`);
    const allowed = new Set(["kind", "pivot_type", "value", "from_ref", "after", "before"]);
    const unknown = Object.keys(o).filter((k) => !allowed.has(k));
    if (unknown.length) throw new HttpError(422, `${where}: unsupported field(s) ${unknown.join(", ")}`, [`allowed: ${[...allowed].join(", ")}`]);
    if (o.kind !== "pivot") throw new HttpError(422, `${where}.kind must be "pivot" (other steps are planned from the contract's open obligations)`, [`step kinds: ${STEP_KINDS.join(", ")}`]);
    if (!PIVOT_TYPES.includes(o.pivot_type as PivotType)) throw new HttpError(422, `${where}.pivot_type must be one of ${PIVOT_TYPES.join(", ")}`);
    if (typeof o.value !== "string" || !o.value || o.value.length > 200) throw new HttpError(422, `${where}.value must be a string of 1 to 200 characters`);
    if (typeof o.from_ref !== "string" || !o.from_ref || o.from_ref.length > 200) throw new HttpError(422, `${where}.from_ref must name the delivered event the value was observed in`);
    for (const k of ["after", "before"] as const) if (o[k] !== undefined && (typeof o[k] !== "string" || Number.isNaN(Date.parse(o[k] as string)))) throw new HttpError(422, `${where}.${k} must be ISO 8601`);
    return { kind: "pivot", pivot_type: o.pivot_type as PivotType, value: o.value, from_ref: o.from_ref, after: o.after as string | undefined, before: o.before as string | undefined };
  }

  private parseBudget(raw: unknown): Budget {
    if (raw === undefined) return { max_units: JOB_LIMITS.max_units_default, used_units: 0, page_limit: JOB_LIMITS.page_limit_default };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(422, "budget must be an object");
    const b = raw as Record<string, unknown>;
    const unknown = Object.keys(b).filter((k) => k !== "max_units" && k !== "page_limit");
    if (unknown.length) throw new HttpError(422, `budget: unsupported field(s) ${unknown.join(", ")}`);
    const int = (v: unknown, lo: number, hi: number, k: string, d: number) => { if (v === undefined) return d; if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) throw new HttpError(422, `budget.${k} must be an integer from ${lo} to ${hi}`); return v as number; };
    return { max_units: int(b.max_units, 1, JOB_LIMITS.max_units_cap, "max_units", JOB_LIMITS.max_units_default), used_units: 0, page_limit: int(b.page_limit, 1, JOB_LIMITS.page_limit_max, "page_limit", JOB_LIMITS.page_limit_default) };
  }

  /** Scope-safety: a pivot value must have been delivered under this contract, in the named event's own field. */
  private checkPivot(job: { project_id: string; contract_id: string }, contract: InvestigationContract, p: StepParams): StepParams {
    const delivered = this.db.prepare("SELECT 1 FROM investigation_deliveries WHERE contract_id = ? AND ref = ? AND kind = 'event'").get(job.contract_id, p.from_ref!);
    if (!delivered) throw new HttpError(422, `pivot from_ref ${p.from_ref} was not delivered under this contract; pivots start only from retrieved evidence`);
    const [e] = this.store.eventsByIds(job.project_id, [p.from_ref!]);
    if (!e) throw new HttpError(422, `pivot from_ref ${p.from_ref} is no longer stored`);
    const field = p.pivot_type!;
    const has = field === "asset_id" ? e.asset_ids.includes(p.value!) : (e as unknown as Record<string, unknown>)[field] === p.value;
    if (!has) throw new HttpError(422, `event ${p.from_ref} does not carry ${field} = ${JSON.stringify(p.value)}; pivots use declared values from retrieved records only`);
    if (field === "asset_id" && !contract.scope.asset_ids.includes(p.value!)) throw new HttpError(422, `asset ${p.value} is outside the contract scope (${contract.scope.asset_ids.join(", ")})`);
    if (field === "request_id" && e.request_id_trust !== "trusted") throw new HttpError(422, "this request_id is client-supplied (not trusted by its source) and cannot be used to correlate");
    const a = Date.parse(contract.scope.after), b = Date.parse(contract.scope.before);
    const after = p.after ? new Date(Date.parse(p.after)).toISOString() : contract.scope.after, before = p.before ? new Date(Date.parse(p.before)).toISOString() : contract.scope.before;
    if (Date.parse(after) < a || Date.parse(before) > b || Date.parse(before) <= Date.parse(after)) throw new HttpError(422, `pivot interval must be ordered and inside the contract interval ${contract.scope.after}..${contract.scope.before}`);
    const ns = namespaces(this.store.listSources(job.project_id));
    const corr: Partial<Record<PivotType, CorrelationRefType>> = { actor_ref: "actor", session_ref: "session", run_id: "run" };
    const ident = corr[field] ? identityOf(e, corr[field]!, ns) : null;
    return { ...p, after, before, namespace: ident?.namespace ?? null };
  }

  // ------------------------------------------------------------------ create

  create(projectId: string, caseId: string, body: Record<string, unknown>, principal: Principal, actor: string) {
    return this.store.transaction(() => {
      const forbidden = Object.keys(body).filter((k) => FORBIDDEN.test(k));
      if (forbidden.length) throw new HttpError(422, `field(s) ${forbidden.join(", ")} are not accepted: plans take no raw SQL, paths, URLs, graph queries, commands or credentials`);
      const unknown = Object.keys(body).filter((k) => !["budget", "steps", "expected_revision"].includes(k));
      if (unknown.length) throw new HttpError(422, `unsupported field(s) ${unknown.join(", ")}`, ["allowed: budget {max_units, page_limit}, steps [pivot steps], expected_revision"]);
      const budget = this.parseBudget(body.budget);
      const clientSteps = body.steps === undefined ? [] : Array.isArray(body.steps) ? body.steps.map((s, i) => InvestigationJobs.parseClientStep(s, i)) : (() => { throw new HttpError(422, "steps must be a list"); })();
      if (clientSteps.length > JOB_LIMITS.pivots_max) throw new HttpError(422, `at most ${JOB_LIMITS.pivots_max} pivot steps per job`);
      const view = this.contracts.refresh(projectId, caseId, actor, "evidence or scope changed before planning");
      const contract = view.contract;
      if (body.expected_revision !== undefined && body.expected_revision !== contract.revision) throw new HttpError(409, "the contract changed since you loaded it", [`current revision is ${contract.revision}`], { current: { revision: contract.revision } });
      const activeCase = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM investigation_jobs WHERE project_id = ? AND case_id = ? AND status IN (${ACTIVE.map(() => "?").join(",")})`).get(projectId, caseId, ...ACTIVE) as { n: number }).n);
      const activeProject = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM investigation_jobs WHERE project_id = ? AND status IN (${ACTIVE.map(() => "?").join(",")})`).get(projectId, ...ACTIVE) as { n: number }).n);
      if (activeCase >= JOB_LIMITS.active_jobs_per_case) throw new HttpError(429, `quota: at most ${JOB_LIMITS.active_jobs_per_case} active jobs per case; finish, cancel or resume an existing job`);
      if (activeProject >= JOB_LIMITS.active_jobs_per_project) throw new HttpError(429, `quota: at most ${JOB_LIMITS.active_jobs_per_project} active jobs per project`);
      const id = "job_" + sha256(`${projectId}:${caseId}:${nowIso(this.store)}:${Math.random()}`).slice(0, 16);
      const job = { id, project_id: projectId, contract_id: contract.id };
      const steps: { kind: StepKind; purpose: string; obligation_id: string | null; params: StepParams }[] = [];
      for (const o of contract.obligations) {
        if (o.status === "satisfied" || o.status === "inapplicable_with_reason") continue;
        const t = o.target;
        if (o.kind === "retrieve_activity") steps.push({ kind: "search_activity", obligation_id: o.id, purpose: o.question, params: { asset_id: t.asset_id, after: contract.scope.after, before: contract.scope.before, page_limit: budget.page_limit } });
        else if (o.kind === "coverage") steps.push({ kind: "coverage", obligation_id: o.id, purpose: o.question, params: { asset_id: t.asset_id, action: t.action, after: contract.scope.after, before: contract.scope.before } });
        else if (o.kind === "recipe") steps.push({ kind: "recipe", obligation_id: o.id, purpose: o.question, params: { recipe: t.recipe, finding_id: t.finding_id, finding_revision: t.finding_revision } });
        else if (o.kind === "bundle_integrity") steps.push({ kind: "bundle_read", obligation_id: o.id, purpose: o.question, params: { bundle_id: t.bundle_id, finding_id: t.finding_id, finding_revision: t.finding_revision } });
        else if (o.kind === "linked_events") steps.push({ kind: "linked_events", obligation_id: o.id, purpose: o.question, params: { event_ids: t.event_ids } });
      }
      for (const s of clientSteps) { const p = this.checkPivot(job, contract, s); steps.push({ kind: "pivot", obligation_id: null, purpose: `Pivot on ${p.pivot_type} ${JSON.stringify(p.value)} observed in ${p.from_ref}${p.namespace ? ` (within ${p.namespace})` : ""}`, params: { ...p, page_limit: budget.page_limit } }); }
      if (!steps.length) throw new HttpError(409, "nothing to do: every obligation is satisfied or inapplicable, and no pivot was requested");
      if (steps.length > JOB_LIMITS.steps_max) throw new HttpError(422, `plan too large (${steps.length} steps)`);
      const at = nowIso(this.store);
      const tokenId = principal.kind === "token" ? principal.id : null;
      this.db.prepare("INSERT INTO investigation_jobs (id, project_id, case_id, contract_id, contract_revision, status, budget, created_by, created_token, principal_type, created_at, updated_at, version, stop_reason) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, 1, NULL)")
        .run(id, projectId, caseId, contract.id, contract.revision, canonicalJson(budget), actor, tokenId, principal.principalType, at, at);
      const ins = this.db.prepare("INSERT INTO investigation_job_steps (job_id, step_id, ord, kind, purpose, obligation_id, params, status, state, pages, units) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', '{}', 0, 0)");
      steps.forEach((s, i) => ins.run(id, `s${i + 1}`, i + 1, s.kind, s.purpose.slice(0, 1000), s.obligation_id, canonicalJson(s.params)));
      this.log(id, null, "created", { steps: steps.length, contract_revision: contract.revision, budget });
      this.store.audit(actor, "investigation_job.create", projectId, id, { case_id: caseId, steps: steps.length, max_units: budget.max_units });
      return this.get(projectId, id);
    });
  }

  /** Add scope-safe pivot steps to an existing active job (for example after its first pages revealed an identity). */
  addSteps(projectId: string, jobId: string, body: Record<string, unknown>, actor: string) {
    return this.store.transaction(() => {
      const job = this.row(projectId, jobId);
      if (!ACTIVE.includes(job.status)) throw new HttpError(409, `the job is ${job.status}; create a new job`);
      const unknown = Object.keys(body).filter((k) => k !== "steps");
      if (unknown.length) throw new HttpError(422, `unsupported field(s) ${unknown.join(", ")}`);
      if (!Array.isArray(body.steps) || !body.steps.length) throw new HttpError(422, "steps must be a non-empty list of pivot steps");
      const parsed = body.steps.map((s, i) => InvestigationJobs.parseClientStep(s, i));
      const contract = this.contracts.revision(projectId, job.case_id, job.contract_revision);
      const n = Number((this.db.prepare("SELECT COUNT(*) AS n FROM investigation_job_steps WHERE job_id = ?").get(jobId) as { n: number }).n);
      const pivots = Number((this.db.prepare("SELECT COUNT(*) AS n FROM investigation_job_steps WHERE job_id = ? AND kind = 'pivot'").get(jobId) as { n: number }).n);
      if (pivots + parsed.length > JOB_LIMITS.pivots_max) throw new HttpError(422, `at most ${JOB_LIMITS.pivots_max} pivot steps per job`);
      const budget = JSON.parse(job.budget) as Budget;
      const ins = this.db.prepare("INSERT INTO investigation_job_steps (job_id, step_id, ord, kind, purpose, obligation_id, params, status, state, pages, units) VALUES (?, ?, ?, 'pivot', ?, NULL, ?, 'pending', '{}', 0, 0)");
      parsed.forEach((s, i) => { const p = this.checkPivot(job, contract, s); ins.run(jobId, `s${n + i + 1}`, n + i + 1, `Pivot on ${p.pivot_type} ${JSON.stringify(p.value)} observed in ${p.from_ref}${p.namespace ? ` (within ${p.namespace})` : ""}`, canonicalJson({ ...p, page_limit: budget.page_limit })); });
      if (job.status === "budget_exhausted" && budget.used_units < budget.max_units) this.setStatus(job, "running", null);
      this.log(jobId, null, "steps_added", { count: parsed.length, by: actor });
      return this.get(projectId, jobId);
    });
  }

  // ------------------------------------------------------------------ read

  private row(projectId: string, jobId: string): JobRow {
    const r = this.db.prepare("SELECT * FROM investigation_jobs WHERE project_id = ? AND id = ?").get(projectId, jobId) as JobRow | undefined;
    if (!r) throw new HttpError(404, "job not found");
    return r;
  }
  private steps(jobId: string): StepRow[] { return this.db.prepare("SELECT * FROM investigation_job_steps WHERE job_id = ? ORDER BY ord").all(jobId) as unknown as StepRow[]; }

  get(projectId: string, jobId: string) {
    const j = this.row(projectId, jobId);
    const budget = JSON.parse(j.budget) as Budget;
    const steps = this.steps(jobId).map((s) => {
      const state = JSON.parse(s.state) as StepState;
      const delivered = Number((this.db.prepare("SELECT COUNT(*) AS n FROM investigation_deliveries WHERE channel = 'job' AND channel_id = ? AND step_id = ?").get(jobId, s.step_id) as { n: number }).n);
      return {
        step_id: s.step_id, kind: s.kind, purpose: s.purpose, obligation_id: s.obligation_id, params: JSON.parse(s.params) as StepParams, status: s.status,
        counters: { units: s.units, pages: s.pages, delivered, matched_in_snapshot: state.matched ?? null, snapshot_seq: state.snapshot_seq ?? null, other_authority_excluded: state.other_authority ?? 0, restarts: state.restarts ?? 0 },
        completeness: s.completeness, error: s.error, note: state.note ?? null, resumable: s.status === "partial_budget" || (s.status === "pending" && ACTIVE.includes(j.status)) || s.status === "running",
        continuation: state.cursor ? { kind: "signed_search_cursor", committed: true } : null,
        result_applied: s.result_applied ? JSON.parse(s.result_applied) : null,
        detail: state.detail ?? null, started_at: s.started_at, finished_at: s.finished_at,
      };
    });
    return {
      schema: JOB_SCHEMA, id: j.id, project_id: j.project_id, case_id: j.case_id, contract_id: j.contract_id, contract_revision: j.contract_revision, status: j.status, stop_reason: j.stop_reason,
      budget: { ...budget, remaining_units: Math.max(0, budget.max_units - budget.used_units), unit: "one search page, coverage question, bundle page or recipe query", exhausted: budget.used_units >= budget.max_units },
      steps, created_by: j.created_by, principal_type: j.principal_type, created_at: j.created_at, updated_at: j.updated_at, version: j.version,
      model_calls: 0,
      notes: ["State is committed after every unit; advancing again resumes from the committed cursor under the same snapshot.", "partial_budget / failed / unavailable steps never mark their obligation satisfied.", "No model is called by a job; any model work happens in the client and is accounted there."],
    };
  }

  list(projectId: string, caseId: string) {
    return (this.db.prepare("SELECT id, status, contract_revision, budget, created_by, created_at, updated_at FROM investigation_jobs WHERE project_id = ? AND case_id = ? ORDER BY created_at DESC LIMIT 100").all(projectId, caseId) as { id: string; status: JobStatus; contract_revision: number; budget: string; created_by: string; created_at: string; updated_at: string }[]).map((r) => ({ ...r, budget: JSON.parse(r.budget) as Budget }));
  }

  /** Deliveries of one job (refs only, paged by delivery id; the opaque cursor is the last id). */
  deliveries(projectId: string, jobId: string, opts: { step?: string; after?: number; limit?: number }) {
    this.row(projectId, jobId);
    const lim = Math.min(Math.max(opts.limit ?? 200, 1), 500);
    const rows = this.db.prepare(`SELECT id, step_id, ref, kind, role, detail FROM investigation_deliveries WHERE channel = 'job' AND channel_id = ? ${opts.step ? "AND step_id = ?" : ""} AND id > ? ORDER BY id LIMIT ?`).all(...([jobId, ...(opts.step ? [opts.step] : []), opts.after ?? 0, lim + 1] as (string | number)[])) as { id: number; step_id: string; ref: string; kind: string; role: string; detail: string | null }[];
    const page = rows.slice(0, lim);
    return { job_id: jobId, deliveries: page.map((r) => ({ step_id: r.step_id, ref: r.ref, kind: r.kind, role: r.role, ...(r.detail ? { detail: JSON.parse(r.detail) } : {}) })), next_after: rows.length > lim ? page.at(-1)!.id : null };
  }

  /** Obligations whose committed work can still continue (keeps the contract `collecting`, never unresolved). */
  resumableObligations(contractId: string): Set<string> {
    const rows = this.db.prepare(`SELECT s.obligation_id, s.status, j.status AS job_status FROM investigation_job_steps s JOIN investigation_jobs j ON j.id = s.job_id WHERE j.contract_id = ? AND s.obligation_id IS NOT NULL`).all(contractId) as { obligation_id: string; status: StepStatus; job_status: JobStatus }[];
    return new Set(rows.filter((r) => r.status === "partial_budget" && r.job_status !== "cancelled" && r.job_status !== "revoked" || ((r.status === "pending" || r.status === "running") && ACTIVE.includes(r.job_status))).map((r) => r.obligation_id));
  }

  // ------------------------------------------------------------------ control

  private log(jobId: string, stepId: string | null, kind: string, detail: unknown) {
    this.db.prepare("INSERT INTO investigation_job_events (job_id, step_id, kind, detail, at) VALUES (?, ?, ?, ?, ?)").run(jobId, stepId, kind, canonicalJson(detail).slice(0, 4000), nowIso(this.store));
  }
  events(projectId: string, jobId: string) {
    this.row(projectId, jobId);
    return (this.db.prepare("SELECT step_id, kind, detail, at FROM investigation_job_events WHERE job_id = ? ORDER BY id LIMIT 1000").all(jobId) as { step_id: string | null; kind: string; detail: string; at: string }[]).map((e) => ({ ...e, detail: JSON.parse(e.detail) }));
  }
  private setStatus(job: JobRow, status: JobStatus, reason: string | null) {
    this.db.prepare("UPDATE investigation_jobs SET status = ?, stop_reason = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(status, reason, nowIso(this.store), job.id);
    job.status = status; job.stop_reason = reason;
  }

  cancel(projectId: string, jobId: string, reason: unknown, actor: string) {
    return this.store.transaction(() => {
      const job = this.row(projectId, jobId);
      if (!ACTIVE.includes(job.status)) throw new HttpError(409, `the job is already ${job.status}`);
      const why = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : "cancelled by analyst";
      this.setStatus(job, "cancelled", why);
      this.db.prepare("UPDATE investigation_job_steps SET status = 'cancelled', finished_at = ? WHERE job_id = ? AND status IN ('pending','running')").run(nowIso(this.store), jobId);
      this.log(jobId, null, "cancelled", { by: actor, reason: why });
      this.store.audit(actor, "investigation_job.cancel", projectId, jobId, { reason: why });
      return this.get(projectId, jobId);
    });
  }

  extendBudget(projectId: string, jobId: string, body: Record<string, unknown>, actor: string) {
    return this.store.transaction(() => {
      const job = this.row(projectId, jobId);
      if (!ACTIVE.includes(job.status)) throw new HttpError(409, `the job is ${job.status}; create a new job`);
      const add = body.add_units;
      if (!Number.isInteger(add) || (add as number) < 1 || (add as number) > JOB_LIMITS.max_units_cap) throw new HttpError(422, `add_units must be an integer from 1 to ${JOB_LIMITS.max_units_cap}`);
      const b = JSON.parse(job.budget) as Budget;
      if (b.max_units + (add as number) > JOB_LIMITS.max_units_total_cap) throw new HttpError(422, `a job's total budget cannot exceed ${JOB_LIMITS.max_units_total_cap} units`);
      b.max_units += add as number;
      this.db.prepare("UPDATE investigation_jobs SET budget = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(canonicalJson(b), nowIso(this.store), jobId);
      this.db.prepare("UPDATE investigation_job_steps SET status = 'pending' WHERE job_id = ? AND status = 'partial_budget'").run(jobId);
      if (job.status === "budget_exhausted") this.setStatus(job, "running", null);
      this.log(jobId, null, "budget_extended", { by: actor, add_units: add, max_units: b.max_units });
      this.store.audit(actor, "investigation_job.budget", projectId, jobId, { add_units: add });
      return this.get(projectId, jobId);
    });
  }

  /** Is the job still authorized to do work? (cancelled, revoked creator token, or the caller lost access) */
  private authorize(job: JobRow, caller: Principal) {
    if (job.status === "cancelled") throw new HttpError(409, "the job was cancelled; no further work is authorized");
    if (job.status === "revoked") throw new HttpError(403, "the job's authority was revoked; no further work is authorized");
    if (job.created_token) {
      const meta = this.store.getTokenMeta(job.created_token);
      if (!meta || meta.revoked) {
        this.store.transaction(() => { this.setStatus(job, "revoked", "the token that created this job was revoked"); this.db.prepare("UPDATE investigation_job_steps SET status = 'cancelled' WHERE job_id = ? AND status IN ('pending','running','partial_budget')").run(job.id); this.log(job.id, null, "revoked", {}); });
        throw new HttpError(403, "the job's authority was revoked (creator token revoked); no further work is authorized");
      }
    }
    this.store.require(caller, job.project_id, "analyst");
  }

  // ------------------------------------------------------------------ execution

  /** Execute up to `maxUnits` units, committing after each. Returns the job and what this call did. */
  advance(projectId: string, jobId: string, maxUnits: unknown, caller: Principal, actor: string) {
    const n = maxUnits === undefined ? 10 : maxUnits;
    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > JOB_LIMITS.advance_units_cap) throw new HttpError(422, `max_units must be an integer from 1 to ${JOB_LIMITS.advance_units_cap}`);
    let executed = 0; const applied: unknown[] = [];
    for (let i = 0; i < (n as number); i++) {
      const job = this.row(projectId, jobId);
      if (job.status === "completed" || job.status === "completed_with_errors") break;
      this.authorize(job, caller);
      const budget = JSON.parse(job.budget) as Budget;
      if (budget.used_units >= budget.max_units) { this.exhaust(job, actor); break; }
      const step = this.steps(jobId).find((s) => s.status === "pending" || s.status === "running");
      if (!step) { this.finishJob(job); break; }
      const r = this.unit(job, step, budget, actor);
      executed += r.units;
      if (r.applied) applied.push(r.applied);
    }
    const job = this.row(projectId, jobId);
    if (ACTIVE.includes(job.status) && !this.steps(jobId).some((s) => s.status === "pending" || s.status === "running")) this.finishJob(job);
    else if (ACTIVE.includes(job.status)) { const b = JSON.parse(job.budget) as Budget; if (b.used_units >= b.max_units) this.exhaust(job, actor); }
    return { job: this.get(projectId, jobId), units_executed: executed, results_applied: applied };
  }

  private finishJob(job: JobRow) {
    if (!ACTIVE.includes(job.status)) return;
    const bad = this.steps(job.id).filter((s) => s.status === "failed" || s.status === "stale");
    this.store.transaction(() => { this.setStatus(job, bad.length ? "completed_with_errors" : "completed", bad.length ? `${bad.length} step(s) failed or stale` : null); this.log(job.id, null, "finished", { status: job.status }); });
  }

  /** Budget ran out: unfinished steps with progress become partial_budget and their obligations `partial` (resumable). */
  private exhaust(job: JobRow, actor: string) {
    if (job.status === "budget_exhausted") return;
    this.store.transaction(() => {
      const results: ObligationResult[] = [];
      for (const s of this.steps(job.id).filter((x) => x.status === "running" || x.status === "pending")) {
        if (s.status === "running") {
          this.db.prepare("UPDATE investigation_job_steps SET status = 'partial_budget', completeness = ? WHERE job_id = ? AND step_id = ?").run(`stopped after ${s.pages} page(s): job budget exhausted; resumable from the committed cursor`, job.id, s.step_id);
          if (s.obligation_id) results.push(this.resultFor(job, s, "partial", `query budget exhausted after ${s.pages} page(s) in job ${job.id}; resumable (extend the job budget)`));
        }
      }
      this.setStatus(job, "budget_exhausted", "unit budget exhausted");
      this.log(job.id, null, "budget_exhausted", { pending_steps: this.steps(job.id).filter((x) => x.status === "pending").map((x) => x.step_id) });
      if (results.length) this.apply(job, results, actor);
    });
  }

  private resultFor(job: JobRow, s: StepRow, status: ObligationResult["status"], reason: string, extra: Partial<ObligationResult> = {}): ObligationResult {
    const p = JSON.parse(s.params) as StepParams;
    const refs = (this.db.prepare("SELECT ref FROM investigation_deliveries WHERE channel = 'job' AND channel_id = ? AND step_id = ? AND kind = 'event' ORDER BY id LIMIT 200").all(job.id, s.step_id) as { ref: string }[]).map((r) => r.ref);
    const count = Number((this.db.prepare("SELECT COUNT(*) AS n FROM investigation_deliveries WHERE channel = 'job' AND channel_id = ? AND step_id = ? AND kind = 'event'").get(job.id, s.step_id) as { n: number }).n);
    return {
      obligation_id: s.obligation_id!, status, reason, evidence_refs: refs, evidence_ref_count: count, query_refs: [`${job.id}:${s.step_id}`],
      scope: { project_id: job.project_id, contract_revision: job.contract_revision, asset_id: p.asset_id, action: p.action, after: p.after, before: p.before, finding_id: p.finding_id, finding_revision: p.finding_revision, bundle_id: p.bundle_id, recipe: p.recipe },
      ...extra,
    };
  }

  private apply(job: JobRow, results: ObligationResult[], actor: string) {
    const r = this.contracts.applyResults(job.project_id, job.case_id, results, actor, `job ${job.id}`);
    for (const x of results) {
      const refused = r.refused.find((f) => f.obligation_id === x.obligation_id);
      const step = this.db.prepare("SELECT step_id FROM investigation_job_steps WHERE job_id = ? AND obligation_id = ?").get(job.id, x.obligation_id) as { step_id: string } | undefined;
      if (!step) continue;
      this.db.prepare("UPDATE investigation_job_steps SET result_applied = ? WHERE job_id = ? AND step_id = ?").run(canonicalJson(refused ? { applied: false, reason: refused.reason } : { applied: true, status: x.status, contract_revision: r.view.stored_revision }), job.id, step.step_id);
      if (refused && /re-run under the current scope|did not require/.test(refused.reason)) {
        this.db.prepare("UPDATE investigation_job_steps SET status = 'stale', completeness = ? WHERE job_id = ? AND step_id = ?").run(`result not applied: ${refused.reason}`, job.id, step.step_id);
      }
    }
    return { applied: r.applied, refused: r.refused };
  }

  private deliver(job: JobRow, step: StepRow, refs: { ref: string; kind: string; role: string; detail?: unknown }[]) {
    const ins = this.db.prepare("INSERT OR IGNORE INTO investigation_deliveries (project_id, contract_id, contract_revision, channel, channel_id, step_id, ref, kind, role, detail, principal, at) VALUES (?, ?, ?, 'job', ?, ?, ?, ?, ?, ?, ?, ?)");
    let dup = 0;
    for (const r of refs) { const res = ins.run(job.project_id, job.contract_id, job.contract_revision, job.id, step.step_id, r.ref, r.kind, r.role, r.detail === undefined ? null : canonicalJson(r.detail), job.created_by, nowIso(this.store)); if (!Number(res.changes)) dup++; }
    return dup;
  }

  /** One unit for one step: fetch, then commit (deliveries + cursor + budget + any obligation result) atomically. */
  private unit(job: JobRow, step: StepRow, budget: Budget, actor: string): { units: number; applied?: unknown } {
    const p = JSON.parse(step.params) as StepParams;
    const state = JSON.parse(step.state) as StepState;
    const at = nowIso(this.store);
    const commit = (fn: () => { units: number; applied?: unknown }) => this.store.transaction(() => {
      const r = fn();
      budget.used_units += r.units;
      this.db.prepare("UPDATE investigation_jobs SET budget = ?, status = CASE WHEN status = 'queued' THEN 'running' ELSE status END, updated_at = ?, version = version + 1 WHERE id = ?").run(canonicalJson(budget), at, job.id);
      this.opts.faultHook?.("before_commit", { job_id: job.id, step_id: step.step_id, kind: step.kind });
      return r;
    });
    const saveStep = (status: StepStatus, st: StepState, extra: { pages?: number; units?: number; error?: string | null; completeness?: string | null } = {}) =>
      this.db.prepare("UPDATE investigation_job_steps SET status = ?, state = ?, pages = pages + ?, units = units + ?, error = ?, completeness = ?, started_at = COALESCE(started_at, ?), finished_at = ? WHERE job_id = ? AND step_id = ?")
        .run(status, canonicalJson(st), extra.pages ?? 0, extra.units ?? 1, extra.error ?? null, extra.completeness ?? null, at, TERMINAL_STEP.includes(status) ? at : null, job.id, step.step_id);

    if (step.kind === "search_activity" || step.kind === "pivot") {
      const raw: Record<string, string> = { after: p.after!, before: p.before!, limit: String(p.page_limit ?? budget.page_limit) };
      if (step.kind === "search_activity") raw.asset_id = p.asset_id!;
      else raw[p.pivot_type!] = p.value!;
      const q = parseSearchQuery(raw).query;
      let res: ReturnType<typeof searchEvents>;
      try { res = searchEvents(this.store, job.project_id, q, this.secret, state.cursor ?? undefined); }
      catch (e) {
        const err = e as HttpError;
        if (err.status === 410 && state.cursor) {
          // expired cursor: restart this step under a new snapshot; deliveries are de-duplicated by (job, step, ref)
          return commit(() => { saveStep("running", { restarts: (state.restarts ?? 0) + 1, note: `cursor expired after ${step.pages} page(s); restarted under a new snapshot` }, { units: 0 }); this.log(job.id, step.step_id, "cursor_restart", { message: err.message }); return { units: 0 }; });
        }
        return commit(() => {
          saveStep("failed", state, { error: String((e as Error).message).slice(0, 500), completeness: `page ${step.pages + 1} failed` });
          this.log(job.id, step.step_id, "page_failed", { error: String((e as Error).message).slice(0, 300) });
          return { units: 1, applied: step.obligation_id ? this.apply(job, [this.resultFor(job, step, "failed", `page ${step.pages + 1} failed: ${String((e as Error).message).slice(0, 300)}`)], actor) : undefined };
        });
      }
      let events = res.events as SecurityEvent[];
      let other = 0;
      if (step.kind === "pivot" && p.namespace) {
        const ns = namespaces(this.store.listSources(job.project_id));
        const type = ({ actor_ref: "actor", session_ref: "session", run_id: "run" } as Record<string, CorrelationRefType>)[p.pivot_type!]!;
        const ident = { project_id: job.project_id, type, namespace: p.namespace, value: p.value! };
        const kept = events.filter((e) => sameIdentity(identityOf(e, type, ns), ident));
        other = events.length - kept.length; events = kept;
      }
      const qc = res.query_completeness;
      return commit(() => {
        const dup = this.deliver(job, step, events.map((e) => ({ ref: e.id, kind: "event", role: step.kind === "pivot" ? "pivot" : "scope_activity", detail: { occurred_at: e.occurred_at, snapshot_seq: res.snapshot_seq } })));
        const st: StepState = { ...state, cursor: res.page.next_cursor, snapshot_seq: res.snapshot_seq, matched: qc.matching_in_snapshot, returned: qc.returned_through_this_page, other_authority: (state.other_authority ?? 0) + other };
        if (dup) this.log(job.id, step.step_id, "duplicate_suppressed", { count: dup });
        if (qc.complete) {
          saveStep("complete", { ...st, cursor: null, complete: true }, { pages: 1, completeness: `complete: ${qc.matching_in_snapshot} match(es) under snapshot ${res.snapshot_seq}${other ? `; ${other} from another authority excluded` : ""}` });
          const applied = step.obligation_id ? this.apply(job, [this.resultFor(job, step, "satisfied", `complete: every stored match (${qc.matching_in_snapshot}) under snapshot ${res.snapshot_seq} in ${step.pages + 1} page(s)`, { validity: { snapshot_seq: res.snapshot_seq, matched: qc.matching_in_snapshot } })], actor) : undefined;
          return { units: 1, applied };
        }
        if (!res.page.next_cursor) {
          saveStep("partial", st, { pages: 1, completeness: qc.note, error: qc.note });
          const applied = step.obligation_id ? this.apply(job, [this.resultFor(job, step, "partial", `incomplete and not resumable: ${qc.note}`, { validity: { snapshot_seq: res.snapshot_seq } })], actor) : undefined;
          return { units: 1, applied };
        }
        saveStep("running", st, { pages: 1, completeness: `truncated: ${qc.returned_through_this_page} of ${qc.matching_in_snapshot} under snapshot ${res.snapshot_seq}` });
        return { units: 1 };
      });
    }

    if (step.kind === "coverage") {
      let r: { status: ObligationResult["status"]; reason: string; detail: Record<string, unknown> };
      try {
        const h = coverageHistory(this.store, job.project_id, { asset: p.asset_id!, action: p.action!, after: p.after!, before: p.before! });
        const configured = h.sources.length > 0 && h.spans.some((s) => s.sources.length > 0);
        const status = !configured || h.totals_ms.unknown > 0 ? "unavailable" : h.totals_ms.partial > 0 ? "partial" : "satisfied";
        const notCovered = h.spans.filter((s) => s.state !== "covered");
        const unknownSpans = notCovered.slice(0, SPAN_LIST_CAP).map((s) => ({ from: s.from, to: s.to, state: s.state }));
        const intervalMs = Math.max(0, Date.parse(p.before!) - Date.parse(p.after!));
        // li-next A: say how much of the interval the gap is, at a precision that does not round short gaps to "0 minute(s)"
        // and imply the whole interval; the spans themselves scope which claims the gap bears on.
        const where = (n: number) => `${notCovered.length} span(s)${notCovered.length && notCovered.length <= 3 ? ` (${notCovered.map((s) => `${s.from}..${s.to}`).join(", ")})` : ""}; ${n >= intervalMs ? "that is the whole interval" : "the rest of the interval was covered"}`;
        r = { status, reason: status === "satisfied" ? "a capable, assigned, live source covered the whole interval" : !configured ? "no source is configured to observe this asset and event class (the whole interval)" : status === "partial" ? `${fmtDuration(h.totals_ms.partial)} of ${fmtDuration(intervalMs)} only partially covered (sampling or unverifiable liveness) in ${where(h.totals_ms.partial + h.totals_ms.unknown)}` : `${fmtDuration(h.totals_ms.unknown)} of ${fmtDuration(intervalMs)} with no capable live observer in ${where(h.totals_ms.unknown + h.totals_ms.partial)}`,
          detail: { totals_ms: h.totals_ms, interval_ms: intervalMs, configured, uncovered_spans: unknownSpans, uncovered_spans_total: notCovered.length, sources: h.sources.map((s) => s.source_id) } };
      } catch (e) { r = { status: "failed", reason: `coverage question failed: ${String((e as Error).message).slice(0, 300)}`, detail: {} }; }
      const seq = Number((this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM events WHERE project_id = ?").get(job.project_id) as { m: number }).m);
      const ref = `cov:${job.id}:${step.step_id}`;
      return commit(() => {
        this.deliver(job, step, [{ ref, kind: "coverage", role: "coverage", detail: { asset_id: p.asset_id, action: p.action, after: p.after, before: p.before, status: r.status, reason: r.reason, ...r.detail } }]);
        saveStep(r.status === "satisfied" ? "complete" : r.status === "failed" ? "failed" : r.status === "partial" ? "partial" : "unavailable", { ...state, detail: { coverage_ref: ref, ...r.detail } }, { completeness: r.reason, error: r.status === "failed" ? r.reason : null });
        const applied = this.apply(job, [this.resultFor(job, step, r.status, r.reason, { evidence_refs: [], query_refs: [ref, `${job.id}:${step.step_id}`], validity: { snapshot_seq: seq, source_config_revisions: this.contracts.sourceRevisions(job.project_id) } })], actor);
        return { units: 1, applied };
      });
    }

    if (step.kind === "recipe") {
      const [rid] = String(p.recipe).split("@");
      const remaining = Math.max(1, budget.max_units - budget.used_units);
      const maxQ = Math.min(12, remaining);
      let out: ReturnType<typeof runRecipe> | null = null; let err: string | null = null;
      try { out = runRecipe(this.store, job.project_id, rid!, p.finding_id!, this.secret, maxQ); } catch (e) { err = String((e as Error).message).slice(0, 300); }
      return commit(() => {
        if (!out) {
          saveStep("failed", state, { error: err, completeness: "recipe failed" });
          return { units: 1, applied: this.apply(job, [this.resultFor(job, step, "failed", `recipe failed: ${err}`)], actor) };
        }
        const recipeVersion = `${out.recipe.id}@${out.recipe.version}`;
        const finding = this.store.listFindings(job.project_id).find((f) => f.id === p.finding_id);
        const budgetCut = out.budget.exhausted && out.outstanding.length > 0;
        const failed = out.obligations.some((o) => o.status === "failed");
        const status: ObligationResult["status"] = out.conclusion_allowed ? "satisfied" : budgetCut ? "partial" : failed ? "failed" : "unavailable";
        const reasons = [...out.stop_conditions.filter((s) => s.triggered).map((s) => s.reason), ...out.outstanding.map((o) => `outstanding: ${o.purpose} (${o.reason})`)];
        const refs = uniq([...out.hypotheses.flatMap((h) => [...h.supporting_event_ids, ...h.counter_event_ids]), ...out.queries.flatMap((q) => q.follow_on_event_ids)]);
        const counter = new Set([...(finding?.counterevidence_event_ids ?? []), ...out.hypotheses.flatMap((h) => h.counter_event_ids)]);
        this.deliver(job, step, [...refs.map((id) => ({ ref: id, kind: "event", role: counter.has(id) ? "counter" : (finding?.event_ids.includes(id) ? "supporting" : "follow_on") })), ...(finding ? [...finding.event_ids, ...finding.counterevidence_event_ids].filter((id) => !refs.includes(id)).map((id) => ({ ref: id, kind: "event", role: counter.has(id) ? "counter" : "supporting" })) : [])]);
        const units = Math.max(1, out.budget.used);
        saveStep(budgetCut ? "partial_budget" : status === "satisfied" ? "complete" : status === "failed" ? "failed" : "unavailable", { ...state, detail: { recipe: recipeVersion, conclusion_allowed: out.conclusion_allowed, completeness: out.completeness, stops: out.stop_conditions.filter((s) => s.triggered).map((s) => s.condition), outstanding: out.outstanding.length, hypotheses: out.hypotheses.map((h) => ({ id: h.id, kind: h.kind, status: h.status })) } },
          { units, completeness: out.conclusion_allowed ? "recipe complete; conclusion allowed (observable propositions only)" : reasons.join(" ").slice(0, 1000) });
        const applied = this.apply(job, [this.resultFor(job, step, status, out.conclusion_allowed ? `recipe ${recipeVersion} complete; every recipe obligation satisfied` : reasons.join(" ").slice(0, 1900) || `recipe ${out.completeness}`, { scope: { ...this.resultFor(job, step, status, "").scope, recipe: recipeVersion }, validity: { finding_revision: finding?.revision } })], actor);
        return { units, applied };
      });
    }

    if (step.kind === "bundle_read") {
      const off = state.offset ?? 0;
      let page: ReturnType<typeof bundleEvents> | null = null; let err: string | null = null;
      try { page = bundleEvents(this.store, job.project_id, p.bundle_id!, off, 500); } catch (e) { err = String((e as Error).message).slice(0, 300); }
      return commit(() => {
        if (!page) { saveStep("failed", state, { error: err, completeness: "bundle read failed" }); return { units: 1, applied: this.apply(job, [this.resultFor(job, step, "failed", `bundle read failed: ${err}`)], actor) }; }
        this.deliver(job, step, page.events.map((e) => ({ ref: e.id, kind: "event", role: e.role === "counter" ? "counter" : "supporting" })));
        const prev = (state.detail ?? {}) as { missing?: number; changed?: number; missing_evidence?: number };
        const missing = (prev.missing ?? 0) + page.missing_events.length, changed = (prev.changed ?? 0) + page.changed_event_ids.length, missingEv = (prev.missing_evidence ?? 0) + page.missing_evidence_refs.length;
        const detail = { missing, changed, missing_evidence: missingEv, total_references: page.page.total_references };
        if (page.page.has_more) { saveStep("running", { ...state, offset: off + 500, detail }, { pages: 1 }); return { units: 1 }; }
        const intact = !missing && !changed && !missingEv;
        const b = this.db.prepare("SELECT digest FROM bundles WHERE project_id = ? AND id = ?").get(job.project_id, p.bundle_id!) as { digest: string };
        saveStep(intact ? "complete" : "unavailable", { ...state, offset: off + 500, detail }, { pages: 1, completeness: intact ? `all ${page.page.total_references} pinned record(s) intact` : `${missing} missing, ${changed} changed, ${missingEv} evidence record(s) missing` });
        const applied = this.apply(job, [this.resultFor(job, step, intact ? "satisfied" : "unavailable", intact ? `every pinned record (${page.page.total_references}) read and matching its digest` : `${missing} pinned record(s) missing, ${changed} changed, ${missingEv} evidence record(s) missing since the bundle was pinned`, { validity: { bundle_digest: b.digest.slice(0, 64) } })], actor);
        return { units: 1, applied };
      });
    }

    // linked_events
    const ids = p.event_ids ?? [];
    const kase = this.db.prepare("SELECT body, ref FROM case_items WHERE case_id = ? AND kind = 'event' AND removed_at IS NULL").all(job.case_id) as { body: string; ref: string }[];
    const linkedDigest = new Map(kase.map((k) => [k.ref, (JSON.parse(k.body) as { event_digest?: string }).event_digest]));
    const stored = new Map(this.store.eventsByIds(job.project_id, ids).map((e) => [e.id, e]));
    const bad = ids.filter((id) => !stored.get(id) || sha256(canonicalJson(stored.get(id)!)) !== linkedDigest.get(id));
    return commit(() => {
      this.deliver(job, step, ids.filter((id) => !bad.includes(id)).map((id) => ({ ref: id, kind: "event", role: "linked" })));
      saveStep(bad.length ? "unavailable" : "complete", state, { completeness: bad.length ? `${bad.length} linked event(s) missing or changed` : `${ids.length} linked event(s) intact` });
      const applied = this.apply(job, [this.resultFor(job, step, bad.length ? "unavailable" : "satisfied", bad.length ? `${bad.length} linked event(s) missing or changed since linking: ${bad.slice(0, 5).join(", ")}` : `${ids.length} linked event(s) intact`, { validity: { digest: this.contracts.linkedDigest(job.project_id, ids) } })], actor);
      return { units: 1, applied };
    });
  }
}

export const RECIPE_IDS = RECIPES.map((r) => r.id);
