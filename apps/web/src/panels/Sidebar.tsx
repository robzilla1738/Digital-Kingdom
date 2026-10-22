import type { Finding } from "@dk/contracts";
import { useApp } from "../lib/state.tsx";
import { COVERAGE_STYLE, EVIDENCE_LEVEL_LABEL, KIND_LABEL, OUTCOME_STYLE, SEVERITY_RANK, fmtTime } from "../lib/vocab.ts";

export function Sidebar() {
  const { ui, dispatch, vm } = useApp();
  const q = ui.query.trim().toLowerCase();
  const assetName = (id: string) => vm.data.graph.assets.find((a) => a.id === id)?.name ?? id;
  const findings = [...vm.findings]
    .filter((f) => !q || f.title.toLowerCase().includes(q) || f.claim.toLowerCase().includes(q) || f.affected_asset_ids.some((a) => assetName(a).toLowerCase().includes(q)))
    .sort((a, b) => Number(a.lifecycle === "closed") - Number(b.lifecycle === "closed") || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.last_seen.localeCompare(a.last_seen));
  const assets = vm.data.graph.assets.filter((a) => !q || a.name.toLowerCase().includes(q) || a.id.includes(q) || (a.owner ?? "").toLowerCase().includes(q));
  const gaps = vm.coverage.filter((c) => c.state !== "healthy").length + vm.unobserved.length;
  return (
    <aside className="sidebar" aria-label="Findings, assets and coverage">
      <div className="tabs" role="tablist">
        {([["findings", `Findings ${vm.findings.filter((f) => f.lifecycle !== "closed").length}`], ["assets", `Assets ${vm.data.graph.assets.length}`], ["coverage", `Coverage${gaps ? ` ${gaps}` : ""}`]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={ui.tab === id} className={ui.tab === id ? "active" : ""} onClick={() => dispatch({ type: "tab", tab: id })}>{label}</button>
        ))}
      </div>
      <div className="tab-body">
        {ui.tab === "findings" && (
          <ul className="list" aria-label="Findings">
            {!findings.length && <li className="empty">{vm.isLatest ? "No findings match." : "No findings yet at this point in the replay."}</li>}
            {findings.map((f) => <FindingRow key={f.id} f={f} assetName={assetName} />)}
          </ul>
        )}
        {ui.tab === "assets" && (
          <ul className="list" aria-label="Assets">
            {assets.map((a) => {
              const st = vm.assetStatus.get(a.id);
              const style = st?.worst ? OUTCOME_STYLE[st.worst] : null;
              const sel = ui.selection?.kind === "asset" && ui.selection.id === a.id;
              return (
                <li key={a.id}>
                  <button className={`row${sel ? " selected" : ""}`} onClick={() => dispatch({ type: "select", selection: { kind: "asset", id: a.id }, announce: `Selected ${a.name}` })} onMouseEnter={() => dispatch({ type: "hover", id: a.id })} onMouseLeave={() => dispatch({ type: "hover", id: null })}>
                    <span className="row-glyph" style={{ color: style?.color ?? "#5d6672" }} aria-hidden>{style?.glyph ?? "○"}</span>
                    <span className="row-main">
                      <span className="row-title">{a.name}</span>
                      <span className="row-sub">{KIND_LABEL[a.kind]}{a.owner ? ` · ${a.owner}` : ""}</span>
                    </span>
                    {st && st.coverage !== "reporting" && <span className="chip chip-gap" title={st.coverageNote}>{st.coverage === "gap" ? "gap" : "unobserved"}</span>}
                    {style && <span className="sr-only">{style.label}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {ui.tab === "coverage" && (
          <div className="coverage">
            <p className="muted small">Missing telemetry is shown as unknown, never as safe.</p>
            <ul className="list">
              {vm.coverage.map((c) => (
                <li key={c.source_id} className="cov-row">
                  <span className="dot" style={{ background: COVERAGE_STYLE[c.state].color }} aria-hidden />
                  <span className="row-main">
                    <span className="row-title">{c.label}</span>
                    <span className="row-sub">{COVERAGE_STYLE[c.state].label}{c.last_event_at ? ` · last ${fmtTime(c.last_event_at)}` : ""} · {c.asset_ids.map(assetName).join(", ") || "no assets"}</span>
                    {c.note && <span className="row-note">{c.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {vm.unobserved.length > 0 && (
              <div className="unobserved">
                <h4>No telemetry source</h4>
                <p className="muted small">These assets have no declared source. Absence of findings here means unknown.</p>
                <div className="chips">{vm.unobserved.map((id) => <button key={id} className="chip chip-gap" onClick={() => dispatch({ type: "select", selection: { kind: "asset", id } })}>{assetName(id)}</button>)}</div>
              </div>
            )}
            {vm.data.stats && (
              <div className="pipeline-stats">
                <h4>Ingestion</h4>
                <p className="small">{vm.data.stats.accepted} accepted · {vm.data.stats.duplicates} duplicate deliveries collapsed · {Object.values(vm.data.stats.rejected).reduce((a, b) => a + b, 0)} rejected</p>
                <ul className="small muted">{vm.data.stats.rejections.map((r, i) => <li key={i}>{r.source_id}: {r.reason.replace(/_/g, " ")}</li>)}</ul>
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
      <button className={`row finding sev-${f.severity}${sel ? " selected" : ""}${f.lifecycle === "closed" ? " closed" : ""}`} onClick={() => dispatch({ type: "select", selection: { kind: "finding", id: f.id }, announce: `Selected finding ${f.title}` })}>
        <span className="row-glyph" style={{ color: style.color }} aria-hidden>{style.glyph}</span>
        <span className="row-main">
          <span className="row-title">{f.title}</span>
          <span className="row-sub">{style.label} · {EVIDENCE_LEVEL_LABEL[f.evidence_level].split(" (")[0]} · {f.affected_asset_ids.map(assetName).join(", ")}</span>
          <span className="row-meta">{fmtTime(f.first_seen)}{f.event_count > 1 ? ` · ${f.event_count} events` : ""}{revised ? " · revised by late evidence" : ""}{f.lifecycle !== "open" ? ` · ${f.lifecycle}` : ""}</span>
        </span>
        <span className={`sev sev-${f.severity}`}>{f.severity}</span>
      </button>
    </li>
  );
}
