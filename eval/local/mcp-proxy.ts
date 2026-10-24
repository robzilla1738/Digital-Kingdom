/**
 * LP24 — evidence-exposure recorder for a NATIVE agent (the owner's own coding agent).
 *
 * The agent's MCP configuration launches this proxy instead of the server; the proxy launches the real Digital Kingdom
 * MCP server (`apps/mcp/src/main.ts`, same environment: DK_URL, DK_TOKEN, DK_PROJECT, DK_MCP_PROFILE) and relays
 * newline-delimited JSON-RPC unchanged in both directions. It appends OBSERVABLE tool I/O to DK_LI_TRACE (JSONL):
 * tools/list results and every tools/call request with its response. It sees nothing of the agent's reasoning or
 * model tokens (they never cross this wire), and it redacts DK_TOKEN if it ever appeared in a message.
 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { classifyDenial, redact } from "./trace.ts";

const root = resolve(import.meta.dirname, "../..");
const trace = process.env.DK_LI_TRACE;
if (!trace) { console.error("DK_LI_TRACE (trace file path) is required"); process.exit(1); }
const secrets = [process.env.DK_TOKEN ?? ""];
const { DK_LI_TRACE: _t, ...env } = process.env; void _t;
const child = spawn(process.execPath, ["--import", "tsx", join(root, "apps/mcp/src/main.ts")], { cwd: root, env, stdio: ["pipe", "pipe", "inherit"] });
const t0 = Date.now(); let seq = 0;
const pending = new Map<string | number, { tool: string; arguments: unknown; method: string }>();
const log = (e: Record<string, unknown>) => appendFileSync(trace, redact(JSON.stringify({ seq: ++seq, t_ms: Date.now() - t0, ...e }), secrets) + "\n", { mode: 0o600 });
log({ kind: "note", note: "native-agent proxy started; observable tool I/O only (development_assisted run)" });

const lines = (onLine: (l: string) => void) => { let buf = ""; return (chunk: Buffer) => { buf += chunk.toString("utf8"); let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); onLine(l); } }; };
process.stdin.on("data", lines((l) => {
  try { const m = JSON.parse(l); if (m.id !== undefined && (m.method === "tools/call" || m.method === "tools/list")) pending.set(m.id, { method: m.method, tool: m.params?.name ?? "", arguments: m.params?.arguments ?? {} }); } catch { /* relay anyway */ }
  child.stdin.write(l + "\n");
}));
child.stdout.on("data", lines((l) => {
  try {
    const m = JSON.parse(l);
    const req = m.id !== undefined ? pending.get(m.id) : undefined;
    if (req) {
      pending.delete(m.id);
      if (req.method === "tools/list") log({ kind: "tools_list", tools: (m.result?.tools ?? []).map((t: { name: string }) => t.name) });
      else {
        const text = m.error ? `MCP error ${m.error.code}: ${m.error.message}` : (m.result?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("\n");
        const isError = !!m.error || !!m.result?.isError;
        const denial = classifyDenial(text, isError);
        log({ kind: "tool_call", tool: req.tool, arguments: req.arguments, is_error: isError, denied: denial !== null, denial, response: text, response_bytes: Buffer.byteLength(text) });
      }
    }
  } catch { /* relay anyway */ }
  process.stdout.write(l + "\n");
}));
process.stdin.on("end", () => child.stdin.end());
child.on("exit", (code) => process.exit(code ?? 0));
