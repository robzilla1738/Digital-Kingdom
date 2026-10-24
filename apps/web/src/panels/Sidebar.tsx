import type { Finding } from "@dk/contracts";
import { useApp, sortFindings } from "../lib/state.tsx";
import { ASSET_COVERAGE_LABEL } from "../lib/presentation.ts";
import { EVIDENCE_LEVEL_LABEL, KIND_LABEL, OUTCOME_STYLE, fmtTime } from "../lib/vocab.ts";
import { GapIcon, Icon, StateIcon } from "../lib/icons.tsx";
import { Tabs } from "../components/ui/Tabs.tsx";
import { SetupChecklist } from "../workspaces/integrations/SetupChecklist.tsx";
import { SeverityBadge } from "../components/ui/Status.tsx";
import { WorldNavigator } from "./WorldNavigator.tsx";

export function Sidebar() {
  const { ui, dispatch, vm } = useApp(); const q = ui.query.trim().toLowerCase();
  const assetName = (id: string) => vm.data.graph.assets.find((a) => a.id === id)?.name ?? id;
  const findings = sortFindings(vm.findings.filter((f) => f.lifecycle !== "closed" && (!q || `${f.id} ${f.title} ${f.affected_asset_ids.map(assetName).join(" ")}`.toLowerCase().includes(q))));
  const assets = vm.data.graph.assets.filter((a) => !q || `${a.name} ${a.id} ${a.owner ?? ""}`.toLowerCase().includes(q));
  const tab = ui.tab === "assets" ? "assets" : ui.tab === "world" ? "world" : "findings";
  const visibleIds = new Set((tab === "findings" ? findings : assets).map((v) => v.id));
  const selectedFiltered = tab !== "world" && ui.selection && (ui.selection.kind === "asset" || ui.selection.kind === "finding") && ((tab === "assets") === (ui.selection.kind === "asset")) && !visibleIds.has(ui.selection.id);
  return <aside className="sidebar" aria-label="Findings and assets">
    <div className="side-head"><div className="side-heading"><span>PROJECT OVERVIEW</span><span>{vm.data.graph.assets.length} assets</span></div>
      <Tabs label="Kingdom context" value={tab} onChange={(value) => dispatch({ type: "tab", tab: value })} panelId="side-panel" options={[{ value: "findings", label: <>Attention <span className="count">{vm.summary.openFindings}</span></> }, { value: "assets", label: <>Assets <span className="count">{vm.data.graph.assets.length}</span></> }, { value: "world", label: <>World</> }]} />
      <input type="search" value={ui.query} onChange={(e) => dispatch({ type: "query", query: e.target.value })} placeholder={tab === "findings" ? "Filter attention queue" : tab === "world" ? "Search every asset and archived placement" : "Filter assets"} aria-label={tab === "findings" ? "Filter attention queue" : tab === "world" ? "Search world" : "Filter assets"} />
    </div>
    <div className="tab-body" id="side-panel" role="tabpanel" aria-label={tab === "findings" ? "Attention" : tab === "world" ? "World" : "Assets"}>{tab === "world" ? <WorldNavigator query={ui.query} /> : <>
      {selectedFiltered && <div className="pinned-selection"><p>Selected record is outside these filters.</p><button className="link" onClick={() => dispatch({ type: "panel", panel: "inspector", open: true })}>Open selected {ui.selection!.kind}</button></div>}
      <SetupChecklist /><div className="list-meta"><span>{tab === "findings" ? `${findings.length} open · severity first` : `${assets.length} shown`}</span>{q && <button className="link" onClick={() => dispatch({ type: "query", query: "" })}>Clear</button>}</div>
      {tab === "findings" ? <ul className="list" aria-label="Findings">{!findings.length && <li className="empty"><Icon name="list" size={24} /><h3>{q ? "No matching findings" : "No open findings recorded"}</h3><p>Absence of findings is not proof of safety.</p><button className="btn" onClick={() => { dispatch({ type: "workspace", workspace: "coverage" }); dispatch({ type: "panel", panel: "inspector", open: false }); }}>Review coverage</button></li>}{findings.map((f) => <FindingRow key={f.id} f={f} assetName={assetName} />)}</ul> : <ul className="list" aria-label="Assets">
        {!assets.length && <li className="empty"><Icon name="search" size={24} />{vm.data.graph.assets.length ? <>No assets match these filters.<button className="btn" onClick={() => dispatch({ type: "query", query: "" })}>Clear filters</button></> : <><h3>No assets have been added to this project.</h3><button className="btn" onClick={() => { dispatch({ type: "workspace", workspace: "integrations" }); dispatch({ type: "panel", panel: "inspector", open: false }); window.dispatchEvent(new Event("dk:open-inventory")); }}>View import guidance</button></>}</li>}
        {assets.map((a) => { const st = vm.assetStatus.get(a.id); const selected = ui.selection?.kind === "asset" && ui.selection.id === a.id; return <li key={a.id}><button className={`row${selected ? " selected" : ""}`} aria-current={selected || undefined} data-asset-id={a.id} onClick={() => dispatch({ type: "select", selection: { kind: "asset", id: a.id }, announce: `Selected ${a.name}` })} onMouseEnter={() => dispatch({ type: "hover", id: a.id })} onMouseLeave={() => dispatch({ type: "hover", id: null })}><span className="row-icon"><Icon name="cube" size={16} /></span><span className="row-main"><span className="row-title">{a.name}</span><span className="row-sub">{KIND_LABEL[a.kind]} · {a.environment}</span>{st && <span className={`row-meta ${st.coverage !== "reporting" ? "tag-gap" : ""}`} title={st.coverageNote}>{st.coverage !== "reporting" && <GapIcon />}{ASSET_COVERAGE_LABEL[st.coverage]}</span>}</span><span className="row-end">{st?.severity && <SeverityBadge severity={st.severity} />}{!!st?.findingIds.length && <span className="count">{st.findingIds.length} findings</span>}</span></button></li>; })}
      </ul>}</>}
    </div>
  </aside>;
}
function FindingRow({ f, assetName }: { f: Finding; assetName: (id: string) => string }) {
  const { ui, dispatch, vm } = useApp(); const selected = ui.selection?.kind === "finding" && ui.selection.id === f.id;
  const late = f.event_ids.some((id) => vm.lateEventIds.has(id));
  return <li><button data-finding-id={f.id} data-finding-kind={f.kind} className={`row finding sev-row-${f.severity}${selected ? " selected" : ""}`} aria-current={selected || undefined} title={f.title} onClick={() => dispatch({ type: "select", selection: { kind: "finding", id: f.id }, announce: `Selected finding ${f.title}` })}>
    <span className="finding-row-top"><SeverityBadge severity={f.severity} /><span className="row-meta">{fmtTime(f.last_seen).replace(" UTC", "")}</span></span>
    <span className="row-title">{f.title}</span><span className="finding-row-state"><StateIcon state={f.outcome_state} />{OUTCOME_STYLE[f.outcome_state].label} · {EVIDENCE_LEVEL_LABEL[f.evidence_level].replace("Corroborated by an independent source", "Corroborated").replace("Not assessed (missing evidence)", "Not assessed")}</span><span className="row-meta">{f.affected_asset_ids.map(assetName).join(", ")}{late ? " · late evidence" : ""}</span>
  </button></li>;
}
