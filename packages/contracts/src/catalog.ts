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
}

export const CATALOG_VERSION = "dk-castle-kit-2.0.0";

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
};

function mod(id: ModuleId, label: string, meaning: string, w: number, d: number, height: number, label_height: number): ModuleSpec {
  return {
    id, label, meaning, footprint: { w, d }, height, label_height,
    label_anchor: [0, label_height, 0], status_anchor: [0, height + 0.3, 0],
    hit_proxy: { w, d, h: height }, roof_group: "roof",
    lod_metadata: { low: 600, medium: 3000, high: 8000 },
    supported_rotations: [0, 90, 180, 270], detail_levels: ["low", "medium", "high"], max_triangles_high: 8000,
    source: "procedural://digital-kingdom/castle-kit/" + id, license: "Apache-2.0 (original procedural geometry)",
  };
}

/** Trusted compatibility rules: which modules may represent which asset kinds. */
export const MODULES_BY_KIND: Record<AssetKind, ModuleId[]> = {
  edge: ["gatehouse"],
  auth: ["guardhouse"],
  service: ["hall", "great_hall"],
  worker: ["workshop"],
  database: ["vault"],
  storage: ["vault"],
  agent: ["observatory"],
  tool_server: ["tool_annex"],
  pipeline: ["forge"],
  third_party: ["portal"],
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
