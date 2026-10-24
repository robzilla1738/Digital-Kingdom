/**
 * Print an MCP client configuration for an existing coding agent (Claude Desktop / Claude Code / Cursor and other
 * clients that read an `mcpServers` map), wired to the focused investigation profile (LP11).
 *
 *   npx tsx scripts/mcp-agent-config.ts --profile investigation-read --project shop [--url http://127.0.0.1:8787]
 *
 * The token is never written: DK_TOKEN is a placeholder the operator replaces with a project-scoped SERVICE token
 * (viewer for investigation-read, analyst for investigation-author). The profile and project are fixed in the
 * environment of the launched process; nothing the agent reads can change them.
 */
import { resolve, join } from "node:path";
import { FOCUSED_PROFILES, type FocusedProfile } from "../apps/mcp/src/focused.ts";

export function agentConfig(o: { profile: FocusedProfile; project: string; url?: string; root?: string; name?: string }) {
  if (!(FOCUSED_PROFILES as readonly string[]).includes(o.profile)) throw new Error(`profile must be one of ${FOCUSED_PROFILES.join(", ")}`);
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(o.project)) throw new Error("project must be a project id");
  const root = o.root ?? resolve(import.meta.dirname, "..");
  return {
    mcpServers: {
      [o.name ?? `digital-kingdom-${o.profile}`]: {
        command: join(root, "node_modules", ".bin", "tsx"),
        args: [join(root, "apps", "mcp", "src", "main.ts")],
        env: {
          DK_URL: o.url ?? "http://127.0.0.1:8787",
          DK_PROJECT: o.project,
          DK_MCP_PROFILE: o.profile,
          DK_TOKEN: o.profile === "investigation-read" ? "<project-scoped SERVICE token with role viewer>" : "<project-scoped SERVICE token with role analyst>",
        },
      },
    },
    notes: [
      "Replace DK_TOKEN with a token created by an administrator for this project only (POST /api/tokens with principal_type service).",
      o.profile === "investigation-read" ? "Read-only: contracts, plan previews, packets, ref inspection, claim checks, job status." : "Analyst-service: also opens contracts, runs bounded job steps, records inapplicability with reasons and proposes conclusions. No approvals, containment, source configuration or leases.",
      "stdio transport, local only. The server makes no model calls; the agent's own model usage is the agent's.",
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const cfg = agentConfig({ profile: (arg("profile") ?? "investigation-read") as FocusedProfile, project: arg("project") ?? "demo-castle", url: arg("url") });
  process.stdout.write(JSON.stringify(cfg, null, 2) + "\n");
}
