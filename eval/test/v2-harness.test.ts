import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { assertConditionLabels, buildC3Bundle, BudgetLedger, CONDITIONS, FAMILIES, generateCases, generatePairs, manifestOf, manifestViaApi, preflight, preregisteredOrder, runCalls, scoreAttempt, type CommonMetadata, type Provider } from "../src/v2/harness.ts";
import { renderCase, SCENARIO_IDS } from "../src/scenarios.ts";
import { setup } from "../../apps/server/test/helpers.ts";

/** R11.1 offline v2 harness. No provider is called. */
const ROOT = resolve(import.meta.dirname, "../..");
const meta: CommonMetadata = { clock: "2026-10-19T14:00:00.000Z", sources: [{ id: "s" }], inventory: [{ id: "a" }], limits: ["synthetic"] };

describe("R11.1 conditions", () => {
  it("C2 is never labelled raw-only; it is exactly event search and event detail", () => {
    expect(() => assertConditionLabels()).not.toThrow();
    expect(CONDITIONS.find((c) => c.id === "C2")).toMatchObject({ label: "Event-MCP with context", raw_only: false, tools: ["dk_search_events", "dk_get_event"] });
    expect(() => assertConditionLabels([...CONDITIONS.filter((c) => c.id !== "C2"), { ...CONDITIONS[1]!, label: "Raw event tools" }])).toThrow(/must not be labeled raw/);
    expect(CONDITIONS.find((c) => c.id === "C1")!.tools).not.toContain("dk_propose_containment");
  });
});

describe("R11.1 access-equivalence preflight", () => {
  it("equal manifests pass; unavailable evidence invalidates the case instead of improving scores", () => {
    const ev = [{ id: "e1", evidence_refs: ["evidence:e1"] }, { id: "e2", evidence_refs: [] }];
    const m = manifestOf(ev, meta);
    const ok = preflight({ C1: m, C2: m, C3: m }, ["e1"], buildC3Bundle(ev, {}, meta));
    expect(ok.valid).toBe(true);
    const missing = preflight({ C1: m, C2: manifestOf([ev[1]!], meta), C3: m }, ["e1"], "{}");
    expect(missing.valid).toBe(false);
    expect(missing.reasons.join(" ")).toMatch(/C2 events differ.*required evidence e1 unreachable in C2/s);
    const otherMeta = preflight({ C1: m, C2: manifestOf(ev, { ...meta, clock: "2026-10-20T00:00:00Z" }), C3: m }, [], "{}");
    expect(otherMeta.reasons).toContain("C2 common metadata differs from C3");
    expect(preflight({ C1: m, C2: m, C3: m }, [], "x".repeat(130_000)).reasons[0]).toMatch(/exceeds the 120000-byte cap/);
    const scored = scoreAttempt({ attempt_id: "a1", case_id: "c", condition: "C2", tool_results: ["e1"], status: "completed" }, [{ id: "r1", kind: "retrieval", evidence: ["e1"] }], missing);
    expect(scored.status).toBe("invalid_case");
  });

  it("builds a condition's manifest by traversing every search page with its real viewer credential", async () => {
    const ctx = await setup();
    const svc = ctx.store.createToken("eval agent", "viewer", ["demo-castle"], undefined, "service").token;
    const api = async (p: string) => { const r = await ctx.app.inject({ url: p, headers: ctx.h(svc) }); return { status: r.statusCode, json: r.json() }; };
    const m = await manifestViaApi(api, "demo-castle", { after: "2026-10-20T13:00:00Z", before: "2026-10-20T20:00:00Z" }, meta);
    const all = ctx.store.listEvents("demo-castle", { limit: 5000 }).filter((e) => e.occurred_at >= "2026-10-20T13:00:00" && e.occurred_at <= "2026-10-20T20:00:00.000Z");
    expect(m.event_ids).toEqual([...new Set(all.map((e) => e.id))].sort());
    expect(m.pages).toBeGreaterThanOrEqual(1);
  });
});

describe("R11.1 scoring", () => {
  const pre = preflight({ C1: manifestOf([{ id: "e1" }, { id: "e2" }], meta), C2: manifestOf([{ id: "e1" }, { id: "e2" }], meta), C3: manifestOf([{ id: "e1" }, { id: "e2" }], meta) }, ["e1", "e2"], "{}");
  const objectives = [{ id: "find-read", kind: "retrieval" as const, evidence: ["e2"] }, { id: "no-overclaim", kind: "reasoning" as const, evidence: ["e2"] }];
  it("required evidence never retrieved fails retrieval and task success; its reasoning is unexercised", () => {
    const s = scoreAttempt({ attempt_id: "a", case_id: "c", condition: "C1", tool_results: ["...e1..."], status: "completed" }, objectives, pre) as { status: string; counts: Record<string, number> };
    expect(s.status).toBe("unsuccessful");
    expect(s.counts).toMatchObject({ failed: 1, unexercised: 1 });
  });
  it("retrieved evidence without a reviewer judgment stays pending; provider errors stay in the denominator", () => {
    expect((scoreAttempt({ attempt_id: "b", case_id: "c", condition: "C1", tool_results: ["e2"], status: "completed" }, objectives, pre) as { status: string }).status).toBe("pending_review");
    expect((scoreAttempt({ attempt_id: "c", case_id: "c", condition: "C1", tool_results: ["e2"], status: "completed", judgments: { "no-overclaim": "passed" } }, objectives, pre) as { status: string }).status).toBe("successful");
    expect(scoreAttempt({ attempt_id: "d", case_id: "c", condition: "C1", tool_results: [], status: "timeout" }, objectives, pre)).toMatchObject({ status: "unsuccessful", failure: "timeout" });
  });
});

describe("R11.1 generation, pairing and ordering", () => {
  it("seeded held-out generation is deterministic, covers 12 families x (dev + 2 held-out), and differs from v1 cases", () => {
    const a = generateCases(424242), b = generateCases(424242);
    expect(a.manifest).toEqual(b.manifest);
    expect(FAMILIES).toHaveLength(12);
    expect(a.cases).toHaveLength(36);
    expect(a.cases.filter((c) => c.spec.split === "heldout")).toHaveLength(24);
    const v1Projects = new Set(SCENARIO_IDS.flatMap((id) => [renderCase(id, "a").spec.project_id, renderCase(id, "b").spec.project_id]));
    expect(a.cases.some((c) => v1Projects.has(c.spec.project_id))).toBe(false);
    expect(generateCases(1).manifest.master_seed_hash).not.toBe(a.manifest.master_seed_hash);
  });
  it("eight clean/injected pairs differ in exactly one length-matched field, two per style", () => {
    const { cases } = generateCases(424242);
    const pairs = generatePairs(cases, 424242);
    expect(pairs).toHaveLength(16);
    for (let i = 0; i < 16; i += 2) {
      const [clean, inj] = [pairs[i]!, pairs[i + 1]!];
      const strip = (t: typeof clean) => JSON.stringify({ ...t.case.spec, case_id: "", events: t.case.spec.events.map((e, k) => (k === 0 ? { ...e, body: { ...e.body, coverage_note: "" } } : e)) });
      expect(strip(clean)).toBe(strip(inj));
      expect(String(clean.case.spec.events[0]!.body.coverage_note).length).toBe(String(inj.case.spec.events[0]!.body.coverage_note).length);
    }
    const styles = pairs.filter((p) => p.twin === "injected").map((p) => p.style);
    for (const s of ["imperative", "fake_system_note", "fake_approval", "fake_conclusion"]) expect(styles.filter((x) => x === s)).toHaveLength(2);
  });
  it("the preregistered order is fixed by its seed and counterbalances clean-first and injected-first blocks", () => {
    const { cases } = generateCases(7);
    const pairs = generatePairs(cases, 7);
    const ids = cases.filter((c) => c.spec.split === "heldout").map((c) => c.spec.case_id);
    const o1 = preregisteredOrder(ids, pairs, 99), o2 = preregisteredOrder(ids, pairs, 99);
    expect(o1).toEqual(o2);
    expect(o1.filter((s) => !s.block)).toHaveLength(24 * 3 * 3);
    expect(o1.filter((s) => s.block)).toHaveLength(8 * 2 * 3 * 3);
    expect(new Set(o1.filter((s) => s.block === "clean_first").map((s) => s.case_id.split("-").slice(0, 2).join("-"))).size).toBe(4);
    expect(preregisteredOrder(ids, pairs, 100)).not.toEqual(o1);
  });
});

describe("R11.1 budget reservation (fake provider only)", () => {
  it("reserves the maximum next cost and stops before 80% of the approved cap", async () => {
    const calls: string[] = [];
    const fake: Provider = { kind: "fake", maxCostPerCall: 0.1, call: async (p) => { calls.push(p); return { text: "ok", costUsd: 0.09 }; } };
    const r = await runCalls(fake, Array.from({ length: 20 }, (_, i) => `p${i}`), { approvedCapUsd: 1 });
    expect(calls.length).toBe(8); // 7 settled at 0.09 = 0.63; the 9th reservation would exceed 0.80
    expect(r.results.at(-1)!.stopped).toMatch(/budget stop/);
    expect(r.incurred).toBeLessThanOrEqual(0.8);
    const l = new BudgetLedger(1);
    expect(l.reserve("a", 0.5)).toBe(true);
    expect(l.reserve("b", 0.4)).toBe(false); // in-flight reservations count
    await expect(runCalls({ ...fake, kind: "real" }, ["x"], { approvedCapUsd: 5 })).rejects.toThrow(/separately approved budget/);
  });
});

describe("R11.1 v1 artifacts are untouched", () => {
  it("v1 scenarios, grading keys and runs keep their recorded digest (tracked files)", () => {
    const files = execSync("git ls-files eval/runs eval/grading eval/scenarios", { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean).sort();
    expect(files.length).toBeGreaterThan(50);
    const h = createHash("sha256");
    for (const f of files) h.update(f).update("\0").update(readFileSync(join(ROOT, f)));
    expect(h.digest("hex")).toBe(V1_TREE_DIGEST);
  });
});
const V1_TREE_DIGEST = "9f6fde03ddec56f6692149a94c7f09fdf7f4287b534700a66aec173d6e811d96";
