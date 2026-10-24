/**
 * LP29 local mission runner.
 *
 *   DK_URL=http://127.0.0.1:8787 DK_TOKEN=<admin token> pnpm mission run <mission-file.json> --mission <id>
 *   pnpm mission check <mission-file.json>
 *
 * The mission file is the builder's draft (`dk.local.mission.v1`), which holds private truth. The runner composes it
 * locally (same composer as the console), proves to the Digital Kingdom server that it holds the same truth (SHA-256
 * commitment), starts a disposable supervisor-owned world against that server's ordinary ingestion, executes the
 * finite LP07 schedule, reports only lifecycle and step accounting back (never labels, expectations or the seed), and
 * removes its run-owned resources. Private truth stays in the run's own 0600 file. No shell, URL or remote account.
 */
import { readFileSync } from "node:fs";
import { getBlueprint, composeMission } from "../../../../packages/local-world/src/index.ts";
import { startLocalWorld, type LocalWorld } from "./session.ts";
import { runScenario, type RunOptions } from "./scenario.ts";

export interface MissionRunOptions { dk: { url: string; adminToken: string }; missionId: string; drain?: () => void; run?: RunOptions; onWorld?: (w: LocalWorld) => void }

export async function runMission(draft: unknown, o: MissionRunOptions) {
  const c = composeMission(draft);
  if (!c.ok) throw new Error(`mission rejected locally; nothing was started: ${c.issues.slice(0, 5).join("; ")}`);
  const api = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${o.dk.url}${path}`, { method, headers: { authorization: `Bearer ${o.dk.adminToken}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const j = await r.json().catch(() => ({})) as Record<string, unknown>;
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${String(j.error ?? "")}`);
    return j;
  };
  const rec = await api("GET", `/api/local-missions/${encodeURIComponent(o.missionId)}`) as { truth_commitment: string; status: string };
  if (rec.truth_commitment !== c.brief.truth_commitment) throw new Error("this mission file does not match the server's truth commitment; nothing was started");
  const bp = getBlueprint(c.brief.blueprint, c.brief.blueprint_version)!;
  const w = await startLocalWorld({ blueprint: bp.id, seed: c.truth.seed, budget: c.world.plan.budget, dk: o.dk, ...(o.drain ? { drain: o.drain } : {}) });
  o.onWorld?.(w);
  const runId = w.run.run_id;
  let status: "complete" | "partial" | "failed" = "failed";
  let accounting: Record<string, number[]> = { executed: [], refused: [], failed: [], not_run: [] };
  try {
    await api("POST", `/api/local-missions/${encodeURIComponent(o.missionId)}/runs`, { run_id: runId, truth_commitment: c.brief.truth_commitment, project_id: w.project, world_revision: w.world.revision });
    const r = await runScenario(w, c.truth.scenario, o.run ?? {});
    await w.flush();
    status = r.result.status === "complete" ? "complete" : "partial";
    accounting = Object.fromEntries(["executed", "refused", "failed", "not_run"].map((k) => [k, r.truth.steps.filter((x) => x.outcome === k).map((x) => x.index)]));
    return { run_id: runId, project: w.project, status, accounting, result: r.result, truth: r.truth, world: w };
  } finally {
    await w.stop();
    const cleanup = { outcome: w.run.cleanupRecord.outcome, failures: w.run.cleanupRecord.failures };
    await api("POST", `/api/local-missions/${encodeURIComponent(o.missionId)}/runs/${encodeURIComponent(runId)}/finish`, { status, accounting, cleanup }).catch(() => undefined);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, file] = process.argv.slice(2);
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
  if (!file || !["run", "check"].includes(cmd ?? "")) { console.error("usage: pnpm mission check <file> | pnpm mission run <file> --mission <id>  (DK_URL, DK_TOKEN)"); process.exit(2); }
  const draft = JSON.parse(readFileSync(file, "utf8"));
  const c = composeMission(draft);
  if (!c.ok) { console.error(`mission rejected:\n  ${c.issues.join("\n  ")}`); process.exit(1); }
  console.log(`mission ${c.brief.mission_id} (${c.brief.mode}) · world ${c.brief.world_revision} · ${c.brief.budget.operations} operations over ${c.brief.budget.span_ms} ms · local only`);
  if (cmd === "run") {
    const url = process.env.DK_URL ?? "http://127.0.0.1:8787", token = process.env.DK_TOKEN;
    if (!token) { console.error("DK_TOKEN (an admin token for the local server) is required"); process.exit(2); }
    const r = await runMission(draft, { dk: { url, adminToken: token }, missionId: arg("--mission") ?? c.brief.mission_id });
    console.log(`run ${r.run_id}: ${r.status} · executed ${r.accounting.executed!.length} · refused ${r.accounting.refused!.length} · failed ${r.accounting.failed!.length} · not run ${r.accounting.not_run!.length} · project ${r.project}`);
  }
}
