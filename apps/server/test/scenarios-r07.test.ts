import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** R07.3 scenario manifests are complete and every referenced test exists. */
const ROOT = resolve(import.meta.dirname, "../../..");
const dir = join(ROOT, "scenarios/dk-t");
const ms = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
const design = JSON.parse(readFileSync(join(ROOT, "docs/roadmap/forward-from-14d205f/CONTROLLED_SCENARIOS.json"), "utf8")).scenario_designs.scenarios as { id: string; title: string }[];

describe("R07.3 scenario manifests", () => {
  it("cover DK-T01 to DK-T16 with expected observations, disallowed claims and a missing-evidence variant", () => {
    expect(ms.map((m) => m.id)).toEqual(design.map((d) => d.id));
    for (const m of ms) {
      expect(m.schema).toBe("dk.scenario.v1");
      expect(m.expected_observations.length).toBeGreaterThan(0);
      expect(m.disallowed_claims.length).toBeGreaterThan(0);
      expect(typeof m.missing_evidence_variant).toBe("string");
      if (m.execution === "local" || m.execution === "partial_model_eval_gated") expect(m.tests.length, m.id).toBeGreaterThan(0);
      else expect(m.unavailable_reason, m.id).toBeTruthy();
    }
    expect(ms.filter((m) => m.execution === "response_dependent").map((m) => m.id)).toEqual(["DK-T10", "DK-T11"]);
  });
  it("every referenced test name exists in its file", () => {
    for (const m of ms) for (const t of m.tests) expect(readFileSync(join(ROOT, t.file), "utf8"), `${m.id} -> ${t.file}: ${t.name}`).toContain(t.name);
  });
});
