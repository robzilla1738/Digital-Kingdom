import { createHash } from "node:crypto";
import { canonicalJson, checkScenarioAgainstWorld, fillRoute, monoMs, parseScenario, RunRefusal, ScenarioClock, seedCommitment, type OpResult, type Scenario, type ScenarioStep } from "@dk/local-world";
import { syntheticPassword } from "./services.ts";
import type { LocalWorld } from "./session.ts";

/**
 * LP07: the scenario engine. It executes a validated `dk.local.scenario.v1` schedule against ONE supervisor-owned
 * run, step by step, using only typed supervisor actions (registered resources, declared routes, typed configure,
 * observer control) and the evidence path's hold/release/drop faults. It has no shell, plugin, script or URL path.
 *
 * Three stores stay separate:
 *  - private truth (this module's `PrivateTruth`, written as an owned 0600 file in the run directory): the seed,
 *    labels, expectations, every executed operation and every effect that actually happened (from the run's tap log);
 *  - observable evidence: whatever the sources delivered to Digital Kingdom through ordinary ingestion;
 *  - investigator output: built only from the Digital Kingdom API with a viewer token (`investigatorView`).
 * Evidence faults change only what is delivered, never the truth record. Scenario time is a separate clock; every
 * step records its scheduled offset, actual monotonic offsets and scenario time, so timing differences are visible.
 */
export const PRIVATE_TRUTH_SCHEMA = "dk.local.private_truth.v1";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface StepRecord {
  index: number; action: ScenarioStep["action"]; role: NonNullable<ScenarioStep["role"]>; label: string | null;
  scheduled_at_ms: number; started_offset_ms: number | null; ended_offset_ms: number | null; scenario_time: string;
  outcome: "executed" | "refused" | "failed" | "not_run"; op_id: string | null; status: number | null; reason: string | null;
}
export interface PrivateTruth {
  schema: typeof PRIVATE_TRUTH_SCHEMA; scenario: { id: string; version: number; seed: string; blueprint: string }; run_id: string; world_revision: string;
  labels: Record<string, number>; expectations: Scenario["expect"]; steps: StepRecord[];
  effects: { op_id: string; step: number | null; resource_id: string; action: string; detail: Record<string, unknown> }[];
  lifecycle: Record<string, unknown>[];
}
export interface ScenarioResult {
  schema: "dk.local.scenario_result.v1"; scenario_id: string; run_id: string; status: "complete" | "partial";
  accounting: { steps: number; executed: number; refused: number; failed: number; not_run: number; not_run_steps: number[] };
  timing: { scheduled_span_ms: number; actual_span_ms: number; max_lag_ms: number; time_scale: number };
  grades: { label: string; expected: Scenario["expect"][number]; actual: { status_class: string | null; effect: string | null }; pass: boolean; note: string }[];
  truth_file: string;
}

export interface RunOptions {
  /** Real milliseconds per scenario millisecond (0 = run as fast as possible). */
  timeScale?: number; stopAfter?: number; settleMs?: number;
  /** Settling allowance the referee grants an effect after its operation ended (default 0: taps are synchronous). */
  gradeSettleMs?: number;
}

export async function runScenario(w: LocalWorld, input: unknown, o: RunOptions = {}): Promise<{ result: ScenarioResult; truth: PrivateTruth }> {
  const s = parseScenario(input);
  checkScenarioAgainstWorld(s, w.world);
  if (seedCommitment(s.seed) !== w.world.plan.seed_commitment) throw new Error("scenario seed does not match the world's seed commitment; start the world from the same seed");
  const run = w.run, token = w.operatorToken;
  const clock = new ScenarioClock(s.start);
  const scale = o.timeScale ?? 0;
  const named = { sessions: new Map<string, string>(), creds: new Map<string, { id: string; secret: string }>(), artifacts: new Map<string, string>() };
  const res = (template: string) => run.world.plan.resources.find((r) => r.template === template)?.id;
  const t0 = monoMs();
  const records: StepRecord[] = [];
  let prevAt = 0;
  const call = (resource: string, method: "GET" | "POST", path: string, headers: Record<string, string> = {}, body?: unknown): Promise<OpResult> => run.request(token, { resource, method, path, headers, ...(body !== undefined ? { body } : {}) });

  for (const [index, st] of s.steps.entries()) {
    clock.advance(st.at_ms - prevAt); prevAt = st.at_ms;
    const rec: StepRecord = { index, action: st.action, role: st.role ?? "stimulus", label: st.label ?? null, scheduled_at_ms: st.at_ms, started_offset_ms: null, ended_offset_ms: null, scenario_time: clock.now().toISOString(), outcome: "not_run", op_id: null, status: null, reason: null };
    records.push(rec);
    if (o.stopAfter !== undefined && index >= o.stopAfter) { rec.reason = "run stopped before this step (partial run)"; continue; }
    if (run.state !== "running") { rec.reason = `run is ${run.state}`; continue; }
    const due = t0 + st.at_ms * scale;
    if (scale > 0 && due > monoMs()) await new Promise((r) => setTimeout(r, due - monoMs()));
    rec.started_offset_ms = monoMs() - t0;
    try {
      let op: OpResult | null = null;
      switch (st.action) {
        case "sign_in": {
          op = await call(st.resource ?? res("gateway") ?? res("auth")!, "POST", "/login", {}, { account: st.actor, password: syntheticPassword(run.world, st.actor!) });
          if (op.status === 200) named.sessions.set(st.as!, (op.body as { session: string }).session);
          break;
        }
        case "request_route": { const r = fillRoute(st.route!, st.params); op = await call(st.resource!, r.method, r.path, st.session ? { "x-world-session": named.sessions.get(st.session) ?? "" } : {}, r.method === "POST" ? { value: st.value ?? "synthetic" } : undefined); break; }
        case "enqueue_job": { const r = fillRoute("POST /tenants/{tenant}/jobs", st.params); op = await call(res("gateway")!, "POST", r.path, { "x-world-session": named.sessions.get(st.session!) ?? "" }); break; }
        case "agent_send": op = await call(res("agent_gateway")!, "POST", "/tools/send_message", { "x-world-agent-run": st.run! }, { to: st.to, body: st.value ?? "synthetic message" }); break;
        case "agent_search": op = await call(res("agent_gateway")!, "POST", "/tools/search_docs", { "x-world-agent-run": st.run! }, {}); break;
        case "issue_credential": { op = await call(res("local_issuer")!, "POST", "/credentials", {}, { subject: st.subject, scope: ["read"] }); if (op.status === 201) named.creds.set(st.as!, op.body as { id: string; secret: string }); break; }
        case "use_credential": { const c = named.creds.get(st.credential!); const r = fillRoute(st.route!, st.params); op = await call(st.resource!, r.method, r.path, { "x-world-credential-id": c?.id ?? "", "x-world-credential": c?.secret ?? "" }); break; }
        case "revoke_credential": { const c = named.creds.get(st.credential!); op = await call(res("local_issuer")!, "POST", `/credentials/${encodeURIComponent(c?.id ?? "none")}/revoke`, {}, {}); break; }
        case "change_grant": op = await call(res("local_issuer")!, "POST", "/grants", {}, { subject: st.subject, grant: st.grant, op: st.op }); break;
        case "publish_artifact": { op = await call(res("artifact_depot")!, "POST", "/artifacts", st.actor ? { "x-world-actor": st.actor } : {}, { name: st.name, content: st.value ?? `synthetic artifact ${st.name} ${sha(`${s.seed}:${st.name}`).slice(0, 12)}` }); if (op.status === 201) named.artifacts.set(st.as!, (op.body as { digest: string }).digest); break; }
        case "select_artifact": op = await call(res("artifact_depot")!, "POST", "/deployed", {}, { digest: named.artifacts.get(st.artifact!) ?? "" }); break;
        case "set_policy": run.configure(token, st.resource!, { policy_variant: st.policy_variant! }); break;
        case "observer": { const ob = run.observer(token, st.observer!); // the announced reason is neutral: scenario ids and step positions are private truth, not evidence
          if (st.state === "stop") ob.stop("stopped by the run controller"); else ob.restart(); break; }
        case "evidence": { if (st.fault === "delay") w.hub.hold(st.source!); else if (st.fault === "release") w.hub.release(st.source!); else w.hub.drop(st.source!, st.fault === "drop"); break; }
      }
      rec.outcome = "executed";
      if (op) { rec.op_id = op.op_id; rec.status = op.status; }
    } catch (e) {
      rec.outcome = e instanceof RunRefusal ? "refused" : "failed";
      rec.reason = (e as Error).message.slice(0, 300);
    }
    rec.ended_offset_ms = monoMs() - t0;
    // sources deliver continuously (as a real SDK would); held/dropped sources are the only exception
    await w.hub.flushAll().catch(() => undefined);
  }
  await run.settle(token).catch(() => undefined);
  await new Promise((r) => setTimeout(r, o.settleMs ?? 0));

  // ---- referee: private truth + independent observers; never Digital Kingdom's derived conclusions
  const opStep = new Map(records.filter((r) => r.op_id).map((r) => [r.op_id!, r.index]));
  const effects = run.truth.filter((t) => t.kind === "effect").map((t) => ({ op_id: String(t.record.op_id), step: opStep.get(String(t.record.op_id)) ?? null, resource_id: String(t.record.resource_id), action: String(t.record.action), detail: t.record.detail as Record<string, unknown> }));
  const labels = Object.fromEntries(records.filter((r) => r.label).map((r) => [r.label!, r.index]));
  const grades = s.expect.map((e) => {
    const r = records[labels[e.label]!]!;
    const status_class = r.outcome === "refused" ? "refused" : r.status === null ? null : r.status < 300 ? "2xx" : r.status < 500 ? "4xx" : "5xx";
    let effect: string | null = null, note = "";
    if (e.effect) {
      const resource = e.resource ?? effects.find((x) => x.op_id === r.op_id)?.resource_id ?? null;
      const ob = resource ? [...run.observers.values()].find((x) => x.attached.includes(resource)) : undefined;
      if (!r.op_id || !resource || !ob) { effect = "unknown"; note = "no attached observer or no operation"; }
      else { const a = ob.answer(r.op_id, { from_mono_ms: t0 + (r.started_offset_ms ?? 0), to_mono_ms: t0 + (r.ended_offset_ms ?? 0) }, resource, o.gradeSettleMs ?? 0); effect = a.status; note = a.reason; }
    }
    const pass = (!e.status_class || e.status_class === status_class) && (!e.effect || e.effect === effect);
    return { label: e.label, expected: e, actual: { status_class, effect }, pass, note };
  });
  const truth: PrivateTruth = {
    schema: PRIVATE_TRUTH_SCHEMA, scenario: { id: s.id, version: s.version, seed: s.seed, blueprint: s.blueprint }, run_id: run.run_id, world_revision: run.world.revision,
    labels, expectations: s.expect, steps: records, effects, lifecycle: run.truth.filter((t) => t.kind === "lifecycle").map((t) => t.record),
  };
  const truthFile = run.ownFile(token, `private-truth-${s.id.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 40)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.json`, JSON.stringify(truth, null, 1));
  const counts = { executed: records.filter((r) => r.outcome === "executed").length, refused: records.filter((r) => r.outcome === "refused").length, failed: records.filter((r) => r.outcome === "failed").length, not_run: records.filter((r) => r.outcome === "not_run").length };
  const lags = records.filter((r) => r.started_offset_ms !== null).map((r) => r.started_offset_ms! - r.scheduled_at_ms * scale);
  const result: ScenarioResult = {
    schema: "dk.local.scenario_result.v1", scenario_id: s.id, run_id: run.run_id, status: counts.not_run || counts.failed || records.some((r) => r.outcome === "refused" && !s.expect.some((e) => e.label === r.label && e.status_class === "refused")) ? "partial" : "complete",
    accounting: { steps: records.length, ...counts, not_run_steps: records.filter((r) => r.outcome === "not_run").map((r) => r.index) },
    timing: { scheduled_span_ms: s.steps.at(-1)!.at_ms, actual_span_ms: Math.max(0, ...records.map((r) => r.ended_offset_ms ?? 0)), max_lag_ms: Math.max(0, ...lags), time_scale: scale },
    grades, truth_file: truthFile,
  };
  return { result, truth };
}

/**
 * The intended state a seed + schedule should reproduce, independent of run ids, operation ids, random session or
 * credential handles and timing: what each step did, the effects it caused, and the deterministic service state.
 */
export function intendedState(truth: PrivateTruth, w: LocalWorld) {
  const deterministic = new Set(["tenant_store", "queue", "artifact_depot", "receiver", "api", "gateway", "agent_gateway", "worker"]);
  const snap = w.run.snapshot(w.operatorToken).services as Record<string, unknown>;
  const stable = Object.fromEntries(Object.entries(snap).filter(([id]) => deterministic.has(w.world.plan.resources.find((r) => r.id === id)!.template)));
  const strip = (d: Record<string, unknown>) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== "by"));
  return {
    steps: truth.steps.map((r) => ({ index: r.index, action: r.action, role: r.role, label: r.label, outcome: r.outcome, status: r.status })),
    effects: truth.effects.map((e) => ({ step: e.step, resource_id: e.resource_id, action: e.action, detail: strip(e.detail) })),
    state: stable,
  };
}
export const intendedDigest = (x: unknown) => sha(canonicalJson(x));

/**
 * The investigator's view: ONLY what Digital Kingdom serves to a project-scoped viewer. It is built from the API, so
 * it cannot contain private truth unless the product itself leaked it — which `leakCheck` tests.
 */
export async function investigatorView(dk: { url: string; viewerToken: string }, project: string) {
  const get = async (p: string) => { const r = await fetch(dk.url + p, { headers: { authorization: `Bearer ${dk.viewerToken}` }, redirect: "error" }); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json() as Promise<Record<string, unknown>>; };
  const snapshot = await get(`/api/projects/${encodeURIComponent(project)}/snapshot`);
  const findings = await get(`/api/projects/${encodeURIComponent(project)}/findings`);
  const reporting = await get(`/api/projects/${encodeURIComponent(project)}/local-world/reporting`);
  return { snapshot, findings, reporting };
}

/** Every private-truth marker that must never appear in an investigator view. Returns the leaked markers. */
export function leakCheck(view: unknown, truth: PrivateTruth, secrets: string[] = []): string[] {
  const text = JSON.stringify(view);
  const markers = [
    truth.scenario.seed, seedCommitment(truth.scenario.seed), truth.scenario.id,
    ...Object.keys(truth.labels), ...truth.expectations.map((e) => JSON.stringify(e)),
    ...truth.steps.filter((r) => r.role !== "stimulus").map((r) => `"role":"${r.role}"`),
    ...secrets,
  ].filter((m) => m && m.length >= 4);
  return [...new Set(markers.filter((m) => text.includes(m)))];
}
