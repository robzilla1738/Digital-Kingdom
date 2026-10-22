/**
 * Pilot harness: runs the REAL server entry point (apps/server/src/main.ts, which includes the worker
 * and coverage sweep) as a child process against a fresh temporary data directory, on an ephemeral port.
 * All credentials are generated per run and never written to artifacts.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

export const ROOT = resolve(import.meta.dirname, "..");
export const ARTIFACTS = join(ROOT, "artifacts", "pilot");

export async function freePort(): Promise<number> {
  return new Promise((res, rej) => { const s = createServer(); s.unref(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const a = s.address(); const p = typeof a === "object" && a ? a.port : 0; s.close(() => res(p)); }); });
}

/** Poll an observable condition with a bounded deadline (no fixed sleeps). */
export async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 20_000, everyMs = 150): Promise<T> {
  const end = Date.now() + timeoutMs; let last: unknown;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v as T; } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for: ${what}${last ? ` (last error: ${String((last as Error).message ?? last)})` : ""}`);
}

export interface Pilot {
  url: string; port: number; dataDir: string; adminToken: string;
  start(opts?: { workerPaused?: boolean }): Promise<void>;
  stop(signal?: NodeJS.Signals): Promise<void>;
  api<T = any>(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: T }>;
  cleanup(): void;
}

const redactLog = (s: string, secrets: string[]) => secrets.reduce((acc, x) => (x ? acc.split(x).join("[redacted]") : acc), s);

export async function createPilot(): Promise<Pilot> {
  const dataDir = mkdtempSync(join(tmpdir(), "dk-pilot-"));
  const port = await freePort();
  const adminToken = `dk_pilot_${randomBytes(18).toString("hex")}`; // synthetic, per run
  const secret = randomBytes(32).toString("hex");
  const url = `http://127.0.0.1:${port}`;
  const logFile = join(ARTIFACTS, "server.log");
  let child: ChildProcess | null = null;
  const secrets = [adminToken, secret];
  const self: Pilot = {
    url, port, dataDir, adminToken,
    async start(opts = {}) {
      child = spawn(process.execPath, ["--import", "tsx", join(ROOT, "apps/server/src/main.ts")], {
        cwd: ROOT,
        env: {
          PATH: process.env.PATH, HOME: process.env.HOME, NODE_NO_WARNINGS: "1",
          DK_DATA_DIR: dataDir, PORT: String(port), HOST: "127.0.0.1",
          DK_ADMIN_TOKEN: adminToken, DK_SECRET: secret,
          DK_SEED_DEMO: "false", DK_DEMO_MODE: "false",
          DK_WORKER_INTERVAL_MS: "100", DK_COVERAGE_SWEEP_MS: "500",
          ...(opts.workerPaused ? { DK_WORKER_PAUSED: "true" } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const log = (b: Buffer) => appendFileSync(logFile, redactLog(b.toString(), secrets));
      child.stdout!.on("data", log); child.stderr!.on("data", log);
      await until("server /healthz", async () => (await fetch(`${url}/healthz`)).ok, 30_000);
    },
    async stop(signal = "SIGKILL") {
      const c = child; child = null;
      if (!c || c.exitCode !== null) return;
      await new Promise<void>((r) => { c.once("exit", () => r()); c.kill(signal); });
    },
    async api(method, path, body, token = adminToken) {
      const r = await fetch(url + path, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": typeof body === "string" ? "application/yaml" : "application/json" } : {}) }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
      const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
      return { status: r.status, json };
    },
    cleanup() { rmSync(dataDir, { recursive: true, force: true }); },
  };
  return self;
}
