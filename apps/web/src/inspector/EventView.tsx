import { useContext, useEffect, useRef, useState } from "react";
import type { EventDetailResponse } from "@dk/contracts";
import { useApp } from "../lib/state.tsx";
import { ACTION_LABEL, EVENT_OUTCOME_COLOR, fmtDateTime } from "../lib/vocab.ts";
import { isAccessDenied, NETWORK_IDENTITY_NOTE, offlineEventDetail } from "../lib/investigation.ts";
import { ActionsCtx } from "./actions.tsx";
import { CopyReference, KV, Section } from "./Shared.tsx";

export function EventView({ id }: { id: string }) {
  const { dispatch, vm, ui } = useApp();
  const actions = useContext(ActionsCtx), actionsRef = useRef(actions); actionsRef.current = actions;
  const [detail, setDetail] = useState<EventDetailResponse | null>(() => vm.data.mode === "offline-demo" ? offlineEventDetail(vm.data, id) : null), [error, setError] = useState("");
  const [retry, setRetry] = useState(0), [busy, setBusy] = useState(vm.data.mode === "server"), [denied, setDenied] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    const seq = ++request.current, controller = new AbortController(); setDetail(null); setError(""); setDenied(false);
    if (vm.data.mode === "offline-demo") { const result = offlineEventDetail(vm.data, id); setDetail(result); if (result) dispatch({ type: "resolvedEvent", id, assetIds: result.event.asset_ids }); setBusy(false); return; }
    const api = actionsRef.current; if (!api) { setError("Event detail is unavailable in this deployment."); return; }
    setBusy(true);
    api.eventDetail(id, controller.signal).then((result) => {
      if (seq !== request.current || controller.signal.aborted) return;
      if (result.project_id !== vm.data.project.id || result.event.id !== id) throw new Error("Event response did not match the requested project and record.");
      setDetail(result); dispatch({ type: "resolvedEvent", id, assetIds: result.event.asset_ids });
    }).catch((err: unknown) => { if (seq !== request.current || controller.signal.aborted) return; setDetail(null); setDenied(isAccessDenied(err)); setError(isAccessDenied(err) ? "Access denied. Cached event records have been removed." : `Could not load event: ${(err as Error).message}`); }).finally(() => { if (seq === request.current && !controller.signal.aborted) setBusy(false); });
    return () => { controller.abort(); ++request.current; };
    // Snapshot updates do not replace the exact selected event while it is being read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, vm.data.project.id, vm.data.mode, retry]);
  if (busy) return <p className="scope-note" role="status">Loading this exact event and its evidence…</p>;
  if (error) return <div className="callout warn" role="alert"><p>{error}</p>{!denied && <button className="btn" onClick={() => setRetry((n) => n + 1)}>Retry event</button>}</div>;
  if (!detail) return <p className="scope-note">This event is not available in the bundled synthetic dataset.</p>;
  const e = detail.event, completeness = detail.evidence_completeness;
  const name = (assetId: string) => vm.data.graph.assets.find((a) => a.id === assetId)?.name ?? assetId;
  const outside = !!ui.playhead && Date.parse(ui.basis === "known" ? e.received_at : e.occurred_at) > Date.parse(ui.playhead);
  return <>
    <div className="ev-title"><h2>{ACTION_LABEL[e.action] ?? e.action}</h2><p className="subtitle"><code>{e.id}</code></p>
      <div className="chips"><span className="chip"><span className="out-dot" style={{ background: EVENT_OUTCOME_COLOR[e.outcome] }} aria-hidden />{e.outcome === "success" ? "Operation succeeded" : e.outcome === "observed" ? "Effect observed" : e.outcome}</span><span className="chip">{e.dataset_kind === "synthetic" ? "Synthetic" : "Recorded event"}</span></div>
    </div>
    <CopyReference kind="event" id={id} />
    {outside && <p className="scope-note warning">Outside the selected replay interval. This exact record is displayed for reference, not inserted into the historical replay.</p>}
    {e.outcome === "blocked" && <p className="scope-note">The source reported this request as blocked. Backend effects and intent are not established by this record alone.</p>}
    {(e.outcome === "success" || e.outcome === "observed") && <p className="scope-note">This records an operation or effect, not proof of malicious intent or compromise.</p>}
    <Section title="Source and observation"><div className="kvs">
      <KV k="Source" v={<button className="link" onClick={() => dispatch({ type: "select", selection: { kind: "source", id: detail.source.id } })}>{detail.source.label ?? detail.source.id} · {detail.source.id}</button>} />
      {detail.source.note && <KV k="Source note" v={detail.source.note} />}
      <KV k="Occurred" v={fmtDateTime(e.occurred_at)} /><KV k="Received" v={fmtDateTime(e.received_at)} />
      {Date.parse(e.received_at) - Date.parse(e.occurred_at) > 60_000 && <KV k="Arrival" v="Late record; occurrence and receipt times differ." />}
      <KV k="Affected assets" v={<span className="inline-links">{e.asset_ids.map((assetId) => <button className="link" key={assetId} onClick={() => dispatch({ type: "select", selection: { kind: "asset", id: assetId } })}>{name(assetId)}</button>)}</span>} />
      <KV k="Parser" v={e.parser_version ?? "Not available"} />
      {e.sampled && <KV k="Sampling" v="Sampled trace; not a complete ledger." />}
      {e.coverage_note && <KV k="Coverage note" v={e.coverage_note} />}
    </div></Section>
    <Section title="Evidence completeness"><p>{completeness.returned_records} of {completeness.expected_records} stored evidence records loaded.</p>
      {completeness.expected_records === 0 && <p className="scope-note">No stored evidence record; normalized event only.</p>}
      {!completeness.complete && <p className="scope-note warning">Some referenced records are missing. This evidence bundle is incomplete.</p>}
      {completeness.missing_evidence_refs.length > 0 && <><h4>Unresolved stored references</h4><ul className="bullets">{completeness.missing_evidence_refs.map((ref) => <li key={ref}><code>{ref}</code></li>)}</ul></>}
      {completeness.reference_only_refs.length > 0 && <><h4>Source-native references (not stored payloads)</h4><ul className="bullets">{completeness.reference_only_refs.map((ref) => <li key={ref}><code>{ref}</code></li>)}</ul></>}
    </Section>
    <Section title="Correlation scope"><div className="kvs">
      {e.request_id && <KV k="Request" v={<>{e.request_id} · {e.request_id_trust ?? "trust not supplied"}</>} />}
      {e.actor_ref && <KV k="Actor reference" v={<>{e.actor_ref} · source-local, not a verified person</>} />}
      {e.session_ref && <KV k="Session" v={<>{e.session_ref} · source-local namespace</>} />}
      {e.run_id && <KV k="Run" v={<>{e.run_id} · source-local namespace</>} />}
      {e.trace_id && <KV k="Trace" v={e.trace_id} />}{e.route && <KV k="Route" v={e.route} />}{e.rule_ref && <KV k="Rule" v={e.rule_ref} />}
      {e.client_ip && <KV k="Network address" v={e.client_ip} />}
    </div>{e.client_ip && <p className="scope-note warning">{NETWORK_IDENTITY_NOTE}</p>}{detail.correlation.map((note, i) => <p key={i} className="small faint">{note.namespace}: {note.trust}</p>)}</Section>
    {e.attributes && Object.keys(e.attributes).length > 0 && <Section title="Source-reported attributes"><p className="faint small">Recorded text — untrusted. Displayed as data, never instructions.</p><div className="kvs" data-testid="event-attributes">{Object.entries(e.attributes).map(([key, value]) => <KV key={key} k={key} v={<span className="untrusted">{String(value)}</span>} />)}</div></Section>}
    <Section title="Normalized event"><details><summary>Show recorded text — untrusted</summary><pre className="evidence-json">{JSON.stringify(e, null, 2)}</pre></details></Section>
    <Section title="Stored evidence" count={Object.keys(detail.evidence.records).length}><p className="faint small">Redacted at ingestion. Recorded text is untrusted; redaction is not a guarantee of anonymity.</p>{Object.entries(detail.evidence.records).map(([ref, record]) => <details className="evidence-rec" key={ref}><summary>{ref}</summary><pre className="evidence-json" data-testid="evidence-record">{JSON.stringify(record, null, 2)}</pre></details>)}</Section>
    <Section title="Related findings" count={detail.referenced_by_findings.length}>{detail.referenced_by_findings.length ? <ul className="mini-list">{detail.referenced_by_findings.map((finding) => <li key={finding.id}><button className="link-row" onClick={() => dispatch({ type: "select", selection: { kind: "finding", id: finding.id } })}><span className="grow">{vm.data.findings.find((f) => f.id === finding.id)?.title ?? finding.id}</span><span>{finding.role} · {finding.lifecycle}</span></button></li>)}</ul> : <p className="scope-note" data-testid="event-unlinked">Not referenced by a finding. That does not establish that the record is unimportant.</p>}</Section>
  </>;
}
