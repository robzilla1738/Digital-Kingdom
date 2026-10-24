import { describe, expect, it } from "vitest";
import { nextObligation } from "./caseFocus.ts";

const ob = (id: string, status: string) => ({ id, kind: "k", question: `q ${id}`, status, reason: "", supports_negative_claims: false, evidence_ref_count: 0, anchors: [] });
describe("next-C case focus", () => {
  it("names the first obligation still needing evidence, failed and partial before not started, unavailable last", () => {
    expect(nextObligation([ob("a", "satisfied"), ob("b", "not_started"), ob("c", "partial")])?.id).toBe("c");
    expect(nextObligation([ob("a", "unavailable"), ob("b", "not_started")])?.id).toBe("b");
    expect(nextObligation([ob("a", "failed"), ob("b", "partial")])?.id).toBe("a");
    expect(nextObligation([ob("a", "unavailable")])?.id).toBe("a");
    expect(nextObligation([ob("a", "satisfied"), ob("b", "inapplicable_with_reason")])).toBeNull();
    expect(nextObligation([])).toBeNull();
  });
});
