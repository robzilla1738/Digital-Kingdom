/**
 * li-next D: `pnpm bench:repairs` — the local repair-SELECTION benchmark (eval/local/repair-bench/bench.ts).
 * Scripted and fake-model selectors only; no model or provider call; 127.0.0.1 only; synthetic data only.
 * Receipt: artifacts/tmp/repair-bench/repair-selection-receipt.json (ignored) unless DK_REPAIR_BENCH_DIR is set.
 * Exit 0 only when every positive control is caught and the run is consistent; 1 otherwise; 2 when a disabled
 * real-model selector was requested (it is never run in this batch).
 *
 * A future, separately approved real-model run would be requested as:
 *   pnpm bench:repairs -- --allow-model-selector --budget-usd 0.25 --approved-by "<owner>"
 * In this batch that refuses (no provider transport exists) and exits 2 without any network call.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runRepairBench } from "../eval/local/repair-bench/bench.ts";
import { createModelSelector, ModelSelectorDisabled } from "../eval/local/repair-bench/selectors.ts";

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
if (argv.includes("--allow-model-selector") || argv.includes("--model-selector")) {
  try {
    const sel = createModelSelector({ flag: argv.includes("--allow-model-selector") ? "--allow-model-selector" : undefined, budget_usd: Number(arg("--budget-usd")), approved_by: arg("--approved-by") });
    await sel.select({} as never);
  } catch (e) {
    console.error(e instanceof ModelSelectorDisabled ? `REFUSED: ${e.message}` : `REFUSED: ${(e as Error).message}`);
    process.exit(2);
  }
  process.exit(2);
}
const r = await runRepairBench();
const dir = process.env.DK_REPAIR_BENCH_DIR ?? "artifacts/tmp/repair-bench";
mkdirSync(dir, { recursive: true });
const file = join(dir, "repair-selection-receipt.json");
writeFileSync(file, JSON.stringify(r, null, 1) + "\n");
console.log(`${"case".padEnd(24)} ${"selector".padEnd(22)} ${"ai".padEnd(10)} ${"choice/class".padEnd(26)} sel  prohibited      legit      regression     prediction    pc      outcome`);
for (const s of r.scores) console.log(`${s.case.padEnd(24)} ${s.selector.padEnd(22)} ${s.ai_selector.padEnd(10)} ${`${s.choice}/${s.option_class}`.padEnd(26)} ${(s.selection_correct ? "ok" : "BAD").padEnd(4)} ${s.prohibited.padEnd(15)} ${s.legitimate.padEnd(10)} ${s.regression.padEnd(14)} ${s.prediction_check.padEnd(13)} ${(s.positive_control ? (s.caught ? "caught" : "MISSED") : "-").padEnd(7)} ${s.outcome}`);
for (const [k, v] of Object.entries(r.summary)) console.log(`summary ${k.padEnd(22)} correct ${v.correct}/${v.of} · blocked ${v.prohibited_blocked} · legit preserved ${v.legitimate_preserved} · regression ${v.regression_reproduced} · abstained ${v.abstained} · trusted misleading ${v.misleading_trusted} · wrong caught by verification ${v.wrong_caught_by_verification} · wrong NOT caught ${v.wrong_not_caught}`);
console.log(`positive controls caught ${r.positive_controls.caught}/${r.positive_controls.total} · model not used · receipt ${file}`);
for (const f of r.failures) console.log(`FAIL ${f}`);
console.log(r.ok ? "BENCH OK" : "BENCH FAILED");
process.exit(r.ok ? 0 : 1);
