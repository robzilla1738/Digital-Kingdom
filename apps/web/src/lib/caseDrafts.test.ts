import { describe, expect, it } from "vitest";
import { CaseDrafts } from "./caseDrafts.ts";

describe("LP12-A1 case drafts are scoped to (project, case, field)", () => {
  it("a draft typed in case A is not visible in case B or another project, and returns when A is reopened", () => {
    const d = new CaseDrafts();
    const a = { project: "shop", caseId: "case_a" }, b = { project: "shop", caseId: "case_b" }, other = { project: "second", caseId: "case_a" };
    d.set(a, "item_text", "note for A");
    expect(d.get(b, "item_text")).toBe("");
    expect(d.get(other, "item_text")).toBe("");
    d.set(b, "item_text", "note for B");
    expect(d.get(a, "item_text")).toBe("note for A");
    expect(d.pending(a)).toEqual(["item_text"]);
    d.set(a, "item_text", "");
    expect(d.pending(a)).toEqual([]);
    expect(d.get(b, "item_text")).toBe("note for B");
  });
  it("ids that share prefixes never collide, and sign-out/project change clears drafts", () => {
    const d = new CaseDrafts();
    d.set({ project: "p", caseId: "c1" }, "x", "one");
    d.set({ project: "p", caseId: "c10" }, "x", "ten");
    d.set({ project: "p1", caseId: "c1" }, "x", "other project");
    expect(d.pending({ project: "p", caseId: "c1" })).toEqual(["x"]);
    expect(d.get({ project: "p", caseId: "c1" }, "x")).toBe("one");
    d.clearProject("p");
    expect(d.get({ project: "p", caseId: "c10" }, "x")).toBe("");
    expect(d.get({ project: "p1", caseId: "c1" }, "x")).toBe("other project");
    d.clearAll();
    expect(d.size).toBe(0);
  });
});
