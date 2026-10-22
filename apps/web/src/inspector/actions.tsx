import { createContext } from "react";
import type { EventDetailResponse, EventSearchResponse } from "@dk/contracts";
import type { EventSearchInput, FindingDetailResult, FindingEvidenceResult } from "../lib/investigation.ts";

export interface ServerActions {
  importInventory(input: { format: "manifest" | "compose"; revision: string; environment: string; text: string }): Promise<{ graph_revision: string; scene_digest: string; reflow_zones: string[]; warnings: string[]; unresolved: string[] }>;
  role: "viewer" | "analyst" | "admin" | "none";
  setDisposition(id: string, body: { lifecycle?: string; disposition?: string; note?: string }): Promise<void>;
  exportCase(id: string): Promise<void>;
  containment(signal?: AbortSignal): Promise<{ catalog: { id: string; title: string; applies_to_kinds: string[]; blast_radius: string; reversible: boolean }[]; requests: Record<string, string>[] }>;
  requestContainment(findingId: string, actionId: string, rationale: string): Promise<void>;
  findingEvidence(id: string, signal?: AbortSignal): Promise<FindingEvidenceResult>;
  findingDetail(id: string, signal?: AbortSignal): Promise<FindingDetailResult>;
  searchEvents(query: EventSearchInput, signal?: AbortSignal): Promise<EventSearchResponse>;
  eventDetail(id: string, signal?: AbortSignal): Promise<EventDetailResponse>;
}
export const ActionsCtx = createContext<ServerActions | null>(null);
