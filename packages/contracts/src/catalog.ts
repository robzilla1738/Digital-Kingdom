import type { AssetKind, ModuleId, ZoneId } from "./types.ts";

export interface ModuleSpec {
  id: ModuleId;
  label: string;
  /** Plain-language system meaning; the castle metaphor is never required to understand it. */
  meaning: string;
  footprint: { w: number; d: number };
  height: number;
  label_height: number;
  supported_rotations: number[];
  detail_levels: ("low" | "medium" | "high")[];
  max_triangles_high: number;
  label_anchor: [number, number, number];
  status_anchor: [number, number, number];
  hit_proxy: { w: number; d: number; h: number };
  roof_group: "roof";
  lod_metadata: { low: number; medium: number; high: number };
  source: string;
  license: string;
  /** Kit version that introduced the module (2.0.0 for the original ten, 2.1.0 for the LP17 families). */
  since_catalog: string;
  /** Ground-centre origin; Y-up; metres. */
  origin: [number, number, number];
  /** LP17: named connection anchors (module space, before rotation). Producers/consumers use opposite anchors. */
  connection_anchors: Record<string, [number, number, number]>;
  /** LP17: where an interior cutaway's objects are laid out (module space), and the interior plate size. */
  interior_anchor: { position: [number, number, number]; w: number; d: number };
  /** LP17: named record-marker positions (e.g. DNS name boards). Presentation only. */
  marker_anchors?: Record<string, [number, number, number]>;
  /** One-line architectural description; the silhouette's intent, never a security claim. */
  silhouette: string;
}

export const CATALOG_VERSION = "dk-castle-kit-2.1.0";
/** Every kit version a stored scene may name. Scenes compiled under 2.0.0 use only the original ten modules. */
export const SUPPORTED_CATALOG_VERSIONS = ["dk-castle-kit-2.0.0", "dk-castle-kit-2.1.0"] as const;

/**
 * Approved module catalog. Geometry is procedural, authored in apps/web/src/castle/geometry.ts
 * from primitive shapes (no third-party meshes, no runtime downloads). See assets/castle-kit/MANIFEST.json.
 */
export const MODULE_CATALOG: Record<ModuleId, ModuleSpec> = {
  gatehouse: mod("gatehouse", "Gatehouse", "Edge gateway / reverse proxy / WAF", 4.0, 2.8, 3.9, 4.7),
  guardhouse: mod("guardhouse", "Guardhouse", "Authentication / identity service", 3.4, 2.6, 3.35, 4.1),
  hall: mod("hall", "Hall", "Logical application service", 3.85, 2.6, 2.8, 3.55),
  great_hall: mod("great_hall", "Great hall", "Logical application service (large variant)", 4.6, 3.7, 3.85, 4.6),
  workshop: mod("workshop", "Workshop", "Worker, queue consumer, or scheduler", 3.2, 2.65, 2.25, 3.0),
  vault: mod("vault", "Vault", "Database or storage", 3.15, 3.05, 2.5, 3.25),
  observatory: mod("observatory", "Observatory", "AI agent runtime", 2.6, 2.6, 5.4, 6.1),
  tool_annex: mod("tool_annex", "Tool annex", "Agent tool / MCP server", 3.05, 2.05, 2.25, 3.0),
  forge: mod("forge", "Forge", "Build and deployment pipeline", 3.5, 3.0, 2.85, 3.6),
  portal: mod("portal", "Portal", "Third-party service (interior not visible)", 3.1, 1.85, 3.35, 4.1),
  // LP17 families (kit 2.1.0). Each is drawn only for a declared or supported record; drawing never upgrades support.
  dns_registry: mod("dns_registry", "DNS registry", "Declared names and route aliases (no Internet discovery)", 3.4, 2.7, 3.35, 4.05, "2.1.0", "compact registry hall with a signboard court and a small bell-clock turret", { names: [-1.15, 0.9, 1.22], records: [1.15, 0.9, 1.22] }),
  dispatch_house: mod("dispatch_house", "Dispatch house", "Queue or topic: producers on one side, consumers on the other", 4.4, 2.5, 2.35, 3.05, "2.1.0", "long low warehouse with two loading bays and a raised central sorting roof"),
  key_registry: mod("key_registry", "Key registry", "Principals, scoped grants and credential references (never secret values)", 3.1, 2.7, 3.1, 3.8, "2.1.0", "small fortified administrative hall with a recessed key-room and record shelves"),
  supply_depot: mod("supply_depot", "Supply depot", "Artifact registry: builds, digests and provenance", 3.9, 3.0, 3.1, 3.85, "2.1.0", "stepped storage complex with a loading platform, shelving and a contained hoist"),
  archive: mod("archive", "Archive", "Data collections, retrieval stores and backup references", 4.2, 2.8, 2.75, 3.5, "2.1.0", "broad stone archive with two roof heights and a protected columned entrance"),
  outpost: mod("outpost", "Outpost", "Registered synthetic endpoint, worker or partner outside the main boundary", 2.4, 2.4, 3.65, 4.35, "2.1.0", "modest isolated watch-tower pavilion on a raised platform"),
};

function mod(id: ModuleId, label: string, meaning: string, w: number, d: number, height: number, label_height: number, since = "2.0.0", silhouette = "original kit module", markers?: Record<string, [number, number, number]>): ModuleSpec {
  return {
    id, label, meaning, footprint: { w, d }, height, label_height, since_catalog: since, origin: [0, 0, 0], silhouette,
    connection_anchors: { west: [-w / 2, 0.35, 0], east: [w / 2, 0.35, 0], front: [0, 0.35, d / 2] },
    interior_anchor: { position: [0, 0.32, 0], w: Math.round((w - 0.6) * 100) / 100, d: Math.round((d - 0.6) * 100) / 100 },
    ...(markers ? { marker_anchors: markers } : {}),
    label_anchor: [0, label_height, 0], status_anchor: [0, height + 0.3, 0],
    hit_proxy: { w, d, h: height }, roof_group: "roof",
    lod_metadata: { low: 600, medium: 3000, high: 8000 },
    supported_rotations: [0, 90, 180, 270], detail_levels: ["low", "medium", "high"], max_triangles_high: 8000,
    source: "procedural://digital-kingdom/castle-kit/" + id, license: "Apache-2.0 (original procedural geometry)",
  };
}

/** Trusted compatibility rules: which modules may represent which asset kinds. */
export const MODULES_BY_KIND: Record<AssetKind, ModuleId[]> = {
  edge: ["gatehouse", "dns_registry"],
  auth: ["guardhouse", "key_registry"],
  service: ["hall", "great_hall"],
  worker: ["workshop", "outpost"],
  database: ["vault", "archive"],
  storage: ["vault", "archive", "dispatch_house", "outpost"],
  agent: ["observatory"],
  tool_server: ["tool_annex"],
  pipeline: ["forge", "supply_depot"],
  third_party: ["portal", "outpost"],
};

export const DEFAULT_MODULE_BY_KIND: Record<AssetKind, ModuleId> = {
  edge: "gatehouse", auth: "guardhouse", service: "hall", worker: "workshop", database: "vault", storage: "vault",
  agent: "observatory", tool_server: "tool_annex", pipeline: "forge", third_party: "portal",
};

export const ZONE_LABELS: Record<ZoneId, string> = {
  public: "Public edge",
  application: "Application",
  data: "Data",
  automation: "Agents & automation",
  delivery: "Build & delivery",
  external: "Third parties",
};

/**
 * LP17: the family a declared or supported record calls for, or null to keep the kind default. The signal is always
 * a record field (a local-world template stamp, a provider identity, declared host aliases), never a finding,
 * activity or a security outcome, and the returned module is always one MODULES_BY_KIND allows for the kind.
 * Drawing a family never implies discovery, instrumentation or control verification (see SURFACES support).
 */
export function recordModuleFor(a: { kind: AssetKind; secondary_label?: string; provider_ref?: { scope: string; id: string }; routes?: { hosts?: string[] }[] }): ModuleId | null {
  const template = /^([a-z_]+)@\d/.exec(a.secondary_label ?? "")?.[1];
  const pid = a.provider_ref?.id ?? "";
  const pick = (m: ModuleId) => (MODULES_BY_KIND[a.kind].includes(m) ? m : null);
  if (template === "queue") return pick("dispatch_house");
  if (template === "artifact_depot") return pick("supply_depot");
  if (template === "local_issuer") return pick("key_registry");
  if (template === "receiver") return pick("outpost");
  if (/^arn:aws:iam::\d{12}:(user|role)\//.test(pid)) return pick("key_registry");
  if (/^arn:aws:s3:::/.test(pid) || /^repository:/.test(pid)) return pick("archive");
  if (a.kind === "edge" && (a.routes ?? []).some((r) => (r.hosts ?? []).length > 0)) return pick("dns_registry");
  return null;
}
