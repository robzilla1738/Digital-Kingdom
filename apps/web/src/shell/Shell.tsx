import { lazy, Suspense, useEffect, useState } from "react";
import { FOCUS_LABEL, type FocusMode } from "../lib/layers.ts";
import { useApp } from "../lib/state.tsx";
import { CONNECTION_BANNER, type Connection } from "../lib/connection.ts";
import { LAYER_STYLE, fmtTime, type Layer } from "../lib/vocab.ts";
import { webglAvailable } from "../lib/webgl.ts";
import { Icon } from "../lib/icons.tsx";
import { TopBar } from "../panels/TopBar.tsx";
import { Sidebar } from "../panels/Sidebar.tsx";
import { EvidencePane } from "../panels/EvidencePane.tsx";
import { Timeline } from "../panels/Timeline.tsx";
import { Legend } from "../panels/Legend.tsx";
import { Graph2D } from "../graph2d/Graph2D.tsx";
import { worldHierarchy, worldViewLabel } from "../lib/world.ts";
import { viewFraming } from "../lib/framing.ts";
import { NarrowComparison } from "../castle/ComparisonPanel.tsx";
import { SplitPane } from "../components/ui/SplitPane.tsx";
import { Tabs, SegmentedControl } from "../components/ui/Tabs.tsx";
import { FindingsWorkspace } from "../workspaces/investigate/FindingsWorkspace.tsx";
import { EventWorkspace } from "../workspaces/investigate/EventWorkspace.tsx";
import { CasesWorkspace } from "../workspaces/investigate/CasesWorkspace.tsx";
import { CoverageWorkspace } from "../workspaces/coverage/CoverageWorkspace.tsx";
import { IntegrationsWorkspace } from "../workspaces/integrations/IntegrationsWorkspace.tsx";
const Castle3D = lazy(() => import("../castle/Castle3D.tsx").then((module) => ({ default: module.Castle3D })));
const ComponentFixtures = lazy(() => import("../components/ui/ComponentFixtures.tsx").then((module) => ({ default: module.ComponentFixtures })));
const ModuleSheet = lazy(() => import("../castle/ModuleSheet.tsx").then((module) => ({ default: module.ModuleSheet })));
const navigation = [{ id: "kingdom", label: "Kingdom", icon: "cube" }, { id: "investigate", label: "Investigate", icon: "search" }, { id: "coverage", label: "Coverage", icon: "layers" }, { id: "integrations", label: "Integrations", icon: "graph" }] as const;
export function Shell(props: { connection: Connection | null; onSignIn: () => void; onSignOut: () => void; onProject: (id: string) => void }) {
  const { ui, dispatch, vm } = useApp(); const [mobileView, setMobileView] = useState<"list" | "map">("list");
  const [expandedFinding, setExpandedFinding] = useState(false), [resultsReturnRevision, setResultsReturnRevision] = useState(0);
  const [findingQueue, setFindingQueue] = useState<{ id: string; title: string }[]>([]);
  const [pendingMapFocus, setPendingMapFocus] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(384); const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [wideInspector, setWideInspector] = useState(() => matchMedia("(min-width:1280px)").matches);
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 1023px)").matches);
  useEffect(() => { const media = matchMedia("(max-width: 1023px)"); const change = () => setNarrow(media.matches); media.addEventListener("change", change); return () => media.removeEventListener("change", change); }, []);
  useEffect(() => { const media = matchMedia("(min-width:1280px)"); const change = () => setWideInspector(media.matches); media.addEventListener("change", change); return () => media.removeEventListener("change", change); }, []);
  useEffect(() => { if (ui.focusRevision > ui.focusHandledRevision) { setMobileView("map"); if (narrow) { dispatch({ type: "panel", panel: "inspector", open: false }); setPendingMapFocus(true); } } }, [ui.focusRevision, ui.focusHandledRevision, narrow, dispatch]);
  useEffect(() => { if (pendingMapFocus && narrow && mobileView === "map" && !ui.inspector && ui.workspace === "kingdom") { document.querySelector<HTMLElement>(".stage")?.focus(); setPendingMapFocus(false); } }, [pendingMapFocus, narrow, mobileView, ui.inspector, ui.workspace]);
  useEffect(() => { if (!narrow || mobileView === "map") { const reason = webglAvailable(); if (reason) dispatch({ type: "webglFailed", reason }); } }, [dispatch, narrow, mobileView]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape") { if (event.defaultPrevented || target?.closest("select,[role=listbox],[role=combobox],input[type=file]")) return; const open = document.querySelector<HTMLDetailsElement>("details.menu[open], details.stage-help[open], details.tl-details[open]"); if (open) { open.open = false; open.querySelector<HTMLElement>("summary")?.focus(); return; } if (!target?.closest("dialog[open]")) window.dispatchEvent(new Event("dk:close-inspector")); return; }
      if (!ui.shortcuts || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || target?.closest("input,textarea,select,[contenteditable=true],dialog,[role=dialog]")) return;
      if (event.key === "/") { event.preventDefault(); document.querySelector<HTMLInputElement>(".search")?.focus(); }
      if (event.key === "2") { dispatch({ type: "view", view: "graph" }); dispatch({ type: "workspace", workspace: "kingdom" }); setMobileView("map"); }
      if (event.key === "3" && !ui.webglFailed) { dispatch({ type: "view", view: "castle" }); dispatch({ type: "workspace", workspace: "kingdom" }); setMobileView("map"); }
      if (event.key === "[") dispatch({ type: "panel", panel: "sidebar", open: !ui.sidebar });
      if (event.key === "]") dispatch({ type: "panel", panel: "inspector", open: !ui.inspector });
    }; addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey);
  }, [dispatch, ui.shortcuts, ui.webglFailed, ui.sidebar, ui.inspector]);
  const showInspector = ui.inspector;
  const expanded = expandedFinding && showInspector && ui.selection?.kind === "finding" && ui.workspace === "investigate" && ui.investigateTab === "findings";
  useEffect(() => { if (!showInspector || ui.selection?.kind !== "finding" || ui.workspace !== "investigate" || ui.investigateTab !== "findings") setExpandedFinding(false); }, [showInspector, ui.selection?.kind, ui.workspace, ui.investigateTab]);
  const expandFinding = () => { setExpandedFinding(true); dispatch({ type: "workspace", workspace: "investigate" }); dispatch({ type: "investigateTab", tab: "findings" }); dispatch({ type: "panel", panel: "inspector", open: true }); };
  const returnToResults = () => { setExpandedFinding(false); setResultsReturnRevision((revision) => revision + 1); dispatch({ type: "panel", panel: "inspector", open: false }); };
  const contextCollapsed = showInspector && workspaceWidth - inspectorWidth - (innerWidth >= 1600 ? 296 : 280) < 560;
  const queryParams = new URLSearchParams(location.search);
  const moduleSheet = queryParams.get("moduleSheet");
  if (vm.data.project.dataset_kind === "synthetic" && queryParams.get("components") === "1") return <Suspense fallback={<div className="fullscreen-msg">Loading synthetic UI fixtures…</div>}><ComponentFixtures /></Suspense>;
  if (vm.data.project.dataset_kind === "synthetic" && (moduleSheet === "all" || moduleSheet === "prototype" || moduleSheet === "near" || moduleSheet === "families")) return <Suspense fallback={<div className="fullscreen-msg">Loading synthetic module comparison…</div>}><ModuleSheet prototype={moduleSheet === "prototype"} near={moduleSheet === "near"} families={moduleSheet === "families"} /></Suspense>;
  return <div className={`app ${ui.reducedMotion ? "reduce-motion" : ""}${ui.selection ? " has-selection" : ""}${showInspector && ui.workspace !== "integrations" ? " is-inspecting" : ""}`}>
    <a href="#main" className="skip" onClick={(event) => { event.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to workspace</a>
    <TopBar {...props} />
    <nav className="primary-nav" aria-label="Primary navigation">{navigation.map((item) => <button key={item.id} className="nav-item" aria-current={ui.workspace === item.id ? "page" : undefined} onClick={() => { dispatch({ type: "workspace", workspace: item.id }); if (item.id === "coverage" || item.id === "integrations") dispatch({ type: "panel", panel: "inspector", open: false }); }}><Icon name={item.icon} size={20} /><span>{item.label}</span></button>)}<div className="nav-footer"><span className="nav-monogram" aria-label="Digital Kingdom">DK</span></div></nav>
    <main id="main" tabIndex={-1} className="workspace" aria-label={`${navigation.find((n) => n.id === ui.workspace)?.label} workspace`}>
      <div className="workspace-toolbar">
        <h1>{navigation.find((n) => n.id === ui.workspace)?.label}</h1>
        {ui.workspace === "kingdom" && <>
          <button className={`${contextCollapsed ? "btn" : "icon-btn"} context-toggle`} onClick={() => { if (contextCollapsed) { dispatch({ type: "panel", panel: "inspector", open: false }); dispatch({ type: "panel", panel: "sidebar", open: true }); } else dispatch({ type: "panel", panel: "sidebar", open: !ui.sidebar }); }} aria-pressed={ui.sidebar && !contextCollapsed} aria-label={ui.sidebar && !contextCollapsed ? "Hide findings list" : "Show findings list"}><Icon name="panel-left" />{contextCollapsed && <span>Show list</span>}</button>
          <SegmentedControl label="View" value={ui.view} onChange={(view) => { dispatch({ type: "view", view }); setMobileView("map"); }} options={[{ value: "castle", label: <><Icon name="cube" size={15} /><span aria-label="3D castle">Castle</span></>, disabled: !!ui.webglFailed }, { value: "graph", label: <><Icon name="graph" size={15} /><span aria-label="2D graph">Graph</span></> }]} />
          <button className="btn mobile-map-switch" onClick={() => setMobileView(mobileView === "map" ? "list" : "map")}>{mobileView === "map" ? "Show list" : "Show map"}</button>
          <span className="toolbar-scope">{vm.summary.urgentFindings} high / critical · {vm.summary.reviewFindings} require review</span>
          <WorldFraming />
          {(() => { const label = worldViewLabel({ isLatest: vm.isLatest, at: fmtTime(vm.at), basis: ui.basis, graphRevision: vm.data.graph.graph_revision, layoutVersion: vm.data.scene.layout_version }); return <span className="toolbar-scope world-view-label" data-testid="world-view-label" data-view-mode={label.mode}>{label.text}</span>; })()}
          {ui.caseId && <span className="toolbar-scope case-scope-chip" data-testid="case-scope" data-case-id={ui.caseId}>Case scope · {ui.caseScope?.title ?? ui.caseId}{ui.caseScope ? ` · ${ui.caseScope.assetIds.length} scoped asset${ui.caseScope.assetIds.length === 1 ? "" : "s"}` : ""} <button className="link" onClick={() => { dispatch({ type: "workspace", workspace: "investigate" }); dispatch({ type: "investigateTab", tab: "cases" }); }}>Open case</button></span>}
          <details className="menu display-menu"><summary className="btn"><Icon name="layers" />Layers & display</summary><div className="menu-body"><div className="menu-title">Relationship layers</div>{(Object.keys(LAYER_STYLE) as Layer[]).map((layer) => <label className="check" key={layer}><input type="checkbox" checked={ui.layers[layer]} onChange={(e) => dispatch({ type: "layer", layer, on: e.target.checked })} />{LAYER_STYLE[layer].label}<span className="swatch" style={{ background: LAYER_STYLE[layer].color }} /></label>)}<label className="check"><input type="checkbox" checked={ui.showHypothetical} onChange={(e) => dispatch({ type: "hypothetical", on: e.target.checked })} />Hypothetical relationships</label><label className="field" style={{ padding: 8 }}>Focus<select aria-label="Relationship focus" value={ui.focusMode} onChange={(e) => dispatch({ type: "focusMode", mode: e.target.value as FocusMode })}>{(Object.keys(FOCUS_LABEL) as FocusMode[]).map((m) => <option key={m} value={m}>{FOCUS_LABEL[m]}</option>)}</select></label><p className="small faint" style={{ padding: "0 8px" }}>Focus filters what is drawn; the camera only moves when you move it.</p><hr /><label className="check"><input type="checkbox" checked={ui.roofs} onChange={(e) => dispatch({ type: "roofs", roofs: e.target.checked })} />Show roofs</label><label className="check"><input type="checkbox" checked={ui.reducedMotion} onChange={(e) => dispatch({ type: "reducedMotion", on: e.target.checked })} />Reduce motion</label><label className="field" style={{ padding: 8 }}>Quality<select aria-label="Quality" value={ui.quality} onChange={(e) => dispatch({ type: "quality", quality: e.target.value as typeof ui.quality })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label></div></details>
          {ui.selection && <button className="icon-btn" onClick={() => dispatch({ type: "panel", panel: "inspector", open: !ui.inspector })} aria-label={ui.inspector ? "Hide inspector" : "Show inspector"} aria-pressed={ui.inspector}><Icon name="panel-right" /></button>}
        </>}
        {ui.workspace === "investigate" && <Tabs label="Investigation views" value={ui.investigateTab} onChange={(tab) => dispatch({ type: "investigateTab", tab })} options={[{ value: "findings", label: "Findings" }, { value: "events", label: "Events" }, { value: "cases", label: "Cases" }]} />}

      </div>
      {vm.data.project.dataset_kind === "synthetic" && <div className="workspace-data-banner">Synthetic demo · no production systems connected.</div>}
      {vm.data.project.provenance?.local_run && <div className="workspace-data-banner" data-testid="local-lab-banner">{vm.data.project.provenance.label} · run {vm.data.project.provenance.run_id} · local scope only; not production evidence.</div>}
      {props.connection && props.connection.state !== "live" && <div className="workspace-data-banner" role="alert" aria-live={ui.reduceAutomaticAnnouncements ? "off" : "assertive"} data-testid="connection-banner">{CONNECTION_BANNER[props.connection.state]} Showing data as of {props.connection.since ? fmtTime(props.connection.since) : "the last confirmed sync"}. This view is not live monitoring.</div>}
      {vm.pendingUpdates > 0 && <div className="workspace-data-banner"><div className="inline-actions"><span>A newer confirmed snapshot is available. Your current selection and records are pinned.</span><button className="btn sm" disabled={!vm.isLatest} onClick={() => dispatch({ type: "acceptUpdates" })}>Load updates</button></div></div>}
      {narrow && ui.workspace === "kingdom" && <NarrowComparison />}
      <div className={`workspace-content${showInspector && ui.workspace !== "integrations" ? " has-inspector" : ""}${expanded ? " expanded-finding" : ""}`}>
      {ui.workspace === "kingdom" && <div className={`kingdom-body${showInspector ? " has-inspector" : ""}${contextCollapsed ? " context-collapsed" : ""}${!ui.sidebar && !narrow ? " no-context" : ""} ${mobileView === "list" ? "show-list" : "show-map"}`}>
        {(ui.sidebar || narrow) && <Sidebar />}
        <div className="scene-column"><section className="stage" tabIndex={-1} aria-label="Asset map">
          {(!narrow || mobileView === "map") && <>{ui.webglFailed && ui.view === "graph" && <div className="banner" role="status" aria-live={ui.reduceAutomaticAnnouncements ? "off" : "polite"}><Icon name="alert" />{ui.webglFailed} The graph and records show the same evidence.<button className="btn" onClick={() => { const reason = webglAvailable(); if (reason) { dispatch({ type: "webglFailed", reason }); dispatch({ type: "announce", message: "3D is still unavailable. Your selection and graph context are preserved." }); } else { dispatch({ type: "retryWebgl" }); dispatch({ type: "announce", message: "3D capability is available. Retrying Castle with the same selection." }); } }}>Retry 3D</button></div>}{ui.view === "castle" && !ui.webglFailed ? <Suspense fallback={<div className="stage-loading" role="status"><span>Loading architectural view…</span></div>}><Castle3D /></Suspense> : <Graph2D />}<Legend /></>}
          {!vm.isLatest && <div className="stage-title"><span className="replay-tag" data-view-mode="historical">Replay · {fmtTime(vm.at)} · {ui.basis === "known" ? "time known" : "time occurred"}</span></div>}
        </section><Timeline /></div>
      </div>}
      <div className={`workspace-results${showInspector && ui.workspace !== "integrations" ? " has-inspector" : ""}`} hidden={ui.workspace === "kingdom"}>
        <div className="workspace-page-host">
          <div className="workspace-route" hidden={ui.workspace !== "investigate" || ui.investigateTab !== "findings"}><FindingsWorkspace expanded={expanded} returnRevision={resultsReturnRevision} onQueueChange={setFindingQueue} /></div>
          <div className="workspace-route" hidden={ui.workspace !== "investigate" || ui.investigateTab !== "events"}><EventWorkspace /></div>
          {ui.workspace === "investigate" && ui.investigateTab === "cases" && <div className="workspace-route"><CasesWorkspace /></div>}
          <div className="workspace-route" hidden={ui.workspace !== "coverage"}><CoverageWorkspace /></div>
          <div className="workspace-route" hidden={ui.workspace !== "integrations"}><IntegrationsWorkspace /></div>
        </div>
      </div>
      <SplitPane open={showInspector && ui.workspace !== "integrations"} resizable={!expanded && !narrow && (ui.workspace === "kingdom" || wideInspector)} onSizeChange={setInspectorWidth} onContainerWidth={setWorkspaceWidth}><EvidencePane expanded={expanded} findingQueue={findingQueue} onExpand={expandFinding} onReturn={returnToResults} /></SplitPane>
      </div>
    </main><div className="sr-only" data-testid="action-announcement" aria-live="polite" aria-atomic="true">{ui.announce}</div>
  </div>;
}

/**
 * next-C: shared framing control for the castle and the graph (one state, so 2D and 3D agree). Shown only for a
 * world with more than one populated environment. "Realm overview" frames every environment; the environment button
 * frames the active (or currently focused) environment. Both are explicit world focus, recorded in the URL.
 */
function WorldFraming() {
  const { ui, vm, dispatch } = useApp();
  const h = worldHierarchy(vm.data.graph, vm.data.scene);
  const f = viewFraming(h, ui.focus, vm.assetStatus, vm.data.scene.rooms.length);
  if (f.environments < 2) return null;
  const env = f.environment ?? f.active;
  const envLabel = env ? h.realm.children.find((n) => n.id === env)?.label ?? env.slice(4) : null;
  return <div className="framing-control" role="group" aria-label="World framing" data-testid="world-framing" data-framing={f.id ?? "all"} data-implicit={f.implicit}>
    {env && <button className={`chip${!f.realm && f.id ? " on" : ""}`} aria-pressed={!f.realm && !!f.id} title={f.implicit ? "Opened on the environment with the most urgent findings. Other environments stay in the world and in every list." : undefined}
      onClick={() => dispatch({ type: "worldFocus", focus: env, announce: `Framing environment ${envLabel}` })}>{f.environment && !f.implicit ? "Environment" : "Active"} · {envLabel}</button>}
    <button className={`chip${f.realm || !f.id ? " on" : ""}`} aria-pressed={f.realm || !f.id} onClick={() => dispatch({ type: "worldFocus", focus: h.realm.id, announce: `Realm overview: ${f.environments} environments` })}>Realm overview · {f.environments}</button>
  </div>;
}
