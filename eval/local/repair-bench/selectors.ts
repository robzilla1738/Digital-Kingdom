/**
 * li-next D — repair SELECTORS for the local repair-selection benchmark (no model call, no network).
 *
 * A selector sees only a `SelectorView`: the case question and objective, investigator-visible model state (the
 * analysis-state digest, the supervisor-reported observer and policy elements, the generator's observation
 * prerequisites) and the candidate options with their MODEL-PREDICTED effects. It never sees scenario truth, the
 * private oracle, the benchmark answer key (which option is a distractor and of which class) or any verification
 * result: the view type has no field for them, and the bench builds the view before anything is executed.
 *
 * Selectors:
 *  - `rank1`               scripted baseline: the option ranked first, always (cannot abstain while options exist).
 *  - `reasoning`           scripted deterministic reasoning over visible data only; abstains with
 *                          `no_applicable_candidate` when no option is predicted to block every prohibited operation
 *                          while keeping every positive control and leaving no prohibited operation unknown.
 *  - fake-model selectors  the MODEL ADAPTER path (prompt → transport → parsed choice) with deterministic fake
 *                          transports that prefer overbroad / residual / irrelevant options. They are positive controls:
 *                          the scorer must catch their choices from observed effects.
 *  - `always_abstain`      scripted control: abstains even when a safe option exists.
 *  - `rehearsal`           scripted: shortlists the top-k (k ≤ 3) predicted-safe options by rank and REHEARSES each
 *                          through a bench-provided capability: its own fresh disposable leased world (separate
 *                          supervisor, lease, typed op, journal), torn down afterwards. It reads back only what an
 *                          operator can observe there — the independent verifier's observed effect per case probe
 *                          (holds / does_not_hold / unknown) — never truth, oracle, answer key or class. Options whose
 *                          prediction is contradicted are discarded; UNKNOWN is never read as blocked; the first
 *                          CONFIRMED option by rank is chosen, otherwise it abstains with `no_applicable_candidate`.
 *  - real model            `createModelSelector` — DISABLED. It refuses without an explicit authorization (budget +
 *                          approver), and even with one this batch ships no provider transport: no network code exists here.
 */
import type { RepairPlan } from "../../../packages/contracts/src/index.ts";

export type Holds = "holds" | "does_not_hold" | "unknown";
export interface VisibleProbe { id: string; kind: string; [k: string]: string }
export interface VisibleOption {
  option_id: string; rank: number; template: string; target: string; explanation: string; actions: string[];
  plan: RepairPlan;
  predicted: { valid: boolean; blocked: number; of: number; still_possible: string[]; unknown: string[]; permitted_broken: string[]; unknowns: string[]; basis: "model_only" };
  expected_impact: { probe: string; role: "prohibited" | "permitted"; before: Holds; after: Holds }[];
  prerequisites: string[];
}
export interface SelectorView {
  schema: "dk.bench.selector_view.v1";
  case: { case_ref: string; question: string; objective: { prohibited: VisibleProbe[]; permitted: VisibleProbe[] } };
  evidence: { analysis_state_hash: string; observers: { observer_id: string; state: string; observes: string[]; declared: string[] }[]; policies: { resource_id: string; template: string; variant: string }[]; generator_status: string; observation_prerequisites: { observer_id: string; state: string; probes: string[] }[] };
  options: VisibleOption[];
  abstain_choice: "no_applicable_candidate";
}
export const ABSTAIN = "no_applicable_candidate" as const;
export interface Selection { choice: string; rationale: string; rehearsal?: RehearsalRecord }
export type SelectorKind = "scripted" | "fake_model" | "model";
/** What a rehearsal returns: operator-observable effects only (no class, key, truth, oracle or verdict). */
export interface RehearsalResult {
  run_id: string; lease: string; execution_state: string; wall_ms: number;
  probes: { probe: string; role: "prohibited" | "permitted"; observed: Holds; detail: string }[];
  teardown: { run_state: string; lease_state: string; tokens_revoked: boolean; journal_entries: number };
}
export interface RehearsalVerdict { option_id: string; rank: number; verdict: "confirmed" | "contradicted" | "unknown"; contradicted: string[]; unknown: string[]; run_id: string; lease: string; execution_state: string; wall_ms: number; teardown: RehearsalResult["teardown"] }
export interface RehearsalRecord { k: number; shortlisted: string[]; verdicts: RehearsalVerdict[]; worlds_started: number; wall_ms: number }
/** Optional capabilities the bench hands a selector. `rehearse` runs one option in its own disposable leased world. */
export interface SelectorContext { rehearse?: (option_id: string) => Promise<RehearsalResult> }
export interface Selector { id: string; kind: SelectorKind; select(view: SelectorView, ctx?: SelectorContext): Promise<Selection> }

const byRank = (v: SelectorView) => v.options.slice().sort((a, b) => a.rank - b.rank);
/** Predicted safe: blocks every prohibited operation, keeps every positive control, nothing prohibited left unknown. */
export const predictedSafe = (o: VisibleOption) =>
  o.predicted.valid && o.predicted.blocked === o.predicted.of && o.predicted.still_possible.length === 0 && o.predicted.unknown.length === 0 && o.predicted.permitted_broken.length === 0
  && o.expected_impact.every((x) => x.role === "prohibited" ? x.after === "does_not_hold" : x.after === "holds");

export const rank1Selector: Selector = {
  id: "rank1", kind: "scripted",
  async select(v) { const o = byRank(v)[0]; return o ? { choice: o.option_id, rationale: `rank ${o.rank} (hardcoded rank-1 baseline)` } : { choice: ABSTAIN, rationale: "no options" }; },
};
export const reasoningSelector: Selector = {
  id: "reasoning", kind: "scripted",
  async select(v) {
    const safe = byRank(v).filter(predictedSafe);
    if (!safe.length) {
      const why = v.options.map((o) => `${o.option_id}: ${!o.predicted.blocked ? "blocks nothing" : o.predicted.permitted_broken.length ? `breaks ${o.predicted.permitted_broken.join(",")}` : o.predicted.still_possible.length ? `leaves ${o.predicted.still_possible.join(",")} open` : "leaves a prohibited operation unknown"}`);
      return { choice: ABSTAIN, rationale: `no option is predicted to block every prohibited operation while keeping every positive control${why.length ? ` (${why.join("; ")})` : ""}` };
    }
    const o = safe[0]!;
    return { choice: o.option_id, rationale: `${o.option_id} (rank ${o.rank}) is predicted to block ${o.predicted.blocked}/${o.predicted.of} prohibited and keep every positive control; ${safe.length - 1} other safe option(s)` };
  },
};
/** Compare an option's visible prediction with a rehearsal's observed effects. Unknown stays unknown (never blocked). */
export function classifyRehearsal(o: VisibleOption, r: RehearsalResult): Pick<RehearsalVerdict, "verdict" | "contradicted" | "unknown"> {
  const contradicted: string[] = [], unknown: string[] = [];
  if (r.execution_state !== "completed") return { verdict: "unknown", contradicted, unknown: [`execution ${r.execution_state}: nothing was observed for this option`] };
  for (const x of o.expected_impact) {
    if (x.after === "unknown") { unknown.push(`${x.probe}: no prediction`); continue; }
    const got = r.probes.find((p) => p.probe === x.probe);
    if (!got || got.observed === "unknown") { unknown.push(`${x.probe}: rehearsal observed unknown${got ? ` (${got.detail})` : " (not probed)"}`); continue; }
    if (got.observed !== x.after) contradicted.push(`${x.probe}: predicted ${x.after}, rehearsal observed ${got.observed} (${got.detail})`);
  }
  return { verdict: contradicted.length ? "contradicted" : unknown.length || !o.expected_impact.length ? "unknown" : "confirmed", contradicted, unknown };
}
export const REHEARSAL_K = 3;
export const rehearsalSelector: Selector = {
  id: "rehearsal", kind: "scripted",
  async select(v, ctx) {
    const t0 = Date.now();
    const shortlist = byRank(v).filter(predictedSafe).slice(0, REHEARSAL_K);
    const record: RehearsalRecord = { k: REHEARSAL_K, shortlisted: shortlist.map((o) => o.option_id), verdicts: [], worlds_started: 0, wall_ms: 0 };
    if (!shortlist.length) return { choice: ABSTAIN, rationale: "no option is predicted safe; nothing to rehearse", rehearsal: record };
    if (!ctx?.rehearse) return { choice: ABSTAIN, rationale: "no rehearsal capability was provided; an unrehearsed prediction is not trusted", rehearsal: record };
    for (const o of shortlist) {
      record.worlds_started++;
      const r = await ctx.rehearse(o.option_id);
      record.verdicts.push({ option_id: o.option_id, rank: o.rank, ...classifyRehearsal(o, r), run_id: r.run_id, lease: r.lease, execution_state: r.execution_state, wall_ms: r.wall_ms, teardown: r.teardown });
    }
    record.wall_ms = Date.now() - t0;
    const sum = record.verdicts.map((x) => `${x.option_id}: ${x.verdict}${x.contradicted.length ? ` (${x.contradicted.join("; ")})` : x.unknown.length ? ` (${x.unknown.join("; ")})` : ""}`).join(" | ");
    const pick = record.verdicts.find((x) => x.verdict === "confirmed");
    if (!pick) return { choice: ABSTAIN, rationale: `every shortlisted option was contradicted or unknown in rehearsal: ${sum}`.slice(0, 1500), rehearsal: record };
    return { choice: pick.option_id, rationale: `${pick.option_id} (rank ${pick.rank}) confirmed in its own rehearsal world; ${sum}`.slice(0, 1500), rehearsal: record };
  },
};
export const alwaysAbstainSelector: Selector = { id: "always_abstain", kind: "scripted", async select() { return { choice: ABSTAIN, rationale: "control: always abstains" }; } };

// ------------------------------------------------------------------------------------------------ model adapter
/** What a model sees: exactly the view, serialised. Nothing else is ever put in a prompt. */
export function renderSelectorPrompt(v: SelectorView): string {
  return [
    "You choose one local repair option for a security case, or abstain.",
    `Answer with JSON {"choice": "<option_id>" | "${ABSTAIN}", "rationale": "..."}. Abstain when no option blocks every prohibited operation while keeping every permitted one.`,
    "VIEW:", JSON.stringify(v),
  ].join("\n");
}
export function parseModelChoice(text: string, v: SelectorView): Selection {
  const m = /\{[\s\S]*\}/.exec(text);
  let j: { choice?: unknown; rationale?: unknown };
  try { j = JSON.parse(m?.[0] ?? ""); } catch { return { choice: ABSTAIN, rationale: "unparseable model answer: treated as abstention (recorded)" }; }
  const c = String(j.choice ?? "");
  if (c !== ABSTAIN && !v.options.some((o) => o.option_id === c)) return { choice: ABSTAIN, rationale: `model named an option that does not exist (${c.slice(0, 40)}): treated as abstention (recorded)` };
  return { choice: c, rationale: String(j.rationale ?? "").slice(0, 500) };
}
export interface ModelTransport { readonly kind: "fake" | "provider"; complete(prompt: string): Promise<string> }
export const modelSelector = (id: string, transport: ModelTransport): Selector => ({
  id, kind: transport.kind === "fake" ? "fake_model" : "model",
  async select(v) { return parseModelChoice(await transport.complete(renderSelectorPrompt(v)), v); },
});
/** A deterministic fake "model": reads ONLY the prompt text (the serialised view) and applies a preference. */
export function fakeTransport(prefer: (v: SelectorView) => VisibleOption | undefined, label: string): ModelTransport {
  return {
    kind: "fake",
    async complete(prompt) {
      const v = JSON.parse(prompt.slice(prompt.indexOf("VIEW:\n") + 6)) as SelectorView;
      const o = prefer(v);
      return JSON.stringify(o ? { choice: o.option_id, rationale: `fake model (${label})` } : { choice: ABSTAIN, rationale: `fake model (${label}): nothing matches its preference` });
    },
  };
}
const ranked = (v: SelectorView) => byRank(v);
export const FAKE_MODEL_SELECTORS: Selector[] = [
  // prefers the option that "blocks the most", regardless of the positive controls it breaks
  modelSelector("fake_model_overbroad", fakeTransport((v) => ranked(v).find((o) => o.predicted.blocked > 0 && o.predicted.permitted_broken.length > 0), "prefers broad blocking")),
  // prefers a partial fix: blocks something, leaves another prohibited operation open
  modelSelector("fake_model_residual", fakeTransport((v) => ranked(v).find((o) => o.predicted.blocked > 0 && o.predicted.still_possible.length > 0), "prefers partial fixes")),
  // prefers an option that blocks nothing (irrelevant change; for an observer gap: a policy change that does not restore observation)
  modelSelector("fake_model_irrelevant", fakeTransport((v) => ranked(v).find((o) => o.predicted.blocked === 0), "prefers an irrelevant change")),
];
export const SCRIPTED_SELECTORS: Selector[] = [rank1Selector, reasoningSelector, rehearsalSelector, alwaysAbstainSelector];

/** The real-LLM selector. DISABLED: refuses without explicit authorization; this batch has no provider transport. */
export interface ModelAuthorization { flag: "--allow-model-selector"; budget_usd: number; approved_by: string }
export class ModelSelectorDisabled extends Error { constructor(m: string) { super(m); this.name = "ModelSelectorDisabled"; } }
export function createModelSelector(auth?: Partial<ModelAuthorization> | null): Selector {
  if (!auth || auth.flag !== "--allow-model-selector" || !(typeof auth.budget_usd === "number" && auth.budget_usd > 0 && auth.budget_usd <= 5) || !auth.approved_by)
    throw new ModelSelectorDisabled("real-model selector disabled: pass --allow-model-selector --budget-usd <0..5] --approved-by <name> with an applicable written authorization");
  return modelSelector("model", {
    kind: "provider",
    async complete() { throw new ModelSelectorDisabled("no provider transport is implemented in this batch (li-next D ships scripted and fake-model selectors only); wiring one is a separate, approved change"); },
  });
}
