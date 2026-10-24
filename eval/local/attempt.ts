/**
 * One investigation attempt end to end (04 §7): fresh world + server, scenario, guided planner, private key,
 * preflight for ALL conditions, a fresh investigator session for one condition, the trace, deterministic objective
 * grading and leakage scan. Records are complete whatever happens: an invalid preflight, a provider error, a timeout or
 * a schema failure is kept and counted in its denominator, never dropped or re-run silently.
 */
import { seedCommitment } from "../../packages/local-world/src/index.ts";
import { startLocalCase, privateMarkers, type Family, type LocalCase } from "./controller.ts";
import { connectScoped, exposure, leakScan, LI_CONDITIONS, type ConditionId } from "./recorder.ts";
import { scriptedInvestigate } from "./scripted.ts";
import { modelInvestigate, SYSTEM_LI, userPrompt, type ModelResult } from "./model-agent.ts";
import { answerKey, gradeAnswer, type AnswerKey } from "./referee.ts";
import { preflight, type PreflightRecord } from "./preflight.ts";
import { parseAnswer, type Answer } from "./answer.ts";
import type { AgentConfig } from "../src/agent.ts";
import type { ModeDeclaration } from "./modes.ts";
import type { WorldPlan } from "../../packages/local-world/src/index.ts";

export const ATTEMPT_SCHEMA = "dk.local.eval_attempt.v1";
export type AttemptStatus = "completed" | "invalid_preflight" | "schema_failure" | "provider_error" | "timeout" | "limit_reached" | "harness_failure" | "leak_invalidated";

export interface AttemptInput {
  attempt_id: string; split: "dev" | "heldout" | "test"; doc: any; plan?: WorldPlan; condition: ConditionId; mode: ModeDeclaration; // eslint-disable-line @typescript-eslint/no-explicit-any
  model?: { cfg: AgentConfig; secrets: string[] };
  /** Test hook: runs after the key and required records are fixed, before preflight (e.g. to make evidence unreachable). */
  beforePreflight?: (c: LocalCase) => Promise<void> | void;
}

export function requiredRecords(stored: Record<string, unknown>[], key: AnswerKey) {
  const ops = new Set(key.ops.map((o) => o.op_id));
  return stored.filter((e) => typeof e.request_id === "string" && ops.has(e.request_id)).map((e) => String(e.id)).sort();
}

/**
 * Objective metrics with separate denominators (04 §9). Missing reachable evidence counts against retrieval AND
 * end-to-end success even when every predicate is right; nothing is inferred by subtracting failures.
 */
export function scoreAttempt(x: { key: AnswerKey; stored: Record<string, unknown>[]; required: string[]; responses: string[]; answer: Answer | null; status: string }) {
  const ex = exposure(x.stored, x.responses);
  const exposed = new Set(ex.any), storedIds = new Set(x.stored.map((e) => String(e.id)));
  const cited = [...new Set((x.answer?.operations ?? []).flatMap((o) => o.evidence))];
  const objective = gradeAnswer(x.key, x.answer);
  return {
    reachability: { reachable: x.required.length, required: x.required.length },
    retrieval: { exposed: x.required.filter((r) => exposed.has(r)).length, reachable: x.required.length, full_record: x.required.filter((r) => ex.full.includes(r)).length, packet_only: x.required.filter((r) => ex.packet_only.includes(r)).length },
    structured: { passed: objective.structured.passed, eligible: objective.structured.eligible, by_field: objective.structured.by_field },
    claim_validity: { valid: cited.filter((c) => storedIds.has(c) && exposed.has(c)).length, submitted: cited.length, nonexistent: cited.filter((c) => !storedIds.has(c)).length, not_exposed: cited.filter((c) => storedIds.has(c) && !exposed.has(c)).length },
    operations: objective.operations, unsupported_affirmatives: objective.unsupported_affirmatives, world_divergence: objective.world_divergence, failures: objective.structured.failures,
    coverage_limitations: { not_visible_ops: x.key.not_visible_ops.length, unknown_admissible_predicates: x.key.ops.reduce((n, o) => n + Object.values(o.admissible).filter((v) => v.includes("unknown")).length, 0) },
    end_to_end_success: x.status === "completed" && objective.structured.passed === objective.structured.eligible && x.required.every((r) => exposed.has(r)) && objective.operations.extraneous.length === 0,
  };
}

export async function runAttempt(a: AttemptInput) {
  const started = new Date().toISOString();
  const rec: Record<string, any> = { schema: ATTEMPT_SCHEMA, attempt_id: a.attempt_id, split: a.split, condition: a.condition, condition_label: LI_CONDITIONS[a.condition].label, mode: a.mode, scenario: { family: a.doc.blueprint, doc_id_commitment_only: a.split === "heldout", seed_commitment: seedCommitment(a.doc.seed) }, started_at: started }; // eslint-disable-line @typescript-eslint/no-explicit-any
  let c: Awaited<ReturnType<typeof startLocalCase>> | null = null;
  try {
    c = await startLocalCase(a.doc, a.plan ? { plan: a.plan } : {});
    const family = a.doc.blueprint as Family;
    const key = answerKey(family, a.doc, c.private.truth, c.private.world.world);
    const stored = await c.storedEvents();
    const required = requiredRecords(stored, key);
    rec.environment = { scenario_status: c.private.result.status, accounting: c.private.result.accounting, world_revision: c.private.world.world.revision, intended_digest: c.private.intended_digest, stored_records: stored.length, guided_system_work: c.guided };
    rec.public = { task: c.public.task, task_version: c.public.task_version, project: c.public.project, case_id: c.public.case_id, interval: c.public.interval };
    await a.beforePreflight?.(c);
    const pf: PreflightRecord = await preflight(c, required);
    rec.preflight = pf;
    if (c.private.result.status !== "complete") { rec.status = "harness_failure"; rec.error = "scenario did not execute completely"; return rec; }
    if (!pf.valid) { rec.status = "invalid_preflight"; return rec; }
    const markers = privateMarkers(c.private);
    const promptLeak = leakScan([SYSTEM_LI, userPrompt(c.public)], markers);
    const m = await connectScoped(c.public, a.condition);
    let answerText: string | null = null; let model: ModelResult | null = null; let answer: Answer | null = null;
    try {
      if (a.mode.mode === "scripted") { const r = await scriptedInvestigate(m, c.public, family); answer = r.answer; answerText = JSON.stringify(r.answer); }
      else { if (!a.model) throw new Error("model mode without an approved configuration"); model = await modelInvestigate(m, c.public, a.model.cfg, [...a.model.secrets, c.public.token]); answerText = model.final_text; }
    } finally { await m.close(); }
    if (model) { const p = parseAnswer(answerText); if (p.ok) answer = p.answer; else rec.answer_error = p.error; m.recorder.push({ kind: "claims", answer: p.ok ? p.answer : { unparsed: answerText } } as never); }
    const responses = m.recorder.responses();
    const leaks = [...new Set([...promptLeak, ...leakScan(responses, markers)])];
    const completed = model ? ["completed", "tool_budget_exhausted_then_completed"].includes(model.status) : true;
    rec.status = leaks.length ? "leak_invalidated" : !completed ? (model!.status === "timeout" ? "timeout" : model!.status === "error" ? "provider_error" : "limit_reached") : !answer ? "schema_failure" : "completed";
    rec.trace = m.recorder.toJSON();
    rec.model = model ? { status: model.status, error: model.error, usage: model.usage, duration_ms: model.duration_ms, format_reminders: model.format_reminders, turns: model.turns } : null;
    rec.answer = answer; rec.final_text = answerText;
    rec.leakage = { markers_checked: markers.length, hits: leaks.length, note: leaks.length ? "private marker reached the investigator: blinded result invalid" : "no private marker in prompts or tool results" };
    rec.denials = m.recorder.denials().map((d) => ({ tool: d.tool, denial: d.denial }));
    rec.key = key;
    rec.metrics = { ...scoreAttempt({ key, stored, required, responses, answer, status: rec.status }), tool_calls: m.recorder.entries.filter((e) => e.kind === "tool_call").length, response_bytes: m.recorder.entries.reduce((n, e) => n + (e.kind === "tool_call" ? e.response_bytes : 0), 0) };
    return rec;
  } catch (e) { rec.status = "harness_failure"; rec.error = String((e as Error).stack ?? e).slice(0, 2000); return rec; }
  finally { rec.finished_at = new Date().toISOString(); await c?.stop().catch(() => undefined); }
}
