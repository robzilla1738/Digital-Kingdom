import { useCallback, useContext, useEffect, useState } from "react";
import { ActionsCtx, type NotificationStatus } from "../../inspector/actions.tsx";

/**
 * R03.5: attention delivery as the outbox records it. Failures show here, not only in server logs. Delivery counts
 * describe the outbox; they are not a measure of investigation outcomes. Destinations are configured by an
 * administrator through the API, and only an authorized destination with a delivered test is a working one.
 */
export function NotificationStatusPanel() {
  const actions = useContext(ActionsCtx);
  const [data, setData] = useState<NotificationStatus | null>(null), [error, setError] = useState(""), [msg, setMsg] = useState("");
  const load = useCallback((signal?: AbortSignal) => { if (!actions) return; actions.notifications(signal).then(setData, (e: Error) => { if (!signal?.aborted) setError(e.message); }); }, [actions]);
  useEffect(() => { const c = new AbortController(); load(c.signal); return () => c.abort(); }, [load]);
  if (!actions) return <div className="empty"><h3>Notification delivery runs on the server.</h3><p>The offline demo has no server and sends nothing.</p></div>;
  if (error) return <p className="scope-note warning" role="alert">Notification status unavailable: {error}</p>;
  if (!data) return <p className="small faint">Loading notification status…</p>;
  const ack = async (id: string) => { try { const r = await actions.acknowledgeNotification(id); setMsg(`Acknowledged ${r.acknowledged} notification record(s).`); load(); } catch (e) { setMsg(`Could not acknowledge: ${(e as Error).message}`); } };
  return <div className="integration-grid" data-testid="notification-status">
    <article className="section-card">
      <h3>Attention delivery</h3>
      <p className="small">{data.counts.pending} pending · {data.counts.delivered} delivered · {data.counts.failed} failed · {data.counts.acknowledged} acknowledged</p>
      <p className="scope-note">{data.note} Messages carry identifiers and a sign-in link only, never titles or evidence.</p>
      {msg && <p className="small" role="status">{msg}</p>}
    </article>
    <article className="section-card" aria-label="Delivery failures">
      <h3>Failures</h3>
      {data.failures.length === 0 ? <p className="small faint">No failed or retrying deliveries.</p> :
        <table className="data-table"><thead><tr><th>Kind</th><th>State</th><th>Attempts</th><th>Last error</th><th>Next attempt</th></tr></thead><tbody>
          {data.failures.map((f) => <tr key={f.id}><td>{f.kind}</td><td><span className="chip">{f.state}</span></td><td>{f.attempts}</td><td className="small">{f.last_error}</td><td className="small">{f.next_attempt_at ?? "none"}</td></tr>)}
        </tbody></table>}
    </article>
    <article className="section-card" aria-label="Recent notifications">
      <h3>Recent</h3>
      {data.recent.length === 0 ? <p className="small faint">Nothing has been queued for this project.</p> :
        <table className="data-table"><thead><tr><th>Kind</th><th>Severity</th><th>State</th><th>Case</th><th /></tr></thead><tbody>
          {data.recent.map((r) => <tr key={r.id}><td>{r.kind}</td><td>{r.severity}</td><td><span className="chip">{r.state}</span></td><td className="small">{r.case_id ?? ""}</td><td>{!r.acknowledged_at && r.kind !== "test" ? <button className="secondary" onClick={() => void ack(r.id)}>Acknowledge</button> : null}</td></tr>)}
        </tbody></table>}
    </article>
  </div>;
}
