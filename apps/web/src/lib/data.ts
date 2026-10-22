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
  sources: SourceConfig[];
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
    role: "none", cursor: 0, window: { start: demoMeta.start, end: demoMeta.end }, planner_available: false,
  };
}

export class Api {
  constructor(private readonly base = "") {}
  async get<T>(path: string): Promise<T> {
    const r = await fetch(this.base + path, { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!r.ok) throw new ApiError(r.status, await safeText(r));
    return r.json() as Promise<T>;
  }
  async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(this.base + path, { method, credentials: "same-origin", headers: { "content-type": "application/json", "x-dk-request": "1" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new ApiError(r.status, await safeText(r));
    return r.json() as Promise<T>;
  }
}
export class ApiError extends Error { constructor(readonly status: number, message: string) { super(message); } }
async function safeText(r: Response) { try { const j = await r.json(); return j.error ?? r.statusText; } catch { return r.statusText; } }

interface Snapshot {
  project: { id: string; name: string; dataset_kind: "synthetic" | "live"; meta?: { description?: string; start?: string; end?: string } };
  graph: Graph | null; scene: CompiledScene | null; sources: SourceConfig[]; events: SecurityEvent[];
  evidence: Record<string, Record<string, unknown>>; findings: Finding[]; coverage: CoverageRecord[]; unobserved_asset_ids: string[];
  cursor: number; server_time: string; role: Dataset["role"]; planner_available: boolean;
}

export async function detectServer(api: Api): Promise<{ name: string; role: Dataset["role"]; kind: string } | null> {
  try { return await api.get("/api/me"); } catch (e) { if (e instanceof ApiError && e.status === 401) return { name: "", role: "none", kind: "unauthenticated" }; return null; }
}

export async function loadFromServer(api: Api, projectId?: string): Promise<Dataset> {
  const projects = await api.get<Dataset["projects"]>("/api/projects");
  if (!projects.length) throw new ApiError(404, "No projects are visible to this account.");
  const id = projectId && projects.some((p) => p.id === projectId) ? projectId : projects[0]!.id;
  const s = await api.get<Snapshot>(`/api/projects/${encodeURIComponent(id)}/snapshot`);
  if (!s.graph || !s.scene) throw new ApiError(409, "This project has no asset graph yet. Import a manifest or compose file first.");
  const times = s.events.map((e) => Date.parse(e.occurred_at));
  const start = s.project.meta?.start ?? new Date((times.length ? Math.min(...times) : Date.parse(s.server_time)) - 60_000).toISOString();
  const end = s.project.dataset_kind === "live" ? s.server_time : s.project.meta?.end ?? new Date((times.length ? Math.max(...times) : Date.parse(s.server_time)) + 60_000).toISOString();
  return {
    mode: "server", project: { id: s.project.id, name: s.project.name, dataset_kind: s.project.dataset_kind, ...(s.project.meta?.description ? { description: s.project.meta.description } : {}) },
    projects, graph: s.graph, scene: s.scene, sources: s.sources, events: s.events, evidence: s.evidence, findings: s.findings,
    coverage: s.coverage, unobserved_asset_ids: s.unobserved_asset_ids, role: s.role, cursor: s.cursor, window: { start, end }, planner_available: s.planner_available,
  };
}
