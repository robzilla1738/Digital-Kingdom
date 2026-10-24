/**
 * pnpm world [--blueprint saas-storefront|agent-workspace|delivery-identity] [--seed <text>] [--once]
 *
 * Starts an isolated Digital Kingdom server (127.0.0.1, in-memory database), a supervisor-owned local world, provisions
 * the world's lab project and sources through the ordinary API, drives one benign operation, and prints exactly which
 * local capabilities are reporting. Ctrl-C (or --once) stops the run and removes only its manifest-owned resources.
 * No provider account, credential or outbound network is used.
 */
import { randomUUID } from "node:crypto";
import { buildApp } from "../../../../apps/server/src/app.ts";
import { openDb } from "../../../../apps/server/src/db.ts";
import { Store } from "../../../../apps/server/src/store.ts";
import { reportingView } from "../../../../apps/server/src/local-world.ts";
import { startLocalWorld, type LocalWorld } from "./session.ts";

export function formatReporting(view: ReturnType<typeof reportingView>): string[] {
  const lines = [`${view.summary.reporting} reporting · ${view.summary.silent} silent · ${view.summary.unavailable} unavailable of ${view.summary.capabilities} declared capabilities (${view.summary.sources} sources)`];
  for (const s of view.sources) {
    lines.push(`  ${s.source_id} [${s.kind}, ${s.role === "independent_observer" ? "independent observer" : "self-report"}, group ${s.independence_group}]${s.health.state === "unavailable" ? " UNAVAILABLE" : ""}`);
    for (const c of s.capabilities) lines.push(`    ${c.status === "reporting" ? "✓" : c.status === "silent" ? "·" : "✗"} ${c.asset_id.padEnd(18)} ${c.action.padEnd(22)} ${c.status}${c.events ? ` (${c.events})` : ""}`);
  }
  lines.push(`  ${view.note}`);
  return lines;
}

async function benign(w: LocalWorld) {
  const bp = w.world.plan.plan_id.split("-v")[0];
  if (bp === "saas-storefront") { const s = await w.login("acct:tenant-a:user"); return w.run.request(w.operatorToken, { resource: "ingress", method: "GET", path: "/tenants/tenant-a/records", headers: { "x-world-session": s } }); }
  if (bp === "agent-workspace") return w.run.request(w.operatorToken, { resource: "tool-gateway", method: "POST", path: "/tools/send_message", headers: { "x-world-agent-run": `cli-${Date.now()}` }, body: { to: "allowed-receiver", body: "synthetic hello" } });
  return w.run.request(w.operatorToken, { resource: "depot", method: "POST", path: "/artifacts", headers: { "x-world-actor": "svc:builder" }, body: { name: "build-1", content: "synthetic build output" } });
}

export async function runCli(argv: string[], log: (s: string) => void = console.log) {
  const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const blueprint = arg("--blueprint") ?? "saas-storefront", seed = arg("--seed") ?? randomUUID();
  const store = new Store(openDb(":memory:"));
  const adminToken = store.createToken("world admin", "admin").token;
  const app = await buildApp({ store, secret: randomUUID(), demoMode: false, webDist: "/nonexistent" });
  const url = await app.listen({ port: Number(process.env.DK_PORT ?? 0), host: "127.0.0.1" });
  const drain = () => { for (let i = 0; i < 100 && store.processBatch().processed; i++) { /* drain */ } };
  const w = await startLocalWorld({ blueprint, seed, dk: { url, adminToken }, drain });
  log(`\nLocal laboratory — synthetic people and data`);
  log(`  Digital Kingdom: ${url}/?project=${w.project}   token: ${adminToken} (this process only)`);
  log(`  Run ${w.run.run_id} · world ${w.world.revision} · ${w.world.plan.runtime_mode} (${w.run.preflight.status})`);
  log(`  Endpoints (allocated by the supervisor, handshake-verified):`);
  for (const l of w.run.manifest.listeners) log(`    ${l.resource_id.padEnd(18)} ${l.host}:${l.port}`);
  log(`  In-process: ${w.run.manifest.in_process.join(", ") || "none"} · observers: ${w.run.manifest.observers.map((o) => `${o.id}→${o.attached.join("+")}`).join(", ") || "none"}`);
  for (const c of w.run.preflight.controls) log(`    control ${c.control.padEnd(28)} ${c.state}`);
  const op = await benign(w);
  log(`  Benign operation ${op.op_id}: ${op.resource} ${op.method} ${op.path} -> ${op.status}`);
  await w.flush();
  for (const line of formatReporting(reportingView(store, w.project))) log(line);
  const stop = async () => { await w.stop(); await app.close(); store.db.close(); log(`  Stopped; cleanup ${w.run.cleanupRecord.outcome}${w.run.cleanupRecord.failures.length ? ` (${w.run.cleanupRecord.failures.length} failure(s))` : ""}.`); };
  return { w, stop };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { stop } = await runCli(process.argv.slice(2));
  if (process.argv.includes("--once")) { await stop(); process.exit(0); }
  const quit = async () => { await stop(); process.exit(0); };
  process.on("SIGINT", () => void quit()); process.on("SIGTERM", () => void quit());
}
