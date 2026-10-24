/** LP15 local attention queue (client types and pure helpers). */
export type AttentionKind = "new_evidence" | "contradiction" | "incomplete_repair" | "observer_gap" | "stale_check";
export interface AttentionItem {
  schema: "dk.attention_item.v1"; id: string; project_id: string; kind: AttentionKind; urgency: "low" | "medium" | "high"; urgency_note: string | null;
  state: "open" | "acknowledged"; case_id: string | null; subject: { type: string; id: string }; summary: string;
  occurrences: number; new_since_acknowledged: number | null; repeats: number; first_at: string; last_at: string;
  acknowledged_at: string | null; acknowledged_by: string | null; last_seq: number; recent_refs: string[];
}
export interface AttentionQueue {
  schema: "dk.attention_queue.v1"; project_id: string; items: AttentionItem[]; counts: { open: number; acknowledged: number }; head_seq: number;
  remote_delivery: string; rules: { acknowledgement: string; urgent_per_hour: number };
}
export const ATTENTION_KIND_LABEL: Record<AttentionKind, string> = {
  new_evidence: "New evidence", contradiction: "Contradiction", incomplete_repair: "Incomplete repair", observer_gap: "Observer gap", stale_check: "Stale check",
};
const RANK = { high: 0, medium: 1, low: 2 } as const;
/**
 * Items for display: only the queue's own project (a forged or mixed response never shows another project's item),
 * higher urgency first, then most recently changed.
 */
export function attentionItems(q: AttentionQueue | null, project: string): AttentionItem[] {
  if (!q || q.project_id !== project) return [];
  return q.items.filter((i) => i.project_id === project).slice().sort((a, b) => (RANK[a.urgency] ?? 3) - (RANK[b.urgency] ?? 3) || b.last_seq - a.last_seq);
}
