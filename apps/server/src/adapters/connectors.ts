import type { EventAction } from "@dk/contracts";

/**
 * Versioned connector and support-pack contracts (roadmap R02.1).
 *
 * Every way data enters Digital Kingdom is described by a manifest: what protocol and versions it speaks, which
 * read scopes it needs and why, how it pages and resumes, its rate limits, cost and data handling, and how far
 * each capability has actually been verified. Connectors COLLECT; none carries response authority. Response
 * (containment) is a separate, human-approved path that no connector manifest can request.
 */
export const CAPABILITY_LEVELS = ["declared", "discovered", "instrumented", "analyzed", "lab_verified", "live_verified"] as const;
export type CapabilityLevel = (typeof CAPABILITY_LEVELS)[number];

export interface ConnectorManifest {
  id: string;
  name: string;
  manifest_version: 1;
  connector_version: string;
  /** Supported wire protocol and exact versions. Anything else is shown as unsupported, never enabled. */
  protocol: { name: string; versions: string[]; encodings: string[] };
  provider_api_version: string | null;
  source_kinds: string[];
  read_scopes: { scope: string; why: string; required: boolean }[];
  /** Collection only. A manifest with response authority is invalid. */
  authority: "collect_only";
  pagination: { mode: "push" | "cursor" | "page"; max_page: number | null; resume: string };
  rate_limits: { requests_per_minute: number | null; on_throttle: string };
  cost: { model: string; note: string };
  data_handling: { collected: string[]; minimized_before_storage: string[]; never_collected: string[] };
  capabilities: { capability: string; actions: EventAction[]; level: CapabilityLevel; evidence: string }[];
  limits: string[];
}

export const CONNECTORS: ConnectorManifest[] = [
  {
    id: "dk.events.http", name: "Digital Kingdom event API", manifest_version: 1, connector_version: "1.0.0",
    protocol: { name: "dk-ingest-event", versions: ["0.2"], encodings: ["application/json"] }, provider_api_version: null,
    source_kinds: ["generic", "waf", "edge", "app_auth", "app_security", "db_audit", "honeytoken", "agent_observer", "effect_observer", "falco", "otel"],
    read_scopes: [{ scope: "source-key:ingest", why: "Authenticates one source to POST its own events to one project.", required: true }],
    authority: "collect_only",
    pagination: { mode: "push", max_page: 500, resume: "Producers retry with the same source_event_id; duplicates collapse." },
    rate_limits: { requests_per_minute: null, on_throttle: "Server returns 413/429 when bodies or batches exceed limits; producers back off." },
    cost: { model: "self-hosted", note: "No provider charges; storage grows with event volume." },
    data_handling: { collected: ["normalized event fields", "redacted evidence"], minimized_before_storage: ["credential-like values", "secret-named keys", "raw URLs (route templates kept)", "agent prompts and payloads"], never_collected: ["request bodies", "passwords", "session cookies"] },
    capabilities: [
      { capability: "request and authentication events", actions: ["request_received", "authentication", "authorization_change"], level: "lab_verified", evidence: "apps/server/test, e2e/pilot.spec.ts (isolated non-production pilot)" },
      { capability: "database audit", actions: ["data_access"], level: "lab_verified", evidence: "apps/server/test/coverage-history-r01.test.ts" },
      { capability: "agent tool and effect events", actions: ["tool_invocation", "side_effect_observed"], level: "lab_verified", evidence: "packages/detections/test/agent-r05.test.ts" },
      { capability: "sensor health", actions: ["sensor_unavailable", "sensor_restored"], level: "lab_verified", evidence: "apps/server/test/coverage-history-r01.test.ts" },
    ],
    limits: ["Only what producers send is visible.", "Not verified against any live production environment."],
  },
  {
    id: "dk.otlp.traces", name: "OpenTelemetry traces (OTLP/HTTP JSON)", manifest_version: 1, connector_version: "1.0.0",
    protocol: { name: "otlp-http", versions: ["1.x (JSON encoding)"], encodings: ["application/json", "gzip"] }, provider_api_version: "opentelemetry-proto v1",
    source_kinds: ["otel", "app_security", "generic"],
    read_scopes: [{ scope: "source-key:ingest", why: "Collector exporter authenticates as one source.", required: true }],
    authority: "collect_only",
    pagination: { mode: "push", max_page: 2000, resume: "Event ids derive from traceId+spanId, so exporter retries are idempotent." },
    rate_limits: { requests_per_minute: null, on_throttle: "Oversized or over-limit exports are refused; the collector retries per its own policy." },
    cost: { model: "self-hosted", note: "Sampling at the collector reduces volume and completeness." },
    data_handling: { collected: ["service.name", "http.route", "status", "trace and span ids"], minimized_before_storage: ["URL query strings", "credential-like attribute values"], never_collected: ["span events with bodies", "protobuf encoding (unsupported)"] },
    capabilities: [{ capability: "sampled request context", actions: ["request_received"], level: "instrumented", evidence: "apps/server/test (OTLP mapping); real Collector binary conformance is R02.2" }],
    limits: ["Sampled traces are context, not a complete security ledger.", "Protobuf encoding is not supported."],
  },
  {
    id: "dk.aws.cloudtrail", name: "AWS CloudTrail identity and audit (one account)", manifest_version: 1, connector_version: "0.1.0",
    protocol: { name: "cloudtrail-records", versions: ["eventVersion 1.08-1.11"], encodings: ["application/json ({\"Records\": [...]})"] }, provider_api_version: "CloudTrail log file format",
    source_kinds: ["cloud_audit", "cloud_data_audit"],
    read_scopes: [
      { scope: "source-key:ingest", why: "The exporter or collector authenticates as the management-event source.", required: true },
      { scope: "aws:cloudtrail:LookupEvents|s3:GetObject (trail bucket)", why: "Read-only collection in the customer account; never granted to Digital Kingdom itself by this pack.", required: false },
      { scope: "aws:iam:Get*/List* (read-only)", why: "Resource and identity metadata for asset mapping (declared in the inventory today).", required: false },
    ],
    authority: "collect_only",
    pagination: { mode: "push", max_page: 1000, resume: "Event ids derive from CloudTrail eventID, so re-sent export files are idempotent." },
    rate_limits: { requests_per_minute: null, on_throttle: "Per-source admission budget applies; refused windows should be reported as collection reports." },
    cost: { model: "customer-paid", note: "Data events are billed by AWS per event; enabling them is the customer's choice." },
    data_handling: { collected: ["eventID", "eventTime", "eventSource/eventName", "region", "principal ARN", "access key id", "resource ARN", "error code", "source IP"], minimized_before_storage: ["requestParameters and responseElements (only key ids and bucket names kept)"], never_collected: ["secret access keys", "session tokens", "object contents"] },
    capabilities: [
      { capability: "management events: sign-in, role assumption, key and policy changes", actions: ["authentication", "authorization_change"], level: "analyzed", evidence: "apps/server/test/aws-r02.test.ts (sanitized fixture records); NOT live-verified against a real account" },
      { capability: "configured data events (e.g. s3:GetObject)", actions: ["data_access"], level: "analyzed", evidence: "fixture only; absent unless the trail logs data events and a cloud_data_audit source is registered" },
    ],
    limits: ["Fixture conformance only until an authorized real-account check is recorded.", "One account per scope; cross-account records are refused.", "Without data events, reads are unknown, not absent."],
  },
  {
    id: "dk.falco", name: "Falco runtime alerts (http_output)", manifest_version: 1, connector_version: "1.0.0",
    protocol: { name: "falco-http-output", versions: ["0.36+ JSON"], encodings: ["application/json"] }, provider_api_version: null,
    source_kinds: ["falco"],
    read_scopes: [{ scope: "source-key:ingest", why: "Falco http_output posts as one source.", required: true }],
    authority: "collect_only",
    pagination: { mode: "push", max_page: 1, resume: "One alert per request; Falco does not retry by default." },
    rate_limits: { requests_per_minute: null, on_throttle: "Falco drops alerts it cannot deliver; drops are not visible here." },
    cost: { model: "self-hosted", note: "None." },
    data_handling: { collected: ["rule", "priority", "container/k8s metadata"], minimized_before_storage: ["command lines with credential-like values"], never_collected: ["file contents"] },
    capabilities: [{ capability: "runtime alerts", actions: ["runtime_alert"], level: "analyzed", evidence: "apps/server/test (Falco mapping)" }],
    limits: ["Undelivered Falco alerts are invisible.", "Not tested against a running Falco daemon in CI."],
  },
];

const ADMIN_SCOPE = /(^\*$|admin|owner|root|write|full[_-]?access|:\*$|^all$)/i;

/** Static checks every manifest must pass (also run in tests). */
export function validateManifest(m: ConnectorManifest): string[] {
  const p: string[] = [];
  if (m.authority !== "collect_only") p.push(`${m.id}: connectors may only collect`);
  for (const s of m.read_scopes) if (ADMIN_SCOPE.test(s.scope)) p.push(`${m.id}: scope ${s.scope} is administrative or write-capable`);
  for (const c of m.capabilities) if (!CAPABILITY_LEVELS.includes(c.level)) p.push(`${m.id}: unknown level ${c.level}`);
  if (m.capabilities.some((c) => c.level === "live_verified" && !/live/i.test(c.evidence))) p.push(`${m.id}: live_verified needs live evidence`);
  if (!m.protocol.versions.length) p.push(`${m.id}: no supported protocol version`);
  return p;
}

/** Scopes requested at install must be a subset of the manifest's read scopes and never administrative. */
export function checkInstallScopes(m: ConnectorManifest, requested: string[] | undefined): { granted: string[]; problems: string[] } {
  const granted = requested?.length ? requested : m.read_scopes.filter((s) => s.required).map((s) => s.scope);
  const problems: string[] = [];
  for (const s of granted) {
    if (ADMIN_SCOPE.test(s)) problems.push(`${s}: administrative or write scopes are never granted to a collector`);
    else if (!m.read_scopes.some((r) => r.scope === s)) problems.push(`${s}: not a read scope of ${m.id}`);
  }
  for (const r of m.read_scopes.filter((x) => x.required)) if (!granted.includes(r.scope)) problems.push(`${r.scope}: required by ${m.id}`);
  return { granted, problems };
}

export const COLLECTION_STATUSES = ["complete", "partial", "permission_denied", "throttled", "scope_revoked", "error"] as const;
