import { useCallback, useContext, useEffect, useState } from "react";
import { ActionsCtx } from "../../inspector/actions.tsx";
import { useApp } from "../../lib/state.tsx";

/**
 * LP04/LP06: "Create local world" preview and the local run's reporting view.
 *
 * Preview is a pure server read of a reviewed blueprint: resources, declared sources and their authority, observation
 * gaps, budgets. The console never starts processes: a run is started by the local supervisor (`pnpm world`).
 * Reporting lists every DECLARED (source, asset, action) capability of the current local-run project and what has
 * actually arrived; "silent" means nothing arrived, never that nothing happened.
 */
export interface WorldPreview {
  revision: string; plan_id: string; catalog: { version: string };
  resources: { id: string; template: string; version: string; depends_on: string[]; asset_kind: string | null }[];
  sources: { id: string; kind: string; role: string; asset_ids: string[]; independence_group: string }[];
  routes: { key: string; owners: string[]; status: string }[];
  gaps: string[]; limitations: string[]; budget: Record<string, number>; runtime_mode: string;
  provenance: { label: string };
}
export interface ReportingView {
  summary: { sources: number; capabilities: number; reporting: number; silent: number; unavailable: number };
  sources: { source_id: string; label: string; kind: string; role: string; independence_group: string; coverage_state: string; health: { state: string; since?: string | null }; rejected: number; capabilities: { asset_id: string; action: string; status: string; events: number; last_event_at: string | null }[] }[];
  note: string;
}
export const BLUEPRINT_OPTIONS = [{ id: "saas-storefront", label: "SaaS storefront" }, { id: "agent-workspace", label: "Agent workspace" }, { id: "delivery-identity", label: "Delivery and identity" }] as const;

export function PreviewView({ p }: { p: WorldPreview }) {
  return <div data-testid="world-preview">
    <p className="scope-note">{p.provenance.label}. Revision <code>{p.revision}</code> · catalog <code>{p.catalog.version}</code> · {p.runtime_mode} · no external network.</p>
    <h4>Resources ({p.resources.length})</h4>
    <table className="data-table"><thead><tr><th>Resource</th><th>Template</th><th>Depends on</th></tr></thead><tbody>
      {p.resources.map((r) => <tr key={r.id}><td>{r.id}</td><td>{r.template}@{r.version}{r.asset_kind ? "" : " (observer)"}</td><td>{r.depends_on.join(", ") || "none"}</td></tr>)}
    </tbody></table>
    <h4>Declared sources and authority</h4>
    <ul>{p.sources.map((s) => <li key={s.id} data-source-role={s.role}><strong>{s.id}</strong> · {s.kind} · {s.role === "independent_observer" ? "independent observer" : "self-report"} · scope {s.asset_ids.join(", ")} · group <code>{s.independence_group}</code></li>)}</ul>
    <h4>Observation gaps</h4>
    <ul className="gap-list">{p.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
    <details><summary>Limitations ({p.limitations.length})</summary><ul>{p.limitations.map((l) => <li key={l}>{l}</li>)}</ul></details>
    <p className="small">Budget: {Object.entries(p.budget).map(([k, v]) => `${k} ${v}`).join(" · ")}. Endpoints are allocated by the run supervisor at start; start a run with <code>pnpm world</code>. This console never launches processes.</p>
  </div>;
}

export function ReportingTable({ view }: { view: ReportingView }) {
  return <div data-testid="world-reporting">
    <p className="small" role="status">{view.summary.reporting} reporting · {view.summary.silent} silent · {view.summary.unavailable} unavailable, of {view.summary.capabilities} declared capabilities from {view.summary.sources} sources.</p>
    <table className="data-table"><thead><tr><th>Source</th><th>Role</th><th>Asset</th><th>Capability</th><th>State</th><th>Events</th></tr></thead><tbody>
      {view.sources.flatMap((s) => s.capabilities.map((c) => <tr key={`${s.source_id}:${c.asset_id}:${c.action}`} data-capability-status={c.status}><td>{s.source_id}</td><td>{s.role === "independent_observer" ? "independent observer" : "self-report"}</td><td>{c.asset_id}</td><td>{c.action}</td><td><span className="chip">{c.status}</span></td><td>{c.events}</td></tr>))}
    </tbody></table>
    {view.sources.filter((s) => s.health.state === "unavailable").map((s) => <p key={s.source_id} className="scope-note warning" role="alert">{s.source_id} reported itself unavailable since {s.health.since}; effects in that interval are unknown.</p>)}
    <p className="scope-note">{view.note}</p>
  </div>;
}

export function LocalWorldPanel() {
  const actions = useContext(ActionsCtx);
  const { vm } = useApp();
  const local = vm.latestData.project.provenance?.local_run === true;
  const [blueprint, setBlueprint] = useState<string>("saas-storefront");
  const [preview, setPreview] = useState<WorldPreview | null>(null), [reporting, setReporting] = useState<ReportingView | null>(null), [error, setError] = useState("");
  const loadReporting = useCallback((signal?: AbortSignal) => { if (actions?.localWorldReporting && local) actions.localWorldReporting(signal).then((v) => setReporting(v as ReportingView), (e: Error) => { if (!signal?.aborted) setError(e.message); }); }, [actions, local]);
  useEffect(() => { const c = new AbortController(); loadReporting(c.signal); return () => c.abort(); }, [loadReporting]);
  if (!actions?.localWorldPreview) return <div className="empty"><h3>Local worlds are previewed by the server.</h3><p>The offline demo has no server; nothing can be previewed or started here.</p></div>;
  const run = async () => { setError(""); try { setPreview(await actions.localWorldPreview!({ blueprint, seed: "preview" }) as WorldPreview); } catch (e) { setError((e as Error).message); } };
  return <div className="integration-grid" data-testid="local-world">
    <article className="section-card">
      <h3>Create local world</h3>
      <p>Preview a reviewed blueprint: its resources, declared sources, observation gaps and budgets. No provider account or credential is needed.</p>
      <label className="field">Blueprint<select aria-label="Blueprint" value={blueprint} onChange={(e) => setBlueprint(e.target.value)}>{BLUEPRINT_OPTIONS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
      <button className="secondary" onClick={() => void run()}>Preview</button>
      {error && <p className="scope-note warning" role="alert">{error}</p>}
      {preview && <PreviewView p={preview} />}
    </article>
    <article className="section-card" aria-label="Local capabilities reporting">
      <h3>Which local capabilities are reporting</h3>
      {!local ? <p className="small faint">This project is not a local-run project. Start a local world with <code>pnpm world</code> and open its lab project.</p> : reporting ? <ReportingTable view={reporting} /> : <p className="small faint">Loading reporting state…</p>}
    </article>
  </div>;
}
