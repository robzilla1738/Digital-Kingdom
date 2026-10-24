/** Protocol-level MCP client over the documented stdio launch path (`tsx apps/mcp/src/main.ts`). Test helper only. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join, resolve } from "node:path";

export async function connectStdioMcp(env: { DK_URL: string; DK_TOKEN: string; DK_PROJECT: string; DK_MCP_PROFILE?: string; DK_MCP_MAX_OUTPUT_BYTES?: string; DK_MCP_MAX_UNITS_PER_CALL?: string }) {
  const root = resolve(import.meta.dirname, "../../..");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", join(root, "apps/mcp/src/main.ts")],
    cwd: root,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_NO_WARNINGS: "1", ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "dk-pilot", version: "1" });
  await client.connect(transport);
  const call = async <T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { type: string; text: string }[])[0]?.text ?? "";
    if (r.isError) throw new Error(`${name}: ${text.slice(0, 300)}`);
    try { return JSON.parse(text) as T; } catch { throw new Error(`${name}: ${text.slice(0, 300)}`); }
  };
  return { client, call, close: () => client.close() };
}
