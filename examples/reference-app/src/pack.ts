import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DigitalKingdom } from "@dk/sdk-node";
import { buildApp } from "../../../apps/server/src/app.ts";
import { openDb } from "../../../apps/server/src/db.ts";
import { Store } from "../../../apps/server/src/store.ts";
import { startReferenceApp } from "./app.ts";

/**
 * One-command local application pack (roadmap R02.2).
 *
 * Starts an isolated Digital Kingdom server (127.0.0.1 only, its own database), declares a small live inventory,
 * registers four least-privilege sources (application SDK, database audit, agent tool wrapper, independent effect
 * observer), starts the instrumented reference app, and walks the guided steps:
 * authorize -> preview -> import -> validate -> first event. Everything is real local traffic through
 * authenticated ingestion; nothing is posted to the renderer. `reset()` deletes the pack's data directory.
 */
export const PACK_MANIFEST = `project: local
environment: local
assets:
  - {id: edge, name: local-edge, kind: edge}
  - {id: checkout, name: checkout-api, kind: service, owner: payments, aliases: [checkout-api]}
  - {id: db, name: checkout-db, kind: database}
  - {id: agent, name: support-agent, kind: agent}
  - {id: tools, name: support-tools, kind: tool_server}
  - {id: sink, name: controlled-sink, kind: storage}
relationships:
  - {from: edge, to: checkout}
  - {from: checkout, to: db, kind: reads_from}
  - {from: agent, to: tools, kind: invokes_tool}
  - {from: tools, to: sink, kind: writes_to}
`;

export interface PackStep { step: "authorize" | "preview" | "import" | "validate" | "first_event"; ok: boolean; detail: string }
export interface Pack {
  url: string; appUrl: string; adminToken: string; project: string; steps: PackStep[];
  store: Store; sdk: { app: DigitalKingdom; db: DigitalKingdom; agent: DigitalKingdom; observer: DigitalKingdom };
  runAgentTask(runId: string): Promise<void>;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export async function startPack(opts: { dataDir?: string; port?: number; appPort?: number } = {}): Promise<Pack> {
  if (opts.dataDir) mkdirSync(opts.dataDir, { recursive: true });
  const store = new Store(openDb(opts.dataDir ? join(opts.dataDir, "dk.sqlite") : ":memory:"));
  const adminToken = store.createToken("pack admin", "admin").token;
  const app = await buildApp({ store, secret: randomUUID(), demoMode: false, webDist: join(import.meta.dirname, "../../../apps/web/dist") });
  const url = await app.listen({ port: opts.port ?? 0, host: "127.0.0.1" });
  const H = { authorization: `Bearer ${adminToken}` };
  const api = async (method: string, path: string, body?: unknown, type = "application/json") => {
    const r = await fetch(url + path, { method, headers: { ...H, ...(body !== undefined ? { "content-type": type } : {}) }, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
    const j = await r.json().catch(() => ({})) as Record<string, unknown>;
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${String(j.error ?? "")}`);
    return j;
  };
  const steps: PackStep[] = [];
  const me = await api("GET", "/api/me");
  steps.push({ step: "authorize", ok: me.role === "admin", detail: "Local admin token for this pack only; the server listens on 127.0.0.1." });
  // LP03: the pack is real local traffic from a synthetic reference application. dataset_kind stays "live" (it uses
  // real source keys and live ingestion); the separate local run provenance labels it synthetic and local-only.
  if (!store.getProject("local")) await api("POST", "/api/projects", { id: "local", name: "Local application pack", dataset_kind: "live",
    local_run: { schema: "dk.local.run_provenance.v1", run_id: `pack-${randomUUID().slice(0, 8)}`, world_plan_id: "reference-pack-1", catalog_version: "reference-app-r02.2", execution_mode: "local_runtime", data_origin: "synthetic_local", scope: "local_run_only", external_validation: "not_performed", started_at: new Date().toISOString() } });
  steps.push({ step: "preview", ok: true, detail: "Inventory: edge, checkout-api, checkout-db, support-agent, support-tools, controlled-sink (declared, not discovered)." });
  const imp = await api("POST", "/api/projects/local/graph?format=manifest&revision=pack-1", PACK_MANIFEST, "application/yaml");
  steps.push({ step: "import", ok: !!imp.graph_revision, detail: `Imported graph revision ${String(imp.graph_revision)}.` });
  const register = async (body: Record<string, unknown>) => {
    const cur = store.listSources("local").find((s) => s.id === body.id);
    return String((await api("POST", "/api/projects/local/sources", { ...body, ...(cur ? { expected_revision: cur.config_revision } : {}) })).key);
  };
  const keys = {
    app: await register({ id: "checkout-sdk", label: "checkout-api SDK", kind: "app_security", asset_ids: ["checkout"], trusts_request_ids: true, identity_namespace: "local:accounts", stale_after_seconds: 900 }),
    db: await register({ id: "db-audit", label: "checkout-db audit fixture", kind: "db_audit", asset_ids: ["db"], identity_namespace: "local:accounts", stale_after_seconds: 900 }),
    agent: await register({ id: "agent-wrapper", label: "support-agent tool wrapper", kind: "agent_observer", asset_ids: ["agent", "tools"], run_namespace: "local:support-agent", stale_after_seconds: 1800 }),
    observer: await register({ id: "sink-observer", label: "controlled-sink effect observer", kind: "effect_observer", asset_ids: ["sink", "tools"], run_namespace: "local:support-agent", stale_after_seconds: 1800 }),
  };
  const salt = randomUUID();
  const mk = (key: string) => new DigitalKingdom({ url, sourceKey: key, sessionSalt: salt, flushIntervalMs: 100 });
  const sdk = { app: mk(keys.app), db: mk(keys.db), agent: mk(keys.agent), observer: mk(keys.observer) };
  const health = await api("GET", "/api/projects/local/health");
  steps.push({ step: "validate", ok: Array.isArray(health.coverage) && (health.coverage as unknown[]).length === 4, detail: "Four sources registered with least-privilege scopes; none has reported yet, so all are shown as not assessed." });
  const ref = await startReferenceApp({ dk: sdk.app, asset: "checkout", ...(opts.appPort ? { port: opts.appPort } : {}), onDbRead: (actor) => sdk.db.dataAccess("db", actor, { route: "/orders" }) });
  const appUrl = ref.url;
  // first event: a real request through the instrumented app, visible via the API
  await fetch(appUrl + "/orders", { headers: { "x-demo-user": "alice" } });
  const flush = async () => { await Promise.all(Object.values(sdk).map((s) => s.flush())); for (let i = 0; i < 50 && store.processBatch().processed; i++) { /* drain */ } };
  await flush();
  const first = store.listEvents("local", { limit: 10 }).find((e) => e.source_id === "checkout-sdk");
  steps.push({ step: "first_event", ok: !!first && first.asset_ids.includes("checkout"), detail: first ? `First event ${first.id} on ${first.asset_ids.join(", ")}.` : "No event yet." });

  return {
    url, appUrl, adminToken, project: "local", steps, store, sdk, flush,
    async runAgentTask(runId: string) {
      const base = { runtime: "support-agent-runtime", initiating_principal: "svc:support-desk", model_route: "local-route" };
      sdk.agent.toolStep("agent", runId, "refused", { phase: "decision", origin: "runtime_self_report", tool: "db.delete_customer", step: 1, ...base });
      sdk.agent.toolStep("tools", runId, "denied", { phase: "decision", origin: "policy_enforcer", tool: "db.write", policy_revision: "pack-p1", step: 2, ...base });
      sdk.agent.toolStep("tools", runId, "success", { phase: "execution", origin: "tool_wrapper", tool: "email.send", tool_version: "1.0.0", policy_revision: "pack-p1", step: 3, ...base }, { details: { destination: "controlled-sink" } });
      sdk.observer.toolStep("sink", runId, "observed", { phase: "effect", origin: "independent_observer", runtime: base.runtime, tool: "email.send" }, { details: { messages: 1 } });
      await flush();
    },
    async stop() { await flush(); for (const s of Object.values(sdk)) await s.close(); await ref.close(); await app.close(); store.db.close(); },
  };
}

export function resetPack(dataDir: string) { rmSync(dataDir, { recursive: true, force: true }); }
