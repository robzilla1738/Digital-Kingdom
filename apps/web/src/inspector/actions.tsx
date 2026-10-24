import { createContext } from "react";
import type { EventDetailResponse, EventSearchResponse } from "@dk/contracts";
import type { EventSearchInput, FindingDetailResult, FindingEvidenceResult } from "../lib/investigation.ts";
import type { Workbench } from "../lib/workbench.ts";
import type { PathExplanation } from "../lib/pathInspector.ts";

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
  bundleEvidence(bundle: BundleMeta, signal?: AbortSignal): Promise<FindingEvidenceResult>;
  /** R03.1 durable cases. `path` is relative to the case (e.g. "/items"); empty for the case itself. */
  listCases(signal?: AbortSignal): Promise<{ cases: CaseSummary[] }>;
  getCase(id: string, signal?: AbortSignal): Promise<CaseDetail>;
  createCase(body: Record<string, unknown>): Promise<CaseDetail>;
  caseAction(id: string, path: string, body: Record<string, unknown>): Promise<CaseDetail>;
  exportDurableCase(id: string): Promise<void>;
  /** LP12 investigation workbench (read-only) and opening/refreshing the case's investigation contract. Optional: absent on older servers/mocks. */
  caseWorkbench?(id: string, signal?: AbortSignal): Promise<Workbench>;
  openContract?(id: string): Promise<unknown>;
  /** LP13 "why can this reach that?" over the stored inventory and authorization snapshot. Optional. */
  analysisPaths?(q: { from: string; to: string; principal?: string; action?: string; resource?: string; comparison?: string }, signal?: AbortSignal): Promise<PathExplanation>;
  /** R02.1 connector manifests. */
  connectors(signal?: AbortSignal): Promise<ConnectorCatalogResult>;
  /** R03.2 recipes; with caseId the hypotheses are attached to the case. */
  recipes(signal?: AbortSignal): Promise<{ recipes: { id: string; version: number; title: string; applies_to: string[] }[] }>;
  runRecipe(recipeId: string, findingId: string, attach?: { caseId: string; expectedVersion: number }): Promise<RecipeRun>;
  /** R02.3 read-only repository discovery. */
  githubPreview(owner: string, repo: string): Promise<GithubPreview>;
  githubApply(previewId: string, expectedGraphRevision: string | null): Promise<void>;
  /** R07.1 controls. */
  controls(signal?: AbortSignal): Promise<{ controls: { id: string; name: string; kind: string; asset_ids: string[]; state: string; state_reason: string }[] }>;
  control(id: string): Promise<any>;
  /** R03.5 notification outbox status and acknowledgement. */
  notifications(signal?: AbortSignal): Promise<NotificationStatus>;
  acknowledgeNotification(id: string): Promise<{ acknowledged: number }>;
  /** LP04 local world preview (pure read) and LP06 local-run reporting. Optional: absent on older servers/mocks. */
  localWorldPreview?(input: { blueprint: string; seed: string }): Promise<unknown>;
  localWorldReporting?(signal?: AbortSignal): Promise<unknown>;
}
export interface NotificationStatus {
  counts: { pending: number; delivered: number; failed: number; acknowledged: number };
  failures: { id: string; destination_id: string; kind: string; state: string; attempts: number; last_error: string | null; next_attempt_at: string | null }[];
  recent: { id: string; kind: string; severity: string; destination_id: string; state: string; attempts: number; case_id: string | null; created_at: string; delivered_at: string | null; acknowledged_at: string | null }[];
  note: string;
}
export interface GithubPreview { preview_id: string; base_graph_revision: string | null; repository: string; additions: string[]; removals: string[]; changes: string[]; collisions: string[]; partial: { resource: string; reason: string }[] }
export interface RecipeRun {
  recipe: { id: string; version: number; title: string };
  hypotheses: { id: string; kind?: "observable" | "intent" | "authorization"; statement: string; status: string; needs: string; supporting_event_ids: string[]; counter_event_ids: string[]; notes: string[] }[];
  stop_conditions: { condition: string; triggered: boolean; reason: string }[];
  conclusion_allowed: boolean; unlinked_follow_on_event_ids: string[]; notes: string[];
  /** LP02 (dk.recipe_run.v2): explicit unfinished work. Absent on v1 results. */
  completeness?: "complete" | "partial";
  outstanding?: { purpose: string; status: string; reason: string }[];
  budget: { max_queries: number; used: number };
}
export interface ConnectorCatalogResult {
  note: string; capability_levels: string[];
  connectors: { id: string; name: string; protocol: { name: string; versions: string[]; encodings: string[] }; read_scopes: { scope: string; why: string }[]; capabilities: { capability: string; level: string; evidence: string }[]; limits: string[] }[];
}
export interface CaseSummary { id: string; title: string; owner: string; status: string; version: number; updated_at: string; open_questions: number }
export interface CaseItem { item_id: string; kind: string; ref: string; text?: string; status?: string; answer?: string | null; why?: string | null; produced_finding?: boolean; revision?: number; bundle_id?: string; bundle_digest?: string; added_by: string; added_at: string; removed?: { at: string; by: string; reason: string } }
export interface CaseDetail {
  id: string; title: string; owner: string; status: string; version: number; closure_criteria: string; closure: { statement: string; by: string; at: string } | null;
  scope: { question: string; asset_ids: string[]; after?: string; before?: string };
  items: CaseItem[]; linked_findings: { finding_id: string; linked_revision: number; current_revision: number | null; current_lifecycle: string; bundle_id: string }[];
  history: { version: number; actor: string; reason: string | null; at: string }[];
}
export interface CoverageHistoryResult {
  known_at: string;
  spans: { from: string; to: string; state: "covered" | "partial" | "unknown"; sources: { source_id: string; state: string; reason: string }[] }[];
  totals_ms: { covered: number; partial: number; unknown: number };
  notes: string[];
}
export interface BundleMeta { bundle_id: string; bundle_digest: string; finding_revision: number; reference_count: number; expires_at: string | null; pinned: boolean; omissions: string[] }
export const ActionsCtx = createContext<ServerActions | null>(null);
