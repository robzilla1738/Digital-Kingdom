import type { Finding } from "@dk/contracts";
import { useApp } from "../lib/state.tsx";
import { COVERAGE_STYLE, EVIDENCE_LEVEL_LABEL, KIND_LABEL, OUTCOME_STYLE, SEVERITY_LABEL, SEVERITY_RANK, fmtTime } from "../lib/vocab.ts";
import { GapIcon, Icon, StateIcon } from "../lib/icons.tsx";

export function Sidebar() {
  const { ui, dispatch, vm } = useApp();
  const q = ui.query.trim().toLowerCase();
  const assetName = (id: string) => vm.data.graph.assets.find((a) => a.id === id)?.name ?? id;
  const findings = [...vm.findings]
    .filter((f) => !q || f.title.toLowerCase().includes(q) || f.claim.toLowerCase().includes(q) || f.affected_asset_ids.some((a) => assetName(a).toLowerCase().includes(q)))
    .sort((a, b) => Number(a.lifecycle === "closed") - Number(b.lifecycle === "closed") || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.last_seen.localeCompare(a.last_seen));
  const assets = vm.data.graph.assets.filter((a) => !q || a.name.toLowerCase().includes(q) || a.id.includes(q) || (a.owner ?? "").toLowerCase().includes(q));
  const gaps = vm.coverage.filter((c) => c.state !== "healthy").length + vm.unobserved.length;
  const openCount = vm.findings.filter((f) => f.lifecycle !== "closed").length;
  const tabs = [["findings", "Findings", openCount], ["assets", "Assets", vm.data.graph.assets.length], ["coverage", "Coverage", gaps]] as const;
  return (
    <aside className="sidebar" aria-label="Findings, assets and coverage">
      <div className="side-head">
        <div className="tabs" role="tablist" aria-label="List">
          {tabs.map(([id, label, n]) => (
            <button key={id} id={`tab-${id}`} role="tab" aria-selected={ui.tab === id} aria-controls="side-panel" className={ui.tab === id ? "active" : ""} onClick={() => dispatch({ type: "tab", tab: id })}>
              {label}{n > 0 && <span className="count">{n}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="tab-body" id="side-panel" role="tabpanel" aria-labelledby={`tab-${ui.tab}`}>
        {ui.tab === "findings" && (
          <>
            <div className="list-meta"><span>{q ? `${findings.length} matching` : vm.isLatest ? "Open first, by severity" : "At replay position"}</span></div>
            <ul className="list" aria-label="Findings">
              {!findings.length && <li className="empty"><Icon name="list" size={20} />{q ? "No findings match your search." : vm.isLatest ? "No findings." : "No findings yet at this point in the replay."}</li>}
              {findings.map((f) => <FindingRow key={f.id} f={f} assetName={assetName} />)}
            </ul>
          </>
        )}
        {ui.tab === "assets" && (
          <>
            <div className="list-meta"><span>{q ? `${assets.length} matching` : `${assets.length} assets`}</span></div>
            <ul className="list" aria-label="Assets">
              {!assets.length && <li className="empty"><Icon name="search" size={20} />No assets match your search.</li>}
              {assets.map((a) => {
                const st = vm.assetStatus.get(a.id);
                const style = st?.worst ? OUTCOME_STYLE[st.worst] : null;
                const sel = ui.selection?.kind === "asset" && ui.selection.id === a.id;
                return (
                  <li key={a.id}>
                    <button className={`row${sel ? " selected" : ""}`} aria-current={sel || undefined} onClick={() => dispatch({ type: "select", selection: { kind: "asset", id: a.id }, announce: `Selected ${a.name}` })} onMouseEnter={() => dispatch({ type: "hover", id: a.id })} onMouseLeave={() => dispatch({ type: "hover", id: null })}>
                      <span className="row-icon">{st?.worst ? <StateIcon state={st.worst} /> : <span className="dot" style={{ background: "var(--border-3)", width: 6, height: 6 }} aria-hidden />}</span>
                      <span className="row-main">
                        <span className="row-title">{a.name}</span>
                        <span className="row-sub">{KIND_LABEL[a.kind]}{a.owner ? ` · ${a.owner}` : ""}</span>
                      </span>
                      <span className="row-end">
                        {st && st.findingIds.length > 0 && <span className="count" title={`${st.findingIds.length} open findings`}>{st.findingIds.length}</span>}
                        {st && st.coverage !== "reporting" && <span className="tag-gap" title={st.coverageNote ?? "No telemetry source"}><GapIcon size={11} />{st.coverage === "gap" ? "Gap" : "Unobserved"}</span>}
                      </span>
                      {style && <span className="sr-only">{style.label}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {ui.tab === "coverage" && (
          <div className="coverage">
            <p className="list-meta" style={{ padding: "10px 8px 0" }}>Missing telemetry is shown as unknown, never as safe.</p>
            <ul className="list">
              {vm.coverage.map((c) => (
                <li key={c.source_id} className="cov-row" data-source-id={c.source_id} data-state={c.state}>
                  <span className="dot" style={{ background: COVERAGE_STYLE[c.state].color }} aria-hidden />
                  <span className="row-main">
                    <span className="row-title">{c.label}</span>
                    <span className="row-sub"><b style={{ fontWeight: 500, color: COVERAGE_STYLE[c.state].color }}>{COVERAGE_STYLE[c.state].label}</b>{c.last_event_at ? ` · last ${fmtTime(c.last_event_at)}` : ""}</span>
                    <span className="row-meta">{c.asset_ids.map(assetName).join(", ") || "No assets"}</span>
                    {c.note && <span className="row-note">{c.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {vm.unobserved.length > 0 && (
              <div className="side-section">
                <h4>No telemetry source</h4>
                <p className="note-line" style={{ padding: 0, marginBottom: 8 }}>These assets have no declared source. Absence of findings here means unknown.</p>
                <div className="chips">{vm.unobserved.map((id) => <button key={id} className="chip chip-gap" onClick={() => dispatch({ type: "select", selection: { kind: "asset", id } })}><GapIcon size={11} />{assetName(id)}</button>)}</div>
              </div>
            )}
            {vm.data.stats && (
              <div className="side-section">
                <h4>Ingestion</h4>
                <p className="small muted">{vm.data.stats.accepted} accepted · {vm.data.stats.duplicates} duplicate deliveries collapsed · {Object.values(vm.data.stats.rejected).reduce((a, b) => a + b, 0)} rejected</p>
                {vm.data.stats.rejections.length > 0 && <ul className="small faint">{vm.data.stats.rejections.map((r, i) => <li key={i}>{r.source_id}: {r.reason.replace(/_/g, " ")}</li>)}</ul>}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function FindingRow({ f, assetName }: { f: Finding; assetName: (id: string) => string }) {
  const { ui, dispatch, vm } = useApp();
  const style = OUTCOME_STYLE[f.outcome_state];
  const sel = ui.selection?.kind === "finding" && ui.selection.id === f.id;
  const revised = Date.parse(f.last_received) - Date.parse(f.last_seen) > 60_000 || f.revision > 1 || f.event_ids.some((id) => vm.lateEventIds.has(id));
  return (
    <li>
      <button data-finding-id={f.id} data-finding-kind={f.kind} className={`row finding sev-row-${f.severity}${sel ? " selected" : ""}${f.lifecycle === "closed" ? " closed" : ""}`} aria-current={sel || undefined}
        onClick={() => dispatch({ type: "select", selection: { kind: "finding", id: f.id }, announce: `Selected finding ${f.title}` })}>
        <span className="row-icon"><StateIcon state={f.outcome_state} /></span>
        <span className="row-main">
          <span className="row-title">{f.title}</span>
          <span className="row-sub">{style.label} · {EVIDENCE_LEVEL_LABEL[f.evidence_level].split(" (")[0]}</span>
          <span className="row-meta">
            <span>{fmtTime(f.first_seen).replace(" UTC", "")}</span>
            <span className="sep" aria-hidden />
            <span>{f.affected_asset_ids.map(assetName).join(", ")}</span>
            {f.event_count > 1 && <><span className="sep" aria-hidden /><span>{f.event_count} events</span></>}
            {revised && <><span className="sep" aria-hidden /><span style={{ color: "var(--warn)" }}>revised late</span></>}
            {f.lifecycle !== "open" && <><span className="sep" aria-hidden /><span>{f.lifecycle}</span></>}
          </span>
        </span>
        <span className="row-end"><span className={`sev sev-${f.severity}`}>{SEVERITY_LABEL[f.severity]}</span></span>
      </button>
    </li>
  );
}
