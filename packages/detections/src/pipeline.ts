import type { DatasetKind, Graph, SecurityEvent } from "@dk/contracts";
import { GraphIndex } from "@dk/graph-core";
import { normalizeIngest } from "./normalize.ts";

export interface SourceConfig {
  id: string;
  label: string;
  kind?: string;
  asset_ids: string[];
  trusts_request_ids?: boolean;
  stale_after_seconds?: number;
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
    const r = normalizeIngest(d.payload, { projectId: graph.project_id, sourceId: src.id, datasetKind, receivedAt: d.received_at, trustsRequestIds: !!src.trusts_request_ids, index });
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
