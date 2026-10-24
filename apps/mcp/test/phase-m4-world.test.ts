import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, DkClient } from "../src/server.ts";
import { setup } from "../../server/test/helpers.ts";

/** M4: the MCP world tools return exactly the records the HTTP API (and therefore the castle, 2D and lists) use. */
let ctx: Awaited<ReturnType<typeof setup>>;
let base: string;
const connect = async (token: string) => {
  const server = createServer(new DkClient({ baseUrl: base, token, project: "demo-castle" }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
};
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = await c.callTool({ name, arguments: args });
  const text = (r.content as { text: string }[])[0]!.text;
  return { isError: !!r.isError, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
};
const api = async (path: string) => (await ctx.app.inject({ url: path, headers: ctx.h(ctx.viewer) })).json();

beforeAll(async () => { ctx = await setup(); base = await ctx.app.listen({ port: 0, host: "127.0.0.1" }); });
afterAll(async () => { await ctx.app.close(); });

describe("M4 world tools over MCP", () => {
  it("LP16: dk_world_locate search and locate equal the API records", async () => {
    const c = await connect(ctx.viewer);
    const s = await call(c, "dk_world_locate", { text: "demo", limit: 3 });
    expect(s.isError).toBe(false);
    expect(s.json).toEqual(await api("/api/projects/demo-castle/scene/search?q=demo&limit=3"));
    const l = await call(c, "dk_world_locate", { asset_id: "api" });
    expect(l.json).toEqual(await api("/api/projects/demo-castle/scene/locate/api"));
    expect(l.json.incarnation.id).toBe("api~1");
  });
  it("LP18: dk_asset_interior equals the API interior record", async () => {
    const c = await connect(ctx.viewer);
    const r = await call(c, "dk_asset_interior", { asset_id: "api" });
    expect(r.isError).toBe(false);
    expect(r.json.schema).toBe("dk.asset_interior.v1");
    expect(r.json).toEqual(await api("/api/projects/demo-castle/assets/api/interior"));
    const missing = await call(c, "dk_asset_interior", { asset_id: "no-such-asset" });
    expect(missing.isError).toBe(true);
  });
});
