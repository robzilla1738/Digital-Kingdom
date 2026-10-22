/** Regenerates assets/castle-kit/MANIFEST.json provenance hashes, LOD triangle counts and bounds
 * from the procedural source. Run after editing any editable castle source: `pnpm castle:manifest`. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { moduleGeometry, type DetailLevel } from "../apps/web/src/castle/geometry.ts";
import type { ModuleId } from "../packages/contracts/src/index.ts";

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
for (const m of manifest.modules as { id: ModuleId; lods: Record<DetailLevel, { triangles: number; meshes: number; bounds: { min: number[]; max: number[] } }> }[])
  for (const lod of ["low", "medium", "high"] as DetailLevel[]) {
    const g = moduleGeometry(m.id, lod);
    m.lods[lod] = { triangles: g.triangles, meshes: Object.keys(g.groups).length, bounds: { min: g.bounds.min.toArray(), max: g.bounds.max.toArray() } };
  }
writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
console.log("castle manifest updated", manifest.provenance.content_hash);
