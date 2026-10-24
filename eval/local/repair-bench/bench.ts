/**
 * li-next D — the LOCAL repair-SELECTION benchmark (`pnpm bench:repairs`). No model call; 127.0.0.1 only; synthetic data.
 *
 * Per case, in disposable LW-01 worlds started on a supervisor with leased lab actions:
 *   1. selection world: the launcher reports the run's configuration (and observer capability state), the investigator
 *      token is revoked, the LP14 generator lists its ranked candidates (`/repairs/ranked`, nothing persisted) and the
 *      benchmark adds its reviewed plan-only DISTRACTOR candidates; every selector chooses from the same
 *      investigator-visible `SelectorView` (or abstains with `no_applicable_candidate`). Nothing is executed yet.
 *   2. for every distinct chosen option: a FRESH leased world of the same scenario, the same option re-listed there
 *      (same template, target and typed actions; its plan is bound to that run), an exact supervisor lease for that plan,
 *      the typed action through the RepairController, and an INDEPENDENT verifier (separate identity) observing effects:
 *      prohibited operations, positive controls, and for observer gaps the observation handshake. A verified effect repair
 *      is captured as a regression and replayed model-free in its own fresh world.
 *   3. abstention is scored on the selection world without any change (prohibited operations re-observed).
 * Scores are reported separately per (case, selector): selection correctness (against the benchmark's private key),
 * observed prohibited effect, legitimate-behaviour preservation, regression retention, abstention outcome.
 * The run is `ok` only when every positive control (fake-model / always-abstain bad choice) is caught by the observed
 * effects, the reasoning selector is correct on every case, every correct execution verifies, and no bad choice ever
 * scores as an observed, verified, disruption-free repair.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, captureRegression, EffectVerifier, RepairController, verifyObserverRecovery, type VerificationProbe } from "../../../packages/local-world/src/index.ts";
import type { RepairPlan } from "../../../packages/contracts/src/index.ts";
import { replayRegression } from "../../../examples/reference-app/src/lab/regression-replay.ts";
import { startLocalCase, type LocalCase } from "../controller.ts";
import { actionsOf, distractorOptions, optionKey, type BenchOption, type OptionClass, type StateElement } from "./distractors.ts";
import { ABSTAIN, FAKE_MODEL_SELECTORS, SCRIPTED_SELECTORS, type Selector, type SelectorView, type VisibleProbe } from "./selectors.ts";

const ROOT = join(import.meta.dirname, "../../..");
const sha = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : canonicalJson(v)).digest("hex");
const git = (...a: string[]) => { try { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return null; } };

export type CaseKind = "tenant" | "observer_gap" | "unobservable";
export interface BenchCase { id: string; kind: CaseKind; question: string; objective: { prohibited: VisibleProbe[]; permitted: VisibleProbe[] }; distractors: string[]; correct_generator_templates: string[]; expect_abstain: boolean }
const A2B: VisibleProbe = { id: "a-reads-b", kind: "tenant_access", from: "ingress", to: "tenant-db", tenant: "tenant-a", target_tenant: "tenant-b" };
const B2A: VisibleProbe = { id: "b-reads-a", kind: "tenant_access", from: "ingress", to: "tenant-db", tenant: "tenant-b", target_tenant: "tenant-a" };
const AOWN: VisibleProbe = { id: "a-reads-own", kind: "tenant_access", from: "ingress", to: "tenant-db", tenant: "tenant-a", target_tenant: "tenant-a" };
const BOWN: VisibleProbe = { id: "b-reads-own", kind: "tenant_access", from: "ingress", to: "tenant-db", tenant: "tenant-b", target_tenant: "tenant-b" };
export const BENCH_CASES: BenchCase[] = [
  { id: "tenant-isolation", kind: "tenant", question: "Cross-tenant record reads succeed at the tenant API. Stop every cross-tenant read while both tenants keep reading their own records.",
    objective: { prohibited: [A2B, B2A], permitted: [AOWN, BOWN] }, distractors: ["edge-session-policy", "tenant-api-lockdown", "tenant-b-allowlist"], correct_generator_templates: ["restore-reviewed-policy", "combined"], expect_abstain: false },
  { id: "observer-gap", kind: "observer_gap", question: "Cross-tenant reads stopped appearing in the audit evidence. The audit observer gap must not hold; tenant-a must keep reading its own records.",
    objective: { prohibited: [{ id: "audit-observer-gap", kind: "observer_gap", source_id: "audit" }], permitted: [AOWN] }, distractors: ["tenant-policy-instead-of-observer"], correct_generator_templates: ["restart-supervised-observer"], expect_abstain: false },
  { id: "no-applicable-candidate", kind: "unobservable", question: "Queue deliveries are known only from the worker's own reports. Close the queue observation gap; tenant-a must keep reading its own records.",
    objective: { prohibited: [{ id: "queue-observer-gap", kind: "observer_gap", source_id: "queue" }], permitted: [AOWN] }, distractors: ["restart-running-observer", "edge-session-policy"], correct_generator_templates: [], expect_abstain: true },
];

interface Prepared {
  c: LocalCase; options: BenchOption[]; elements: StateElement[]; stateHash: string; ranked: { status: string; observation_prerequisites?: { observer_id: string; state: string; probes: string[] }[] };
  sessions: Record<"a" | "b", Record<string, string>>; verifierToken: string; generatorHttp: number;
}
async function prepare(bc: BenchCase): Promise<Prepared> {
  const doc = JSON.parse(readFileSync(join(ROOT, "scenarios/local-world/dsl/LW-01.scenario.json"), "utf8"));
  const c = await startLocalCase(doc, { lab: "leased", guided: false, benchmarkDistractors: true });
  try {
    c.revokeInvestigator();
    const w = c.private.world, run = w.run, P = `/api/projects/${c.public.project}`;
    if (bc.kind === "observer_gap") run.observer(w.operatorToken, "audit").stop("benchmark: audit observer outage");
    const o = await c.adminApi("POST", `${P}/local-observers`, run.observerCapabilities(w.operatorToken));
    const cf = await c.adminApi("POST", `${P}/local-configuration`, run.configuration(w.operatorToken));
    if (o.status !== 200 || cf.status !== 200) throw new Error(`launcher reports refused: observers ${o.status}, configuration ${cf.status}`);
    const st = await c.adminApi("GET", `${P}/analysis/state`);
    const stateHash = String(st.json?.state_hash);
    const elements = (st.json?.state?.elements ?? []) as StateElement[];
    const gen = await c.adminApi("POST", `${P}/cases/${c.public.case_id}/repairs/ranked`, { base_state_hash: stateHash, objective: bc.objective });
    if (gen.status !== 200) throw new Error(`generator HTTP ${gen.status}: ${JSON.stringify(gen.json).slice(0, 300)}`);
    type Cand = { rank: number; valid: boolean; template: { id: string }; target: string; explanation: string; plan: RepairPlan; tradeoffs: { objective_coverage: { blocked: number; of: number; still_possible: string[]; unknown: string[] }; disruption: { permitted_broken: string[] }; prerequisites: string[]; unknowns: string[] }; expected_impact: { probe: string; role: "prohibited" | "permitted"; before: { holds: string }; after: { holds: string } }[] };
    // the generator can list the same change for several probes: each listing stays a distinct option (#g<rank>)
    const generated: BenchOption[] = (gen.json.candidates as Cand[]).map((x) => ({
      key: `${optionKey(x.template.id, x.plan)}#g${x.rank}`, origin: "generator", class: (bc.correct_generator_templates.includes(x.template.id) ? "correct" : "wrong") as OptionClass, template: x.template.id, target: x.target, explanation: x.explanation, plan: x.plan, actions: actionsOf(x.plan),
      predicted: { valid: x.valid, blocked: x.tradeoffs.objective_coverage.blocked, of: x.tradeoffs.objective_coverage.of, still_possible: x.tradeoffs.objective_coverage.still_possible, unknown: x.tradeoffs.objective_coverage.unknown, permitted_broken: x.tradeoffs.disruption.permitted_broken, unknowns: x.tradeoffs.unknowns },
      expected_impact: x.expected_impact.map((e) => ({ probe: e.probe, role: e.role, before: e.before.holds as never, after: e.after.holds as never })), prerequisites: x.tradeoffs.prerequisites, generator_rank: x.rank,
    }));
    const runId = generated[0]?.plan.run_id ?? run.run_id;
    const distractors = distractorOptions({ ids: bc.distractors, elements, state_hash: stateHash, run_id: runId, case_id: c.public.case_id.replace(/[^A-Za-z0-9_.:-]/g, "-"), prohibited: bc.objective.prohibited, permitted: bc.objective.permitted, now: Date.now() });
    const a = await w.login("acct:tenant-a:user"), b = await w.login("acct:tenant-b:user");
    const verifierToken = w.supervisor.issue(run.run_id, { resources: "*", actions: ["request_route", "read_effects"] });
    return { c, options: [...generated, ...distractors], elements, stateHash, ranked: gen.json, sessions: { a: { "x-world-session": a }, b: { "x-world-session": b } }, verifierToken, generatorHttp: gen.status };
  } catch (e) { await c.stop(); throw e; }
}

/** Merged ranking on the generator's recorded criteria, applied to every option's predicted tradeoffs. */
function mergedRank(opts: BenchOption[]) {
  return opts.slice().sort((x, y) => (Number(y.predicted.valid) - Number(x.predicted.valid)) || (y.predicted.blocked - x.predicted.blocked) || (x.predicted.permitted_broken.length - y.predicted.permitted_broken.length) || (x.predicted.unknowns.length - y.predicted.unknowns.length) || ((x.generator_rank ?? 99) - (y.generator_rank ?? 99)) || x.key.localeCompare(y.key));
}
/** The investigator-visible view: no truth, no oracle, no answer key, no verification result. */
export function buildView(bc: BenchCase, p: Pick<Prepared, "options" | "elements" | "stateHash" | "ranked">, caseRef: string): { view: SelectorView; idToKey: Map<string, string> } {
  const ranked = mergedRank(p.options);
  const ids = ranked.slice().sort((x, y) => sha(`${bc.id}|${x.key}`).localeCompare(sha(`${bc.id}|${y.key}`)));
  const idToKey = new Map(ids.map((o, i) => [`o${i + 1}`, o.key]));
  const idOf = new Map([...idToKey].map(([k, v]) => [v, k]));
  const view: SelectorView = {
    schema: "dk.bench.selector_view.v1",
    case: { case_ref: caseRef, question: bc.question, objective: bc.objective },
    evidence: {
      analysis_state_hash: p.stateHash,
      observers: p.elements.filter((e) => e.kind === "observer").map((e) => ({ observer_id: String(e.attrs.observer_id), state: String(e.attrs.state), observes: e.attrs.observes as string[], declared: e.attrs.declared as string[] })),
      policies: p.elements.filter((e) => e.kind === "policy").map((e) => ({ resource_id: String(e.attrs.asset_id), template: String(e.attrs.template), variant: String(e.attrs.variant) })),
      generator_status: p.ranked.status, observation_prerequisites: (p.ranked.observation_prerequisites ?? []).map((x) => ({ observer_id: x.observer_id, state: x.state, probes: x.probes })),
    },
    options: ranked.map((o, i) => ({ option_id: idOf.get(o.key)!, rank: i + 1, template: o.template, target: o.target, explanation: o.explanation, actions: o.actions, plan: o.plan, predicted: { ...o.predicted, basis: "model_only" as const }, expected_impact: o.expected_impact, prerequisites: o.prerequisites })).sort((x, y) => x.option_id.localeCompare(y.option_id, undefined, { numeric: true })),
    abstain_choice: ABSTAIN,
  };
  return { view, idToKey };
}

export interface Effect {
  key: string | typeof ABSTAIN; run_id: string; lease: string; execution_state: string; plan_digest: string | null;
  prohibited: "blocked" | "still_observed" | "unknown" | "unchanged_open" | "not_applicable"; prohibited_detail: Record<string, string>;
  legitimate: "preserved" | "broken" | "unknown"; legitimate_detail: Record<string, string>;
  security_verdict: string | null; verification: string; regression: "reproduced" | "not_reproduced" | "not_applicable"; regression_detail: string;
}
function tenantProbes(p: Prepared): VerificationProbe[] {
  const req = (s: "a" | "b", t: string) => ({ resource: "ingress", method: "GET" as const, path: `/tenants/${t}/records`, headers: p.sessions[s] });
  const eff = { observer: "audit", resource: "tenant-db" };
  return [
    { id: "a-reads-b", expectation: "prohibited", request: req("a", "tenant-b"), effect: eff }, { id: "b-reads-a", expectation: "prohibited", request: req("b", "tenant-a"), effect: eff },
    { id: "a-reads-own", expectation: "permitted", request: req("a", "tenant-a"), effect: eff }, { id: "b-reads-own", expectation: "permitted", request: req("b", "tenant-b"), effect: eff },
  ];
}
const ownRead = (p: Prepared): VerificationProbe => tenantProbes(p)[2]!;
const crossRead = (p: Prepared): VerificationProbe => tenantProbes(p)[0]!;
const legit = (obs: { status: number; answer: { status: string } }[]) => obs.every((o) => o.status < 300 && o.answer.status === "observed") ? "preserved" as const : obs.some((o) => o.status >= 400 || o.answer.status === "not_observed") ? "broken" as const : "unknown" as const;

/** Abstention: nothing changes; re-observe the case's operations on the selection world. */
async function abstainEffect(bc: BenchCase, p: Prepared): Promise<Effect> {
  const run = p.c.private.world.run, v = new EffectVerifier(run, p.verifierToken);
  const base: Effect = { key: ABSTAIN, run_id: run.run_id, lease: "none (abstained)", execution_state: "not_executed", plan_digest: null, prohibited: "not_applicable", prohibited_detail: {}, legitimate: "unknown", legitimate_detail: {}, security_verdict: null, verification: "no change", regression: "not_applicable", regression_detail: "nothing executed" };
  if (bc.kind === "tenant") {
    const o = await v.observe(tenantProbes(p), { repeats: 1 });
    const pro = o.filter((x) => x.probe.expectation === "prohibited"), per = o.filter((x) => x.probe.expectation === "permitted");
    return { ...base, prohibited: pro.some((x) => x.answer.status === "observed") ? "unchanged_open" : "unknown", prohibited_detail: Object.fromEntries(pro.map((x) => [x.probe.id, x.answer.status])), legitimate: legit(per), legitimate_detail: Object.fromEntries(per.map((x) => [x.probe.id, `${x.status} ${x.answer.status}`])) };
  }
  const per = await v.observe([ownRead(p)], { repeats: 1 });
  const gap = bc.kind === "observer_gap" ? "unchanged_open" as const : "unknown" as const;
  return { ...base, prohibited: gap, prohibited_detail: { [bc.objective.prohibited[0]!.id]: bc.kind === "observer_gap" ? "audit observer still stopped" : "no independent observer of the queue exists in this world" }, legitimate: legit(per), legitimate_detail: Object.fromEntries(per.map((x) => [x.probe.id, `${x.status} ${x.answer.status}`])) };
}

/** Execute one chosen option in a FRESH leased world under an exact lease, then verify independently. */
async function executeOption(bc: BenchCase, key: string): Promise<Effect> {
  const p = await prepare(bc);
  const w = p.c.private.world, run = w.run, lab = p.c.private.lab!;
  const blank: Effect = { key, run_id: run.run_id, lease: "not issued", execution_state: "not_executed", plan_digest: null, prohibited: "unknown", prohibited_detail: {}, legitimate: "unknown", legitimate_detail: {}, security_verdict: null, verification: "not run", regression: "not_applicable", regression_detail: "no verified effect repair" };
  try {
    const opt = p.options.find((o) => o.key === key);
    if (!opt) return { ...blank, verification: "the chosen option was not reproduced in the fresh world (not executed)" };
    const plan = opt.plan;
    const v = new EffectVerifier(run, p.verifierToken);
    const probes = bc.kind === "tenant" ? tenantProbes(p) : [];
    const before = probes.length ? await v.observe(probes, { repeats: 1 }) : [];
    const ctl = w.supervisor.issueControllerToken(lab.operator, run.run_id);
    let lease;
    try { lease = w.supervisor.issueLease(lab.operator, { run_id: run.run_id, plan, controller_token: ctl }); }
    catch (e) { return { ...blank, lease: `refused: ${String((e as Error).message).slice(0, 200)}`, verification: "not run (lease refused)" }; }
    const execution = await new RepairController(run, ctl).execute(lease.token, plan);
    const common = { ...blank, lease: `issued ${lease.lease.lease_id} (exact plan ${plan.plan_id})`, execution_state: execution.state, plan_digest: sha(plan) };
    if (bc.kind === "tenant") {
      let ver = await v.verify({ plan, execution, probes, before });
      await w.flush(); await w.stop(); ver = v.finalize(ver);
      const pro = ver.observations.filter((o) => probes.find((x) => x.id === o.probe_id)?.expectation === "prohibited");
      const per = ver.observations.filter((o) => probes.find((x) => x.id === o.probe_id)?.expectation === "permitted");
      const group = (os: typeof pro) => Object.fromEntries([...new Set(os.map((o) => o.probe_id))].map((id) => [id, [...new Set(os.filter((o) => o.probe_id === id).map((o) => o.actual_effect))].join("|")]));
      const proD = group(pro), perD = group(per);
      const prohibited = ver.residual_access.length ? "still_observed" as const : Object.values(proD).every((x) => x === "not_observed") ? "blocked" as const : "unknown" as const;
      const legitimate = ver.disruption.length ? "broken" as const : Object.values(perD).every((x) => x === "observed") ? "preserved" as const : "unknown" as const;
      let regression: Effect["regression"] = "not_applicable", regDetail = `security verdict ${ver.security_verdict} / whole run ${ver.whole_run.outcome}: only a verified repair becomes a regression`;
      if (ver.security_verdict === "pass" && ver.whole_run.success) {
        const rg = captureRegression({ world: run.world, blueprint: "saas-storefront", blueprint_version: 1, seed: String(p.c.private.doc.seed), defect: [{ resource_id: "api", setting: "policy_variant", value: "deliberately_weak" }],
          principals: [{ ref: "principal-1", account: "acct:tenant-a:user", headers: p.sessions.a }, { ref: "principal-2", account: "acct:tenant-b:user", headers: p.sessions.b }],
          probes, plan, execution, verification: ver, lesson: "Cross-tenant reads at the tenant API must be refused while each tenant keeps reading its own records.", case_id: plan.case_id, control_ids: ["ctl-tenant-isolation"],
          secrets: [p.sessions.a["x-world-session"]!, p.sessions.b["x-world-session"]!, w.operatorToken, ctl, lab.operator] });
        const rp = await replayRegression(rg);
        regression = rp.reproduced ? "reproduced" : "not_reproduced"; regDetail = `${rg.regression_id}: ${rp.reproduced ? "reproduced in a fresh world (llm not_used)" : rp.reasons.join("; ")}`;
      }
      return { ...common, prohibited, prohibited_detail: proD, legitimate, legitimate_detail: perD, security_verdict: ver.security_verdict, verification: `EffectVerifier ${ver.security_verdict} / ${ver.whole_run.outcome}`, regression, regression_detail: regDetail };
    }
    // observer cases: the observation handshake decides whether observation was restored; never "blocked" by absence
    let hs: { outcome: string; reasons: string[] };
    try { hs = await verifyObserverRecovery(run, p.verifierToken, { plan, execution, handshake: [ownRead(p)] }); }
    catch (e) { hs = { outcome: "not_applicable", reasons: [`the plan restores no observer: ${String((e as Error).message).slice(0, 200)}`] }; }
    const own = await v.observe([ownRead(p)], { repeats: 1 });
    const cross = await v.observe([crossRead(p)], { repeats: 1 });
    const gapId = bc.objective.prohibited[0]!.id;
    const prohibited = bc.kind === "observer_gap" ? (hs.outcome === "verified" ? "blocked" as const : "unknown" as const) : "unknown" as const;
    return { ...common, prohibited, prohibited_detail: { [gapId]: bc.kind === "observer_gap" ? `observation handshake ${hs.outcome}` : `no independent observer of the queue exists (handshake ${hs.outcome})`, "a-reads-b (diagnostic)": `${cross[0]!.status} ${cross[0]!.answer.status}` },
      legitimate: own[0]!.status < 300 ? (own[0]!.answer.status === "not_observed" ? "broken" : "preserved") : "broken", legitimate_detail: { [own[0]!.probe.id]: `${own[0]!.status} ${own[0]!.answer.status}` },
      security_verdict: null, verification: `observation handshake ${hs.outcome}${hs.reasons.length ? ` (${hs.reasons.slice(0, 2).join("; ").slice(0, 300)})` : ""}`, regression: "not_applicable", regression_detail: "restoring observation is not an effect repair; LP23 regressions cover effect repairs" };
  } finally { await p.c.stop(); }
}

export interface Score {
  case: string; selector: string; ai_selector: "scripted" | "fake_model"; choice: string; option: string | null; option_class: OptionClass | "abstain"; origin: string | null; rationale: string;
  selection_correct: boolean; prohibited: Effect["prohibited"]; legitimate: Effect["legitimate"]; regression: Effect["regression"]; abstained: boolean; abstention_outcome: string | null;
  run_id: string; lease: string; verification: string; positive_control: boolean; caught: boolean | null; consistent: boolean; notes: string[];
}
function score(bc: BenchCase, sel: Selector, choice: string, rationale: string, opt: BenchOption | null, e: Effect): Score {
  const abstained = choice === ABSTAIN;
  const cls: Score["option_class"] = abstained ? "abstain" : opt!.class;
  const correct = bc.expect_abstain ? abstained : cls === "correct";
  const notes: string[] = [];
  // the effect evidence a bad choice must show (independent of the key)
  const harmShown = cls === "overbroad" ? e.legitimate === "broken" : cls === "residual" ? e.prohibited === "still_observed" : cls === "abstain" ? e.prohibited !== "blocked" : e.prohibited !== "blocked";
  const goodShown = e.prohibited === "blocked" && e.legitimate === "preserved" && (bc.kind !== "tenant" || (e.security_verdict === "pass" && e.regression === "reproduced"));
  let consistent = true;
  if (!correct && goodShown) { consistent = false; notes.push("KEY/OBSERVATION DISAGREEMENT: a bad choice produced a verified, disruption-free repair"); }
  if (correct && !abstained && !goodShown) { consistent = false; notes.push("a correct choice did not verify (observed effects or regression missing)"); }
  if (cls === "unobserved_trap" && e.prohibited === "blocked") { consistent = false; notes.push("an unobserved operation was counted as blocked"); }
  const positive = sel.kind === "fake_model" || sel.id === "always_abstain" ? !correct : false;
  return {
    case: bc.id, selector: sel.id, ai_selector: sel.kind === "fake_model" ? "fake_model" : "scripted", choice, option: opt ? `${opt.template} ${opt.actions.join("; ")}` : null, option_class: cls, origin: opt?.origin ?? null, rationale,
    selection_correct: correct, prohibited: e.prohibited, legitimate: e.legitimate, regression: e.regression, abstained, abstention_outcome: abstained ? (correct ? "correct abstention: no option was safe" : `abstained although a safe option existed; prohibited ${e.prohibited}`) : null,
    run_id: e.run_id, lease: e.lease, verification: e.verification, positive_control: positive, caught: positive ? (!correct && harmShown) : null, consistent, notes,
  };
}

export interface BenchReceipt {
  schema: "dk.bench.repair_selection_receipt.v1"; candidate: { commit: string | null; dirty: boolean | null; node: string; platform: string }; started_at: string; ended_at: string;
  model: { used: false; spend_usd: 0; real_model_selector: "disabled" }; scope: "local_only_synthetic"; selectors: { id: string; ai_selector: "scripted" | "fake_model" }[];
  cases: { id: string; kind: CaseKind; expect_abstain: boolean; generator_status: string; options: { option_id: string; rank: number; key: string; origin: string; class: OptionClass; generator_rank: number | null; predicted_safe: boolean }[]; view_digest: string; effects: Effect[] }[];
  scores: Score[]; summary: Record<string, { correct: number; of: number; prohibited_blocked: number; legitimate_preserved: number; regression_reproduced: number; abstained: number }>;
  positive_controls: { total: number; caught: number; missed: string[] }; failures: string[]; ok: boolean; limitations: string[];
}

export async function runRepairBench(o: { cases?: BenchCase[]; selectors?: Selector[] } = {}): Promise<BenchReceipt> {
  const started = new Date().toISOString();
  const selectors = o.selectors ?? [...SCRIPTED_SELECTORS, ...FAKE_MODEL_SELECTORS];
  const cases: BenchReceipt["cases"] = []; const scores: Score[] = []; const failures: string[] = [];
  for (const bc of o.cases ?? BENCH_CASES) {
    const p0 = await prepare(bc);
    let view: SelectorView, idToKey: Map<string, string>, choices: { sel: Selector; s: { choice: string; rationale: string } }[], abstain: Effect;
    try {
      ({ view, idToKey } = buildView(bc, p0, p0.c.public.case_id));
      choices = [];
      for (const sel of selectors) choices.push({ sel, s: await sel.select(structuredClone(view)) }); // nothing has been executed or verified yet
      abstain = await abstainEffect(bc, p0);
    } finally { await p0.c.stop(); }
    const effects = new Map<string, Effect>([[ABSTAIN, abstain]]);
    for (const { s } of choices) {
      const key = s.choice === ABSTAIN ? ABSTAIN : idToKey.get(s.choice)!;
      if (!effects.has(key)) effects.set(key, await executeOption(bc, key).catch((e: Error) => ({ key, run_id: "n/a", lease: "n/a", execution_state: "error", plan_digest: null, prohibited: "unknown" as const, prohibited_detail: {}, legitimate: "unknown" as const, legitimate_detail: {}, security_verdict: null, verification: `bench error: ${String(e.message).slice(0, 300)}`, regression: "not_applicable" as const, regression_detail: "bench error" })));
    }
    const byKey = new Map(p0.options.map((x) => [x.key, x]));
    for (const { sel, s } of choices) {
      const key = s.choice === ABSTAIN ? ABSTAIN : idToKey.get(s.choice)!;
      scores.push(score(bc, sel, s.choice, s.rationale, key === ABSTAIN ? null : byKey.get(key)!, effects.get(key)!));
    }
    cases.push({ id: bc.id, kind: bc.kind, expect_abstain: bc.expect_abstain, generator_status: p0.ranked.status, view_digest: sha(view),
      options: view.options.map((v) => { const x = byKey.get(idToKey.get(v.option_id)!)!; return { option_id: v.option_id, rank: v.rank, key: x.key, origin: x.origin, class: x.class, generator_rank: x.generator_rank, predicted_safe: v.predicted.valid && v.predicted.blocked === v.predicted.of && !v.predicted.permitted_broken.length && !v.predicted.still_possible.length && !v.predicted.unknown.length }; }),
      effects: [...effects.values()] });
  }
  const summary: BenchReceipt["summary"] = {};
  for (const s of scores) {
    const r = (summary[s.selector] ??= { correct: 0, of: 0, prohibited_blocked: 0, legitimate_preserved: 0, regression_reproduced: 0, abstained: 0 });
    r.of++; r.correct += Number(s.selection_correct); r.prohibited_blocked += Number(s.prohibited === "blocked"); r.legitimate_preserved += Number(s.legitimate === "preserved"); r.regression_reproduced += Number(s.regression === "reproduced"); r.abstained += Number(s.abstained);
  }
  const pcs = scores.filter((s) => s.positive_control);
  const missed = pcs.filter((s) => !s.caught).map((s) => `${s.case}/${s.selector}`);
  if (!pcs.length) failures.push("no positive control was exercised");
  if (missed.length) failures.push(`positive control(s) not caught: ${missed.join(", ")}`);
  for (const s of scores.filter((x) => !x.consistent)) failures.push(`${s.case}/${s.selector}: ${s.notes.join("; ")}`);
  for (const s of scores.filter((x) => x.selector === "reasoning" && !x.selection_correct)) failures.push(`reasoning selector incorrect on ${s.case}`);
  const status = git("status", "--porcelain");
  return {
    schema: "dk.bench.repair_selection_receipt.v1", candidate: { commit: git("rev-parse", "HEAD"), dirty: status === null ? null : status.length > 0, node: process.version, platform: `${process.platform}-${process.arch}` },
    started_at: started, ended_at: new Date().toISOString(), model: { used: false, spend_usd: 0, real_model_selector: "disabled" }, scope: "local_only_synthetic",
    selectors: selectors.map((s) => ({ id: s.id, ai_selector: s.kind === "fake_model" ? "fake_model" as const : "scripted" as const })),
    cases, scores, summary, positive_controls: { total: pcs.length, caught: pcs.length - missed.length, missed }, failures, ok: failures.length === 0,
    limitations: [
      "No real model selected anything: selectors are scripted or fake-model (deterministic transports through the model adapter). The real-model selector is disabled and has no provider transport.",
      "Distractor predictions come from the benchmark's declared distractor semantics (dk.bench.distractor_model.v1) and are accurate by construction; a case where the model mispredicts an option's effect is not covered.",
      "Selection correctness is scored against the benchmark's private answer key; the observed effects are scored independently and must agree with it (a disagreement fails the run).",
      "Host-process mode: trusted built-in services and typed operations only; not an OS isolation boundary. Overbroad/residual variants exist only on a supervisor started with benchmarkDistractorVariants.",
      "One world family (saas-storefront, LW-01) and three cases; this is a harness check, not a statistical measure of any selector.",
    ],
  };
}
