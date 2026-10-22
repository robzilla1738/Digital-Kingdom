import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve, dirname } from "node:path";
import { openDb } from "./db.ts";
import { Store } from "./store.ts";
import { buildApp } from "./app.ts";
import { seedDemo } from "./seed.ts";
import { plannerFromEnv } from "./planner-model.ts";

const env = process.env;
const dataDir = resolve(env.DK_DATA_DIR ?? ".data");
mkdirSync(dataDir, { recursive: true });
const db = openDb(resolve(dataDir, "digital-kingdom.db"));
const store = new Store(db);

// server secret for export signatures
const secretPath = resolve(dataDir, "secret");
const secret = env.DK_SECRET ?? (existsSync(secretPath) ? readFileSync(secretPath, "utf8").trim() : (() => { const s = randomBytes(32).toString("hex"); mkdirSync(dirname(secretPath), { recursive: true }); writeFileSync(secretPath, s, { mode: 0o600 }); return s; })());

if (env.DK_ADMIN_TOKEN) store.createToken("admin (env)", "admin", "*", env.DK_ADMIN_TOKEN);
else if (!store.hasAdmin()) {
  const { token } = store.createToken("bootstrap admin", "admin");
  console.log("\n  Digital Kingdom bootstrap admin token (shown once, store it securely):\n  " + token + "\n");
}

const demoMode = (env.DK_DEMO_MODE ?? "true") !== "false";
if (env.DK_SEED_DEMO !== "false") {
  const r = seedDemo(store);
  if (r.created) console.log(`  Seeded synthetic demo project "demo-castle" (${r.deliveries} deliveries).`);
}

const app = await buildApp({ store, secret, demoMode, planner: plannerFromEnv(), secureCookies: env.DK_SECURE_COOKIES === "true", logger: env.DK_LOG === "true" });

// background worker: drain the journal, re-check coverage staleness, prune outbox.
// DK_WORKER_PAUSED=true runs ingest-only: events are acknowledged and journaled but not processed
// (used by the pilot to prove acknowledged events survive a restart; not a production mode).
const workerPaused = env.DK_WORKER_PAUSED === "true";
if (workerPaused) console.log("  Worker PAUSED (DK_WORKER_PAUSED=true): ingestion is journaled but not processed.");
let busy = false;
setInterval(() => {
  if (busy || workerPaused) return; busy = true;
  try { while (store.processBatch(200).processed) { /* drain */ } } catch (e) { console.error("worker batch failed (will retry):", e); } finally { busy = false; }
}, Number(env.DK_WORKER_INTERVAL_MS ?? 250)).unref();
setInterval(() => {
  try { for (const p of store.listProjects({ kind: "token", id: "system", name: "system", role: "admin", projects: "*", principalType: "service" })) if (p.dataset_kind === "live") store.evaluateProject(p.id); store.pruneOutbox(); } catch (e) { console.error("coverage sweep failed:", e); }
}, Number(env.DK_COVERAGE_SWEEP_MS ?? 30_000)).unref();

const port = Number(env.PORT ?? 8787);
const host = env.HOST ?? "127.0.0.1";
await app.listen({ port, host });
console.log(`  Digital Kingdom server on http://${host}:${port}  (demo mode: ${demoMode ? "ON — anonymous read access to synthetic projects only" : "off"})`);
