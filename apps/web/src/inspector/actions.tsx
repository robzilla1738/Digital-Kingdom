import { createContext } from "react";
import type { EventDetailResponse, EventSearchResponse } from "@dk/contracts";
import type { EventSearchInput, FindingDetailResult, FindingEvidenceResult } from "../lib/investigation.ts";

export interface ServerActions {
  importInventory(input: { format: "manifest" | "compose"; revision: string; environment: string; text: string }): Promise<{ graph_revision: string; scene_digest: string; reflow_zones: string[]; warnings: string[]; unresolved: string[] }>;
  role: "viewer" | "analyst" | "admin" | "none";
  setDisposition(id: string, body: { lifecycle?: string; disposition?: string; note?: string; expected_state_version?: number }): Promise<void>;
  exportCase(id: string): Promise<void>;
  containment(signal?: AbortSignal): Promise<{ catalog: { id: string; title: string; applies_to_kinds: string[]; blast_radius: string; reversible: boolean }[]; requests: Record<string, string>[] }>;
  requestContainment(findingId: string, actionId: string, rationale: string): Promise<void>;
  findingEvidence(id: string, signal?: AbortSignal): Promise<FindingEvidenceResult>;
  findingDetail(id: string, signal?: AbortSignal): Promise<FindingDetailResult>;
  searchEvents(query: EventSearchInput, signal?: AbortSignal): Promise<EventSearchResponse>;
  eventDetail(id: string, signal?: AbortSignal): Promise<EventDetailResponse>;
  /** R01.2 historical, question-specific coverage. */
  coverageHistory(q: { asset: string; action: string; outcome?: string; after: string; before: string }, signal?: AbortSignal): Promise<CoverageHistoryResult>;
  /** R01.3 immutable evidence bundle for a finding revision. */
  createBundle(findingId: string, revision?: number): Promise<BundleMeta>;
}
export interface CoverageHistoryResult {
  known_at: string;
  spans: { from: string; to: string; state: "covered" | "partial" | "unknown"; sources: { source_id: string; state: string; reason: string }[] }[];
  totals_ms: { covered: number; partial: number; unknown: number };
  notes: string[];
}
export interface BundleMeta { bundle_id: string; bundle_digest: string; finding_revision: number; reference_count: number; expires_at: string | null; pinned: boolean; omissions: string[] }
export const ActionsCtx = createContext<ServerActions | null>(null);
