import { validateIngestEventSchema, stableId, type DatasetKind, type IngestEvent, type SecurityEvent } from "@dk/contracts";
import type { GraphIndex } from "@dk/graph-core";
import { normalizeRoute, redactString, redactValue, type RedactionReport } from "./redact.ts";

export const PARSER_VERSION = "dk-normalizer-1.0.0";

export interface SourceContext {
  projectId: string;
  sourceId: string;
  datasetKind: DatasetKind;
  receivedAt: string;
  /** Only boundary-local sources that generate or validate request ids may mark them trusted. */
  trustsRequestIds: boolean;
  index: GraphIndex;
}

export type NormalizeResult =
  | { ok: true; event: SecurityEvent; evidence: Record<string, unknown> | null; redaction: RedactionReport }
  | { ok: false; reason: "schema" | "project_mismatch" | "unmapped_asset" | "dataset_mismatch"; detail: string };

/** Turn an authenticated inbound record into a canonical event. Project and source identity come from auth, not the payload. */
export function normalizeIngest(input: unknown, ctx: SourceContext): NormalizeResult {
  const v = validateIngestEventSchema(input);
  if (!v.ok) return { ok: false, reason: "schema", detail: v.errors.join("; ") };
  const e = input as IngestEvent;
  if (e.project_id !== undefined && e.project_id !== ctx.projectId) {
    return { ok: false, reason: "project_mismatch", detail: `source is bound to project ${ctx.projectId}; payload asserted ${e.project_id}` };
  }
  const resolved: string[] = [];
  const unmapped: string[] = [];
  for (const a of e.asset_ids) { const id = ctx.index.resolve(a); if (id) { if (!resolved.includes(id)) resolved.push(id); } else unmapped.push(a); }
  if (!resolved.length) return { ok: false, reason: "unmapped_asset", detail: `no known asset for: ${unmapped.slice(0, 5).join(", ")}` };

  const redaction: RedactionReport = { removedKeys: [], maskedValues: 0, truncated: false };
  const id = stableId("ev", ctx.projectId, ctx.sourceId, e.source_event_id);
  const evidence = e.evidence ? (redactValue(e.evidence, redaction) as Record<string, unknown>) : null;
  const attributes = e.attributes ? (redactValue(e.attributes, redaction) as Record<string, string | number | boolean>) : undefined;
  const evidenceRefs = [...(e.evidence_refs ?? [])];
  if (evidence) evidenceRefs.push(`evidence:${id}`);
  if (!evidenceRefs.length) evidenceRefs.push(`event:${id}`);

  const event: SecurityEvent = {
    schema_version: "0.2",
    dataset_kind: ctx.datasetKind,
    id,
    project_id: ctx.projectId,
    source_id: ctx.sourceId,
    source_event_id: e.source_event_id,
    occurred_at: new Date(e.occurred_at).toISOString(),
    received_at: ctx.receivedAt,
    asset_ids: resolved,
    action: e.action,
    outcome: e.outcome,
    evidence_refs: evidenceRefs,
    parser_version: PARSER_VERSION,
  };
  if (e.request_id) {
    event.request_id = e.request_id;
    event.request_id_trust = ctx.trustsRequestIds && e.request_id_trust !== "untrusted" ? "trusted" : "untrusted";
  }
  for (const k of ["trace_id", "session_ref", "run_id", "actor_ref", "rule_ref", "severity", "sampled", "client_ip"] as const) {
    if (e[k] !== undefined) (event as unknown as Record<string, unknown>)[k] = e[k];
  }
  if (e.route) event.route = normalizeRoute(e.route);
  if (attributes && Object.keys(attributes).length) event.attributes = attributes;
  const notes: string[] = [];
  if (e.coverage_note) notes.push(redactString(e.coverage_note));
  if (unmapped.length) notes.push(`Unmapped asset references ignored: ${unmapped.slice(0, 5).join(", ")}`);
  if (redaction.removedKeys.length || redaction.maskedValues) notes.push(`Redacted at ingestion: ${redaction.removedKeys.length} field(s) removed, ${redaction.maskedValues} value(s) masked.`);
  if (notes.length) event.coverage_note = notes.join(" ").slice(0, 1000);
  return { ok: true, event, evidence: evidence ? { ...evidence, redacted: redaction.removedKeys.length > 0 || redaction.maskedValues > 0 } : null, redaction };
}
