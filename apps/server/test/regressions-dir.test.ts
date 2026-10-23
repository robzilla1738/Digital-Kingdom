import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyFixture } from "../src/regression.ts";

/** R07.4: every approved, committed regression fixture still meets its expected outcome with the current rules. */
const DIR = resolve(import.meta.dirname, "../../../scenarios/regressions");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
describe("committed regression fixtures", () => {
  it("directory is readable (may be empty until a proposal is approved and merged)", () => { expect(Array.isArray(files)).toBe(true); });
  for (const f of files) it(f, () => {
    const fx = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    expect(fx.schema).toBe("dk.regression_fixture.v1");
    const v = verifyFixture(fx, fx.expected_outcome);
    expect(v, JSON.stringify(v)).toMatchObject({ ok: true });
  });
});
