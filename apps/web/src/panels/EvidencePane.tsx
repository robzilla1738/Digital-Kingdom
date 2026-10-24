import { useCallback, useEffect, useRef } from "react";
import { MODULE_CATALOG } from "@dk/contracts";
import { locateAsset } from "@dk/scene-compiler";
import { useApp } from "../lib/state.tsx";
import { COVERAGE_STYLE, KIND_LABEL, LAYER_STYLE, RELATIONSHIP_LAYER, fmtDateTime } from "../lib/vocab.ts";
import { relationshipMeaning, serviceInterior } from "../lib/layers.ts";
import { Icon } from "../lib/icons.tsx";
import { ASSET_COVERAGE_LABEL } from "../lib/presentation.ts";
import { EventView } from "../inspector/EventView.tsx";
import { FindingView } from "../inspector/FindingView.tsx";
import { CopyReference, EventTable, FindingChip, KV, Section } from "../inspector/Shared.tsx";
import { familyCapability } from "../castle/scenePresentation.ts";
export { ActionsCtx, type ServerActions } from "../inspector/actions.tsx";

const KIND_TITLE = { asset: "Asset", finding: "Finding", path: "Relationship", relationship: "Relationship", event: "Event", source: "Source" } as const;
export function EvidencePane({ expanded = false, findingQueue = [], onExpand, onReturn }: { expanded?: boolean; findingQueue?: { id: string; title: string }[]; onExpand?: () => void; onReturn?: () => void }) {
  const { ui, dispatch, vm } = useApp();
  const pane = useRef<HTMLElement>(null);
  const invoker = useRef<HTMLElement | null>(null), pendingInvoker = useRef<HTMLElement | null>(null), restoreRequested = useRef(false);
  // Capture before selection can hide the narrow result list. Keyboard activation also emits click.
  useEffect(() => {
    const remember = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button,a,input,select,[tabindex]') : null;
      if (target && !target.closest('aside.evidence')) pendingInvoker.current = target;
    };
    document.addEventListener('click', remember, true);
    return () => document.removeEventListener('click', remember, true);
  }, []);
  useEffect(() => {
    if (!ui.selection || !ui.inspector) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    invoker.current = pendingInvoker.current ?? (active && !active.closest('aside.evidence') ? active : invoker.current);
    pendingInvoker.current = null;
    const frame = expanded ? requestAnimationFrame(() => pane.current?.focus({ preventScroll: true })) : matchMedia('(max-width:1279px)').matches ? requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('aside.evidence button.close')?.focus()) : null;
    return () => { if (frame !== null) cancelAnimationFrame(frame); };
  }, [ui.selection?.kind, ui.selection?.id, ui.inspector, expanded]);
  const close = useCallback(() => {
    restoreRequested.current = true;
    dispatch({ type: 'select', selection: null });
  }, [dispatch]);
  // Restore after the close commit reveals narrow results, not from the pre-commit event frame.
  useEffect(() => {
    if (ui.selection || !restoreRequested.current) return;
    restoreRequested.current = false;
    const frame = requestAnimationFrame(() => {
      // A later user action takes precedence over this deferred restoration.
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement && active.getClientRects().length && !pane.current?.contains(active)) return;
      const target = invoker.current;
      if (target?.isConnected && target.getClientRects().length) target.focus();
      else document.getElementById('main')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [ui.selection]);
  useEffect(() => { window.addEventListener('dk:close-inspector', close); return () => window.removeEventListener('dk:close-inspector', close); }, [close]);
  if (!ui.selection) return <aside className="evidence empty-pane" aria-label="Inspector"><div className="pane-head"><span className="pane-kind">Inspector</span><button className="icon-btn sm" onClick={() => dispatch({ type: "panel", panel: "inspector", open: false })} aria-label="Hide inspector"><Icon name="x" size={15} /><span>Close</span></button></div><div className="pane-body"><h2>Select a record</h2><p>Choose an asset, finding, relationship, source or event to inspect its recorded evidence and limitations.</p><p className="scope-note">Findings, source visibility, stored-record completeness and browser synchronization are separate observations.</p></div></aside>;
  const selection = ui.selection;
  const key = `${vm.data.project.id}:${selection.kind}:${selection.id}`;
  const queueIndex = findingQueue.findIndex((finding) => finding.id === selection.id);
  const previous = queueIndex > 0 ? findingQueue[queueIndex - 1] : undefined, next = findingQueue[queueIndex + 1];
  const chooseFinding = (finding: { id: string; title: string }) => dispatch({ type: "select", selection: { kind: "finding", id: finding.id }, announce: `Selected finding ${finding.title}` });
  return <aside ref={pane} tabIndex={-1} className={`evidence${expanded ? " expanded-evidence" : ""}`} role={expanded ? "region" : undefined} aria-label={expanded ? "Expanded finding investigation" : "Evidence"} data-expanded={expanded ? "true" : "false"} data-selection-kind={selection.kind} data-selection-id={selection.id}>
    <div className="pane-head"><span className="pane-kind">{KIND_TITLE[selection.kind]}<code>{selection.id}</code></span><button className="btn sm close" onClick={close} aria-label="Close evidence pane" title="Close (Esc)"><Icon name="x" size={15} /><span>Close</span></button></div>
    {expanded && <nav className="expanded-finding-queue" aria-label="Filtered finding queue"><button className="btn" onClick={onReturn}>Return to results</button><p data-testid="finding-queue-position" role="status" aria-live={ui.reduceAutomaticAnnouncements ? "off" : "polite"}>{queueIndex >= 0 ? `Finding ${queueIndex + 1} of ${findingQueue.length} matching findings` : `Selected finding is outside current filters · ${findingQueue.length} matches. ${findingQueue.length ? "Next opens the first match." : "No matching findings to navigate."}`}</p><div className="inline-actions"><button className="btn" disabled={!previous} title={previous?.title} onClick={() => previous && chooseFinding(previous)}>Previous finding</button><button className="btn" disabled={!next} title={next?.title} onClick={() => next && chooseFinding(next)}>Next finding</button></div></nav>}
    <div className="pane-body">
      {selection.kind === "finding" && !expanded && onExpand && <button className="btn sm" onClick={onExpand}>Expand investigation</button>}
      {selection.kind === "asset" && <AssetView key={key} id={selection.id} />}
      {selection.kind === "finding" && <FindingView key={key} id={selection.id} />}
      {(selection.kind === "path" || selection.kind === "relationship") && <PathView key={key} id={selection.id} />}
      {selection.kind === "event" && <EventView key={key} id={selection.id} />}
      {selection.kind === "source" && <SourceView key={key} id={selection.id} />}
    </div>
  </aside>;
}
function AssetView({ id }: { id: string }) {
  const { dispatch, vm } = useApp(); const asset = vm.data.graph.assets.find((a) => a.id === id);
  const located = locateAsset(vm.data.scene, id);
  if (!asset) return <><p className="scope-note">Asset {id} is not in graph revision {vm.data.graph.graph_revision}. It may be removed or unavailable; no replacement asset has been selected.</p>
    {!!located.history.length && <Section title="Archived placements" count={located.history.length}><p className="small faint" data-testid="archived-incarnations">Retired incarnations at their last position. These are layout history, not live structures, and carry no current status.</p><ul className="mini-list">{located.history.map((h) => <li key={h.incarnation_id ?? h.retired_in_revision}><div className="kvs"><KV k="Incarnation" v={h.incarnation_id ?? "recorded before incarnations"} /><KV k="Retired in revision" v={h.retired_in_revision} /><KV k="Last position" v={`${h.room.zone_id} · x ${h.room.position.x}, z ${h.room.position.z}`} /></div></li>)}</ul></Section>}</>;
  const room = vm.data.scene.rooms.find((r) => r.asset_id === id), status = vm.assetStatus.get(id);
  const findings = vm.findings.filter((f) => f.affected_asset_ids.includes(id));
  const coverage = vm.coverage.filter((c) => c.asset_ids.includes(id));
  const sources = vm.latestData.sources.filter((source) => source.asset_ids.includes(id));
  const visibility = status ? ASSET_COVERAGE_LABEL[status.coverage] : "Coverage not assessed";
  const relationships = vm.data.graph.relationships.filter((r) => r.source_id === id || r.target_id === id);
  const activity = vm.events.filter((event) => event.asset_ids.includes(id)).slice(-12).reverse();
  const name = (assetId: string) => vm.data.graph.assets.find((a) => a.id === assetId)?.name ?? assetId;
  const interior = serviceInterior(vm.data.graph, id);
  return <><div className="ev-title"><h2>{asset.name}</h2><p className="subtitle">{KIND_LABEL[asset.kind]}{room ? ` · ${MODULE_CATALOG[room.module_id]?.label ?? `${room.module_id} (placeholder: module not in this kit)`}` : ""}</p><div className="chips"><span className="chip">{asset.environment}</span><span className="chip">{asset.lifecycle ?? "active"}</span></div></div>
    <div className="btn-row"><CopyReference kind="asset" id={id} /><button className="btn sm" onClick={() => dispatch({ type: "focus" })}>Focus asset</button></div>
    <Section title="Summary"><div className="kvs"><KV k="Stable ID" v={asset.id} />{located.current && <KV k="Incarnation" v={located.current.incarnation.id} />}<KV k="Graph revision" v={vm.data.graph.graph_revision} /><KV k="Owner" v={asset.owner ?? "Not declared"} /><KV k="Sensitivity" v={asset.sensitivity ?? "Not declared"} />{asset.aliases?.length ? <KV k="Aliases" v={asset.aliases.join(", ")} /> : null}<KV k="Instances" v={asset.instance_count ?? "Not declared"} /><KV k="Provenance" v={asset.source_refs.join(", ") || "Not declared"} /></div></Section>
    {room && familyCapability(room.module_id) && <p className="small faint" data-testid="family-capability" data-support={familyCapability(room.module_id)!.support}>{familyCapability(room.module_id)!.text}</p>}
    {!!located.history.length && <Section title="Earlier incarnations" count={located.history.length}><p className="small faint" data-testid="earlier-incarnations">This asset id was removed or re-identified before. Earlier incarnations keep their own records and last positions; nothing from them is attributed to the current one.</p><ul className="mini-list">{located.history.map((h) => <li key={h.incarnation_id ?? h.retired_in_revision}>{h.incarnation_id ?? "recorded before incarnations"} · retired in {h.retired_in_revision} · last at {h.room.zone_id} (x {h.room.position.x}, z {h.room.position.z})</li>)}</ul></Section>}
    <Section title="Findings" count={findings.length}><p className="small faint">{status?.findingIds.length ?? 0} non-closed findings. Lifecycle and analyst disposition are separate.</p>{findings.length ? <ul className="mini-list">{findings.map((f) => <FindingChip f={f} key={f.id} />)}</ul> : <p>No findings recorded for this asset. That is not proof of safety.</p>}</Section>
    <Section title="Visibility"><p className="scope-note" data-testid="asset-coverage-state">{visibility}. {status?.coverageNote ?? "Current coverage could not be assessed."}</p><p className="small faint">Current coverage as of {fmtDateTime(vm.coverageAsOf)}. Coverage during a replay interval has not been assessed.</p><ul className="mini-list">{sources.map((source) => { const c = coverage.find((item) => item.source_id === source.id); return <li key={source.id}><button className="link-row" onClick={() => dispatch({ type: "select", selection: { kind: "source", id: source.id } })}><span className="grow">{source.label}</span><span>{source.disabled ? "Administratively disabled" : c ? COVERAGE_STYLE[c.state].label : "Coverage not assessed"}</span></button></li>; })}</ul></Section>
    <Section title="Recent stored activity" count={activity.length}><p className="small faint">At most 12 loaded events from {fmtDateTime(vm.data.window.start)} to {fmtDateTime(vm.at)}. This is not the full stored event archive.</p><button className="btn sm" onClick={() => dispatch({ type: "eventAssetFilter", assetId: id })}>Search all stored events for this asset</button><EventTable events={activity} /></Section>
    {interior && <Section title="Interior"><div data-testid="service-interior"><p className="small faint">{interior.note}</p><div className="kvs"><KV k="Routes" v={interior.routes ? interior.routes.map((r) => `${r.method} ${r.path}`).join("; ") : "No routes declared"} /><KV k="Deployed by" v={interior.deployed_by.map((d) => `${d.name} (${d.evidence})`).join(", ") || "Not declared"} /><KV k="Instances" v={interior.instances ?? "Not declared"} /><KV k="Permissions" v={interior.permissions.map((p) => `${p.label} → ${p.target} (${p.evidence})`).join("; ") || "None declared"} /><KV k="Tool capabilities" v={interior.tools.map((t) => `${t.tool} (${t.evidence}; ${t.meaning})`).join("; ") || "None declared"} /></div></div></Section>}
    <Section title="Relationships" count={relationships.length}><ul className="mini-list">{relationships.map((r) => <li key={r.id}><button className="link-row" onClick={() => dispatch({ type: "select", selection: { kind: "path", id: r.id } })}><span className="grow">{name(r.source_id)} → {name(r.target_id)}<small className="faint">{relationshipMeaning(r.kind, r.evidence_level).label}</small></span><span>{r.evidence_level}</span></button></li>)}</ul></Section>
  </>;
}
function PathView({ id }: { id: string }) {
  const { dispatch, vm } = useApp(); const relationship = vm.data.graph.relationships.find((r) => r.id === id);
  if (!relationship) return <p className="scope-note">Relationship not found in graph revision {vm.data.graph.graph_revision}.</p>;
  const r = relationship, layer = RELATIONSHIP_LAYER[r.kind] ?? "runtime";
  const name = (assetId: string) => vm.data.graph.assets.find((a) => a.id === assetId)?.name ?? assetId;
  return <><div className="ev-title"><h2>{name(r.source_id)} → {name(r.target_id)}</h2><p>{r.kind.replace(/_/g, " ")}</p><div className="chips"><span className="chip">{LAYER_STYLE[layer].label}</span><span className="chip">{r.evidence_level}</span><span className="chip" data-testid="relationship-meaning">{relationshipMeaning(r.kind, r.evidence_level).label}</span></div><p className="small faint">{relationshipMeaning(r.kind, r.evidence_level).note}</p></div><CopyReference kind="path" id={id} />
    <Section title="Relationship evidence"><div className="kvs"><KV k="Source" v={<button className="link" onClick={() => dispatch({ type: "select", selection: { kind: "asset", id: r.source_id } })}>{name(r.source_id)}</button>} /><KV k="Destination" v={<button className="link" onClick={() => dispatch({ type: "select", selection: { kind: "asset", id: r.target_id } })}>{name(r.target_id)}</button>} /><KV k="Stable ID" v={r.id} /><KV k="Graph revision" v={vm.data.graph.graph_revision} /><KV k="Evidence references" v={r.evidence_refs.join(", ") || "None supplied"} />{r.valid_from && <KV k="Effective from" v={fmtDateTime(r.valid_from)} />}</div></Section>
    {r.evidence_level === "declared" && <p className="scope-note">Declared relationship. Runtime communication has not been established by this declaration alone.</p>}
    {(r.evidence_level === "hypothetical" || r.evidence_level === "inferred") && <p className="scope-note warning">{r.evidence_level === "hypothetical" ? "Hypothetical relationship — not an observed transition." : "Inferred relationship, not direct observation."} Network reachability is not proof of authorization.</p>}
    {r.assumptions && <Section title="Assumptions"><p>{r.assumptions}</p></Section>}
  </>;
}
function SourceView({ id }: { id: string }) {
  const { vm, dispatch } = useApp(); const source = vm.latestData.sources.find((s) => s.id === id), coverage = vm.coverage.find((c) => c.source_id === id);
  if (!source) return <p className="scope-note">Source {id} is no longer configured or is unavailable to this project. Stored event references do not establish current reporting.</p>;
  const events = vm.data.events.filter((e) => e.source_id === id && (e.action === "sensor_unavailable" || e.action === "sensor_restored")).slice(-12).reverse();
  return <><div className="ev-title"><h2>{source.label}</h2><p className="subtitle">{source.id} · {source.kind ?? "Kind not supplied"}</p><span className="chip">{source.disabled ? "Administratively disabled" : coverage ? COVERAGE_STYLE[coverage.state].label : "Coverage not assessed"}</span></div><CopyReference kind="source" id={id} />
    <Section title="Current source visibility"><p className="scope-note">Current as of {fmtDateTime(vm.coverageAsOf)}. Historical coverage during the selected event interval has not been assessed.</p>{source.disabled && <p className="scope-note warning">Administratively disabled. Stored events do not establish current reporting.</p>}{coverage?.state === "healthy" && !source.disabled && <p>This source is currently reporting according to its configured freshness checks. This does not establish complete detection.</p>}<div className="kvs"><KV k="Reason" v={coverage?.note ?? "No additional reason supplied"} /><KV k="Last event" v={coverage?.last_event_at ? fmtDateTime(coverage.last_event_at) : "Not available"} /><KV k="Freshness threshold" v={source.stale_after_seconds === undefined ? "Not supplied" : `${source.stale_after_seconds} seconds`} /><KV k="Allowed actions" v={source.allowed_actions?.join(", ") ?? "Not supplied to this view"} /><KV k="Trusted request IDs" v={source.trusts_request_ids ? "Declared trusted" : "Not declared trusted"} /><KV k="Independence group" v={source.independence_group ?? "Not supplied"} /><KV k="Identity namespace" v={source.identity_namespace ?? "Private to this source (no cross-source identity links)"} /><KV k="Run namespace" v={source.run_namespace ?? "Private to this source (no cross-source run links)"} /></div></Section>
    <Section title="Configured assets" count={source.asset_ids.length}><ul className="mini-list">{source.asset_ids.map((assetId) => <li key={assetId}><button className="link-row" onClick={() => dispatch({ type: "select", selection: { kind: "asset", id: assetId } })}>{vm.data.graph.assets.find((a) => a.id === assetId)?.name ?? assetId}</button></li>)}</ul></Section><Section title="Loaded source-health events" count={events.length}><p className="small faint">From the bounded browser snapshot; not a historical coverage reconstruction.</p><EventTable events={events} /></Section>
  </>;
}
