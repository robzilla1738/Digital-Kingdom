import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, DkClient } from "../src/server.ts";
import { setup } from "../../server/test/helpers.ts";

/** Shared in-memory MCP harness for Local Intelligence Phase tests (same wiring as mcp-r05.test.ts). */
export async function mcpHarness(project = "demo-castle") {
  const ctx = await setup();
  const base = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
  const connect = async (token: string) => {
    const server = createServer(new DkClient({ baseUrl: base, token, project }));
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "dk-phase", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => { const r = await c.callTool({ name, arguments: args }); const text = (r.content as { text: string }[])[0]!.text; let json: any = null; try { json = JSON.parse(text); } catch { /* error text */ } return { isError: !!r.isError, json, text }; };
  return { ctx, connect, call, close: () => ctx.app.close() };
}
