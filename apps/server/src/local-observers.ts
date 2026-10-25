import { canonicalJson } from "@dk/contracts";
import { sha256 } from "./security.ts";
import { HttpError, type Store } from "./store.ts";
import { provenanceOf } from "./provenance.ts";

/**
 * li-next B: observer capability state of a local run (`dk.local.observer_state.v1`).
 *
 * The supervisor side of a local run (the launcher holding the run's operator token, never an investigator) reports
 * each independent observer's capability as the supervisor's own observer objects know it: running, stopped,
 * misconfigured (running but detached from a declared resource) or absent (no live observer in the compiled world),
 * what it is declared to observe, what it observes now, since when, the run's revision string for it and its
 * capability history. Digital Kingdom records every report append-only (that is the history across reports) and the
 * analysis state turns the latest into `observer` elements, so the LP14 generator can propose a typed
 * `restart_test_observer` repair bound to the exact observer revision the lease precondition checks.
 *
 * What this is not: it is not evidence about requests or effects, it is never read from scenario truth / a private
 * oracle, and it is not attested (the launcher reports it, like the configuration snapshot). It is accepted only for a
 * project with valid local-run provenance whose run id matches. Admin only (the launcher); reading needs analyst.
 */
export const OBSERVER_STATE_SCHEMA = "dk.local.observer_state.v1";
export const OBSERVER_STATES = ["running", "stopped", "misconfigured", "absent", "unknown"] as const;
/** States the reviewed restart template can act on. Everything else is an explicit no-applicable-candidate. */
export const RESTARTABLE_OBSERVER_STATES = ["stopped", "misconfigured"] as const;
export type ObserverState = (typeof OBSERVER_STATES)[number];
export const LOCAL_OBSERVERS_MIGRATION = `
CREATE TABLE local_observer_reports (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, stored_by TEXT NOT NULL, stored_at TEXT NOT NULL);
CREATE INDEX local_observer_reports_project ON local_observer_reports (project_id, stored_at);
CREATE TRIGGER local_observer_reports_append_only_u BEFORE UPDATE ON local_observer_reports BEGIN SELECT RAISE(ABORT, 'local observer reports are append-only'); END;
CREATE TRIGGER local_observer_reports_append_only_d BEFORE DELETE ON local_observer_reports BEGIN SELECT RAISE(ABORT, 'local observer reports are append-only'); END;`;

export interface ObserverHistoryEntry { state: ObserverState; since: string; until: string | null; reason: string }
export interface ObserverReportEntry { observer_id: string; state: ObserverState; declared: string[]; observes: string[]; since: string; revision: string | null; reason: string; history: ObserverHistoryEntry[] }
export interface ObserverStateReport { schema: typeof OBSERVER_STATE_SCHEMA; run_id: string; observers: ObserverReportEntry[] }
export interface StoredObserverState extends ObserverStateReport { id: string; digest: string; stored_at: string }

const PLAIN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const isTime = (v: unknown) => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

export function latestObserverState(store: Store, projectId: string): StoredObserverState | null {
  const r = store.db.prepare("SELECT id, body, digest, stored_at FROM local_observer_reports WHERE project_id = ? ORDER BY stored_at DESC, rowid DESC LIMIT 1").get(projectId) as { id: string; body: string; digest: string; stored_at: string } | undefined;
  return r ? { ...(JSON.parse(r.body) as ObserverStateReport), id: r.id, digest: r.digest, stored_at: r.stored_at } : null;
}

/** Per observer: every reported state in order (history across reports), the current one and the supervisor's own history. */
export function observerHistory(store: Store, projectId: string) {
  const rows = store.db.prepare("SELECT id, body, stored_at FROM local_observer_reports WHERE project_id = ? ORDER BY stored_at, rowid").all(projectId) as { id: string; body: string; stored_at: string }[];
  const out: Record<string, { reports: { report_id: string; stored_at: string; state: ObserverState; since: string; revision: string | null }[]; current: ObserverReportEntry | null; supervisor_history: ObserverHistoryEntry[] }> = {};
  for (const r of rows) for (const o of (JSON.parse(r.body) as ObserverStateReport).observers) {
    const h = (out[o.observer_id] ??= { reports: [], current: null, supervisor_history: [] });
    h.reports.push({ report_id: r.id, stored_at: r.stored_at, state: o.state, since: o.since, revision: o.revision });
    h.current = o; h.supervisor_history = o.history;
  }
  return { schema: "dk.local.observer_history.v1", project_id: projectId, observers: out, note: "Launcher-reported supervisor facts (not attested); not evidence of what happened." };
}

export function recordObserverState(store: Store, projectId: string, body: Record<string, unknown>, actor: string) {
  const project = store.getProject(projectId);
  if (!project) throw new HttpError(404, "project not found");
  const prov = provenanceOf(project);
  if (!prov.local_run) throw new HttpError(409, "an observer state report is accepted only for a project with valid local run provenance");
  const bad = Object.keys(body).filter((k) => !["schema", "run_id", "observers"].includes(k));
  if (bad.length) throw new HttpError(422, `unsupported field(s) ${bad.join(", ")}`);
  if (body.schema !== OBSERVER_STATE_SCHEMA) throw new HttpError(422, `schema must be ${OBSERVER_STATE_SCHEMA}`);
  if (body.run_id !== prov.run_id) throw new HttpError(409, `the report names run ${String(body.run_id).slice(0, 80)}, not this project's run`);
  if (!Array.isArray(body.observers) || !body.observers.length || body.observers.length > 20) throw new HttpError(422, "observers must list 1-20 observers");
  const graph = store.getGraph(projectId);
  const assets = new Set((graph?.assets ?? []).map((a) => a.id));
  const sources = new Map(store.listSources(projectId).map((s) => [s.id, s]));
  const assetList = (v: unknown, where: string) => {
    if (!Array.isArray(v) || v.length > 50 || v.some((x) => typeof x !== "string" || !PLAIN.test(x))) throw new HttpError(422, `${where} must be a list of plain asset ids`);
    const missing = (v as string[]).filter((x) => !assets.has(x));
    if (missing.length) throw new HttpError(422, `${where}: ${missing.join(", ")} is not an asset of this project's graph`);
    return [...new Set(v as string[])].sort();
  };
  const observers = body.observers.map((x, i): ObserverReportEntry => {
    const o = x as Record<string, unknown>;
    const w = `observers[${i}]`;
    if (!o || typeof o !== "object" || Array.isArray(o)) throw new HttpError(422, `${w} must be an object`);
    const extra = Object.keys(o).filter((k) => !["observer_id", "state", "declared", "observes", "since", "revision", "reason", "history"].includes(k));
    if (extra.length) throw new HttpError(422, `${w} unsupported field(s) ${extra.join(", ")}`);
    if (typeof o.observer_id !== "string" || !PLAIN.test(o.observer_id)) throw new HttpError(422, `${w}.observer_id must be a plain id`);
    if (assets.has(o.observer_id)) throw new HttpError(422, `${w}: ${o.observer_id} is a service asset of the graph, not an independent observer`);
    const src = sources.get(o.observer_id);
    if (src && src.kind !== "effect_observer") throw new HttpError(422, `${w}: source ${o.observer_id} is registered as ${src.kind}, not an effect observer`);
    if (!OBSERVER_STATES.includes(o.state as ObserverState)) throw new HttpError(422, `${w}.state must be one of ${OBSERVER_STATES.join(", ")}`);
    const declared = assetList(o.declared, `${w}.declared`), observes = assetList(o.observes, `${w}.observes`);
    if (observes.some((a) => !declared.includes(a))) throw new HttpError(422, `${w}.observes must be a subset of declared`);
    if (!isTime(o.since)) throw new HttpError(422, `${w}.since must be a timestamp`);
    if (o.revision !== null && (typeof o.revision !== "string" || !PLAIN.test(o.revision))) throw new HttpError(422, `${w}.revision must be the run's plain revision string or null`);
    if (o.revision === null && o.state !== "absent" && o.state !== "unknown") throw new HttpError(422, `${w}.revision is required for a live observer`);
    if (o.reason !== undefined && (typeof o.reason !== "string" || o.reason.length > 300)) throw new HttpError(422, `${w}.reason must be at most 300 characters`);
    const hist = o.history ?? [];
    if (!Array.isArray(hist) || hist.length > 50) throw new HttpError(422, `${w}.history must be a list of at most 50 intervals`);
    const history = hist.map((hx, j): ObserverHistoryEntry => {
      const h = hx as Record<string, unknown>;
      if (!h || typeof h !== "object" || Object.keys(h).some((k) => !["state", "since", "until", "reason"].includes(k))) throw new HttpError(422, `${w}.history[${j}] needs exactly state, since, until, reason`);
      if (!OBSERVER_STATES.includes(h.state as ObserverState) || !isTime(h.since) || (h.until !== null && !isTime(h.until)) || typeof h.reason !== "string" || h.reason.length > 300) throw new HttpError(422, `${w}.history[${j}] is malformed`);
      return { state: h.state as ObserverState, since: h.since as string, until: (h.until as string | null) ?? null, reason: h.reason };
    });
    return { observer_id: o.observer_id, state: o.state as ObserverState, declared, observes, since: o.since as string, revision: (o.revision as string | null) ?? null, reason: (o.reason as string | undefined) ?? "", history };
  });
  if (new Set(observers.map((o) => o.observer_id)).size !== observers.length) throw new HttpError(422, "observer ids must be unique");
  observers.sort((a, b) => a.observer_id.localeCompare(b.observer_id));
  const rep: ObserverStateReport = { schema: OBSERVER_STATE_SCHEMA, run_id: String(prov.run_id), observers };
  const digest = sha256(canonicalJson(rep));
  const at = store.now().toISOString();
  const id = `lobs_${sha256(`${projectId}:${digest}:${at}:${Math.random()}`).slice(0, 16)}`;
  store.db.prepare("INSERT INTO local_observer_reports (id, project_id, run_id, body, digest, stored_by, stored_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, projectId, rep.run_id, canonicalJson(rep), digest, actor, at);
  store.audit(actor, "local.observer_state", projectId, id, { digest, observers: observers.length, states: observers.map((o) => `${o.observer_id}:${o.state}`).join(",").slice(0, 300) });
  return { id, digest, stored_at: at, ...rep };
}
