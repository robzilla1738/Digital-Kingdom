import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, DkClient, INVESTIGATION_TOOLS, parseToolAllowlist } from "../src/server.ts";
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
});
