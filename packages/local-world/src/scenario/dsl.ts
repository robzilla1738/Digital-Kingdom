import { templateMatches } from "@dk/graph-core";
import { TEMPLATE_CATALOG, type WorldTemplate } from "../catalog.ts";
import type { CompiledWorld } from "../compile.ts";

/**
 * LP07: the finite scenario and fault DSL (`dk.local.scenario.v1`).
 *
 * A scenario is data: a blueprint, a hidden seed, a scenario-clock start and an ordered schedule of steps drawn
 * from a FINITE action vocabulary. Every reference is a plain id that must resolve inside the compiled world (a
 * registered resource, a declared template route, a synthetic account, a declared source or observer). There is no
 * field that can carry a command, script, plugin, URL, host, port or header; unknown keys are rejected at every
 * level, and route parameters are single path segments. Labels and expectations are private truth: they are kept
 * for grading and never reach the observable evidence or the investigator.
 */
export const SCENARIO_SCHEMA = "dk.local.scenario.v1";
export const SCENARIO_ACTIONS = ["sign_in", "request_route", "enqueue_job", "agent_send", "agent_search", "issue_credential", "use_credential", "revoke_credential", "change_grant", "publish_artifact", "select_artifact", "set_policy", "observer", "evidence"] as const;
export type ScenarioAction = (typeof SCENARIO_ACTIONS)[number];

export interface ScenarioStep {
  at_ms: number; action: ScenarioAction; role?: "stimulus" | "distractor" | "mutation" | "fault"; label?: string;
  actor?: string; as?: string; session?: string; resource?: string; route?: string; params?: Record<string, string>; value?: string;
  run?: string; to?: string; subject?: string; credential?: string; grant?: string; op?: "add" | "remove"; artifact?: string; name?: string;
  policy_variant?: "baseline" | "candidate" | "deliberately_weak"; observer?: string; state?: "stop" | "restart"; source?: string; fault?: "delay" | "release" | "drop" | "restore";
}
export interface Scenario {
  schema: typeof SCENARIO_SCHEMA; id: string; version: number; blueprint: string; blueprint_version: number;
  seed: string; start: string; steps: ScenarioStep[];
  expect: { label: string; status_class?: "2xx" | "4xx" | "refused"; effect?: "observed" | "not_observed" | "unknown"; resource?: string }[];
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const PARAM = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const ALLOWED_STEP_KEYS = new Set(["at_ms", "action", "role", "label", "actor", "as", "session", "resource", "route", "params", "value", "run", "to", "subject", "credential", "grant", "op", "artifact", "name", "policy_variant", "observer", "state", "source", "fault"]);
/** Per action: the fields it requires and the fields it may carry. Anything else is rejected. */
const SHAPE: Record<ScenarioAction, { req: string[]; opt: string[] }> = {
  sign_in: { req: ["actor", "as"], opt: ["resource"] },
  request_route: { req: ["resource", "route"], opt: ["params", "session", "value"] },
  enqueue_job: { req: ["params", "session"], opt: [] },
  agent_send: { req: ["run", "to"], opt: ["value"] },
  agent_search: { req: ["run"], opt: [] },
  issue_credential: { req: ["subject", "as"], opt: [] },
  use_credential: { req: ["credential", "resource", "route"], opt: ["params"] },
  revoke_credential: { req: ["credential"], opt: [] },
  change_grant: { req: ["subject", "grant", "op"], opt: [] },
  publish_artifact: { req: ["name", "as"], opt: ["value", "actor"] },
  select_artifact: { req: ["artifact"], opt: [] },
  set_policy: { req: ["resource", "policy_variant"], opt: [] },
  observer: { req: ["observer", "state"], opt: [] },
  evidence: { req: ["source", "fault"], opt: [] },
};
const ROLE_OF: Partial<Record<ScenarioAction, ScenarioStep["role"]>> = { set_policy: "mutation", observer: "fault", evidence: "fault" };

export class ScenarioError extends Error { constructor(readonly issues: string[]) { super(`scenario rejected: ${issues.slice(0, 5).join("; ")}`); this.name = "ScenarioError"; } }

const isMap = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Validate the document shape (no world needed). */
export function parseScenario(input: unknown): Scenario {
  const issues: string[] = [];
  if (!isMap(input)) throw new ScenarioError(["/: scenario must be an object"]);
  const top = new Set(["schema", "id", "version", "blueprint", "blueprint_version", "seed", "start", "steps", "expect"]);
  for (const k of Object.keys(input)) if (!top.has(k)) issues.push(`/${k}: unknown field (scenarios carry no commands, scripts, plugins or URLs)`);
  if (input.schema !== SCENARIO_SCHEMA) issues.push(`/schema must be ${SCENARIO_SCHEMA}`);
  if (typeof input.id !== "string" || !ID.test(input.id)) issues.push("/id must be a plain id");
  if (!Number.isInteger(input.version) || (input.version as number) < 1) issues.push("/version must be a positive integer");
  if (typeof input.blueprint !== "string" || !ID.test(input.blueprint)) issues.push("/blueprint must be a reviewed blueprint id");
  if (!Number.isInteger(input.blueprint_version)) issues.push("/blueprint_version must be an integer");
  if (typeof input.seed !== "string" || !input.seed.length || input.seed.length > 200) issues.push("/seed must be a non-empty string of at most 200 characters");
  if (typeof input.start !== "string" || Number.isNaN(Date.parse(input.start)) || !/T.*(Z|[+-]\d{2}:?\d{2})$/.test(input.start)) issues.push("/start must be an ISO 8601 timestamp with an offset");
  if (!Array.isArray(input.steps) || !input.steps.length || input.steps.length > 200) issues.push("/steps must be a list of 1 to 200 steps");
  let prev = 0;
  const labels = new Set<string>();
  for (const [i, raw] of (Array.isArray(input.steps) ? input.steps : []).entries()) {
    const p = `/steps/${i}`;
    if (!isMap(raw)) { issues.push(`${p}: must be an object`); continue; }
    for (const k of Object.keys(raw)) if (!ALLOWED_STEP_KEYS.has(k)) issues.push(`${p}/${k}: unknown field (no commands, scripts, plugins, URLs, hosts or headers)`);
    const action = raw.action as ScenarioAction;
    if (!SCENARIO_ACTIONS.includes(action)) { issues.push(`${p}/action: ${JSON.stringify(String(raw.action).slice(0, 40))} is not in the finite action vocabulary (${SCENARIO_ACTIONS.join(", ")})`); continue; }
    if (!Number.isInteger(raw.at_ms) || (raw.at_ms as number) < 0 || (raw.at_ms as number) > 600_000) issues.push(`${p}/at_ms must be an integer between 0 and 600000`);
    else { if ((raw.at_ms as number) < prev) issues.push(`${p}/at_ms must not go backwards (schedule is ordered)`); prev = raw.at_ms as number; }
    const shape = SHAPE[action];
    for (const k of shape.req) if (raw[k] === undefined) issues.push(`${p}/${k}: required for ${action}`);
    for (const k of Object.keys(raw)) if (!["at_ms", "action", "role", "label", ...shape.req, ...shape.opt].includes(k) && ALLOWED_STEP_KEYS.has(k)) issues.push(`${p}/${k}: not a parameter of ${action}`);
    for (const k of ["actor", "as", "session", "resource", "run", "to", "subject", "credential", "artifact", "observer", "source", "label", "name"]) if (raw[k] !== undefined && (typeof raw[k] !== "string" || !ID.test(raw[k] as string))) issues.push(`${p}/${k} must be a plain id (no URL, path or host)`);
    if (raw.route !== undefined && (typeof raw.route !== "string" || !/^(GET|POST) \/[A-Za-z0-9_{}/.-]{0,200}$/.test(raw.route) || (raw.route as string).includes(".."))) issues.push(`${p}/route must be "GET|POST /declared/{template}"`);
    if (raw.params !== undefined) {
      if (!isMap(raw.params) || Object.keys(raw.params).length > 4) issues.push(`${p}/params must be an object of at most 4 path parameters`);
      else for (const [k, v] of Object.entries(raw.params)) if (!/^[a-z_]{1,20}$/.test(k) || typeof v !== "string" || !PARAM.test(v)) issues.push(`${p}/params/${k} must be a single path segment id`);
    }
    if (raw.value !== undefined && (typeof raw.value !== "string" || (raw.value as string).length > 500)) issues.push(`${p}/value must be a string of at most 500 characters`);
    if (raw.grant !== undefined && (typeof raw.grant !== "string" || !/^[a-z]+:[a-z0-9-]+$/.test(raw.grant as string))) issues.push(`${p}/grant must look like read:resource`);
    if (raw.op !== undefined && raw.op !== "add" && raw.op !== "remove") issues.push(`${p}/op must be add or remove`);
    if (raw.policy_variant !== undefined && !["baseline", "candidate", "deliberately_weak"].includes(raw.policy_variant as string)) issues.push(`${p}/policy_variant must be a reviewed variant`);
    if (raw.state !== undefined && raw.state !== "stop" && raw.state !== "restart") issues.push(`${p}/state must be stop or restart`);
    if (raw.fault !== undefined && !["delay", "release", "drop", "restore"].includes(raw.fault as string)) issues.push(`${p}/fault must be delay, release, drop or restore`);
    if (raw.role !== undefined && !["stimulus", "distractor", "mutation", "fault"].includes(raw.role as string)) issues.push(`${p}/role must be stimulus, distractor, mutation or fault`);
    if (ROLE_OF[action] && raw.role !== undefined && raw.role !== ROLE_OF[action]) issues.push(`${p}/role: ${action} is always a ${ROLE_OF[action]}`);
    if (typeof raw.label === "string") { if (labels.has(raw.label)) issues.push(`${p}/label ${raw.label} is not unique`); labels.add(raw.label); }
  }
  if (!Array.isArray(input.expect) || input.expect.length > 200) issues.push("/expect must be a list");
  for (const [i, e] of (Array.isArray(input.expect) ? input.expect : []).entries()) {
    if (!isMap(e)) { issues.push(`/expect/${i}: must be an object`); continue; }
    for (const k of Object.keys(e)) if (!["label", "status_class", "effect", "resource"].includes(k)) issues.push(`/expect/${i}/${k}: unknown field`);
    if (typeof e.label !== "string" || !labels.has(e.label)) issues.push(`/expect/${i}/label must name a labelled step`);
    if (e.status_class !== undefined && !["2xx", "4xx", "refused"].includes(e.status_class as string)) issues.push(`/expect/${i}/status_class must be 2xx, 4xx or refused`);
    if (e.effect !== undefined && !["observed", "not_observed", "unknown"].includes(e.effect as string)) issues.push(`/expect/${i}/effect must be observed, not_observed or unknown`);
    if (e.resource !== undefined && (typeof e.resource !== "string" || !ID.test(e.resource))) issues.push(`/expect/${i}/resource must be a plain id`);
  }
  if (issues.length) throw new ScenarioError(issues);
  const s = input as unknown as Scenario;
  return { ...s, steps: s.steps.map((st) => ({ ...st, role: st.role ?? ROLE_OF[st.action] ?? "stimulus" })) };
}

/** Resolve every reference against the compiled world. Unknown resources, routes, accounts, sources or observers are rejected. */
export function checkScenarioAgainstWorld(s: Scenario, world: CompiledWorld): void {
  const issues: string[] = [];
  const res = new Map(world.plan.resources.map((r) => [r.id, r]));
  const accounts = new Set(world.identities.map((i) => i.id));
  const sources = new Set(world.sources.map((x) => x.id));
  const observers = new Set(world.sources.filter((x) => x.role === "independent_observer").map((x) => x.id));
  const named = new Set<string>();
  const routed = (p: string, resource: string | undefined, route: string | undefined, params: Record<string, string> | undefined) => {
    const r = resource ? res.get(resource) : undefined;
    if (!r || r.template === "observer") { issues.push(`${p}/resource ${String(resource)} is not a registered resource of this world`); return; }
    const [m, tpl] = String(route).split(" ") as [string, string];
    if (!TEMPLATE_CATALOG[r.template as WorldTemplate].routes.some((x) => x.method === m && x.path === tpl)) issues.push(`${p}/route ${route} is not a declared route of ${resource} (${r.template})`);
    const holes = [...tpl.matchAll(/\{([a-z_]+)\}/g)].map((x) => x[1]!);
    for (const h of holes) if (!params?.[h]) issues.push(`${p}/params/${h}: required by ${route}`);
    for (const k of Object.keys(params ?? {})) if (!holes.includes(k)) issues.push(`${p}/params/${k}: ${route} has no {${k}} parameter`);
  };
  if (s.blueprint !== world.plan.plan_id.split("-v")[0]) issues.push(`/blueprint ${s.blueprint} does not match the world (${world.plan.plan_id})`);
  for (const [i, st] of s.steps.entries()) {
    const p = `/steps/${i}`;
    if (st.actor && !accounts.has(st.actor) && st.action !== "publish_artifact") issues.push(`${p}/actor ${st.actor} is not a synthetic account of this world`);
    if (st.subject && !accounts.has(st.subject)) issues.push(`${p}/subject ${st.subject} is not a synthetic account of this world`);
    if (st.session && !named.has(st.session)) issues.push(`${p}/session ${st.session} is not defined by an earlier sign_in`);
    if (st.credential && !named.has(st.credential)) issues.push(`${p}/credential ${st.credential} is not defined by an earlier issue_credential`);
    if (st.artifact && !named.has(st.artifact)) issues.push(`${p}/artifact ${st.artifact} is not defined by an earlier publish_artifact`);
    if (st.action === "request_route" || st.action === "use_credential") routed(p, st.resource, st.route, st.params);
    if (st.action === "enqueue_job") { const gw = world.plan.resources.find((r) => r.template === "gateway"); if (!gw) issues.push(`${p}: this world has no gateway for jobs`); else routed(p, gw.id, "POST /tenants/{tenant}/jobs", st.params); }
    if ((st.action === "agent_send" || st.action === "agent_search") && !world.plan.resources.some((r) => r.template === "agent_gateway")) issues.push(`${p}: this world has no agent gateway`);
    if (st.action === "agent_send" && (!st.to || res.get(st.to)?.template !== "receiver")) issues.push(`${p}/to must be a receiver resource of this world`);
    if (["issue_credential", "revoke_credential", "change_grant"].includes(st.action) && !world.plan.resources.some((r) => r.template === "local_issuer")) issues.push(`${p}: this world has no local issuer`);
    if (["publish_artifact", "select_artifact"].includes(st.action) && !world.plan.resources.some((r) => r.template === "artifact_depot")) issues.push(`${p}: this world has no artifact depot`);
    if (st.action === "set_policy") { const r = st.resource ? res.get(st.resource) : undefined; if (!r || !TEMPLATE_CATALOG[r.template as WorldTemplate].supported_settings.includes("policy_variant")) issues.push(`${p}/resource ${String(st.resource)} has no reviewed policy variant in this world`); }
    if (st.action === "observer" && !observers.has(st.observer!)) issues.push(`${p}/observer ${String(st.observer)} is not an observer of this world`);
    if (st.action === "evidence" && !sources.has(st.source!)) issues.push(`${p}/source ${String(st.source)} is not a declared source of this world`);
    if (st.as) { if (named.has(st.as)) issues.push(`${p}/as ${st.as} is already defined`); named.add(st.as); }
    if (st.at_ms > world.plan.budget.max_seconds * 1000) issues.push(`${p}/at_ms is beyond the world's ${world.plan.budget.max_seconds}s budget`);
  }
  for (const [i, e] of s.expect.entries()) if (e.resource && !res.has(e.resource)) issues.push(`/expect/${i}/resource ${e.resource} is not a resource of this world`);
  if (issues.length) throw new ScenarioError(issues);
}

/** Fill a declared route template with validated single-segment parameters. */
export function fillRoute(route: string, params: Record<string, string> = {}): { method: "GET" | "POST"; path: string; template: string } {
  const [m, tpl] = route.split(" ") as ["GET" | "POST", string];
  const path = tpl.replace(/\{([a-z_]+)\}/g, (_, k: string) => encodeURIComponent(params[k] ?? ""));
  if (!templateMatches(tpl, path)) throw new ScenarioError([`route ${route} could not be filled`]);
  return { method: m, path, template: tpl };
}
