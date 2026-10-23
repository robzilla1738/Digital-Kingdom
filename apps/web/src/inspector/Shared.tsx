import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Finding, SecurityEvent } from "@dk/contracts";
import { useApp } from "../lib/state.tsx";
import { ACTION_LABEL, EVENT_OUTCOME_COLOR, OUTCOME_STYLE, fmtDateTime } from "../lib/vocab.ts";
import { StateIcon } from "../lib/icons.tsx";
import { safeReferenceUrl } from "../lib/investigation.ts";
import type { Selection } from "../lib/navigation.ts";

export function Section({ title, count, children, id }: { title: string; count?: number; children: ReactNode; id?: string }) {
  return <section className="ev-section" id={id}><h3>{title}{count !== undefined && <span className="count">{count}</span>}</h3>{children}</section>;
}
export function KV({ k, v }: { k: string; v: ReactNode }) { return <div className="kv"><span>{k}</span><span>{v}</span></div>; }
export function FindingChip({ f }: { f: Finding }) {
  const { dispatch } = useApp();
  return <li><button className="link-row" onClick={() => dispatch({ type: "select", selection: { kind: "finding", id: f.id } })}>
    <StateIcon state={f.outcome_state} /><span className="grow">{f.title}</span><span className="faint">{OUTCOME_STYLE[f.outcome_state].label}</span>
  </button></li>;
}
export function EventTable({ events, role = "related" }: { events: SecurityEvent[]; role?: "supporting" | "counter" | "related" }) {
  const { dispatch } = useApp();
  if (!events.length) return <p className="faint small">No {role === "counter" ? "counterevidence" : role} events loaded.</p>;
  const select = (id: string) => dispatch({ type: "select", selection: { kind: "event", id } });
  return <div className="table-wrap"><table className="ev-table"><thead><tr><th scope="col">Occurred / received (UTC)</th><th scope="col">Action</th><th scope="col">Outcome</th><th scope="col">Source</th></tr></thead><tbody>
    {events.map((e) => <tr key={e.id} data-event-id={e.id} data-evidence-role={role} onClick={() => select(e.id)}>
      <td className="t">{fmtDateTime(e.occurred_at)}<small className="faint">Received {fmtDateTime(e.received_at)}</small>{Date.parse(e.received_at) - Date.parse(e.occurred_at) > 60_000 && <span className="late-flag">Late arrival</span>}</td>
      <td className="act"><button className="link" aria-label={`Open event ${e.id}`} onClick={(event) => { event.stopPropagation(); select(e.id); }}>{ACTION_LABEL[e.action] ?? e.action}</button><small className="faint">{e.id}</small></td>
      <td><span className="out"><span className="out-dot" style={{ background: EVENT_OUTCOME_COLOR[e.outcome] }} aria-hidden />{e.outcome === "success" ? "Operation succeeded" : e.outcome}</span></td>
      <td className="src">{e.source_id}</td>
    </tr>)}
  </tbody></table></div>;
}

/** Native modal provides keyboard containment, Escape, and focus restoration. Nothing copies until reviewed. */
export function PrivacyAction({ label, title, scope, text, confirmLabel = "Copy reviewed text", onConfirm, disabled = false }: {
  label: string; title: string; scope: string[]; text?: string; confirmLabel?: string; onConfirm?: () => Promise<void>; disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => { const el = dialog.current; return () => { if (el?.open) el.close(); }; }, []);
  const close = () => { dialog.current?.close(); trigger.current?.focus(); };
  const apply = async () => {
    setBusy(true); setMessage("");
    try { if (onConfirm) await onConfirm(); else if (text !== undefined) await navigator.clipboard.writeText(text); setMessage(onConfirm ? "Export requested successfully." : "Copied."); }
    catch (error) { setMessage(onConfirm ? `Export failed: ${(error as Error).message}` : "Clipboard unavailable. Select and copy the reviewed text below."); }
    finally { setBusy(false); }
  };
  return <><button ref={trigger} className="btn sm" disabled={disabled} onClick={() => { setMessage(""); dialog.current?.showModal(); }}>{label}</button>
    <dialog ref={dialog} className="privacy-dialog" aria-label={title} onClose={() => trigger.current?.focus()}>
      <h2>{title}</h2><p>Review the scope before sharing. References can expose project and record metadata; links do not grant access.</p>
      <ul className="bullets">{scope.map((item, i) => <li key={i}>{item}</li>)}</ul>
      {text !== undefined && <label className="field">Text to copy<textarea aria-label="Text to copy" className="note" readOnly rows={7} value={text} /></label>}
      <div className="btn-row"><button className="btn primary" disabled={busy} onClick={() => void apply()}>{busy ? "Working…" : confirmLabel}</button><button className="btn" onClick={close}>Close preview</button></div>
      <p role="status" className="status-msg">{message}</p>
    </dialog></>;
}
export function CopyReference({ kind, id }: { kind: string; id: string }) {
  const { vm, ui } = useApp();
  const url = safeReferenceUrl(location.href, vm.data.project.id, { workspace: ui.workspace, view: ui.view, selection: { kind: kind as NonNullable<Selection>["kind"], id }, playhead: ui.playhead, basis: ui.basis, investigateTab: ui.investigateTab });
  return <PrivacyAction label="Copy reference" title="Reference privacy preview" scope={[`Project: ${vm.data.project.id}. Object: ${kind} ${id}.`, "Includes only navigation references and selected replay time. No evidence payload, credentials, network addresses or event-search filters are included.", "Normal project authorization is required when the link is opened."]} text={url} />;
}
