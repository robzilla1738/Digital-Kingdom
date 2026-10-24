import { expect } from "vitest";
import { setup, liveGraph } from "./helpers.ts";
import { Cases } from "../src/cases.ts";
import { InvestigationContracts } from "../src/investigation/contracts.ts";
import { InvestigationJobs, type JobsOptions } from "../src/investigation/jobs.ts";
import type { Store } from "../src/store.ts";

/**
 * Shared public world for the Local Intelligence Phase M2 tests (LP08-LP11). Everything here is PUBLIC product
 * input (graph, sources, delivered events, a case). Tests that need a private scenario truth keep it in a separate
 * test-local object that is never passed to the product.
 */
export const T0 = Date.parse("2026-10-23T10:00:00Z");
export const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
export const AFTER = at(-1800), BEFORE = at(7800);

export interface WorldOpts {
  /** omit the database audit source (no observer can record data_access on db) */
  noDbSource?: boolean;
  /** benign request events by alice on api (pads pages) */
  padding?: number;
  /** extra events at exactly the same timestamp on db (tie-ordered pages) */
  ties?: number;
  /** db audit source reports itself unavailable between these seconds */
  dbOutage?: [number, number];
  /** project id */
  project?: string;
  /** case scope assets */
  assets?: string[];
  /** file-backed database (restart tests) */
  dbPath?: string;
}

export async function world(o: WorldOpts = {}) {
  const clock = { t: T0 - 3600_000 };
  const ctx = await setup({ store: { now: () => new Date(clock.t) }, ...(o.dbPath ? { dbPath: o.dbPath } : {}) });
  const { app, admin, analyst, h } = ctx;
  const project = o.project ?? "shop";
  expect((await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: project, name: "Shop", dataset_kind: "live" } })).statusCode).toBe(200);
  const g = liveGraph(project);
  expect((await app.inject({ method: "POST", url: `/api/projects/${project}/graph`, headers: h(admin), payload: g })).statusCode).toBe(200);
  const sources: Record<string, unknown>[] = [{ id: "app", label: "checkout app", kind: "app_security", asset_ids: ["api"], identity_namespace: "idp:corp", stale_after_seconds: 3600 }];
  if (!o.noDbSource) sources.push({ id: "dbaudit", label: "db audit", kind: "db_audit", asset_ids: ["db"], identity_namespace: "idp:corp", stale_after_seconds: 3600 });
  for (const s of sources) expect((await app.inject({ method: "POST", url: `/api/projects/${project}/sources`, headers: h(admin), payload: s })).statusCode).toBe(200);
  let n = 0;
  const send = (src: string, sec: number, p: Record<string, unknown>) => {
    const r = ctx.store.receive(project, src, { source_event_id: `e${++n}`, occurred_at: at(sec), asset_ids: [src === "app" ? "api" : "db"], ...p }, at(sec));
    expect(r.status).toBe("accepted");
  };
  for (let i = 0; i < 6; i++) send("app", i * 10, { action: "authentication", outcome: "failure", actor_ref: "alice", client_ip: "203.0.113.9" });
  send("app", 70, { action: "authentication", outcome: "success", actor_ref: "alice", client_ip: "203.0.113.9" });
  for (let i = 0; i < (o.padding ?? 0); i++) send("app", 80 + i, { action: "request_received", outcome: "allowed", actor_ref: "alice", route: "/orders" });
  if (!o.noDbSource) {
    for (let s = 0; s <= 7200; s += 600) send("dbaudit", s, { action: "data_access", outcome: "success", actor_ref: s === 3000 ? "alice" : "etl" });
    for (let i = 0; i < (o.ties ?? 0); i++) send("dbaudit", 3600, { action: "data_access", outcome: "success", actor_ref: i === Math.floor((o.ties ?? 0) * 0.7) ? "mallory-key" : "etl" });
    if (o.dbOutage) { send("dbaudit", o.dbOutage[0], { action: "sensor_unavailable", outcome: "unknown" }); send("dbaudit", o.dbOutage[1], { action: "sensor_restored", outcome: "unknown" }); }
  }
  const drain = () => { while (ctx.store.processBatch().processed) { /* drain */ } };
  drain();
  clock.t = T0 + 3 * 3600_000;
  const finding = ctx.store.listFindings(project).find((f) => f.kind === "repeated_auth_failure")!;
  expect(finding).toBeTruthy();
  const cases = new Cases(ctx.store);
  const caseRes = await app.inject({ method: "POST", url: `/api/projects/${project}/cases`, headers: h(analyst), payload: { title: "Burst then data access?", closure_criteria: "Every obligation resolved or documented", scope: { question: "Was the authentication burst followed by data access by the same principal, and what remains unknown?", asset_ids: o.assets ?? ["api", "db"], after: AFTER, before: BEFORE } } });
  expect(caseRes.statusCode).toBe(200);
  let kase = caseRes.json() as { id: string; version: number };
  const link = await app.inject({ method: "POST", url: `/api/projects/${project}/cases/${kase.id}/items`, headers: h(analyst), payload: { kind: "finding", ref: finding.id, expected_version: kase.version } });
  expect(link.statusCode).toBe(200);
  kase = link.json();
  const contracts = new InvestigationContracts(ctx.store, (p, id) => cases.get(p, id) as never);
  const services = (store: Store = ctx.store, opts: JobsOptions = {}, secret = "test-secret") => {
    const cs = new Cases(store);
    const ct = new InvestigationContracts(store, (p, id) => cs.get(p, id) as never);
    return { contracts: ct, jobs: new InvestigationJobs(store, secret, ct, opts) };
  };
  return { ctx, clock, project, finding, caseId: kase.id, cases, contracts, services, send, drain, base: `/api/projects/${project}/cases/${kase.id}` };
}
