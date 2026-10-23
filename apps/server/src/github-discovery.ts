import { discoverGithub, previewMerge, type GithubSnapshot } from "@dk/graph-core";
import { canonicalJson } from "@dk/contracts";
import { sha256 } from "./security.ts";
import { HttpError, type Store } from "./store.ts";

/**
 * R02.3: fetch read-only repository metadata from the GitHub REST API. Only GET requests to api.github.com; no
 * clone, no checkout, no code execution. A token (DK_GITHUB_TOKEN, read-only scopes) is optional for public
 * repositories. Every refused call is recorded as partial discovery.
 */
export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown>; headers: { get(name: string): string | null } }>;
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

export async function fetchGithubSnapshot(owner: string, repo: string, opts: { fetch: FetchLike; token?: string; maxWorkflows?: number }): Promise<GithubSnapshot> {
  if (!NAME.test(owner) || !NAME.test(repo)) throw new HttpError(400, "owner and repo must be GitHub names");
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "digital-kingdom-discovery", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) };
  const errors: GithubSnapshot["errors"] = [];
  const get = async <T>(resource: string, url: string): Promise<T | null> => {
    try {
      const r = await opts.fetch(url, { headers });
      if (!r.ok) { errors.push({ resource, status: r.status, message: r.headers.get("x-ratelimit-remaining") === "0" ? "rate limit exhausted" : `HTTP ${r.status}` }); return null; }
      return (await r.json()) as T;
    } catch (e) { errors.push({ resource, status: 0, message: (e as Error).message.slice(0, 120) }); return null; }
  };
  const r = await get<{ id: number; full_name: string; default_branch: string; visibility?: string; archived?: boolean }>("repository", base);
  if (!r) throw new HttpError(502, "repository not accessible", errors.map((e) => `${e.resource}: ${e.message}`), { partial: errors });
  const wf = await get<{ workflows: { id: number; path: string; name: string; state: string }[] }>("workflows", `${base}/actions/workflows?per_page=100`);
  const workflows: NonNullable<GithubSnapshot["workflows"]> = [];
  for (const w of (wf?.workflows ?? []).slice(0, opts.maxWorkflows ?? 50)) {
    const c = await get<{ content?: string; encoding?: string; size?: number }>(`workflow ${w.path}`, `${base}/contents/${w.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(r.default_branch)}`);
    const text = c?.content && c.encoding === "base64" && (c.size ?? 0) <= 256_000 ? Buffer.from(c.content, "base64").toString("utf8") : null;
    workflows.push({ id: w.id, path: w.path, name: w.name, state: w.state, text });
  }
  const deployments = await get<{ id: number; environment: string; sha: string; ref: string; created_at: string }[]>("deployments", `${base}/deployments?per_page=30`);
  const releases = await get<{ id: number; tag_name: string; created_at: string }[]>("releases", `${base}/releases?per_page=10`);
  const head = await get<{ sha: string; commit?: { committer?: { date?: string } } }>("head commit", `${base}/commits/${encodeURIComponent(r.default_branch)}`);
  return { repository: r, workflows, deployments: deployments ?? [], releases: releases ?? [], ...(head ? { head: { sha: head.sha, ...(head.commit?.committer?.date ? { date: head.commit.committer.date } : {}) } } : {}), errors };
}

/** Previews are held in memory, bound to the project and to the graph revision they were computed against. */
export class GithubDiscovery {
  private previews = new Map<string, { projectId: string; base: string | null; merged: ReturnType<typeof previewMerge>["merged"]; at: number }>();
  constructor(private readonly store: Store, private readonly fetchImpl: FetchLike, private readonly token?: string) {}

  async preview(projectId: string, body: Record<string, unknown>) {
    const owner = String(body.owner ?? ""), repo = String(body.repo ?? "");
    const proj = this.store.mustProject(projectId);
    const snap = await fetchGithubSnapshot(owner, repo, { fetch: this.fetchImpl, ...(this.token ? { token: this.token } : {}) });
    const current = this.store.getGraph(projectId);
    const revision = `gh-${snap.repository.id}-${(snap.head?.sha ?? "nohead").slice(0, 12)}`;
    const d = discoverGithub(snap, { projectId, revision, datasetKind: proj.dataset_kind, ...(typeof body.environment === "string" ? { environment: body.environment.slice(0, 80) } : {}) });
    const m = previewMerge(current, d.graph, `github:${snap.repository.id}`);
    const id = "ghp_" + sha256(canonicalJson({ projectId, base: current?.graph_revision ?? null, merged: m.merged })).slice(0, 20);
    this.previews.set(id, { projectId, base: current?.graph_revision ?? null, merged: m.merged, at: Date.now() });
    for (const [k, v] of this.previews) if (Date.now() - v.at > 3600_000) this.previews.delete(k);
    return { preview_id: id, base_graph_revision: current?.graph_revision ?? null, repository: snap.repository.full_name, additions: m.added, removals: m.removed, changes: m.changed, collisions: m.collisions, partial: d.partial, unsupported: d.unsupported, metadata: d.metadata,
      note: "Nothing is applied until you POST the preview_id back. Workflow files were read as data; no repository code ran." };
  }

  apply(projectId: string, body: Record<string, unknown>, actor: string) {
    const p = this.previews.get(String(body.preview_id ?? ""));
    if (!p || p.projectId !== projectId) throw new HttpError(404, "preview not found or expired; preview again");
    const cur = this.store.getGraph(projectId)?.graph_revision ?? null;
    if (body.expected_graph_revision !== p.base || cur !== p.base) throw new HttpError(409, "the graph changed since this preview; preview again", [], { current: { graph_revision: cur } });
    const r = this.store.putGraph(projectId, p.merged, actor);
    this.previews.delete(String(body.preview_id));
    return { graph_revision: p.merged.graph_revision, scene_digest: r.scene.digest, warnings: r.warnings };
  }
}
