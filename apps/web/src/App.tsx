import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppStateProvider } from "./lib/state.tsx";
import { Api, ApiError, detectServer, loadFromServer, loadOfflineDemo, type Dataset } from "./lib/data.ts";
import { ActionsCtx, type ServerActions } from "./panels/EvidencePane.tsx";
import { applyRedesignFixture } from "../../../fixtures/redesign/offline.ts";
import { Shell } from "./shell/Shell.tsx";
import { BrandMark } from "./panels/TopBar.tsx";
import { eventSearchParams, type FindingDetailResult } from "./lib/investigation.ts";
import { loadFindingEvidence, loadBundleEvidence } from "./lib/evidence-loader.ts";
import { ConnectionCtx, deriveConnection, type Connection, type SyncState, type Transport } from "./lib/connection.ts";
import { caseDrafts } from "./lib/caseDrafts.ts";

/** Set at build time for the public static demo: never contact a backend, always use bundled fixtures. */
const STATIC_DEMO = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_DK_STATIC_DEMO === "1";



export function App() {
  const authorizationEpoch = useRef(0), authorizationRequests = useRef(new AbortController());
  const stream = useRef<EventSource | null>(null);
  const api = useMemo(() => new Api("", () => authorizationEpoch.current, () => authorizationRequests.current.signal), []);
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const serverMode = useRef(false), lastSync = useRef<string | null>(null);
  const transport = useRef<Transport>("connecting"), sync = useRef<SyncState>("synced"), reachable = useRef(true);
  const retryTimer = useRef<number | null>(null), reloadTimer = useRef<number | null>(null), retryDelay = useRef(1000);
  const request = useRef<{ sequence: number; controller: AbortController | null }>({ sequence: 0, controller: null });
  const currentData = useRef(data); currentData.current = data;
  const reload = useRef<() => Promise<void>>(async () => {});
  const [projectId, setProjectId] = useState<string | undefined>(() => new URLSearchParams(location.search).get("project") ?? undefined);
  const clearTimers = useCallback(() => { if (retryTimer.current) clearTimeout(retryTimer.current); if (reloadTimer.current) clearTimeout(reloadTimer.current); retryTimer.current = reloadTimer.current = null; }, []);
  const clearSensitive = useCallback(() => {
    authorizationEpoch.current++; authorizationRequests.current.abort(); authorizationRequests.current = new AbortController();
    stream.current?.close(); stream.current = null;
    request.current.sequence++; request.current.controller?.abort(); clearTimers();
    setData(null); currentData.current = null; setConnection(null); lastSync.current = null; serverMode.current = false;
    transport.current = "connecting"; sync.current = "synced";
    caseDrafts.clearAll();
  }, [clearTimers]);
  const publish = useCallback(() => setConnection({ state: deriveConnection(transport.current, sync.current, reachable.current), since: lastSync.current }), []);
  const load = useCallback(async () => {
    request.current.controller?.abort();
    const controller = new AbortController(), sequence = ++request.current.sequence; request.current.controller = controller;
    const current = () => !controller.signal.aborted && sequence === request.current.sequence;
    if (STATIC_DEMO) { setData(applyRedesignFixture(loadOfflineDemo(), new URLSearchParams(location.search).get("fixture"))); return; }
    try {
      const me = await detectServer(api, controller.signal);
      if (!current()) return;
      if (!me) throw new Error("The project server is unavailable. No synthetic data has been substituted.");
      if (me.role === "none") { clearSensitive(); setNeedsLogin(true); return; }
      const d = await loadFromServer(api, projectId, controller.signal);
      if (!current()) return;
      d.identity = me.kind === "anonymous-demo" ? "anonymous demo" : me.name;
      if (me.kind === "anonymous-demo") d.role = "none";
      const prior = currentData.current;
      if (prior && (prior.role !== d.role || prior.identity !== d.identity)) {
        authorizationEpoch.current++; authorizationRequests.current.abort(); authorizationRequests.current = new AbortController();
        stream.current?.close(); stream.current = null;
      }

      serverMode.current = true; lastSync.current = new Date().toISOString();
      setData(d); setError(null); setNeedsLogin(false);
      sync.current = "synced"; reachable.current = true; retryDelay.current = 1000;
      if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
      if (transport.current !== "connecting") publish();
    } catch (e) {
      if (!current()) return;
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        clearSensitive(); if (e.status === 401) setNeedsLogin(true); else setError("This project is not available to your current role. Cached project data has been cleared.");
      } else if (serverMode.current) {
        sync.current = "failed"; reachable.current = e instanceof ApiError || transport.current === "open"; publish();
        if (transport.current === "open" && !retryTimer.current) {
          retryTimer.current = window.setTimeout(() => { retryTimer.current = null; void reload.current(); }, retryDelay.current);
          retryDelay.current = Math.min(retryDelay.current * 2, 10_000);
        }
      } else setError(`Unable to load the project server: ${(e as Error).message}. No synthetic data has been substituted.`);
    }
  }, [api, projectId, publish, clearSensitive]);
  reload.current = load;
  useEffect(() => { void load(); return () => { request.current.controller?.abort(); clearTimers(); }; }, [load, clearTimers]);
  useEffect(() => {
    const deny = (event: Event) => {
      const detail = (event as CustomEvent<{ status: number; path?: string; scope: number }>).detail;
      // Scopes survive the null-data loading window and distinguish re-login to the same project.
      if (detail?.scope !== authorizationEpoch.current) return;
      clearSensitive(); if (detail?.status === 401) setNeedsLogin(true); else setError("Access denied. Sensitive records and outstanding queries have been cleared.");
    };
    addEventListener("dk:access-denied", deny); return () => removeEventListener("dk:access-denied", deny);
  }, [clearSensitive]);
  useEffect(() => {
    const onHistory = () => { const id = new URLSearchParams(location.search).get("project") ?? undefined; if (id !== projectId) { clearSensitive(); setProjectId(id); } };
    addEventListener("popstate", onHistory); return () => removeEventListener("popstate", onHistory);
  }, [projectId, clearSensitive]);
  useEffect(() => {
    if (!data || data.mode !== "server") return;
    const es = new EventSource(`/api/projects/${encodeURIComponent(data.project.id)}/stream?cursor=${data.cursor}`);
    stream.current = es;
    let active = true; const scope = authorizationEpoch.current;
    const isActive = () => active && scope === authorizationEpoch.current;
    const schedule = () => { if (!isActive() || reloadTimer.current) return; reloadTimer.current = window.setTimeout(() => { reloadTimer.current = null; void reload.current(); }, 1200); };
    es.addEventListener("hello", () => {
      if (!isActive()) return;
      const resume = transport.current === "down" || sync.current !== "synced";
      transport.current = "open"; reachable.current = true;
      if (resume) { sync.current = "syncing"; if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; } void reload.current(); }
      publish();
    });
    for (const t of ["event", "finding", "graph", "scene", "containment", "resync"]) es.addEventListener(t, schedule);
    es.onerror = () => { if (!isActive()) return; transport.current = "down"; if (sync.current === "synced") sync.current = "syncing"; publish(); schedule(); };
    return () => { active = false; es.close(); if (stream.current === es) stream.current = null; transport.current = "connecting"; clearTimers(); };
  }, [data?.project.id, data?.mode, data?.role, data?.identity, publish, clearTimers]);
  const actions = useMemo<ServerActions | null>(() => {
    if (data?.mode !== "server") return null;
    const epoch = authorizationEpoch.current;
    const project = data.project.id, prefix = `/api/projects/${encodeURIComponent(project)}`;
    const check = () => { if (epoch !== authorizationEpoch.current || currentData.current?.project.id !== project) throw new Error("Authorization or project changed; operation discarded."); };
    return {
      role: data.role,
      importInventory: async (input) => {
        check();
        const query = new URLSearchParams({ format: input.format, revision: input.revision, environment: input.environment });
        const result = await api.sendText<{ graph_revision: string; scene_digest: string; reflow_zones: string[]; warnings: string[]; unresolved: string[] }>("POST", `${prefix}/graph?${query}`, input.text);
        check(); await reload.current(); return result;
      },
      setDisposition: async (id, body) => { check(); await api.send("POST", `${prefix}/findings/${encodeURIComponent(id)}/disposition`, body); check(); await reload.current(); },
      exportCase: async (id) => {
        check(); const bundle = await api.send("POST", `${prefix}/cases/${encodeURIComponent(id)}/export`); check();
        const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
        const a = document.createElement("a"); a.href = url; a.download = `digital-kingdom-case-${id}.json`; a.click(); URL.revokeObjectURL(url);
      },
      containment: (signal) => { check(); return api.get(`${prefix}/containment`, signal); },
      requestContainment: async (findingId, actionId, rationale) => { check(); await api.send("POST", `${prefix}/containment`, { finding_id: findingId, action_id: actionId, rationale }); },
      findingEvidence: (id, signal) => { check(); return loadFindingEvidence(api, project, id, signal); },
      findingDetail: (id, signal) => { check(); return api.get<FindingDetailResult>(`${prefix}/findings/${encodeURIComponent(id)}`, signal); },
      eventDetail: (id, signal) => { check(); return api.get(`${prefix}/events/${encodeURIComponent(id)}`, signal); },
      coverageHistory: (q, signal) => { check(); return api.get(`${prefix}/coverage/history?${new URLSearchParams(q as Record<string, string>)}`, signal); },
      controls: (signal) => { check(); return api.get(`${prefix}/controls`, signal); },
      control: async (id) => { check(); return api.get(`${prefix}/controls/${encodeURIComponent(id)}`); },
      githubPreview: async (owner, repo) => { check(); return api.send("POST", `${prefix}/discovery/github/preview`, { owner, repo }); },
      githubApply: async (previewId, expected) => { check(); await api.send("POST", `${prefix}/discovery/github/apply`, { preview_id: previewId, expected_graph_revision: expected }); check(); await reload.current(); },
      recipes: (signal) => { check(); return api.get(`/api/recipes`, signal); },
      runRecipe: async (recipeId, findingId, attach) => { check(); return api.send("POST", `${prefix}/recipes/${encodeURIComponent(recipeId)}/run`, { finding_id: findingId, ...(attach ? { case_id: attach.caseId, expected_version: attach.expectedVersion } : {}) }); },
      connectors: (signal) => { check(); return api.get(`/api/connectors`, signal); },
      notifications: (signal) => { check(); return api.get(`${prefix}/notifications/status`, signal); },
      acknowledgeNotification: async (id) => { check(); return api.send("POST", `${prefix}/notifications/${encodeURIComponent(id)}/ack`); },
      localWorldPreview: async (input) => { check(); return api.send("POST", `/api/local-world/preview`, input); },
      localWorldReporting: (signal) => { check(); return api.get(`${prefix}/local-world/reporting`, signal); },
      listCases: (signal) => { check(); return api.get(`${prefix}/cases`, signal); },
      getCase: (id, signal) => { check(); return api.get(`${prefix}/cases/${encodeURIComponent(id)}`, signal); },
      createCase: async (body) => { check(); return api.send("POST", `${prefix}/cases`, body); },
      caseWorkbench: (id, signal) => { check(); return api.get(`${prefix}/cases/${encodeURIComponent(id)}/workbench`, signal); },
      analysisPaths: (q, signal) => { check(); return api.get(`${prefix}/analysis/paths?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "") as [string, string][])}`, signal); },
      attention: (signal) => { check(); return api.get(`${prefix}/attention`, signal); },
      acknowledgeAttention: async (id, expectedSeq) => { check(); return api.send("POST", `${prefix}/attention/${encodeURIComponent(id)}/ack`, { expected_seq: expectedSeq }); },
      openContract: async (id) => { check(); return api.send("POST", `${prefix}/cases/${encodeURIComponent(id)}/contract`, {}); },
      caseAction: async (id, path, body) => { check(); return api.send("POST", `${prefix}/cases/${encodeURIComponent(id)}${path}`, body); },
      exportDurableCase: async (id) => {
        check(); const bundle = await api.send("POST", `${prefix}/cases/${encodeURIComponent(id)}/export`); check();
        const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
        const a = document.createElement("a"); a.href = url; a.download = `digital-kingdom-${id}.json`; a.click(); URL.revokeObjectURL(url);
      },
      bundleEvidence: (bundle, signal) => { check(); return loadBundleEvidence(api, project, bundle, signal); },
      createBundle: async (findingId, revision) => { check(); return api.send("POST", `${prefix}/findings/${encodeURIComponent(findingId)}/bundles`, revision ? { revision } : {}); },
      searchEvents: (input, signal) => { check(); return api.get(`${prefix}/events/search?${eventSearchParams(input)}`, signal); },
    };
  }, [data?.project.id, data?.mode, data?.role, data?.identity, api]);
  if (needsLogin) return <Login api={api} onDone={() => { setNeedsLogin(false); void load(); }} />;
  if (error) return <div className="fullscreen-msg" role="alert"><span className="brand-mark"><BrandMark size={18} /></span><h1>Digital Kingdom</h1><p>{error}</p><button className="btn" onClick={() => { setError(null); void load(); }}>Retry server</button><button className="btn" onClick={() => { clearSensitive(); setError(null); setNeedsLogin(false); setData(loadOfflineDemo()); }}>Open explicitly synthetic offline demo</button></div>;
  if (!data) return <div className="fullscreen-msg" aria-busy="true"><div className="spinner" aria-hidden /><p className="small">Loading evidence…</p></div>;
  return <ConnectionCtx.Provider value={connection}><ActionsCtx.Provider value={actions}><AppStateProvider key={`${data.project.id}:${data.role}:${authorizationEpoch.current}`} data={data}>
    <Shell connection={connection} onSignIn={() => { clearSensitive(); setNeedsLogin(true); }}
      onSignOut={async () => { clearSensitive(); setNeedsLogin(false); const sequence = request.current.sequence; try { const r = await fetch("/api/session", { method: "DELETE", credentials: "same-origin", headers: { "x-dk-request": "1" } }); if (!r.ok) throw new Error("Server did not confirm sign-out."); if (sequence === request.current.sequence) setNeedsLogin(true); } catch { if (sequence === request.current.sequence) setError("Local sensitive data was cleared, but server sign-out could not be confirmed. Retry when connected."); } }}
      onProject={id => { clearSensitive(); setError(null); setNeedsLogin(false); setProjectId(id); history.pushState(null, "", `?project=${encodeURIComponent(id)}`); }} />
  </AppStateProvider></ActionsCtx.Provider></ConnectionCtx.Provider>;
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
