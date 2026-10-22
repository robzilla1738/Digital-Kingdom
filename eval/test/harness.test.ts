/**
 * Harness self-test with a SCRIPTED fake model (not an LLM, not an evaluation result): checks isolation,
 * authority probes, tool bounds, recording without reasoning payloads, and the automatic grader.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdirSync } from "node:fs";
import { renderCase } from "../src/scenarios.ts";
import { startInstance, authorityProbes, baselineBundle, type Instance } from "../src/instance.ts";
import { runAgent, DEFAULT_LIMITS } from "../src/agent.ts";
import { grade } from "../src/grade.ts";

let fake: Server; let fakeUrl = ""; let script: ((body: any, n: number) => any) = () => ({});
let calls = 0; let inst: Instance;
const { spec, key } = renderCase("s8-incomplete-unknown", "a");

beforeAll(async () => {
  fake = createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { calls++; const out = script(JSON.parse(b), calls); res.setHeader("content-type", "application/json"); res.end(JSON.stringify(out)); }); });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
  fakeUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}/v1`;
  mkdirSync("artifacts/eval", { recursive: true });
  inst = await startInstance(spec, "artifacts/eval/harness-test.log");
}, 60_000);
afterAll(async () => { await inst?.stop(); fake?.close(); });

const msg = (content: string, tool_calls?: unknown[]) => ({ model: "fake", choices: [{ finish_reason: tool_calls ? "tool_calls" : "stop", message: { role: "assistant", content, tool_calls, reasoning_details: [{ type: "reasoning.encrypted", data: "SECRET-REASONING" }] } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 } });
const cfg = (over = {}) => ({ model: "fake", gatewayUrl: fakeUrl, apiKey: "test-key-123456", ...DEFAULT_LIMITS, ...over });

describe("evaluation harness (scripted fake model)", () => {
  it("isolates the case: scoped viewer token, writes and other projects denied server-side", async () => {
    const p = await authorityProbes(inst);
    expect(Object.entries(p).filter(([, v]) => !v.ok)).toEqual([]);
  });
  it("offers only the investigation tools, records tool use, drops reasoning payloads, grades fabricated refs", async () => {
    calls = 0;
    const fid = inst.known.findings[0]!;
    script = (_b, n) => n === 1 ? msg("", [{ id: "c1", type: "function", function: { name: "dk_get_finding", arguments: JSON.stringify({ id: fid }) } }, { id: "c2", type: "function", function: { name: "dk_overview", arguments: JSON.stringify({ project: inst.otherProjectId }) } }])
      : msg(JSON.stringify({ conclusion: "Runtime alerts; evidence incomplete.", observed_facts: [{ statement: "alert", evidence: [fid, "ev-doesnotexist1"] }], interpretations: [], gaps: [{ statement: "missing evidence", kind: "incomplete" }], next_steps: ["retrieve evidence"], requires_authorization: [] }));
    const r = await runAgent({ mode: "dk", cfg: cfg(), task: spec.task, dk: { url: inst.url, token: inst.agentToken, project: inst.projectId }, secrets: [inst.agentToken] });
    expect(r.status).toBe("completed");
    expect(r.tools_offered).not.toContain("dk_propose_containment");
    expect(r.tools_offered).toContain("dk_get_finding");
    expect(JSON.stringify(r.transcript)).not.toContain("SECRET-REASONING");
    expect(JSON.stringify(r.transcript)).not.toContain(inst.agentToken);
    const g = grade(r, key, inst.known, await authorityProbes(inst), inst.projectId);
    expect(g.parse_ok && g.schema_ok).toBe(true);
    expect(g.fabricated_refs).toEqual(["ev-doesnotexist1"]);
    expect(g.authority.agent_cross_project_attempts).toBe(1);
    expect(g.authority.agent_cross_project_denied).toBe(1);
    expect(g.tool_fields.with_completeness).toBe(1);
    expect(g.tool_fields.incomplete_bundles_seen).toBe(1); // s8 has a missing stored evidence record
  }, 60_000);
  it("enforces the tool-call budget and then asks for a final answer", async () => {
    calls = 0;
    script = (b, n) => b.tools ? msg("", [{ id: `c${n}`, type: "function", function: { name: "dk_coverage", arguments: "{}" } }]) : msg(JSON.stringify({ conclusion: "x", observed_facts: [], interpretations: [], gaps: [], next_steps: [], requires_authorization: [] }));
    const r = await runAgent({ mode: "dk", cfg: cfg({ maxToolCalls: 3 }), task: spec.task, dk: { url: inst.url, token: inst.agentToken, project: inst.projectId }, secrets: [] });
    expect(r.usage.tool_calls).toBe(3);
    expect(r.status).toBe("tool_budget_exhausted_then_completed");
    expect(r.final_text).toContain("conclusion");
  }, 60_000);
  it("records a timeout instead of hanging", async () => {
    script = () => { const end = Date.now() + 1500; while (Date.now() < end) { /* stall */ } return msg("{}"); };
    const r = await runAgent({ mode: "baseline", cfg: cfg({ timeoutMs: 500 }), task: spec.task, bundle: {}, secrets: [] });
    expect(r.status).toBe("timeout");
  }, 30_000);
  it("baseline bundle carries the raw case evidence but no findings or coverage verdicts", async () => {
    const b = await baselineBundle(inst);
    const s = JSON.stringify(b);
    expect(Array.isArray(b.events) && (b.events as unknown[]).length).toBe(spec.events.length);
    expect(s).not.toContain("runtime_alert_reported");
    expect(s).not.toContain("key_hash");
    expect(s).not.toContain(inst.otherProjectId);
  });
});
