import type { AttentionItem, AttentionKind } from "./attention.ts";

/**
 * next-C attention compaction. Presentation only: it never drops, merges, acknowledges or re-scores an item. Repeated
 * low-priority items of one kind collapse into a summary row with an exact count; expanding it shows every item as an
 * ordinary card. Significant items are never grouped.
 */
export type AttentionRow =
  | { type: "item"; item: AttentionItem }
  | { type: "group"; key: string; kind: AttentionKind; urgency: "low"; count: number; items: AttentionItem[]; subjects: string[] };

/** Kinds that are always shown on their own: coverage/observer gaps, contradictions and incomplete repairs. */
const ALWAYS_VISIBLE: ReadonlySet<AttentionKind> = new Set(["observer_gap", "contradiction", "incomplete_repair"]);
export function isSignificantAttention(i: AttentionItem): boolean {
  return i.urgency !== "low" || ALWAYS_VISIBLE.has(i.kind);
}
/** A change since acknowledgement is news; it keeps its own row too. */
const standalone = (i: AttentionItem) => isSignificantAttention(i) || !!i.new_since_acknowledged;

/** Rows in display order: standalone items first (input order), then routine rows with groups at their first member. */
export function compactAttention(items: readonly AttentionItem[], minGroup = 2): AttentionRow[] {
  const first: AttentionRow[] = [], rest: AttentionRow[] = [];
  const routine = items.filter((i) => !standalone(i));
  const byKind = new Map<AttentionKind, AttentionItem[]>();
  for (const i of routine) { const l = byKind.get(i.kind) ?? []; l.push(i); byKind.set(i.kind, l); }
  const placed = new Set<AttentionKind>();
  for (const i of items) {
    if (standalone(i)) { first.push({ type: "item", item: i }); continue; }
    const same = byKind.get(i.kind)!;
    if (same.length < Math.max(2, minGroup)) { rest.push({ type: "item", item: i }); continue; }
    if (placed.has(i.kind)) continue;
    placed.add(i.kind);
    rest.push({ type: "group", key: `low:${i.kind}`, kind: i.kind, urgency: "low", count: same.length, items: same, subjects: same.map((x) => x.subject.id) });
  }
  return [...first, ...rest];
}

/** Every item currently shown, given which groups are expanded. With all expanded this is exactly the input set. */
export function flattenAttentionRows(rows: readonly AttentionRow[], expanded: (key: string) => boolean): AttentionItem[] {
  return rows.flatMap((r) => r.type === "item" ? [r.item] : expanded(r.key) ? r.items : []);
}
