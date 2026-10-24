import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ActionsCtx } from "../../inspector/actions.tsx";
import { ATTENTION_KIND_LABEL, attentionItems, type AttentionQueue } from "../../lib/attention.ts";
import { fmtDateTime } from "../../lib/vocab.ts";

/**
 * LP15 local attention queue. In-app only: new evidence, contradictions, incomplete repairs, observer gaps and stale
 * checks for this project, deduplicated on the server. Acknowledging marks an item seen; it never closes or changes
 * a case or a finding, and a new distinct record reopens it.
 */
export function AttentionPanel({ project, canEdit, onOpenCase }: { project: string; canEdit: boolean; onOpenCase: (caseId: string) => void }) {
  const actions = useContext(ActionsCtx);
  const [q, setQ] = useState<AttentionQueue | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState<string | null>(null), [message, setMessage] = useState("");
  const ctl = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!actions?.attention) return;
    ctl.current?.abort();
    const c = new AbortController(); ctl.current = c;
    try { const next = await actions.attention(c.signal); if (!c.signal.aborted) { setQ(next); setError(""); } }
    catch (e) { if (!c.signal.aborted) setError((e as Error).message); }
  }, [actions]);
  useEffect(() => { void load(); return () => ctl.current?.abort(); }, [load, project]);
  if (!actions?.attention) return null;
  const items = attentionItems(q, project);
  const ack = async (id: string, seq: number) => {
    if (!actions.acknowledgeAttention) return;
    setBusy(id); setMessage("");
    try { await actions.acknowledgeAttention(id, seq); setMessage("Acknowledged. The case and finding are unchanged."); }
    catch (e) { setMessage(`Not acknowledged: ${(e as Error).message}`); }
    finally { setBusy(null); await load(); }
  };
  return <section className="section-card attention-panel" aria-label="Attention queue" data-testid="attention-queue">
    <div className="attention-head">
      <h2>Attention <span className="small faint">{q ? `${q.counts.open} open · ${q.counts.acknowledged} acknowledged` : ""}</span></h2>
      <button className="btn" onClick={() => void load()} disabled={!!busy}>Refresh</button>
    </div>
    <p className="small faint">Kept in this console only; no notification is sent anywhere. Acknowledging an item never closes a case or a finding.</p>
    {message && <p className="small" role="status">{message}</p>}
    {error && <p className="small" role="alert">Attention queue unavailable: {error}</p>}
    {!q && !error && <p className="small faint">Loading…</p>}
    {q && !items.length && <p className="small faint">Nothing needs attention.</p>}
    {items.length > 0 && <ul className="attention-list">{items.map((i) => <li key={i.id} data-kind={i.kind} data-urgency={i.urgency} data-state={i.state}>
      <div className="attention-row">
        <span className={`pill attention-${i.urgency}`}>{i.urgency}</span>
        <strong>{ATTENTION_KIND_LABEL[i.kind]}</strong>
        {i.new_since_acknowledged ? <span className="pill">{i.new_since_acknowledged} new since acknowledged</span> : null}
        <small className="faint">{i.occurrences} record{i.occurrences === 1 ? "" : "s"}{i.repeats ? ` · ${i.repeats} repeat${i.repeats === 1 ? "" : "s"} merged` : ""} · {fmtDateTime(i.last_at)}</small>
      </div>
      <div className="small">{i.summary}</div>
      {i.urgency_note && <div className="small faint">{i.urgency_note}</div>}
      <div className="attention-actions">
        {i.case_id && <button className="link-btn" onClick={() => onOpenCase(i.case_id!)}>Open case</button>}
        {canEdit && i.state === "open" && actions.acknowledgeAttention && <button className="btn" disabled={busy === i.id} aria-label={`Acknowledge ${ATTENTION_KIND_LABEL[i.kind]} ${i.subject.id}`} onClick={() => void ack(i.id, i.last_seq)}>Acknowledge</button>}
      </div>
    </li>)}</ul>}
  </section>;
}
