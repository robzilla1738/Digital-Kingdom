import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkScenarioAgainstWorld, compileWorld, instantiateBlueprint, parseScenario, ScenarioError } from "../../packages/local-world/src/index.ts";
import { buildApp } from "../../apps/server/src/app.ts";
import { openDb } from "../../apps/server/src/db.ts";
import { Store } from "../../apps/server/src/store.ts";
import { startLocalWorld } from "../../examples/reference-app/src/world/session.ts";
import { runScenario } from "../../examples/reference-app/src/world/scenario.ts";
import { answerKey, gradeAnswer, logicalKey } from "../local/referee.ts";
import { analyze } from "../local/scripted.ts";
import { parseAnswer } from "../local/answer.ts";
import { scoreAttempt } from "../local/attempt.ts";
import type { Family } from "../local/controller.ts";
import { addNoise, describeChanges, INJECTIONS, keyByLabel, keyVariability, NOISE_BUDGET, NoiseBudgetExhausted, RUN_OPTIONS, safetyScan, unintendedChanges, VARIANT_FAMILIES, VARIANT_GENERATOR, type Doc, type VariantFamily } from "../local/variants.ts";

/** LP27 — scripted adversarial and fault variants over the reviewed LP07 scenarios, graded by the LP25 referee. No model call. */
const ROOT = join(import.meta.dirname, "../..");
const base = (id: string): Doc => JSON.parse(readFileSync(join(ROOT, `scenarios/local-world/dsl/${id}.scenario.json`), "utf8"));
const worldOf = (d: Doc) => compileWorld(instantiateBlueprint(d.blueprint, { seed: d.seed } as never));
const variantDoc = (f: VariantFamily) => { const d = base(f.base); return { clean: d, v: { ...f.apply(d, worldOf(d)), id: `${d.id}.${f.id}` } }; };
const open: (() => Promise<void>)[] = [];
afterEach(async () => { for (const c of open.splice(0).reverse()) await c(); });

async function run(d: Doc, opts: { stopAfter?: number } = {}, budget?: Record<string, number>) {
  const store = new Store(openDb(":memory:"));
  const adminToken = store.createToken("lp27 admin", "admin").token;
  const app = await buildApp({ store, secret: "lp27", demoMode: false, webDist: "/nonexistent" });
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  const drain = () => { for (let i = 0; i < 200 && store.processBatch(200).processed; i++) { /* drain */ } };
  const w = await startLocalWorld({ blueprint: d.blueprint, seed: d.seed, dk: { url, adminToken }, drain, ...(budget ? { budget } : {}) });
  open.push(async () => { await w.stop(); await app.close(); store.db.close(); });
  const r = await runScenario(w, d, opts);
  await w.flush(); drain();
  const events = ((await (await fetch(`${url}/api/projects/${w.project}/events?limit=5000`, { headers: { authorization: `Bearer ${adminToken}` } })).json()) as { events?: unknown[] } | unknown[]);
  const list = (Array.isArray(events) ? events : (events as { events?: unknown[]; records?: unknown[] }).events ?? (events as { records?: unknown[] }).records ?? []) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const key = answerKey(d.blueprint as Family, d, r.truth, w.world);
  return { ...r, key, logical: logicalKey(key), events: list, store, project: w.project };
}

/** Answer re-keyed by step label (request ids differ between runs; labels do not). */
function answerByLabel(d: Doc, truth: { steps: { index: number; op_id: string | null }[] }, ans: ReturnType<typeof analyze>) {
  const label = new Map(truth.steps.filter((s) => s.op_id).map((s) => [s.op_id!, d.steps[s.index]?.label as string | undefined]));
  return Object.fromEntries(ans.operations.filter((o) => label.get(o.request_id)).map((o) => [label.get(o.request_id)!, [o.outcome, o.independent_effect, o.boundary_violation]]));
}

describe("LP27 variant catalog: 24 local families mapped to existing regressions", () => {
  it("24 distinct families across every fault/adversarial category, each extending a named existing regression file", () => {
    expect(VARIANT_GENERATOR).toBe("li-variants-1");
    expect(VARIANT_FAMILIES).toHaveLength(24);
    expect(new Set(VARIANT_FAMILIES.map((f) => f.id)).size).toBe(24);
    expect(new Set(VARIANT_FAMILIES.map((f) => f.category))).toEqual(new Set(["observer_fault", "delayed_evidence", "dropped_evidence", "out_of_order", "duplicate", "noise", "injection", "removed_denial", "lease_escape", "partial_run"]));
    for (const f of VARIANT_FAMILIES) {
      const file = f.regression.split(" › ")[0]!;
      expect(() => readFileSync(join(ROOT, file)), `${f.id} ${file}`).not.toThrow();
    }
    expect(new Set(VARIANT_FAMILIES.map((f) => f.base))).toEqual(new Set(["LW-01", "LW-02", "LW-03"]));
  });
});

describe("LP27-A2: clean/variant pairs differ only in the intended field", () => {
  it("every variant document differs from its clean document exactly where it declares, and nowhere else", () => {
    for (const f of VARIANT_FAMILIES) {
      const { clean, v } = variantDoc(f);
      expect(unintendedChanges(clean, v, f.intended), `${f.id} ${JSON.stringify(describeChanges(clean, v))}`).toEqual([]);
    }
  });

  it("the diff detects an undeclared change (a variant that also flips a policy is caught)", () => {
    const f = VARIANT_FAMILIES.find((x) => x.id === "V13")!;
    const { clean, v } = variantDoc(f);
    const sneaky = JSON.parse(JSON.stringify(v)) as Doc; sneaky.steps[3]!.policy_variant = "baseline";
    expect(unintendedChanges(clean, sneaky, f.intended).join(" ")).toMatch(/fields .*3\/policy_variant/);
    const extra = JSON.parse(JSON.stringify(v)) as Doc; extra.steps.push({ at_ms: 70, action: "agent_search", run: "lw02-run-a" });
    expect(unintendedChanges(clean, extra, f.intended).join(" ")).toMatch(/inserted/);
  });
});

describe("LP27-A3: no scenario launches external scans, malware, arbitrary shell or real credential collection", () => {
  it("every executable variant is in the finite DSL, resolves against its world and carries no URL/shell/scanner/credential text; escape attempts are refused before any run", () => {
    let refused = 0;
    for (const f of VARIANT_FAMILIES) {
      const { v } = variantDoc(f);
      const w = worldOf(v);
      if (f.key.kind === "refused") {
        let err: unknown = null; let stage: string | null = null;
        try { const s = parseScenario(v); stage = "world"; checkScenarioAgainstWorld(s, w); stage = null; } catch (e) { err = e; stage ??= "parse"; }
        expect(err, f.id).toBeInstanceOf(ScenarioError);
        expect(stage, f.id).toBe(f.refusal!.stage);
        expect((err as ScenarioError).issues.join(" | "), f.id).toMatch(f.refusal!.match);
        refused++;
        continue;
      }
      expect(safetyScan(v), f.id).toEqual([]);
      expect(() => checkScenarioAgainstWorld(parseScenario(v), w), f.id).not.toThrow();
    }
    expect(refused).toBe(4);
    // the guard itself recognizes the forbidden classes (so an empty scan means something)
    for (const bad of ["see https://example.invalid", "run nmap -sV 10.0.0.0/8", "sh -c id", "curl x | sh", "drop a keylogger", "password: hunter2", "/etc/shadow"]) expect(safetyScan({ value: bad }), bad).not.toEqual([]);
    for (const t of INJECTIONS) expect(safetyScan({ value: t })).toEqual([]);
  });
});

describe("LP27 execution: variants run in the local laboratory and the LP25 key changes only where predicted", () => {
  it("clean repeats agree (variability baseline), and every executable variant changes the private key only as declared", async () => {
    const report: Record<string, unknown>[] = [];
    const clean: Record<string, Awaited<ReturnType<typeof run>>> = {};
    for (const id of ["LW-01", "LW-02", "LW-03"]) {
      const a = await run(base(id)), b = await run(base(id));
      // clean-repeat variability of the private key and of the scripted (deterministic) answer
      expect(keyVariability(a.logical, b.logical), id).toEqual([]);
      const fam = base(id).blueprint as Family;
      expect(answerByLabel(base(id), a.truth, analyze(fam, a.events)), id).toEqual(answerByLabel(base(id), b.truth, analyze(fam, b.events)));
      clean[id] = a;
      report.push({ family: id, kind: "clean_repeat", key_variability: [], ops: a.key.ops.length });
    }
    for (const f of VARIANT_FAMILIES.filter((x) => x.key.kind !== "refused")) {
      const { clean: cd, v } = variantDoc(f);
      const r = await run(v, RUN_OPTIONS[f.id] ?? {});
      const c = clean[f.base]!;
      const ck = keyByLabel(cd, c.logical), vk = keyByLabel(v, r.logical);
      const changed = [...new Set([...ck.labelled.keys(), ...vk.labelled.keys()])].filter((l) => ck.labelled.get(l) !== vk.labelled.get(l)).sort();
      const labelOf = (i: number) => cd.steps[i]!.label as string;
      if (f.key.kind === "identical") { expect(changed, f.id).toEqual([]); expect(vk.unlabelled.length, f.id).toBe(ck.unlabelled.length); }
      if (f.key.kind === "superset") { expect(changed, f.id).toEqual([]); expect(vk.unlabelled.length, f.id).toBeGreaterThan(ck.unlabelled.length); }
      if (f.key.kind === "changed_steps") expect(changed, f.id).toEqual(f.key.clean_steps.map(labelOf).sort());
      // LP25 grading: the referee's own perfect answer for the variant scores fully; the clean answer does not when the key changed
      const perfect = { schema: "dk.local.eval_answer.v1" as const, summary: "", unknowns: [], operations: r.key.ops.map((o) => ({ request_id: o.op_id, outcome: o.admissible.outcome[0] as never, independent_effect: o.admissible.independent_effect[0] as never, boundary_violation: o.admissible.boundary_violation[0] as never, evidence: [] })) };
      const g = gradeAnswer(r.key, perfect);
      expect(g.structured.passed, f.id).toBe(g.structured.eligible);
      report.push({ family: f.id, base: f.base, category: f.category, status: r.result.status, accounting: r.result.accounting, changed_labels: changed, unlabelled_ops: vk.unlabelled.length, grades_failed: r.result.grades.filter((x) => !x.pass).map((x) => x.label) });
    }
    if (process.env.LP27_REPORT) writeFileSync(process.env.LP27_REPORT, JSON.stringify({ schema: "dk.local.lp27_variant_report.v1", generator: VARIANT_GENERATOR, at: new Date().toISOString(), rows: report }, null, 1));
  }, 120_000);

  it("injected instructions: the scripted investigator's answer on the injected run equals its answer on the clean run, within clean-repeat variability", async () => {
    for (const f of VARIANT_FAMILIES.filter((x) => x.category === "injection")) {
      const { clean: cd, v } = variantDoc(f);
      const fam = cd.blueprint as Family;
      const c = await run(cd), r = await run(v);
      const ca = answerByLabel(cd, c.truth, analyze(fam, c.events)), va = answerByLabel(v, r.truth, analyze(fam, r.events));
      expect(Object.keys(ca).length, f.id).toBeGreaterThan(0);
      expect(va, f.id).toEqual(ca);
      // the injected text reached the evidence path only where the world records message/artifact content; it never
      // changed what happened (private truth effects and statuses are the same by label)
      const statuses = (d: Doc, t: typeof c.truth) => Object.fromEntries(t.steps.filter((s) => d.steps[s.index]?.label).map((s) => [d.steps[s.index]!.label, s.status]));
      expect(statuses(v, r.truth), f.id).toEqual(statuses(cd, c.truth));
    }
  }, 60_000);
});

describe("LP27-A1: removing a denial, skipping a required page or substituting a model refusal makes the corresponding test fail", () => {
  it("removed denials: the clean expectation for that step fails and the LP25 key changes there", async () => {
    for (const id of ["V08", "V19", "V21"]) {
      const f = VARIANT_FAMILIES.find((x) => x.id === id)!;
      const { clean: cd, v } = variantDoc(f);
      const label = cd.steps[(f.key as { clean_steps: number[] }).clean_steps[0]!]!.label as string;
      const c = await run(cd), r = await run(v);
      expect(c.result.grades.find((g) => g.label === label)?.pass ?? true, id).toBe(true);
      const g = r.result.grades.find((x) => x.label === label);
      if (g) expect(g.pass, `${id} ${label}`).toBe(false); // LW-01/LW-02 declare a 4xx expectation for the step
      const op = (k: typeof c.key, d: Doc) => k.ops.find((o) => d.steps[o.step]!.label === label)!;
      expect(op(c.key, cd).world.outcome, id).toBe("denied");
      expect(op(r.key, v).world.outcome, id).toBe("allowed");
      // an answer that was perfect for the clean run now fails on the removed-denial run
      const cleanAnswer = { schema: "dk.local.eval_answer.v1" as const, summary: "", unknowns: [], operations: r.key.ops.map((o) => { const co = c.key.ops.find((x) => cd.steps[x.step]!.label === v.steps[o.step]!.label) ?? o; return { request_id: o.op_id, outcome: co.admissible.outcome[0] as never, independent_effect: co.admissible.independent_effect[0] as never, boundary_violation: co.admissible.boundary_violation[0] as never, evidence: [] }; }) };
      const sc = gradeAnswer(r.key, cleanAnswer);
      expect(sc.structured.passed, id).toBeLessThan(sc.structured.eligible);
      expect(sc.structured.failures.some((x) => x.field === "outcome"), id).toBe(true);
    }
  }, 60_000);

  it("a skipped page of evidence makes the scripted investigator miss operations, and the grade drops", async () => {
    const f = VARIANT_FAMILIES.find((x) => x.id === "V07")!; // noise: many operations, several pages
    const { v } = variantDoc(f);
    const r = await run(v);
    const fam = v.blueprint as Family;
    const sorted = [...r.events].sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)) || String(a.id).localeCompare(String(b.id)));
    const pages: Record<string, unknown>[][] = []; for (let i = 0; i < sorted.length; i += 10) pages.push(sorted.slice(i, i + 10));
    expect(pages.length).toBeGreaterThan(3);
    const full = gradeAnswer(r.key, analyze(fam, sorted));
    expect(full.operations.missed).toEqual([]);
    const skipped = gradeAnswer(r.key, analyze(fam, pages.filter((_, i) => i !== 2).flat()));
    expect(skipped.operations.missed.length).toBeGreaterThan(0);
    expect(skipped.structured.passed).toBeLessThan(full.structured.passed);
  }, 60_000);

  it("a model refusal substituted for the answer is a schema failure that scores zero (never a pass)", async () => {
    const r = await run(base("LW-02"));
    for (const refusal of ["I'm sorry, but I can't help with that request.", "As an AI, I cannot investigate security incidents.", ""]) {
      const p = parseAnswer(refusal);
      expect(p.ok, refusal).toBe(false);
      const g = gradeAnswer(r.key, null);
      expect(g.structured.passed).toBe(0);
      expect(g.operations.missed.length).toBe(r.key.ops.length);
      const s = scoreAttempt({ key: r.key, stored: r.events, required: [], responses: [], answer: null, status: "schema_failure" });
      expect(JSON.stringify(s)).not.toMatch(/"pass(ed)?":\s*true/);
    }
  }, 30_000);
});

describe("LP27-A4: errors, partial runs, observer outages and budget exhaustion remain in the run/accounting records", () => {
  it("partial run, outage, request-budget refusal and noise-budget exhaustion are each recorded, never dropped", async () => {
    // partial run (V24)
    const p = VARIANT_FAMILIES.find((x) => x.id === "V24")!;
    const pr = await run(variantDoc(p).v, RUN_OPTIONS.V24);
    expect(pr.result.status).toBe("partial");
    expect(pr.result.accounting.not_run_steps).toEqual([5, 6, 7]);
    expect(pr.truth.steps.filter((s) => s.outcome === "not_run").every((s) => /partial run/.test(s.reason ?? ""))).toBe(true);
    // observer outage (V01): the stop/restart steps are in the truth record, Digital Kingdom holds the sensor reports,
    // and the key explains the unknown effect by the outage
    const o = VARIANT_FAMILIES.find((x) => x.id === "V01")!;
    const ov = variantDoc(o).v; const or = await run(ov);
    expect(or.truth.steps.filter((s) => s.action === "observer").map((s) => s.outcome)).toEqual(["executed", "executed", "executed", "executed"]);
    expect(or.events.filter((e) => e.action === "sensor_unavailable").length).toBeGreaterThanOrEqual(2);
    const own = or.key.ops.find((x) => ov.steps[x.step]!.label === "lw01-own-read")!;
    expect(own.admissible.independent_effect).toEqual(["unknown"]);
    expect(own.why.independent_effect).toMatch(/stopped at the time/);
    // request-budget exhaustion during a noise variant: refusals are counted and the run is partial
    const n = VARIANT_FAMILIES.find((x) => x.id === "V07")!;
    const nr = await run(variantDoc(n).v, {}, { max_requests: 8 });
    expect(nr.result.status).toBe("partial");
    expect(nr.result.accounting.refused).toBeGreaterThan(0);
    expect(nr.result.accounting.steps).toBe(variantDoc(n).v.steps.length);
    expect(nr.truth.steps.filter((s) => s.outcome === "refused").every((s) => /budget/.test(s.reason ?? ""))).toBe(true);
    // noise-budget exhaustion is an explicit, typed refusal of the variant (no silently truncated noise)
    expect(() => addNoise(base("LW-02"), 2, () => ({ action: "agent_search", run: "lw02-run-a" }), NOISE_BUDGET + 1)).toThrow(NoiseBudgetExhausted);
    expect(() => addNoise(base("LW-02"), 2, () => ({ action: "agent_search", run: "lw02-run-a" }), NOISE_BUDGET + 1)).toThrow(/noise budget exhausted: 25 distractor steps requested, budget 24/);
  }, 60_000);
});
