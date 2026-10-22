import { useApp } from "../lib/state.tsx";
import { LAYER_STYLE, type Layer } from "../lib/vocab.ts";

export function TopBar({ onSignIn, onSignOut, onProject, connection }: { onSignIn?: () => void; onSignOut?: () => void; onProject?: (id: string) => void; connection: string | null }) {
  const { ui, dispatch, vm } = useApp();
  const d = vm.data;
  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden><path d="M12 52V26h6v-6h6v6h4v-10h8v10h4v-6h6v6h6v26H38V40a6 6 0 0 0-12 0v12z" fill="#d8c9a3" /><path d="M28 16l4-6 4 6" fill="#e3b55b" /></svg>
        <span className="brand-name">Digital Kingdom</span>
      </div>
      {d.projects.length > 1 && onProject ? (
        <select className="project-select" value={d.project.id} onChange={(e) => onProject(e.target.value)} aria-label="Project">
          {d.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      ) : <span className="project-name">{d.project.name}</span>}
      {d.project.dataset_kind === "synthetic"
        ? <span className="badge demo" title="All data in this project is synthetic. It is not production monitoring.">SYNTHETIC DEMO</span>
        : <span className="badge live">LIVE · read-only</span>}
      {d.mode === "offline-demo" && <span className="badge muted" title="Running entirely in your browser from bundled fixtures, using the same engine as the server.">offline</span>}
      {connection && <span className={`badge conn ${connection}`}>{connection === "live" ? "● streaming" : connection}</span>}
      <div className="spacer" />
      <input className="search" type="search" placeholder="Search assets & findings" value={ui.query} onChange={(e) => dispatch({ type: "query", query: e.target.value })} aria-label="Search assets and findings" />
      <div className="seg" role="radiogroup" aria-label="View">
        <button role="radio" aria-checked={ui.view === "castle"} className={ui.view === "castle" ? "on" : ""} disabled={!!ui.webglFailed} onClick={() => dispatch({ type: "view", view: "castle" })} title={ui.webglFailed ?? "3D castle"}>Castle</button>
        <button role="radio" aria-checked={ui.view === "graph"} className={ui.view === "graph" ? "on" : ""} onClick={() => dispatch({ type: "view", view: "graph" })}>2D graph</button>
      </div>
      <details className="menu">
        <summary className="btn ghost">Layers</summary>
        <div className="menu-body">
          {(Object.keys(LAYER_STYLE) as Layer[]).map((l) => (
            <label key={l} className="check"><input type="checkbox" checked={ui.layers[l]} onChange={(e) => dispatch({ type: "layer", layer: l, on: e.target.checked })} /><span className="swatch" style={{ background: LAYER_STYLE[l].color }} />{LAYER_STYLE[l].label}</label>
          ))}
          <label className="check"><input type="checkbox" checked={ui.showHypothetical} onChange={(e) => dispatch({ type: "hypothetical", on: e.target.checked })} /><span className="swatch dashed" />Hypothetical paths</label>
          <hr />
          <label className="check"><input type="checkbox" checked={ui.roofs} onChange={(e) => dispatch({ type: "roofs", roofs: e.target.checked })} />Show roofs</label>
          <label className="check"><input type="checkbox" checked={ui.reducedMotion} onChange={(e) => dispatch({ type: "reducedMotion", on: e.target.checked })} />Reduce motion</label>
        </div>
      </details>
      {d.mode === "server" && (d.role === "none"
        ? <button className="btn" onClick={onSignIn}>Sign in</button>
        : <button className="btn ghost" onClick={onSignOut} title="Sign out">{d.identity ?? d.role}</button>)}
    </header>
  );
}
