/**
 * LP24 — scoped MCP setup and the evidence-exposure recorder.
 *
 * Every investigator (scripted, model, or a native agent through `mcp-proxy.ts`) reaches Digital Kingdom only through
 * the documented stdio MCP launch path with a project-scoped SERVICE VIEWER token. The recorder keeps OBSERVABLE tool
 * I/O only: tool list, each request (name + arguments), each response text, denials, and the final claims. It never
 * receives or stores model reasoning, provider reasoning payloads or token-level data, and it redacts secrets.
 */
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Client, StdioClientTransport } from "../../apps/mcp/test/sdk-client.ts";
import { canonicalJson } from "../../packages/contracts/src/index.ts";
import { ROOT } from "../src/instance.ts";
import type { PublicHandle } from "./controller.ts";
import { classifyDenial, redact } from "./trace.ts";
export { classifyDenial, redact };

export const TRACE_SCHEMA = "dk.local.investigation_trace.v1";
export type ConditionId = "C1" | "C2" | "C3";
export interface ConditionSpec { id: ConditionId; label: string; env: Record<string, string>; description: string }
/** Preregistered comparison conditions (04 §8). C2 is NOT raw-only: search carries coverage/correlation caveats. */
export const LI_CONDITIONS: Record<ConditionId, ConditionSpec> = {
  C1: { id: "C1", label: "existing full investigation tools", env: { DK_MCP_TOOLS: "investigation" }, description: "The existing 22-tool read-only investigation MCP profile (overview, findings, event search/detail, coverage, cases, recipes, bundles, ...)." },
  C2: { id: "C2", label: "event tools with context", env: { DK_MCP_TOOLS: "dk_search_events,dk_get_event" }, description: "Only dk_search_events and dk_get_event; search returns query completeness and current coverage, detail returns finding references. Not a raw-only condition." },
  C3: { id: "C3", label: "guided investigation contract", env: { DK_MCP_PROFILE: "investigation-read" }, description: "The LP11 focused investigation-read profile over the LP08 contract, LP09 job (run by the deterministic planner) and LP10 packets/claim checks." },
};

export type TraceEntry =
  | { seq: number; t_ms: number; kind: "tools_list"; tools: string[] }
  | { seq: number; t_ms: number; kind: "tool_call"; tool: string; arguments: unknown; is_error: boolean; denied: boolean; denial: string | null; response: string; response_bytes: number }
  | { seq: number; t_ms: number; kind: "claims"; answer: unknown }
  | { seq: number; t_ms: number; kind: "note"; note: string };

export class Recorder {
  readonly entries: TraceEntry[] = [];
  private t0 = Date.now(); private seq = 0;
  constructor(readonly secrets: string[] = []) {}
  push(e: Omit<TraceEntry, "seq" | "t_ms">): TraceEntry { const x = { seq: ++this.seq, t_ms: Date.now() - this.t0, ...e } as TraceEntry; this.entries.push(x); return x; }
  responses(): string[] { return this.entries.flatMap((e) => (e.kind === "tool_call" ? [e.response] : [])); }
  denials() { return this.entries.filter((e): e is Extract<TraceEntry, { kind: "tool_call" }> => e.kind === "tool_call" && e.denied); }
  toJSON() { return { schema: TRACE_SCHEMA, observable_only: true, contains: ["tool list", "tool requests (name, arguments)", "tool responses", "denials", "final claims"], never_contains: ["model reasoning", "provider reasoning payloads", "token-level data", "credentials"], entries: this.entries }; }
}

export interface ToolDef { name: string; description?: string; title?: string; inputSchema: unknown }
export interface ScopedMcp { condition: ConditionId; tools: string[]; defs: ToolDef[]; call: (name: string, args?: Record<string, unknown>) => Promise<{ isError: boolean; text: string; json: any }>; close: () => Promise<void>; recorder: Recorder; env: Record<string, string> } // eslint-disable-line @typescript-eslint/no-explicit-any

/** The exact environment handed to the MCP subprocess: public handle only, never seed/oracle/truth. */
export function mcpEnv(h: PublicHandle, c: ConditionId): Record<string, string> {
  return { DK_URL: h.url, DK_TOKEN: h.token, DK_PROJECT: h.project, ...LI_CONDITIONS[c].env };
}

export async function connectScoped(h: PublicHandle, c: ConditionId, recorder = new Recorder([h.token])): Promise<ScopedMcp> {
  const env = mcpEnv(h, c);
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", join(ROOT, "apps/mcp/src/main.ts")], cwd: ROOT, stderr: "pipe", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_NO_WARNINGS: "1", ...env } });
  const client = new Client({ name: "dk-li-investigator", version: "1" });
  await client.connect(transport);
  const defs = (await client.listTools()).tools as ToolDef[];
  const tools = defs.map((t) => t.name);
  recorder.push({ kind: "tools_list", tools } as never);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    let text: string, isError: boolean;
    try {
      const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 30_000 });
      text = (r.content as { type: string; text?: string }[]).map((x) => x.text ?? "").join("\n"); isError = !!r.isError;
    } catch (e) { text = `tool error: ${(e as Error).message}`; isError = true; }
    const clean = redact(text, recorder.secrets);
    const denial = classifyDenial(clean, isError);
    recorder.push({ kind: "tool_call", tool: name, arguments: JSON.parse(redact(JSON.stringify(args), recorder.secrets)), is_error: isError, denied: denial !== null, denial, response: clean, response_bytes: Buffer.byteLength(clean) } as never);
    let json: unknown = null; try { json = JSON.parse(clean); } catch { /* non-JSON */ }
    return { isError, text: clean, json };
  };
  return { condition: c, tools, defs, call, close: () => client.close(), recorder, env };
}

export const eventDigest = (e: unknown) => createHash("sha256").update(canonicalJson(e)).digest("hex");

/**
 * Exposure: which stored events reached the investigator in THIS attempt. `full` = the complete stored record
 * (search/detail/inspection); `packet` = an LP10 packet record whose ref and digest match the stored record. An id merely
 * mentioned (in a finding, a cursor, a summary) is not exposure. Exposure is not proof of attention.
 */
export function exposure(stored: Record<string, unknown>[], responses: string[]) {
  const byId = new Map(stored.map((e) => [String(e.id), { canon: canonicalJson(e), digest: eventDigest(e) }]));
  const full = new Set<string>(), packet = new Set<string>();
  const visit = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const x of v) visit(x); return; }
    const o = v as Record<string, unknown>;
    if (typeof o.id === "string" && byId.get(o.id)?.canon === canonicalJson(o)) full.add(o.id);
    if (typeof o.ref === "string" && typeof o.digest === "string" && byId.get(o.ref)?.digest === o.digest) packet.add(o.ref);
    for (const x of Object.values(o)) visit(x);
  };
  for (const t of responses) { try { visit(JSON.parse(t)); } catch { /* non-JSON responses expose no record */ } }
  const any = new Set([...full, ...packet]);
  return { full: [...full].sort(), packet_only: [...packet].filter((x) => !full.has(x)).sort(), any: [...any].sort() };
}

/** Leakage canary scan: any private marker in anything the investigator received invalidates a blinded result. */
export function leakScan(texts: string[], markers: string[]): string[] {
  const all = texts.join("\n");
  return markers.filter((m) => m && all.includes(m));
}
