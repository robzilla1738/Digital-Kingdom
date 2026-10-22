import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { MODULE_CATALOG, type Finding, type OutcomeState, type SecurityEvent } from "@dk/contracts";
import { useApp } from "../lib/state.tsx";
import { ACTION_LABEL, COVERAGE_STYLE, EVENT_OUTCOME_COLOR, EVIDENCE_LEVEL_LABEL, KIND_LABEL, OUTCOME_STYLE, RELATIONSHIP_LAYER, LAYER_STYLE, SEVERITY_LABEL, fmtDateTime, fmtTime } from "../lib/vocab.ts";
import { GapIcon, Icon, StateIcon } from "../lib/icons.tsx";

export interface ServerActions {
  role: "viewer" | "analyst" | "admin" | "none";
  setDisposition(id: string, body: { lifecycle?: string; disposition?: string; note?: string }): Promise<void>;
  exportCase(id: string): Promise<void>;
  containment(): Promise<{ catalog: { id: string; title: string; applies_to_kinds: string[]; blast_radius: string; reversible: boolean }[]; requests: Record<string, string>[] }>;
  requestContainment(findingId: string, actionId: string, rationale: string): Promise<void>;
  /** Complete, paginated evidence for one finding (by its own references, not a recency window). */
  findingEvidence(id: string): Promise<{ events: SecurityEvent[]; evidence: Record<string, Record<string, unknown>>; expected: number; missingEvents: string[]; missingEvidence: string[]; complete: boolean; error?: string }>;
}
export const ActionsCtx = createContext<ServerActions | null>(null);

const KIND_TITLE = { asset: "Asset", finding: "Finding", path: "Relationship", event: "Event" } as const;

export function EvidencePane() {
  const { ui, dispatch } = useApp();
  if (!ui.selection) {
    return (
      <aside className="evidence empty-pane" aria-label="Inspector">
        <div className="pane-head">
          <span className="pane-kind">Overview</span>
          <button className="icon-btn sm" onClick={() => dispatch({ type: "panel", panel: "inspector", open: false })} aria-label="Hide inspector"><Icon name="x" size={15} /></button>
        </div>
        <div className="pane-body"><Intro /></div>
      </aside>
    );
  }
  return (
    <aside className="evidence" aria-label="Evidence" aria-live="polite" data-selection-kind={ui.selection.kind} data-selection-id={ui.selection.id}>
      <div className="pane-head">
        <span className="pane-kind">{KIND_TITLE[ui.selection.kind]}<code>{ui.selection.id}</code></span>
        <button className="icon-btn sm close" onClick={() => dispatch({ type: "select", selection: null })} aria-label="Close evidence pane" title="Close  (Esc)"><Icon name="x" size={15} /></button>
      </div>
      <div className="pane-body">
        {ui.selection.kind === "asset" && <AssetView id={ui.selection.id} />}
        {ui.selection.kind === "finding" && <FindingView id={ui.selection.id} />}
        {ui.selection.kind === "path" && <PathView id={ui.selection.id} />}
        {ui.selection.kind === "event" && <EventView id={ui.selection.id} />}
      </div>
    </aside>
  );
}

function Intro() {
  const { vm } = useApp();
  const open = vm.findings.filter((f) => f.lifecycle !== "closed");
  const byState = (Object.keys(OUTCOME_STYLE) as OutcomeState[]).map((k) => ({ k, v: OUTCOME_STYLE[k], n: open.filter((f) => f.outcome_state === k).length })).filter((x) => x.n);
  const max = Math.max(1, ...byState.map((x) => x.n));
  const gaps = vm.coverage.filter((c) => c.state !== "healthy").length + vm.unobserved.length;
  return (
    <>
      <div className="ev-title">
        <h2>{vm.data.project.name}</h2>
        {vm.data.project.description && <p className="subtitle">{vm.data.project.description}</p>}
      </div>
      <div className="stat-grid">
        <div><b>{vm.data.graph.assets.length}</b><span>Assets</span></div>
        <div><b>{open.length}</b><span>Open findings</span></div>
        <div><b>{vm.events.length}</b><span>Events</span></div>
        <div className={gaps ? "warn" : ""}><b>{gaps}</b><span>Coverage gaps</span></div>
      </div>
      {byState.length > 0 && (
        <Section title="Open findings by outcome">
          <ul className="dist">
            {byState.map(({ k, v, n }) => (
              <li key={k}>
                <StateIcon state={k} />
                <span><span>{v.label}</span> <span className="desc">{v.describe}</span><span className="bar"><i style={{ width: `${(n / max) * 100}%`, background: v.color }} /></span></span>
                <b>{n}</b>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <div className="callout info"><Icon name="info" size={16} /><span>Select a room, a graph node, a finding or a timeline tick to inspect its evidence. Nothing here is a verdict of compromise unless the evidence says so.</span></div>
      <Section title="Shortcuts">
        <ul className="hint-list">
          <li>Switch to 3D / 2D <span><span className="kbd">3</span> <span className="kbd">2</span></span></li>
          <li>Play or pause replay <span className="kbd">Space</span></li>
          <li>Search <span className="kbd">/</span></li>
          <li>Toggle list / inspector <span><span className="kbd">[</span> <span className="kbd">]</span></span></li>
          <li>Clear selection <span className="kbd">Esc</span></li>
        </ul>
      </Section>
    </>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return <section className="ev-section"><h4>{title}{count !== undefined && <span className="count">{count}</span>}</h4>{children}</section>;
}
function KV({ k, v }: { k: string; v: ReactNode }) {
  return <div className="kv"><span>{k}</span><span>{v}</span></div>;
}

function AssetView({ id }: { id: string }) {
  const { dispatch, vm } = useApp();
  const a = vm.data.graph.assets.find((x) => x.id === id);
  if (!a) return <p className="muted">Asset {id} is not in this graph revision.</p>;
  const room = vm.data.scene.rooms.find((r) => r.asset_id === id);
  const st = vm.assetStatus.get(id);
  const findings = vm.findings.filter((f) => f.affected_asset_ids.includes(id));
  const cov = vm.coverage.filter((c) => c.asset_ids.includes(id));
  const rels = vm.data.graph.relationships.filter((r) => r.source_id === id || r.target_id === id);
  const events = vm.events.filter((e) => e.asset_ids.includes(id)).slice(-12).reverse();
  const name = (x: string) => vm.data.graph.assets.find((y) => y.id === x)?.name ?? x;
  return (
    <>
      <div className="ev-title">
        <h2>{a.name}</h2>
        <p className="subtitle">{KIND_LABEL[a.kind]}{room ? ` · shown as ${MODULE_CATALOG[room.module_id].label.toLowerCase()}` : ""}{a.secondary_label ? ` · ${a.secondary_label}` : ""}</p>
        {(st?.worst || st?.coverage !== "reporting") && (
          <div className="chips">
            {st?.worst && <span className="chip"><StateIcon state={st.worst} />{OUTCOME_STYLE[st.worst].label}</span>}
            {st && st.coverage !== "reporting" && <span className="chip chip-gap"><GapIcon size={11} />{st.coverage === "gap" ? "Coverage gap" : "No telemetry"}</span>}
          </div>
        )}
      </div>
      <div className="kvs">
        <KV k="Stable ID" v={<code>{a.id}</code>} />
        <KV k="Environment" v={a.environment} />
        {a.owner && <KV k="Owner" v={a.owner} />}
        {a.sensitivity && <KV k="Sensitivity" v={a.sensitivity} />}
        {a.deployment && <KV k="Deployment" v={<code>{a.deployment}</code>} />}
        {a.instance_count !== undefined && <KV k="Instances" v={`${a.instance_count} grouped under this one logical service`} />}
        <KV k="Provenance" v={a.source_refs.join(", ")} />
        {room && <KV k="Room" v={<code>{room.node_id}</code>} />}
      </div>
      <Section title="Coverage">
        {cov.length ? (
          <ul className="mini-list">
            {cov.map((c) => (
              <li key={c.source_id} className="link-row" style={{ cursor: "default" }}>
                <span className="dot" style={{ background: COVERAGE_STYLE[c.state].color }} aria-hidden />
                <span className="grow">{c.label}{c.note ? <span className="faint"> — {c.note}</span> : null}</span>
                <span className="faint">{COVERAGE_STYLE[c.state].label}</span>
              </li>
            ))}
          </ul>
        ) : <div className="callout warn"><Icon name="alert" size={16} /><span>No telemetry source covers this asset. Absence of findings means <b>unknown</b>, not safe.</span></div>}
        {st?.coverage === "gap" && <div className="callout warn"><Icon name="alert" size={16} /><span>Every source for this asset is offline or stale. Recent activity is not assessable.</span></div>}
      </Section>
      <Section title="Findings" count={findings.length}>
        {findings.length ? <ul className="mini-list">{findings.map((f) => <FindingChip key={f.id} f={f} />)}</ul> : <p className="faint small">No findings recorded for this asset{vm.isLatest ? "" : " at this point in the replay"}.</p>}
      </Section>
      <Section title="Relationships" count={rels.length}>
        <ul className="mini-list">
          {rels.map((r) => {
            const out = r.source_id === id;
            return (
              <li key={r.id}><button className="link-row" onClick={() => dispatch({ type: "select", selection: { kind: "path", id: r.id } })}>
                <span className="line-swatch" style={{ background: LAYER_STYLE[RELATIONSHIP_LAYER[r.kind] ?? "runtime"].color, width: 12 }} aria-hidden />
                <span className="grow"><span className="faint">{out ? "→" : "←"} {r.kind.replace(/_/g, " ")}</span> {out ? name(r.target_id) : name(r.source_id)}</span>
                <span className="faint">{r.evidence_level}</span>
              </button></li>
            );
          })}
        </ul>
      </Section>
      <Section title="Recent events" count={events.length}>
        <EventTable events={events} />
      </Section>
    </>
  );
}

function FindingChip({ f }: { f: Finding }) {
  const { dispatch } = useApp();
  const s = OUTCOME_STYLE[f.outcome_state];
  return (
    <li><button className="link-row" onClick={() => dispatch({ type: "select", selection: { kind: "finding", id: f.id } })}>
      <StateIcon state={f.outcome_state} /><span className="grow">{f.title}</span><span className="faint">{s.label}</span>
    </button></li>
  );
}

function EventTable({ events, role = "related" }: { events: SecurityEvent[]; role?: "supporting" | "counter" | "related" }) {
  const { dispatch, vm } = useApp();
  if (!events.length) return <p className="faint small">No events.</p>;
  return (
    <div className="table-wrap">
      <table className="ev-table">
        <thead><tr><th scope="col">Time (UTC)</th><th scope="col">Action</th><th scope="col">Outcome</th><th scope="col">Source</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} data-event-id={e.id} data-evidence-role={role} onClick={() => dispatch({ type: "select", selection: { kind: "event", id: e.id } })} tabIndex={0} onKeyDown={(k) => k.key === "Enter" && dispatch({ type: "select", selection: { kind: "event", id: e.id } })}>
              <td className="t">{fmtTime(e.occurred_at).replace(" UTC", "")}{vm.lateEventIds.has(e.id) && <span className="late-flag" title="Arrived late">late</span>}</td>
              <td className="act">{ACTION_LABEL[e.action] ?? e.action}</td>
              <td><span className="out"><span className="out-dot" style={{ background: EVENT_OUTCOME_COLOR[e.outcome] }} aria-hidden />{e.outcome}</span></td>
              <td className="src" title={e.source_id}>{e.source_id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FindingView({ id }: { id: string }) {
  const { dispatch, vm } = useApp();
  const actions = useContext(ActionsCtx);
  const f = vm.findings.find((x) => x.id === id) ?? vm.data.findings.find((x) => x.id === id);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [containment, setContainment] = useState<Awaited<ReturnType<ServerActions["containment"]>> | null>(null);
  const [full, setFull] = useState<Awaited<ReturnType<ServerActions["findingEvidence"]>> | null>(null);
  const localIds = new Set(vm.data.events.map((e) => e.id));
  const needsFetch = !!f && !!actions && [...f.event_ids, ...f.counterevidence_event_ids].some((x) => !localIds.has(x));
  useEffect(() => {
    setFull(null);
    if (needsFetch && actions && f) actions.findingEvidence(f.id).then(setFull, (e) => setFull({ events: [], evidence: {}, expected: 0, missingEvents: [], missingEvidence: [], complete: false, error: (e as Error).message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f?.id, f?.revision, needsFetch]);
  if (!f) return <p className="muted">This finding does not exist yet at this point in the replay.</p>;
  const s = OUTCOME_STYLE[f.outcome_state];
  const pool = full ? [...vm.data.events, ...full.events.filter((e) => !localIds.has(e.id))] : vm.data.events;
  const evs = pool.filter((e) => f.event_ids.includes(e.id));
  const counter = pool.filter((e) => f.counterevidence_event_ids.includes(e.id));
  const expectedCount = new Set([...f.event_ids, ...f.counterevidence_event_ids]).size;
  const shownCount = evs.length + counter.length;
  const name = (x: string) => vm.data.graph.assets.find((y) => y.id === x)?.name ?? x;
  const canAnalyst = actions && (actions.role === "analyst" || actions.role === "admin");
  const kinds = new Set(f.affected_asset_ids.map((a) => vm.data.graph.assets.find((x) => x.id === a)?.kind));
  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); setMsg(null); try { await fn(); setMsg(`${label}: done`); } catch (e) { setMsg(`${label} failed: ${(e as Error).message}`); } finally { setBusy(null); } };
  return (
    <>
      <div className="ev-title">
        <h2>{f.title}</h2>
        <div className="chips">
          <span className="chip" style={{ color: s.color, borderColor: `${s.color}55` }}><StateIcon state={f.outcome_state} />{s.label}</span>
          <span className={`chip sev sev-${f.severity}`}>{SEVERITY_LABEL[f.severity]}</span>
          <span className="chip">{EVIDENCE_LEVEL_LABEL[f.evidence_level]}</span>
          {f.revision > 1 && <span className="chip">Revision {f.revision}</span>}
          {f.dataset_kind === "synthetic" && <span className="chip chip-demo">Synthetic</span>}
        </div>
      </div>
      <p className="claim" style={{ ["--claim" as string]: s.color }}>{f.claim}</p>
      <div className="kvs">
        <KV k="Window" v={<span className="num">{fmtDateTime(f.first_seen)} → {fmtTime(f.last_seen)}</span>} />
        <KV k="Last evidence" v={<span className="num">{fmtDateTime(f.last_received)}</span>} />
        <KV k="Affected" v={<span className="inline-links">{f.affected_asset_ids.map((a) => <button key={a} className="link" data-asset-id={a} onClick={() => dispatch({ type: "select", selection: { kind: "asset", id: a } })}>{name(a)}</button>)}</span>} />
        <KV k="Status" v={<span style={{ textTransform: "capitalize" }}>{f.lifecycle} · {f.disposition.replace(/_/g, " ")}</span>} />
        <KV k="Rule" v={<code>{f.rule_id} · {f.rule_version}</code>} />
      </div>
      {f.not_claimed.length > 0 && (
        <div className="callout info"><Icon name="info" size={16} /><div><span className="callout-title">What this does not claim</span><ul className="bullets">{f.not_claimed.map((x, i) => <li key={i}>{x}</li>)}</ul></div></div>
      )}
      {f.coverage_gaps.length > 0 && (
        <div className="callout warn"><GapIcon size={16} /><div><span className="callout-title">Evidence gaps</span><ul className="bullets warn">{f.coverage_gaps.map((x, i) => <li key={i}>{x}</li>)}</ul></div></div>
      )}
      {shownCount < expectedCount && (
        <div className="callout warn" role="status" data-testid="evidence-incomplete" data-error={full?.error ? "true" : "false"}>
          <Icon name="alert" size={16} />
          <span><span className="callout-title">Incomplete evidence</span>{needsFetch && !full ? "Loading the older supporting events…" : full?.error ? `Could not load all supporting events: ${full.error}` : `Showing ${shownCount} of ${expectedCount} referenced events.`} This view is incomplete; do not treat it as the full record.</span>
        </div>
      )}
      {full && full.missingEvidence.length > 0 && <div className="callout warn"><Icon name="alert" size={16} /><span>{full.missingEvidence.length} evidence record(s) referenced by these events could not be retrieved.</span></div>}
      <Section title="Supporting events" count={evs.length}><EventTable events={evs} role="supporting" /></Section>
      {counter.length > 0 && <Section title="Counterevidence" count={counter.length}><EventTable events={counter} role="counter" /></Section>}
      <Section title="Next review steps"><ol className="bullets">{f.next_steps.map((x, i) => <li key={i}>{x}</li>)}</ol></Section>
      {actions && actions.role !== "none" && (
        <Section title="Analyst actions">
          {canAnalyst ? (
            <>
              <div className="btn-row">
                <button className="btn sm" disabled={!!busy} onClick={() => run("Acknowledge", () => actions.setDisposition(f.id, { lifecycle: "acknowledged" }))}>Acknowledge</button>
                <button className="btn sm" disabled={!!busy} onClick={() => run("Mark expected test", () => actions.setDisposition(f.id, { disposition: "expected_test" }))}>Expected test</button>
                <button className="btn sm" disabled={!!busy} onClick={() => run("Close", () => actions.setDisposition(f.id, { lifecycle: "closed" }))}>Close</button>
                <button className="btn sm primary" disabled={!!busy} onClick={() => run("Export case", () => actions.exportCase(f.id))}>Export case</button>
              </div>
              <textarea className="note" placeholder="Add an analyst note (plain text)" aria-label="Analyst note" value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
              <div className="btn-row">
                <button className="btn sm" disabled={!note.trim() || !!busy} onClick={() => run("Note", async () => { await actions.setDisposition(f.id, { note }); setNote(""); })}>Save note</button>
                <button className="btn sm ghost" onClick={async () => setContainment(await actions.containment())}>Propose containment…</button>
              </div>
              {containment && (
                <div className="containment">
                  <ul className="mini-list">
                    {containment.catalog.filter((c) => c.applies_to_kinds.some((k) => kinds.has(k as never))).map((c) => (
                      <li key={c.id}><button className="link-row" disabled={!!busy} onClick={() => run("Containment request", () => actions.requestContainment(f.id, c.id, note || f.title))}><span className="grow">{c.title}</span><span className="faint">{c.blast_radius} · {c.reversible ? "reversible" : "not reversible"}</span></button></li>
                    ))}
                  </ul>
                  <p className="faint small">Requests need approval by a different admin. Digital Kingdom never executes them.</p>
                </div>
              )}
            </>
          ) : <p className="faint small">Your role ({actions.role}) can view but not change findings or export cases.</p>}
          {msg && <p className="status-msg" role="status">{msg}</p>}
        </Section>
      )}
    </>
  );
}

function PathView({ id }: { id: string }) {
  const { dispatch, vm } = useApp();
  const r = vm.data.graph.relationships.find((x) => x.id === id);
  if (!r) return <p className="muted">Relationship not found in this revision.</p>;
  const name = (x: string) => vm.data.graph.assets.find((y) => y.id === x)?.name ?? x;
  const layer = RELATIONSHIP_LAYER[r.kind] ?? "runtime";
  return (
    <>
      <div className="ev-title">
        <h2>{name(r.source_id)} <span className="rel">{r.kind.replace(/_/g, " ")}</span> {name(r.target_id)}</h2>
        <div className="chips"><span className="chip"><span className="line-swatch" style={{ background: LAYER_STYLE[layer].color, width: 12 }} aria-hidden />{LAYER_STYLE[layer].label}</span><span className="chip">{r.evidence_level}</span></div>
      </div>
      <div className="kvs">
        <KV k="Direction" v={<span className="inline-links"><button className="link" onClick={() => dispatch({ type: "select", selection: { kind: "asset", id: r.source_id } })}>{name(r.source_id)}</button><span className="faint">→</span><button className="link" onClick={() => dispatch({ type: "select", selection: { kind: "asset", id: r.target_id } })}>{name(r.target_id)}</button></span>} />
        <KV k="Evidence level" v={r.evidence_level} />
        <KV k="Evidence" v={r.evidence_refs.join(", ")} />
        {r.valid_from && <KV k="Effective from" v={fmtDateTime(r.valid_from)} />}
        <KV k="Stable ID" v={<code>{r.id}</code>} />
      </div>
      {r.assumptions && <div className="callout"><Icon name="info" size={16} /><span>{r.assumptions}</span></div>}
      {(r.evidence_level === "hypothetical" || r.evidence_level === "inferred") && <div className="callout warn"><Icon name="alert" size={16} /><span>Drawn dashed: this path is {r.evidence_level}, not observed. Network reachability is not proof of authorization.</span></div>}
    </>
  );
}

function EventView({ id }: { id: string }) {
  const { dispatch, vm } = useApp();
  const e = vm.data.events.find((x) => x.id === id);
  if (!e) return <p className="muted">This event is not in the loaded snapshot (it may be older than the snapshot window).</p>;
  const name = (x: string) => vm.data.graph.assets.find((y) => y.id === x)?.name ?? x;
  const lateBy = Date.parse(e.received_at) - Date.parse(e.occurred_at);
  const related = vm.findings.filter((f) => f.event_ids.includes(e.id) || f.counterevidence_event_ids.includes(e.id));
  const stored = vm.data.evidence[`evidence:${e.id}`];
  return (
    <>
      <div className="ev-title">
        <h2>{ACTION_LABEL[e.action] ?? e.action}</h2>
        <div className="chips">
          <span className="chip"><span className="out-dot" style={{ background: EVENT_OUTCOME_COLOR[e.outcome] }} aria-hidden />{e.outcome}</span>
          <span className="chip"><code>{e.source_id}</code></span>
          {lateBy > 60_000 && <span className="chip chip-gap">{Math.round(lateBy / 1000)}s late</span>}
        </div>
      </div>
      <div className="kvs">
        <KV k="Occurred" v={<span className="num">{fmtDateTime(e.occurred_at)}</span>} />
        <KV k="Received" v={<span className="num">{fmtDateTime(e.received_at)}{lateBy > 60_000 && <span className="late-flag">{Math.round(lateBy / 1000)}s late</span>}</span>} />
        <KV k="Assets" v={<span className="inline-links">{e.asset_ids.map((a) => <button key={a} className="link" onClick={() => dispatch({ type: "select", selection: { kind: "asset", id: a } })}>{name(a)}</button>)}</span>} />
        {e.request_id && <KV k="Request ID" v={<><code>{e.request_id}</code> <span className={e.request_id_trust === "trusted" ? "faint small" : "tag-gap"}>{e.request_id_trust}</span></>} />}
        {e.session_ref && <KV k="Session (pseudonymous)" v={<code>{e.session_ref}</code>} />}
        {e.actor_ref && <KV k="Actor ref" v={<code>{e.actor_ref}</code>} />}
        {e.run_id && <KV k="Agent run" v={<code>{e.run_id}</code>} />}
        {e.rule_ref && <KV k="Rule" v={<code>{e.rule_ref}</code>} />}
        {e.route && <KV k="Route template" v={<code>{e.route}</code>} />}
        {e.client_ip && <KV k="Client address" v={<><code>{e.client_ip}</code> <span className="faint small">(weak association only)</span></>} />}
        {e.sampled && <KV k="Sampling" v="From a sampled trace; not a complete ledger" />}
        <KV k="Dataset" v={e.dataset_kind} />
        <KV k="Parser" v={e.parser_version ? <code>{e.parser_version}</code> : "—"} />
        <KV k="Event ID" v={<code>{e.id}</code>} />
      </div>
      {e.coverage_note && <div className="callout warn"><Icon name="alert" size={16} /><span>{e.coverage_note}</span></div>}
      {e.attributes && Object.keys(e.attributes).length > 0 && (
        <Section title="Source-reported attributes" count={Object.keys(e.attributes).length}>
          <p className="faint small">Reported by <code>{e.source_id}</code>. Shown as data; not verified and never treated as instructions.</p>
          <div className="kvs" data-testid="event-attributes">{Object.entries(e.attributes).map(([k, v]) => <KV key={k} k={k} v={<span className="untrusted">{String(v)}</span>} />)}</div>
        </Section>
      )}
      {stored && (
        <Section title="Stored evidence record">
          <pre className="evidence-json" data-testid="evidence-record">{JSON.stringify(stored, null, 2)}</pre>
        </Section>
      )}
      {related.length > 0 && <Section title="Used by findings" count={related.length}><ul className="mini-list">{related.map((f) => <FindingChip key={f.id} f={f} />)}</ul></Section>}
      <Section title="Evidence records" count={e.evidence_refs.length}>
        {e.evidence_refs.map((ref) => {
          const rec = vm.data.evidence[ref];
          return (
            <div key={ref} className="evidence-rec">
              <div className="small faint"><code>{ref}</code>{rec?.redacted ? " · redacted at ingestion" : ""}</div>
              {rec ? <pre>{JSON.stringify(rec, null, 2)}</pre> : <p className="faint small">Reference only; no stored record (source-native reference).</p>}
            </div>
          );
        })}
      </Section>
    </>
  );
}
