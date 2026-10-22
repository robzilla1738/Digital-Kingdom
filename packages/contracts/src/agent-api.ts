/**
 * Agent-facing response contracts (JSON Schemas in schemas/agent/). These describe what the read-only
 * investigation API returns; they are not ingest formats.
 */
import type { CoverageState, SecurityEvent } from "./types.ts";

export interface CorrelationNote { filter?: string; field?: string; namespace: string; trust: string }

/** dk.event_search.v1 */
export interface EventSearchResponse {
  schema: "dk.event_search.v1";
  project_id: string;
  interval: { after: string; before: string; max_days: number };
  filters: Record<string, string | string[] | null>;
  /** project event high-water mark the pages are pinned to */
  snapshot_seq: number;
  events: SecurityEvent[];
  page: { limit: number; returned: number; has_more: boolean; next_cursor: string | null; position_start: number; position_end: number };
  /** did the pages return every STORED event matching the filters in the pinned snapshot */
  query_completeness: { matching_in_snapshot: number; returned_through_this_page: number; complete: boolean; truncated: boolean; later_arrivals_not_included: number; note: string };
  /** could the sources that would record this activity have recorded it (separate from query completeness) */
  source_coverage: { sources: { source_id: string; label: string; kind: string; asset_ids: string[]; disabled: boolean; current_state: CoverageState; last_event_at: string | null; events_in_interval: number }[]; unobserved_asset_ids: string[]; gaps: string[] };
  correlation: CorrelationNote[];
  limits: string[];
}

/** dk.event_detail.v1 */
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

/** dk.change_assessment.v2 (v1's ambiguous `assessment_complete` was removed) */
export interface ChangeAssessmentV2 {
  schema: "dk.change_assessment.v2";
  posture: ChangePosture;
  posture_meaning: string;
  /** true only for no_recorded_concerns / proceed_with_care, which require full resolution AND sufficient evidence */
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

/** HTTP 400/422 body. details: one message per problem, JSON-pointer style path first when one applies. */
export interface ValidationErrorResponse { error: string; details: string[] }
