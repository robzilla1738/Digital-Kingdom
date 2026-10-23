import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { DigitalKingdom } from "@dk/sdk-node";

/**
 * A tiny, deliberately boring "checkout" service instrumented with the Digital Kingdom Node adapter.
 * It binds to 127.0.0.1 only. It contains no vulnerable code; its defenses (a naive input filter and
 * a login rate check) are observable so a benign verification run produces real source events.
 */
export function startReferenceApp(opts: { port?: number; dk: DigitalKingdom; asset?: string; onDbRead?: (actor: string, route: string) => void }) {
  const asset = opts.asset ?? "checkout-api";
  const failures = new Map<string, number>();
  const users: Record<string, { password: string; role: string }> = { alice: { password: "correct-horse", role: "user" }, ops: { password: "battery-staple", role: "admin" } };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // trusted boundary-local request id; any inbound x-request-id from the public is ignored
    const requestId = `req-${randomUUID()}`;
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json", "x-request-id": requestId }); res.end(JSON.stringify(body)); };
    const body = await readJson(req);
    if (url.pathname === "/login" && req.method === "POST") {
      const { user, password } = body as { user?: string; password?: string };
      const key = String(user ?? "");
      if ((failures.get(key) ?? 0) >= 5) { opts.dk.emit({ asset, action: "authentication", outcome: "denied", actor: key, requestId, rule: "login-rate-limit" }); return send(429, { error: "too many attempts" }); }
      const ok = !!user && users[user]?.password === password;
      if (!ok) failures.set(key, (failures.get(key) ?? 0) + 1); else failures.delete(key);
      opts.dk.signIn(asset, key, ok, { requestId, session: ok ? `s-${key}-${requestId}` : undefined });
      return ok ? send(200, { session: `s-${key}-${requestId}` }) : send(401, { error: "invalid credentials" });
    }
    if (url.pathname === "/orders" && req.method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      if (/('|--|\bunion\b|\bor\b\s+\d+=\d+)/i.test(q)) { opts.dk.denied(asset, "/orders", "input-filter-sqli", { requestId, severity: "medium", details: { input_sample: q.slice(0, 160) } }); return send(400, { error: "rejected input" }); }
      opts.dk.emit({ asset, action: "request_received", outcome: "success", route: "/orders", requestId });
      opts.onDbRead?.(String(req.headers["x-demo-user"] ?? "anonymous").slice(0, 40), "/orders");
      return send(200, { orders: [] });
    }
    if (url.pathname === "/admin/roles" && req.method === "POST") {
      const { session, grant } = body as { session?: string; grant?: string };
      if (!session?.startsWith("s-ops-")) { opts.dk.emit({ asset, action: "authorization_change", outcome: "denied", route: "/admin/roles", requestId, ...(session ? { session } : {}) }); return send(403, { error: "forbidden" }); }
      opts.dk.privilegeChange(asset, "ops", String(grant ?? "unknown"), { requestId, session, route: "/admin/roles" });
      return send(200, { ok: true });
    }
    send(404, { error: "not found" });
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", () => {
    const a = server.address(); const port = typeof a === "object" && a ? a.port : 0;
    resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
  }));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET") return {};
  let size = 0; const chunks: Buffer[] = [];
  for await (const c of req) { size += (c as Buffer).length; if (size > 64_000) return {}; chunks.push(c as Buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const key = process.env.DK_SOURCE_KEY;
  if (!key) { console.error("Set DK_SOURCE_KEY (a source key for the live project) and DK_URL."); process.exit(1); }
  const dk = new DigitalKingdom({ url: process.env.DK_URL ?? "http://127.0.0.1:8787", sourceKey: key, sessionSalt: process.env.DK_SESSION_SALT ?? randomUUID() });
  const app = await startReferenceApp({ port: Number(process.env.PORT ?? 3080), dk });
  console.log(`reference app on ${app.url} (local only)`);
}
