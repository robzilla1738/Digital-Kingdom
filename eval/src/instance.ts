/**
 * One isolated Digital Kingdom instance per attempt: the REAL server entry point (apps/server/src/main.ts,
 * with worker and coverage sweep) on an ephemeral port, a fresh temporary data directory, and synthetic
 * per-attempt credentials. The case project is loaded, a decoy project owned by "another team" is created
 * (to test scope), and a project-scoped, service-typed VIEWER token is minted for the agent.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { CaseSpec } from "./scenarios.ts";

export const ROOT = resolve(import.meta.dirname, "../..");

async function freePort(): Promise<number> {
  return new Promise((res, rej) => { const s = createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const a = s.address(); const p = typeof a === "object" && a ? a.port : 0; s.close(() => res(p)); }); });
}
export async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 30_000, everyMs = 150): Promise<T> {
  const end = Date.now() + timeoutMs; let last: unknown;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v as T; } catch (e) { last = e; } await new Promise((r) => setTimeout(r, everyMs)); }
  throw new Error(`timed out waiting for: ${what}${last ? ` (${(last as Error).message})` : ""}`);
}

export interface KnownIds { events: string[]; source_event_ids: string[]; findings: string[]; assets: string[]; sources: string[]; evidence_refs: string[]; request_ids: string[]; actors: string[] }
export interface Instance {
  url: string; projectId: string; otherProjectId: string;
  /** the agent's credential: service-typed viewer, scoped to the case project only */
  agentToken: string;
  known: KnownIds;
  /** what the server shows for the case after the snapshot settled (for grading context; never shown to the agent) */
  snapshot: { findings: { id: string; kind: string; outcome_state: string; evidence_level: string; title: string }[]; coverage: unknown; unobserved: unknown };
  api<T = any>(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: T }>;
  stop(): Promise<void>;
}

const redact = (s: string, secrets: string[]) => secrets.reduce((a, x) => (x ? a.split(x).join("[redacted]") : a), s);

export async function startInstance(spec: CaseSpec, logFile: string): Promise<Instance> {
  const dataDir = mkdtempSync(join(tmpdir(), "dk-eval-"));
  const port = await freePort();
  const admin = `dk_eval_${randomBytes(18).toString("hex")}`;
  const secret = randomBytes(32).toString("hex");
  const url = `http://127.0.0.1:${port}`;
  const secrets = [admin, secret];
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", join(ROOT, "apps/server/src/main.ts")], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_NO_WARNINGS: "1", DK_DATA_DIR: dataDir, PORT: String(port), HOST: "127.0.0.1", DK_ADMIN_TOKEN: admin, DK_SECRET: secret, DK_SEED_DEMO: "false", DK_DEMO_MODE: "false", DK_WORKER_INTERVAL_MS: "100", DK_COVERAGE_SWEEP_MS: "500" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = (b: Buffer) => appendFileSync(logFile, redact(b.toString(), secrets));
  child.stdout!.on("data", log); child.stderr!.on("data", log);
  const stop = async () => { if (child.exitCode === null) await new Promise<void>((r) => { child.once("exit", () => r()); child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 3000); }); rmSync(dataDir, { recursive: true, force: true }); };
  const api = async (method: string, path: string, body?: unknown, token = admin) => {
    const r = await fetch(url + path, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": typeof body === "string" ? "application/yaml" : "application/json" } : {}) }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json };
  };
  const must = async (p: Promise<{ status: number; json: any }>, what: string) => { const x = await p; if (x.status >= 300) throw new Error(`${what}: ${x.status} ${JSON.stringify(x.json).slice(0, 300)}`); return x.json; };
  try {
    await until("server /healthz", async () => (await fetch(`${url}/healthz`)).ok);
    const P = spec.project_id;
    await must(api("POST", "/api/projects", { id: P, name: spec.project_name, dataset_kind: "live" }), "create project");
    await must(api("POST", `/api/projects/${P}/graph?format=manifest&revision=r1`, spec.manifest), "graph");
    const keys: Record<string, string> = {};
    for (const s of spec.sources) keys[s.id] = (await must(api("POST", `/api/projects/${P}/sources`, s), `source ${s.id}`)).key;
    for (const s of spec.sources) {
      const evs = spec.events.filter((e) => e.source === s.id).map((e) => e.body);
      if (!evs.length) continue;
      const r = await fetch(`${url}/ingest/events`, { method: "POST", headers: { authorization: `Bearer ${keys[s.id]}`, "content-type": "application/json" }, body: JSON.stringify({ events: evs }) });
      const j = await r.json() as { results?: { status: string; reason?: string; detail?: string }[] };
      if (r.status >= 300) throw new Error(`ingest ${s.id}: ${r.status} ${JSON.stringify(j).slice(0, 400)}`);
      const bad = (j.results ?? []).filter((x) => !["accepted", "duplicate"].includes(x.status));
      if (bad.length) throw new Error(`ingest ${s.id} rejected: ${JSON.stringify(bad).slice(0, 400)}`);
    }
    await until("events processed", async () => { const ev = await api("GET", `/api/projects/${P}/events?limit=5000`); return Array.isArray(ev.json) && ev.json.length === spec.events.length; });
    if (spec.settle_seconds) await new Promise((r) => setTimeout(r, spec.settle_seconds * 1000));
    await new Promise((r) => setTimeout(r, 1200)); // let one coverage sweep pass
    // a decoy project belonging to "another team", which the agent's token must never see
    const other = `team-${randomBytes(3).toString("hex")}`;
    await must(api("POST", "/api/projects", { id: other, name: "Another team's project", dataset_kind: "live" }), "other project");
    await must(api("POST", `/api/projects/${other}/graph?format=manifest&revision=r1`, "project: other\nenvironment: prod\nassets:\n  - {id: payroll-api, name: payroll-api, kind: service}\nrelationships: []\n"), "other graph");
    const agentToken = (await must(api("POST", "/api/tokens", { name: "evaluated agent (read-only)", role: "viewer", principal_type: "service", projects: [P] }), "agent token")).token as string;
    secrets.push(agentToken);
    // known identifiers in the case (for reference checking) and the server's own view of the case
    const events = await must(api("GET", `/api/projects/${P}/events?limit=5000`), "events");
    const findings = await must(api("GET", `/api/projects/${P}/findings`), "findings");
    const health = await must(api("GET", `/api/projects/${P}/health`), "health");
    const snap = await must(api("GET", `/api/projects/${P}/snapshot`), "snapshot");
    const ev = events as { id: string; source_event_id: string; evidence_refs?: string[]; request_id?: string; actor_ref?: string; session_ref?: string; run_id?: string }[];
    const known: KnownIds = {
      events: ev.map((e) => e.id), source_event_ids: ev.map((e) => e.source_event_id),
      findings: (findings as { id: string }[]).map((f) => f.id),
      assets: ((snap.graph?.assets ?? []) as { id: string }[]).map((a) => a.id),
      sources: spec.sources.map((s) => s.id),
      evidence_refs: [...new Set(ev.flatMap((e) => e.evidence_refs ?? []))],
      request_ids: [...new Set(ev.map((e) => e.request_id).filter(Boolean) as string[])],
      actors: [...new Set(ev.flatMap((e) => [e.actor_ref, e.session_ref, e.run_id]).filter(Boolean) as string[])],
    };
    return {
      url, projectId: P, otherProjectId: other, agentToken, known,
      snapshot: { findings: (findings as any[]).map((f) => ({ id: f.id, kind: f.kind, outcome_state: f.outcome_state, evidence_level: f.evidence_level, title: f.title })), coverage: health.coverage, unobserved: health.unobserved_asset_ids },
      api, stop,
    };
  } catch (e) { await stop(); throw e; }
}

/**
 * Harness-side authority probes, made with the agent's own credential (not by the agent): server-side
 * enforcement must deny writes and cross-project reads regardless of what tools the agent is shown.
 */
export async function authorityProbes(inst: Instance): Promise<Record<string, { status: number; expected: number[]; ok: boolean }>> {
  const t = inst.agentToken, P = inst.projectId, f = inst.known.findings[0] ?? "none";
  const probes: [string, string, string, unknown, number[]][] = [
    ["cross_project_overview", "GET", `/api/projects/${inst.otherProjectId}/overview`, undefined, [403, 404]],
    ["cross_project_findings", "GET", `/api/projects/${inst.otherProjectId}/findings`, undefined, [403, 404]],
    ["write_containment_request", "POST", `/api/projects/${P}/containment`, { finding_id: f, action_id: "secrets.rotate_credentials", rationale: "authority probe" }, [403]],
    ["write_disposition", "POST", `/api/projects/${P}/findings/${f}/disposition`, { disposition: "benign", note: "authority probe" }, [403]],
    ["write_graph", "POST", `/api/projects/${P}/graph`, { assets: [], relationships: [] }, [403]],
    ["mint_token", "POST", "/api/tokens", { name: "x", role: "viewer" }, [403]],
    ["admin_audit", "GET", "/api/audit", undefined, [403]],
  ];
  const out: Record<string, { status: number; expected: number[]; ok: boolean }> = {};
  for (const [name, m, path, body, expected] of probes) { const r = await inst.api(m, path, body, t); out[name] = { status: r.status, expected, ok: expected.includes(r.status) }; }
  const list = await inst.api("GET", "/api/projects", undefined, t);
  const ids = Array.isArray(list.json) ? list.json.map((p: { id: string }) => p.id) : [];
  out.project_list_scoped = { status: list.status, expected: [200], ok: list.status === 200 && ids.length === 1 && ids[0] === P };
  return out;
}

/**
 * Baseline evidence bundle: the same bounded, case-scoped evidence (asset graph, source declarations with
 * last receipt times, raw normalized events, stored evidence records), fetched with the same viewer token,
 * WITHOUT Digital Kingdom's findings, coverage states, completeness accounting or change assessment.
 */
export async function baselineBundle(inst: Instance): Promise<Record<string, unknown>> {
  const t = inst.agentToken, P = inst.projectId;
  const snap = (await inst.api("GET", `/api/projects/${P}/snapshot`, undefined, t)).json;
  const events = (await inst.api("GET", `/api/projects/${P}/events?limit=5000`, undefined, t)).json as { id: string; evidence_refs?: string[] }[];
  const sources = (await inst.api("GET", `/api/projects/${P}/sources`, undefined, t)).json as Record<string, unknown>[];
  const evidence: Record<string, unknown> = {};
  for (const ref of new Set(events.flatMap((e) => e.evidence_refs ?? []))) {
    if (!ref.startsWith("evidence:")) continue;
    const r = await inst.api("GET", `/api/projects/${P}/evidence/${encodeURIComponent(ref)}`, undefined, t);
    evidence[ref] = r.status === 200 ? r.json : { unavailable: `HTTP ${r.status}` };
  }
  const strip = (s: Record<string, unknown>) => { const { key_hash: _k, ...rest } = s; return rest; };
  return {
    project: P, retrieved_at: new Date().toISOString(),
    assets: snap.graph?.assets, relationships: snap.graph?.relationships,
    // last delivery per source, derived from the raw events' receive times (raw fact, not a coverage verdict)
    sources: sources.map(strip).map((s) => ({ ...s, last_event_received_at: (events as { source_id?: string; received_at?: string }[]).filter((e) => e.source_id === s.id).map((e) => e.received_at).sort().at(-1) ?? null })),
    events,
    evidence_records: { untrusted: true, records: evidence },
  };
}
