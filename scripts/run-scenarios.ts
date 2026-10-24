/** Run DK-T scenario manifests through their referenced tests and write a receipt. Failures are never hidden. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
type M = { id: string; title: string; execution: string; tests: { file: string; name: string }[]; unavailable_reason?: string };
// DK-T01..16 (R07.3) and the LP07 local-world scenarios (their DSL documents live in scenarios/local-world/dsl/)
const DIRS = ["scenarios/dk-t", "scenarios/local-world"];
const manifests = DIRS.flatMap((d) => readdirSync(join(ROOT, d)).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(ROOT, d, f), "utf8")) as M));
const files = [...new Set(manifests.flatMap((m) => m.tests.map((t) => t.file)))];
const out = join(ROOT, "artifacts/scenarios"); mkdirSync(out, { recursive: true });
const report = join(out, "vitest.json");
try { execFileSync("npx", ["vitest", "run", "--reporter=json", `--outputFile=${report}`, ...files], { cwd: ROOT, stdio: "ignore", env: { ...process.env } }); } catch { /* failures are read from the report */ }
const results = JSON.parse(readFileSync(report, "utf8")) as { testResults: { name: string; assertionResults: { fullName: string; title: string; status: string }[] }[] };
const find = (file: string, name: string) => { const fr = results.testResults.find((r) => r.name.endsWith(file)); const hits = fr?.assertionResults.filter((a) => a.title.includes(name) || a.fullName.includes(name)) ?? []; return hits.length ? hits.map((h) => h.status) : ["missing"]; };
const rows = manifests.map((m) => {
  if (m.execution === "not_implemented" || m.execution === "response_dependent") return { id: m.id, title: m.title, status: "unavailable", reason: m.unavailable_reason };
  const tests = m.tests.map((t) => ({ ...t, status: find(t.file, t.name) }));
  const ok = tests.every((t) => t.status.every((s) => s === "passed"));
  return { id: m.id, title: m.title, status: ok ? (m.execution === "partial_model_eval_gated" ? "partial_passed" : "passed") : "failed", tests, ...(m.unavailable_reason ? { reason: m.unavailable_reason } : {}) };
});
const receipt = { schema: "dk.scenario_receipt.v1", run_at: new Date().toISOString(), commit: (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return null; } })(), scenarios: rows, note: "Synthetic demonstrations of specific behaviours; not a claim of universal attack coverage." };
writeFileSync(join(out, "receipt.json"), JSON.stringify(receipt, null, 1));
for (const r of rows) console.log(`${r.status.padEnd(15)} ${r.id} ${r.title}`);
if (rows.some((r) => r.status === "failed")) { console.error("one or more scenarios failed"); process.exit(1); }
