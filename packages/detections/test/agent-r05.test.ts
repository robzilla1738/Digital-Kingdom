import { describe, expect, it } from "vitest";
import { evaluate, minimizeIngest, processDeliveries, type SourceConfig } from "../src/index.ts";
import type { AgentContext, Finding, IngestEvent } from "@dk/contracts";
import { demoGraph } from "../../../fixtures/testing/load.ts";

/** R05.1 agent intent / decision / execution / effect contracts. */
const T0 = Date.parse("2026-10-20T14:00:00Z");
const t = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const SRC: SourceConfig[] = [
  { id: "wrap", label: "Tool wrapper", kind: "agent_observer", asset_ids: ["agent", "tools"], run_namespace: "rt:a" },
  { id: "self", label: "Runtime self-report channel", kind: "effect_observer", asset_ids: ["tools", "blob"], run_namespace: "rt:a" },
  { id: "obs", label: "Independent egress observer", kind: "effect_observer", asset_ids: ["tools", "blob"], run_namespace: "rt:a" },
];
let seq = 0;
const ev = (source_id: string, sec: number, p: Partial<IngestEvent>) => ({ source_id, received_at: t(sec + 1), payload: { source_event_id: `a-${++seq}`, occurred_at: t(sec), asset_ids: ["tools"], run_id: "run-1", ...p } });
const call = (agent: Partial<AgentContext> | null, outcome = "success", sec = 0) => ev("wrap", sec, { action: "tool_invocation", outcome: outcome as IngestEvent["outcome"], ...(agent ? { agent: { phase: "execution", origin: "tool_wrapper", ...agent } as AgentContext } : {}) });
const effect = (source: string, agent: Partial<AgentContext> | null, sec = 5) => ev(source, sec, { action: "side_effect_observed", outcome: "observed", ...(agent ? { agent: { phase: "effect", origin: "independent_observer", ...agent } as AgentContext } : {}) });
const run = (d: ReturnType<typeof ev>[]) => {
  const p = processDeliveries(demoGraph(), SRC, d);
  expect(p.stats.rejections).toEqual([]);
  return evaluate(demoGraph(), p.events, { sources: SRC });
};
const effects = (r: { findings: Finding[] }) => r.findings.filter((f) => f.kind === "agent_effect_observed");

describe("R05.1 observation origin", () => {
  it("a runtime's self-report cannot masquerade as independent corroboration", () => {
    const self = run([call({ runtime: "a" }), effect("self", { origin: "runtime_self_report", runtime: "a" } as Partial<AgentContext>)]);
    expect(effects(self)[0]!.evidence_level).toBe("source_reported");
    const indep = run([call({ runtime: "a" }), effect("obs", { runtime: "a" })]);
    expect(effects(indep)[0]!.evidence_level).toBe("corroborated");
  });

  it("identical run ids from unrelated runtimes do not join, even inside one declared namespace", () => {
    const r = run([call({ runtime: "a" }), call({ runtime: "b" }, "success", 2), effect("obs", { runtime: "b" })]);
    const f = effects(r);
    expect(f).toHaveLength(1);
    expect(f[0]!.event_ids).toHaveLength(2); // runtime b's call and its effect only
    const ids = new Set(f[0]!.event_ids);
    expect(r.findings.flatMap((x) => x.event_ids).filter((id) => ids.has(id))).toHaveLength(2);
  });

  it("legacy generic tool events remain valid but are qualified", () => {
    const r = run([call(null), effect("obs", null)]);
    expect(effects(r)[0]!.coverage_gaps.join(" ")).toMatch(/legacy generic tool events/);
    const declared = run([call({ runtime: "a" }), effect("obs", { runtime: "a" })]);
    expect(effects(declared)[0]!.coverage_gaps.join(" ")).not.toMatch(/legacy/);
  });
});

describe("R05.1 contracts", () => {
  const base = { source_event_id: "x", occurred_at: t(0), asset_ids: ["tools"], run_id: "run-1" };
  it("phase, outcome and origin must agree (a refusal is not enforcement; an observer reports effects only)", () => {
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ action: "tool_invocation", outcome: "success", agent: { phase: "decision", origin: "policy_enforcer" } }, /allows outcomes/],
      [{ action: "tool_invocation", outcome: "refused", agent: { phase: "decision", origin: "policy_enforcer" } }, /refusal is the model's own decision/],
      [{ action: "tool_invocation", outcome: "denied", agent: { phase: "decision", origin: "runtime_self_report" } }, /policy enforcer or tool wrapper/],
      [{ action: "side_effect_observed", outcome: "observed", agent: { phase: "execution", origin: "tool_wrapper" } }, /requires action tool_invocation/],
      [{ action: "tool_invocation", outcome: "success", agent: { phase: "execution", origin: "independent_observer" } }, /observer reports effects only/],
      [{ action: "tool_invocation", outcome: "success", agent: { phase: "execution", origin: "tool_wrapper", prompt: "x" } }, /must NOT have additional properties/],
    ];
    for (const [p, re] of bad) { const m = minimizeIngest({ ...base, ...p }); expect(m.ok).toBe(false); if (!m.ok) expect(m.detail).toMatch(re); }
    expect(minimizeIngest({ ...base, action: "tool_invocation", outcome: "refused", agent: { phase: "decision", origin: "runtime_self_report", tool: "db.delete" } }).ok).toBe(true);
  });

  it("private prompts and payloads are removed before persistence; counts and identifiers stay", () => {
    const m = minimizeIngest({ ...base, action: "tool_invocation", outcome: "success", agent: { phase: "execution", origin: "tool_wrapper", tool: "email.send" },
      attributes: { prompt: "Summarize the customer's card number 4111", steps: 812, tool: "email.send" },
      evidence: { messages: [{ role: "user", content: "secret plan" }], arguments: { to: "a@b.c" }, output: "sent", destination: "sink.test.internal", attempts: 1 } });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.event.attributes).toEqual({ steps: 812, tool: "email.send" });
    expect(m.event.evidence).toEqual({ destination: "sink.test.internal", attempts: 1 });
    expect(m.redaction.removedKeys.sort()).toEqual(["arguments", "messages", "output", "prompt"]);
    expect(JSON.stringify(m.event)).not.toMatch(/secret plan|4111|a@b\.c/);
  });
});
