import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useApp } from "../../lib/state.tsx";
import { ActionsCtx, type CaseDetail, type CaseSummary } from "../../inspector/actions.tsx";
import { ApiError } from "../../lib/data.ts";
import { fmtDateTime } from "../../lib/vocab.ts";

/**
 * R03.1 durable cases. A case is the analyst's investigation: scope, questions, linked findings (each pinned
 * to an immutable bundle), independent events, notes and closure criteria. Its status never follows findings.
 */
export function CasesWorkspace() {
  const { vm } = useApp();
  const actions = useContext(ActionsCtx);
  const [list, setList] = useState<CaseSummary[] | null>(null), [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const canEdit = actions?.role === "analyst" || actions?.role === "admin";

  const reload = useCallback(async () => {
    if (!actions) return;
    const id = ++seq.current;
    try {
      const l = await actions.listCases();
      if (id !== seq.current) return;
      setList(l.cases);
      if (selected) setDetail(await actions.getCase(selected));
    } catch (e) { if (id === seq.current) setMessage((e as Error).message); }
  }, [actions, selected]);
  useEffect(() => { void reload(); }, [reload]);

  if (!actions || vm.data.mode !== "server") return <section className="workspace-page" aria-label="Cases"><div className="empty"><h3>Cases need a server connection.</h3><p>The offline demo is read-only and keeps no cases.</p></div></section>;

  const act = async (label: string, fn: () => Promise<CaseDetail | void>) => {
    setBusy(true); setMessage("");
    try { const r = await fn(); if (r) { setDetail(r); setSelected(r.id); } setMessage(`${label}: saved.`); const l = await actions.listCases(); setList(l.cases); }
    catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.current) { setMessage(`${label} not saved: the case changed (now version ${String(e.current.version)}). It has been reloaded; review and try again.`); if (selected) setDetail(await actions.getCase(selected)); }
      else setMessage(`${label} failed: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  return <section className="workspace-page cases-workspace" aria-label="Cases workspace">
    <div className="workspace-heading"><div><div className="eyebrow">DURABLE INVESTIGATIONS</div><h1>Keep the case.</h1><p className="workspace-lede">A case holds your question, the evidence you pinned and how it was closed. Detector findings closing never closes a case.</p></div></div>
    {message && <p className="scope-note" role="status">{message}</p>}
    <div className="cases-layout">
      <div className="section-card" aria-label="Case list">
        <h2>Cases</h2>
        {!list ? <p className="small faint">Loading…</p> : !list.length ? <p className="small faint">No cases yet.</p> : <ul className="mini-list">{list.map((c) => <li key={c.id}><button className={`link-btn${c.id === selected ? " active" : ""}`} onClick={() => { setSelected(c.id); void actions.getCase(c.id).then(setDetail, (e: Error) => setMessage(e.message)); }}>{c.title}</button> <small>{c.status} · v{c.version}{c.open_questions ? ` · ${c.open_questions} open question${c.open_questions > 1 ? "s" : ""}` : ""}</small></li>)}</ul>}
        {canEdit && <NewCase busy={busy} assets={vm.data.graph.assets.map((a) => ({ id: a.id, name: a.name }))} onCreate={(body) => act("Create case", () => actions.createCase(body))} />}
      </div>
      {detail && <CaseView c={detail} canEdit={canEdit} busy={busy} findings={vm.latestData.findings.map((f) => ({ id: f.id, title: f.title }))}
        act={(label, path, body) => act(label, () => actions.caseAction(detail.id, path, { ...body, expected_version: detail.version }))}
        onExport={() => act("Export", () => actions.exportDurableCase(detail.id))} />}
    </div>
  </section>;
}

function NewCase({ busy, assets, onCreate }: { busy: boolean; assets: { id: string; name: string }[]; onCreate: (b: Record<string, unknown>) => void }) {
  const [title, setTitle] = useState(""), [question, setQuestion] = useState(""), [criteria, setCriteria] = useState(""), [scope, setScope] = useState<string[]>([]);
  return <form className="case-new" onSubmit={(e) => { e.preventDefault(); onCreate({ title, scope: { question, asset_ids: scope }, closure_criteria: criteria }); setTitle(""); setQuestion(""); setCriteria(""); setScope([]); }}>
    <h3>New case</h3>
    <label className="field">Title<input aria-label="Case title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required /></label>
    <label className="field">Question<input aria-label="Case question" value={question} maxLength={1000} onChange={(e) => setQuestion(e.target.value)} required /></label>
    <label className="field">Closure criteria<input aria-label="Closure criteria" value={criteria} maxLength={2000} onChange={(e) => setCriteria(e.target.value)} required /></label>
    <label className="field">Assets in scope<select aria-label="Assets in scope" multiple value={scope} onChange={(e) => setScope([...e.target.selectedOptions].map((o) => o.value))}>{assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <button className="btn" disabled={busy}>Create case</button>
  </form>;
}

function CaseView({ c, canEdit, busy, findings, act, onExport }: { c: CaseDetail; canEdit: boolean; busy: boolean; findings: { id: string; title: string }[]; act: (label: string, path: string, body: Record<string, unknown>) => void; onExport: () => void }) {
  const [text, setText] = useState(""), [kind, setKind] = useState("note"), [ref, setRef] = useState(""), [statement, setStatement] = useState("");
  const live = c.items.filter((i) => !i.removed);
  const questions = live.filter((i) => i.kind === "question" || i.kind === "hypothesis");
  const closed = c.status === "closed";
  return <div className="section-card" aria-label={`Case ${c.title}`} data-testid="case-detail">
    <h2>{c.title}</h2>
    <p className="small">Status <strong>{c.status}</strong> · owner {c.owner} · version {c.version}</p>
    <p><strong>Question:</strong> {c.scope.question}</p>
    <p className="small">Scope: {c.scope.asset_ids.length ? c.scope.asset_ids.join(", ") : "no assets"}{c.scope.after ? ` · ${fmtDateTime(c.scope.after)} to ${c.scope.before ? fmtDateTime(c.scope.before) : "now"}` : ""}</p>
    <p className="small"><strong>Closure criteria:</strong> {c.closure_criteria}</p>
    {c.closure && <p className="scope-note">Closed by {c.closure.by} at {fmtDateTime(c.closure.at)}: {c.closure.statement}</p>}
    <h3>Questions</h3>
    {!questions.length ? <p className="small faint">No questions recorded.</p> : <ul className="mini-list">{questions.map((q) => <li key={q.item_id}><span>{q.text}</span> <small>({q.status}{q.answer ? `: ${q.answer}` : ""})</small>
      {canEdit && !closed && q.status === "open" && <QuestionAnswer onAnswer={(status, answer) => act("Answer", `/items/${q.item_id}/question`, { status, answer })} busy={busy} hypothesis={q.kind === "hypothesis"} />}</li>)}</ul>}
    <h3>Linked findings</h3>
    {!c.linked_findings.length ? <p className="small faint">None.</p> : <ul className="mini-list">{c.linked_findings.map((f) => <li key={f.finding_id}>{findings.find((x) => x.id === f.finding_id)?.title ?? f.finding_id} <small>linked at revision {f.linked_revision} (now {f.current_revision ?? "missing"}, detector state {f.current_lifecycle}) · bundle {f.bundle_id}</small></li>)}</ul>}
    <h3>Timeline</h3>
    <ul className="mini-list">{live.filter((i) => i.kind === "event" || i.kind === "note").map((i) => <li key={i.item_id}><small>{fmtDateTime(i.added_at)} · {i.kind}</small> {i.kind === "event" ? <>event {i.ref}{i.produced_finding === false ? " (no finding)" : ""}{i.why ? `: ${i.why}` : ""}</> : i.text}</li>)}</ul>
    {canEdit && !closed && <form onSubmit={(e) => { e.preventDefault(); act("Add", "/items", kind === "finding" || kind === "event" ? { kind, ref, ...(kind === "event" && text ? { why: text } : {}) } : { kind, text }); setText(""); setRef(""); }}>
      <div className="filter-bar"><label className="field">Add<select aria-label="Case item kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="note">Note</option><option value="question">Question</option><option value="hypothesis">Hypothesis</option><option value="finding">Finding</option><option value="event">Event</option></select></label>
        {kind === "finding" ? <label className="field">Finding<select aria-label="Finding to link" value={ref} onChange={(e) => setRef(e.target.value)} required><option value="">Choose…</option>{findings.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select></label>
          : kind === "event" ? <label className="field">Event id<input aria-label="Event id" value={ref} maxLength={200} onChange={(e) => setRef(e.target.value)} required /></label> : null}
        {kind !== "finding" && <label className="field">{kind === "event" ? "Why it matters" : "Text"}<input aria-label="Case item text" value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} required={kind !== "event"} /></label>}
        <button className="btn" disabled={busy}>Add to case</button></div>
    </form>}
    {canEdit && <div className="btn-row">
      {!closed && <><input aria-label="Closure statement" placeholder="How the closure criteria were met" value={statement} maxLength={4000} onChange={(e) => setStatement(e.target.value)} />
        <button className="btn" disabled={busy || !statement.trim()} onClick={() => act("Close case", "/status", { status: "closed", statement })}>Close case</button></>}
      {closed && <button className="btn" disabled={busy} onClick={() => act("Reopen case", "/status", { status: "open" })}>Reopen case</button>}
      <button className="btn" disabled={busy} onClick={onExport}>Export case</button>
    </div>}
    <details><summary>History ({c.history.length})</summary><ul className="mini-list">{c.history.map((h) => <li key={h.version}><small>v{h.version} · {fmtDateTime(h.at)} · {h.actor}</small> {h.reason}</li>)}</ul></details>
  </div>;
}

function QuestionAnswer({ onAnswer, busy, hypothesis }: { onAnswer: (status: string, answer: string) => void; busy: boolean; hypothesis: boolean }) {
  const [answer, setAnswer] = useState(""), [status, setStatus] = useState(hypothesis ? "supported" : "answered");
  return <span className="inline-form"><select aria-label="Answer status" value={status} onChange={(e) => setStatus(e.target.value)}>{(hypothesis ? ["supported", "refuted", "accepted_unresolved"] : ["answered", "accepted_unresolved"]).map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select><input aria-label="Answer" value={answer} maxLength={2000} onChange={(e) => setAnswer(e.target.value)} /><button className="btn" disabled={busy || !answer.trim()} onClick={() => onAnswer(status, answer)}>Record</button></span>;
}
