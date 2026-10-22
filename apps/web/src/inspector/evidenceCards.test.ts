import { describe, expect, it } from "vitest";
import type { SecurityEvent } from "@dk/contracts";
import { EVIDENCE_CARDS_PER_PAGE, EVIDENCE_TEXT_LIMIT, evidenceCardPayload, evidenceDisplayPage, evidenceTextPage } from "./evidenceCards.ts";

describe("finding evidence display bounds without data loss", () => {
  it("renders at most 20 of 5000 loaded records while every ordered record remains reachable", () => {
    const records = Object.freeze(Array.from({ length: 5000 }, (_, id) => Object.freeze({ id })));
    const first = evidenceDisplayPage(records, 1), last = evidenceDisplayPage(records, 99999);
    expect(first.items).toHaveLength(EVIDENCE_CARDS_PER_PAGE); expect(first.total).toBe(5000); expect(first.pages).toBe(250);
    expect(last.items.map((record) => record.id)).toEqual(Array.from({ length: 20 }, (_, index) => 4980 + index));
    const all = Array.from({ length: first.pages }, (_, index) => evidenceDisplayPage(records, index + 1).items).flat();
    expect(all).toEqual(records); expect(all[0]).toBe(records[0]); expect(records).toHaveLength(5000);
  });
  it("bounds event rows independently of the loaded server pages", () => {
    const rows = Object.freeze(Array.from({ length: 250 }, (_, id) => ({ id })));
    expect(evidenceDisplayPage(rows, 1, 100)).toMatchObject({ page: 1, pages: 3, total: 250, start: 0, end: 100 });
    expect(evidenceDisplayPage(rows, 2, 100).items).toEqual(rows.slice(100, 200));
    expect(evidenceDisplayPage(rows, 3, 100).items).toEqual(rows.slice(200));
    expect(rows).toHaveLength(250);
  });
  it("clamps display offsets after shorter revisions and handles an empty loaded collection", () => {
    expect(evidenceDisplayPage([1, 2], 3)).toMatchObject({ page: 1, pages: 1, items: [1, 2], total: 2 });
    expect(evidenceDisplayPage([1], -1).page).toBe(1);
    expect(evidenceDisplayPage([], 8)).toMatchObject({ page: 1, pages: 1, start: 0, end: 0, items: [] });
  });
  it("bounds long raw text while reconstructing it exactly, including surrogate pairs at boundaries", () => {
    const text = JSON.stringify({ note: "x".repeat(4093) + "😀".repeat(9000) + "<script>not instructions</script>" }, null, 2);
    const first = evidenceTextPage(text, 1), pages = Array.from({ length: first.pages }, (_, index) => evidenceTextPage(text, index + 1));
    expect(pages.length).toBeGreaterThan(1); expect(pages.every((page) => page.text.length <= EVIDENCE_TEXT_LIMIT)).toBe(true);
    expect(pages.map((page) => page.text).join("")).toBe(text);
    for (const page of pages) { expect(page.text).not.toMatch(/^[\uDC00-\uDFFF]/); expect(page.text).not.toMatch(/[\uD800-\uDBFF]$/); }
  });
  it("serializes only the selected event's stored references and distinguishes missing/native references", () => {
    const event = { id: "event1", evidence_refs: ["evidence:own", "evidence:missing", "source-native:record", "evidence:own"] } as SecurityEvent;
    const records = { "evidence:own": { note: "<img src=x onerror=alert(1)>", redacted: true }, "evidence:other": { note: "unrelated record" } };
    const payload = evidenceCardPayload(event, records);
    expect(payload.normalized_event).toBe(event); expect(payload.redacted_stored_evidence).toEqual({ "evidence:own": records["evidence:own"] });
    expect(payload.missing_stored_evidence_refs).toEqual(["evidence:missing"]);
    expect(payload.source_native_references_not_stored_payloads).toEqual(["source-native:record"]);
    expect(JSON.stringify(payload)).not.toContain("unrelated record"); expect(records["evidence:own"].note).toContain("<img");
  });
});
