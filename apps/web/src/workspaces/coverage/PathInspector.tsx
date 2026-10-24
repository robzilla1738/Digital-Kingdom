import { useContext, useRef, useState } from "react";
import { useApp } from "../../lib/state.tsx";
import { ActionsCtx } from "../../inspector/actions.tsx";
import { hopStyle, REACHABLE_LABEL, type PathExplanation, type PathHop } from "../../lib/pathInspector.ts";

/**
 * LP13 "Why can this reach that?": declared/observed relationship paths with per-hop provenance and, optionally, a
 * configured-permission path for a principal/action/resource under the supported evaluator. Lists only; a hop is
 * marked observed only when it is observed activity with evidence references.
 */
export function PathInspector() {
  const { vm, dispatch } = useApp();
  const actions = useContext(ActionsCtx);
  const assets = vm.data.graph.assets;
  const [from, setFrom] = useState(assets[0]?.id ?? ""), [to, setTo] = useState(assets[assets.length - 1]?.id ?? "");
  const [principal, setPrincipal] = useState(""), [action, setAction] = useState(""), [resource, setResource] = useState("");
  const [result, setResult] = useState<PathExplanation | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const seq = useRef(0);
  if (!actions?.analysisPaths || vm.data.mode !== "server") return <div className="empty"><h3>Path exploration needs a server connection.</h3><p>It reads the stored inventory and authorization snapshot.</p></div>;
  const name = (id: string) => assets.find((a) => a.id === id)?.name ?? id;
  const submit = async () => {
    const id = ++seq.current; setBusy(true); setError(""); setResult(null);
    try { const r = await actions.analysisPaths!({ from, to, ...(principal || action || resource ? { principal, action, resource } : {}) }); if (id === seq.current) setResult(r); }
    catch (e) { if (id === seq.current) setError((e as Error).message); } finally { if (id === seq.current) setBusy(false); }
  };
  return <div className="section-card path-inspector" data-testid="path-inspector">
    <h2>Why can this reach that?</h2>
    <p className="small faint">Declared and observed relationships with their provenance. Configured or conditional permission is never observed use.</p>
    <form className="filter-bar" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <label className="field">From<select aria-label="Path from" value={from} onChange={(e) => setFrom(e.target.value)}>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="field">To<select aria-label="Path to" value={to} onChange={(e) => setTo(e.target.value)}>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <details className="path-permission"><summary>Permission (optional)</summary>
        <label className="field">Principal ARN<input aria-label="Principal ARN" value={principal} maxLength={300} onChange={(e) => setPrincipal(e.target.value)} /></label>
        <label className="field">Action<input aria-label="Action" placeholder="s3:GetObject" value={action} maxLength={100} onChange={(e) => setAction(e.target.value)} /></label>
        <label className="field">Resource ARN<input aria-label="Resource ARN" value={resource} maxLength={400} onChange={(e) => setResource(e.target.value)} /></label>
      </details>
      <button className="btn" disabled={busy || !from || !to}>Explain</button>
    </form>
    {error && <p className="scope-note warning" role="alert">{error}</p>}
    {result && <div aria-live="polite" data-testid="path-result">
      <p><strong>{REACHABLE_LABEL[result.reachable]}</strong> <span className="small faint">· {result.namespace} state {result.state_hash.slice(0, 12)} · evaluator {result.evaluator}</span></p>
      {result.unresolved_prerequisites.length > 0 && <ul className="mini-list">{result.unresolved_prerequisites.map((u) => <li key={u}>{u}</li>)}</ul>}
      {result.paths.length > 0 && <ol className="mini-list path-list">{result.paths.map((p, i) => <li key={i}><small className="faint">Path {i + 1}</small><HopList hops={p.hops} name={name} onSelect={(ref) => dispatch({ type: "select", selection: { kind: "relationship", id: ref } })} /></li>)}</ol>}
      {result.permission && <div className="path-permission-result" data-testid="path-permission">
        <h3>Configured permission: {result.permission.result}</h3>
        {result.permission.unresolved_prerequisites.length > 0 && <div className="scope-note warning"><strong>Unresolved prerequisites</strong><ul className="mini-list">{result.permission.unresolved_prerequisites.map((u) => <li key={u}>{u}</li>)}</ul></div>}
        <ol className="mini-list">{result.permission.paths.map((p, i) => <li key={i}><HopList hops={p.hops} name={(x) => x} /><div className="small faint">{p.reasons.join(" ")}</div></li>)}</ol>
      </div>}
      <p className="small faint">{result.note}</p>
    </div>}
  </div>;
}
function HopList({ hops, name, onSelect }: { hops: PathHop[]; name: (id: string) => string; onSelect?: (ref: string) => void }) {
  return <ul className="mini-list hop-list">{hops.map((h, i) => { const s = hopStyle(h); return <li key={i} data-animate={s.animate ? "true" : "false"} data-basis={h.basis}>
    <svg width="28" height="8" aria-hidden="true"><line x1="0" y1="4" x2="28" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray={s.dash || undefined} /></svg>{" "}
    {name(h.from)} → {name(h.to)} <span className="pill">{s.label}</span>{h.relationship_kind ? <small className="faint"> {h.relationship_kind.replace(/_/g, " ")}</small> : null}
    {h.provenance.length > 0 && <small className="faint"> · provenance {h.provenance.slice(0, 3).join(", ")}</small>}
    {h.condition_keys.length > 0 && <small className="faint"> · conditions {h.condition_keys.join(", ")}</small>}
    {onSelect && h.kind === "relationship" && !h.ref.startsWith("proposed:") && <button className="link-btn" onClick={() => onSelect(h.ref)}>select</button>}
  </li>; })}</ul>;
}
