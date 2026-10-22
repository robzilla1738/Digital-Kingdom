// Renders the versioned scenario snapshots and protected grading keys from eval/src/scenarios.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SCENARIO_IDS, SCENARIO_VERSION, renderCase } from "../src/scenarios.ts";
const root = resolve(import.meta.dirname, "..");
for (const d of ["scenarios", "grading"]) mkdirSync(join(root, d, SCENARIO_VERSION), { recursive: true });
for (const s of SCENARIO_IDS) for (const v of ["a", "b"] as const) {
  const { spec, key } = renderCase(s, v);
  writeFileSync(join(root, "scenarios", SCENARIO_VERSION, `${spec.case_id}.json`), JSON.stringify(spec, null, 2) + "\n");
  writeFileSync(join(root, "grading", SCENARIO_VERSION, `${key.case_id}.json`), JSON.stringify(key, null, 2) + "\n");
}
console.log(`rendered ${SCENARIO_IDS.length * 2} cases (${SCENARIO_VERSION})`);
