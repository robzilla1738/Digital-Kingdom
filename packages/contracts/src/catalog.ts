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
  source: string;
  license: string;
}

export const CATALOG_VERSION = "dk-castle-kit-1.0.0";

/**
 * Approved module catalog. Geometry is procedural, authored in apps/web/src/castle/modules.tsx
 * from primitive shapes (no third-party meshes, no runtime downloads). See assets/castle-kit/MANIFEST.json.
 */
export const MODULE_CATALOG: Record<ModuleId, ModuleSpec> = {
  gatehouse: mod("gatehouse", "Gatehouse", "Edge gateway / reverse proxy / WAF", 3.2, 2.4, 3.2, 4.4),
  guardhouse: mod("guardhouse", "Guardhouse", "Authentication / identity service", 2.4, 2.4, 2.4, 3.4),
  hall: mod("hall", "Hall", "Logical application service", 3.2, 2.4, 2.2, 3.4),
  great_hall: mod("great_hall", "Great hall", "Logical application service (large variant)", 4.0, 2.8, 2.8, 4.0),
  workshop: mod("workshop", "Workshop", "Worker, queue consumer, or scheduler", 2.8, 2.2, 1.8, 2.8),
  vault: mod("vault", "Vault", "Database or storage", 2.8, 2.8, 2.4, 3.4),
  observatory: mod("observatory", "Observatory", "AI agent runtime", 2.2, 2.2, 5.2, 6.2),
  tool_annex: mod("tool_annex", "Tool annex", "Agent tool / MCP server", 2.4, 2.0, 1.8, 2.8),
  forge: mod("forge", "Forge", "Build and deployment pipeline", 3.0, 2.4, 2.0, 3.6),
  portal: mod("portal", "Portal", "Third-party service (interior not visible)", 2.4, 1.2, 3.0, 3.8),
};

function mod(id: ModuleId, label: string, meaning: string, w: number, d: number, height: number, label_height: number): ModuleSpec {
  return {
    id, label, meaning, footprint: { w, d }, height, label_height,
    supported_rotations: [0, 90, 180, 270], detail_levels: ["low", "medium", "high"], max_triangles_high: 6000,
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
