import { createHash } from "node:crypto";
import { canonicalJson, type AssetKind, type EventAction, type HttpMethod, type RelationshipKind } from "@dk/contracts";

/**
 * LP04: the reviewed local service catalog.
 *
 * A world plan may only name templates from this catalog. Each template is a built-in, trusted service
 * implementation (examples/reference-app/src/world) with a fixed route inventory, a fixed set of event categories
 * its instrumentation can report, and a fixed set of supported settings. Nothing here is a cloud-provider replica:
 * queue, token and deployment semantics are defined by the local implementation only.
 *
 * Templates never carry an image, command, script, host mount, port or URL. The supervisor allocates endpoints.
 */
/** catalog-2 (LP06): local_issuer gains POST /credentials/verify and artifact_depot gains GET/POST /deployed, needed
 * by the running built-in services. catalog-1 (LP04) only ever compiled previews; no run used it. */
export const CATALOG_VERSION = "dk-local-catalog-2";

export const WORLD_TEMPLATES = ["gateway", "auth", "api", "tenant_store", "queue", "worker", "artifact_depot", "agent_gateway", "receiver", "observer", "local_issuer"] as const;
export type WorldTemplate = (typeof WORLD_TEMPLATES)[number];
export type WorldSetting = "audit_enabled" | "policy_variant" | "tenant_mode";

export interface TemplateRoute { method: HttpMethod; path: string; purpose: string }
export interface TemplateDef {
  template: WorldTemplate;
  version: string;
  /** Asset kind in the Digital Kingdom graph; null = an observation source, not an asset. */
  asset_kind: AssetKind | null;
  description: string;
  routes: TemplateRoute[];
  /** Event categories this template's own instrumentation can report, with the source kind it reports as. */
  self_reports: { source_kind: string; actions: EventAction[] } | null;
  /** Effects an independent observer can record at this template's effect point (tap), if one is attached. */
  observable_effects: EventAction[];
  supported_settings: WorldSetting[];
  /** Relationship kind used when another resource depends on this one. */
  inbound_relationship: RelationshipKind;
  limitations: string[];
}

const def = (d: TemplateDef) => d;

export const TEMPLATE_CATALOG: Record<WorldTemplate, TemplateDef> = {
  gateway: def({
    template: "gateway", version: "1.0.0", asset_kind: "edge",
    description: "Local ingress gateway. Forwards registered routes to registered run resources only; applies a reviewed route policy variant.",
    routes: [{ method: "POST", path: "/login", purpose: "forward sign-in to the auth service" }, { method: "GET", path: "/tenants/{tenant}/records", purpose: "forward tenant reads to the API" }, { method: "POST", path: "/tenants/{tenant}/jobs", purpose: "forward job submission to the API" }],
    self_reports: { source_kind: "edge", actions: ["request_received"] }, observable_effects: [],
    supported_settings: ["policy_variant"], inbound_relationship: "calls",
    limitations: ["Route forwarding targets are registered resource ids, never URLs; no generic proxy exists."],
  }),
  auth: def({
    template: "auth", version: "1.0.0", asset_kind: "auth",
    description: "Synthetic sign-in service for the world's synthetic accounts; issues opaque run-scoped session tokens.",
    routes: [{ method: "POST", path: "/login", purpose: "sign in a synthetic account" }, { method: "POST", path: "/sessions/verify", purpose: "verify a session for another run resource" }],
    self_reports: { source_kind: "app_auth", actions: ["authentication"] }, observable_effects: [],
    supported_settings: ["audit_enabled"], inbound_relationship: "calls",
    limitations: ["Accounts and passwords are synthetic and generated per run; no real identity provider is involved."],
  }),
  api: def({
    template: "api", version: "1.0.0", asset_kind: "service",
    description: "Tenant API: reads and writes tenant records, submits jobs. Tenant isolation follows the reviewed policy variant.",
    routes: [{ method: "GET", path: "/tenants/{tenant}/records", purpose: "read tenant records" }, { method: "POST", path: "/tenants/{tenant}/records", purpose: "write a tenant record" }, { method: "POST", path: "/tenants/{tenant}/jobs", purpose: "enqueue a background job" }],
    self_reports: { source_kind: "app_security", actions: ["request_received", "authentication", "authorization_change", "data_access"] }, observable_effects: [],
    supported_settings: ["policy_variant", "tenant_mode"], inbound_relationship: "calls",
    limitations: ["The API's own records are self-reports; whether data was actually read is established by the store's independent observer."],
  }),
  tenant_store: def({
    template: "tenant_store", version: "1.0.0", asset_kind: "database",
    description: "In-memory tenant record store with an effect tap at every read and write.",
    routes: [], self_reports: null, observable_effects: ["data_access"],
    supported_settings: ["tenant_mode", "audit_enabled"], inbound_relationship: "reads_from",
    limitations: ["Reachable only from run resources that declare it as a dependency; it has no network listener of its own."],
  }),
  queue: def({
    template: "queue", version: "1.0.0", asset_kind: "storage",
    description: "Bounded in-memory message queue.",
    routes: [], self_reports: null, observable_effects: ["side_effect_observed"],
    supported_settings: [], inbound_relationship: "writes_to",
    limitations: ["Messages are synthetic; delivery is at-most-once inside one run. Not a model of any provider queue."],
  }),
  worker: def({
    template: "worker", version: "1.0.0", asset_kind: "worker",
    description: "Background worker that consumes queued jobs and writes artifacts, or runs bounded synthetic agent tasks.",
    routes: [], self_reports: { source_kind: "app_security", actions: ["data_access", "request_received"] }, observable_effects: [],
    supported_settings: ["policy_variant"], inbound_relationship: "calls",
    limitations: ["Runs only reviewed job kinds; there is no code-execution job."],
  }),
  artifact_depot: def({
    template: "artifact_depot", version: "1.1.0", asset_kind: "pipeline",
    description: "Content-addressed artifact depot (sha256 digests) with a selectable deployed version.",
    routes: [{ method: "GET", path: "/artifacts/{digest}", purpose: "fetch an artifact by digest" }, { method: "POST", path: "/artifacts", purpose: "publish a build artifact" }, { method: "GET", path: "/deployed", purpose: "read the selected deployed digest" }, { method: "POST", path: "/deployed", purpose: "select an existing artifact digest as deployed" }],
    self_reports: null, observable_effects: ["side_effect_observed"],
    supported_settings: ["audit_enabled"], inbound_relationship: "writes_to",
    limitations: ["Artifacts are synthetic byte strings; nothing is executed from the depot."],
  }),
  agent_gateway: def({
    template: "agent_gateway", version: "1.0.0", asset_kind: "tool_server",
    description: "MCP-style tool gateway for a bounded agent workspace: reports intent, policy decision and execution for every call.",
    routes: [{ method: "POST", path: "/tools/send_message", purpose: "send a message to a registered receiver" }, { method: "POST", path: "/tools/search_docs", purpose: "search the retrieval store" }],
    self_reports: { source_kind: "agent_observer", actions: ["tool_invocation"] }, observable_effects: [],
    supported_settings: ["policy_variant"], inbound_relationship: "invokes_tool",
    limitations: ["Paths that bypass the gateway are visible only if they reach an observed receiver."],
  }),
  receiver: def({
    template: "receiver", version: "1.0.0", asset_kind: "storage",
    description: "Controlled message receiver (allowed or blocked destination) with an effect tap on every delivery.",
    routes: [{ method: "POST", path: "/deliver", purpose: "accept a synthetic message" }],
    self_reports: null, observable_effects: ["side_effect_observed"],
    supported_settings: [], inbound_relationship: "writes_to",
    limitations: ["Accepts synthetic messages only; contents are counted, never stored beyond the run."],
  }),
  observer: def({
    template: "observer", version: "1.0.0", asset_kind: null,
    description: "Independent effect observer. Attaches to the effect taps of the resources it depends on and reports per-operation effects under its own source key and independence group.",
    routes: [], self_reports: { source_kind: "effect_observer", actions: ["side_effect_observed", "data_access"] }, observable_effects: [],
    supported_settings: ["audit_enabled"], inbound_relationship: "calls",
    limitations: ["Observes only the taps of the resources it is attached to; its outage makes those effects unknown for the interval, never 'no effect'."],
  }),
  local_issuer: def({
    template: "local_issuer", version: "1.1.0", asset_kind: "auth",
    description: "Short-lived synthetic credential and grant issuer for the local world.",
    routes: [{ method: "POST", path: "/credentials", purpose: "issue a short-lived synthetic credential" }, { method: "POST", path: "/credentials/verify", purpose: "verify a synthetic credential for another run resource" }, { method: "POST", path: "/credentials/{id}/revoke", purpose: "deactivate a synthetic credential" }, { method: "POST", path: "/grants", purpose: "change a synthetic test grant" }],
    self_reports: { source_kind: "app_auth", actions: ["authentication", "authorization_change"] }, observable_effects: [],
    supported_settings: ["audit_enabled"], inbound_relationship: "calls",
    limitations: ["Credentials are synthetic and meaningless outside the run; no external credential is ever issued or rotated."],
  }),
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** Digest of one reviewed template definition: a plan's compiled output records the exact template it used. */
export function templateDigest(t: WorldTemplate): string { return sha256(canonicalJson(TEMPLATE_CATALOG[t])); }
/** Digest of the whole catalog version: changing any template changes every compiled world revision. */
export function catalogDigest(): string { return sha256(canonicalJson({ version: CATALOG_VERSION, templates: WORLD_TEMPLATES.map((t) => [t, templateDigest(t)]) })); }
export { sha256 };
