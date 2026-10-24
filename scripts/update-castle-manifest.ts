/** Regenerates assets/castle-kit/MANIFEST.json provenance hashes, LOD triangle counts and bounds
 * from the procedural source. Run after editing any editable castle source: `pnpm castle:manifest`. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { moduleGeometry, type DetailLevel } from "../apps/web/src/castle/geometry.ts";
import { geometryDigest } from "../apps/web/src/castle/geometryDigest.ts";
import { CATALOG_VERSION, MODULE_CATALOG, type ModuleId } from "../packages/contracts/src/index.ts";

const path = new URL("../assets/castle-kit/MANIFEST.json", import.meta.url), root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(path, "utf8"));
const digest = createHash("sha256");
manifest.provenance.source_files = (manifest.provenance.editable_source_paths as string[]).map(p => {
  const bytes = readFileSync(new URL(p, root));
  digest.update(p + "\0").update(bytes).update("\0");
  return { path: p, sha256: createHash("sha256").update(bytes).digest("hex") };
});
manifest.provenance.content_hash = "sha256:" + digest.digest("hex");
// Mirrors the palette constants in geometry.ts (status never changes these colours).
manifest.materials = { stone: "#CEC5B2", stone_edge: "#E2D8C3", stone_base: "#8E877A", roof: "#4B5B70", roof_seam: "#61728A", iron: "#3E434A", timber: "#8A6E50", dark_recess: "#2C3540", bronze: "#6F948A",
  tonal_variation: "deterministic ±4% per part plus baked ground-contact darkening", status_geometry_independent: true };
manifest.catalog_version = CATALOG_VERSION;
// LP17: one entry per catalog module (kit 2.1.0 adds six families); existing entries keep their hand-written fields.
type Entry = { id: ModuleId; since_catalog?: string; silhouette?: string; lods: Record<DetailLevel, { triangles: number; meshes: number; bounds: { min: number[]; max: number[] }; geometry_sha256: string }> } & Record<string, unknown>;
const template = manifest.modules[0] as Entry;
manifest.modules = (Object.keys(MODULE_CATALOG) as ModuleId[]).map((id) => {
  const spec = MODULE_CATALOG[id], prior = (manifest.modules as Entry[]).find((m) => m.id === id);
  const m: Entry = prior ?? { id, editable_source: "apps/web/src/castle/geometry.ts", license: "Apache-2.0", groups: template.groups, group_note: template.group_note, lods: {} as Entry["lods"] };
  Object.assign(m, { footprint: spec.footprint, height: spec.height, label_anchor: [0, spec.label_height, 0], status_anchor: [0, spec.height + 0.3, 0],
    hit_proxy: { w: spec.footprint.w, d: spec.footprint.d, h: spec.height, roofs_off_h: 0.24 }, since_catalog: spec.since_catalog, silhouette: spec.silhouette,
    origin: spec.origin, connection_anchors: spec.connection_anchors, interior_anchor: spec.interior_anchor });
  for (const lod of ["low", "medium", "high"] as DetailLevel[]) {
    const g = moduleGeometry(id, lod);
    m.lods[lod] = { triangles: g.triangles, meshes: Object.keys(g.groups).length, bounds: { min: g.bounds.min.toArray(), max: g.bounds.max.toArray() }, geometry_sha256: geometryDigest(id, lod) };
  }
  return m;
});
manifest.rendering.geometry_cache = "At most 48 module geometries: 16 stable IDs × 3 LODs, shared app lifetime; no cache keys for asset IDs, event ticks, or projects.";
manifest.materials_sha256 = "sha256:" + createHash("sha256").update(JSON.stringify(manifest.materials)).digest("hex");
delete manifest.manifest_sha256;
manifest.manifest_sha256 = "sha256:" + createHash("sha256").update(JSON.stringify({ ...manifest, manifest_sha256: undefined })).digest("hex");
writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
console.log("castle manifest updated", manifest.provenance.content_hash);
