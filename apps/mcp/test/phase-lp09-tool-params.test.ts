import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, DkClient } from "../src/server.ts";

/** LP09-A2 (MCP half): no tool accepts raw SQL, arbitrary paths, unrestricted graph queries or source credentials. */
describe("LP09-A2 MCP tool parameters", () => {
  it("no MCP tool input schema has a raw SQL, path, URL, graph-query, command or credential parameter", async () => {
    const server = createServer(new DkClient({ baseUrl: "http://127.0.0.1:9", token: "unused", project: "p" }));
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "schema-audit", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const tools = (await client.listTools()).tools;
    expect(tools.length).toBeGreaterThan(20);
    const forbidden = /^(sql|query|raw|raw_query|where|path|file|filename|url|uri|endpoint|host|graph|graph_query|cypher|gremlin|sparql|credential|credentials|password|secret|token|api_key|key|command|cmd|script|shell|exec)$/i;
    for (const t of tools) for (const k of Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {})) expect(k, `${t.name}.${k}`).not.toMatch(forbidden);
    await client.close();
  });
});
