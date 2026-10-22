import { EVENT_ACTIONS, EVENT_OUTCOMES, type EventDetailResponse, type EventSearchResponse, type Finding, type SecurityEvent } from "@dk/contracts";
import type { Dataset } from "./data.ts";
import { serializeNavigation, type NavigationState } from "./navigation.ts";

/** Exact-match fields implemented by /events/search. Query values and cursors are memory-only. */
export const EVENT_FILTERS = {
  asset_id: "Asset", source_id: "Source", action: "Action", outcome: "Outcome", actor_ref: "Actor", session_ref: "Session",
  run_id: "Run", request_id: "Request", trace_id: "Trace", client_ip: "Network address", route: "Route", rule_ref: "Rule",
} as const;
export type EventFilterField = keyof typeof EVENT_FILTERS;
export interface EventSearchInput {
  after: string; before: string; filters: Partial<Record<EventFilterField, string>>; limit?: number; cursor?: string;
}
export interface FindingDetailResult {
  finding: Finding;
  revisions: { revision: number; reason: string; created_at: string; event_count: number; evidence_level: Finding["evidence_level"] }[];
  notes: { author: string; note: string; created_at: string }[];
}
export interface FindingEvidenceResult {
  events: SecurityEvent[]; evidence: Record<string, Record<string, unknown>>; expected: number;
  missingEvents: string[]; missingEvidence: string[]; complete: boolean; error?: string; revision?: number; revisionChanged?: boolean;
}
export const MAX_EVENT_INTERVAL_MS = 31 * 86_400_000;
const OFFSET_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
export function validateEventQuery(input: EventSearchInput): string[] {
  const errors: string[] = [];
  for (const [key, label] of [["after", "Start time"], ["before", "End time"]] as const) {
    if (!OFFSET_DATE.test(input[key]) || !Number.isFinite(Date.parse(input[key]))) errors.push(`${label} must include a valid date, time and timezone.`);
  }
  const span = Date.parse(input.before) - Date.parse(input.after);
  if (Number.isFinite(span) && span <= 0) errors.push("End time must be later than start time.");
  if (span > MAX_EVENT_INTERVAL_MS) errors.push("Search intervals may not exceed 31 days. Narrow the interval.");
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)) errors.push("Page size must be from 1 to 100.");
  for (const [key, value] of Object.entries(input.filters)) {
    if (!(key in EVENT_FILTERS)) { errors.push(`${key}: unsupported filter.`); continue; }
    if (typeof value !== "string" || value.length > 200) { errors.push(`${key}: use at most 200 characters.`); continue; }
    if (key === "action" || key === "outcome") {
      const allowed: readonly string[] = key === "action" ? EVENT_ACTIONS : EVENT_OUTCOMES;
      const values = value.split(",").map((v) => v.trim()).filter(Boolean);
      if (values.length > 10 || values.some((v) => !allowed.includes(v))) errors.push(`${key}: select a supported exact value.`);
    }
  }
  return errors;
}
export function eventSearchParams(input: EventSearchInput): URLSearchParams {
  const errors = validateEventQuery(input); if (errors.length) throw new Error(errors.join(" "));
  const p = new URLSearchParams({ after: new Date(input.after).toISOString(), before: new Date(input.before).toISOString(), limit: String(input.limit ?? 50) });
  for (const key of Object.keys(EVENT_FILTERS) as EventFilterField[]) if (input.filters[key]) p.set(key, input.filters[key]!);
  if (input.cursor) p.set("cursor", input.cursor); // Opaque: never inspect, decode or construct server cursors.
  return p;
}
export function eventMatches(e: SecurityEvent, input: EventSearchInput): boolean {
  const at = Date.parse(e.occurred_at);
  if (at < Date.parse(input.after) || at > Date.parse(input.before)) return false;
  return (Object.entries(input.filters) as [EventFilterField, string][]).every(([key, value]) => {
    if (!value) return true;
    if (key === "asset_id") return e.asset_ids.includes(value);
    if (key === "action" || key === "outcome") return value.split(",").map((v) => v.trim()).includes(e[key]);
    return e[key] === value;
  });
}
export function mergeEventPages(previous: SecurityEvent[], next: SecurityEvent[]): SecurityEvent[] {
  const seen = new Set(previous.map((e) => e.id));
  return [...previous, ...next.filter((e) => !seen.has(e.id) && !!seen.add(e.id))];
}
export function referencedEventIds(f: Finding): string[] { return [...new Set([...f.event_ids, ...f.counterevidence_event_ids])]; }
export function evidenceSummary(f: Finding, events: SecurityEvent[], records: Dataset["evidence"], full: FindingEvidenceResult | null, pending = false) {
  const ids = referencedEventIds(f); const selected = events.filter((e) => ids.includes(e.id));
  const missingEvents = [...new Set([...ids.filter((id) => !selected.some((e) => e.id === id)), ...(full?.missingEvents ?? [])])];
  const refs = [...new Set([...f.evidence_refs, ...selected.flatMap((e) => e.evidence_refs)])].filter((ref) => ref.startsWith("evidence:"));
  const missingEvidence = [...new Set([...refs.filter((ref) => !records[ref]), ...(full?.missingEvidence ?? [])])];
  return { expected: ids.length, loaded: new Set(selected.map((e) => e.id)).size, missingEvents, missingEvidence,
    complete: !pending && !missingEvents.length && !missingEvidence.length && !full?.error && !full?.revisionChanged && (!full || full.complete) };
}
export function isAccessDenied(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && (error.status === 401 || error.status === 403);
}
export const NETWORK_IDENTITY_NOTE = "Network locator, not identity. Shared network addresses do not establish the same person or device.";
export function filterGuidance(field: EventFilterField): string | null {
  if (field === "client_ip") return NETWORK_IDENTITY_NOTE;
  if (["actor_ref", "session_ref", "run_id"].includes(field)) return "Source-local namespace. The same value from different sources does not establish the same identity, session or run.";
  if (field === "request_id") return "Cross-source correlation requires the recorded trusted request-ID contract; client-supplied values can be forged or reused.";
  if (field === "trace_id") return "Instrumentation namespace. Trace context can be absent or client-influenced at the edge.";
  return null;
}
/** Explicit synthetic-only local search; never a fallback for failed server requests. */
export function searchOfflineEvents(data: Dataset, query: EventSearchInput, offset = 0): EventSearchResponse {
  if (data.mode !== "offline-demo") throw new Error("Local event search is available only for the bundled synthetic demo.");
  const errors = validateEventQuery(query); if (errors.length) throw new Error(errors.join(" "));
  const matches = data.events.filter((e) => eventMatches(e, query)).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id));
  const end = Math.min(matches.length, offset + (query.limit ?? 50));
  const sources = data.sources.filter((s) => (!query.filters.source_id || s.id === query.filters.source_id) && (!query.filters.asset_id || s.asset_ids.includes(query.filters.asset_id)));
  return { schema: "dk.event_search.v1", project_id: data.project.id, interval: { after: query.after, before: query.before, max_days: 31 }, filters: query.filters,
    snapshot_seq: data.cursor, events: matches.slice(offset, end),
    page: { limit: query.limit ?? 50, returned: end - offset, has_more: end < matches.length, next_cursor: null, position_start: offset, position_end: end },
    query_completeness: { matching_in_snapshot: matches.length, returned_through_this_page: end, complete: end === matches.length, truncated: end < matches.length, later_arrivals_not_included: 0, note: "Only the bundled synthetic dataset is searched in memory. This is not a server archive search." },
    source_coverage: { coverage_basis: "current_state", coverage_as_of: data.window.end, historical_coverage_assessed: false,
      sources: sources.map((s) => { const c = data.coverage.find((x) => x.source_id === s.id); return { source_id: s.id, label: s.label, kind: s.kind ?? "unknown", asset_ids: s.asset_ids, disabled: s.disabled ?? false, current_state: c?.state ?? "not_assessed", last_event_at: c?.last_event_at ?? null, events_in_interval: data.events.filter((e) => e.source_id === s.id && Date.parse(e.occurred_at) >= Date.parse(query.after) && Date.parse(e.occurred_at) <= Date.parse(query.before)).length }; }),
      unobserved_asset_ids: data.unobserved_asset_ids, gaps: data.coverage.filter((c) => c.state !== "healthy" && sources.some((s) => s.id === c.source_id)).map((c) => `${c.label}: ${c.note ?? c.state}`) },
    correlation: Object.keys(query.filters).flatMap((key) => { const note = filterGuidance(key as EventFilterField); return note ? [{ filter: key, namespace: "See scope", trust: note }] : []; }),
    limits: ["Synthetic demo: only the bundled in-memory dataset is searched.", "Stored matches and source coverage are separate. Historical coverage is not assessed.", "No stored matches is not proof of no activity."] };
}
export function offlineEventDetail(data: Dataset, id: string): EventDetailResponse | null {
  if (data.mode !== "offline-demo") return null;
  const event = data.events.find((e) => e.id === id); if (!event) return null;
  const source = data.sources.find((s) => s.id === event.source_id);
  const stored = event.evidence_refs.filter((ref) => ref.startsWith("evidence:")); const missing = stored.filter((ref) => !data.evidence[ref]);
  const records = Object.fromEntries(stored.filter((ref) => data.evidence[ref]).map((ref) => [ref, data.evidence[ref]!]));
  return { schema: "dk.event_detail.v1", project_id: data.project.id, event, source: { id: event.source_id, label: source?.label ?? null, kind: source?.kind ?? null },
    evidence: { untrusted: true, derivative: "redacted-at-ingestion", records },
    evidence_completeness: { expected_records: stored.length, returned_records: Object.keys(records).length, missing_evidence_refs: missing, reference_only_refs: event.evidence_refs.filter((ref) => !ref.startsWith("evidence:")), complete: missing.length === 0 },
    referenced_by_findings: data.findings.filter((f) => referencedEventIds(f).includes(id)).map((f) => ({ id: f.id, kind: f.kind, role: f.counterevidence_event_ids.includes(id) ? "counterevidence" : "supporting", lifecycle: f.lifecycle })),
    correlation: [], limits: ["Synthetic demo: bundled normalized records only."] };
}

/** Only allowlisted navigation references are shareable, regardless of incoming URL contents. */
export function safeReferenceUrl(base: string, project: string, navigation: NavigationState): string {
  const source = new URL(base); const url = new URL(source.pathname, source.origin);
  url.searchParams.set("project", project); url.hash = serializeNavigation(navigation); return url.toString();
}
