import { useContext, useEffect, useState } from "react";
import { ActionsCtx } from "../../inspector/actions.tsx";

/** R07.1: controls with their verification state. "Configured" is never shown as effective. */
type Ctl = { id: string; name: string; kind: string; asset_ids: string[]; state: string; state_reason: string };
type Detail = Ctl & { scope: string; policy_version: string; config_digest: string; tests: { id: string; outcome: string; conditions: string; observer: string; observer_available: boolean; applies_to_current_config: boolean; run_at: string; expires_at: string }[] };
const LABEL: Record<string, string> = { declared: "Declared, never tested", configured: "Configured, not behaviourally tested", tested: "Tested under current config", failed: "Failed latest test", stale: "Stale: retest needed", unknown: "Inconclusive" };

export function ControlsPanel() {
  const actions = useContext(ActionsCtx);
  const [list, setList] = useState<Ctl[] | null>(null), [open, setOpen] = useState<Detail | null>(null), [err, setErr] = useState("");
  useEffect(() => { if (!actions) return; const c = new AbortController(); actions.controls(c.signal).then((r) => setList(r.controls), (e) => setErr((e as Error).message)); return () => c.abort(); }, [actions]);
  if (!actions) return <p className="small">Controls are available when connected to a Digital Kingdom server.</p>;
  if (err) return <p className="scope-note warning" role="alert">{err}</p>;
  if (!list) return <p className="small">Loading controls…</p>;
  if (!list.length) return <div className="empty"><h3>No controls declared.</h3><p>Declared controls appear here with their test history. A drawn shield is never a tested control.</p></div>;
  return <div data-testid="controls-panel">
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Controls"><table className="record-table"><thead><tr><th scope="col">Control</th><th scope="col">State</th><th scope="col">Why</th></tr></thead><tbody>
      {list.map((c) => <tr key={c.id} data-control-state={c.state}><td className="record-title"><button className="link" onClick={() => actions.control(c.id).then(setOpen, (e) => setErr((e as Error).message))}>{c.name}</button><small>{c.kind} · {c.asset_ids.join(", ")}</small></td><td><span className={`status-chip ${c.state === "tested" ? "coverage-reporting" : "warning"}`}>{LABEL[c.state] ?? c.state}</span></td><td>{c.state_reason}</td></tr>)}
    </tbody></table></div>
    {open && <article className="section-card" aria-label={`Control ${open.name}`}><h3>{open.name}</h3><p className="small">Scope: {open.scope} · policy {open.policy_version} · config {open.config_digest.slice(0, 19)}…</p>
      <ul className="mini-list">{open.tests.map((t) => <li key={t.id}><strong>{t.outcome}</strong> {new Date(t.run_at).toLocaleString()} by observer {t.observer}{t.observer_available ? "" : " (unavailable)"}{t.applies_to_current_config ? "" : " · for an earlier config"}<br /><small>{t.conditions}</small></li>)}{!open.tests.length && <li>No tests recorded.</li>}</ul></article>}
  </div>;
}
