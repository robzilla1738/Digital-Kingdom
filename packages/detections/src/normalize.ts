import { validateIngestEventSchema, stableId, type DatasetKind, type IngestEvent, type SecurityEvent } from "@dk/contracts";
import type { GraphIndex } from "@dk/graph-core";
import { normalizeRoute, PRIVATE_AGENT_KEY, redactString, redactValue, type RedactionReport } from "./redact.ts";
import { checkCapability, type SourceCapabilities } from "./capabilities.ts";

export const PARSER_VERSION = "dk-normalizer-1.0.0";

export interface SourceContext {
  projectId: string;
  sourceId: string;
  datasetKind: DatasetKind;
  receivedAt: string;
  /** Only boundary-local sources that generate or validate request ids may mark them trusted. */
  trustsRequestIds: boolean;
  index: GraphIndex;
  /** Enforced authorization scope of this source (assets and event categories). */
  capabilities?: SourceCapabilities;
  /** Redaction metadata recorded by the server at receive time (separate journal column, untrusted shape). */
  priorRedaction?: unknown;
}

export type NormalizeResult =
  | { ok: true; event: SecurityEvent; evidence: Record<string, unknown> | null; redaction: RedactionReport }
  | { ok: false; reason: "schema" | "project_mismatch" | "unmapped_asset" | "dataset_mismatch" | "asset_not_permitted" | "action_not_permitted"; detail: string };

/**
 * Minimize an inbound record BEFORE anything durable is written: schema-validate (unknown fields are
 * rejected), mask credential-like values in every free-text field, drop credential-bearing keys from
 * evidence/attributes, and reduce raw URLs to route templates. Only this minimized envelope is ever
 * journaled, so raw originals are never retained. Idempotent: minimizing twice gives the same result.
 */
export function minimizeIngest(input: unknown): { ok: true; event: IngestEvent; redaction: RedactionReport } | { ok: false; detail: string } {
  const v = validateIngestEventSchema(input);
  if (!v.ok) return { ok: false, detail: v.errors.join("; ") };
  const e = input as IngestEvent;
  const reserved = findReservedKey(e.evidence) ?? findReservedKey(e.attributes);
  if (reserved) return { ok: false, detail: `reserved field name "${reserved}" (the _dk_ prefix is server-controlled)` };
  const agentish = !!e.agent || e.action === "tool_invocation" || e.action === "side_effect_observed";
  if (e.agent) { const err = agentConsistency(e); if (err) return { ok: false, detail: err }; }
  const drop = agentish ? PRIVATE_AGENT_KEY : undefined;
  const redaction: RedactionReport = { removedKeys: [], maskedValues: 0, truncated: false };
  const out: IngestEvent = {
    source_event_id: e.source_event_id,
    occurred_at: e.occurred_at,
    asset_ids: e.asset_ids,
    action: e.action,
    outcome: e.outcome,
  };
  if (e.project_id !== undefined) out.project_id = e.project_id;
  for (const k of ["request_id", "request_id_trust", "trace_id", "session_ref", "run_id", "actor_ref", "severity", "sampled", "client_ip"] as const) {
    if (e[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = e[k];
  }
  if (e.rule_ref !== undefined) out.rule_ref = redactString(e.rule_ref, redaction);
  if (e.route !== undefined) out.route = redactString(normalizeRoute(e.route), redaction);
  if (e.coverage_note !== undefined) out.coverage_note = redactString(e.coverage_note, redaction);
  if (e.evidence_refs !== undefined) out.evidence_refs = e.evidence_refs;
  if (e.attributes) {
    const a = redactValue(e.attributes, redaction, 0, "", drop) as Record<string, string | number | boolean>;
    if (Object.keys(a).length) out.attributes = a;
  }
  if (e.evidence) out.evidence = redactValue(e.evidence, redaction, 0, "", drop) as Record<string, unknown>;
  if (e.agent) out.agent = { ...e.agent };
  return { ok: true, event: out, redaction };
}

/**
 * R05.1: phase, action, outcome and origin must agree, so a refusal cannot be recorded as enforcement, an
 * attempted execution as an effect, or a runtime's own report as independent observation.
 */
function agentConsistency(e: IngestEvent): string | null {
  const a = e.agent!;
  const allowed: Record<string, { action: string; outcomes: string[] }> = {
    intent: { action: "tool_invocation", outcomes: ["attempted"] },
    decision: { action: "tool_invocation", outcomes: ["allowed", "denied", "blocked", "refused"] },
    execution: { action: "tool_invocation", outcomes: ["success", "failure", "attempted"] },
    effect: { action: "side_effect_observed", outcomes: ["observed"] },
  };
  const rule = allowed[a.phase]!;
  if (e.action !== rule.action) return `agent.phase ${a.phase} requires action ${rule.action}`;
  if (!rule.outcomes.includes(e.outcome)) return `agent.phase ${a.phase} allows outcomes ${rule.outcomes.join(", ")}`;
  if (e.outcome === "refused" && a.origin === "policy_enforcer") return "a refusal is the model's own decision; a policy enforcer reports denied or blocked";
  if ((e.outcome === "denied" || e.outcome === "blocked") && a.origin !== "policy_enforcer" && a.origin !== "tool_wrapper") return "denied/blocked decisions come from a policy enforcer or tool wrapper";
  if (a.origin === "independent_observer" && a.phase !== "effect") return "an independent observer reports effects only";
  return null;
}

/** Keys with the _dk_ prefix are reserved for server-controlled metadata; producers may not send them. */
function findReservedKey(v: unknown, depth = 0): string | null {
  if (depth > 32 || v === null || typeof v !== "object") return null;
  if (Array.isArray(v)) { for (const x of v) { const r = findReservedKey(x, depth + 1); if (r) return r; } return null; }
  for (const [k, x] of Object.entries(v)) { if (k.toLowerCase().startsWith("_dk_")) return k; const r = findReservedKey(x, depth + 1); if (r) return r; }
  return null;
}

/** Server-controlled redaction metadata as stored beside a journal entry. Type-checked on every read (replay, migration). */
export interface StoredRedaction { removed_keys: string[]; masked_values: number }
export function toStoredRedaction(r: RedactionReport): StoredRedaction { return { removed_keys: r.removedKeys.slice(0, 32).map((k) => k.slice(0, 200)), masked_values: r.maskedValues }; }
export function sanitizeStoredRedaction(v: unknown): StoredRedaction {
  const o = v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const keys = Array.isArray(o.removed_keys) ? o.removed_keys.filter((k): k is string => typeof k === "string").slice(0, 32).map((k) => k.slice(0, 200)) : [];
  const n = typeof o.masked_values === "number" && Number.isFinite(o.masked_values) && o.masked_values >= 0 ? Math.min(Math.floor(o.masked_values), 1_000_000) : 0;
  return { removed_keys: keys, masked_values: n };
}

/** Turn an authenticated inbound record into a canonical event. Project and source identity come from auth, not the payload. */
export function normalizeIngest(input: unknown, ctx: SourceContext): NormalizeResult {
  const m = minimizeIngest(input);
  if (!m.ok) return { ok: false, reason: "schema", detail: m.detail };
  const e = m.event;
  if (e.project_id !== undefined && e.project_id !== ctx.projectId) {
    return { ok: false, reason: "project_mismatch", detail: `source is bound to project ${ctx.projectId}; payload asserted ${e.project_id}` };
  }
  const resolved: string[] = [];
  const unmapped: string[] = [];
  for (const a of e.asset_ids) { const id = ctx.index.resolve(a); if (id) { if (!resolved.includes(id)) resolved.push(id); } else unmapped.push(a); }
  if (!resolved.length) return { ok: false, reason: "unmapped_asset", detail: `no known asset for: ${unmapped.slice(0, 5).join(", ")}` };
  if (ctx.capabilities) { const v = checkCapability(ctx.capabilities, ctx.sourceId, e.action, resolved); if (v) return { ok: false, ...v }; }

  // carry forward the server-controlled report from receive time (never read from the payload itself)
  const prior = sanitizeStoredRedaction(ctx.priorRedaction);
  const redaction: RedactionReport = { removedKeys: [...prior.removed_keys, ...m.redaction.removedKeys], maskedValues: prior.masked_values + m.redaction.maskedValues, truncated: m.redaction.truncated };
  const id = stableId("ev", ctx.projectId, ctx.sourceId, e.source_event_id);
  const evidence = e.evidence ? e.evidence : null;
  const attributes = e.attributes;
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
  if (e.route) event.route = e.route;
  if (e.agent) event.agent = e.agent;
  if (attributes && Object.keys(attributes).length) event.attributes = attributes;
  const notes: string[] = [];
  if (e.coverage_note) notes.push(e.coverage_note);
  if (unmapped.length) notes.push(`Unmapped asset references ignored: ${unmapped.slice(0, 5).join(", ")}`);
  if (redaction.removedKeys.length || redaction.maskedValues) notes.push(`Redacted at ingestion: ${redaction.removedKeys.length} field(s) removed, ${redaction.maskedValues} value(s) masked.`);
  if (notes.length) event.coverage_note = notes.join(" ").slice(0, 1000);
  return { ok: true, event, evidence: evidence ? { ...evidence, redacted: redaction.removedKeys.length > 0 || redaction.maskedValues > 0 } : null, redaction };
}
