import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApp, sortFindings } from "../../lib/state.tsx";
import { EVIDENCE_LEVEL_LABEL, OUTCOME_STYLE, SEVERITY_LABEL, fmtDateTime } from "../../lib/vocab.ts";
import { SeverityBadge, OutcomeBadge, EvidenceBadge } from "../../components/ui/Status.tsx";
import { Icon } from "../../lib/icons.tsx";

export function FindingsWorkspace({ expanded = false, returnRevision = 0, onQueueChange }: { expanded?: boolean; returnRevision?: number; onQueueChange?: (queue: { id: string; title: string }[]) => void }) {
  const { ui, dispatch, vm } = useApp();
  const results = useRef<HTMLElement>(null), table = useRef<HTMLDivElement>(null), resultInvoker = useRef<HTMLButtonElement | null>(null);
  const filterChanged = useRef(false);
  const scroll = useRef({ top: 0, left: 0 }), restoredRevision = useRef(returnRevision);
  const [filtersOpen, setFiltersOpen] = useState(() => typeof matchMedia === "undefined" || matchMedia("(min-width:768px)").matches);
  const [filters, setFilters] = useState({ text: "", severity: "", lifecycle: "open-not-closed", outcome: "", evidence: "", asset: "" });
  const change = (key: keyof typeof filters, value: string) => { filterChanged.current = true; setFilters((f) => ({ ...f, [key]: value })); };
  const reset = () => { filterChanged.current = true; setFilters({ text: "", severity: "", lifecycle: "open-not-closed", outcome: "", evidence: "", asset: "" }); };
  const assetName = (id: string) => vm.data.graph.assets.find((a) => a.id === id)?.name ?? id;
  const findings = useMemo(() => sortFindings(vm.findings.filter((f) => {
    const query = filters.text.trim().toLowerCase();
    return (!query || `${f.id} ${f.title} ${f.claim} ${f.affected_asset_ids.map(assetName).join(" ")}`.toLowerCase().includes(query)) && (!filters.severity || f.severity === filters.severity) && (filters.lifecycle === "open-not-closed" ? f.lifecycle !== "closed" : !filters.lifecycle || f.lifecycle === filters.lifecycle) && (!filters.outcome || f.outcome_state === filters.outcome) && (!filters.evidence || f.evidence_level === filters.evidence) && (!filters.asset || f.affected_asset_ids.includes(filters.asset));
  })), [vm.findings, filters, vm.data.graph.assets]);
  useEffect(() => { if (filterChanged.current && ui.reduceAutomaticAnnouncements) dispatch({ type: "announce", message: `${findings.length} findings match the submitted filters.` }); filterChanged.current = false; }, [findings, ui.reduceAutomaticAnnouncements, dispatch]);
  const queueKey = JSON.stringify(findings.map(({ id, title }) => ({ id, title })));
  useEffect(() => { onQueueChange?.(JSON.parse(queueKey)); }, [queueKey, onQueueChange]);
  useLayoutEffect(() => {
    if (expanded) return;
    if (results.current) results.current.scrollTop = scroll.current.top;
    if (table.current) table.current.scrollLeft = scroll.current.left;
    if (restoredRevision.current !== returnRevision) {
      restoredRevision.current = returnRevision;
      const target = resultInvoker.current?.isConnected ? resultInvoker.current : results.current;
      target?.focus({ preventScroll: true });
    }
  }, [expanded, returnRevision]);
  const selected = ui.selection?.kind === "finding" ? vm.findings.find((f) => f.id === ui.selection!.id) : null;
  const filteredSelected = selected && !findings.some((f) => f.id === selected.id);
  return <section ref={results} tabIndex={-1} className="workspace-page findings-workspace" aria-label="Finding records" onScroll={(event) => { if (!expanded && event.currentTarget.getClientRects().length) scroll.current.top = event.currentTarget.scrollTop; }}>
    <div className="workspace-heading"><div><div className="eyebrow">RECORDED FINDINGS</div><h1>Follow the evidence.</h1><p className="workspace-lede">Review claims, supporting records, and what remains unknown. Status dimensions stay separate.</p></div><button className="btn" onClick={() => dispatch({ type: "investigateTab", tab: "events" })}><Icon name="search" />Search stored events</button></div>
    <div className="scope-note"><strong>{vm.isLatest ? "Current stored findings" : "Findings at the replay cutoff"}.</strong> {vm.isLatest ? "Finding history is independent of the activity window." : `Replay uses ${ui.basis === "known" ? "received time" : "event time"}; exact finding evidence may extend beyond this cutoff and is labeled separately.`} Exact lookup determines evidence availability.</div>
    <div className="finding-search">      <label className="field search-field">Search visible finding metadata<input type="search" placeholder="Title, reference, recorded claim, or asset name" value={filters.text} onChange={(e) => change("text", e.target.value)} /></label><button className="btn" aria-expanded={filtersOpen} aria-controls="finding-filters" onClick={() => setFiltersOpen(!filtersOpen)}>Filter findings</button></div>
    <div id="finding-filters" className="filter-bar" role="group" aria-label="Finding filters" hidden={!filtersOpen}>

      <label className="field">Severity<select aria-label="Severity" value={filters.severity} onChange={(e) => change("severity", e.target.value)}><option value="">All severities</option>{Object.entries(SEVERITY_LABEL).reverse().map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="field">Lifecycle<select aria-label="Lifecycle" value={filters.lifecycle} onChange={(e) => change("lifecycle", e.target.value)}><option value="open-not-closed">Closed excluded</option><option value="">All lifecycles</option>{[...new Set(["open", "acknowledged", "closed", ...vm.data.findings.map((f) => f.lifecycle)])].map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
      <label className="field">Outcome<select aria-label="Outcome" value={filters.outcome} onChange={(e) => change("outcome", e.target.value)}><option value="">All outcomes</option>{Object.entries(OUTCOME_STYLE).map(([key, style]) => <option value={key} key={key}>{style.label}</option>)}</select></label>
      <label className="field">Evidence level<select aria-label="Evidence level" value={filters.evidence} onChange={(e) => change("evidence", e.target.value)}><option value="">All evidence levels</option>{Object.entries(EVIDENCE_LEVEL_LABEL).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <label className="field">Affected asset<select aria-label="Affected asset" value={filters.asset} onChange={(e) => change("asset", e.target.value)}><option value="">All assets</option>{vm.data.graph.assets.map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label>

      <div className="field"><span>Reset this view</span><button className="btn" onClick={reset}>Clear filters</button></div>
      <div className="scope-note finding-source-limit">Finding records do not expose exhaustive source IDs. Source-scoped queries are available in Events. <button className="link" onClick={() => dispatch({ type: "investigateTab", tab: "events" })}>Search events by source</button></div>
    </div>
    <div className="filter-summary"><span role="status" aria-live={ui.reduceAutomaticAnnouncements ? "off" : "polite"}>{findings.length} matching findings</span><span>Severity descending, then most recently received</span>{filters.lifecycle === "open-not-closed" && <button className="chip" onClick={() => change("lifecycle", "")}>Closed excluded <Icon name="x" size={12} /></button>}</div>
    {filteredSelected && <div className="pinned-selection"><p>Selected finding is outside these filters. Your selection is preserved.</p><button className="link" onClick={() => dispatch({ type: "panel", panel: "inspector", open: true })}>{selected.title}</button></div>}
    {!findings.length ? <div className="empty"><Icon name="list" size={28} /><h3>No stored findings match these filters.</h3><p>Missing visibility can hide activity. This is not a clean-security assessment.</p><div className="inline-actions"><button className="btn" onClick={reset}>Clear filters</button><button className="btn ghost" onClick={() => { dispatch({ type: "workspace", workspace: "coverage" }); dispatch({ type: "panel", panel: "inspector", open: false }); }}>Review coverage</button></div></div> : <div ref={table} className="table-scroll" onScroll={(event) => { if (!expanded && event.currentTarget.getClientRects().length) scroll.current.left = event.currentTarget.scrollLeft; }} tabIndex={0} role="region" aria-label="Findings table, scroll horizontally for all fields"><table className="record-table"><thead><tr><th scope="col">Severity</th><th scope="col">Finding / affected assets</th><th scope="col">Outcome</th><th scope="col">Evidence level</th><th scope="col" className="record-optional">First / last observed</th><th scope="col">Lifecycle</th><th scope="col">Evidence availability</th></tr></thead><tbody>{findings.map((f) => <tr key={f.id} aria-selected={selected?.id === f.id}><td><SeverityBadge severity={f.severity} /></td><td className="record-title"><button className="link" data-finding-id={f.id} data-finding-kind={f.kind} onClick={(event) => { resultInvoker.current = event.currentTarget; scroll.current = { top: results.current?.scrollTop ?? scroll.current.top, left: table.current?.scrollLeft ?? scroll.current.left }; dispatch({ type: "select", selection: { kind: "finding", id: f.id }, announce: `Selected finding ${f.title}` }); }}>{f.title}</button><small>{f.affected_asset_ids.map(assetName).join(", ") || "No affected asset declared"}</small></td><td data-label="Outcome"><OutcomeBadge outcome={f.outcome_state} /></td><td data-label="Evidence"><EvidenceBadge level={f.evidence_level} /></td><td className="record-optional num"><span>{fmtDateTime(f.first_seen)}</span><br /><span className="muted">{fmtDateTime(f.last_seen)}</span></td><td data-label="Lifecycle">{f.lifecycle.replaceAll("_", " ")}</td><td data-label="Availability"><span className="faint">Not loaded</span><br /><span className="small muted">Inspect exact references</span></td></tr>)}</tbody></table></div>}
  </section>;
}
