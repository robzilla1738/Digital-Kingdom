import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAttempt, scoreAttempt, requiredRecords } from "../local/attempt.ts";
import { startLocalCase, type LocalCase } from "../local/controller.ts";
import { declareMode } from "../local/modes.ts";
import { answerKey } from "../local/referee.ts";
import { aggregate, buildReport } from "../local/report.ts";
import { PhaseLedger } from "../local/ledger.ts";
import { ANSWER_SCHEMA, type Answer } from "../local/answer.ts";
import { chat, DEFAULT_LIMITS, type AgentConfig } from "../src/agent.ts";
import { BudgetLedger } from "../src/budget.ts";
import { fakeProvider } from "./li-fake-provider.ts";

/** LP26 — guided vs current loops: preflight, denominators and budget. No paid model call (loopback stand-in only). */
const ROOT = join(import.meta.dirname, "../..");
const doc = (id: string) => JSON.parse(readFileSync(join(ROOT, `scenarios/local-world/dsl/${id}.scenario.json`), "utf8"));
const scripted = declareMode("scripted", {}, { mcp_profile: "per condition", credential: "service viewer" });
const open: LocalCase[] = [];
afterEach(async () => { for (const c of open.splice(0)) await c.stop(); });

describe("LP26-A1: all conditions pass evidence-access/metadata equality before attempts; invalid preflight is not a score", () => {
  it("a valid attempt records equal reach for C1, C2 and C3 before the investigator starts", async () => {
    const r = await runAttempt({ attempt_id: "pf-ok", split: "test", doc: doc("LW-02"), condition: "C1", mode: scripted });
    expect(r.status).toBe("completed");
    expect(r.preflight.valid).toBe(true);
    const reach = Object.values(r.preflight.conditions).map((c: any) => c.reachable); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(reach[0]).toEqual(reach[1]); expect(reach[1]).toEqual(reach[2]);
    expect(reach[0].length).toBe(r.preflight.stored);
    expect(Object.values(r.preflight.conditions).every((c: any) => c.tools_ok && c.digest_mismatches.length === 0)).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.preflight.required.every((x: string) => reach[0].includes(x))).toBe(true);
    expect(r.preflight.metadata_sha256).toMatch(/^[0-9a-f]{64}$/);
    // the investigator's trace starts only after preflight: its first entry is its own tool list
    expect(r.trace.entries[0].kind).toBe("tools_list");
  }, 60_000);

  it("when a required record becomes unreachable the attempt is invalid_preflight and no model request is made", async () => {
    const fake = await fakeProvider(() => ({ content: "{}" }));
    try {
      const mode = declareMode("local_model", { DK_LI_LOCAL_MODEL_URL: fake.url, DK_LI_LOCAL_MODEL: "stand-in" }, { mcp_profile: "per condition", credential: "service viewer" });
      const r = await runAttempt({ attempt_id: "pf-bad", split: "test", doc: doc("LW-01"), condition: "C3", mode, model: { cfg: { ...DEFAULT_LIMITS, model: "stand-in", gatewayUrl: fake.url, apiKey: "none" }, secrets: [] },
        beforePreflight: async (c) => { const ev = (await c.storedEvents()).find((e) => e.source_id === "audit" && e.request_id)!; c.productStore.db.prepare("DELETE FROM events WHERE id = ?").run(String(ev.id)); } });
      expect(r.status).toBe("invalid_preflight");
      expect(r.preflight.valid).toBe(false);
      expect(r.preflight.reasons.join(" ")).toMatch(/required record .* unreachable/);
      expect(r.metrics).toBeUndefined();
      expect(fake.requests()).toBe(0);
      const agg = aggregate([r]);
      expect(agg).toMatchObject({ started: 1, invalid_preflight: 1, valid_started: 0, end_to_end_success: { successful: 0, denominator: 0 } });
    } finally { await fake.close(); }
  }, 60_000);
});

describe("LP26-A2: missing reachable evidence counts against retrieval and end-to-end success", () => {
  it("a right answer without the required records retrieved is not an end-to-end success; failures stay in the denominator", async () => {
    const c = await startLocalCase(doc("LW-03")); open.push(c);
    const key = answerKey("delivery-identity", c.private.doc, c.private.truth, c.private.world.world);
    const stored = await c.storedEvents();
    const required = requiredRecords(stored, key);
    const right: Answer = { schema: ANSWER_SCHEMA, summary: "", unknowns: [], operations: key.ops.map((o) => ({ request_id: o.op_id, outcome: o.admissible.outcome[0] as never, independent_effect: o.admissible.independent_effect[0] as never, boundary_violation: o.admissible.boundary_violation[0] as never, evidence: [] })) };
    const all = scoreAttempt({ key, stored, required, responses: [JSON.stringify({ events: stored })], answer: right, status: "completed" });
    expect(all).toMatchObject({ end_to_end_success: true, retrieval: { exposed: required.length, reachable: required.length } });
    const half = stored.filter((e) => !required.slice(0, 3).includes(String(e.id)));
    const partial = scoreAttempt({ key, stored, required, responses: [JSON.stringify({ events: half })], answer: right, status: "completed" });
    expect(partial.structured.passed).toBe(partial.structured.eligible); // every predicate right...
    expect(partial.retrieval.exposed).toBe(required.length - 3); // ...but retrieval is short
    expect(partial.end_to_end_success).toBe(false);
    // ids merely mentioned are not exposure; a modified record is not exposure either
    const mentioned = scoreAttempt({ key, stored, required, responses: [JSON.stringify({ finding: { event_ids: required } }), JSON.stringify({ events: stored.map((e) => ({ ...e, outcome: "tampered" })) })], answer: right, status: "completed" });
    expect(mentioned.retrieval.exposed).toBe(0);
    // aggregate: provider errors and schema failures are started attempts; success is never inferred by subtraction
    const rec = (status: string, m: ReturnType<typeof scoreAttempt>) => ({ status, condition: "C1", split: "dev", metrics: { ...m, tool_calls: 1, response_bytes: 1 }, key });
    const none = scoreAttempt({ key, stored, required, responses: [], answer: null, status: "provider_error" });
    const agg = aggregate([rec("completed", all), rec("completed", partial), rec("provider_error", none), rec("schema_failure", scoreAttempt({ key, stored, required, responses: [JSON.stringify({ events: stored })], answer: null, status: "schema_failure" }))]);
    expect(agg.end_to_end_success).toEqual({ successful: 1, denominator: 4 });
    expect(agg.structured).toMatchObject({ passed: key.ops.length * 3 * 2, eligible: key.ops.length * 3 * 4 });
    expect(agg.statuses).toEqual({ completed: 2, provider_error: 1, schema_failure: 1 });
  }, 60_000);
});

describe("LP26-A3: structured predicates, semantic critique and coverage limitations use separate denominators", () => {
  it("the sealed report keeps objective metrics, AI critique (advisory) and coverage limitations apart; human review stays deferred", async () => {
    const out = mkdtempSync(join(tmpdir(), "dk-li-report-"));
    const r = await runAttempt({ attempt_id: "rep-1", split: "dev", doc: doc("LW-01"), condition: "C3", mode: scripted });
    mkdirSync(join(out, "runs", "approved_provider"), { recursive: true }); mkdirSync(join(out, "critique"));
    writeFileSync(join(out, "runs", "approved_provider", "000.json"), JSON.stringify({ ...r, cost: { charged_usd: 0 } }));
    writeFileSync(join(out, "critique", "000.json"), JSON.stringify({ label: "ai_reviewed_advisory", split: "dev", condition: "C3", critique: { operations: [{ outcome: "supported", independent_effect: "unclear", boundary_violation: "unsupported" }] } }));
    const reg = { id: "t", model: { id: "m" }, order: [0, 1], conditions: [{ label: "a" }, { label: "b" }, { label: "c" }] };
    const { report } = buildReport(out, reg);
    const g = (report.model_runs.by_block_condition as Record<string, any>)["dev/C3"]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(g.structured).toMatchObject({ passed: 15, eligible: 15 });
    expect(g.coverage_limitations).toEqual({ not_visible_ops: 0, unknown_admissible_predicates: 1 });
    expect(g.retrieval.reachable).toBe(r.metrics.retrieval.reachable);
    const crit = (report.ai_semantic_critique.by_block_condition as Record<string, any>)["dev/C3"]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(crit).toMatchObject({ label: "ai_reviewed_advisory", critiqued_attempts: 1, judgments: 3, supported: 1, unsupported: 1, unclear: 1 });
    expect(g).not.toHaveProperty("judgments"); expect(g).not.toHaveProperty("supported"); // critique never enters objective rows
    expect(report.human_review).toMatch(/deferred/);
    const md = readFileSync(join(out, "REPORT.md"), "utf8");
    expect(md).toMatch(/AI semantic critique \(ai_reviewed_advisory/);
    expect(md).toMatch(/Human review: deferred/);
  }, 60_000);
});

describe("LP26-A4: no prior $5 budget or approval is reused; paid mode needs an explicit route, cap and pre-reservation", () => {
  it("the phase ledger is new, persistent and refuses the historical ledger or a silently changed route", () => {
    const dir = mkdtempSync(join(tmpdir(), "dk-li-ledger-"));
    const init = { phase_cap_usd: 3, allowance_usd: 2, allowance_note: "test", route: "ai-gateway", model: "m" };
    expect(() => new PhaseLedger(join(ROOT, "artifacts/completion/evaluation/budget.json"), init)).toThrow(/historical v2 ledger is not reused/);
    expect(() => new PhaseLedger(join(dir, "l.json"), { ...init, allowance_usd: 5 })).toThrow(/within the phase cap/);
    const l = new PhaseLedger(join(dir, "l.json"), init);
    l.record({ id: "a", run: "r", kind: "attempt", reserved_max_usd: 0.5, charged_usd: 0.5, gateway_cost_usd: 0.5, prompt_tokens: 1, completion_tokens: 1, model_calls: 1 });
    const again = new PhaseLedger(join(dir, "l.json"), init);
    expect(again.budget.incurred).toBe(0.5);
    expect(again.remaining).toBe(1.5);
    expect(JSON.parse(readFileSync(join(dir, "l.json"), "utf8"))).toMatchObject({ schema: "dk.local.model_spend_ledger.v1", phase_cap_usd: 3, allowance_usd: 2, charged_total_usd: 0.5 });
    expect(() => new PhaseLedger(join(dir, "l.json"), { ...init, model: "other" })).toThrow(/changed/);
    // the historical ledger file is untouched by any of this
    expect(existsSync(join(ROOT, "artifacts/completion/evaluation/budget.json"))).toBe(true);
    expect(declareMode("approved_provider", { DK_EVAL_V2_APPROVED: "1", AI_GATEWAY_API_KEY: "x".repeat(20) }, { mcp_profile: "p", credential: "c" }).status).toBe("not_exercised");
  });

  it("every request is reserved at worst case before it is sent; an over-cap request is never sent; a failed request keeps its maximum", async () => {
    const fake = await fakeProvider(() => ({ content: "ok" }));
    try {
      const mk = (cap: number): AgentConfig => ({ ...DEFAULT_LIMITS, maxCompletionTokens: 1000, model: "m", gatewayUrl: fake.url, apiKey: "none", budget: { ledger: new BudgetLedger(cap, 1), inputUsdPerToken: 1e-7, outputUsdPerToken: 2e-7 } });
      const tiny = mk(0.00001);
      await expect(chat(tiny, [{ role: "user", content: "x".repeat(2000) }], undefined, AbortSignal.timeout(5000))).rejects.toThrow(/budget exhausted before request/);
      expect(fake.requests()).toBe(0);
      const ok = mk(1);
      await chat(ok, [{ role: "user", content: "hi" }], undefined, AbortSignal.timeout(5000));
      expect(fake.requests()).toBe(1);
      expect(ok.budget!.ledger.incurred).toBe(0); // the stand-in reports cost 0; settled at the reported cost
      expect(ok.budget!.ledger.outstanding).toBe(0);
    } finally { await fake.close(); }
    const bad = await (async () => { const { createServer } = await import("node:http"); const s = createServer((_q, r) => { r.statusCode = 400; r.end("{\"error\":\"bad\"}"); }); await new Promise<void>((res) => s.listen(0, "127.0.0.1", () => res())); return s; })();
    try {
      const cfg: AgentConfig = { ...DEFAULT_LIMITS, maxCompletionTokens: 1000, model: "m", gatewayUrl: `http://127.0.0.1:${(bad.address() as { port: number }).port}/v1`, apiKey: "none", budget: { ledger: new BudgetLedger(1, 1), inputUsdPerToken: 1e-7, outputUsdPerToken: 2e-7 } };
      await expect(chat(cfg, [{ role: "user", content: "hi" }], undefined, AbortSignal.timeout(5000))).rejects.toThrow(/model HTTP 400/);
      expect(cfg.budget!.ledger.incurred).toBeGreaterThan(0); // conservatively retained
      expect(cfg.budget!.ledger.outstanding).toBe(0);
    } finally { await new Promise<void>((r) => bad.close(() => r())); }
  });
});
