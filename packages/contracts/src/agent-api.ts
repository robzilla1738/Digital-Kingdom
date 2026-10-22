/** Agent-facing response contracts. JSON Schemas live in schemas/agent/. */
import type { CoverageState, SecurityEvent } from "./types.ts";
export interface CorrelationNote { filter?: string; field?: string; namespace: string; trust: string }
export interface EventSearchResponse {
  schema: "dk.event_search.v1";
  project_id: string;
  interval: { after: string; before: string; max_days: number };
  filters: Record<string, string | string[] | null>;
  snapshot_seq: number;
  events: SecurityEvent[];
  page: { limit: number; returned: number; has_more: boolean; next_cursor: string | null; position_start: number; position_end: number };
  query_completeness: { matching_in_snapshot: number; returned_through_this_page: number; complete: boolean; truncated: boolean; later_arrivals_not_included: number; note: string };
  /** Current configuration/health, NOT historical health throughout interval or an event-snapshot guarantee. */
  source_coverage: {
    coverage_basis: "current_state";
    coverage_as_of: string;
    historical_coverage_assessed: false;
    sources: { source_id: string; label: string; kind: string; asset_ids: string[]; disabled: boolean; current_state: CoverageState; last_event_at: string | null; events_in_interval: number }[];
    unobserved_asset_ids: string[]; gaps: string[];
  };
  correlation: CorrelationNote[];
  limits: string[];
}
export interface EventDetailResponse {
  schema: "dk.event_detail.v1";
  project_id: string;
  event: SecurityEvent;
  source: { id: string; label: string | null; kind: string | null; note?: string };
  evidence: { untrusted: true; derivative: "redacted-at-ingestion"; records: Record<string, Record<string, unknown>> };
  evidence_completeness: { expected_records: number; returned_records: number; missing_evidence_refs: string[]; reference_only_refs: string[]; complete: boolean; note?: string };
  referenced_by_findings: { id: string; kind: string; role: "supporting" | "counterevidence"; lifecycle: string }[];
  correlation: CorrelationNote[];
  limits: string[];
}
export type ChangePosture = "hold" | "proceed_with_care" | "insufficient_context" | "not_assessed" | "no_recorded_concerns";
/** dk.change_assessment.v2: target resolution and evidence sufficiency are deliberately separate. */
export interface ChangeAssessmentV2 {
  schema: "dk.change_assessment.v2";
  posture: ChangePosture;
  posture_meaning: string;
  favorable: boolean;
  target_resolution: { complete: boolean; requested: number; resolved: number; unresolved: number };
  evidence_sufficiency: { sufficient: boolean; insufficient_targets: { asset_id: string; sufficient: false; reasons: { source_id: string | null; state: "stale" | "offline" | "not_assessed" | "unobserved"; detail: string }[] }[]; scope: string };
  targets_requested: number; targets_resolved: number; targets_unresolved: number;
  unresolved: { target: { asset?: string; route?: string }; reason: "unknown_target" | "missing_graph" | "lookup_error"; error: string }[];
  targets: { asset: { id: string; name: string; kind: string }; direct_findings: string[]; coverage: unknown[]; evidence_sufficient: boolean }[];
  blocking_findings: unknown[];
  recommendations: string[];
  summary_echo?: string;
}
export interface ValidationErrorResponse { error: string; details: string[] }
