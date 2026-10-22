#!/usr/bin/env -S npx tsx
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, DkClient, parseToolAllowlist } from "./server.ts";

const baseUrl = process.env.DK_URL ?? "http://127.0.0.1:8787";
const token = process.env.DK_TOKEN;
const project = process.env.DK_PROJECT ?? "demo-castle";
if (!token) {
  console.error("DK_TOKEN is required (a Digital Kingdom API token; use a viewer token for read-only agents, analyst to allow containment proposals).");
  process.exit(1);
}
// DK_MCP_TOOLS: optional allowlist ("investigation" = read-only profile, or a comma list of tool names)
const tools = parseToolAllowlist(process.env.DK_MCP_TOOLS);
const server = createServer(new DkClient({ baseUrl, token, project }), { tools });
await server.connect(new StdioServerTransport());
console.error(`Digital Kingdom MCP connected to ${baseUrl} (project ${project})`);
