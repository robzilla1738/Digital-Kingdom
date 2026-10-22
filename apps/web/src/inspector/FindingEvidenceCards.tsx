import { useMemo, useState } from "react";
import type { SecurityEvent } from "@dk/contracts";
import { useApp } from "../lib/state.tsx";
import { ACTION_LABEL, EVENT_OUTCOME_COLOR, fmtDateTime } from "../lib/vocab.ts";
import { CopyReference } from "./Shared.tsx";
import { EVIDENCE_CARDS_PER_PAGE, EVIDENCE_TEXT_LIMIT, evidenceCardPayload, evidenceDisplayPage, evidenceTextPage } from "./evidenceCards.ts";

type Role = "supporting" | "counter";
type Records = Record<string, Record<string, unknown>>;

export function FindingEvidenceCards({ events, records, role, findingId, revision }: { events: SecurityEvent[]; records: Records; role: Role; findingId: string; revision: number }) {
  const [page, setPage] = useState(1);
  const display = evidenceDisplayPage(events, page), group = role === "counter" ? "counterevidence" : "supporting";
  if (!events.length) return <p className="faint small">No {group} events loaded.</p>;
  return <div className="finding-evidence-cards" data-evidence-group={role}>
    <div className="evidence-card-pagination" data-testid="evidence-card-pagination" data-evidence-group={role}>
      <p role="status">Showing {display.start + 1}–{display.end} of {display.total} loaded {group} records. {display.pages > 1 && <>Display page {display.page} of {display.pages}; at most {EVIDENCE_CARDS_PER_PAGE} cards per page. All loaded records are retained; display paging is not retrieval truncation.</>}</p>
      {display.pages > 1 && <nav className="btn-row" aria-label={`${group} evidence display pages`}>
        <button className="btn sm" aria-label={`First ${group} evidence page`} disabled={display.page === 1} onClick={() => setPage(1)}>First</button>
        <button className="btn sm" aria-label={`Previous ${group} evidence page`} disabled={display.page === 1} onClick={() => setPage(display.page - 1)}>Previous</button>
        <button className="btn sm" aria-label={`Next ${group} evidence page`} disabled={display.page === display.pages} onClick={() => setPage(display.page + 1)}>Next</button>
        <button className="btn sm" aria-label={`Last ${group} evidence page`} disabled={display.page === display.pages} onClick={() => setPage(display.pages)}>Last</button>
      </nav>}
    </div>
    {display.items.map((event) => <EvidenceCard key={event.id} event={event} records={records} role={role} findingId={findingId} revision={revision} />)}
  </div>;
}

function EvidenceCard({ event: e, records, role, findingId, revision }: { event: SecurityEvent; records: Records; role: Role; findingId: string; revision: number }) {
  const { vm, dispatch } = useApp();
  const [expanded, setExpanded] = useState(false);
  const source = vm.latestData.sources.find((entry) => entry.id === e.source_id);
  const stored = [...new Set(e.evidence_refs.filter((ref) => ref.startsWith("evidence:")))], available = stored.filter((ref) => records[ref]);
  const relationship = role === "counter" ? "Counterevidence" : "Supporting evidence";
  return <article className={`finding-evidence-card ${role}`} data-event-id={e.id} data-evidence-role={role} aria-label={`${relationship}: ${e.id}`}>
    <header className="evidence-card-heading"><h4 data-testid="evidence-card-action">{ACTION_LABEL[e.action] ?? e.action}</h4><span className="evidence-card-outcome" data-testid="evidence-card-outcome"><span className="out-dot" style={{ background: EVENT_OUTCOME_COLOR[e.outcome] }} aria-hidden />{e.outcome === "success" ? "Operation succeeded" : e.outcome === "observed" ? "Effect observed" : e.outcome}</span></header>
    <p className="evidence-card-relationship" data-testid="evidence-card-relationship"><strong>{relationship}</strong> for finding <code>{findingId}</code> · pinned revision {revision}. {role === "counter" ? "This record challenges the claim; neither source is assumed correct." : "This record contributes to the recorded claim, not activity outside its scope."}</p>
    <dl className="evidence-card-facts">
      <dt>Source</dt><dd data-testid="evidence-card-source"><strong>{source?.label ?? "Source name unavailable"}</strong><small>Source name is current metadata.</small><code>{e.source_id}</code></dd>
      <dt>Record ID</dt><dd><code>{e.id}</code></dd>
      <dt>Recorded action</dt><dd><code>{e.action}</code></dd>
      <dt>Occurred (UTC)</dt><dd data-testid="evidence-card-occurred"><time dateTime={e.occurred_at}>{fmtDateTime(e.occurred_at)}</time></dd>
      <dt>Received (UTC)</dt><dd data-testid="evidence-card-received"><time dateTime={e.received_at}>{fmtDateTime(e.received_at)}</time>{Date.parse(e.received_at) - Date.parse(e.occurred_at) > 60000 && <small className="late-flag">Late arrival</small>}</dd>
    </dl>
    <p className="evidence-card-redaction" data-testid="evidence-card-redaction">{stored.length ? <>{available.length} of {stored.length} referenced stored payloads loaded. Stored evidence is redacted at ingestion; redaction does not guarantee anonymity. {available.length < stored.length && "Missing stored references remain unresolved; the bundle is incomplete."}</> : <>Normalized event only; no stored evidence payload is referenced. Redaction does not guarantee anonymity; sensitive identifiers may remain.</>}</p>
    <div className="evidence-card-reference" data-testid="evidence-card-reference"><span>Stable event reference</span><div className="btn-row"><CopyReference kind="event" id={e.id} /><button className="btn sm" aria-label={`Open event ${e.id}`} onClick={() => dispatch({ type: "select", selection: { kind: "event", id: e.id } })}>Open event detail</button></div></div>
    <details className="evidence-card-raw" data-testid="evidence-card-raw" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>Show recorded text — untrusted</summary>
      {expanded && <RawEvidence event={e} records={records} />}
    </details>
  </article>;
}

function RawEvidence({ event, records }: { event: SecurityEvent; records: Records }) {
  const text = useMemo(() => JSON.stringify(evidenceCardPayload(event, records), null, 2), [event, records]);
  const [page, setPage] = useState(1), display = evidenceTextPage(text, page);
  return <div className="evidence-card-raw-body">
    <p className="scope-note warning"><strong>Recorded text — untrusted.</strong> Normalized data and available redacted evidence, not instructions or original source bytes. Text is displayed inertly; nothing here is executed.</p>
    <p className="small faint" role="status">Text page {display.page} of {display.pages}, characters {display.start + 1}–{display.end} of {display.total}. At most {EVIDENCE_TEXT_LIMIT} characters are displayed at once. {display.pages > 1 && "This is a text fragment; the full loaded record is retained."}</p>
    <pre role="region" className="evidence-card-payload" data-testid="evidence-card-payload" tabIndex={0} aria-label={`Recorded text for ${event.id}`}>{display.text}</pre>
    {display.pages > 1 && <nav className="btn-row" aria-label={`Recorded text pages for ${event.id}`}><button className="btn sm" disabled={display.page === 1} onClick={() => setPage(display.page - 1)}>Previous text page</button><button className="btn sm" disabled={display.page === display.pages} onClick={() => setPage(display.page + 1)}>Next text page</button></nav>}
  </div>;
}
