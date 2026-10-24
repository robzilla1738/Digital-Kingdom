import { describe, expect, it } from "vitest";
import { attentionItems, type AttentionItem, type AttentionQueue } from "./attention.ts";

const item = (id: string, project: string, urgency: AttentionItem["urgency"], seq: number): AttentionItem => ({ schema: "dk.attention_item.v1", id, project_id: project, kind: "new_evidence", urgency, urgency_note: null, state: "open", case_id: "case_1", subject: { type: "case", id: "case_1" }, summary: "s", occurrences: 1, new_since_acknowledged: null, repeats: 0, first_at: "", last_at: "", acknowledged_at: null, acknowledged_by: null, last_seq: seq, recent_refs: [] });
const q = (project: string, items: AttentionItem[]): AttentionQueue => ({ schema: "dk.attention_queue.v1", project_id: project, items, counts: { open: items.length, acknowledged: 0 }, head_seq: 0, remote_delivery: "none", rules: { acknowledgement: "", urgent_per_hour: 5 } });

describe("LP15 attention items in the console", () => {
  it("orders by urgency then recency and never shows another project's item, even in a forged response", () => {
    const list = attentionItems(q("shop", [item("a", "shop", "low", 9), item("b", "shop", "high", 1), item("x", "other", "high", 10), item("c", "shop", "medium", 5), item("d", "shop", "high", 3)]), "shop");
    expect(list.map((i) => i.id)).toEqual(["d", "b", "c", "a"]);
    expect(attentionItems(q("other", [item("x", "other", "high", 1)]), "shop")).toEqual([]);
    expect(attentionItems(null, "shop")).toEqual([]);
  });
});
