import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, DkClient, INVESTIGATION_TOOLS, INVESTIGATION_TOOLS_V1, parseToolAllowlist } from "../src/server.ts";
import { setup } from "../../server/test/helpers.ts";

/**
 * Read-only investigation profile used by the real-agent evaluation (docs/AGENT_EVAL_PLAN.md).
 * Hiding a tool is defence in depth; the server's role and project scope are the actual boundary, so the
 * write and cross-project cases are also checked with the full toolset.
 */
let ctx: Awaited<ReturnType<typeof setup>>;
let base: string;
let svcViewer = "";
const connect = async (token: string, tools?: readonly string[]) => {
  const server = createServer(new DkClient({ baseUrl: base, token, project: "demo-castle" }), { tools });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
};
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = await c.callTool({ name, arguments: args });
  return { isError: !!r.isError, text: (r.content as { text: string }[])[0]!.text };
};

beforeAll(async () => {
  ctx = await setup();
  base = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
  ctx.store.createProject("other-project", "another team's project", "live");
  svcViewer = ctx.store.createToken("eval agent", "viewer", ["demo-castle"], undefined, "service").token;
});
afterAll(async () => { await ctx.app.close(); });

describe("read-only investigation profile", () => {
  it("parses the allowlist", () => {
    expect(parseToolAllowlist(undefined)).toBeUndefined();
    expect(parseToolAllowlist("investigation")).toEqual([...INVESTIGATION_TOOLS]);
    expect(parseToolAllowlist("investigation-v1")).toEqual([...INVESTIGATION_TOOLS_V1]);
    expect(INVESTIGATION_TOOLS_V1).not.toContain("dk_search_events");
    expect(INVESTIGATION_TOOLS).toEqual(expect.arrayContaining(["dk_search_events", "dk_get_event"]));
    expect(parseToolAllowlist("dk_overview, dk_coverage")).toEqual(["dk_overview", "dk_coverage"]);
  });
  it("does not expose the proposal tool", async () => {
    const c = await connect(svcViewer, INVESTIGATION_TOOLS);
    const names = (await c.listTools()).tools.map((t) => t.name);
    expect(names.sort()).toEqual([...INVESTIGATION_TOOLS].sort());
    expect(names).not.toContain("dk_propose_containment");
    const r = await call(c, "dk_propose_containment", { finding_id: "x", action_id: "y", rationale: "should not exist here" });
    expect(r.isError).toBe(true);
  });
  it("server-side: a service viewer token is refused writes even when the tool is exposed", async () => {
    const f = ctx.store.listFindings("demo-castle")[0]!;
    const c = await connect(svcViewer);
    const r = await call(c, "dk_propose_containment", { finding_id: f.id, action_id: "secrets.rotate_credentials", rationale: "evaluation write probe" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/403/);
    for (const [path, body] of [[`/api/projects/demo-castle/findings/${f.id}/disposition`, { disposition: "benign" }], ["/api/projects/demo-castle/containment", { finding_id: f.id, action_id: "x", rationale: "probe probe" }], ["/api/tokens", { name: "x", role: "viewer" }]] as const) {
      const res = await fetch(base + path, { method: "POST", headers: { authorization: `Bearer ${svcViewer}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(res.status, path).toBe(403);
    }
  });
  it("server-side: another project is not visible to the scoped token", async () => {
    const c = await connect(svcViewer, INVESTIGATION_TOOLS);
    const r = await call(c, "dk_overview", { project: "other-project" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/404/);
    const list = await (await fetch(base + "/api/projects", { headers: { authorization: `Bearer ${svcViewer}` } })).json();
    expect(list.map((p: { id: string }) => p.id)).toEqual(["demo-castle"]);
  });
  it("event search and event detail work in the read-only profile and stay project-scoped", async () => {
    const c = await connect(svcViewer, INVESTIGATION_TOOLS);
    const evs = ctx.store.listEvents("demo-castle", { limit: 50_000 });
    const t = evs.map((e) => Date.parse(e.occurred_at));
    const after = new Date(Math.min(...t) - 1000).toISOString();
    const before = new Date(Math.min(Math.max(...t) + 1000, Math.min(...t) + 30 * 86_400_000)).toISOString();
    const seen: string[] = []; let cursor: string | undefined; let last: any;
    do {
      const r = await call(c, "dk_search_events", { after, before, limit: 25, ...(cursor ? { cursor } : {}) });
      expect(r.isError, r.text).toBe(false);
      last = JSON.parse(r.text);
      expect(last.note).toMatch(/untrusted/);
      expect(last.events.untrusted).toBe(true);
      seen.push(...last.events.records.map((e: { id: string }) => e.id));
      cursor = last.page.next_cursor ?? undefined;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(last.query_completeness.matching_in_snapshot);
    expect(last.query_completeness.complete).toBe(true);
    const d = await call(c, "dk_get_event", { id: seen[0]! });
    expect(d.isError).toBe(false);
    expect(JSON.parse(d.text).event.id).toBe(seen[0]);
    const x = await call(c, "dk_search_events", { after, before, project: "other-project" });
    expect(x.isError).toBe(true);
    expect(x.text).toMatch(/40[34]/);
    const bad = await call(c, "dk_search_events", { after: "yesterday", before });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/422/);
  });
});
