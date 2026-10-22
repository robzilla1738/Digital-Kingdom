import { createContext, useContext, useState, type ReactNode } from "react";
import { MODULE_CATALOG, type Finding, type SecurityEvent } from "@dk/contracts";
import { useApp } from "../lib/state.tsx";
import { ACTION_LABEL, COVERAGE_STYLE, EVENT_OUTCOME_COLOR, EVIDENCE_LEVEL_LABEL, KIND_LABEL, OUTCOME_STYLE, RELATIONSHIP_LAYER, LAYER_STYLE, fmtDateTime, fmtTime } from "../lib/vocab.ts";

export interface ServerActions {
  role: "viewer" | "analyst" | "admin" | "none";
  setDisposition(id: string, body: { lifecycle?: string; disposition?: string; note?: string }): Promise<void>;
  exportCase(id: string): Promise<void>;
  containment(): Promise<{ catalog: { id: string; title: string; applies_to_kinds: string[]; blast_radius: string; reversible: boolean }[]; requests: Record<string, string>[] }>;
  requestContainment(findingId: string, actionId: string, rationale: string): Promise<void>;
}
export const ActionsCtx = createContext<ServerActions | null>(null);

export function EvidencePane() {
  const { ui, dispatch } = useApp();
  if (!ui.selection) return <aside className="evidence empty-pane" aria-label="Evidence"><Intro /></aside>;
  return (
    <aside className="evidence" aria-label="Evidence" aria-live="polite">
      <button className="close" onClick={() => dispatch({ type: "select", selection: null })} aria-label="Close evidence pane">×</button>
      {ui.selection.kind === "asset" && <AssetView id={ui.selection.id} />}
      {ui.selection.kind === "finding" && <FindingView id={ui.selection.id} />}
      {ui.selection.kind === "path" && <PathView id={ui.selection.id} />}
      {ui.selection.kind === "event" && <EventView id={ui.selection.id} />}
    </aside>
  );
}

function Intro() {
  const { vm } = useApp();
  const open = vm.findings.filter((f) => f.lifecycle !== "closed");
  const byState = Object.entries(OUTCOME_STYLE).map(([k, v]) => ({ k, v, n: open.filter((f) => f.outcome_state === k).length })).filter((x) => x.n);
  return (
    <div className="intro">
      <h2>{vm.data.project.name}</h2>
      {vm.data.project.description && <p className="muted">{vm.data.project.description}</p>}
      <div className="stat-grid">
        <div><b>{vm.data.graph.assets.length}</b><span>assets</span></div>
        <div><b>{open.length}</b><span>open findings</span></div>
        <div><b>{vm.events.length}</b><span>events</span></div>
        <div><b>{vm.coverage.filter((c) => c.state !== "healthy").length + vm.unobserved.length}</b><span>coverage gaps</span></div>
      </div>
      <h4>Open findings by outcome</h4>
      <ul className="legend-list">{byState.map(({ k, v, n }) => <li key={k}><span style={{ color: v.color }} aria-hidden>{v.glyph}</span> {v.label} <b>{n}</b><span className="muted"> — {v.describe}</span></li>)}</ul>
      <p className="muted small">Select a room, a graph node, a finding, or a timeline tick to see its evidence. Nothing here is a verdict of compromise unless the evidence says so.</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="ev-section"><h4>{title}</h4>{children}</section>;
}
function KV({ k, v }: { k: string; v: ReactNode }) {
  return <div className="kv"><span>{k}</span><span>{v}</span></div>;
}

function AssetView({ id }: { id: string }) {
  const { dispatch, vm } = useApp();
  const a = vm.data.graph.assets.find((x) => x.id === id);
  if (!a) return <p>Asset {id} is not in this graph revision.</p>;
  const room = vm.data.scene.rooms.find((r) => r.asset_id === id);
  const st = vm.assetStatus.get(id);
  const findings = vm.findings.filter((f) => f.affected_asset_ids.includes(id));
  const cov = vm.coverage.filter((c) => c.asset_ids.includes(id));
  const rels = vm.data.graph.relationships.filter((r) => r.source_id === id || r.target_id === id);
  const events = vm.events.filter((e) => e.asset_ids.includes(id)).slice(-12).reverse();
  const name = (x: string) => vm.data.graph.assets.find((y) => y.id === x)?.name ?? x;
  return (
    <div>
      <p className="eyebrow">{KIND_LABEL[a.kind]}{room ? ` · shown as ${MODULE_CATALOG[room.module_id].label.toLowerCase()}` : ""}</p>
      <h2>{a.name}</h2>
      {a.secondary_label && <p className="muted">{a.secondary_label}</p>}
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
        {cov.length ? cov.map((c) => (
          <div key={c.source_id} className="cov-line"><span className="dot" style={{ background: COVERAGE_STYLE[c.state].color }} aria-hidden /> {c.label}: <b>{COVERAGE_STYLE[c.state].label}</b>{c.note ? <span className="muted"> — {c.note}</span> : null}</div>
        )) : <div className="callout warn">No telemetry source covers this asset. Absence of findings means <b>unknown</b>, not safe.</div>}
        {st?.coverage === "gap" && <div className="callout warn">Every source for this asset is offline or stale. Recent activity is not assessable.</div>}
      </Section>
      <Section title={`Findings (${findings.length})`}>
        {findings.length ? <ul className="mini-list">{findings.map((f) => <FindingChip key={f.id} f={f} />)}</ul> : <p className="muted small">No findings recorded for this asset{vm.isLatest ? "" : " at this point in the replay"}.</p>}
      </Section>
      <Section title={`Relationships (${rels.length})`}>
        <ul className="mini-list">
          {rels.map((r) => {
            const out = r.source_id === id;
            return (
              <li key={r.id}><button className="link" onClick={() => dispatch({ type: "select", selection: { kind: "path", id: r.id } })}>
                <span style={{ color: LAYER_STYLE[RELATIONSHIP_LAYER[r.kind] ?? "runtime"].color }}>{out ? "→" : "←"}</span> {r.kind.replace(/_/g, " ")} {out ? name(r.target_id) : name(r.source_id)} <span className="muted">({r.evidence_level})</span>
              </button></li>
            );
          })}
        </ul>
      </Section>
      <Section title="Recent events">
        <EventTable events={events} />
      </Section>
    </div>
  );
}

function FindingChip({ f }: { f: Finding }) {
  const { dispatch } = useApp();
  const s = OUTCOME_STYLE[f.outcome_state];
  return <li><button className="link" onClick={() => dispatch({ type: "select", selection: { kind: "finding", id: f.id } })}><span style={{ color: s.color }} aria-hidden>{s.glyph}</span> {f.title} <span className="muted">· {s.label}</span></button></li>;
}

function EventTable({ events }: { events: SecurityEvent[] }) {
  const { dispatch, vm } = useApp();
  if (!events.length) return <p className="muted small">No events.</p>;
  return (
    <table className="ev-table">
      <thead><tr><th>Time</th><th>Action</th><th>Outcome</th><th>Source</th></tr></thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id} onClick={() => dispatch({ type: "select", selection: { kind: "event", id: e.id } })} tabIndex={0} onKeyDown={(k) => k.key === "Enter" && dispatch({ type: "select", selection: { kind: "event", id: e.id } })}>
            <td>{fmtTime(e.occurred_at)}{vm.lateEventIds.has(e.id) && <span className="late-flag" title="Arrived late">late</span>}</td>
            <td>{ACTION_LABEL[e.action] ?? e.action}</td>
            <td><span className="out-dot" style={{ background: EVENT_OUTCOME_COLOR[e.outcome] }} aria-hidden />{e.outcome}</td>
            <td className="muted">{e.source_id}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
  if (!f) return <p>This finding does not exist yet at this point in the replay.</p>;
  const s = OUTCOME_STYLE[f.outcome_state];
  const evs = vm.data.events.filter((e) => f.event_ids.includes(e.id));
  const counter = vm.data.events.filter((e) => f.counterevidence_event_ids.includes(e.id));
  const name = (x: string) => vm.data.graph.assets.find((y) => y.id === x)?.name ?? x;
  const canAnalyst = actions && (actions.role === "analyst" || actions.role === "admin");
  const kinds = new Set(f.affected_asset_ids.map((a) => vm.data.graph.assets.find((x) => x.id === a)?.kind));
  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); setMsg(null); try { await fn(); setMsg(`${label}: done`); } catch (e) { setMsg(`${label} failed: ${(e as Error).message}`); } finally { setBusy(null); } };
  return (
    <div>
      <p className="eyebrow">Finding · rule {f.rule_id} · {f.rule_version}</p>
      <h2>{f.title}</h2>
      <div className="chips">
        <span className="chip" style={{ borderColor: s.color, color: s.color }}>{s.glyph} {s.label}</span>
        <span className="chip">{EVIDENCE_LEVEL_LABEL[f.evidence_level]}</span>
        <span className={`chip sev sev-${f.severity}`}>{f.severity}</span>
        {f.revision > 1 && <span className="chip">revision {f.revision}</span>}
        {f.dataset_kind === "synthetic" && <span className="chip chip-demo">synthetic</span>}
      </div>
      <p className="claim">{f.claim}</p>
      <div className="kvs">
        <KV k="Window" v={`${fmtDateTime(f.first_seen)} → ${fmtTime(f.last_seen)}`} />
        <KV k="Last evidence received" v={fmtDateTime(f.last_received)} />
        <KV k="Affected" v={<span className="inline-links">{f.affected_asset_ids.map((a) => <button key={a} className="link" onClick={() => dispatch({ type: "select", selection: { kind: "asset", id: a } })}>{name(a)}</button>)}</span>} />
        <KV k="Status" v={`${f.lifecycle} · ${f.disposition.replace(/_/g, " ")}`} />
      </div>
      {f.not_claimed.length > 0 && <Section title="What this does not claim"><ul className="bullets">{f.not_claimed.map((x, i) => <li key={i}>{x}</li>)}</ul></Section>}
      {f.coverage_gaps.length > 0 && <Section title="Evidence gaps"><ul className="bullets warn">{f.coverage_gaps.map((x, i) => <li key={i}>{x}</li>)}</ul></Section>}
      <Section title={`Supporting events (${evs.length})`}><EventTable events={evs} /></Section>
      {counter.length > 0 && <Section title={`Counterevidence (${counter.length})`}><EventTable events={counter} /></Section>}
      <Section title="Next review steps"><ol className="bullets">{f.next_steps.map((x, i) => <li key={i}>{x}</li>)}</ol></Section>
      {actions && actions.role !== "none" && (
        <Section title="Analyst actions">
          {canAnalyst ? (
            <>
              <div className="btn-row">
                <button className="btn" disabled={!!busy} onClick={() => run("Acknowledge", () => actions.setDisposition(f.id, { lifecycle: "acknowledged" }))}>Acknowledge</button>
                <button className="btn" disabled={!!busy} onClick={() => run("Mark expected test", () => actions.setDisposition(f.id, { disposition: "expected_test" }))}>Expected test</button>
                <button className="btn" disabled={!!busy} onClick={() => run("Close", () => actions.setDisposition(f.id, { lifecycle: "closed" }))}>Close</button>
                <button className="btn primary" disabled={!!busy} onClick={() => run("Export case", () => actions.exportCase(f.id))}>Export case</button>
              </div>
              <textarea className="note" placeholder="Add an analyst note (plain text)" value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
              <button className="btn" disabled={!note.trim() || !!busy} onClick={() => run("Note", async () => { await actions.setDisposition(f.id, { note }); setNote(""); })}>Save note</button>
              <div className="containment">
                <button className="btn ghost" onClick={async () => setContainment(await actions.containment())}>Propose containment…</button>
                {containment && (
                  <ul className="mini-list">
                    {containment.catalog.filter((c) => c.applies_to_kinds.some((k) => kinds.has(k as never))).map((c) => (
                      <li key={c.id}><button className="link" disabled={!!busy} onClick={() => run("Containment request", () => actions.requestContainment(f.id, c.id, note || f.title))}>{c.title}</button> <span className="muted small">({c.blast_radius}, {c.reversible ? "reversible" : "not reversible"})</span></li>
                    ))}
                    <li className="muted small">Requests need approval by a different admin. Digital Kingdom never executes them.</li>
                  </ul>
                )}
              </div>
            </>
          ) : <p className="muted small">Your role ({actions.role}) can view but not change findings or export cases.</p>}
          {msg && <p className="small" role="status">{msg}</p>}
        </Section>
      )}
    </div>
  );
}

function PathView({ id }: { id: string }) {
  const { dispatch, vm } = useApp();
  const r = vm.data.graph.relationships.find((x) => x.id === id);
  if (!r) return <p>Relationship not found in this revision.</p>;
  const name = (x: string) => vm.data.graph.assets.find((y) => y.id === x)?.name ?? x;
  const layer = RELATIONSHIP_LAYER[r.kind] ?? "runtime";
  return (
    <div>
      <p className="eyebrow">Relationship · {LAYER_STYLE[layer].label}</p>
      <h2>{name(r.source_id)} <span className="muted">{r.kind.replace(/_/g, " ")}</span> {name(r.target_id)}</h2>
      <div className="kvs">
        <KV k="Direction" v={<span className="inline-links"><button className="link" onClick={() => dispatch({ type: "select", selection: { kind: "asset", id: r.source_id } })}>{name(r.source_id)}</button> → <button className="link" onClick={() => dispatch({ type: "select", selection: { kind: "asset", id: r.target_id } })}>{name(r.target_id)}</button></span>} />
        <KV k="Evidence level" v={r.evidence_level} />
        <KV k="Evidence" v={r.evidence_refs.join(", ")} />
        {r.valid_from && <KV k="Effective from" v={fmtDateTime(r.valid_from)} />}
        <KV k="Stable ID" v={<code>{r.id}</code>} />
      </div>
      {r.assumptions && <div className="callout">{r.assumptions}</div>}
      {(r.evidence_level === "hypothetical" || r.evidence_level === "inferred") && <p className="muted small">Drawn dashed: this path is {r.evidence_level}, not observed. Network reachability is not proof of authorization.</p>}
    </div>
  );
}

function EventView({ id }: { id: string }) {
  const { dispatch, vm } = useApp();
  const e = vm.data.events.find((x) => x.id === id);
  if (!e) return <p>Event not found.</p>;
  const name = (x: string) => vm.data.graph.assets.find((y) => y.id === x)?.name ?? x;
  const lateBy = Date.parse(e.received_at) - Date.parse(e.occurred_at);
  const related = vm.findings.filter((f) => f.event_ids.includes(e.id) || f.counterevidence_event_ids.includes(e.id));
  return (
    <div>
      <p className="eyebrow">Event · {e.source_id}</p>
      <h2>{ACTION_LABEL[e.action] ?? e.action} <span style={{ color: EVENT_OUTCOME_COLOR[e.outcome] }}>{e.outcome}</span></h2>
      <div className="kvs">
        <KV k="Occurred" v={fmtDateTime(e.occurred_at)} />
        <KV k="Received" v={<>{fmtDateTime(e.received_at)}{lateBy > 60_000 && <span className="late-flag">{Math.round(lateBy / 1000)}s late</span>}</>} />
        <KV k="Assets" v={<span className="inline-links">{e.asset_ids.map((a) => <button key={a} className="link" onClick={() => dispatch({ type: "select", selection: { kind: "asset", id: a } })}>{name(a)}</button>)}</span>} />
        {e.request_id && <KV k="Request ID" v={<><code>{e.request_id}</code> <span className={`chip ${e.request_id_trust === "trusted" ? "" : "chip-gap"}`}>{e.request_id_trust}</span></>} />}
        {e.session_ref && <KV k="Session (pseudonymous)" v={<code>{e.session_ref}</code>} />}
        {e.actor_ref && <KV k="Actor ref" v={<code>{e.actor_ref}</code>} />}
        {e.run_id && <KV k="Agent run" v={<code>{e.run_id}</code>} />}
        {e.rule_ref && <KV k="Rule" v={e.rule_ref} />}
        {e.route && <KV k="Route template" v={<code>{e.route}</code>} />}
        {e.client_ip && <KV k="Client address" v={<><code>{e.client_ip}</code> <span className="muted small">(weak association only)</span></>} />}
        {e.sampled && <KV k="Sampling" v="From a sampled trace; not a complete ledger" />}
        <KV k="Dataset" v={e.dataset_kind} />
        <KV k="Parser" v={e.parser_version ?? "—"} />
        <KV k="Event ID" v={<code>{e.id}</code>} />
      </div>
      {e.coverage_note && <div className="callout">{e.coverage_note}</div>}
      {related.length > 0 && <Section title="Used by findings"><ul className="mini-list">{related.map((f) => <FindingChip key={f.id} f={f} />)}</ul></Section>}
      <Section title="Evidence records">
        {e.evidence_refs.map((ref) => {
          const rec = vm.data.evidence[ref];
          return (
            <div key={ref} className="evidence-rec">
              <div className="small muted"><code>{ref}</code>{rec?.redacted ? " · redacted at ingestion" : ""}</div>
              {rec ? <pre>{JSON.stringify(rec, null, 2)}</pre> : <p className="muted small">Reference only; no stored record (source-native reference).</p>}
            </div>
          );
        })}
      </Section>
    </div>
  );
}
