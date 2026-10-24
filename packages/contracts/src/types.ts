/** Canonical Digital Kingdom records. Mirrors the JSON Schemas in ../schemas. */

export const ZONE_IDS = ["public", "application", "data", "automation", "delivery", "external"] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

export const ASSET_KINDS = ["edge", "auth", "service", "worker", "database", "storage", "agent", "tool_server", "pipeline", "third_party"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const MODULE_IDS = ["gatehouse", "guardhouse", "hall", "great_hall", "workshop", "vault", "observatory", "tool_annex", "forge", "portal"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export const RELATIONSHIP_KINDS = ["calls", "reads_from", "writes_to", "deploys", "invokes_tool", "runs_as", "may_assume", "protected_by", "belongs_to"] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export type EvidenceLevel = "declared" | "observed" | "inferred" | "hypothetical";
export type DatasetKind = "synthetic" | "live";

export interface Asset {
  id: string;
  name: string;
  kind: AssetKind;
  environment: string;
  allowed_zone_ids: ZoneId[];
  source_refs: string[];
  owner?: string;
  aliases?: string[];
  sensitivity?: "public" | "internal" | "confidential" | "restricted";
  lifecycle?: "active" | "tombstoned";
  valid_from?: string;
  valid_to?: string;
  instance_count?: number;
  secondary_label?: string;
  deployment?: string;
  /** Declared HTTP routes this asset serves: the authoritative route inventory (R00.3). */
  routes?: DeclaredRoute[];
  /** Provider-native identity (R01.1). A different provider id under a reused asset id is a different entity. */
  provider_ref?: { scope: string; id: string };
}

export const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "CONNECT", "TRACE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
export interface DeclaredRoute {
  /** Normalized path template: {param} or :param match one segment; a trailing /* matches the rest. */
  path: string;
  /** Omitted: any method. */
  methods?: HttpMethod[];
  /** Omitted: any host. A leading "*." matches subdomains. */
  hosts?: string[];
}

export interface Relationship {
  id: string;
  source_id: string;
  target_id: string;
  kind: RelationshipKind;
  evidence_level: EvidenceLevel;
  evidence_refs: string[];
  assumptions?: string;
  valid_from?: string;
  valid_to?: string;
}

export interface Graph {
  schema_version: "0.1" | "0.2";
  dataset_kind: DatasetKind;
  project_id: string;
  graph_revision: string;
  created_at?: string;
  assets: Asset[];
  relationships: Relationship[];
}

export const EVENT_ACTIONS = [
  "request_received", "authentication", "authorization_change", "decoy_used", "sensor_unavailable", "sensor_restored",
  "waf_match", "data_access", "tool_invocation", "side_effect_observed", "runtime_alert",
] as const;
export type EventAction = (typeof EVENT_ACTIONS)[number];

/**
 * Outcome vocabulary. Deliberately separates a request that was allowed from an operation that succeeded
 * and from an independently observed effect. None of these alone means "compromised".
 */
export const EVENT_OUTCOMES = ["allowed", "denied", "blocked", "success", "failure", "attempted", "refused", "observed", "unknown"] as const;
export type EventOutcome = (typeof EVENT_OUTCOMES)[number];

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface EventCommon {
  source_event_id: string;
  occurred_at: string;
  asset_ids: string[];
  action: EventAction;
  outcome: EventOutcome;
  request_id?: string;
  request_id_trust?: "trusted" | "untrusted";
  trace_id?: string;
  session_ref?: string;
  run_id?: string;
  actor_ref?: string;
  rule_ref?: string;
  route?: string;
  severity?: Severity;
  sampled?: boolean;
  evidence_refs?: string[];
  coverage_note?: string;
  client_ip?: string;
  attributes?: Record<string, string | number | boolean>;
  /** Agent run context (R05.1): phase and observation origin, never prompts or payloads. */
  agent?: AgentContext;
}

export const AGENT_PHASES = ["intent", "decision", "execution", "effect"] as const;
export const AGENT_ORIGINS = ["runtime_self_report", "tool_wrapper", "policy_enforcer", "independent_observer"] as const;
export interface AgentContext {
  phase: (typeof AGENT_PHASES)[number];
  origin: (typeof AGENT_ORIGINS)[number];
  initiating_principal?: string;
  runtime?: string;
  model_route?: string;
  tool?: string;
  tool_version?: string;
  policy_revision?: string;
  step?: number;
  parent_run_id?: string;
}

export interface SecurityEvent extends EventCommon {
  schema_version: "0.1" | "0.2";
  dataset_kind: DatasetKind;
  id: string;
  project_id: string;
  source_id: string;
  received_at: string;
  evidence_refs: string[];
  parser_version?: string;
}

export interface IngestEvent extends EventCommon {
  project_id?: string;
  evidence?: Record<string, unknown>;
}

export interface Placement {
  asset_id: string;
  zone_id: ZoneId;
  module_id: ModuleId;
}

export interface SceneProposal {
  schema_version: "0.1" | "0.2";
  graph_revision: string;
  seed: number;
  style_profile: "stone-slate-v1" | "high-contrast-v1";
  camera_profile: "isometric-v1";
  placements: Placement[];
}

// ---------- Findings ----------

export const FINDING_KINDS = [
  "blocked_request_reported",
  "repeated_auth_failure",
  "sensitive_privilege_change",
  "decoy_credential_used",
  "coverage_loss",
  "source_contradiction",
  "agent_action_denied",
  "agent_effect_observed",
  "runtime_alert_reported",
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

/** Named evidence levels instead of an unexplained confidence percentage. */
export type FindingEvidenceLevel = "source_reported" | "corroborated" | "contradicted" | "analyst_confirmed" | "not_assessed";

/** What the evidence supports happening. Distinct states; never collapsed into a single "attack" flag. */
export type OutcomeState = "attempted" | "blocked" | "allowed" | "refused" | "observed_effect" | "needs_review" | "unknown";

export type FindingLifecycle = "open" | "acknowledged" | "closed";
export type AnalystDisposition = "unreviewed" | "benign" | "expected_test" | "true_positive" | "false_positive";

export interface Finding {
  id: string;
  kind: FindingKind;
  title: string;
  claim: string;
  lifecycle: FindingLifecycle;
  disposition: AnalystDisposition;
  evidence_level: FindingEvidenceLevel;
  outcome_state: OutcomeState;
  severity: Severity;
  affected_asset_ids: string[];
  event_ids: string[];
  counterevidence_event_ids: string[];
  evidence_refs: string[];
  coverage_gaps: string[];
  not_claimed: string[];
  next_steps: string[];
  rule_id: string;
  rule_version: string;
  first_seen: string;
  last_seen: string;
  /** Latest receive time among contributing events; lets the UI show late revisions. */
  last_received: string;
  event_count: number;
  revision: number;
  /** Analyst-state version (lifecycle/disposition), the optimistic-concurrency precondition (R01.4). Server only. */
  state_version?: number;
  dataset_kind: DatasetKind;
}

// ---------- Coverage ----------

export type CoverageState = "healthy" | "degraded" | "offline" | "not_assessed";

export interface CoverageRecord {
  source_id: string;
  label: string;
  asset_ids: string[];
  state: CoverageState;
  last_event_at?: string;
  note?: string;
  event_ids: string[];
}

// ---------- Compiled scene ----------

export interface Vec3 { x: number; y: number; z: number }

export interface SceneRoom {
  asset_id: string;
  /** Visual node id is separate from the stable asset id. */
  node_id: string;
  module_id: ModuleId;
  zone_id: ZoneId;
  slot: number;
  position: Vec3;
  rotation_y: number;
  footprint: { w: number; d: number };
  height: number;
  label_anchor: Vec3;
}

export interface SceneZone {
  zone_id: ZoneId;
  label: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  enclosed: boolean;
}

export interface ScenePath {
  relationship_id: string;
  source_asset_id: string;
  target_asset_id: string;
  kind: RelationshipKind;
  evidence_level: EvidenceLevel;
  points: Vec3[];
}

export interface SceneIncarnation {
  /** `<asset_id>~<n>`: stable for the life of one incarnation, never reused. */
  id: string;
  /** `<scope>/<provider id>` of the declared provider identity, or null when the asset declares none. */
  provider_id: string | null;
  /** Graph revision in which this incarnation first appeared (or `legacy` for scenes stored before LP16). */
  since_revision: string;
}

export interface CompiledScene {
  scene_schema_version: "0.2";
  compiler_version: string;
  catalog_version: string;
  graph_revision: string;
  project_id: string;
  seed: number;
  style_profile: SceneProposal["style_profile"];
  camera_profile: SceneProposal["camera_profile"];
  proposal_source: "default" | "user" | "planner";
  rooms: SceneRoom[];
  zones: SceneZone[];
  paths: ScenePath[];
  pins: Record<string, { zone_id: ZoneId; slot: number }>;
  /** Persisted per-zone slot capacity. Zones grow only when exceeded, and that growth is reported as a reflow. */
  capacities: Record<ZoneId, number>;
  reflow_zones: ZoneId[];
  wall: { minX: number; maxX: number; minZ: number; maxZ: number };
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** R06.1: increments on approved reflow or capacity growth. Absent on scenes stored before it existed. */
  layout_version?: number;
  /** R06.1: last positions of assets no longer in the graph, for historical lookup only (never rendered as live). */
  historical_rooms?: (SceneRoom & { retired_in_revision: string; incarnation_id?: string })[];
  /**
   * LP16: the incarnation of each current room's asset. A removed-and-recreated asset id, or one whose provider
   * identity changed, is a new incarnation; the earlier one keeps its own historical location. Outside the digest.
   * Absent on scenes stored before LP16 (every current asset is then treated as incarnation 1).
   */
  incarnations?: Record<string, SceneIncarnation>;
  digest: string;
}

export interface EvidenceRecord {
  kind?: string;
  redacted?: boolean;
  [key: string]: unknown;
}
