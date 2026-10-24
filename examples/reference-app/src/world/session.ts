import { randomUUID } from "node:crypto";
import { DigitalKingdom } from "@dk/sdk-node";
import { compileWorld, getBlueprint, instantiateBlueprint, Supervisor, type CompiledWorld, type Reporter, type ReportEvent, type Run, type WorldPlan } from "@dk/local-world";
import { BUILTIN_SERVICES, syntheticPassword } from "./services.ts";

/**
 * LP06: one local world wired to a Digital Kingdom server through ordinary authenticated ingestion.
 *
 * The supervisor owns the run; this module provisions the run's lab project (with local run provenance), imports the
 * compiled graph, registers each declared source with its own key, kind, asset scope and independence group, and
 * binds one SDK client per source. Evidence therefore reaches Digital Kingdom exactly as any real producer's would.
 * The evidence path (hub) supports delay/drop faults for the scenario engine; it never edits what happened.
 */
export class ReporterHub {
  private readonly sdks = new Map<string, DigitalKingdom>();
  private readonly pending = new Map<string, ReportEvent[]>();
  private readonly held = new Map<string, ReportEvent[]>();
  private readonly dropping = new Set<string>();
  readonly stats = { delivered: 0, held: 0, dropped: 0, released: 0 } as Record<string, number>;
  private deliver(id: string, e: ReportEvent) {
    if (this.dropping.has(id)) { this.stats.dropped!++; return; }
    if (this.held.has(id)) { this.held.get(id)!.push(e); this.stats.held!++; return; }
    const s = this.sdks.get(id);
    if (!s) { const p = this.pending.get(id) ?? []; if (p.length < 5000) p.push(e); this.pending.set(id, p); return; }
    s.emit(e as never); this.stats.delivered!++;
  }
  reporter(id: string): Reporter {
    return {
      // occurrence time is fixed when the source observes the event, so a held (delayed) record keeps its real time
      emit: (e) => this.deliver(id, { ...e, at: e.at ?? new Date() }),
      flush: async () => { await this.sdks.get(id)?.flush(); },
      sensorDown: (asset, note) => this.deliver(id, { asset, action: "sensor_unavailable", outcome: "unknown", coverageNote: note, at: new Date() }),
      sensorUp: (asset) => this.deliver(id, { asset, action: "sensor_restored", outcome: "unknown", at: new Date() }),
    };
  }
  bind(id: string, sdk: DigitalKingdom) { this.sdks.set(id, sdk); for (const e of this.pending.get(id) ?? []) this.deliver(id, e); this.pending.delete(id); }
  /** Evidence faults: hold (delay) or drop a source's records on the way to Digital Kingdom. */
  hold(id: string) { if (!this.held.has(id)) this.held.set(id, []); }
  release(id: string) { const q = this.held.get(id) ?? []; this.held.delete(id); for (const e of q) { this.deliver(id, e); this.stats.released!++; } }
  drop(id: string, on: boolean) { if (on) this.dropping.add(id); else this.dropping.delete(id); }
  sources() { return [...this.sdks.keys()]; }
  async flushAll() { await Promise.all([...this.sdks.values()].map((s) => s.flush())); }
  async closeAll() { for (const s of this.sdks.values()) await s.close(); }
}

export interface DkTarget { url: string; adminToken: string }

async function dkApi(dk: DkTarget, method: string, path: string, body?: unknown) {
  const r = await fetch(dk.url.replace(/\/+$/, "") + path, { method, headers: { authorization: `Bearer ${dk.adminToken}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: "error" });
  const j = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${String(j.error ?? "")} ${JSON.stringify(j.details ?? "")}`);
  return j;
}

/** Create the run's lab project, graph and sources in Digital Kingdom and bind one SDK client per declared source. */
export async function provision(dk: DkTarget, run: Run, hub: ReporterHub) {
  const w = run.world;
  await dkApi(dk, "POST", "/api/projects", {
    id: run.project_id, name: `Local world ${w.plan.plan_id} (${run.run_id})`, dataset_kind: "live",
    local_run: { schema: "dk.local.run_provenance.v1", run_id: run.run_id, world_plan_id: w.plan.plan_id, catalog_version: w.catalog.version, execution_mode: "local_runtime", data_origin: "synthetic_local", scope: "local_run_only", external_validation: "not_performed", started_at: run.manifest.created_at, label: "Local laboratory — synthetic people and data" },
  });
  await dkApi(dk, "POST", `/api/projects/${run.project_id}/graph`, { ...w.graph, project_id: run.project_id });
  const salt = randomUUID();
  const keys: Record<string, string> = {};
  for (const s of w.sources) {
    const r = await dkApi(dk, "POST", `/api/projects/${run.project_id}/sources`, { id: s.id, label: s.label, kind: s.kind, asset_ids: s.asset_ids, independence_group: s.independence_group, trusts_request_ids: true, stale_after_seconds: 600, ...(s.identity_namespace ? { identity_namespace: s.identity_namespace } : {}), ...(s.run_namespace ? { run_namespace: s.run_namespace } : {}) });
    keys[s.id] = String(r.key);
    hub.bind(s.id, new DigitalKingdom({ url: dk.url, sourceKey: keys[s.id]!, sessionSalt: salt, flushIntervalMs: 60_000 }));
  }
  return { project: run.project_id, sources: Object.keys(keys).sort(), keys };
}

export interface LocalWorldOptions { blueprint: string; seed: string; dk: DkTarget; plan?: WorldPlan; budget?: Partial<WorldPlan["budget"]>; supervisor?: Supervisor; drain?: () => void }
export interface LocalWorld {
  supervisor: Supervisor; run: Run; operatorToken: string; world: CompiledWorld; hub: ReporterHub; project: string; sourceKeys: Record<string, string>;
  login(account: string, via?: string): Promise<string>;
  password(account: string): string;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export async function startLocalWorld(o: LocalWorldOptions): Promise<LocalWorld> {
  const bp = getBlueprint(o.blueprint);
  if (!bp) throw new Error(`unknown blueprint ${o.blueprint}`);
  const world = compileWorld(o.plan ?? instantiateBlueprint(bp, { seed: o.seed, ...(o.budget ? { budget: o.budget } : {}) }), { blueprint: bp });
  const supervisor = o.supervisor ?? new Supervisor({ services: BUILTIN_SERVICES });
  const hub = new ReporterHub();
  const { run, operatorToken } = await supervisor.start(world, { reporters: (id) => hub.reporter(id) });
  const prov = await provision(o.dk, run, hub);
  let stopped = false;
  const flush = async () => { await run.settle(operatorToken).catch(() => undefined); await hub.flushAll(); o.drain?.(); };
  return {
    supervisor, run, operatorToken, world: run.world, hub, project: prov.project, sourceKeys: prov.keys, flush,
    password: (a) => syntheticPassword(run.world, a),
    async login(account, via) {
      const target = via ?? run.world.plan.resources.find((r) => r.template === "gateway")?.id ?? run.world.plan.resources.find((r) => r.template === "auth")!.id;
      const r = await run.request(operatorToken, { resource: target, method: "POST", path: "/login", body: { account, password: syntheticPassword(run.world, account) } });
      if (r.status !== 200) throw new Error(`login ${account} failed: ${r.status}`);
      return (r.body as { session: string }).session;
    },
    // idempotent: a launcher may stop and clean the run itself (e.g. before finalizing a verification) and stop again later
    async stop() { if (stopped) return; stopped = true; await flush().catch(() => undefined); if (run.state === "running" || run.state === "paused") await run.stop(operatorToken); await hub.closeAll(); if (run.state === "stopped") run.cleanup(); },
  };
}
