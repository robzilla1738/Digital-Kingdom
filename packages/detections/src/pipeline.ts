import type { DatasetKind, Graph, SecurityEvent } from "@dk/contracts";
import { GraphIndex } from "@dk/graph-core";
import { normalizeIngest } from "./normalize.ts";
import { sourceCapabilities } from "./capabilities.ts";
import type { EventAction } from "@dk/contracts";

export interface SourceConfig {
  id: string;
  label: string;
  kind?: string;
  asset_ids: string[];
  trusts_request_ids?: boolean;
  stale_after_seconds?: number;
  allowed_actions?: EventAction[];
  /** Sources relaying the same underlying observations share a group; they never corroborate each other. */
  independence_group?: string;
  /** Administrator-declared authority for actor_ref/session_ref. Undeclared sources never correlate identities with other sources. */
  identity_namespace?: string;
  /** Administrator-declared authority for run_id. */
  run_namespace?: string;
  /** Fraction of matching activity the source forwards (0 < r <= 1). Omitted: not declared (R01.2). */
  sampling_ratio?: number;
  /** How long the source's own system keeps records it could backfill. Omitted: not declared. */
  retention_days?: number;
  /** Outcomes the source can report at all (for example only failures). Omitted: every outcome. */
  outcomes_reported?: string[];
}

export interface Delivery { source_id: string; received_at: string; payload: unknown; note?: string }

export interface PipelineStats {
  delivered: number;
  accepted: number;
  duplicates: number;
  rejected: Record<string, number>;
  rejections: { source_id: string; reason: string; detail: string }[];
}

/**
 * In-memory version of the ingestion pipeline (normalize + deduplicate). The server uses the same
 * normalizer behind a durable journal; the offline demo and tests use this directly.
 */
export function processDeliveries(graph: Graph, sources: SourceConfig[], deliveries: Delivery[], datasetKind: DatasetKind = graph.dataset_kind) {
  const index = new GraphIndex(graph);
  const bySource = new Map(sources.map((s) => [s.id, s]));
  const events: SecurityEvent[] = [];
  const evidence: Record<string, Record<string, unknown>> = {};
  const seen = new Set<string>();
  const stats: PipelineStats = { delivered: 0, accepted: 0, duplicates: 0, rejected: {}, rejections: [] };
  for (const d of deliveries) {
    stats.delivered++;
    const src = bySource.get(d.source_id);
    if (!src) { reject(stats, d.source_id, "unknown_source", "source is not registered"); continue; }
    const r = normalizeIngest(d.payload, { projectId: graph.project_id, sourceId: src.id, datasetKind, receivedAt: d.received_at, trustsRequestIds: !!src.trusts_request_ids, index, capabilities: sourceCapabilities(src) });
    if (!r.ok) { reject(stats, src.id, r.reason, r.detail); continue; }
    if (seen.has(r.event.id)) { stats.duplicates++; continue; }
    seen.add(r.event.id);
    stats.accepted++;
    events.push(r.event);
    if (r.evidence) evidence[`evidence:${r.event.id}`] = r.evidence;
  }
  return { events, evidence, stats };
}

function reject(stats: PipelineStats, source_id: string, reason: string, detail: string) {
  stats.rejected[reason] = (stats.rejected[reason] ?? 0) + 1;
  stats.rejections.push({ source_id, reason, detail });
}
