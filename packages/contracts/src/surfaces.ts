import type { Asset, AssetKind } from "./types.ts";

/**
 * Versioned surface descriptors (roadmap R06.2). Each of the 28 surfaces says how it is drawn and, separately,
 * how far Digital Kingdom actually supports it. Drawing a surface never implies it is discovered, instrumented,
 * analyzed or enforced: the support level is explicit and machine-readable, and overlays (watchtowers, shields)
 * are only drawn from records (a source that covers the asset, a control with a passing current test).
 * Changing this registry never re-interprets stored events: events keep their action/outcome meaning and the
 * surface version is stamped on every resolution.
 */
export const SURFACE_REGISTRY_VERSION = "dk-surfaces-1";
export const SUPPORT_LEVELS = ["not_implemented", "declared", "discovered", "instrumented", "analyzed", "lab_verified", "live_verified"] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];
export type ElementCategory = "structure" | "boundary" | "overlay" | "decoration";
/** Existing ten castle modules plus families introduced only when data supports them. */
export const SURFACE_FAMILIES = ["gatehouse", "guardhouse", "hall", "great_hall", "workshop", "vault", "observatory", "tool_annex", "forge", "portal", "dns_registry", "dispatch_house", "key_registry", "supply_depot", "archive", "outpost"] as const;
export type SurfaceFamily = (typeof SURFACE_FAMILIES)[number];

export interface SurfaceDescriptor {
  id: string; name: string; presentation: string; family: SurfaceFamily; category: ElementCategory;
  support: SupportLevel; support_evidence: string; work_package: string;
  /** Asset kinds that resolve to this surface by default. */
  asset_kinds: AssetKind[];
  /** True for families that need provider data before they are drawn at all. */
  requires_data: boolean;
}

const S = (id: string, name: string, presentation: string, family: SurfaceFamily, support: SupportLevel, evidence: string, wp: string, kinds: AssetKind[] = [], category: ElementCategory = "structure", requires_data = false): SurfaceDescriptor => ({ id, name, presentation, family, category, support, support_evidence: evidence, work_package: wp, asset_kinds: kinds, requires_data });

export const SURFACES: readonly SurfaceDescriptor[] = Object.freeze([
  S("DK-S-dns", "Domains, DNS and certificates", "DNS registry / approach signs", "dns_registry", "not_implemented", "no provider inventory", "R09.1", [], "structure", true),
  S("DK-S-edge", "Edge and WAF", "Gatehouse / configured checkpoint", "gatehouse", "instrumented", "event API and OTLP request events; no provider feed", "R09.1", ["edge"]),
  S("DK-S-origin", "Alternate origins", "Separate service entrance", "gatehouse", "not_implemented", "no alternate-origin discovery", "R09.1", [], "structure", true),
  S("DK-S-api", "APIs and routes", "Service interior doors / route registry", "hall", "declared", "route inventory on assets (R00.3); method/host inventory incomplete", "R09.1"),
  S("DK-S-browser", "Browser and scripts", "Storefront / script supply layer", "portal", "not_implemented", "no browser security inventory", "R09.1", [], "structure", true),
  S("DK-S-webhook", "Webhooks", "Dispatch gate", "dispatch_house", "not_implemented", "no webhook lifecycle", "R09.1", [], "structure", true),
  S("DK-S-service", "Services", "Hall / keep with replica drilldown", "hall", "instrumented", "SDK and OTLP events on declared services", "R09.2", ["service"]),
  S("DK-S-serverless", "Serverless and workers", "Task pavilion / temporary workshop", "workshop", "declared", "worker assets only; no provider lifecycle", "R09.2", ["worker"]),
  S("DK-S-queue", "Queues and topics", "Dispatch house / typed delivery lanes", "dispatch_house", "not_implemented", "no queue/message lineage", "R09.2", [], "structure", true),
  S("DK-S-human_identity", "Human identity", "Identity registry / guardhouse", "guardhouse", "instrumented", "authentication events; CloudTrail sign-in mapping (fixture)", "R04.3", ["auth"]),
  S("DK-S-machine_identity", "Machine identity and keys", "Key registry / identity layer", "key_registry", "analyzed", "CloudTrail key lineage and aftermath (R03.3), fixture-verified only", "R03.3", [], "structure", true),
  S("DK-S-authorization", "Authorization", "Permission overlays / policy checkpoint", "guardhouse", "analyzed", "scoped AWS S3/AssumeRole evaluator (R04.3); configured permission only", "R04.3", [], "overlay"),
  S("DK-S-database", "Databases", "Vault / collection interior", "vault", "instrumented", "db_audit data_access events; no native audit adapter", "R09.3", ["database"]),
  S("DK-S-storage", "Object storage", "Archive / bucket interior", "archive", "instrumented", "CloudTrail data events when configured (fixture)", "R09.3", ["storage"]),
  S("DK-S-secrets", "Secret managers", "Key vault / mint", "key_registry", "not_implemented", "no secret-manager metadata", "R03.3", [], "structure", true),
  S("DK-S-repository", "Repositories", "Design archive", "archive", "discovered", "read-only GitHub discovery (R02.3), live-checked on one public repository", "R02.3"),
  S("DK-S-pipeline", "Pipelines", "Forge / assembly line", "forge", "analyzed", "workflow discovery and provenance lineage (R04.1)", "R04.1", ["pipeline"]),
  S("DK-S-registry", "Artifact registries", "Supply depot", "supply_depot", "analyzed", "digest/provenance evaluation (R04.1); registry not queried", "R04.1", [], "structure", true),
  S("DK-S-agent", "AI agents", "Observatory / bounded workroom", "observatory", "lab_verified", "MCP gateway boundary with independent observer (R05.2)", "R05.2", ["agent"]),
  S("DK-S-tool", "Agent tools", "Tool annex", "tool_annex", "lab_verified", "gateway intent/decision/execution reports (R05.2)", "R05.2", ["tool_server"]),
  S("DK-S-rag", "Retrieval data", "Indexed archive / intake room", "archive", "not_implemented", "not implemented", "R09.3", [], "structure", true),
  S("DK-S-device", "Devices", "Registered outpost", "outpost", "not_implemented", "not implemented", "R09.4", [], "structure", true),
  S("DK-S-email", "Email", "Correspondence house", "dispatch_house", "not_implemented", "not implemented", "R09.4", [], "structure", true),
  S("DK-S-saas", "SaaS and third parties", "External pavilion / portal", "portal", "declared", "third-party assets declared only", "R09.4", ["third_party"]),
  S("DK-S-backup", "Backups", "Reserve archive", "archive", "lab_verified", "Digital Kingdom's own encrypted backup/restore is tested (R10.2); customer backups not observed", "R09.3", [], "structure", true),
  S("DK-S-sensor", "Sensors and sources", "Watchtower / observer overlay", "observatory", "instrumented", "source records, current and historical coverage (R01.2)", "R01.2", [], "overlay"),
  S("DK-S-decoy", "Decoys", "Registered sealed decoy", "vault", "analyzed", "placement registry and trigger classification (R03.4)", "R03.4", [], "overlay"),
  S("DK-S-unknown", "Unresolved observations", "Explicit unresolved observation", "portal", "declared", "unmapped input is rejected and counted", "R02.1", [], "structure"),
]);

/** Which surface an asset resolves to: provider identity first, then kind; never guessed beyond that. */
export function surfaceForAsset(a: Pick<Asset, "kind" | "provider_ref">): SurfaceDescriptor {
  const pid = a.provider_ref?.id ?? "";
  const by = (id: string) => SURFACES.find((s) => s.id === id)!;
  if (/^repository:/.test(pid)) return by("DK-S-repository");
  if (/^workflow:/.test(pid)) return by("DK-S-pipeline");
  if (/^arn:aws:s3:::/.test(pid)) return by("DK-S-storage");
  if (/^arn:aws:iam::\d{12}:(user|role)\//.test(pid)) return by("DK-S-machine_identity");
  return SURFACES.find((s) => s.asset_kinds.includes(a.kind)) ?? by("DK-S-unknown");
}
