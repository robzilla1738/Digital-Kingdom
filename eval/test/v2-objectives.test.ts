import { describe, expect, it } from "vitest";
import { scoreObjective, summarizeObjectives } from "../src/v2-objectives.ts";

describe("v2 objective accounting (offline; no model judgments generated)", () => {
  it("missed reachable evidence fails retrieval and makes the task unsuccessful", () => {
    const retrieval = scoreObjective({ id: "find-read", kind: "retrieval", reachable: true, exposed: false });
    const reasoning = scoreObjective({ id: "interpret-read", kind: "reasoning", reachable: true, exposed: false });
    expect(retrieval.status).toBe("failed"); expect(reasoning.status).toBe("unexercised");
    const total = summarizeObjectives([retrieval, reasoning]);
    expect(total).toMatchObject({ status: "unsuccessful", successful: false, retrieval: { passed: 0, denominator: 1 }, reasoning_when_judged: { denominator: 0, unexercised: 1 } });
  });
  it("unreachable evidence invalidates a case rather than rewarding avoidance", () => {
    const r = scoreObjective({ id: "unreachable", kind: "retrieval", reachable: false, exposed: false });
    expect(summarizeObjectives([r])).toMatchObject({ status: "invalid_case", successful: false });
  });
  it("seeing evidence does not establish semantic correctness or human approval", () => {
    const r = scoreObjective({ id: "support", kind: "reasoning", reachable: true, exposed: true });
    expect(summarizeObjectives([r])).toMatchObject({ status: "pending_review", successful: false });
  });
  it("only passed required objectives produce end-to-end success", () => {
    const a = scoreObjective({ id: "find", kind: "retrieval", reachable: true, exposed: true });
    const b = scoreObjective({ id: "support", kind: "reasoning", reachable: true, exposed: true, judgment: "passed" });
    expect(summarizeObjectives([a, b])).toMatchObject({ status: "successful", successful: true, objectives: 2 });
  });
  it("an incorrect interpretation is a task failure", () => {
    const r = scoreObjective({ id: "support", kind: "reasoning", reachable: true, exposed: true, judgment: "failed" });
    expect(summarizeObjectives([r]).status).toBe("unsuccessful");
  });
  it("empty and duplicated objective sets cannot inflate a score", () => {
    expect(() => summarizeObjectives([])).toThrow(/no required objectives/);
    const r = scoreObjective({ id: "same", kind: "retrieval", reachable: true, exposed: true });
    expect(() => summarizeObjectives([r, r])).toThrow(/duplicate/);
    expect(() => scoreObjective({ id: " ", kind: "retrieval", reachable: true, exposed: true })).toThrow(/required/);
  });
});
