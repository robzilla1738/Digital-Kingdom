import type { CompiledScene, CoverageRecord, Finding, Graph, SecurityEvent } from "@dk/contracts";
import { compileScene, defaultProposal } from "@dk/scene-compiler";
import { evaluate, processDeliveries, type Delivery, type PipelineStats, type SourceConfig } from "@dk/detections";
import demoGraph from "../../../../fixtures/demo/graph.json";
import demoSources from "../../../../fixtures/demo/sources.json";
import demoDeliveries from "../../../../fixtures/demo/deliveries.json";
import demoMeta from "../../../../fixtures/demo/meta.json";

export interface Dataset {
  mode: "offline-demo" | "server";
  project: { id: string; name: string; dataset_kind: "synthetic" | "live"; description?: string };
  projects: { id: string; name: string; dataset_kind: string }[];
  graph: Graph;
  scene: CompiledScene;
  sources: (SourceConfig & { disabled?: boolean })[];
  events: SecurityEvent[];
  evidence: Record<string, Record<string, unknown>>;
  findings: Finding[];
  coverage: CoverageRecord[];
  unobserved_asset_ids: string[];
  stats?: PipelineStats;
  role: "viewer" | "analyst" | "admin" | "none";
  identity?: string;
  cursor: number;
  window: { start: string; end: string };
  planner_available: boolean;
  /** Current coverage snapshot time; not historical interval coverage. */
  coverage_as_of?: string;
}

/** The offline demo runs the exact same engine in the browser: normalize -> dedupe -> evaluate -> compile. */
export function loadOfflineDemo(): Dataset {
  const graph = demoGraph as unknown as Graph;
  const sources = demoSources as SourceConfig[];
  const { events, evidence, stats } = processDeliveries(graph, sources, demoDeliveries as Delivery[]);
  const ev = evaluate(graph, events, { sources });
  const scene = compileScene(graph, defaultProposal(graph, 1));
  return {
    mode: "offline-demo",
    project: { id: graph.project_id, name: demoMeta.title, dataset_kind: "synthetic", description: demoMeta.description },
    projects: [{ id: graph.project_id, name: demoMeta.title, dataset_kind: "synthetic" }],
    graph, scene, sources, events, evidence, findings: ev.findings, coverage: ev.coverage, unobserved_asset_ids: ev.unobserved_asset_ids, stats,
    role: "none", cursor: 0, coverage_as_of: demoMeta.end, window: { start: demoMeta.start, end: demoMeta.end }, planner_available: false,
  };
}

export class Api {
  constructor(private readonly base = "", private readonly authorizationScope: () => number = () => 0, private readonly authorizationSignal: () => AbortSignal | undefined = () => undefined) {}
  private async response<T>(path: string, options: RequestInit): Promise<T> {
    const scope = this.authorizationScope(), scopeSignal = this.authorizationSignal();
    const signal = scopeSignal && options.signal ? AbortSignal.any([scopeSignal, options.signal]) : scopeSignal ?? options.signal;
    const response = await fetch(this.base + path, { ...options, signal, credentials: "same-origin" });
    if (!response.ok) {
      if (!signal?.aborted && (response.status === 401 || response.status === 403) && path !== "/api/me" && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("dk:access-denied", { detail: { status: response.status, path, scope } }));
      let message = response.statusText, issues: string[] | undefined;
      try { const body = await response.json(); if (typeof body.error === "string") message = body.error; const details = body.details ?? body.issues; if (Array.isArray(details)) issues = details.filter((issue: unknown): issue is string => typeof issue === "string"); } catch { /* Do not render an untrusted HTML error body. */ }
      throw new ApiError(response.status, message, issues);
    }
    return response.json() as Promise<T>;
  }
  get<T>(path: string, signal?: AbortSignal): Promise<T> { return this.response(path, { signal, headers: { accept: "application/json" } }); }
  send<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = { "x-dk-request": "1", accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    return this.response(path, { method, signal, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  sendText<T>(method: string, path: string, body: string, signal?: AbortSignal): Promise<T> { return this.response(path, { method, signal, headers: { "content-type": "application/yaml", "x-dk-request": "1", accept: "application/json" }, body }); }
}
export class ApiError extends Error { constructor(readonly status: number, message: string, readonly issues?: string[]) { super(message); } }

interface Snapshot {
  project: { id: string; name: string; dataset_kind: "synthetic" | "live"; meta?: { description?: string; start?: string; end?: string } };
  graph: Graph | null; scene: CompiledScene | null; sources: (SourceConfig & { disabled?: boolean })[]; events: SecurityEvent[];
  evidence: Record<string, Record<string, unknown>>; findings: Finding[]; coverage: CoverageRecord[]; unobserved_asset_ids: string[];
  cursor: number; server_time: string; role: Dataset["role"]; planner_available: boolean;
}

export async function detectServer(api: Api, signal?: AbortSignal): Promise<{ name: string; role: Dataset["role"]; kind: string } | null> {
  try { return await api.get("/api/me", signal); } catch (e) { if (e instanceof ApiError && e.status === 401) return { name: "", role: "none", kind: "unauthenticated" }; throw e; }
}

export async function loadFromServer(api: Api, projectId?: string, signal?: AbortSignal): Promise<Dataset> {
  const projects = await api.get<Dataset["projects"]>("/api/projects", signal);
  if (!projects.length) throw new ApiError(404, "No projects are visible to this account.");
  if (projectId && !projects.some(p => p.id === projectId)) throw new ApiError(403, "This project is not available to your current role.");
  const id = projectId ?? projects[0]!.id;
  const s = await api.get<Snapshot>(`/api/projects/${encodeURIComponent(id)}/snapshot`, signal);
  const graph: Graph = s.graph ?? { schema_version: "0.2", project_id: id, graph_revision: "not-imported", dataset_kind: s.project.dataset_kind, assets: [], relationships: [] };
  const scene = s.scene ?? (graph.assets.length ? compileScene(graph, defaultProposal(graph, 1)) : emptyPresentation(graph));
  const times = s.events.map((e) => Date.parse(e.occurred_at));
  const start = s.project.meta?.start ?? new Date((times.length ? Math.min(...times) : Date.parse(s.server_time)) - 60_000).toISOString();
  const end = s.project.dataset_kind === "live" ? s.server_time : s.project.meta?.end ?? new Date((times.length ? Math.max(...times) : Date.parse(s.server_time)) + 60_000).toISOString();
  return {
    mode: "server", project: { id: s.project.id, name: s.project.name, dataset_kind: s.project.dataset_kind, ...(s.project.meta?.description ? { description: s.project.meta.description } : {}) },
    projects, graph, scene, sources: s.sources, events: s.events, evidence: s.evidence, findings: s.findings,
    coverage: s.coverage, unobserved_asset_ids: s.unobserved_asset_ids, role: s.role, cursor: s.cursor, coverage_as_of: s.server_time, window: { start, end }, planner_available: s.planner_available,
  };
}

/** Local empty viewport only. This is not a compiled server inventory or an evidence record. */
export function emptyPresentation(graph: Graph): CompiledScene {
  return { scene_schema_version: "0.2", compiler_version: "not-compiled", catalog_version: "not-compiled", graph_revision: graph.graph_revision,
    project_id: graph.project_id, seed: 1, style_profile: "stone-slate-v1", camera_profile: "isometric-v1", proposal_source: "default", rooms: [], zones: [], paths: [], pins: {},
    capacities: { public: 0, application: 0, data: 0, automation: 0, delivery: 0, external: 0 }, reflow_zones: [],
    wall: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 }, digest: "not-compiled-empty-project" };
}
