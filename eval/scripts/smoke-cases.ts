// Loads every case into an isolated instance (no model) and prints what the server derived. Harness check only.
import { SCENARIO_IDS, renderCase } from "../src/scenarios.ts";
import { startInstance, authorityProbes } from "../src/instance.ts";
import { mkdirSync } from "node:fs";
mkdirSync("artifacts/eval", { recursive: true });
const only = process.argv[2];
for (const s of SCENARIO_IDS) for (const v of ["a", "b"] as const) {
  const { spec } = renderCase(s, v);
  if (only && !spec.case_id.startsWith(only)) continue;
  const inst = await startInstance(spec, "artifacts/eval/smoke-server.log");
  try {
    const probes = await authorityProbes(inst);
    console.log(spec.case_id, spec.project_id, JSON.stringify(inst.snapshot.findings.map((f) => `${f.kind}/${f.outcome_state}/${f.evidence_level}`)), "unobserved", JSON.stringify(inst.snapshot.unobserved), "probes", Object.values(probes).every((p) => p.ok) ? "ALL_DENIED_OK" : JSON.stringify(probes));
  } finally { await inst.stop(); }
}
