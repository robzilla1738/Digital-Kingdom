import { canonicalJson } from "@dk/contracts";
import { getBlueprint } from "./blueprints.ts";
import { sha256 } from "./catalog.ts";
import { WorldPlanError, compileWorld, instantiateBlueprint, previewWorld, type CompiledWorld } from "./compile.ts";
import { ScenarioError, checkScenarioAgainstWorld, parseScenario, type Scenario } from "./scenario/dsl.ts";

/**
 * LP29: local mission and scenario composer (`dk.local.mission.v1`).
 *
 * A mission is DATA: a mode (investigate / compare / verify / replay), a reviewed LP04 blueprint, an LP07 finite
 * scenario document (the stimulus schedule) and optional budget tightening. Composing never runs anything: it compiles
 * the LP04 world, validates the LP07 schedule against it, checks finiteness against the world budget, and splits the
 * result into two disjoint views:
 *
 *  - the BUILDER view (`truth`): the seed, the whole schedule, step labels/roles and expectations. This is private
 *    truth. It stays with the builder (browser draft, the mission file the local runner executes) and is never stored
 *    by the server; the server keeps only its SHA-256 commitment.
 *  - the INVESTIGATOR brief: mode, world components, declared sources, synthetic identities count, budget preview and
 *    observation gaps (the unknowns). No seed, no schedule, no labels, no roles, no expectations.
 *
 * An AI-assisted proposal is accepted only as JSON data that passes the same composer; it is never evaluated.
 */
export const MISSION_SCHEMA = "dk.local.mission.v1";
export const MISSION_MODES = ["investigate", "compare", "verify", "replay"] as const;
export type MissionMode = (typeof MISSION_MODES)[number];
export const MISSION_SCOPE = "local_only_synthetic_no_remote_setup" as const;
export const MISSION_LOCAL_NOTE = "Local only: reviewed blueprints, synthetic people and data, loopback services allocated by the local supervisor. No provider account, remote setup or outbound network is needed or used.";

export interface MissionDraft {
  schema: typeof MISSION_SCHEMA; id: string; title: string; mode: MissionMode;
  scenario: Scenario; budget?: { max_requests?: number; max_seconds?: number };
}
export interface BudgetPreview {
  steps: number; operations: number; span_ms: number;
  max_requests: number; max_seconds: number; max_parallel_operations: number; within_budget: boolean;
}
export interface MissionBrief {
  schema: "dk.local.mission_brief.v1"; mission_id: string; title: string; mode: MissionMode; scope: typeof MISSION_SCOPE;
  blueprint: string; blueprint_version: number; world_revision: string; catalog_version: string;
  components: { id: string; template: string; asset_kind: string | null }[];
  sources: { id: string; kind: string; role: string; independence_group: string }[];
  synthetic_identities: number; budget: BudgetPreview; unknowns: string[]; limitations: string[];
  truth_commitment: string; blinded_by_default: true; note: string;
}
export interface MissionTruth { schema: "dk.local.mission_truth.v1"; mission_id: string; seed: string; scenario: Scenario }
export type Composed =
  | { ok: true; draft: MissionDraft; brief: MissionBrief; truth: MissionTruth; world: CompiledWorld; preview: ReturnType<typeof previewWorld>; operations: OperationPreview[]; builder_counts: { faults: number; mutations: number; distractors: number; expectations: number } }
  | { ok: false; draft: unknown; issues: string[]; created: false };
/** Builder-only operation preview (part of private truth: it shows the schedule). */
export interface OperationPreview { index: number; at_ms: number; action: string; role: string; label: string | null; target: string | null }

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const isMap = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const OPERATION_ACTIONS = new Set(["request_route", "enqueue_job", "agent_send", "agent_search", "use_credential", "issue_credential", "revoke_credential", "publish_artifact", "select_artifact", "sign_in", "change_grant"]);

export const truthCommitment = (t: MissionTruth) => sha256(canonicalJson(t));

/** Compose and validate a draft. Never throws for a bad draft; the draft is returned untouched with every issue. */
export function composeMission(input: unknown): Composed {
  const fail = (issues: string[]): Composed => ({ ok: false, draft: input, issues, created: false });
  if (!isMap(input)) return fail(["/: mission must be an object"]);
  const issues: string[] = [];
  for (const k of Object.keys(input)) if (!["schema", "id", "title", "mode", "scenario", "budget"].includes(k)) issues.push(`/${k}: unknown field (missions carry data only: no commands, scripts, URLs or code)`);
  if (input.schema !== MISSION_SCHEMA) issues.push(`/schema must be ${MISSION_SCHEMA}`);
  if (typeof input.id !== "string" || !ID.test(input.id)) issues.push("/id must be a plain id");
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 120) issues.push("/title must be 1 to 120 characters");
  if (!MISSION_MODES.includes(input.mode as MissionMode)) issues.push(`/mode must be one of ${MISSION_MODES.join(", ")}`);
  if (input.budget !== undefined) {
    if (!isMap(input.budget)) issues.push("/budget must be an object");
    else for (const [k, v] of Object.entries(input.budget)) {
      if (!["max_requests", "max_seconds"].includes(k)) issues.push(`/budget/${k}: only max_requests and max_seconds can be tightened`);
      else if (!Number.isInteger(v) || (v as number) < 1) issues.push(`/budget/${k} must be a positive integer`);
    }
  }
  let scenario: Scenario | null = null;
  try { scenario = parseScenario(input.scenario); } catch (e) { if (e instanceof ScenarioError) issues.push(...e.issues.map((i) => `/scenario${i.startsWith("/") ? i : `/ ${i}`}`)); else throw e; }
  if (issues.length || !scenario) return fail(issues);
  const bp = getBlueprint(scenario.blueprint, scenario.blueprint_version);
  if (!bp) return fail([`/scenario/blueprint ${scenario.blueprint}@${scenario.blueprint_version} is not a reviewed blueprint`]);
  const tighten = (input.budget ?? {}) as { max_requests?: number; max_seconds?: number };
  for (const k of ["max_requests", "max_seconds"] as const) if (tighten[k] !== undefined && tighten[k]! > bp.budget[k]) issues.push(`/budget/${k} ${tighten[k]} exceeds the blueprint's reviewed ${bp.budget[k]} (budgets can only be tightened)`);
  if (issues.length) return fail(issues);
  let world: CompiledWorld;
  try { world = compileWorld(instantiateBlueprint(bp, { seed: scenario.seed, budget: { ...bp.budget, ...tighten } }), { blueprint: bp }); }
  catch (e) { if (e instanceof WorldPlanError) return fail(e.issues.map((i) => `/world${i}`)); throw e; }
  try { checkScenarioAgainstWorld(scenario, world); } catch (e) { if (e instanceof ScenarioError) return fail(e.issues.map((i) => `/scenario${i}`)); throw e; }
  const steps = scenario.steps;
  const operations = steps.filter((s) => OPERATION_ACTIONS.has(s.action)).length;
  const b = world.plan.budget;
  const budget: BudgetPreview = {
    steps: steps.length, operations,
    span_ms: steps.at(-1)!.at_ms, max_requests: b.max_requests, max_seconds: b.max_seconds, max_parallel_operations: b.max_parallel_operations,
    within_budget: operations <= b.max_requests && steps.at(-1)!.at_ms <= b.max_seconds * 1000,
  };
  if (!budget.within_budget) return fail([`/budget: ${operations} operations over ${budget.span_ms} ms exceed the world budget (${b.max_requests} requests, ${b.max_seconds}s)`]);
  const draft = input as unknown as MissionDraft;
  const truth: MissionTruth = { schema: "dk.local.mission_truth.v1", mission_id: draft.id, seed: scenario.seed, scenario };
  const preview = previewWorld(world);
  const brief: MissionBrief = {
    schema: "dk.local.mission_brief.v1", mission_id: draft.id, title: draft.title.trim(), mode: draft.mode, scope: MISSION_SCOPE,
    blueprint: bp.id, blueprint_version: bp.version, world_revision: world.revision, catalog_version: world.catalog.version,
    components: preview.resources.map((r) => ({ id: r.id, template: r.template, asset_kind: r.asset_kind })),
    sources: world.sources.map((s) => ({ id: s.id, kind: s.kind, role: s.role, independence_group: s.independence_group })),
    synthetic_identities: world.identities.length, budget, unknowns: [...world.gaps], limitations: [...world.limitations],
    truth_commitment: truthCommitment(truth), blinded_by_default: true, note: MISSION_LOCAL_NOTE,
  };
  const ops: OperationPreview[] = steps.map((s, index) => ({ index, at_ms: s.at_ms, action: s.action, role: s.role ?? "stimulus", label: s.label ?? null, target: s.resource ?? s.to ?? s.observer ?? s.source ?? s.subject ?? s.credential ?? s.artifact ?? s.actor ?? null }));
  const builder_counts = { faults: steps.filter((s) => s.role === "fault").length, mutations: steps.filter((s) => s.role === "mutation").length, distractors: steps.filter((s) => s.role === "distractor").length, expectations: scenario.expect.length };
  return { ok: true, draft, brief, truth, world, preview, operations: ops, builder_counts };
}

/**
 * AI-assisted proposal: accepted only as JSON data (an object, or a string holding exactly one JSON object) that the
 * composer validates. Nothing in it is evaluated, imported or executed; prose, code fences and code are refused.
 */
export function parseMissionProposal(proposal: unknown): Composed {
  let value = proposal;
  if (typeof proposal === "string") {
    const t = proposal.trim();
    if (!t.startsWith("{") || !t.endsWith("}")) return { ok: false, draft: proposal, issues: ["proposal must be exactly one JSON object (no prose, code fences or code)"], created: false };
    try { value = JSON.parse(t); } catch { return { ok: false, draft: proposal, issues: ["proposal is not valid JSON"], created: false }; }
  }
  return composeMission(value);
}

/** Strings that must never appear in an investigator-visible record for this mission (seed, labels, expectations). */
export function missionTruthMarkers(t: MissionTruth): string[] {
  const out = new Set<string>([t.seed, `dk-local-seed:${t.seed}`]);
  for (const s of t.scenario.steps) { if (s.label) out.add(s.label); if (s.value && s.value.length >= 8) out.add(s.value); }
  for (const e of t.scenario.expect) out.add(e.label);
  out.add(sha256(`dk-local-seed:${t.seed}`));
  return [...out].filter((m) => m.length >= 4);
}

/** One minimal benign schedule per reviewed blueprint (no seed: the builder draws one). Validated by tests. */
export const MISSION_STARTERS: Record<string, Scenario["steps"]> = {
  "saas-storefront": [
    { at_ms: 0, action: "sign_in", actor: "acct:tenant-a:user", as: "s1" },
    { at_ms: 10, action: "request_route", resource: "ingress", route: "GET /tenants/{tenant}/records", params: { tenant: "tenant-a" }, session: "s1", label: "own-read" },
  ],
  "agent-workspace": [{ at_ms: 0, action: "agent_send", run: "run-1", to: "allowed-receiver", value: "synthetic hello", label: "allowed-send" }],
  "delivery-identity": [{ at_ms: 0, action: "publish_artifact", name: "build-1", as: "a1", actor: "svc:builder", label: "publish" }],
};

/** Starter drafts built from the reviewed LP07 scenario documents (builder side only). */
export function draftFromScenario(scenario: Scenario, mode: MissionMode = "investigate"): MissionDraft {
  return { schema: MISSION_SCHEMA, id: `mission-${scenario.id.toLowerCase()}`, title: `${scenario.id} local mission`, mode, scenario };
}
