import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppStateProvider, useApp } from "./lib/state.tsx";
import { Api, ApiError, detectServer, loadFromServer, loadOfflineDemo, type Dataset } from "./lib/data.ts";
import { TopBar } from "./panels/TopBar.tsx";
import { Sidebar } from "./panels/Sidebar.tsx";
import { EvidencePane, ActionsCtx, type ServerActions } from "./panels/EvidencePane.tsx";
import { Timeline } from "./panels/Timeline.tsx";
import { Legend } from "./panels/Legend.tsx";
import { Graph2D } from "./graph2d/Graph2D.tsx";
import { webglAvailable } from "./lib/webgl.ts";
import { Icon } from "./lib/icons.tsx";
import { BrandMark } from "./panels/TopBar.tsx";
import { fmtTime } from "./lib/vocab.ts";
import { ConnectionCtx, CONNECTION_BANNER, deriveConnection, type Connection, type SyncState, type Transport } from "./lib/connection.ts";

/** Set at build time for the public static demo: never contact a backend, always use bundled fixtures. */
const STATIC_DEMO = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DK_STATIC_DEMO === "1";

const Castle3D = lazy(() => import("./castle/Castle3D.tsx").then((m) => ({ default: m.Castle3D })));

export function App() {
  const api = useMemo(() => new Api(""), []);
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  // once a server session is established we never silently swap in the offline synthetic demo
  const serverMode = useRef(false);
  const lastSync = useRef<string | null>(null);
  // SSE transport and snapshot synchronization are tracked separately; see lib/connection.ts
  const transport = useRef<Transport>("connecting");
  const sync = useRef<SyncState>("synced");
  const reachable = useRef(true);
  const retryTimer = useRef<number | null>(null);
  const retryDelay = useRef(1000);
  const publish = useCallback(() => setConnection({ state: deriveConnection(transport.current, sync.current, reachable.current), since: lastSync.current }), []);
  const [projectId, setProjectId] = useState<string | undefined>(() => new URLSearchParams(location.search).get("project") ?? undefined);
  const reloadTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (STATIC_DEMO) { setData(loadOfflineDemo()); return; }
    const me = await detectServer(api);
    if (!me) {
      if (serverMode.current) { syncFailed(false); return; } // keep the last data, flagged stale
      setData(loadOfflineDemo()); return;
    }
    if (me.role === "none") { setNeedsLogin(true); return; }
    try {
      const d = await loadFromServer(api, projectId);
      d.identity = me.kind === "anonymous-demo" ? "anonymous demo" : me.name;
      if (me.kind === "anonymous-demo") d.role = "none";
      serverMode.current = true; lastSync.current = new Date().toISOString();
      setData(d); setError(null); setNeedsLogin(false);
      // only a successfully applied snapshot clears staleness
      sync.current = "synced"; reachable.current = true; retryDelay.current = 1000;
      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
      if (transport.current !== "connecting") publish();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setNeedsLogin(true);
      else if (serverMode.current) syncFailed(true);
      else setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, projectId]);

  // a failed snapshot never yields "live"; while the stream stays open we retry with bounded backoff
  // (when the stream is down, its reconnect triggers the catch-up instead)
  function syncFailed(serverAnswered: boolean) {
    sync.current = "failed"; reachable.current = serverAnswered || transport.current === "open";
    publish();
    if (transport.current === "open" && !retryTimer.current) {
      retryTimer.current = window.setTimeout(() => { retryTimer.current = null; void load(); }, retryDelay.current);
      retryDelay.current = Math.min(retryDelay.current * 2, 10_000);
    }
  }

  useEffect(() => { void load(); }, [load]);

  // resumable live updates: debounce into a bounded snapshot refetch (geometry is not rebuilt per event)
  useEffect(() => {
    if (!data || data.mode !== "server") return;
    const es = new EventSource(`/api/projects/${encodeURIComponent(data.project.id)}/stream?cursor=${data.cursor}`);
    const schedule = () => { if (reloadTimer.current) return; reloadTimer.current = window.setTimeout(() => { reloadTimer.current = null; void load(); }, 1200); };
    // hello = transport connected. After any interruption the view stays stale ("Synchronizing") until the
    // catch-up snapshot has actually been applied by load().
    es.addEventListener("hello", () => {
      const resume = transport.current === "down" || sync.current !== "synced";
      transport.current = "open"; reachable.current = true;
      if (resume) { sync.current = "syncing"; if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; } void load(); }
      publish();
    });
    for (const t of ["event", "finding", "graph", "scene", "containment", "resync"]) es.addEventListener(t, schedule);
    es.onerror = () => { transport.current = "down"; if (sync.current === "synced") sync.current = "syncing"; publish(); };
    return () => { es.close(); transport.current = "connecting"; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.project.id, data?.mode]);

  const actions: ServerActions | null = data?.mode === "server" ? {
    role: data.role,
    setDisposition: async (id, body) => { await api.send("POST", `/api/projects/${data.project.id}/findings/${id}/disposition`, body); await load(); },
    exportCase: async (id) => {
      const bundle = await api.send("POST", `/api/projects/${data.project.id}/cases/${id}/export`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = `digital-kingdom-case-${id}.json`; a.click(); URL.revokeObjectURL(url);
    },
    containment: () => api.get(`/api/projects/${data.project.id}/containment`),
    requestContainment: async (findingId, actionId, rationale) => { await api.send("POST", `/api/projects/${data.project.id}/containment`, { finding_id: findingId, action_id: actionId, rationale }); },
    findingEvidence: async (id) => {
      type Page = { expected_event_count: number; events: Dataset["events"]; evidence: Dataset["evidence"]; missing_event_ids: string[]; missing_evidence_refs: string[]; next_offset: number | null };
      const events: Dataset["events"] = []; const evidence: Dataset["evidence"] = {}; const missingEvents: string[] = []; const missingEvidence: string[] = [];
      let offset: number | null = 0, expected = 0;
      while (offset !== null && events.length < 5000) {
        const p: Page = await api.get<Page>(`/api/projects/${data.project.id}/findings/${encodeURIComponent(id)}/evidence?offset=${offset}&limit=500`);
        expected = p.expected_event_count; events.push(...p.events); Object.assign(evidence, p.evidence); missingEvents.push(...p.missing_event_ids); missingEvidence.push(...p.missing_evidence_refs); offset = p.next_offset;
      }
      Object.assign(data.evidence, evidence);
      return { events, evidence, expected, missingEvents, missingEvidence, complete: offset === null && !missingEvents.length && !missingEvidence.length };
    },
  } : null;

  if (needsLogin) return <Login api={api} onDone={() => { setNeedsLogin(false); void load(); }} />;
  if (error) return <div className="fullscreen-msg" role="alert"><span className="brand-mark" style={{ width: 32, height: 32 }}><BrandMark size={18} /></span><h1>Digital Kingdom</h1><p>{error}</p><button className="btn" onClick={() => void load()}>Retry</button></div>;
  if (!data) return <div className="fullscreen-msg" aria-busy="true"><div className="spinner" aria-hidden /><p className="small">Loading evidence…</p></div>;

  return (
    <ConnectionCtx.Provider value={connection}>
    <ActionsCtx.Provider value={actions}>
      <AppStateProvider key={data.project.id} data={data}>
        <Shell connection={connection}
          onSignIn={() => setNeedsLogin(true)}
          onSignOut={async () => { await fetch("/api/session", { method: "DELETE" }); void load(); }}
          onProject={(id) => { setProjectId(id); history.replaceState(null, "", `?project=${encodeURIComponent(id)}`); }} />
      </AppStateProvider>
    </ActionsCtx.Provider>
    </ConnectionCtx.Provider>
  );
}

function Shell(props: { connection: Connection | null; onSignIn: () => void; onSignOut: () => void; onProject: (id: string) => void }) {
  const { ui, dispatch, vm } = useApp();
  useEffect(() => { const r = webglAvailable(); if (r) dispatch({ type: "webglFailed", reason: r }); }, [dispatch]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Escape") dispatch({ type: "select", selection: null });
      if (e.key === "2") dispatch({ type: "view", view: "graph" });
      if (e.key === "3" && !ui.webglFailed) dispatch({ type: "view", view: "castle" });
      if (e.key === " " && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); dispatch({ type: "playing", playing: !ui.playing }); }
      if (e.key === "r") dispatch({ type: "roofs", roofs: !ui.roofs });
      if (e.key === "[") dispatch({ type: "panel", panel: "sidebar", open: !ui.sidebar });
      if (e.key === "]") dispatch({ type: "panel", panel: "inspector", open: !ui.inspector });
      if (e.key === "/") { e.preventDefault(); document.querySelector<HTMLInputElement>(".search")?.focus(); }
    };
    addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey);
  }, [dispatch, ui.playing, ui.roofs, ui.webglFailed, ui.sidebar, ui.inspector]);
  return (
    <div className={`app${ui.selection ? " has-selection" : ""}${ui.sidebar ? "" : " no-side"}${ui.inspector ? "" : " no-pane"}`}>
      <a href="#main" className="skip">Skip to map</a>
      <TopBar connection={props.connection} onSignIn={props.onSignIn} onSignOut={props.onSignOut} onProject={props.onProject} />
      <Sidebar />
      <main id="main" className="stage">
        {ui.webglFailed && ui.view === "graph" && <div className="banner" role="status"><Icon name="alert" size={15} />{ui.webglFailed} The 2D graph and timeline show the same evidence.</div>}
        {ui.view === "castle" && !ui.webglFailed ? <Suspense fallback={<div className="stage-loading"><div className="spinner" aria-hidden /></div>}><Castle3D /></Suspense> : <Graph2D />}
        {props.connection && props.connection.state !== "live" && (
          <div className="banner warn" role="alert" data-testid="connection-banner">
            <Icon name="alert" size={15} />
            {CONNECTION_BANNER[props.connection.state]} Showing data as of {props.connection.since ? fmtTime(props.connection.since) : "the last sync"}. This is not live monitoring.
          </div>
        )}
        {!vm.isLatest && <div className="stage-title"><span className="replay-tag"><span className="pip" aria-hidden />Replay · {fmtTime(vm.at)}</span></div>}
        <Legend />
      </main>
      <EvidencePane />
      <Timeline />
      <div className="sr-only" aria-live="polite">{ui.announce}</div>
    </div>
  );
}

function Login({ api, onDone }: { api: Api; onDone: () => void }) {
  const [token, setToken] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="fullscreen-msg">
      <form className="login" aria-labelledby="login-title" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await api.send("POST", "/api/session", { token }); onDone(); } catch (x) { setErr((x as Error).message); } }}>
        <div className="login-head"><span className="brand-mark" style={{ width: 28, height: 28 }}><BrandMark size={16} /></span><h1 id="login-title" style={{ fontSize: 16 }}>Digital Kingdom</h1></div>
        <p className="muted">Sign in with an API token issued by your administrator. The token is exchanged for an HttpOnly session cookie and never stored in the browser.</p>
        <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="dku_…" aria-label="API token" autoFocus />
        <button className="btn primary" type="submit" disabled={!token}>Sign in</button>
        {err && <p className="error" role="alert">{err}</p>}
      </form>
    </div>
  );
}
