import { useMemo, useState } from "react";
import { searchWorld, structureNodeFor, type HierarchyNode } from "@dk/scene-compiler";
import { useApp } from "../lib/state.tsx";
import { ASSET_COVERAGE_LABEL } from "../lib/presentation.ts";
import { focusMembers, worldHierarchy } from "../lib/world.ts";

/**
 * LP16 world navigator: the list equivalent of the castle and the 2D graph. Realm > environment > district > structure
 * with stable ids, a breadcrumb trail, back through focus history (browser history, so Back works the same from any
 * view), complete district membership lists and a search over every asset including archived incarnations.
 * Nothing here is a finding or an incident: groups come from declared environment, account and zone only.
 */
export function WorldNavigator({ query }: { query: string }) {
  const { ui, dispatch, vm } = useApp();
  const h = worldHierarchy(vm.data.graph, vm.data.scene);
  const focus = focusMembers(h, ui.focus);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const search = useMemo(() => query.trim() ? searchWorld(h, query) : null, [h, query]);
  const name = (id: string) => vm.data.graph.assets.find((a) => a.id === id)?.name ?? id;
  const focusOn = (n: HierarchyNode) => {
    if (n.kind === "structure") dispatch({ type: "select", selection: { kind: "asset", id: n.asset_ids[0]! }, announce: `Selected ${n.label}` });
    dispatch({ type: "worldFocus", focus: n.id, announce: `World focus: ${n.label}, ${n.asset_ids.length} asset${n.asset_ids.length === 1 ? "" : "s"}` });
  };
  const selectAsset = (assetId: string, archived: boolean) => {
    dispatch({ type: "select", selection: { kind: "asset", id: assetId }, announce: archived ? `Selected archived incarnation of ${assetId}. It is not a live structure.` : `Selected ${name(assetId)}` });
    if (archived) { dispatch({ type: "showArchived", on: true }); return; }
    // A result in another district moves the shared world focus to that structure, so every view frames it.
    const node = structureNodeFor(h, assetId);
    if (node) dispatch({ type: "worldFocus", focus: node.id, announce: `World focus: ${node.label}` });
  };
  const district = (d: HierarchyNode) => {
    const expanded = open[d.id] ?? (focus?.trail.some((t) => t.id === d.id) ?? false);
    return <li key={d.id} className="world-node" data-world-node={d.id}>
      <div className="world-row">
        <button className={`link-row${ui.focus === d.id ? " active" : ""}`} aria-current={ui.focus === d.id ? "true" : undefined} onClick={() => focusOn(d)}><span className="grow"><strong>{d.label}</strong></span><span className="count">{d.asset_ids.length}</span></button>
        <button className="btn sm" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} all ${d.asset_ids.length} members of ${d.label}`} onClick={() => setOpen({ ...open, [d.id]: !expanded })}>{expanded ? "Hide" : "Members"}</button>
      </div>
      {expanded && <ul className="mini-list world-members" aria-label={`${d.label}: all ${d.asset_ids.length} members`}>{d.children.map((s) => { const st = vm.assetStatus.get(s.asset_ids[0]!); const selected = ui.selection?.kind === "asset" && ui.selection.id === s.asset_ids[0];
        return <li key={s.id}><button className={`link-row${selected ? " active" : ""}`} data-world-structure={s.asset_ids[0]} aria-current={selected ? "true" : undefined} onClick={() => focusOn(s)}><span className="grow">{s.label}<small className="faint"> · {s.asset_ids[0]}</small></span><small>{st ? ASSET_COVERAGE_LABEL[st.coverage] : "Coverage not assessed"}</small></button></li>; })}</ul>}
    </li>;
  };
  return <div className="world-nav" data-testid="world-navigator">
    <nav aria-label="World focus trail" className="world-trail">
      {(focus?.trail ?? [h.realm]).map((n, i, all) => <span key={n.id}>{i > 0 && <span aria-hidden> / </span>}<button className="link" aria-current={i === all.length - 1 ? "location" : undefined} onClick={() => dispatch({ type: "worldFocus", focus: n.kind === "realm" ? null : n.id })}>{n.kind === "realm" ? "All environments" : n.label}</button></span>)}
      <button className="btn sm" onClick={() => history.back()} disabled={!ui.focus && !ui.selection} aria-label="Previous focus (browser back)">Previous focus</button>
    </nav>
    <p className="small faint">Groups are presentation only: declared environment, account and zone, never findings or activity.</p>
    <label className="check"><input type="checkbox" checked={ui.showArchived} onChange={(e) => dispatch({ type: "showArchived", on: e.target.checked })} />Show archived placements ({(vm.data.scene.historical_rooms ?? []).length})</label>
    {search ? <section aria-label="World search results">
      <div className="list-meta" role="status"><span>{search.total} match{search.total === 1 ? "" : "es"} across {h.index.length} indexed placements</span></div>
      <ul className="mini-list">{search.results.map((e) => <li key={`${e.asset_id}:${e.incarnation_id ?? e.path}`}><button className="link-row world-result" data-world-result={e.asset_id} data-world-state={e.state ?? (e.tombstoned ? "archived" : "current")} onClick={() => selectAsset(e.asset_id, e.tombstoned)}><span className="grow">{e.label ?? e.asset_id}<small className="faint">{e.path}</small></span><small className="world-result-state">{e.tombstoned ? `Archived · retired in ${e.retired_in_revision ?? "an earlier revision"}` : e.incarnation_id ?? "current"}</small></button></li>)}</ul>
    </section> : <ul className="mini-list world-tree" aria-label="Environments">
      {h.realm.children.map((env) => <li key={env.id} className="world-node" data-world-node={env.id}>
        <button className={`link-row${ui.focus === env.id ? " active" : ""}`} aria-current={ui.focus === env.id ? "true" : undefined} onClick={() => focusOn(env)}><span className="grow"><strong>{env.label}</strong> <small className="faint">environment</small></span><span className="count">{env.asset_ids.length}</span></button>
        <ul className="mini-list">{env.children.filter((c) => c.kind === "account").map((acc) => <li key={acc.id}><button className="link-row" onClick={() => focusOn(acc)}><span className="grow">Account {acc.label}</span><span className="count">{acc.asset_ids.length}</span></button></li>)}
          {env.children.filter((c) => c.kind === "district").map(district)}</ul>
      </li>)}
    </ul>}
  </div>;
}
