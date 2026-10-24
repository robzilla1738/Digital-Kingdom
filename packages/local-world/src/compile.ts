import { canonicalJson, validateWorldPlan, LOCAL_CONTRACTS, LOCAL_LAB_LABEL, type Asset, type CompiledScene, type EventAction, type Graph, type Relationship, type WorldPlan } from "@dk/contracts";
import { matchDeclaredRoutes, zoneForKind } from "@dk/graph-core";
import { compileScene, defaultProposal } from "@dk/scene-compiler";
import { CATALOG_VERSION, TEMPLATE_CATALOG, catalogDigest, sha256, templateDigest, type WorldTemplate } from "./catalog.ts";
import { getBlueprint, type Blueprint, type BlueprintResource } from "./blueprints.ts";

/**
 * LP04: deterministic world-plan instantiation and compilation.
 *
 * instantiate(blueprint, seed) -> dk.local.world_plan.v1 (the seed itself is never in the plan, only its sha256
 * commitment), and compile(plan) -> a logical graph, declared sources with independent authority, a route
 * ownership table that keeps ambiguity, synthetic identities, explicit observation gaps and a castle layout from the
 * existing trusted scene compiler. Same plan => byte-identical output; any change => a new revision.
 */
export const COMPILED_WORLD_SCHEMA = "dk.local.compiled_world.v1";
export const WORLD_ENVIRONMENT = "local";
export const IDENTITY_NAMESPACE = "local-world:accounts";
export const RUN_NAMESPACE = "local-world:agent-runs";

export class WorldPlanError extends Error { constructor(readonly issues: string[]) { super(`world plan rejected: ${issues.slice(0, 5).join("; ")}`); this.name = "WorldPlanError"; } }

export const seedCommitment = (seed: string) => sha256(`dk-local-seed:${seed}`);

export interface InstantiateOptions { seed: string; project_id?: string; plan_id?: string; runtime_mode?: WorldPlan["runtime_mode"]; budget?: Partial<WorldPlan["budget"]> }

/** A reviewed blueprint + seed -> a validated world plan. The plan is pure data: no endpoint, command or URL. */
export function instantiateBlueprint(bp: Blueprint | string, opts: InstantiateOptions): WorldPlan {
  const b = typeof bp === "string" ? getBlueprint(bp) : bp;
  if (!b) throw new WorldPlanError([`unknown blueprint ${String(bp)}`]);
  if (typeof opts.seed !== "string" || !opts.seed.length || opts.seed.length > 200) throw new WorldPlanError(["seed must be a non-empty string of at most 200 characters"]);
  const plan: WorldPlan = {
    schema: "dk.local.world_plan.v1",
    plan_id: opts.plan_id ?? `${b.id}-v${b.version}`,
    project_id: opts.project_id ?? `lab-${b.id}`,
    data_origin: "synthetic_local",
    seed_commitment: seedCommitment(opts.seed),
    catalog_version: CATALOG_VERSION,
    resources: b.resources.map((r) => ({ id: r.id, template: r.template, depends_on: [...r.depends_on], settings: { ...r.settings } })),
    budget: { ...b.budget, ...(opts.budget ?? {}) },
    runtime_mode: opts.runtime_mode ?? "trusted_builtin_processes",
    external_network: false,
  };
  return checkPlan(plan);
}

/** Schema + LP03 semantics + catalog semantics. Throws WorldPlanError listing every issue. */
export function checkPlan(input: unknown): WorldPlan {
  const v = validateWorldPlan(input);
  if (!v.ok) throw new WorldPlanError(v.errors);
  const p = v.value!;
  const issues: string[] = [];
  if (p.catalog_version !== CATALOG_VERSION) issues.push(`/catalog_version ${p.catalog_version} is not the reviewed catalog ${CATALOG_VERSION}`);
  const byId = new Map(p.resources.map((r) => [r.id, r]));
  for (const r of p.resources) {
    const t = TEMPLATE_CATALOG[r.template as WorldTemplate];
    for (const k of Object.keys(r.settings)) if (!t.supported_settings.includes(k as never)) issues.push(`/resources/${r.id}/settings/${k} is not a supported setting of template ${r.template} (supported: ${t.supported_settings.join(", ") || "none"})`);
    for (const d of r.depends_on) {
      const dep = byId.get(d);
      if (dep?.template === "observer") issues.push(`/resources/${r.id} depends on observer ${d}: observers are independent and nothing may depend on them`);
      if (r.template === "observer" && dep && !TEMPLATE_CATALOG[dep.template as WorldTemplate].observable_effects.length) issues.push(`/resources/${r.id} observes ${d}, which has no effect tap to observe`);
    }
    if (r.template === "observer" && !r.depends_on.length) issues.push(`/resources/${r.id} observer must be attached to at least one resource`);
  }
  if (issues.length) throw new WorldPlanError(issues);
  return p;
}

export interface WorldSource { id: string; label: string; kind: string; asset_ids: string[]; independence_group: string; role: "self_report" | "independent_observer"; attached_to: string; identity_namespace?: string; run_namespace?: string }
export interface RouteOwnership { key: string; method: string; path: string; declared_by: string[]; owners: string[]; status: "resolved" | "ambiguous" }
export interface ObservationEntry { asset_id: string; template: string; self_reported: { source_id: string; actions: EventAction[] } | null; independently_observed: { source_id: string; actions: EventAction[] }[]; gaps: string[] }
export interface WorldIdentity { id: string; namespace: string; tenant: string | null; role: string; display_name: string; synthetic: true }
export interface CompiledWorld {
  schema: typeof COMPILED_WORLD_SCHEMA;
  revision: string;
  plan: WorldPlan;
  plan_digest: string;
  catalog: { version: string; digest: string };
  templates: { resource_id: string; template: string; version: string; digest: string }[];
  graph: Graph;
  sources: WorldSource[];
  routes: RouteOwnership[];
  identities: WorldIdentity[];
  observation: ObservationEntry[];
  gaps: string[];
  limitations: string[];
  scene: CompiledScene;
  layout_digest: string;
  provenance: { contract: string; data_origin: "synthetic_local"; label: string; endpoints: "allocated_by_supervisor_at_start"; credentials: "none_required" };
}

export interface CompileOptions { previousScene?: CompiledScene | null; blueprint?: Blueprint | null }

/** Deterministic compiler. Same plan (+ same previous scene) => identical output. */
export function compileWorld(planInput: unknown, opts: CompileOptions = {}): CompiledWorld {
  const plan = checkPlan(planInput);
  const planDigest = sha256(canonicalJson(plan));
  const revision = `lw-${sha256(canonicalJson({ catalog: catalogDigest(), plan: planDigest })).slice(0, 16)}`;
  const bp = opts.blueprint ?? inferBlueprint(plan);
  const tpl = (r: { template: string }) => TEMPLATE_CATALOG[r.template as WorldTemplate];
  const assetsRes = plan.resources.filter((r) => tpl(r).asset_kind !== null);
  const observers = plan.resources.filter((r) => r.template === "observer");
  const names = new Map((bp?.resources ?? []).map((r: BlueprintResource) => [r.id, r.name]));

  const assets: Asset[] = assetsRes.map((r) => {
    const t = tpl(r); const kind = t.asset_kind!;
    const a: Asset = { id: r.id, name: names.get(r.id) ?? r.id, kind, environment: WORLD_ENVIRONMENT, allowed_zone_ids: [zoneForKind(kind)], source_refs: [`world:${plan.plan_id}`], lifecycle: "active", secondary_label: `${r.template}@${t.version}` };
    if (t.routes.length) a.routes = t.routes.map((x) => ({ path: x.path, methods: [x.method] }));
    return a;
  }).sort((a, b) => a.id.localeCompare(b.id));
  const assetIds = new Set(assets.map((a) => a.id));
  const relationships: Relationship[] = [];
  for (const r of assetsRes) for (const d of r.depends_on) {
    if (!assetIds.has(d)) continue;
    const target = plan.resources.find((x) => x.id === d)!;
    const kind = tpl(target).inbound_relationship;
    relationships.push({ id: `rel-${r.id}-${d}`, source_id: r.id, target_id: d, kind, evidence_level: "declared", evidence_refs: [`world:${plan.plan_id}`], assumptions: "Declared by the reviewed world plan; runtime calls are established only by observed events." });
  }
  relationships.sort((a, b) => a.id.localeCompare(b.id));
  const graph: Graph = { schema_version: "0.2", dataset_kind: "live", project_id: plan.project_id, graph_revision: revision, assets, relationships };

  // Declared sources: each with its own independence group. Observer authority comes from the plan, never a payload.
  const sources: WorldSource[] = [];
  for (const r of assetsRes) {
    const t = tpl(r);
    if (!t.self_reports || r.settings.audit_enabled === false) continue;
    sources.push({ id: `${r.id}-sdk`, label: `${names.get(r.id) ?? r.id} instrumentation (self-report)`, kind: t.self_reports.source_kind, asset_ids: [r.id], independence_group: `self:${r.id}`, role: "self_report", attached_to: r.id,
      ...(t.self_reports.source_kind === "agent_observer" ? { run_namespace: RUN_NAMESPACE } : { identity_namespace: IDENTITY_NAMESPACE }) });
  }
  for (const o of observers) {
    if (o.settings.audit_enabled === false) continue;
    sources.push({ id: o.id, label: `${names.get(o.id) ?? o.id} (independent observer)`, kind: "effect_observer", asset_ids: o.depends_on.filter((d) => assetIds.has(d)).sort(), independence_group: `observer:${o.id}`, role: "independent_observer", attached_to: o.id, run_namespace: RUN_NAMESPACE, identity_namespace: IDENTITY_NAMESPACE });
  }
  sources.sort((a, b) => a.id.localeCompare(b.id));

  // Route ownership: every declared route resolved against the whole graph; more than one owner stays ambiguous.
  const routeKeys = new Map<string, { method: string; path: string; declared_by: string[] }>();
  for (const a of assets) for (const r of a.routes ?? []) for (const m of r.methods ?? []) {
    const key = `${m} ${r.path}`; const cur = routeKeys.get(key) ?? { method: m, path: r.path, declared_by: [] };
    cur.declared_by.push(a.id); routeKeys.set(key, cur);
  }
  const routes: RouteOwnership[] = [...routeKeys.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => {
    const owners = matchDeclaredRoutes(graph, { path: v.path, method: v.method as never, environment: WORLD_ENVIRONMENT }).map((m) => m.asset_id).sort();
    return { key, method: v.method, path: v.path, declared_by: v.declared_by.sort(), owners, status: owners.length === 1 ? "resolved" : "ambiguous" };
  });

  // Observation table and explicit gaps.
  const observation: ObservationEntry[] = assetsRes.map((r) => {
    const t = tpl(r);
    const self = sources.find((s) => s.role === "self_report" && s.attached_to === r.id);
    const watching = observers.filter((o) => o.depends_on.includes(r.id));
    const independent = watching.filter((o) => o.settings.audit_enabled !== false).map((o) => ({ source_id: o.id, actions: [...t.observable_effects] }));
    const gaps: string[] = [];
    if (t.self_reports && !self) gaps.push(`${r.id}: its instrumentation is disabled (audit_enabled: false); ${t.self_reports.actions.join(", ")} are not reported`);
    if (t.observable_effects.length && !independent.length) gaps.push(watching.length ? `${r.id}: observer ${watching.map((o) => o.id).join(", ")} is attached but disabled; ${t.observable_effects.join(", ")} effects are not independently observed` : `${r.id}: no independent observer is attached; ${t.observable_effects.join(", ")} effects are not independently observed`);
    if (!self && !independent.length) gaps.push(`${r.id}: no source reports anything about this resource`);
    return { asset_id: r.id, template: r.template, self_reported: self ? { source_id: self.id, actions: [...t.self_reports!.actions] } : null, independently_observed: independent, gaps };
  }).sort((a, b) => a.asset_id.localeCompare(b.asset_id));
  const gaps = [
    ...observation.flatMap((o) => o.gaps),
    ...routes.filter((r) => r.status === "ambiguous").map((r) => `route ${r.key}: declared by ${r.owners.join(" and ")}; a path alone does not identify the owner`),
    ...(plan.runtime_mode === "trusted_builtin_processes" ? ["runtime mode trusted_builtin_processes: built-in services run as supervisor-owned host listeners; OS-level network isolation is not enforced (the supervisor's action client refuses every unregistered destination instead)"] : []),
  ];

  // Synthetic identities: stable ids by role, display names chosen deterministically from the seed commitment.
  const identities: WorldIdentity[] = (bp?.accounts ?? []).map((a) => ({ id: a.id, namespace: IDENTITY_NAMESPACE, tenant: a.tenant, role: a.role, display_name: a.display_pool[parseInt(sha256(`${plan.seed_commitment}:${a.id}`).slice(0, 8), 16) % a.display_pool.length]!, synthetic: true as const }));

  const seedInt = parseInt(plan.seed_commitment.slice(0, 8), 16) % 2_147_483_647;
  const scene = compileScene(graph, defaultProposal(graph, seedInt), { previous: opts.previousScene ?? null, source: "default" });
  const templates = plan.resources.map((r) => ({ resource_id: r.id, template: r.template, version: tpl(r).version, digest: templateDigest(r.template as WorldTemplate) })).sort((a, b) => a.resource_id.localeCompare(b.resource_id));
  return {
    schema: COMPILED_WORLD_SCHEMA, revision, plan, plan_digest: planDigest, catalog: { version: CATALOG_VERSION, digest: catalogDigest() }, templates,
    graph, sources, routes, identities, observation, gaps, limitations: [...(bp?.limitations ?? []), ...plan.resources.flatMap((r) => tpl(r).limitations.map((l) => `${r.id}: ${l}`))],
    scene, layout_digest: scene.digest,
    provenance: { contract: LOCAL_CONTRACTS.world_plan, data_origin: "synthetic_local", label: LOCAL_LAB_LABEL, endpoints: "allocated_by_supervisor_at_start", credentials: "none_required" },
  };
}

/** The blueprint a plan was instantiated from, by plan id prefix (names and synthetic accounts only). */
function inferBlueprint(plan: WorldPlan): Blueprint | null {
  const m = /^([a-z-]+)-v(\d+)/.exec(plan.plan_id);
  return m ? getBlueprint(m[1]!, Number(m[2])) : null;
}

/** Return a new plan with one more catalog resource. Existing resources and their settings are untouched. */
export function withResource(plan: WorldPlan, r: WorldPlan["resources"][number], attachTo: { from?: string[] } = {}): WorldPlan {
  const next: WorldPlan = JSON.parse(JSON.stringify(plan));
  next.resources.push({ id: r.id, template: r.template, depends_on: [...r.depends_on], settings: { ...r.settings } });
  for (const f of attachTo.from ?? []) next.resources.find((x) => x.id === f)?.depends_on.push(r.id);
  return checkPlan(next);
}

/** Preview: what an operator confirms before a run is started. No credential, endpoint or project is needed. */
export function previewWorld(w: CompiledWorld) {
  return {
    schema: "dk.local.world_preview.v1", revision: w.revision, plan_id: w.plan.plan_id, catalog: w.catalog,
    resources: w.plan.resources.map((r) => ({ id: r.id, template: r.template, version: TEMPLATE_CATALOG[r.template as WorldTemplate].version, depends_on: r.depends_on, settings: r.settings, asset_kind: TEMPLATE_CATALOG[r.template as WorldTemplate].asset_kind })),
    relationships: w.graph.relationships.map((r) => ({ id: r.id, from: r.source_id, to: r.target_id, kind: r.kind, evidence_level: r.evidence_level })),
    sources: w.sources, routes: w.routes, identities: w.identities, observation: w.observation, gaps: w.gaps, limitations: w.limitations,
    budget: w.plan.budget, runtime_mode: w.plan.runtime_mode, external_network: false,
    layout: { digest: w.layout_digest, rooms: w.scene.rooms.map((r) => ({ asset_id: r.asset_id, module_id: r.module_id, zone_id: r.zone_id, x: r.position.x, z: r.position.z })) },
    provenance: w.provenance,
  };
}
