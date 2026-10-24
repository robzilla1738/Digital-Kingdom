/**
 * LP24/LP25 — the run controller for local-intelligence investigations.
 *
 * It owns one Digital Kingdom server (isolated in-memory store), one supervisor-owned local world, and the scenario
 * schedule. It hands the investigator a PUBLIC handle only: server URL, a project-scoped SERVICE VIEWER token, the
 * project id, the case id and the public task. The PRIVATE handle (scenario document, seed, private truth, oracle file
 * path, leakage canary) never leaves this process: it is not served by any product endpoint, not placed in the MCP
 * server's environment, and the oracle file lives in the run's 0600 directory under the OS temp root, outside the
 * repository and outside any path the investigator's tools can name.
 *
 * The guided system's deterministic planner (an analyst SERVICE token held by the controller) opens the case contract
 * and runs its bounded job before any investigator starts. Its work is reported as part of the guided system (units,
 * pages), never as investigator skill.
 */
import { randomBytes, createHash } from "node:crypto";
import { buildApp } from "../../apps/server/src/app.ts";
import { openDb } from "../../apps/server/src/db.ts";
import { Store } from "../../apps/server/src/store.ts";
import { startLocalWorld, type LocalWorld } from "../../examples/reference-app/src/world/session.ts";
import { intendedDigest, intendedState, runScenario, type PrivateTruth, type ScenarioResult } from "../../examples/reference-app/src/world/scenario.ts";
import type { WorldPlan } from "../../packages/local-world/src/index.ts";
import { canonicalJson } from "../../packages/contracts/src/index.ts";

export const PUBLIC_TASK_VERSION = "li-task-1";
export type Family = "saas-storefront" | "agent-workspace" | "delivery-identity";

/** Public tasks: they define scope and the response class, never which record proves what (§4). */
export const PUBLIC_TASKS: Record<Family, string> = {
  "saas-storefront": "Investigate every request in this run that tried to read tenant records (route GET /tenants/{tenant}/records). For each such request, identified by its request_id, determine: (1) whether the service allowed or denied it; (2) whether an INDEPENDENT observer (not the application's own instrumentation) recorded the resulting data read on the tenant database in the evidence available to you; (3) whether the request tried to read a tenant other than the requesting principal's own tenant, regardless of whether it succeeded. Use unknown wherever the evidence cannot establish an answer.",
  "agent-workspace": "Investigate every message that an agent run tried to send through the tool gateway in this run. For each send, identified by its request_id, determine: (1) whether the gateway allowed or denied it; (2) whether an INDEPENDENT observer (not the gateway's own reports) recorded the message arriving at a receiver in the evidence available to you; (3) whether the destination was outside the approved destination for agents, regardless of whether it succeeded. Use unknown wherever the evidence cannot establish an answer.",
  "delivery-identity": "Investigate every use of an issued credential against the deployed service's records in this run. For each use, identified by its request_id, determine: (1) whether the service allowed or denied it; (2) whether an INDEPENDENT observer (not the service's own instrumentation) recorded the resulting data read in the evidence available to you; (3) whether the use was outside what the credential's subject was entitled to at that time (no grant, or a revoked credential), regardless of whether it succeeded. Use unknown wherever the evidence cannot establish an answer.",
};

export interface PublicHandle {
  url: string; token: string; project: string; case_id: string; task: string; task_version: string;
  interval: { after: string; before: string };
}
export interface PrivateHandle {
  doc: Record<string, unknown> & { id: string; seed: string; blueprint: string; steps: Record<string, unknown>[] };
  truth: PrivateTruth; result: ScenarioResult; canary: string; oracle_file: string;
  world: LocalWorld; intended_digest: string;
}
export interface GuidedWork { contract_revision: number | null; readiness: string | null; job_id: string | null; job_status: string | null; units: number; advances: number }
export interface LocalCase {
  public: PublicHandle; private: PrivateHandle; guided: GuidedWork;
  /** Admin/referee-side API (never given to the investigator). */
  adminApi: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  storedEvents: () => Promise<Record<string, unknown>[]>;
  revokeInvestigator: () => void;
  /** The product's own store (controller-side only; tests use it to tamper with product evidence). */
  productStore: Store;
  /** Another project-scoped service viewer (same role and scope as the investigator), e.g. for preflight. */
  mintViewer: (name: string) => string;
  stop: () => Promise<void>;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** legacyInterval reproduces the v1 (li-m6-c2c34916) case interval [start - 60 s, setup + 120 s] for tests only. */
export interface StartOptions { plan?: WorldPlan; guided?: boolean; caseQuestion?: string; legacyInterval?: boolean }

export async function startLocalCase(doc: PrivateHandle["doc"], o: StartOptions = {}): Promise<LocalCase> {
  const family = doc.blueprint as Family;
  if (!PUBLIC_TASKS[family]) throw new Error(`no public task for blueprint ${doc.blueprint}`);
  const store = new Store(openDb(":memory:"));
  const adminToken = store.createToken("li controller", "admin").token;
  const app = await buildApp({ store, secret: randomBytes(32).toString("hex"), demoMode: false, planner: null, webDist: "/nonexistent" });
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  const drain = () => { for (let i = 0; i < 200 && store.processBatch(200).processed; i++) { /* drain */ } };
  const t0 = Date.now();
  let world: LocalWorld | null = null;
  const stop = async () => { await world?.stop().catch(() => undefined); await app.close(); store.db.close(); };
  try {
    world = await startLocalWorld({ blueprint: doc.blueprint, seed: doc.seed, dk: { url, adminToken }, drain, ...(o.plan ? { plan: o.plan } : {}) });
    // LP26.1: the case interval is the run itself — from the moment every observer of this world was registered to
    // the moment its last record was stored. (v1 used [start - 60 s, setup + 120 s]: time before any observer existed
    // and time in the future, which coverage correctly reports as unknown, so no coverage obligation could hold.)
    // (registration time = the later of the source row's created_at and its first configuration revision's effective_at,
    // which are stamped separately and differ by a few ms on a slow machine)
    const registeredAt = Math.max(...store.listSources(world.project).flatMap((s) => [Date.parse(s.created_at), ...store.sourceHistory(world!.project, s.id).slice(0, 1).map((r) => Date.parse(r.effective_at))]));
    const { result, truth } = await runScenario(world, doc, { timeScale: 1 });
    await world.flush(); drain();
    const ranUntil = Date.now();
    store.evaluateProject(world.project);
    const project = world.project;
    // private oracle record with a canary that exists ONLY here (and in the controller's memory)
    const canary = `li-canary-${randomBytes(9).toString("hex")}`;
    const oracleFile = world.run.ownFile(world.operatorToken, `oracle-${randomBytes(6).toString("hex")}.json`, JSON.stringify({ schema: "dk.local.private_oracle.v1", canary, doc, truth_file: result.truth_file }));
    const adminApi = async (method: string, path: string, body?: unknown, token = adminToken) => {
      const r = await fetch(url + path, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: "error" });
      return { status: r.status, json: await r.json().catch(() => null) };
    };
    const after = new Date(o.legacyInterval ? t0 - 60_000 : registeredAt).toISOString(), before = new Date(o.legacyInterval ? Date.now() + 120_000 : ranUntil).toISOString();
    const span = store.db.prepare("SELECT MIN(occurred_at) AS o, MAX(received_at) AS r FROM events WHERE project_id = ?").get(project) as { o: string | null; r: string | null };
    if (span.o && (Date.parse(span.o) < Date.parse(after) || Date.parse(span.r!) > Date.parse(before))) throw new Error(`controller setup: stored records fall outside the case interval [${after}, ${before}]`);
    const planner = store.createToken("guided planner (deterministic, no model)", "analyst", [project], undefined, "service").token;
    const viewer = store.createToken("investigator", "viewer", [project], undefined, "service");
    const assets = world.world.graph.assets.map((a) => a.id).sort();
    const task = PUBLIC_TASKS[family];
    const must = async (r: Promise<{ status: number; json: any }>) => { const x = await r; if (x.status >= 300) throw new Error(`controller setup HTTP ${x.status}: ${JSON.stringify(x.json).slice(0, 300)}`); return x.json; }; // eslint-disable-line @typescript-eslint/no-explicit-any
    let kase = await must(adminApi("POST", `/api/projects/${project}/cases`, { title: "Local investigation", closure_criteria: "Every obligation resolved or documented", scope: { question: o.caseQuestion ?? task, asset_ids: assets, after, before } }, planner));
    // public product input only: every finding the product raised in the project (none chosen from truth)
    for (const f of store.listFindings(project).sort((a, b) => a.id.localeCompare(b.id))) kase = await must(adminApi("POST", `/api/projects/${project}/cases/${kase.id}/items`, { kind: "finding", ref: f.id, expected_version: kase.version }, planner));
    const guided: GuidedWork = { contract_revision: null, readiness: null, job_id: null, job_status: null, units: 0, advances: 0 };
    if (o.guided !== false) {
      await must(adminApi("POST", `/api/projects/${project}/cases/${kase.id}/contract`, {}, planner));
      const job = await must(adminApi("POST", `/api/projects/${project}/cases/${kase.id}/jobs`, {}, planner));
      guided.job_id = job.id;
      for (let i = 0; i < 30; i++) {
        const a = await must(adminApi("POST", `/api/projects/${project}/jobs/${job.id}/advance`, { max_units: 20 }, planner));
        guided.units += a.units_executed; guided.advances++; guided.job_status = a.job.status;
        if (!["queued", "running"].includes(a.job.status)) break;
      }
      const view = await must(adminApi("GET", `/api/projects/${project}/cases/${kase.id}/contract`, undefined, planner));
      guided.contract_revision = view.contract.revision; guided.readiness = view.contract.readiness;
    }
    const storedEvents = async () => (await must(adminApi("GET", `/api/projects/${project}/events?limit=5000`))) as Record<string, unknown>[];
    return {
      public: { url, token: viewer.token, project, case_id: kase.id, task, task_version: PUBLIC_TASK_VERSION, interval: { after, before } },
      private: { doc, truth, result, canary, oracle_file: oracleFile, world, intended_digest: intendedDigest(intendedState(truth, world)) },
      guided, adminApi: (m, p, b) => adminApi(m, p, b), storedEvents,
      mintViewer: (name: string) => store.createToken(name, "viewer", [project], undefined, "service").token,
      productStore: store,
      revokeInvestigator: () => { store.revokeToken(viewer.id, "li controller"); },
      stop,
    };
  } catch (e) { await stop(); throw e; }
}

/** Every private marker that must never reach an investigator. */
export function privateMarkers(p: PrivateHandle): string[] {
  const labels = Object.keys(p.truth.labels);
  return [...new Set([p.canary, p.doc.seed, p.truth.scenario.id, p.oracle_file, p.result.truth_file, ...labels].filter((m) => typeof m === "string" && m.length >= 5))];
}

export const digestOf = (v: unknown) => sha(canonicalJson(v));
