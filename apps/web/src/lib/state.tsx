import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type { CoverageRecord, Finding, OutcomeState, SecurityEvent } from "@dk/contracts";
import { stateAt, type ReplayBasis } from "@dk/detections";
import type { Dataset } from "./data.ts";
import type { Layer } from "./vocab.ts";

export type Selection = { kind: "asset" | "finding" | "path" | "event"; id: string } | null;
export type View = "castle" | "graph";

export interface UiState {
  view: View;
  selection: Selection;
  hover: string | null;
  playhead: string | null; // null = latest
  playing: boolean;
  speed: number;
  basis: ReplayBasis;
  roofs: boolean;
  layers: Record<Layer, boolean>;
  showHypothetical: boolean;
  reducedMotion: boolean;
  query: string;
  tab: "findings" | "assets" | "coverage";
  webglFailed: string | null;
  announce: string;
  /** Left list and right inspector visibility (app shell). */
  sidebar: boolean;
  inspector: boolean;
}

export type Action =
  | { type: "view"; view: View }
  | { type: "select"; selection: Selection; announce?: string }
  | { type: "hover"; id: string | null }
  | { type: "playhead"; at: string | null }
  | { type: "playing"; playing: boolean }
  | { type: "speed"; speed: number }
  | { type: "basis"; basis: ReplayBasis }
  | { type: "roofs"; roofs: boolean }
  | { type: "layer"; layer: Layer; on: boolean }
  | { type: "hypothetical"; on: boolean }
  | { type: "reducedMotion"; on: boolean }
  | { type: "query"; query: string }
  | { type: "tab"; tab: UiState["tab"] }
  | { type: "webglFailed"; reason: string }
  | { type: "panel"; panel: "sidebar" | "inspector"; open: boolean };

function reducer(s: UiState, a: Action): UiState {
  switch (a.type) {
    case "view": return { ...s, view: a.view };
    case "select": return { ...s, selection: a.selection, announce: a.announce ?? s.announce, inspector: a.selection ? true : s.inspector };
    case "hover": return s.hover === a.id ? s : { ...s, hover: a.id };
    case "playhead": return { ...s, playhead: a.at };
    case "playing": return { ...s, playing: a.playing };
    case "speed": return { ...s, speed: a.speed };
    case "basis": return { ...s, basis: a.basis };
    case "roofs": return { ...s, roofs: a.roofs };
    case "layer": return { ...s, layers: { ...s.layers, [a.layer]: a.on } };
    case "hypothetical": return { ...s, showHypothetical: a.on };
    case "reducedMotion": return { ...s, reducedMotion: a.on };
    case "query": return { ...s, query: a.query };
    case "tab": return { ...s, tab: a.tab };
    case "webglFailed": return { ...s, webglFailed: a.reason, view: "graph" };
    case "panel": return { ...s, [a.panel]: a.open };
  }
}

const SEVERITY_ORDER: OutcomeState[] = ["observed_effect", "needs_review", "attempted", "unknown", "blocked", "refused", "allowed"];
export const worstOutcome = (xs: OutcomeState[]): OutcomeState | null => SEVERITY_ORDER.find((o) => xs.includes(o)) ?? null;

export interface AssetStatus {
  worst: OutcomeState | null;
  findingIds: string[];
  coverage: "reporting" | "gap" | "unobserved";
  coverageNote?: string;
  recentEventIds: string[];
}

export interface ViewModel {
  data: Dataset;
  findings: Finding[];
  coverage: CoverageRecord[];
  unobserved: string[];
  events: SecurityEvent[];
  lateEventIds: Set<string>;
  assetStatus: Map<string, AssetStatus>;
  at: string;
  isLatest: boolean;
}

function readHash(): Partial<UiState> {
  const p = new URLSearchParams(location.hash.slice(1));
  const out: Partial<UiState> = {};
  const view = p.get("view"); if (view === "graph" || view === "castle") out.view = view;
  const sel = p.get("sel"); if (sel && /^(asset|finding|path|event):.+/.test(sel)) { const i = sel.indexOf(":"); out.selection = { kind: sel.slice(0, i) as NonNullable<Selection>["kind"], id: sel.slice(i + 1) }; }
  const t = p.get("t"); if (t && !Number.isNaN(Date.parse(t))) out.playhead = new Date(t).toISOString();
  const basis = p.get("basis"); if (basis === "known" || basis === "occurred") out.basis = basis;
  return out;
}

const Ctx = createContext<{ ui: UiState; dispatch: Dispatch<Action>; vm: ViewModel } | null>(null);

export function AppStateProvider({ data, children }: { data: Dataset; children: ReactNode }) {
  const prefersReduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wide = typeof matchMedia !== "undefined" && matchMedia("(min-width: 1360px)").matches;
  const narrow = typeof matchMedia !== "undefined" && matchMedia("(max-width: 820px)").matches;
  const [ui, dispatch] = useReducer(reducer, undefined, () => { const fromHash = readHash(); return {
    view: "castle", selection: null, hover: null, playhead: null, playing: false, speed: 30, basis: "occurred",
    roofs: true, layers: { runtime: true, identity: false, deployment: false, tools: true }, showHypothetical: false,
    reducedMotion: prefersReduced, query: "", tab: "findings", webglFailed: null, announce: "",
    sidebar: !narrow, inspector: wide || !!fromHash.selection,
    ...fromHash,
  } satisfies UiState; });

  // deep links: the same asset/finding/time view can be shared (authorization still applies on load)
  useEffect(() => {
    const p = new URLSearchParams();
    if (ui.view !== "castle") p.set("view", ui.view);
    if (ui.selection) p.set("sel", `${ui.selection.kind}:${ui.selection.id}`);
    if (ui.playhead) { p.set("t", ui.playhead); if (ui.basis !== "occurred") p.set("basis", ui.basis); }
    const next = p.toString();
    if (location.hash.slice(1) !== next) history.replaceState(null, "", next ? `#${next}` : location.pathname + location.search);
  }, [ui.view, ui.selection, ui.playhead, ui.basis]);

  const vm = useMemo<ViewModel>(() => {
    const isLatest = ui.playhead === null;
    const at = ui.playhead ?? data.window.end;
    let findings = data.findings, coverage = data.coverage, unobserved = data.unobserved_asset_ids, events = data.events;
    let late = new Set<string>();
    if (!isLatest) {
      const s = stateAt(data.graph, data.events, at, ui.basis, { sources: data.sources });
      // keep analyst lifecycle/disposition from the server's view when the finding exists there
      const server = new Map(data.findings.map((f) => [f.id, f]));
      findings = s.findings.map((f) => { const sv = server.get(f.id); return sv ? { ...f, lifecycle: sv.lifecycle, disposition: sv.disposition } : f; });
      coverage = s.coverage; unobserved = s.unobserved_asset_ids; events = s.events; late = new Set(s.late_event_ids);
    } else {
      for (const e of events) if (Date.parse(e.received_at) - Date.parse(e.occurred_at) > 60_000) late.add(e.id);
    }
    const status = new Map<string, AssetStatus>();
    for (const a of data.graph.assets) status.set(a.id, { worst: null, findingIds: [], coverage: unobserved.includes(a.id) ? "unobserved" : "reporting", recentEventIds: [] });
    for (const c of coverage) if (c.state !== "healthy") for (const id of c.asset_ids) {
      const st = status.get(id); if (!st) continue;
      const others = coverage.filter((x) => x !== c && x.state === "healthy" && x.asset_ids.includes(id));
      // an asset is a gap when every source covering it is not reporting
      if (!others.length) { st.coverage = "gap"; st.coverageNote = c.note ?? c.label; }
    }
    for (const f of findings) {
      if (f.lifecycle === "closed") continue;
      for (const id of f.affected_asset_ids) { const st = status.get(id); if (!st) continue; st.findingIds.push(f.id); }
    }
    for (const [id, st] of status) st.worst = worstOutcome(findings.filter((f) => st.findingIds.includes(f.id)).map((f) => f.outcome_state));
    const tMs = Date.parse(at);
    for (const e of events) if (tMs - Date.parse(e.occurred_at) <= 45_000 && tMs >= Date.parse(e.occurred_at)) for (const id of e.asset_ids) status.get(id)?.recentEventIds.push(e.id);
    return { data, findings, coverage, unobserved, events, lateEventIds: late, assetStatus: status, at, isLatest };
  }, [data, ui.playhead, ui.basis]);

  // playback clock
  useEffect(() => {
    if (!ui.playing) return;
    const start = Date.parse(data.window.start), end = Date.parse(data.window.end);
    let cur = ui.playhead ? Date.parse(ui.playhead) : start;
    if (cur >= end) cur = start;
    let last = performance.now();
    // ~8 updates/s: geometry never rebuilds per event; only overlays and markers change
    const id = setInterval(() => {
      const now = performance.now(); const dt = now - last; last = now;
      cur = Math.min(end, cur + dt * ui.speed);
      if (cur >= end) { dispatch({ type: "playing", playing: false }); dispatch({ type: "playhead", at: null }); return; }
      dispatch({ type: "playhead", at: new Date(Math.round(cur / 1000) * 1000).toISOString() });
    }, 125);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.playing, ui.speed, data.window.start, data.window.end]);

  return <Ctx.Provider value={{ ui, dispatch, vm }}>{children}</Ctx.Provider>;
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}
