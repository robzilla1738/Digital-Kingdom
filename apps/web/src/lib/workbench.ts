import type { Selection } from "./navigation.ts";

/** LP12 `dk.case_workbench.v1` as returned by GET /api/projects/:p/cases/:id/workbench (fields the console reads). */
export interface WorkbenchRecord { ref: string; role: string; required: boolean; occurred_at: string; action: string; outcome: string; asset_ids: string[]; source_id: string; actor_ref?: string; digest: string; obligation_ids: string[]; anchors: string[]; untrusted: Record<string, string> }
export interface WorkbenchAnchor { id: string; kind: "asset" | "event" | "finding"; ref: string; selection: { kind: "asset" | "event" | "finding"; id: string } }
export interface Workbench {
  schema: "dk.case_workbench.v1"; project_id: string;
  case: { id: string; title: string; version: number; status: string; question: string };
  provenance: { local_run: boolean; label?: string; run_id?: string };
  contract: { id: string; revision: number; stale: boolean; readiness: string } | null;
  progress: { readiness: string; reason: string; obligations: { total: number; by_status: Record<string, number> }; closure_prerequisites: { id: string; requirement: string; met: boolean; reason: string }[] };
  evidence_questions: { id: string; kind: string; question: string; status: string; reason: string; supports_negative_claims: boolean; evidence_ref_count: number; anchors: string[] }[];
  case_record: { questions: { item_id: string; text: string; status: string; answer: string | null }[]; hypotheses: { item_id: string; text: string; status: string; answer: string | null }[]; notes: { item_id: string; text: string; added_by: string }[] };
  competing_hypotheses: { items: { item_id: string; text: string; status: string; answer: string | null }[]; decided: number; note: string };
  evidence: { supporting: WorkbenchRecord[]; counter: WorkbenchRecord[]; other: WorkbenchRecord[]; complete: boolean; complete_for_required?: boolean; omitted_required: { ref: string; role: string; reason: string }[]; omitted_other: { role: string; count?: number; reason: string }[]; records_total?: number; note?: string };
  failed_queries: { kind: "obligation" | "query_step"; id: string; status: string; reason: string; question: string; resumable?: boolean; anchors: string[] }[];
  uncertainty: null | { readiness: string; readiness_reason: string; negative_claims: { id: string; assessable: boolean; reason: string }[]; coverage_gaps: { ref: string; asset_id?: string; action?: string; status: string; reason: string; uncovered_spans: unknown[]; anchors: string[] }[] };
  pending_jobs: { id: string; status: string; contract_revision: number }[];
  next_actions: { id: string; action: string; who: "person" | "analyst" | "analyst_or_agent"; why: string; route?: string }[];
  summary: { observed: string[]; supports: string[]; does_not_support: string[]; could_change: string[]; next: string };
  proposals: { items: { id: string; proposal_version: number; author: string; author_kind: "agent" | "person"; created_at: string; contract_revision: number; check_status: string; stale: boolean; claims: { id: string; type: string; text: string; support: string | null }[]; accepted: false; affects_case_record: false }[]; latest_version: number; note: string };
  anchors: WorkbenchAnchor[];
}

/** A castle/2D selection as a workbench anchor id (same canonical ids; null for kinds the workbench does not anchor). */
export function anchorForSelection(sel: Selection): string | null {
  if (!sel) return null;
  return sel.kind === "asset" || sel.kind === "event" || sel.kind === "finding" ? `${sel.kind}:${sel.id}` : null;
}
/** Records (supporting first, then counter) carrying an anchor. */
export function recordsForAnchor(wb: Workbench, anchor: string | null): WorkbenchRecord[] {
  if (!anchor) return [];
  return [...wb.evidence.counter, ...wb.evidence.supporting, ...wb.evidence.other].filter((r) => r.anchors.includes(anchor));
}
/** The selection a record's primary anchor resolves to (the event itself). */
export function selectionForRecord(r: WorkbenchRecord): NonNullable<Selection> { return { kind: "event", id: r.ref }; }

/**
 * The critical evidence and status a person must see in every layout (keyboard, reduced motion, narrow screen).
 * Tests compare this list against what is actually rendered, so a layout cannot silently drop counterevidence.
 */
export function criticalStatus(wb: Workbench): string[] {
  const out = [`Readiness: ${wb.progress.readiness}`];
  if (wb.contract?.stale) out.push("Contract stale");
  out.push(`Counter records: ${wb.evidence.counter.length}`, `Supporting records: ${wb.evidence.supporting.length}`, `Failed or partial queries: ${wb.failed_queries.length}`);
  if (wb.uncertainty) out.push(`Coverage gaps: ${wb.uncertainty.coverage_gaps.length}`, `Absence claims assessable: ${wb.uncertainty.negative_claims.filter((n) => n.assessable).length} of ${wb.uncertainty.negative_claims.length}`);
  out.push(`Open case questions: ${wb.case_record.questions.filter((q) => q.status === "open").length}`, `Agent proposals: ${wb.proposals.items.length} (none accepted)`);
  if (wb.evidence.omitted_required.length) out.push(`Required records omitted: ${wb.evidence.omitted_required.length}`);
  return out;
}

export const READINESS_LABEL: Record<string, string> = {
  no_contract: "No contract", not_started: "Not started", collecting: "Collecting evidence", blocked: "Blocked",
  bounded_answer_ready: "Bounded answer possible", unresolved_answer_ready: "Only an unresolved answer is honest",
};
