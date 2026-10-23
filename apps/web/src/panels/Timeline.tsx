import { useContext, useEffect, useMemo, useState } from "react";
import { ConnectionCtx } from "../lib/connection.ts";
import { useApp } from "../lib/state.tsx";
import { ACTION_LABEL, EVENT_OUTCOME_COLOR, fmtDateTime, fmtTime } from "../lib/vocab.ts";
import { Icon } from "../lib/icons.tsx";
import { aggregateTimelineRecords, timelineLanes } from "../shell/timelineLanes.ts";
import { syncReplayInterval } from "../shell/replayRange.ts";
import { SegmentedControl } from "../components/ui/Tabs.tsx";
const localInput = (iso: string) => new Date(iso).toISOString().slice(0, 19);
export function Timeline() {
  const { ui, dispatch, vm } = useApp(); const connection = useContext(ConnectionCtx);
  const [bounds, setBounds] = useState(vm.data.window); const [customRange, setCustomRange] = useState(false); const [draftStart, setDraftStart] = useState(localInput(vm.data.window.start)); const [draftEnd, setDraftEnd] = useState(localInput(vm.data.window.end));
  const [expanded, setExpanded] = useState(false);
  const [exactDraft, setExactDraft] = useState({ at: vm.at, value: localInput(vm.at) }); const [error, setError] = useState("");
  const exact = exactDraft.at === vm.at ? exactDraft.value : localInput(vm.at);
  const start = Date.parse(bounds.start), end = Date.parse(bounds.end); const at = Math.min(end, Math.max(start, Date.parse(vm.at)));
  const lanes = useMemo(() => timelineLanes(vm.data, ui.basis, start, end), [vm.data, ui.basis, start, end]);
  const events = useMemo(() => vm.data.events.map((event) => ({ event, time: Date.parse(ui.basis === "known" ? event.received_at : event.occurred_at) })).filter((x) => x.time >= start && x.time <= end).sort((a, b) => a.time - b.time || a.event.id.localeCompare(b.event.id)), [vm.data.events, ui.basis, start, end]);
  useEffect(() => { if (ui.playing && Date.parse(vm.at) >= end) { dispatch({ type: "playing", playing: false }); dispatch({ type: "playhead", at: bounds.end }); } }, [ui.playing, vm.at, end, bounds.end, dispatch]);
  useEffect(() => {
    if (!vm.isLatest || customRange) return;
    setBounds((current) => syncReplayInterval(current, vm.data.window, vm.isLatest, customRange));
    setDraftStart(localInput(vm.data.window.start)); setDraftEnd(localInput(vm.data.window.end));
  }, [vm.data.window.start, vm.data.window.end, vm.isLatest, customRange]);
  const seek = (time: number) => { dispatch({ type: "playing", playing: false }); dispatch({ type: "playhead", at: new Date(Math.min(end, Math.max(start, time))).toISOString() }); };
  const move = (direction: -1 | 1) => { const target = direction < 0 ? events.filter((x) => x.time < at).at(-1) : events.find((x) => x.time > at); if (target) { seek(target.time); dispatch({ type: "select", selection: { kind: "event", id: target.event.id }, announce: `${ACTION_LABEL[target.event.action] ?? target.event.action}, ${fmtDateTime(new Date(target.time).toISOString())}` }); } };
  const live = vm.data.project.dataset_kind === "live" && vm.isLatest && connection?.state === "live" && !vm.pendingUpdates;
  const mode = live ? "live" : vm.isLatest ? "latest" : "historical";
  const applyRange = () => {
    const s = Date.parse(`${draftStart}Z`), e = Date.parse(`${draftEnd}Z`); const min = Date.parse(vm.data.window.start), max = Date.parse(vm.data.window.end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || s < min || e > max) { setError("Choose an end after the start, within the loaded snapshot interval shown below."); return; }
    setError(""); setCustomRange(true); setBounds({ start: new Date(s).toISOString(), end: new Date(e).toISOString() }); dispatch({ type: "playing", playing: false }); dispatch({ type: "playhead", at: new Date(s).toISOString() });
  };
  return <section className="timeline" aria-label="Timeline and replay">
    {!vm.isLatest && <div className="replay-scope" role="note"><strong>Replay uses graph revision {vm.data.graph.graph_revision}.</strong> Historical topology and source administration are unavailable. Coverage is current as of {fmtDateTime(vm.coverageAsOf)}; notes and disposition are current annotations.</div>}
    <div className="tl-controls">
      <button className="icon-btn" aria-label="Previous event" disabled={!events.some((x) => x.time < at)} onClick={() => move(-1)}><Icon name="chevron-right" style={{ transform: "rotate(180deg)" }} /></button>
      <button className="tl-play" aria-label={ui.playing ? "Pause replay" : "Play replay"} onClick={() => { if (!ui.playing && (vm.isLatest || at >= end)) dispatch({ type: "playhead", at: bounds.start }); dispatch({ type: "playing", playing: !ui.playing }); }}><Icon name={ui.playing ? "pause" : "play"} size={14} /></button>
      <button className="icon-btn" aria-label="Next event" disabled={!events.some((x) => x.time > at)} onClick={() => move(1)}><Icon name="chevron-right" /></button>
      <div className={`tl-time ${mode}`}><b>{fmtTime(vm.at)}</b><span data-testid="timeline-mode" data-mode={mode}>{live ? "Live" : vm.isLatest ? vm.data.project.dataset_kind === "live" ? "Latest received · not live" : "Latest synthetic evidence" : "Historical replay"} · {ui.basis === "known" ? "Received time" : "Event time"}</span></div>
      <span className="spacer" />
      <button className="btn" aria-expanded={expanded} aria-controls="expanded-timeline-lanes" onClick={() => setExpanded(!expanded)}>{expanded ? "Collapse lanes" : "Expand timeline"}</button>
      <button className="btn return-live" disabled={vm.isLatest && !vm.pendingUpdates} onClick={() => { dispatch({ type: "playing", playing: false }); dispatch({ type: "playhead", at: null }); dispatch({ type: "acceptUpdates" }); setCustomRange(false); setBounds(vm.latestData.window); setDraftStart(localInput(vm.latestData.window.start)); setDraftEnd(localInput(vm.latestData.window.end)); }}>{vm.data.project.dataset_kind === "live" ? "Return live" : "Return to latest"}</button>
    <details className="tl-details"><summary className="btn">Time settings</summary><div className="tl-details-body"><div className="inline-actions"><h3>Replay time &amp; scope</h3><span className="spacer" /><button className="btn" onClick={(event) => { const details = event.currentTarget.closest("details"); if (details) { details.open = false; details.querySelector("summary")?.focus(); } }}>Close time settings</button></div><div className="inline-actions" style={{ margin: "16px 0" }}>      <SegmentedControl label="Replay basis" value={ui.basis} onChange={(basis) => dispatch({ type: "basis", basis })} options={[{ value: "occurred", label: "Event time" }, { value: "known", label: "Known at the time" }]} />
      <label className="select-inline">Speed<select aria-label="Speed" value={ui.speed} onChange={(e) => dispatch({ type: "speed", speed: Number(e.target.value) })}>{[1, 10, 30].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}</select></label>
</div><div className="tl-inputs"><label className="field">Replay start (UTC)<input type="datetime-local" step="1" value={draftStart} onChange={(e) => setDraftStart(e.target.value)} /></label><label className="field">Replay end (UTC)<input type="datetime-local" step="1" value={draftEnd} onChange={(e) => setDraftEnd(e.target.value)} /></label><button className="btn" onClick={applyRange}>Apply replay interval</button></div><div className="tl-inputs"><label className="field">Exact position (UTC)<input type="datetime-local" step="1" value={exact} onChange={(e) => setExactDraft({ at: vm.at, value: e.target.value })} /></label><button className="btn" onClick={() => { const value = Date.parse(`${exact}Z`); if (!Number.isFinite(value) || value < start || value > end) setError("Choose a position inside the replay interval."); else { setError(""); seek(value); } }}>Go to time</button></div>{error && <p className="error" role="alert">{error}</p>}<p>Loaded snapshot interval: {fmtDateTime(vm.data.window.start)} to {fmtDateTime(vm.data.window.end)}. These controls replay loaded records; they do not search the complete event archive.</p><p>Event replay uses graph revision {vm.data.graph.graph_revision}. Historical topology is unavailable. Coverage is current as of {fmtDateTime(vm.coverageAsOf)}; historical visibility is not assessed. Analyst notes and disposition shown in detail are current annotations.</p>{vm.pendingUpdates > 0 && <p className="scope-note warning">A newer confirmed snapshot is available. Replay records stay pinned until you return to latest.</p>}</div></details>
    </div>
    <div className="tl-main"><div className="tl-track-wrap"><div className="tl-ticks" aria-hidden>{events.map(({ event, time }) => <i key={event.id} className="tl-tick" style={{ left: `${100 * (time - start) / Math.max(1, end - start)}%`, background: EVENT_OUTCOME_COLOR[event.outcome] }} />)}</div><input type="range" min={start} max={end} step={1000} value={at} aria-label="Replay position" aria-valuetext={`${fmtDateTime(new Date(at).toISOString())}, ${ui.basis === "known" ? "received time" : "event time"}`} onKeyDown={(event) => {
      const delta = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1000 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1000 : null;
      if (delta !== null) { event.preventDefault(); dispatch({ type: "stepPlayhead", delta, start, end }); }
    }} onChange={(e) => seek(Number(e.target.value))} /><div className="tl-axis" aria-hidden><span>{fmtTime(bounds.start)}</span><span>{fmtTime(bounds.end)}</span></div></div></div>
    {expanded && <div id="expanded-timeline-lanes" className="timeline-lanes" role="group" aria-label="Expanded timeline records">
      <p className="small muted">Finding markers use {ui.basis === "known" ? "latest supporting or counterevidence receipt, not first-known time" : "first observed time"}. Health markers are recorded sensor changes, not historical coverage intervals. Dense intervals are grouped into at most 24 marks; the selector lists every exact record. No causal path is implied.</p>
      {lanes.map(lane => <div className="timeline-lane" key={lane.id} data-timeline-lane={lane.id}>
        <strong>{lane.label}<small>{lane.records.length} records</small></strong>
        <div className="timeline-lane-track" aria-hidden>{aggregateTimelineRecords(lane.records,start,end).map(mark => <i key={mark.records[0]!.id} data-count={mark.count} title={`${mark.count} ${mark.count === 1 ? "record" : "records in this interval"}; use the exact record selector`} style={{ left: `${100 * (mark.time - start) / Math.max(1,end-start)}%`, background:mark.count === 1 ? mark.records[0]!.color : "var(--text-2)", width:mark.count > 1 ? 8 : 3, height:mark.count > 1 ? 18 : 14 }} />)}</div>
        <select aria-label={`Inspect ${lane.label.toLowerCase()} in interval`} value="" disabled={!lane.records.length} onChange={event => { const record=lane.records.find(record=>record.id===event.target.value); if(record) { seek(record.time); dispatch({type:"select",selection:{kind:record.kind,id:record.id},announce:`Selected ${record.label}`}); } }}><option value="">{lane.records.length ? "Inspect record…" : "No loaded records"}</option>{lane.records.map(record=><option key={record.id} value={record.id}>{fmtTime(new Date(record.time).toISOString())} · {record.label}</option>)}</select>
      </div>)}
    </div>}
  </section>;
}
