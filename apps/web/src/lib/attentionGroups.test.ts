import { describe, expect, it } from "vitest";
import type { AttentionItem } from "./attention.ts";
import { compactAttention, isSignificantAttention, flattenAttentionRows } from "./attentionGroups.ts";

let seq = 0;
const item = (id: string, kind: AttentionItem["kind"], urgency: AttentionItem["urgency"], extra: Partial<AttentionItem> = {}): AttentionItem => ({
  schema: "dk.attention_item.v1", id, project_id: "shop", kind, urgency, urgency_note: null, state: "open", case_id: null, subject: { type: "source", id: `src-${id}` },
  summary: `summary ${id}`, occurrences: 1, new_since_acknowledged: null, repeats: 0, first_at: "", last_at: "", acknowledged_at: null, acknowledged_by: null, last_seq: ++seq, recent_refs: [], ...extra,
});

describe("next-C attention compaction (grouping is presentation only)", () => {
  it("never groups significant items: high/medium urgency, coverage (observer) gaps, contradictions, incomplete repairs", () => {
    expect(isSignificantAttention(item("a", "stale_check", "high"))).toBe(true);
    expect(isSignificantAttention(item("b", "stale_check", "medium"))).toBe(true);
    expect(isSignificantAttention(item("c", "observer_gap", "low"))).toBe(true);
    expect(isSignificantAttention(item("d", "contradiction", "low"))).toBe(true);
    expect(isSignificantAttention(item("e", "incomplete_repair", "low"))).toBe(true);
    expect(isSignificantAttention(item("f", "stale_check", "low"))).toBe(false);
    expect(isSignificantAttention(item("g", "new_evidence", "low"))).toBe(false);
    const gaps = [item("g1", "observer_gap", "low"), item("g2", "observer_gap", "low"), item("g3", "observer_gap", "low")];
    const highs = [item("h1", "stale_check", "high"), item("h2", "stale_check", "high")];
    const rows = compactAttention([...highs, ...gaps]);
    expect(rows.every((r) => r.type === "item")).toBe(true);
    expect(rows.map((r) => r.type === "item" && r.item.id)).toEqual(["h1", "h2", "g1", "g2", "g3"]);
  });

  it("groups repeated low-priority items of one kind with an exact count, after significant items", () => {
    const items = [item("hi", "contradiction", "high"), item("s1", "stale_check", "low"), item("s2", "stale_check", "low"), item("s3", "stale_check", "low"), item("gap", "observer_gap", "low"), item("n1", "new_evidence", "low")];
    const rows = compactAttention(items);
    expect(rows.map((r) => r.type === "item" ? r.item.id : `group:${r.kind}:${r.count}`)).toEqual(["hi", "gap", "group:stale_check:3", "n1"]);
    const g = rows.find((r) => r.type === "group")!;
    expect(g.type === "group" && g.items.map((i) => i.id)).toEqual(["s1", "s2", "s3"]);
    expect(g.type === "group" && g.subjects).toEqual(["src-s1", "src-s2", "src-s3"]);
  });

  it("a single low item stays an ordinary row (nothing to compact)", () => {
    const rows = compactAttention([item("s1", "stale_check", "low"), item("n1", "new_evidence", "low")]);
    expect(rows.every((r) => r.type === "item")).toBe(true);
  });

  it("an unacknowledged change on an acknowledged item stays visible on its own", () => {
    const rows = compactAttention([item("s1", "stale_check", "low"), item("s2", "stale_check", "low", { new_since_acknowledged: 2 }), item("s3", "stale_check", "low")]);
    expect(rows.map((r) => r.type === "item" ? r.item.id : `group:${r.count}`)).toEqual(["s2", "group:2"]);
  });

  it("expanding reveals every item: no item is lost or duplicated, whatever the mix", () => {
    const kinds: AttentionItem["kind"][] = ["new_evidence", "contradiction", "incomplete_repair", "observer_gap", "stale_check"];
    const urg: AttentionItem["urgency"][] = ["low", "medium", "high"];
    for (let n = 0; n < 40; n++) {
      const items = Array.from({ length: n }, (_, i) => item(`x${n}-${i}`, kinds[(i * 7 + n) % 5]!, urg[(i * 3 + n) % 4 === 0 ? 1 : (i + n) % 5 === 0 ? 2 : 0]!));
      const rows = compactAttention(items);
      const collapsed = rows.reduce((s, r) => s + (r.type === "group" ? r.count : 1), 0);
      expect(collapsed).toBe(items.length);
      const all = flattenAttentionRows(rows, () => true).map((i) => i.id);
      expect(all.slice().sort()).toEqual(items.map((i) => i.id).sort());
      expect(new Set(all).size).toBe(items.length);
      const none = flattenAttentionRows(rows, () => false);
      expect(none.every((i) => isSignificantAttention(i) || !rows.some((r) => r.type === "group" && r.items.includes(i)))).toBe(true);
      for (const r of rows) if (r.type === "group") { expect(r.count).toBe(r.items.length); expect(r.count).toBeGreaterThanOrEqual(2); expect(r.items.every((i) => !isSignificantAttention(i) && i.kind === r.kind)).toBe(true); }
    }
  });
});
