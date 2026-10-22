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

const Castle3D = lazy(() => import("./castle/Castle3D.tsx").then((m) => ({ default: m.Castle3D })));

export function App() {
  const api = useMemo(() => new Api(""), []);
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [connection, setConnection] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | undefined>(() => new URLSearchParams(location.search).get("project") ?? undefined);
  const reloadTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    const me = await detectServer(api);
    if (!me) { setData(loadOfflineDemo()); return; }
    if (me.role === "none") { setNeedsLogin(true); return; }
    try {
      const d = await loadFromServer(api, projectId);
      d.identity = me.kind === "anonymous-demo" ? "anonymous demo" : me.name;
      if (me.kind === "anonymous-demo") d.role = "none";
      setData(d); setError(null); setNeedsLogin(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setNeedsLogin(true); else setError((e as Error).message);
    }
  }, [api, projectId]);

  useEffect(() => { void load(); }, [load]);

  // resumable live updates: debounce into a bounded snapshot refetch (geometry is not rebuilt per event)
  useEffect(() => {
    if (!data || data.mode !== "server") return;
    const es = new EventSource(`/api/projects/${encodeURIComponent(data.project.id)}/stream?cursor=${data.cursor}`);
    const schedule = () => { if (reloadTimer.current) return; reloadTimer.current = window.setTimeout(() => { reloadTimer.current = null; void load(); }, 1200); };
    es.addEventListener("hello", () => setConnection("live"));
    for (const t of ["event", "finding", "graph", "scene", "containment", "resync"]) es.addEventListener(t, schedule);
    es.onerror = () => setConnection("reconnecting");
    es.onopen = () => setConnection("live");
    return () => es.close();
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
  } : null;

  if (needsLogin) return <Login api={api} onDone={() => { setNeedsLogin(false); void load(); }} />;
  if (error) return <div className="fullscreen-msg"><h1>Digital Kingdom</h1><p>{error}</p><button className="btn" onClick={() => void load()}>Retry</button></div>;
  if (!data) return <div className="fullscreen-msg"><div className="spinner" aria-hidden /><p>Loading evidence…</p></div>;

  return (
    <ActionsCtx.Provider value={actions}>
      <AppStateProvider key={data.project.id} data={data}>
        <Shell connection={connection}
          onSignIn={() => setNeedsLogin(true)}
          onSignOut={async () => { await fetch("/api/session", { method: "DELETE" }); void load(); }}
          onProject={(id) => { setProjectId(id); history.replaceState(null, "", `?project=${encodeURIComponent(id)}`); }} />
      </AppStateProvider>
    </ActionsCtx.Provider>
  );
}

function Shell(props: { connection: string | null; onSignIn: () => void; onSignOut: () => void; onProject: (id: string) => void }) {
  const { ui, dispatch } = useApp();
  useEffect(() => { const r = webglAvailable(); if (r) dispatch({ type: "webglFailed", reason: r }); }, [dispatch]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "Escape") dispatch({ type: "select", selection: null });
      if (e.key === "2") dispatch({ type: "view", view: "graph" });
      if (e.key === "3" && !ui.webglFailed) dispatch({ type: "view", view: "castle" });
      if (e.key === " " && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); dispatch({ type: "playing", playing: !ui.playing }); }
      if (e.key === "r") dispatch({ type: "roofs", roofs: !ui.roofs });
      if (e.key === "/") { e.preventDefault(); document.querySelector<HTMLInputElement>(".search")?.focus(); }
    };
    addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey);
  }, [dispatch, ui.playing, ui.roofs, ui.webglFailed]);
  return (
    <div className={`app${ui.selection ? " has-selection" : ""}`}>
      <a href="#main" className="skip">Skip to map</a>
      <TopBar connection={props.connection} onSignIn={props.onSignIn} onSignOut={props.onSignOut} onProject={props.onProject} />
      <Sidebar />
      <main id="main" className="stage">
        {ui.webglFailed && ui.view === "graph" && <div className="banner">{ui.webglFailed} The 2D graph and timeline show the same evidence.</div>}
        {ui.view === "castle" && !ui.webglFailed ? <Suspense fallback={<div className="stage-loading">Raising the castle…</div>}><Castle3D /></Suspense> : <Graph2D />}
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
      <form className="login" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await api.send("POST", "/api/session", { token }); onDone(); } catch (x) { setErr((x as Error).message); } }}>
        <h1>Digital Kingdom</h1>
        <p className="muted">Sign in with an API token issued by your administrator. The token is exchanged for an HttpOnly session cookie and never stored in the browser.</p>
        <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="dku_…" aria-label="API token" autoFocus />
        <button className="btn primary" type="submit" disabled={!token}>Sign in</button>
        {err && <p className="error" role="alert">{err}</p>}
      </form>
    </div>
  );
}
