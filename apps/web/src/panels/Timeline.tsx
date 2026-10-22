import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useApp } from "../lib/state.tsx";
import { ACTION_LABEL, EVENT_OUTCOME_COLOR, fmtDateTime, fmtSpan, fmtTime } from "../lib/vocab.ts";
import { Icon } from "../lib/icons.tsx";

export function Timeline() {
  const { ui, dispatch, vm } = useApp();
  const start = Date.parse(vm.data.window.start), end = Date.parse(vm.data.window.end);
  const span = Math.max(1, end - start);
  const at = Date.parse(vm.at);
  const pct = ((Math.min(Math.max(at, start), end) - start) / span) * 100;
  const track = useRef<HTMLDivElement>(null);
  const all = vm.data.events;
  const ticks = useMemo(() => all.map((e) => {
    const t = Date.parse(ui.basis === "known" ? e.received_at : e.occurred_at);
    return { e, t, x: ((t - start) / span) * 100 };
  }), [all, start, span, ui.basis]);
  const axis = useMemo(() => [0, 0.25, 0.5, 0.75, 1].map((f) => ({ f, label: fmtTime(new Date(start + f * span).toISOString()).replace(" UTC", "") })), [start, span]);

  const seek = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    dispatch({ type: "playhead", at: f >= 0.999 ? null : new Date(start + f * span).toISOString() });
  };
  const onDown = (e: PointerEvent) => { seek(e.clientX); (e.target as Element).setPointerCapture(e.pointerId); };
  const onMove = (e: PointerEvent) => { if (e.buttons === 1) seek(e.clientX); };
  const onKey = (e: KeyboardEvent) => {
    const stepMs = e.shiftKey ? 60_000 : 10_000;
    if (e.key === "ArrowLeft") { e.preventDefault(); dispatch({ type: "playhead", at: new Date(Math.max(start, at - stepMs)).toISOString() }); }
    if (e.key === "ArrowRight") { e.preventDefault(); const n = at + stepMs; dispatch({ type: "playhead", at: n >= end ? null : new Date(n).toISOString() }); }
    if (e.key === "Home") { e.preventDefault(); dispatch({ type: "playhead", at: new Date(start).toISOString() }); }
    if (e.key === "End") { e.preventDefault(); dispatch({ type: "playhead", at: null }); }
  };
  const live = vm.data.project.dataset_kind === "live" && vm.isLatest;
  const mode = live ? "live" : vm.isLatest ? "latest" : "historical";
  return (
    <section className="timeline" aria-label="Timeline and replay">
      <div className="tl-controls">
        <button className="tl-play" onClick={() => { if (!ui.playing && vm.isLatest) dispatch({ type: "playhead", at: new Date(start).toISOString() }); dispatch({ type: "playing", playing: !ui.playing }); }}
          aria-label={ui.playing ? "Pause replay" : "Play replay"} title={ui.playing ? "Pause  (space)" : "Play replay  (space)"}>
          <Icon name={ui.playing ? "pause" : "play"} size={14} strokeWidth={2.5} />
        </button>
        <button className="icon-btn sm" onClick={() => { dispatch({ type: "playing", playing: false }); dispatch({ type: "playhead", at: null }); }} disabled={vm.isLatest} aria-label="Jump to latest" title="Jump to latest  (End)">
          <Icon name="latest" size={15} />
        </button>
        <div className={`tl-time ${mode}`} aria-live="polite">
          <b>{fmtTime(vm.at)}</b>
          <span>{live ? "Live" : vm.isLatest ? "Latest evidence" : `Historical replay · ${fmtSpan(at - start)} in`}</span>
        </div>
        <div className="spacer" />
        <label className="select-inline">Speed
          <select value={ui.speed} onChange={(e) => dispatch({ type: "speed", speed: Number(e.target.value) })}>
            {[5, 15, 30, 60, 120].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <div className="seg" role="radiogroup" aria-label="Replay basis">
          <button role="radio" aria-checked={ui.basis === "occurred"} className={ui.basis === "occurred" ? "on" : ""} onClick={() => dispatch({ type: "basis", basis: "occurred" })} title="Replay by when events happened">As occurred</button>
          <button role="radio" aria-checked={ui.basis === "known"} className={ui.basis === "known" ? "on" : ""} onClick={() => dispatch({ type: "basis", basis: "known" })} title="Replay by when Digital Kingdom received them">As known</button>
        </div>
      </div>
      <div className="tl-track" ref={track} role="slider" tabIndex={0} aria-label="Replay position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-valuetext={vm.isLatest ? "Latest" : fmtDateTime(vm.at)}
        onPointerDown={onDown} onPointerMove={onMove} onKeyDown={onKey}>
        <div className="tl-rail" />
        {!vm.isLatest && <div className="tl-fill" style={{ width: `${pct}%` }} />}
        {ticks.map(({ e, t, x }) => (
          <button key={e.id} className={`tl-tick${vm.lateEventIds.has(e.id) ? " late" : ""}${!vm.isLatest && t > at ? " future" : ""}${ui.selection?.kind === "event" && ui.selection.id === e.id ? " selected" : ""}`} style={{ left: `${x}%`, background: EVENT_OUTCOME_COLOR[e.outcome] }}
            title={`${fmtTime(e.occurred_at)} ${ACTION_LABEL[e.action] ?? e.action} (${e.outcome})`} aria-label={`${ACTION_LABEL[e.action] ?? e.action} ${e.outcome} at ${fmtTime(e.occurred_at)}`} tabIndex={-1}
            onPointerDown={(ev) => ev.stopPropagation()} onClick={() => dispatch({ type: "select", selection: { kind: "event", id: e.id } })} />
        ))}
        <div className="tl-head" style={{ left: `${pct}%` }} aria-hidden />
      </div>
      <div className="tl-axis" aria-hidden>{axis.map((a) => <span key={a.f} style={{ left: `${a.f * 100}%` }}>{a.label}</span>)}</div>
    </section>
  );
}
