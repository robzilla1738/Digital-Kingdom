/**
 * Test-only loopback stand-in for an OpenAI-compatible chat endpoint (local_model mode). It makes no outbound call and
 * costs nothing. Each response carries a reasoning payload so tests can prove it is never stored.
 */
import { createServer, type IncomingMessage } from "node:http";

export const FAKE_REASONING = "FAKE-HIDDEN-REASONING-7f3a";
export interface FakeTurn { tool_calls?: { name: string; arguments: Record<string, unknown> }[]; content?: string }

export async function fakeProvider(script: (n: number, body: any) => FakeTurn) { // eslint-disable-line @typescript-eslint/no-explicit-any
  let n = 0; const bodies: unknown[] = [];
  const read = (req: IncomingMessage) => new Promise<string>((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(s)); });
  const server = createServer(async (req, res) => {
    const body = JSON.parse(await read(req)); bodies.push(body); n++;
    const t = script(n, body);
    const message = { role: "assistant", content: t.content ?? "", reasoning: FAKE_REASONING, reasoning_details: [{ type: "reasoning.encrypted", data: FAKE_REASONING }], ...(t.tool_calls ? { tool_calls: t.tool_calls.map((c, i) => ({ id: `call_${n}_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } : {}) };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: `gen_${n}`, model: body.model, choices: [{ index: 0, finish_reason: t.tool_calls ? "tool_calls" : "stop", message }], usage: { prompt_tokens: 100, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 15 }, cost: 0 } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/v1`, requests: () => n, bodies, close: () => new Promise<void>((r) => server.close(() => r())) };
}
