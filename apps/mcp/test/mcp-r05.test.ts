import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, DkClient } from "../src/server.ts";
import { setup } from "../../server/test/helpers.ts";

/** R05.3 bounded cases, capabilities and incremental delivery over MCP. */
async function env() {
  const ctx = await setup();
  const base = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
  const connect = async (token: string) => {
    const server = createServer(new DkClient({ baseUrl: base, token, project: "demo-castle" }));
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "r05-3", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  };
  const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => { const r = await c.callTool({ name, arguments: args }); const text = (r.content as { text: string }[])[0]!.text; let json: any = null; try { json = JSON.parse(text); } catch { /* error text */ } return { isError: !!r.isError, json, text }; };
  return { ctx, connect, call, stop: () => ctx.app.close() };
}
const newCase = (ctx: Awaited<ReturnType<typeof setup>>, title: string) => ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/cases", headers: ctx.h(ctx.analyst), payload: { title, scope: { question: "?", asset_ids: [] }, closure_criteria: "done" } });

describe("R05.3 MCP cases and incremental delivery", () => {
  it("capabilities state versions, budgets and that delivery is polling, not push", async () => {
    const t = await env();
    try {
      const c = (await t.call(await t.connect(t.ctx.viewer), "dk_capabilities")).json;
      expect(c).toMatchObject({ schema: "dk.capabilities.v1", delivery: { push: "not supported" }, remote_mcp: "not offered" });
      expect(c.recipes).toContain("auth-burst-then-success@1");
    } finally { await t.stop(); }
  });

  it("disconnecting the client loses no case changes; the next poll returns them in order", async () => {
    const t = await env();
    try {
      let mcp = await t.connect(t.ctx.viewer);
      await newCase(t.ctx, "first");
      const p1 = (await t.call(mcp, "dk_case_changes")).json;
      expect(p1.changes.map((c: { title: string }) => c.title)).toEqual(["first"]);
      await mcp.close(); // the model/client goes away
      await newCase(t.ctx, "while away");
      const ev = t.ctx.store.receive("demo-castle", t.ctx.store.listSources("demo-castle")[0]!.id, { source_event_id: "r053-1", occurred_at: new Date().toISOString(), asset_ids: [t.ctx.store.listSources("demo-castle")[0]!.asset_ids[0]!], action: "sensor_restored", outcome: "unknown" }, new Date().toISOString());
      expect(ev).toBeTruthy(); // ingestion keeps working with no MCP client connected
      mcp = await t.connect(t.ctx.viewer);
      const p2 = (await t.call(mcp, "dk_case_changes", { since: p1.next_since })).json;
      expect(p2.changes.map((c: { title: string }) => c.title)).toEqual(["while away"]);
      expect(p2.poll_after_seconds).toBe(30);
      const id = p2.changes[0].id;
      const res = await mcp.readResource({ uri: `digital-kingdom://cases/${id}` });
      expect(JSON.parse((res.contents[0] as { text: string }).text)).toMatchObject({ id, title: "while away" });
      expect((await t.call(mcp, "dk_case_changes", { since: "garbage" })).isError).toBe(true);
    } finally { await t.stop(); }
  });

  it("read-only annotations are not authorization: the server enforces roles", async () => {
    const t = await env();
    try {
      const mcp = await t.connect(t.ctx.viewer);
      const tools = (await mcp.listTools()).tools;
      const propose = tools.find((x) => x.name === "dk_propose_containment")!;
      expect(propose.annotations?.readOnlyHint).toBe(false);
      const f = t.ctx.store.listFindings("demo-castle")[0]!;
      const r = await t.call(mcp, "dk_propose_containment", { finding_id: f.id, action_id: "x", rationale: "viewer tries to propose containment" });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/403|forbidden|requires|role|analyst/i);
    } finally { await t.stop(); }
  });

  it("no tool accepts a URL to fetch and no token passes downstream", async () => {
    const t = await env();
    try {
      const tools = (await (await t.connect(t.ctx.viewer)).listTools()).tools;
      for (const tool of tools) {
        const props = Object.keys((tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
        expect(props.filter((p) => /url|uri|endpoint|token|authorization|header/i.test(p)), tool.name).toEqual([]);
      }
    } finally { await t.stop(); }
  });

  it("oversized results are withheld with an explicit budget error instead of being cut", async () => {
    const t = await env();
    try {
      const base = `http://127.0.0.1:${(t.ctx.app.server.address() as { port: number }).port}`;
      const server = createServer(new DkClient({ baseUrl: base, token: t.ctx.viewer, project: "demo-castle" }), { maxOutputBytes: 200 });
      const [a, b] = InMemoryTransport.createLinkedPair();
      const c = new Client({ name: "budget", version: "1" });
      await Promise.all([server.connect(a), c.connect(b)]);
      const r = await c.callTool({ name: "dk_list_findings", arguments: {} });
      expect(r.isError).toBe(true);
      expect(JSON.parse((r.content as { text: string }[])[0]!.text)).toMatchObject({ truncated: true, budget_bytes: 200 });
    } finally { await t.stop(); }
  });
});
