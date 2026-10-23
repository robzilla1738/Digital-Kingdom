import { useContext, useRef, useState } from "react";
import { EVENT_ACTIONS, EVENT_OUTCOMES } from "@dk/contracts";
import { useApp } from "../../lib/state.tsx";
import { ActionsCtx, type CoverageHistoryResult } from "../../inspector/actions.tsx";
import { fmtDateTime } from "../../lib/vocab.ts";

const STATE_LABEL: Record<string, string> = { covered: "Covered", partial: "Partial", unknown: "Unknown" };
const toUtcInput = (iso: string) => new Date(iso).toISOString().slice(0, 16);

/**
 * R01.2: "Could this have been recorded?" for one asset, one event class and an interval. The answer is spans
 * of covered / partial / unknown with each source's reason; it is never a statement that nothing happened.
 */
export function HistoricalCoverage() {
  const { vm } = useApp();
  const actions = useContext(ActionsCtx);
  const assets = vm.data.graph.assets;
  const end = vm.latestData.window?.end ?? new Date().toISOString();
  const [asset, setAsset] = useState(assets[0]?.id ?? ""), [action, setAction] = useState<string>("data_access"), [outcome, setOutcome] = useState("");
  const [after, setAfter] = useState(toUtcInput(new Date(Date.parse(end) - 24 * 3600_000).toISOString())), [before, setBefore] = useState(toUtcInput(end));
  const [result, setResult] = useState<CoverageHistoryResult | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const seq = useRef(0);
  if (!actions || vm.data.mode !== "server") return <div className="empty"><h3>Historical coverage needs a server connection.</h3><p>The offline demo has no source configuration history. Connect to a Digital Kingdom server to ask whether an interval could have been recorded.</p></div>;
  const submit = async () => {
    const id = ++seq.current; setBusy(true); setError(""); setResult(null);
    try {
      const r = await actions.coverageHistory({ asset, action, ...(outcome ? { outcome } : {}), after: `${after}:00Z`, before: `${before}:00Z` });
      if (id === seq.current) setResult(r);
    } catch (e) { if (id === seq.current) setError((e as Error).message); } finally { if (id === seq.current) setBusy(false); }
  };
  const total = result ? result.totals_ms.covered + result.totals_ms.partial + result.totals_ms.unknown : 0;
  return <section className="section-card" aria-label="Historical coverage question" data-testid="historical-coverage">
    <h2>Could this have been recorded?</h2>
    <p className="small faint">Covered means a capable, enabled source was live. It never means nothing happened, and current health never fills a past gap.</p>
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="filter-bar">
        <label className="field">Asset<select aria-label="Historical coverage asset" value={asset} onChange={(e) => setAsset(e.target.value)}>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="field">Activity<select aria-label="Historical coverage activity" value={action} onChange={(e) => setAction(e.target.value)}>{EVENT_ACTIONS.map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}</select></label>
        <label className="field">Outcome<select aria-label="Historical coverage outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="">Any</option>{EVENT_OUTCOMES.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
      <div className="filter-bar">
        <label className="field">From (UTC)<input aria-label="Historical coverage start (UTC)" type="datetime-local" value={after} onChange={(e) => setAfter(e.target.value)} required /></label>
        <label className="field">To (UTC)<input aria-label="Historical coverage end (UTC)" type="datetime-local" value={before} onChange={(e) => setBefore(e.target.value)} required /></label>
        <button className="btn" disabled={busy}>{busy ? "Checking…" : "Check coverage"}</button>
      </div>
    </form>
    {error && <p className="scope-note warning" role="alert">Not answered: {error}</p>}
    {result && <div aria-live="polite">
      <p><strong>{Math.round((result.totals_ms.unknown / Math.max(total, 1)) * 100)}% unknown</strong>, {Math.round((result.totals_ms.partial / Math.max(total, 1)) * 100)}% partial, {Math.round((result.totals_ms.covered / Math.max(total, 1)) * 100)}% covered. Known as of {fmtDateTime(result.known_at)}.</p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Coverage spans"><table className="data-table"><thead><tr><th>From</th><th>To</th><th>State</th><th>Why</th></tr></thead><tbody>
        {result.spans.map((s) => <tr key={s.from} data-state={s.state}><td>{fmtDateTime(s.from)}</td><td>{fmtDateTime(s.to)}</td><td><span className={`chip coverage-${s.state}`}>{STATE_LABEL[s.state] ?? s.state}</span></td><td className="small">{s.sources.length ? s.sources.map((x) => `${x.source_id}: ${x.reason}`).join("; ") : "No source is assigned to this asset."}</td></tr>)}
      </tbody></table></div>
      <ul className="small faint">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>
    </div>}
  </section>;
}
