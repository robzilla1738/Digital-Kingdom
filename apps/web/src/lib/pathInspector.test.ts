import { describe, expect, it } from "vitest";
import { hopStyle, type PathHop } from "./pathInspector.ts";

const hop = (p: Partial<PathHop>): PathHop => ({ kind: "relationship", from: "a", to: "b", ref: "r", basis: "declared_relationship", observed: false, provenance: [], condition_keys: [], presentation: { animate: false, line: "dashed_declared" }, ...p });
describe("LP13-A1 console hop presentation", () => {
  it("only observed activity with evidence refs animates; conditional or feasible permission never does, even if a response claims it", () => {
    expect(hopStyle(hop({ basis: "observed_activity", observed: true, provenance: ["ev-1"] })).animate).toBe(true);
    expect(hopStyle(hop({ basis: "observed_activity", observed: true, provenance: [] })).animate).toBe(false);
    const forged = hop({ kind: "permission", basis: "observed_activity", observed: true, provenance: ["x"], result: "conditional", presentation: { animate: true, line: "solid_observed" } });
    expect(hopStyle(forged)).toMatchObject({ animate: false, label: "conditional permission (conditions not evaluated)" });
    expect(hopStyle(hop({ kind: "permission", basis: "configured_permission", result: "feasible" }))).toMatchObject({ animate: false, label: "configured permission: feasible" });
    expect(hopStyle(hop({ basis: "proposed_relationship", observed: true, provenance: ["x"] })).animate).toBe(false);
  });
});
