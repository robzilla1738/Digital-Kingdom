/**
 * LP31 one-command local demo: `pnpm loop:local`. Runs the integrated local loop (eval/local/integrated-loop.ts) on the
 * current checkout, in one leased local world (investigation, generated LP14 candidate, leased typed repair, independent
 * verification, regression capture), and writes an exact-candidate receipt. No model call; 127.0.0.1 only; synthetic data only.
 * Receipt: artifacts/tmp/lp31/integrated-loop-receipt.json (ignored) unless DK_LP31_RECEIPT_DIR is set.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runIntegratedLoop } from "../eval/local/integrated-loop.ts";

const r = await runIntegratedLoop();
const dir = process.env.DK_LP31_RECEIPT_DIR ?? "artifacts/tmp/lp31";
mkdirSync(dir, { recursive: true });
const file = join(dir, "integrated-loop-receipt.json");
writeFileSync(file, JSON.stringify(r, null, 1) + "\n");
for (const s of r.stages) console.log(`${s.stage.padEnd(34)} ${s.outcome}`);
const sel = r.stages.find((s) => s.stage === "repair_candidates")?.detail.selected as { candidate_id: string; actions: string[] } | null | undefined;
console.log(`one leased run ${r.run.run_id}${r.run.single_run ? "" : " (NOT single-run)"} · executed generated candidate ${sel ? `${sel.candidate_id} ${sel.actions.join("; ")}` : "none"}`);
console.log(`candidate ${r.candidate.commit}${r.candidate.dirty ? " (dirty tree)" : ""} · model not used · receipt ${file}`);
console.log(r.ok ? "LOOP OK" : "LOOP INCOMPLETE");
process.exit(r.ok ? 0 : 1);
