import { useMemo, useState } from "react";
import { CONNECTION_LABEL, type Connection } from "../lib/connection.ts";
import { useApp } from "../lib/state.tsx";
import { Icon } from "../lib/icons.tsx";
import { fmtTime } from "../lib/vocab.ts";

export function BrandMark({ size = 18 }: { size?: number }) {
  return <Icon name="castle" size={size} />;
}
export function TopBar({ onSignIn, onSignOut, onProject, connection }: { onSignIn?: () => void; onSignOut?: () => void; onProject?: (id: string) => void; connection: Connection | null }) {
  const { ui, dispatch, vm } = useApp(); const d = vm.data;
  const [query, setQuery] = useState(""); const [searchOpen, setSearchOpen] = useState(false);
  const environments = [...new Set(d.graph.assets.map((a) => a.environment))];
  const environment = environments.length > 1 ? "Multiple environments" : environments[0] ?? "Environment not declared";
  const results = useMemo(() => {
    const q = query.trim().toLowerCase(); if (!q) return [];
    return [...d.graph.assets.filter((a) => `${a.id} ${a.name}`.toLowerCase().includes(q)).map((a) => ({ id: a.id, name: a.name, kind: "asset" as const })), ...vm.findings.filter((f) => `${f.id} ${f.title}`.toLowerCase().includes(q)).map((f) => ({ id: f.id, name: f.title, kind: "finding" as const }))].slice(0, 12);
  }, [query, d.graph.assets, vm.findings]);
  return <header className="topbar">
    <div className="brand"><span className="brand-mark"><BrandMark /></span><span className="brand-name">Digital Kingdom</span></div>
    <div className="project">
      {d.projects.length > 1 && onProject ? <select className="project-select" value={d.project.id} onChange={(e) => onProject(e.target.value)} aria-label="Project">{d.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : <span className="project-name" title={d.project.name}>{d.project.name}</span>}
      <span className="project-meta"><span className="environment-badge">{environment}</span><span className={`pill ${d.project.dataset_kind === "synthetic" ? "synthetic" : "telemetry"}`}>{d.project.dataset_kind === "synthetic" ? "Synthetic demo" : "Telemetry"}</span></span>
    </div>
    <div className="header-search" role="search" aria-label="Local navigation" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSearchOpen(false); }}>
      <div className="search-wrap"><Icon name="search" size={16} /><input className="search" type="search" autoComplete="off" placeholder="Jump to asset or finding" aria-label="Search assets and findings" aria-describedby="navigation-search-scope" value={query} onFocus={() => setSearchOpen(true)} onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setSearchOpen(false); } if (e.key === "ArrowDown") { e.preventDefault(); e.currentTarget.closest(".header-search")?.querySelector<HTMLButtonElement>(".search-results button")?.focus(); } }} />{ui.shortcuts && <span className="kbd" aria-hidden>/</span>}</div>
      <span className="sr-only" id="navigation-search-scope">Searches loaded authorized asset and finding names and IDs. Search recorded events in Investigate.</span>
      {searchOpen && query.trim() && <div className="search-results" aria-label="Navigation results"><p>{results.length ? "Loaded records · choose to inspect" : "No loaded asset or finding matches."}</p>{results.map((r) => <button key={`${r.kind}:${r.id}`} className="row" onClick={() => { dispatch({ type: "select", selection: { kind: r.kind, id: r.id }, announce: `Selected ${r.name}` }); dispatch({ type: "workspace", workspace: r.kind === "finding" ? "investigate" : "kingdom" }); if (r.kind === "finding") dispatch({ type: "investigateTab", tab: "findings" }); setSearchOpen(false); setQuery(""); }}><Icon name={r.kind === "asset" ? "cube" : "list"} /><span className="row-main"><span className="row-title">{r.name}</span><span className="row-meta">{r.kind} · {r.id}</span></span></button>)}</div>}
    </div>
    {connection && <span className={`pill header-connection conn-${connection.state}`} role="status" aria-live={ui.reduceAutomaticAnnouncements ? "off" : "polite"} title={connection.since ? `Synchronized at ${fmtTime(connection.since)}. Browser synchronization is separate from source visibility.` : "Browser synchronization is separate from source visibility."} data-testid="connection-pill" data-state={connection.state}><span className="pip" aria-hidden />{connection.state === "live" ? "Connected" : CONNECTION_LABEL[connection.state]}</span>}
    <button aria-label={`${vm.summary.assetsWithGaps} assets with visibility gaps`} title="Review coverage gaps" className="btn ghost coverage-shortcut" onClick={() => { dispatch({ type: "workspace", workspace: "coverage" }); dispatch({ type: "panel", panel: "inspector", open: false }); }}><Icon name="layers" />{vm.summary.assetsWithGaps} gaps</button>
    {d.mode === "server" && <div className="header-auth">{d.role === "none" ? <button className="btn" onClick={onSignIn}>Sign in</button> : <button className="btn ghost" onClick={onSignOut} title={`${d.identity ?? d.role} · Sign out`}>Sign out</button>}</div>}
  </header>;
}
