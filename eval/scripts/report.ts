// Per-case × repetition tables from retained attempt records (no aggregation into a single score).
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { grade } from "../src/grade.ts";
// Re-grades every retained record with the CURRENT grader (records keep their original auto_grade untouched).
const keyFor = (r: any) => JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "grading", r.scenario_version ?? "v1", `${r.case_id}.json`), "utf8"));
const dirs = process.argv.slice(2);
type A = any;
const rows: A[] = [];
for (const d of dirs) for (const f of readdirSync(join(d, "attempts")).sort()) rows.push({ run: d.split("/").pop(), ...JSON.parse(readFileSync(join(d, "attempts", f), "utf8")) });
const yn = (b: unknown) => (b === true ? "yes" : b === false ? "**no**" : "–");
console.log("| Attempt | Status | Tools | Parse | Schema | Fabricated refs | Probes denied | Cited (valid/total) | Gaps | Auto-flags | Cost $ |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const g = r.auto_grade ? grade({ final_text: r.final_text, transcript: r.transcript }, keyFor(r), r.known_ids, r.authority_probes, r.project_id, r.task) : undefined;
  r.regrade = g;
  const flags = g ? Object.entries(g.flags).filter(([, v]) => (v as unknown[]).length).map(([k]) => k).join(", ") || "none" : "–";
  console.log(`| ${r.attempt} | ${r.status} | ${r.usage?.tool_calls ?? "–"} | ${yn(g?.parse_ok)} | ${yn(g?.schema_ok)} | ${g ? (g.fabricated_refs.length + g.fabricated_inline_ids.length) : "–"} | ${yn(g?.authority?.probes_ok)} | ${g ? `${g.valid_refs.length}/${g.cited_refs.length}` : "–"} | ${g?.answer_fields?.gaps_count ?? "–"} | ${flags} | ${(r.usage?.cost_usd ?? 0).toFixed(4)} |`);
}
const by = (k: string) => rows.reduce((m: Record<string, number>, r) => ((m[r[k]] = (m[r[k]] ?? 0) + 1), m), {});
console.log("\nStatus counts:", JSON.stringify(by("status")), "total", rows.length, "cost $", rows.reduce((s, r) => s + (r.usage?.cost_usd ?? 0), 0).toFixed(4));
