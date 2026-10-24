#!/usr/bin/env -S npx tsx
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, DkClient, parseToolAllowlist } from "./server.ts";
import { parseProfile } from "./focused.ts";

const baseUrl = process.env.DK_URL ?? "http://127.0.0.1:8787";
const token = process.env.DK_TOKEN;
const project = process.env.DK_PROJECT ?? "demo-castle";
if (!token) {
  console.error("DK_TOKEN is required (a Digital Kingdom API token; use a viewer token for read-only agents, analyst to allow containment proposals).");
  process.exit(1);
}
// DK_MCP_TOOLS: optional allowlist ("investigation" = read-only profile, or a comma list of tool names)
const tools = parseToolAllowlist(process.env.DK_MCP_TOOLS);
// DK_MCP_PROFILE (LP11): focused investigation profile, fixed for the life of the process
// ("investigation-read" = read-only; "investigation-author" = analyst-service writes to cases/contracts/jobs only).
const profile = parseProfile(process.env.DK_MCP_PROFILE);
if (profile && tools) { console.error("set either DK_MCP_PROFILE or DK_MCP_TOOLS, not both"); process.exit(1); }
const maxUnitsPerCall = process.env.DK_MCP_MAX_UNITS_PER_CALL ? Number(process.env.DK_MCP_MAX_UNITS_PER_CALL) : undefined;
const server = createServer(new DkClient({ baseUrl, token, project }), { tools, profile, maxUnitsPerCall });
await server.connect(new StdioServerTransport());
console.error(`Digital Kingdom MCP connected to ${baseUrl} (project ${project})`);
