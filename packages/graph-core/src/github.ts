import { parse as parseYaml } from "yaml";
import type { Asset, Graph, Relationship } from "@dk/contracts";
import { sanitizeId, zoneForKind } from "./importers.ts";

/**
 * Read-only GitHub repository discovery (roadmap R02.3).
 *
 * Input is METADATA fetched from the GitHub REST API (repository, workflow files as text, deployments, releases).
 * Workflow YAML is parsed as data and never executed; repository hooks, scripts and actions are never run, and
 * `run:` steps are not even retained. Stable ids come from GitHub's numeric ids (repository id, workflow id,
 * environment name scoped to the repository id), so a rename or redeploy keeps the same asset id.
 * Anything the API refused (rate limit, 404, 403) is reported as partial discovery, never as absence.
 */
export interface GithubSnapshot {
  repository: { id: number; full_name: string; default_branch: string; visibility?: string; archived?: boolean };
  workflows?: { id: number; path: string; name: string; state?: string; text?: string | null }[];
  deployments?: { id: number; environment: string; sha: string; ref?: string; created_at: string }[];
  releases?: { id: number; tag_name: string; created_at: string }[];
  head?: { sha: string; date?: string };
  errors?: { resource: string; status: number; message: string }[];
}

export interface DiscoveryResult {
  graph: Graph;
  partial: { resource: string; reason: string }[];
  unsupported: string[];
  metadata: { commit: string | null; workflows: { id: number; path: string; triggers: string[]; environments: string[]; uses: string[] }[]; deployments: { environment: string; sha: string; at: string }[]; latest_release: string | null };
}

const SAFE = /[^A-Za-z0-9_.:/@+-]/g;
const clean = (s: unknown, max = 200) => String(s ?? "").replace(SAFE, "").slice(0, max);
const prose = (s: unknown, max = 200) => String(s ?? "").replace(/[^A-Za-z0-9 _.,:;()/@+-]/g, "").slice(0, max);

/** Parse one workflow file as inert data: triggers, referenced environments, and referenced action names only. */
export function inspectWorkflow(text: string): { triggers: string[]; environments: string[]; uses: string[]; problems: string[] } {
  const problems: string[] = [];
  let doc: unknown;
  try { doc = parseYaml(text, { maxAliasCount: 50, prettyErrors: false, strict: false, uniqueKeys: false }); }
  catch (e) { return { triggers: [], environments: [], uses: [], problems: [`unparseable workflow: ${prose((e as Error).message, 120)}`] }; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { triggers: [], environments: [], uses: [], problems: ["workflow is not a mapping"] };
  const d = doc as Record<string, unknown>;
  const on = d.on ?? d[true as unknown as string];
  const triggers = typeof on === "string" ? [on] : Array.isArray(on) ? on.map(String) : on && typeof on === "object" ? Object.keys(on) : [];
  const environments = new Set<string>(), uses = new Set<string>();
  const jobs = d.jobs && typeof d.jobs === "object" ? Object.values(d.jobs as Record<string, unknown>) : [];
  for (const j of jobs.slice(0, 100)) {
    if (!j || typeof j !== "object") continue;
    const job = j as Record<string, unknown>;
    const env = typeof job.environment === "string" ? job.environment : job.environment && typeof job.environment === "object" ? (job.environment as { name?: unknown }).name : undefined;
    if (typeof env === "string" && !env.includes("${{")) environments.add(clean(env, 80));
    else if (typeof env === "string") problems.push("environment computed from an expression; not resolved");
    if (typeof job.uses === "string") uses.add(clean(job.uses));
    for (const st of Array.isArray(job.steps) ? job.steps.slice(0, 200) : []) if (st && typeof st === "object" && typeof (st as { uses?: unknown }).uses === "string") uses.add(clean((st as { uses: string }).uses));
  }
  return { triggers: triggers.map((t) => clean(t, 60)).slice(0, 20), environments: [...environments].slice(0, 20), uses: [...uses].slice(0, 100), problems };
}

export function discoverGithub(snap: GithubSnapshot, opts: { projectId: string; revision: string; datasetKind?: "live" | "synthetic"; environment?: string }): DiscoveryResult {
  const repo = snap.repository;
  const repoAsset = `gh-repo-${repo.id}`;
  const src = `github:${repo.id}`;
  const env = opts.environment ?? "delivery";
  const assets: Asset[] = [{ id: repoAsset, name: clean(repo.full_name, 120), kind: "pipeline", environment: env, allowed_zone_ids: [zoneForKind("pipeline")], source_refs: [src], aliases: [clean(repo.full_name, 120)], provider_ref: { scope: "github", id: `repository:${repo.id}` } } as Asset];
  const relationships: Relationship[] = [];
  const partial = (snap.errors ?? []).map((e) => ({ resource: clean(e.resource, 80), reason: e.status === 403 || e.status === 429 ? `rate limited or forbidden (${e.status}): ${prose(e.message, 120)}` : e.status === 404 ? "not found or not accessible with the granted scopes" : `HTTP ${e.status}` }));
  const workflows: DiscoveryResult["metadata"]["workflows"] = [];
  const envNames = new Set<string>();
  for (const w of (snap.workflows ?? []).slice(0, 200)) {
    const id = `gh-wf-${w.id}`;
    const insp = w.text ? inspectWorkflow(w.text) : { triggers: [], environments: [], uses: [], problems: ["workflow text not fetched"] };
    if (!w.text) partial.push({ resource: `workflow ${clean(w.path, 120)}`, reason: "file content unavailable" });
    for (const p of insp.problems) partial.push({ resource: `workflow ${clean(w.path, 120)}`, reason: p });
    workflows.push({ id: w.id, path: clean(w.path, 200), triggers: insp.triggers, environments: insp.environments, uses: insp.uses });
    assets.push({ id, name: clean(w.name || w.path, 120), kind: "pipeline", environment: env, allowed_zone_ids: [zoneForKind("pipeline")], source_refs: [src], aliases: [clean(w.path, 200)], provider_ref: { scope: "github", id: `workflow:${w.id}` } } as Asset);
    relationships.push({ id: `rel-${id}-repo`, source_id: id, target_id: repoAsset, kind: "belongs_to", evidence_level: "declared", evidence_refs: [src] } as unknown as Relationship);
    for (const e of insp.environments) { envNames.add(e); relationships.push({ id: `rel-${id}-env-${sanitizeId(e)}`, source_id: id, target_id: `gh-env-${repo.id}-${sanitizeId(e)}`, kind: "deploys", evidence_level: "declared", evidence_refs: [src] } as unknown as Relationship); }
  }
  for (const d of snap.deployments ?? []) envNames.add(clean(d.environment, 80));
  for (const e of [...envNames].sort()) assets.push({ id: `gh-env-${repo.id}-${sanitizeId(e)}`, name: `${clean(repo.full_name, 80)} ${e}`, kind: "third_party", environment: env, allowed_zone_ids: [zoneForKind("third_party")], source_refs: [src], provider_ref: { scope: "github", id: `environment:${repo.id}:${e}` } } as Asset);
  const deployments = (snap.deployments ?? []).slice(0, 100).map((d) => ({ environment: clean(d.environment, 80), sha: clean(d.sha, 64), at: d.created_at }));
  const latest = [...(snap.releases ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const graph: Graph = { schema_version: "0.2", dataset_kind: opts.datasetKind ?? "live", project_id: opts.projectId, graph_revision: opts.revision, assets, relationships: relationships.filter((r) => assets.some((a) => a.id === r.target_id)) } as Graph;
  return {
    graph, partial,
    unsupported: ["job-level secrets and permissions are not imported", "reusable workflow inputs are not resolved", "self-hosted runner identity is not discovered", "artifact attestations are R04.1", "run: steps are never retained or executed"],
    metadata: { commit: snap.head?.sha ? clean(snap.head.sha, 64) : null, workflows, deployments, latest_release: latest ? clean(latest.tag_name, 120) : null },
  };
}

/** Preview of applying discovered assets onto a current graph: additions, removals among github-sourced assets, changes. */
export function previewMerge(current: Graph | undefined, discovered: Graph, sourceRef: string) {
  const cur = current?.assets ?? [];
  const mine = cur.filter((a) => a.source_refs.includes(sourceRef));
  const byId = new Map(mine.map((a) => [a.id, a]));
  const added = discovered.assets.filter((a) => !cur.some((c) => c.id === a.id)).map((a) => a.id);
  const removed = mine.filter((a) => !discovered.assets.some((d) => d.id === a.id)).map((a) => a.id);
  const changed = discovered.assets.filter((a) => byId.has(a.id) && JSON.stringify({ ...byId.get(a.id), source_refs: undefined }) !== JSON.stringify({ ...a, source_refs: undefined })).map((a) => a.id);
  const collisions = discovered.assets.filter((a) => cur.some((c) => c.id === a.id && !c.source_refs.includes(sourceRef))).map((a) => a.id);
  const others = cur.filter((a) => !a.source_refs.includes(sourceRef));
  const keepRels = (current?.relationships ?? []).filter((r) => !(r.evidence_refs ?? []).includes(sourceRef));
  const merged: Graph = { ...(current ?? discovered), graph_revision: discovered.graph_revision, assets: [...others, ...discovered.assets.filter((a) => !collisions.includes(a.id))], relationships: [...keepRels, ...discovered.relationships] } as Graph;
  const ids = new Set(merged.assets.map((a) => a.id));
  merged.relationships = merged.relationships.filter((r) => ids.has(r.source_id) && ids.has(r.target_id));
  return { added, removed, changed, collisions, merged };
}
