/** LP17-A3: content digest of a module's procedural geometry at one LOD (node only: manifest script and tests).
 * SHA-256 over each merged group in name order: the group name, then positions and vertex colours rounded to 1e-5
 * so the digest names the drawn shape, not floating-point noise. */
import { createHash } from "node:crypto";
import type { ModuleId } from "@dk/contracts";
import { moduleGeometry, type DetailLevel } from "./geometry.ts";

export function geometryDigest(id: ModuleId, lod: DetailLevel): string {
  const h = createHash("sha256"), groups = moduleGeometry(id, lod).groups;
  for (const name of Object.keys(groups).sort()) {
    const g = groups[name as keyof typeof groups]!;
    h.update(name + "\0");
    for (const attr of ["position", "color"]) {
      const a = g.getAttribute(attr).array as Float32Array, out = new Int32Array(a.length);
      for (let i = 0; i < a.length; i++) out[i] = Math.round(a[i]! * 1e5);
      h.update(Buffer.from(out.buffer));
    }
  }
  return "sha256:" + h.digest("hex");
}
