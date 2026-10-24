/**
 * li-next D: AI-selected local repair benchmark. Selectors see only the investigator-visible view; scripted and fake-model
 * selectors only; the real-model adapter is disabled; the bench catches every positive control from observed effects.
 */
import { describe, expect, it, vi } from "vitest";
import { REPAIR_TEMPLATES } from "../../apps/server/src/repair.ts";
import { BENCH_DISTRACTOR_TEMPLATES, apiTenantDecision } from "../local/repair-bench/distractors.ts";
import { ABSTAIN, createModelSelector, FAKE_MODEL_SELECTORS, ModelSelectorDisabled, parseModelChoice, rank1Selector, reasoningSelector, renderSelectorPrompt, type SelectorView, type VisibleOption } from "../local/repair-bench/selectors.ts";
import { runRepairBench } from "../local/repair-bench/bench.ts";

const opt = (id: string, rank: number, p: Partial<VisibleOption["predicted"]>, impact: VisibleOption["expected_impact"]): VisibleOption => ({
  option_id: id, rank, template: `t-${id}`, target: "api", explanation: "", actions: [], plan: {} as never, prerequisites: [], expected_impact: impact,
  predicted: { valid: true, blocked: 1, of: 1, still_possible: [], unknown: [], permitted_broken: [], unknowns: [], basis: "model_only", ...p },
});
const good = [{ probe: "x", role: "prohibited" as const, before: "holds" as const, after: "does_not_hold" as const }, { probe: "y", role: "permitted" as const, before: "holds" as const, after: "holds" as const }];
const view = (options: VisibleOption[]): SelectorView => ({ schema: "dk.bench.selector_view.v1", case: { case_ref: "c", question: "q", objective: { prohibited: [], permitted: [] } }, evidence: { analysis_state_hash: "h", observers: [], policies: [], generator_status: "candidates", observation_prerequisites: [] }, options, abstain_choice: ABSTAIN });

describe("li-next D selectors (visible data only)", () => {
  const overbroad = opt("o1", 1, { permitted_broken: ["y"] }, [good[0]!, { probe: "y", role: "permitted", before: "holds", after: "does_not_hold" }]);
  const safe = opt("o2", 2, {}, good);
  const residual = opt("o3", 3, { blocked: 1, of: 2, still_possible: ["z"] }, good);
  const irrelevant = opt("o4", 4, { valid: false, blocked: 0 }, good);
  it("rank1 takes rank 1 even when it is overbroad; reasoning takes the predicted-safe option", async () => {
    expect((await rank1Selector.select(view([overbroad, safe]))).choice).toBe("o1");
    expect((await reasoningSelector.select(view([overbroad, safe, residual]))).choice).toBe("o2");
  });
  it("reasoning abstains with no_applicable_candidate when nothing is safe", async () => {
    const s = await reasoningSelector.select(view([overbroad, residual, irrelevant]));
    expect(s.choice).toBe(ABSTAIN);
    expect(s.rationale).toMatch(/breaks y/);
  });
  it("fake-model selectors go through prompt → transport → parser and pick their bad preference", async () => {
    const v = view([safe, overbroad, residual, irrelevant]);
    const picks = Object.fromEntries(await Promise.all(FAKE_MODEL_SELECTORS.map(async (s) => [s.id, (await s.select(v)).choice])));
    expect(picks).toEqual({ fake_model_overbroad: "o1", fake_model_residual: "o3", fake_model_irrelevant: "o4" });
    expect(FAKE_MODEL_SELECTORS.every((s) => s.kind === "fake_model")).toBe(true);
  });
  it("the parser refuses a non-existent option (recorded abstention), and the prompt is only the view", () => {
    const v = view([safe]);
    expect(parseModelChoice('{"choice":"o9"}', v).choice).toBe(ABSTAIN);
    expect(parseModelChoice("nonsense", v).choice).toBe(ABSTAIN);
    expect(parseModelChoice('{"choice":"o2","rationale":"r"}', v).choice).toBe("o2");
    expect(renderSelectorPrompt(v)).toContain(JSON.stringify(v));
  });
  it("the real-model selector is disabled without authorization and makes no provider call even with one", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(() => createModelSelector()).toThrow(ModelSelectorDisabled);
    expect(() => createModelSelector({ flag: "--allow-model-selector", budget_usd: 0, approved_by: "x" })).toThrow(ModelSelectorDisabled);
    const s = createModelSelector({ flag: "--allow-model-selector", budget_usd: 0.25, approved_by: "owner" });
    expect(s.kind).toBe("model");
    await expect(s.select(view([safe]))).rejects.toThrow(/no provider transport/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("distractors are labelled, never product templates, and their declared semantics are overbroad / residual", () => {
    expect(BENCH_DISTRACTOR_TEMPLATES.every((t) => t.benchmark_distractor === true)).toBe(true);
    const product = new Set(REPAIR_TEMPLATES.map((t) => t.id as string));
    expect(BENCH_DISTRACTOR_TEMPLATES.some((t) => product.has(t.id))).toBe(false);
    expect(JSON.stringify(REPAIR_TEMPLATES)).not.toMatch(/bench_/);
    expect(apiTenantDecision("bench_overbroad", "isolated", "tenant-a", "tenant-a")).toBe("denies");
    expect(apiTenantDecision("bench_residual", "isolated", "tenant-b", "tenant-a")).toBe("allows");
    expect(apiTenantDecision("bench_residual", "isolated", "tenant-a", "tenant-b")).toBe("denies");
  });
});

describe("li-next D benchmark end to end (disposable leased LW-01 worlds, 127.0.0.1)", () => {
  it("catches every positive control, the reasoning selector is correct everywhere, rank-1 cannot abstain", async () => {
    const r = await runRepairBench();
    expect(r.failures).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.model).toEqual({ used: false, spend_usd: 0, real_model_selector: "disabled" });
    expect(new Set(r.selectors.map((s) => s.ai_selector))).toEqual(new Set(["scripted", "fake_model"]));
    expect(r.positive_controls.total).toBeGreaterThanOrEqual(5);
    expect(r.positive_controls.caught).toBe(r.positive_controls.total);
    const s = (c: string, sel: string) => r.scores.find((x) => x.case === c && x.selector === sel)!;
    // every class is present in the candidate sets
    const classes = new Set(r.cases.flatMap((c) => c.options.map((o) => o.class)));
    for (const k of ["correct", "wrong", "overbroad", "residual", "unobserved_trap"]) expect(classes.has(k as never)).toBe(true);
    expect(r.cases.find((c) => c.id === "tenant-isolation")!.options.some((o) => o.origin === "generator")).toBe(true);
    // tenant case
    expect(s("tenant-isolation", "reasoning")).toMatchObject({ selection_correct: true, prohibited: "blocked", legitimate: "preserved", regression: "reproduced" });
    expect(s("tenant-isolation", "fake_model_overbroad")).toMatchObject({ option_class: "overbroad", selection_correct: false, legitimate: "broken", caught: true });
    expect(s("tenant-isolation", "fake_model_residual")).toMatchObject({ option_class: "residual", selection_correct: false, prohibited: "still_observed", caught: true });
    expect(s("tenant-isolation", "fake_model_irrelevant")).toMatchObject({ option_class: "wrong", selection_correct: false, prohibited: "still_observed", caught: true });
    expect(s("tenant-isolation", "always_abstain")).toMatchObject({ selection_correct: false, prohibited: "unchanged_open", caught: true });
    // observer gap: restart is correct; the policy change never counts as blocked while unobserved
    expect(s("observer-gap", "reasoning")).toMatchObject({ selection_correct: true, prohibited: "blocked", legitimate: "preserved" });
    expect(s("observer-gap", "fake_model_irrelevant")).toMatchObject({ option_class: "unobserved_trap", selection_correct: false, caught: true });
    expect(s("observer-gap", "fake_model_irrelevant").prohibited).not.toBe("blocked");
    // no applicable candidate: abstaining is the correct, scored choice; rank-1 cannot abstain
    expect(s("no-applicable-candidate", "reasoning")).toMatchObject({ choice: ABSTAIN, selection_correct: true, abstained: true });
    expect(s("no-applicable-candidate", "rank1").selection_correct).toBe(false);
    // the selector view never carries the answer key, truth or verification results
    for (const c of r.cases) expect(c.view_digest).toMatch(/^[a-f0-9]{64}$/);
  }, 240_000);
});
