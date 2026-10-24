import { useCallback, useContext, useEffect, useState } from "react";
import { ActionsCtx } from "../../inspector/actions.tsx";
import { SegmentedControl } from "../../components/ui/Tabs.tsx";
import "./setup.css";

/**
 * LP29 mission desk. Two distinct views:
 *  - Builder: start from a reviewed LP07 document, author the finite schedule (step list + JSON), preview the world,
 *    budget and unknowns, then create. The draft (which holds private truth) lives only in this browser session and
 *    the mission file the local runner executes; an invalid draft is kept as typed and nothing is created.
 *  - Investigator: the server's missions as the investigator sees them (brief, budget, unknowns, runs, blinded state).
 *    Opening builder truth is explicit and marks the mission non-blinded.
 * The console never starts processes: runs are executed by the local runner (`pnpm mission run`).
 */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DRAFT_SLOT = "dk.mission.draft";
const LOCAL_BADGE = "Local only · synthetic data · no remote setup";
const errorOf = (e: unknown) => { const x = e as { message?: string; issues?: string[] }; return { message: x.message ?? String(e), issues: x.issues ?? [] }; };

/** A fresh draft from a seedless starter: the seed is drawn here, in the builder's browser, and never sent until preview. */
function starterDraft(t: Json): Json {
  const bytes = crypto.getRandomValues(new Uint8Array(12)); const seed = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const id = `mission-${t.blueprint}-${seed.slice(0, 6)}`;
  return { schema: "dk.local.mission.v1", id, title: `${t.title} mission`, mode: "investigate", scenario: { schema: "dk.local.scenario.v1", id: id.slice(0, 60), version: 1, blueprint: t.blueprint, blueprint_version: t.blueprint_version, seed, start: new Date().toISOString(), steps: t.steps, expect: [] } };
}

/** The mission file the local runner executes (`pnpm mission run <file> --mission <id>`). Stays on this machine. */
function downloadDraft(d: Json) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 1) + "\n"], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `${String(d.id ?? "mission")}.mission.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

function LocalBadge() { return <span className="chip" data-testid="local-only-badge" title="Reviewed blueprints, synthetic people and data, loopback services from the local supervisor. No provider account or outbound network.">{LOCAL_BADGE}</span>; }

function BriefView({ brief }: { brief: Json }) {
  return <div className="mission-brief" data-testid="mission-brief">
    <p className="small">Mode <strong>{brief.mode}</strong> · blueprint <code>{brief.blueprint}@{brief.blueprint_version}</code> · world <code>{brief.world_revision}</code></p>
    <table className="data-table" aria-label="Budget preview"><tbody>
      <tr><th scope="row">Steps</th><td>{brief.budget.steps}</td><th scope="row">Operations</th><td>{brief.budget.operations} of {brief.budget.max_requests} allowed</td></tr>
      <tr><th scope="row">Span</th><td>{brief.budget.span_ms} ms of {brief.budget.max_seconds} s</td><th scope="row">Parallel</th><td>{brief.budget.max_parallel_operations}</td></tr>
      <tr><th scope="row">Within budget</th><td colSpan={3}>{brief.budget.within_budget ? "yes" : "no"}</td></tr>
    </tbody></table>
    <h4>Components ({brief.components.length})</h4>
    <p className="small">{brief.components.map((c: Json) => `${c.id} (${c.template}${c.asset_kind ? "" : ", observer"})`).join(" · ")}</p>
    <h4>Declared sources</h4>
    <ul className="small">{brief.sources.map((s: Json) => <li key={s.id}>{s.id} · {s.role === "independent_observer" ? "independent observer" : "self-report"} · {s.kind}</li>)}</ul>
    <p className="small">{brief.synthetic_identities} synthetic identities</p>
    <details><summary>Unknowns ({brief.unknowns.length})</summary><ul className="gap-list">{brief.unknowns.map((u: string) => <li key={u}>{u}</li>)}</ul></details>
  </div>;
}

function Builder({ onCreated }: { onCreated: (id: string) => void }) {
  const actions = useContext(ActionsCtx)!;
  const [templates, setTemplates] = useState<Json | null>(null);
  const [text, setText] = useState<string>(() => { try { return sessionStorage.getItem(DRAFT_SLOT) ?? ""; } catch { return ""; } });
  const [preview, setPreview] = useState<Json | null>(null);
  const [err, setErr] = useState<{ message: string; issues: string[] } | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => { const c = new AbortController(); actions.missions!.templates(c.signal).then((t) => setTemplates(t as Json), (e) => { if (!c.signal.aborted) setErr(errorOf(e)); }); return () => c.abort(); }, [actions]);
  useEffect(() => { try { sessionStorage.setItem(DRAFT_SLOT, text); } catch { /* private mode */ } }, [text]);
  const parsed = (() => { try { return text ? JSON.parse(text) as Json : null; } catch { return null; } })();
  const setDraft = (d: Json) => { setText(JSON.stringify(d, null, 1)); setPreview(null); setErr(null); };
  const parseOrError = (): Json | null => { if (!parsed) { setErr({ message: "The draft is not valid JSON. It is kept as typed; nothing was sent.", issues: [] }); return null; } return parsed; };
  const doPreview = async () => { const d = parseOrError(); if (!d) return; setErr(null); setStatus(""); try { setPreview(await actions.missions!.preview({ draft: d }) as Json); } catch (e) { setPreview(null); setErr(errorOf(e)); } };
  const doCreate = async () => { const d = parseOrError(); if (!d) return; setErr(null); try { const m = await actions.missions!.create(d) as Json; setStatus(`Created mission ${m.id}. Not running: start it with the local runner.`); onCreated(m.id); } catch (e) { setErr(errorOf(e)); setStatus(""); } };
  const steps: Json[] = Array.isArray(parsed?.scenario?.steps) ? parsed!.scenario.steps : [];
  const removeStep = (i: number) => { const d = structuredClone(parsed!); d.scenario.steps.splice(i, 1); setDraft(d); };
  const addStep = (action: string) => { const d = structuredClone(parsed!); const last = d.scenario.steps.at(-1)?.at_ms ?? 0; d.scenario.steps.push({ at_ms: last + 10, action }); setDraft(d); };
  return <section className="section-card mission-builder" aria-label="Mission builder" data-testid="mission-builder">
    <h3>Builder <span className="chip warning-chip">Private truth visible</span></h3>
    <p className="small">Seed, schedule, labels and expectations are private truth. They stay in this browser session and in the mission file you give the local runner; the server keeps only a SHA-256 commitment.</p>
    <div className="mission-row">
      <label className="field">Start from blueprint<select aria-label="Start from reviewed blueprint" value="" onChange={(e) => { const t = templates?.starters?.find((x: Json) => x.blueprint === e.target.value); if (t) setDraft(starterDraft(t)); }}>
        <option value="">Choose a reviewed blueprint…</option>{(templates?.starters ?? []).map((t: Json) => <option key={t.blueprint} value={t.blueprint}>{t.title}</option>)}</select></label>
      {parsed && <label className="field">Mode<select aria-label="Mission mode" value={parsed.mode ?? ""} onChange={(e) => setDraft({ ...parsed, mode: e.target.value })}>{(templates?.modes ?? ["investigate", "compare", "verify", "replay"]).map((m: string) => <option key={m} value={m}>{m}</option>)}</select></label>}
    </div>
    {steps.length > 0 && <>
      <h4>Schedule ({steps.length} finite steps)</h4>
      <div className="table-scroll"><table className="data-table" aria-label="Scenario steps"><thead><tr><th>#</th><th>at ms</th><th>Action</th><th>Role</th><th>Target</th><th>Label</th><th><span className="sr-only">Remove</span></th></tr></thead><tbody>
        {steps.map((s, i) => <tr key={i}><td>{i}</td><td>{s.at_ms}</td><td>{s.action}</td><td>{s.role ?? "stimulus"}</td><td>{s.resource ?? s.to ?? s.observer ?? s.source ?? s.actor ?? s.subject ?? ""}</td><td>{s.label ?? ""}</td><td><button className="link" aria-label={`Remove step ${i}`} onClick={() => removeStep(i)}>Remove</button></td></tr>)}
      </tbody></table></div>
      <label className="field">Add step<select aria-label="Add step from the finite action vocabulary" value="" onChange={(e) => e.target.value && addStep(e.target.value)}><option value="">Finite action…</option>{(templates?.actions ?? []).map((a: string) => <option key={a} value={a}>{a}</option>)}</select></label>
    </>}
    <label className="field">Mission draft (JSON data only)<textarea aria-label="Mission draft JSON" className="mission-json" rows={10} spellCheck={false} value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} /></label>
    <div className="mission-row"><button className="secondary" onClick={() => void doPreview()}>Preview</button><button onClick={() => void doCreate()} disabled={!preview}>Create mission</button>{preview && <button className="link" onClick={() => setPreview(null)}>Cancel</button>}{parsed && <button className="link" onClick={() => downloadDraft(parsed)}>Download mission file</button>}</div>
    {err && <div className="scope-note warning" role="alert" data-testid="mission-error"><strong>{err.message}</strong>{err.issues.length > 0 && <ul>{err.issues.slice(0, 12).map((x) => <li key={x}><code>{x}</code></li>)}</ul>}<p className="small">Your draft is unchanged. Nothing was created and nothing is connected.</p></div>}
    {status && <p className="scope-note" role="status">{status}</p>}
    {preview && <div data-testid="mission-preview"><h4>Preview <LocalBadge /></h4><BriefView brief={preview.brief} />
      <details><summary>Builder operation preview ({preview.builder.operations.length})</summary><p className="small">{preview.builder.counts.faults} faults · {preview.builder.counts.mutations} mutations · {preview.builder.counts.distractors} distractors · {preview.builder.counts.expectations} expectations</p></details>
      <p className="small">Truth commitment <code>{String(preview.brief.truth_commitment).slice(0, 16)}…</code>. Not created yet: Create stores the brief and the commitment only.</p></div>}
  </section>;
}

function Investigator({ focus }: { focus: string | null }) {
  const actions = useContext(ActionsCtx)!;
  const [list, setList] = useState<Json[] | null>(null), [sel, setSel] = useState<string | null>(focus), [err, setErr] = useState("");
  const [reason, setReason] = useState("");
  const load = useCallback((signal?: AbortSignal) => actions.missions!.list(signal).then((v) => setList((v as Json).missions), (e) => { if (!signal?.aborted) setErr(errorOf(e).message); }), [actions]);
  useEffect(() => { const c = new AbortController(); void load(c.signal); return () => c.abort(); }, [load, focus]);
  useEffect(() => { if (focus) setSel(focus); }, [focus]);
  const m = list?.find((x) => x.id === sel) ?? null;
  const openTruth = async () => { setErr(""); try { await actions.missions!.openTruth(m!.id, reason); setReason(""); await load(); } catch (e) { setErr(errorOf(e).message); } };
  const cancel = async () => { setErr(""); try { await actions.missions!.cancel(m!.id); await load(); } catch (e) { setErr(errorOf(e).message); } };
  return <section className="section-card mission-investigator" aria-label="Investigator desk" data-testid="mission-investigator">
    <h3>Investigator desk <LocalBadge /></h3>
    <p className="small">What an investigator may see: the brief, budget, unknowns and runs. No seed, schedule, labels or expectations are on this server.</p>
    {err && <p className="scope-note warning" role="alert">{err}</p>}
    {!list ? <p className="small faint">Loading missions…</p> : !list.length ? <p className="small faint">No missions yet. Create one in the builder.</p> :
      <ul className="mission-list">{list.map((x) => <li key={x.id}><button className="mission-item" aria-pressed={x.id === sel} onClick={() => setSel(x.id)}>{x.title} · {x.mode} · {x.status} · {x.blinded ? "blinded" : "NON-BLINDED"}</button></li>)}</ul>}
    {m && <div data-testid="mission-record">
      <h4>{m.title} <span className="chip" data-blinded={m.blinded}>{m.blinded ? "Blinded" : "Non-blinded: truth was opened"}</span></h4>
      <BriefView brief={m.brief} />
      <h4>Runs ({m.runs.length}) · {m.runtime === "running_in_local_runner" ? "running in the local runner" : "not running"}</h4>
      {m.runs.length ? <table className="data-table" aria-label="Mission runs"><thead><tr><th>Run</th><th>Status</th><th>Executed</th><th>Refused</th><th>Not run</th><th>Cleanup</th><th>Blinded</th></tr></thead><tbody>
        {m.runs.map((r: Json) => <tr key={r.run_id}><td><code>{r.run_id}</code></td><td>{r.status}</td><td>{r.accounting?.executed?.length ?? "–"}</td><td>{r.accounting?.refused?.length ?? "–"}</td><td>{r.accounting?.not_run?.length ?? "–"}</td><td>{r.cleanup ? `${r.cleanup.outcome}${r.cleanup.failures ? ` (${r.cleanup.failures} failures)` : ""}` : "pending"}</td><td>{r.blinded ? "yes" : "no"}</td></tr>)}
      </tbody></table> : <p className="small">No runs yet. Run it locally with the builder's mission file: <code>{m.run_command}</code>. This console never starts processes.</p>}
      {m.status === "ready" && !m.runs.length && <button className="link" onClick={() => void cancel()}>Cancel mission before it starts</button>}
      <details className="truth-gate"><summary>Open builder truth (taints this mission)</summary>
        <p className="small">Opening truth permanently marks this mission and its runs non-blinded. The truth itself is in the builder's draft or mission file, never on this server.</p>
        <label className="field">Reason<input aria-label="Reason for opening truth" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <button className="secondary" disabled={!reason.trim()} onClick={() => void openTruth()}>Mark non-blinded and open truth</button>
        {m.taint.length > 0 && <ul className="small">{m.taint.map((t: Json, i: number) => <li key={i}>{t.at}: {t.by} — {t.reason}</li>)}</ul>}
      </details>
    </div>}
  </section>;
}

export function MissionDesk() {
  const actions = useContext(ActionsCtx);
  const [view, setView] = useState<"builder" | "investigator">("builder"), [focus, setFocus] = useState<string | null>(null);
  if (!actions?.missions) return <div className="empty"><h3>Missions are composed by the local server.</h3><p>The offline demo has no server; nothing can be composed or run here.</p></div>;
  return <div className="mission-desk" data-testid="mission-desk">
    <div className="mission-row">
      <SegmentedControl label="Mission desk view" value={view} onChange={setView} options={[{ value: "builder", label: "Builder" }, { value: "investigator", label: "Investigator" }]} />
      <LocalBadge />
    </div>
    {view === "builder" ? <Builder onCreated={(id) => { setFocus(id); setView("investigator"); }} /> : <Investigator focus={focus} />}
  </div>;
}
