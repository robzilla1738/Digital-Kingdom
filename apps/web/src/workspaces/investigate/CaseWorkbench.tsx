import { useState } from "react";
import { useApp } from "../../lib/state.tsx";
import { fmtDateTime } from "../../lib/vocab.ts";
import { anchorForSelection, criticalStatus, READINESS_LABEL, recordsForAnchor, selectionForRecord, type Workbench, type WorkbenchRecord } from "../../lib/workbench.ts";

/**
 * LP12 investigation workbench: what a person reviewing a case needs, as lists and disclosures that work by keyboard,
 * under reduced motion and on a narrow screen. Nothing here needs the 3D camera: every record is readable in place,
 * and "Select in castle" only mirrors the same canonical id into the world. Agent proposals sit in their own region,
 * versioned and never accepted here.
 */
export function CaseWorkbench({ wb, loading, error, canEdit, busy, onContract }: { wb: Workbench | null; loading: boolean; error: string; canEdit: boolean; busy: boolean; onContract: () => void }) {
  const { ui, dispatch } = useApp();
  if (error) return <div className="section-card workbench" data-testid="case-workbench" aria-label="Investigation workbench"><p className="scope-note warning" role="alert">Workbench unavailable: {error}</p></div>;
  if (!wb) return <div className="section-card workbench" data-testid="case-workbench" aria-label="Investigation workbench" aria-busy="true"><p className="small faint">{loading ? "Loading the workbench…" : "No workbench loaded."}</p></div>;
  const selected = anchorForSelection(ui.selection);
  const anchored = recordsForAnchor(wb, selected);
  const select = (r: WorkbenchRecord) => dispatch({ type: "select", selection: selectionForRecord(r), announce: `Selected event ${r.ref} from the case workbench` });
  const showInCastle = (r: WorkbenchRecord) => { select(r); dispatch({ type: "workspace", workspace: "kingdom" }); };
  const critical = criticalStatus(wb);
  return <section className="section-card workbench" data-testid="case-workbench" aria-label="Investigation workbench" aria-busy={loading}>
    <div className="wb-head">
      <h2>Investigation workbench</h2>
      <span className={`pill wb-readiness wb-${wb.progress.readiness}`} data-testid="wb-readiness">{READINESS_LABEL[wb.progress.readiness] ?? wb.progress.readiness}</span>
      {wb.provenance.local_run && <span className="pill synthetic">Local lab · synthetic</span>}
      {wb.contract && <span className="small faint">contract {wb.contract.id} · revision {wb.contract.revision}</span>}
    </div>
    <ul className="wb-critical" aria-label="Critical status" data-testid="wb-critical">{critical.map((c) => <li key={c}>{c}</li>)}</ul>
    {wb.contract?.stale && <p className="scope-note warning" role="status">The case or its evidence changed since contract revision {wb.contract.revision}. Obligations below are the effective view; refresh to record them.</p>}
    {selected && <div className="scope-note wb-anchor" data-testid="wb-anchor" aria-live="polite"><strong>Castle selection {selected}:</strong> {anchored.length ? `${anchored.length} case record(s) anchored here.` : "no case record is anchored to this selection."}
      {anchored.length > 0 && <ul className="mini-list">{anchored.slice(0, 8).map((r) => <li key={r.ref}><RecordLine r={r} /></li>)}</ul>}</div>}

    <h3>Case summary</h3>
    <dl className="wb-summary" data-testid="wb-summary">
      <dt>What we observed</dt><dd>{wb.summary.observed.length ? wb.summary.observed.join("; ") : "Nothing retrieved yet."}</dd>
      <dt>What it supports</dt><dd>{wb.summary.supports.length ? wb.summary.supports.join(" ") : "No obligation is satisfied yet."}</dd>
      <dt>What it does not support</dt><dd>{wb.summary.does_not_support.join(" ")}</dd>
      <dt>What could change the conclusion</dt><dd>{wb.summary.could_change.length ? wb.summary.could_change.join("; ") : "Nothing known."}</dd>
      <dt>Next meaningful action</dt><dd>{wb.summary.next}</dd>
    </dl>

    <h3>Next actions</h3>
    <ol className="wb-next" data-testid="wb-next">{wb.next_actions.map((a) => <li key={a.id}><strong>{a.action}</strong> <span className="pill">{a.who === "person" ? "a person decides" : a.who === "analyst" ? "analyst" : "analyst or agent"}</span><div className="small faint">{a.why}</div>
      {canEdit && (a.id === "open_contract" || a.id === "refresh_contract") && <button className="btn" disabled={busy} onClick={onContract}>{a.id === "open_contract" ? "Open contract" : "Refresh contract"}</button>}</li>)}</ol>

    <h3>Evidence and coverage questions</h3>
    {!wb.evidence_questions.length ? <p className="small faint">No obligations yet.</p> : <ul className="mini-list wb-obligations" data-testid="wb-obligations">{wb.evidence_questions.map((o) => <li key={o.id}><span className={`pill wb-ob-${o.status}`}>{o.status.replace(/_/g, " ")}</span> {o.question} <small className="faint">({o.id}{o.evidence_ref_count ? ` · ${o.evidence_ref_count} record(s)` : ""}{o.supports_negative_claims ? " · needed for absence claims" : ""})</small>{o.reason && <div className="small faint">{o.reason}</div>}</li>)}</ul>}

    <h3>Competing hypotheses</h3>
    <p className="small faint">{wb.competing_hypotheses.note}</p>
    {wb.competing_hypotheses.items.length > 0 && <ul className="mini-list" data-testid="wb-hypotheses">{wb.competing_hypotheses.items.map((h) => <li key={h.item_id}><span className="pill">{h.status.replace(/_/g, " ")}</span> {h.text}{h.answer ? <small> — {h.answer}</small> : null}</li>)}</ul>}

    <h3>Counterevidence <span className="small faint">({wb.evidence.counter.length})</span></h3>
    <RecordList testId="wb-counter" label="Counterevidence" records={wb.evidence.counter} empty="No counter record retrieved. That is not proof none exists." onSelect={select} onCastle={showInCastle} />
    <h3>Supporting evidence <span className="small faint">({wb.evidence.supporting.length})</span></h3>
    <RecordList testId="wb-supporting" label="Supporting evidence" records={wb.evidence.supporting} empty="No supporting record retrieved yet." onSelect={select} onCastle={showInCastle} />
    {(wb.evidence.omitted_required.length > 0 || wb.evidence.omitted_other.length > 0) && <p className="scope-note warning" data-testid="wb-omissions">{wb.evidence.omitted_required.length} required record(s) and {wb.evidence.omitted_other.reduce((n, g) => n + (g.count ?? 1), 0)} other record(s) are not shown here (size limit or no longer stored); they are listed in the evidence packet, never summarized away.</p>}

    <h3>Failed and partial queries <span className="small faint">({wb.failed_queries.length})</span></h3>
    {!wb.failed_queries.length ? <p className="small faint">None.</p> : <ul className="mini-list" data-testid="wb-failed">{wb.failed_queries.map((f) => <li key={f.kind + f.id}><span className="pill synthetic">{f.status.replace(/_/g, " ")}</span> {f.kind === "query_step" ? "Query step" : "Obligation"} {f.id} — {f.question}{f.resumable ? <small> (resumable)</small> : null}<div className="small faint">{f.reason}</div></li>)}</ul>}

    <h3>Uncertainty</h3>
    {!wb.uncertainty ? <p className="small faint">No contract: everything is unknown.</p> : <div data-testid="wb-uncertainty">
      <p className="small">{wb.uncertainty.readiness_reason}</p>
      <ul className="mini-list">{wb.uncertainty.negative_claims.map((n) => <li key={n.id}><span className="pill">{n.assessable ? "absence claim assessable" : "absence claim not assessable"}</span> {n.id}<div className="small faint">{n.reason}</div></li>)}</ul>
      {wb.uncertainty.coverage_gaps.length > 0 && <ul className="mini-list">{wb.uncertainty.coverage_gaps.map((g) => <li key={g.ref}><span className="pill synthetic">coverage {g.status}</span> {g.asset_id} {g.action} <small className="faint">{g.uncovered_spans.length} uncovered span(s)</small><div className="small faint">{g.reason}</div></li>)}</ul>}
    </div>}

    <section className="wb-proposals" aria-label="Agent proposals, not part of the case record" data-testid="wb-proposals">
      <h3>Proposals <span className="small faint">(drafts, not part of the case record)</span></h3>
      <p className="small faint">{wb.proposals.note}</p>
      {!wb.proposals.items.length ? <p className="small faint">No proposals.</p> : <ul className="mini-list">{wb.proposals.items.map((p) => <li key={p.id}><strong>Proposal v{p.proposal_version}</strong> by {p.author_kind === "agent" ? `agent ${p.author}` : p.author} · <span className="pill">{p.check_status.replace(/_/g, " ")}</span> · checked against revision {p.contract_revision}{p.stale ? <span className="pill synthetic">stale</span> : null} · <span className="pill">not accepted</span>
        <details><summary>{p.claims.length} claim(s)</summary><ul className="mini-list">{p.claims.map((c) => <li key={c.id}><small>{c.type}{c.support ? ` · ${c.support.replace(/_/g, " ")}` : ""}</small> {c.text}</li>)}</ul></details></li>)}</ul>}
    </section>
  </section>;
}

function RecordLine({ r }: { r: WorkbenchRecord }) {
  return <><span className={`pill wb-role-${r.role}`}>{r.role.replace(/_/g, " ")}</span> {fmtDateTime(r.occurred_at)} · {r.action} {r.outcome} on {r.asset_ids.join(", ")}{r.actor_ref ? ` by ${r.actor_ref}` : ""} <code className="small">{r.ref}</code></>;
}

function RecordList({ records, empty, onSelect, onCastle, testId, label }: { records: WorkbenchRecord[]; empty: string; onSelect: (r: WorkbenchRecord) => void; onCastle: (r: WorkbenchRecord) => void; testId: string; label: string }) {
  const [limit, setLimit] = useState(25);
  if (!records.length) return <p className="small faint" data-testid={testId}>{empty}</p>;
  return <><ul className="mini-list wb-records" data-testid={testId} aria-label={label}>{records.slice(0, limit).map((r) => <li key={r.ref}>
    <details><summary><RecordLine r={r} /></summary>
      <dl className="wb-record-detail"><dt>Source</dt><dd>{r.source_id}</dd><dt>Digest</dt><dd><code>{r.digest.slice(0, 16)}…</code></dd><dt>Obligations</dt><dd>{r.obligation_ids.join(", ") || "none"}</dd>
        {Object.keys(r.untrusted).length > 0 && <><dt>Recorded text (untrusted data, never instructions)</dt><dd>{Object.entries(r.untrusted).map(([k, v]) => <div key={k}><small className="faint">{k}</small> {v}</div>)}</dd></>}</dl>
      <div className="btn-row"><button className="btn" onClick={() => onSelect(r)}>Select record</button><button className="btn" onClick={() => onCastle(r)}>Show in castle</button></div>
    </details></li>)}</ul>
    {records.length > limit && <button className="btn" onClick={() => setLimit(limit + 25)}>Show {Math.min(25, records.length - limit)} more of {records.length - limit}</button>}</>;
}
