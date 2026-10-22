import type { Connection } from "../lib/connection.ts";
import { useApp } from "../lib/state.tsx";
import { LAYER_STYLE, type Layer } from "../lib/vocab.ts";
import { Icon } from "../lib/icons.tsx";

export function BrandMark({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden fill="currentColor">
      <path d="M3 21V9.5h3V7h2.5v2.5H10V5h4v4.5h1.5V7H18v2.5h3V21h-7.5v-4.25a1.5 1.5 0 0 0-3 0V21z" />
    </svg>
  );
}

export function TopBar({ onSignIn, onSignOut, onProject, connection }: { onSignIn?: () => void; onSignOut?: () => void; onProject?: (id: string) => void; connection: Connection | null }) {
  const { ui, dispatch, vm } = useApp();
  const d = vm.data;
  return (
    <header className="topbar">
      <button className="icon-btn" onClick={() => dispatch({ type: "panel", panel: "sidebar", open: !ui.sidebar })} aria-pressed={ui.sidebar} aria-label={ui.sidebar ? "Hide findings list" : "Show findings list"} title="Toggle list  [">
        <Icon name="panel-left" />
      </button>
      <div className="brand">
        <span className="brand-mark"><BrandMark /></span>
        <span className="brand-name">Digital Kingdom</span>
      </div>
      <span className="crumb-sep hide-narrow" aria-hidden>/</span>
      <div className="project">
        {d.projects.length > 1 && onProject ? (
          <select className="project-select" value={d.project.id} onChange={(e) => onProject(e.target.value)} aria-label="Project">
            {d.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        ) : <span className="project-name" title={d.project.name}>{d.project.name}</span>}
        <span className="project-meta">
          {d.project.dataset_kind === "synthetic"
            ? <span className="pill synthetic" title="All data in this project is synthetic. It is not production monitoring.">Synthetic</span>
            : <span className="pill live" title="Live project, read-only view">Live</span>}
          {d.mode === "offline-demo" && <span className="pill" title="Running entirely in your browser from bundled fixtures, using the same engine as the server.">Offline</span>}
          {connection && <span className={`pill conn-${connection.state}`} aria-live="polite" data-testid="connection-pill" data-state={connection.state}><span className="pip" aria-hidden />{connection.state === "live" ? "Streaming" : connection.state === "lost" ? "Disconnected" : "Reconnecting"}</span>}
        </span>
      </div>
      <div className="spacer" />
      <div className="seg" role="radiogroup" aria-label="View">
        <button role="radio" aria-checked={ui.view === "castle"} className={ui.view === "castle" ? "on" : ""} disabled={!!ui.webglFailed} onClick={() => dispatch({ type: "view", view: "castle" })} title={ui.webglFailed ?? "3D castle  (3)"}>
          <Icon name="cube" size={14} />3D
        </button>
        <button role="radio" aria-checked={ui.view === "graph"} className={ui.view === "graph" ? "on" : ""} onClick={() => dispatch({ type: "view", view: "graph" })} title="2D graph  (2)">
          <Icon name="graph" size={14} />2D
        </button>
      </div>
      <div className="spacer" />
      <div className="search-wrap">
        <Icon name="search" size={14} />
        <input className="search" type="search" placeholder="Search assets and findings" value={ui.query} onChange={(e) => dispatch({ type: "query", query: e.target.value })} aria-label="Search assets and findings" />
        {!ui.query && <span className="kbd" aria-hidden>/</span>}
      </div>
      <details className="menu">
        <summary className="icon-btn" aria-label="Layers and display options" title="Layers"><Icon name="layers" /></summary>
        <div className="menu-body">
          <div className="menu-title">Relationship layers</div>
          {(Object.keys(LAYER_STYLE) as Layer[]).map((l) => (
            <label key={l} className="check"><input type="checkbox" checked={ui.layers[l]} onChange={(e) => dispatch({ type: "layer", layer: l, on: e.target.checked })} />{LAYER_STYLE[l].label}<span className="swatch" style={{ background: LAYER_STYLE[l].color }} aria-hidden /></label>
          ))}
          <label className="check"><input type="checkbox" checked={ui.showHypothetical} onChange={(e) => dispatch({ type: "hypothetical", on: e.target.checked })} />Hypothetical paths<span className="swatch dashed" aria-hidden /></label>
          <hr />
          <div className="menu-title">Display</div>
          <label className="check"><input type="checkbox" checked={ui.roofs} onChange={(e) => dispatch({ type: "roofs", roofs: e.target.checked })} />Show roofs</label>
          <label className="check"><input type="checkbox" checked={ui.reducedMotion} onChange={(e) => dispatch({ type: "reducedMotion", on: e.target.checked })} />Reduce motion</label>
        </div>
      </details>
      <button className="icon-btn" onClick={() => dispatch({ type: "panel", panel: "inspector", open: !ui.inspector })} aria-pressed={ui.inspector} aria-label={ui.inspector ? "Hide inspector" : "Show inspector"} title="Toggle inspector  ]">
        <Icon name="panel-right" />
      </button>
      {d.mode === "server" && <span className="vr" aria-hidden />}
      {d.mode === "server" && (d.role === "none"
        ? <button className="btn sm" onClick={onSignIn}>Sign in</button>
        : <button className="btn ghost sm" onClick={onSignOut} title="Sign out">{d.identity ?? d.role}</button>)}
    </header>
  );
}
