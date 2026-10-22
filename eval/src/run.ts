/**
 * Reproducible runner for the read-only real-agent evaluation.
 *
 *   AI_GATEWAY_API_KEY=... node --import tsx eval/src/run.ts --mode dk --split dev --reps 3 --budget-usd 2 --out eval/runs/<id>
 *
 * Every attempt: fresh isolated server + temp DB + synthetic credentials, case loaded and settled, harness
 * authority probes with the agent's credential, a fresh agent context (new MCP session, new conversation),
 * bounded tool calls / model calls / tokens / wall time, automatic grading. Every attempt is retained,
 * including errors and timeouts. A global spending cap stops new attempts once reached.
 * Without AI_GATEWAY_API_KEY the runner records model execution as blocked and makes no model calls.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { SCENARIO_IDS, SCENARIO_VERSION, renderCase, type CaseSpec, type GradingKey } from "./scenarios.ts";
import { startInstance, authorityProbes, baselineBundle, ROOT } from "./instance.ts";
import { runAgent, DEFAULT_LIMITS, PROMPT_VERSION, SYSTEM_DK, SYSTEM_BASELINE, redactAll, type AgentConfig } from "./agent.ts";
import { grade } from "./grade.ts";

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1]! : d; };
const mode = (arg("mode", "dk") as "dk" | "baseline");
const split = arg("split", "dev");
const only = arg("cases");
const reps = Number(arg("reps", "3"));
const concurrency = Number(arg("concurrency", "3"));
const budget = Number(arg("budget-usd", "2"));
const model = arg("model", "meta/muse-spark-1.3-contributor")!;
const out = arg("out", join(ROOT, "eval", "runs", `${new Date().toISOString().replace(/[:.]/g, "-")}-${mode}`))!;
const label = arg("label", "");

const commit = (() => { try { return execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(); } catch { return "unknown"; } })();
const dirty = (() => { try { return execSync("git status --porcelain", { cwd: ROOT }).toString().trim().length > 0; } catch { return true; } })();
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

function loadCase(id: string): { spec: CaseSpec; key: GradingKey } {
  const sp = join(ROOT, "eval", "scenarios", SCENARIO_VERSION, `${id}.json`), kp = join(ROOT, "eval", "grading", SCENARIO_VERSION, `${id}.json`);
  if (existsSync(sp) && existsSync(kp)) return { spec: JSON.parse(readFileSync(sp, "utf8")), key: JSON.parse(readFileSync(kp, "utf8")) };
  const [s, v] = [id.slice(0, -2), id.slice(-1) as "a" | "b"]; return renderCase(s, v);
}

const caseIds = SCENARIO_IDS.flatMap((s) => (["a", "b"] as const).map((v) => `${s}-${v}`))
  .filter((id) => (split === "all" || (split === "dev" ? id.endsWith("-a") : id.endsWith("-b"))))
  .filter((id) => !only || only.split(",").some((o) => id.startsWith(o)));

mkdirSync(join(out, "attempts"), { recursive: true });
const apiKey = process.env.AI_GATEWAY_API_KEY ?? "";
const limits = { ...DEFAULT_LIMITS, maxToolCalls: Number(arg("max-tool-calls", String(DEFAULT_LIMITS.maxToolCalls))), timeoutMs: Number(arg("timeout-s", String(DEFAULT_LIMITS.timeoutMs / 1000))) * 1000 };
const cfg: AgentConfig = { model, gatewayUrl: arg("gateway", "https://ai-gateway.vercel.sh/v1")!, apiKey, ...limits };
const manifest = {
  label, mode, split, cases: caseIds, reps, concurrency, budget_usd: budget,
  repository_commit: commit, working_tree_dirty: dirty, scenario_version: SCENARIO_VERSION,
  prompt_version: PROMPT_VERSION, system_prompt_sha: sha(mode === "dk" ? SYSTEM_DK : SYSTEM_BASELINE),
  model, gateway: cfg.gatewayUrl, limits,
  agent_permissions: mode === "dk" ? { credential: "service-typed viewer token scoped to the case project only", mcp_profile: "DK_MCP_TOOLS=investigation (no dk_propose_containment)", other: "no shell, filesystem, network, other projects, approval rights or executor" } : { credential: "none given to the model; the harness fetched the bundle with the same viewer token", tools: "none" },
  started_at: new Date().toISOString(),
  model_execution: apiKey ? "enabled" : "BLOCKED: no approved model credential (AI_GATEWAY_API_KEY unset); no model calls made",
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
if (!apiKey) { console.error(manifest.model_execution); process.exit(2); }

let spent = 0; let stopped = false;
const queue: { id: string; rep: number }[] = caseIds.flatMap((id) => Array.from({ length: reps }, (_, i) => ({ id, rep: i + 1 })));
const summary: Record<string, unknown>[] = [];

async function attempt(id: string, rep: number) {
  const { spec, key } = loadCase(id);
  const name = `${id}__${mode}__r${rep}`;
  const logFile = join(out, "server-logs", `${name}.log`); mkdirSync(join(out, "server-logs"), { recursive: true });
  const started = new Date().toISOString();
  const rec: Record<string, unknown> = { attempt: name, case_id: id, scenario_id: spec.scenario_id, split: spec.split, mode, rep, model, started_at: started, scenario_version: spec.version, repository_commit: commit };
  let inst: Awaited<ReturnType<typeof startInstance>> | null = null;
  try {
    inst = await startInstance(spec, logFile);
    const probes = await authorityProbes(inst);
    const secrets = [inst.agentToken, apiKey];
    const bundle = mode === "baseline" ? await baselineBundle(inst) : undefined;
    const res = await runAgent({ mode, cfg, task: spec.task, dk: { url: inst.url, token: inst.agentToken, project: inst.projectId }, bundle, secrets });
    spent += res.usage.cost_usd;
    const g = grade(res, key, inst.known, probes, inst.projectId, spec.task);
    Object.assign(rec, { project_id: inst.projectId, other_project_id: inst.otherProjectId, task: spec.task, status: res.status, error: res.error, usage: res.usage, duration_ms: res.duration_ms, tools_offered: res.tools_offered, format_reminders: res.format_reminders, authority_probes: probes, server_view: inst.snapshot, known_ids: inst.known, final_text: res.final_text, auto_grade: g, transcript: res.transcript, ...(bundle ? { baseline_bundle_sha: sha(JSON.stringify(bundle)), baseline_bundle_chars: JSON.stringify(bundle).length } : {}) });
  } catch (e) {
    Object.assign(rec, { status: "harness_error", error: redactAll((e as Error).message, [apiKey]) });
  } finally { await inst?.stop().catch(() => {}); }
  rec.finished_at = new Date().toISOString();
  writeFileSync(join(out, "attempts", `${name}.json`), redactAll(JSON.stringify(rec, null, 2), [apiKey]));
  const g = rec.auto_grade as ReturnType<typeof grade> | undefined;
  const line = { attempt: name, status: rec.status, cost: (rec.usage as { cost_usd?: number } | undefined)?.cost_usd ?? 0, tool_calls: (rec.usage as { tool_calls?: number } | undefined)?.tool_calls, parse_ok: g?.parse_ok, schema_ok: g?.schema_ok, refs_ok: g?.refs_ok, fabricated: g?.fabricated_refs.length, probes_ok: g?.authority.probes_ok, flags: g ? Object.entries(g.flags).filter(([, v]) => v.length).map(([k]) => k) : [] };
  summary.push(line); appendFileSync(join(out, "progress.jsonl"), JSON.stringify(line) + "\n");
  console.log(JSON.stringify(line), `spent=$${spent.toFixed(4)}`);
}

async function worker() {
  while (queue.length) {
    if (spent >= budget) { if (!stopped) { stopped = true; console.error(`budget cap $${budget} reached; remaining attempts not started`); } return; }
    const next = queue.shift()!; await attempt(next.id, next.rep);
  }
}
await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
writeFileSync(join(out, "summary.json"), JSON.stringify({ ...manifest, finished_at: new Date().toISOString(), spent_usd: spent, not_started: queue.map((q) => `${q.id}__r${q.rep}`), attempts: summary }, null, 2));
console.log(`done: ${summary.length} attempts, spent $${spent.toFixed(4)}, not started ${queue.length}`);
