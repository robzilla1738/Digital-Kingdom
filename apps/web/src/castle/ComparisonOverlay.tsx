import { useContext, useEffect, useState } from "react";
import { Html } from "@react-three/drei";
import { ActionsCtx, type WorldComparisonView } from "../inspector/actions.tsx";
import { useApp } from "../lib/state.tsx";

const OP_TEXT = { added: "Added in repair", removed: "Removed in repair", changed: "Changed in repair" } as const;
const OP_GLYPH = { added: "+", removed: "−", changed: "Δ" } as const;

/** LP19: `?cmp=<comparison id>` loads the read-only world comparison for the castle. Nothing is stored or recompiled. */
export function useWorldComparison(): { view: WorldComparisonView | null; error: string | null; id: string | null } {
  const actions = useContext(ActionsCtx);
  const id = new URLSearchParams(location.search).get("cmp");
  const [state, setState] = useState<{ view: WorldComparisonView | null; error: string | null }>({ view: null, error: null });
  useEffect(() => {
    if (!id) return;
    if (!actions?.worldComparison) { setState({ view: null, error: "World comparison needs the server; this view has no comparison records." }); return; }
    const ctl = new AbortController();
    actions.worldComparison(id, ctl.signal).then((view) => setState({ view, error: null }), (e: unknown) => { if (!ctl.signal.aborted) setState({ view: null, error: e instanceof Error ? e.message : "comparison unavailable" }); });
    return () => ctl.abort();
  }, [id, actions]);
  return { ...state, id };
}

/** Ghost badges on the SAME baseline rooms (common layout/camera): text + glyph, never colour only. */
export function ComparisonBadges({ view }: { view: WorldComparisonView }) {
  return <group name="comparison-badges">{view.rooms.filter((r) => r.baseline_position).map((r) =>
    <Html key={r.asset_id} position={[r.baseline_position!.x, 0.6, r.baseline_position!.z]} center zIndexRange={[28, 22]}>
      <span data-comparison-room={r.asset_id} data-change={r.change} style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, border: "1px dashed #EEF3FA", background: "rgba(18,28,41,0.9)", color: "#EEF3FA", whiteSpace: "nowrap" }}
        title={r.refs.join("\n")}>{OP_GLYPH[r.change]} {r.asset_id} · {OP_TEXT[r.change].toLowerCase()} · model only</span>
    </Html>)}</group>;
}

export function ComparisonPanel({ view, error, id }: { view: WorldComparisonView | null; error: string | null; id: string | null }) {
  const { dispatch } = useApp();
  if (!id) return null;
  const download = () => { if (!view) return; const url = URL.createObjectURL(new Blob([JSON.stringify(view, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = `world-comparison-${view.comparison_id}.json`; a.click(); URL.revokeObjectURL(url); };
  return <section data-testid="world-comparison" aria-label="Baseline versus repair comparison" style={{ position: "absolute", right: 16, top: 16, zIndex: 31, width: 360, maxHeight: "calc(100% - 120px)", overflow: "auto", background: "#121C29", color: "#EEF3FA", border: "1px solid #70849B", borderRadius: 10, padding: 12, fontSize: 12 }}>
    <h3 style={{ margin: "0 0 6px" }}>Baseline vs repair · model only</h3>
    {error && <p role="alert">{error}</p>}
    {view && <>
      <p className="small">Drawn on the baseline layout and camera; no room moved. Castle geometry is presentation, never a security fact.</p>
      <dl data-testid="comparison-revisions" style={{ margin: "4px 0" }}><dt>Baseline</dt><dd>graph {view.revisions.baseline.graph_revision} · state {view.revisions.baseline.state_hash.slice(0, 12)}{view.revisions.baseline.current ? " (current)" : " (no longer current)"}</dd>
        <dt>Repair candidate</dt><dd>{view.revisions.candidate.namespace} · state {view.revisions.candidate.state_hash.slice(0, 12)} · receipt {view.revisions.candidate.receipt_digest.slice(0, 12)}</dd></dl>
      {view.warnings.map((w) => <p key={w} data-testid="comparison-warning" role="note">⚠ {w}</p>)}
      <h4 style={{ margin: "6px 0 2px" }}>Changes ({view.changes.length})</h4>
      <ul style={{ paddingLeft: 16, margin: 0 }}>{view.changes.map((c) => <li key={c.key} data-change-key={c.key} data-op={c.op}>
        <strong>{OP_GLYPH[c.op]} {c.op}</strong> <code>{c.key}</code>
        {c.asset_ids.map((a) => <button key={a} className="btn sm" onClick={() => dispatch({ type: "select", selection: { kind: "asset", id: a } })}>{a}</button>)}
        {!c.resolved_to_asset && <span> · not placed in the castle</span>}
        {c.unresolved.map((u) => <div key={u} className="small faint">Unresolved: {u}</div>)}
      </li>)}</ul>
      <h4 style={{ margin: "6px 0 2px" }}>Model-only access (configured permission)</h4>
      <ul style={{ paddingLeft: 16, margin: 0 }} data-testid="comparison-access">{view.model_only.access.map((a, i) => <li key={i} data-executed={String(a.executed)} data-verified={String(a.verified)}>{a.probe.principal} {a.probe.action} {a.probe.resource}: {a.base} → {a.candidate} · not executed · not verified</li>)}</ul>
      <h4 style={{ margin: "6px 0 2px" }}>Executed local results</h4>
      <p data-testid="comparison-executed-local">{view.executed_local.results.length ? `${view.executed_local.results.length} linked run(s)` : view.executed_local.note}</p>
      <button className="btn sm" onClick={download}>Export comparison (JSON)</button>
    </>}
  </section>;
}
