import { createServer as createHttpServer, type Server } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DigitalKingdom } from "@dk/sdk-node";

/**
 * Agent boundary reference (roadmap R05.2): ONE supported boundary, proven end to end.
 *
 * - The boundary is an MCP tool gateway. The agent sees only the gateway's tools. Every call is reported as an
 *   intent, the policy decision (policy_enforcer) and, if allowed, the execution (tool_wrapper).
 * - The controlled destination is a separate HTTP receiver. Its observer reports each delivery as an effect
 *   with origin independent_observer, using its OWN source key; the agent and gateway never hold it.
 * - Unobserved paths (documented): anything the agent can reach without the gateway (direct network access,
 *   a shell, other MCP servers) is visible only if it reaches an observed destination. Run ids on direct
 *   requests are agent-supplied and only correlate inside the declared run namespace.
 */
export interface Policy { allowedDestinations: string[]; deniedTools: string[]; revision: string }

export function startControlledSink(observer: DigitalKingdom, opts: { asset: string; runtime: string }) {
  const received: { destination: string; run: string | null; body: string }[] = [];
  const server: Server = createHttpServer((req, res) => {
    let body = "";
    req.on("data", (c) => { if (body.length < 10_000) body += c; });
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://sink");
      const destination = url.searchParams.get("to") ?? "unknown";
      const run = typeof req.headers["x-run-id"] === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(req.headers["x-run-id"]) ? req.headers["x-run-id"] : null;
      received.push({ destination, run, body });
      if (run) observer.toolStep(opts.asset, run, "observed", { phase: "effect", origin: "independent_observer", runtime: opts.runtime, tool: "email.send" }, { details: { destination, bytes: body.length } });
      else observer.emit({ asset: opts.asset, action: "side_effect_observed", outcome: "observed", details: { destination, bytes: body.length, run_id_present: false } });
      res.writeHead(202).end();
    });
  });
  return new Promise<{ url: string; received: typeof received; close(): Promise<void> }>((resolve) => server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as { port: number }).port;
    resolve({ url: `http://127.0.0.1:${port}`, received, close: () => new Promise((r) => server.close(() => r())) });
  }));
}

export function createGateway(opts: { dk: DigitalKingdom; policy: Policy; sinkUrl: string; runtime: string; principal: string; agentAsset: string; toolsAsset: string }) {
  const server = new McpServer({ name: "dk-reference-gateway", version: "1.0.0" });
  let step = 0;
  const report = (runId: string, tool: string, phase: "intent" | "decision" | "execution", outcome: "attempted" | "allowed" | "denied" | "success" | "failure", extra: Record<string, string | number | boolean> = {}) =>
    opts.dk.toolStep(phase === "intent" ? opts.agentAsset : opts.toolsAsset, runId, outcome, { phase, origin: phase === "decision" ? "policy_enforcer" : "tool_wrapper", runtime: opts.runtime, initiating_principal: opts.principal, tool, tool_version: "1.0.0", policy_revision: opts.policy.revision, step: ++step }, { details: extra });

  server.registerTool("send_email", {
    title: "Send an email", description: "Send a short message to an approved destination.",
    inputSchema: { run_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/), to: z.string().max(200), body: z.string().max(2000) },
  }, async ({ run_id, to, body }) => {
    report(run_id, "email.send", "intent", "attempted", { destination: to });
    if (opts.policy.deniedTools.includes("email.send") || !opts.policy.allowedDestinations.includes(to)) {
      report(run_id, "email.send", "decision", "denied", { destination: to, reason: "destination not allowed" });
      return { content: [{ type: "text", text: `denied by policy ${opts.policy.revision}: ${to} is not an allowed destination` }], isError: true };
    }
    report(run_id, "email.send", "decision", "allowed", { destination: to });
    const r = await fetch(`${opts.sinkUrl}/deliver?to=${encodeURIComponent(to)}`, { method: "POST", headers: { "x-run-id": run_id }, body });
    report(run_id, "email.send", "execution", r.ok ? "success" : "failure", { destination: to, status: r.status });
    return { content: [{ type: "text", text: r.ok ? `sent to ${to}` : `delivery failed (${r.status})` }] };
  });
  // Deliberately no tool that touches Digital Kingdom configuration: the monitored agent cannot reach it.
  return server;
}

export const UNOBSERVED_PATHS = [
  "Direct network access from the agent process bypasses the gateway; it is visible only if it reaches an observed destination.",
  "Other MCP servers or plugins the agent loads are outside this boundary.",
  "Prompt contents and tool arguments are never recorded (only destinations and outcomes).",
  "A direct request carrying a forged run id correlates only inside the declared run namespace and is labelled as lacking a wrapper report.",
];
export const PERMISSION_ASSUMPTIONS = [
  "The agent holds only an MCP connection to the gateway and, at most, a project-scoped service VIEWER token.",
  "The gateway holds a source key for the agent_observer source; the sink observer holds a different key for the effect_observer source.",
  "Source keys can only ingest; disabling or reconfiguring sources requires a human admin.",
];
