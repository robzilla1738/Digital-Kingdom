import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MODULE_CATALOG, type ModuleId } from "@dk/contracts";

export type DetailLevel = "low" | "medium" | "high";
export type ArchitectureGroup = "structure" | "roof" | "interior-structure" | "detail-static";
type V3 = [number, number, number];
const STONE = "#CEC5B2", EDGE = "#E2D8C3", BASE = "#8E877A", ROOF = "#4B5B70", SEAM = "#61728A", IRON = "#3E434A", WOOD = "#8A6E50", DARK = "#2C3540", BRONZE = "#6F948A";
/** Deterministic, status-independent tonal variation: a ±4% per-part shift (masonry courses, roof
 * slates) and a baked ground-contact darkening so buildings sit on the terrace instead of floating. */
const tone = (i: number) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return 0.96 + (x - Math.floor(x)) * 0.08; };
const contact = (y: number) => 0.74 + 0.26 * Math.min(1, Math.max(0, y / 1.1));
export interface ModuleGeometry { groups: Partial<Record<ArchitectureGroup, THREE.BufferGeometry>>; bounds: THREE.Box3; triangles: number; }

/** Original editable architectural construction. Each group is merged, with vertex colour variation,
 * so masonry courses, arch voussoirs, beams and roof seams are not independent draw calls. The cache
 * is bounded by the ten known IDs × three LODs and shared for the application lifetime. */
class Builder {
  parts: Record<ArchitectureGroup, THREE.BufferGeometry[]> = { structure: [], roof: [], "interior-structure": [], "detail-static": [] };
  private serial = 0;
  constructor(readonly lod: DetailLevel) {}
  get segments() { return this.lod === "high" ? 24 : this.lod === "medium" ? 12 : 6; }
  add(g: THREE.BufferGeometry, color: string, p: V3 = [0, 0, 0], group: ArchitectureGroup = "structure", r: V3 = [0, 0, 0]) {
    const geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    geo.deleteAttribute("uv");
    const mat = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(mat);
    const c = new THREE.Color(color).multiplyScalar(tone(++this.serial)), pos = geo.getAttribute("position"), n = pos.count, colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const k = contact(pos.getY(i)); colors[i * 3] = c.r * k; colors[i * 3 + 1] = c.g * k; colors[i * 3 + 2] = c.b * k; }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.parts[group].push(geo);
  }
  box(s: V3, p: V3, color = STONE, group: ArchitectureGroup = "structure", r: V3 = [0, 0, 0]) { this.add(new THREE.BoxGeometry(...s), color, p, group, r); }
  cylinder(rt: number, rb: number, h: number, p: V3, color = STONE, group: ArchitectureGroup = "structure", r: V3 = [0, 0, 0], segments = this.segments) { this.add(new THREE.CylinderGeometry(rt, rb, h, segments), color, p, group, r); }
  /** Wall with a real open doorway, not a dark decal. Extrusion exposes the arch's soffit. */
  arch(w: number, h: number, t: number, opening: number, spring: number, p: V3, color = STONE, group: ArchitectureGroup = "structure") {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0); s.lineTo(-opening / 2, 0); s.lineTo(-opening / 2, spring);
    s.absarc(0, spring, opening / 2, Math.PI, 0, true);
    s.lineTo(opening / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.closePath();
    this.add(new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: this.lod === "high" ? 10 : this.lod === "medium" ? 5 : 2, steps: 1 }), color, p, group);
  }
  archTrim(opening: number, spring: number, p: V3, color = EDGE) {
    if (this.lod === "low") return;
    const n = this.lod === "high" ? 13 : 9;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (i + 0.5) / n, rad = opening / 2 + 0.075;
      this.box([0.16, Math.PI * rad / n * 0.91, 0.12], [p[0] + Math.cos(a) * rad, p[1] + spring + Math.sin(a) * rad, p[2]], color, "detail-static", [0, 0, a]);
    }
    for (const x of [-opening / 2 - 0.075, opening / 2 + 0.075]) this.box([0.16, spring, 0.14], [p[0] + x, p[1] + spring / 2, p[2]], color, "detail-static");
  }
  /** Hollow masonry shell with actual recessed entrance and a neutral floor for roof-off inspection. */
  hall(w: number, d: number, h: number, p: V3, door = 0.6) {
    const t = 0.2;
    this.box([w, 0.18, d], [p[0], p[1] + 0.09, p[2]], BASE);
    this.box([w - 0.4, 0.07, d - 0.4], [p[0], p[1] + 0.21, p[2]], WOOD, "interior-structure");
    for (const x of [-w / 2 + t / 2, w / 2 - t / 2]) this.box([t, h - 0.18, d], [p[0] + x, p[1] + (h + 0.18) / 2, p[2]]);
    this.box([w - 0.4, h - 0.18, t], [p[0], p[1] + (h + 0.18) / 2, p[2] - d / 2 + t / 2]);
    this.arch(w - 0.4, h - 0.18, t, door, Math.min(0.75, h * 0.42), [p[0], p[1] + 0.18, p[2] + d / 2 - t]);
    this.archTrim(door, Math.min(0.75, h * 0.42), [p[0], p[1] + 0.18, p[2] + d / 2 + 0.035]);
    // Interior door is set back a full wall thickness, leaving the architectural recess readable.
    this.box([door * 0.92, Math.min(0.9, h * 0.6), 0.06], [p[0], p[1] + Math.min(0.9, h * 0.6) / 2 + 0.18, p[2] + d / 2 - 0.3], WOOD, "interior-structure");
    if (this.lod !== "low") {
      for (const y of [0.45, 0.92, 1.39].filter(y => y < h - 0.2)) {
        this.box([w + 0.025, 0.035, 0.035], [p[0], p[1] + y, p[2] - d / 2], BASE, "detail-static");
        for (const x of [-w / 2, w / 2]) this.box([0.03, 0.035, d], [p[0] + x, p[1] + y, p[2]], BASE, "detail-static");
      }
      // Four perimeter cornices, never a full ceiling: roof-off must reveal the floor.
      for (const z of [-d / 2 + t / 2, d / 2 - t / 2])
        this.box([w + 0.07, 0.1, t + 0.07], [p[0], p[1] + h - 0.05, p[2] + z], EDGE, "detail-static");
      for (const x of [-w / 2 + t / 2, w / 2 - t / 2])
        this.box([t + 0.07, 0.1, d - 2 * t], [p[0] + x, p[1] + h - 0.05, p[2]], EDGE, "detail-static");
    }
  }
  /** A triangular prism with eaves, a closed gable and optional standing-seam roof strips. */
  gable(w: number, d: number, rise: number, p: V3, color = ROOF) {
    const s = new THREE.Shape(); s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(0, rise); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false, steps: 1 });
    g.rotateY(Math.PI / 2); g.translate(-w / 2, 0, 0); this.add(g, color, p, "roof");
    this.box([w + 0.05, 0.09, d + 0.04], p, color, "roof");
    if (this.lod !== "low") {
      const angle = Math.atan2(rise, d / 2), length = Math.hypot(rise, d / 2);
      for (const side of [-1, 1]) {
        this.box([w + 0.08, 0.07, 0.07], [p[0], p[1] + rise, p[2]], BASE, "roof");
        const count = this.lod === "high" ? Math.ceil(w / 0.32) : 4;
        for (let i = 0; i <= count; i++) this.box([0.025, 0.025, length], [p[0] - w / 2 + i * w / count, p[1] + rise / 2 + 0.025, p[2] + side * d / 4], SEAM, "roof", [side * angle, 0, 0]);
      }
    }
  }
  /** Crenellated parapet on a rectangle's perimeter: merlons at medium/high, one band at low. */
  parapet(cx: number, cz: number, w: number, d: number, y: number, h = 0.24, t = 0.16, color = EDGE) {
    if (this.lod === "low") {
      for (const z of [-1, 1]) this.box([w, h * 0.6, t], [cx, y + h * 0.3, cz + z * (d / 2 - t / 2)], color, "detail-static");
      for (const x of [-1, 1]) this.box([t, h * 0.6, d - 2 * t], [cx + x * (w / 2 - t / 2), y + h * 0.3, cz], color, "detail-static");
      return;
    }
    const step = 0.34, mw = 0.19;
    for (const z of [-1, 1]) { const n = Math.max(2, Math.round(w / step)); for (let i = 0; i < n; i++)
      this.box([mw, h, t], [cx - w / 2 + mw / 2 + i * (w - mw) / (n - 1), y + h / 2, cz + z * (d / 2 - t / 2)], color, "detail-static"); }
    for (const x of [-1, 1]) { const n = Math.max(2, Math.round(d / step)); for (let i = 1; i < n - 1; i++)
      this.box([t, h, mw], [cx + x * (w / 2 - t / 2), y + h / 2, cz - d / 2 + mw / 2 + i * (d - mw) / (n - 1)], color, "detail-static"); }
    // Continuous wall-walk band under the merlons.
    for (const z of [-1, 1]) this.box([w, 0.08, t + 0.04], [cx, y + 0.04, cz + z * (d / 2 - t / 2)], BASE, "detail-static");
  }
  /** Pyramidal (4 sides) or conical spire roof with a short finial. */
  spire(r: number, h: number, p: V3, sides = 4, color = ROOF) {
    this.add(new THREE.ConeGeometry(r, h, sides, 1), color, [p[0], p[1] + h / 2, p[2]], "roof", [0, sides === 4 ? Math.PI / 4 : 0, 0]);
    if (this.lod !== "low") this.cylinder(0.025, 0.025, 0.16, [p[0], p[1] + h + 0.06, p[2]], IRON, "roof", [0, 0, 0], 5);
  }
  window(x: number, y: number, z: number, w = 0.19, h = 0.42) {
    if (this.lod === "low") return;
    this.box([w + 0.13, h + 0.13, 0.12], [x, y, z], BASE, "detail-static");
    this.box([w, h, 0.025], [x, y, z + 0.065], DARK, "detail-static");
    this.box([w + 0.18, 0.07, 0.18], [x, y - h / 2 - 0.04, z + 0.04], EDGE, "detail-static");
  }
  finish(): ModuleGeometry {
    const groups: ModuleGeometry["groups"] = {}, bounds = new THREE.Box3(); let triangles = 0;
    for (const [key, parts] of Object.entries(this.parts) as [ArchitectureGroup, THREE.BufferGeometry[]][]) if (parts.length) {
      const g = mergeGeometries(parts, false)!; g.computeBoundingBox(); g.computeBoundingSphere();
      bounds.union(g.boundingBox!); triangles += g.getAttribute("position").count / 3; groups[key] = g;
      parts.forEach(p => p.dispose());
    }
    return { groups, bounds, triangles };
  }
}

function gatehouse(b: Builder) {
  b.box([3.8, 0.18, 2.6], [0, 0.09, 0.1], BASE);
  for (const x of [-1.26, 1.26]) {
    b.hall(1.12, 1.85, 2.7, [x, 0.18, -0.1], 0.3);
    b.box([1.25, 0.2, 1.98], [x, 0.4, -0.1], BASE);
    // Corbelled crown, crenellated parapet and a slate spire set inside the wall-walk.
    for (const z of [-1, 1]) b.box([1.3, 0.12, 0.2], [x, 2.94, -0.1 + z * 0.915], EDGE);
    for (const sx of [-1, 1]) b.box([0.2, 0.12, 1.63], [x + sx * 0.55, 2.94, -0.1], EDGE);
    b.parapet(x, -0.1, 1.3, 2.03, 3.0, 0.24, 0.15);
    b.spire(0.52, 0.74, [x, 3.0, -0.1]);
    b.window(x, 2.12, 0.87, 0.18, 0.53);
  }
  b.arch(1.45, 2.45, 1.3, 1.1, 1.2, [0, 0.18, -0.7]);
  b.archTrim(1.1, 1.2, [0, 0.18, 0.66]);
  b.box([1.55, 0.14, 1.45], [0, 2.7, -0.05], EDGE);
  b.parapet(0, -0.05, 1.55, 1.45, 2.77, 0.22, 0.14);
  b.box([1.2, 0.05, 1.1], [0, 2.795, -0.05], WOOD, "roof");
  if (b.lod !== "low") {
    for (const x of [-0.42, -0.21, 0, 0.21, 0.42]) b.box([0.035, 1.35, 0.05], [x, 1.16, -0.3], IRON, "detail-static");
    for (const y of [0.65, 1.12, 1.6]) b.box([1.04, 0.045, 0.05], [0, y, -0.3], IRON, "detail-static");
  }
  b.box([1.45, 0.1, 0.5], [0, 0.05, 1.05], EDGE);
}
function hall(b: Builder, great = false) {
  const w = great ? 4.2 : 3.5, d = great ? 2.35 : 2.0, h = great ? 2.25 : 1.75;
  b.hall(w, d, h, [0, 0, 0], great ? 0.95 : 0.68);
  b.gable(w + 0.24, d + 0.3, great ? 0.95 : 0.85, [0, h + 0.02, 0]);
  if (b.lod !== "low") for (const x of [-w / 2 + 0.16, -w / 4, w / 4, w / 2 - 0.16]) {
    b.box([0.18, h * 0.82, 0.36], [x, h * 0.41, d / 2 + 0.06], BASE, "detail-static");
    b.box([0.25, 0.12, 0.41], [x, h * 0.82, d / 2 + 0.06], EDGE, "detail-static");
    b.window(x * 0.83, h * 0.62, d / 2 + 0.06, 0.15, 0.48);
  }
  if (great) {
    b.hall(1.0, 1.45, 1.3, [-1.65, 0, 1.0], 0.4); b.hall(1.0, 1.45, 1.3, [1.65, 0, 1.0], 0.4);
    b.gable(1.15, 1.6, 0.5, [-1.65, 1.31, 1.0]); b.gable(1.15, 1.6, 0.5, [1.65, 1.31, 1.0]);
    b.box([1.7, 0.42, 0.74], [0, 3.17, 0], STONE, "roof"); b.gable(1.92, 0.98, 0.4, [0, 3.38, 0]);
    if (b.lod !== "low") for (const x of [-0.55, 0, 0.55]) b.box([0.2, 0.23, 0.03], [x, 3.18, 0.39], DARK, "roof");
  } else b.box([0.3, 0.8, 0.3], [1.1, 2.35, -0.4], BASE, "roof");
}
function observatory(b: Builder) {
  b.cylinder(1.15, 1.28, 0.25, [0, 0.125, 0], BASE);
  b.cylinder(0.77, 1.03, 3.35, [0, 1.925, 0]);
  b.cylinder(1.12, 0.84, 0.22, [0, 3.62, 0], EDGE);
  b.cylinder(0.83, 0.83, 0.54, [0, 3.97, 0], BASE, "roof");
  b.add(new THREE.SphereGeometry(0.95, b.segments, b.lod === "high" ? 10 : b.lod === "medium" ? 6 : 3, 0, Math.PI * 2, 0, Math.PI / 2), BRONZE, [0, 4.23, 0], "roof");
  b.cylinder(0.055, 0.055, 0.3, [0, 5.23, 0], IRON, "roof", [0, 0, 0], 6);
  if (b.lod !== "low") {
    for (let i = 0; i < b.segments; i++) {
      const a = i * Math.PI * 2 / b.segments;
      b.box([0.045, 0.4, 0.045], [Math.cos(a) * 1.04, 3.98, Math.sin(a) * 1.04], IRON, "detail-static");
    }
    b.add(new THREE.TorusGeometry(1.04, 0.04, 4, b.segments), IRON, [0, 4.18, 0], "detail-static", [Math.PI / 2, 0, 0]);
    for (const y of [1.05, 1.9, 2.75]) b.window(0, y, 1.02 - y * 0.075, 0.19, 0.45);
    // Static instrument; never an invented autonomous agent animation.
    b.cylinder(0.1, 0.13, 0.72, [0.4, 4.56, 0.4], IRON, "roof", [0.6, 0, -0.7], 8);
  }
}

/** The three representative modules are deliberately authored first under this common recipe. */
function build(id: ModuleId, lod: DetailLevel): ModuleGeometry {
  const b = new Builder(lod);
  switch (id) {
    case "gatehouse": gatehouse(b); break;
    case "hall": hall(b); break;
    case "great_hall": hall(b, true); break;
    case "observatory": observatory(b); break;
    case "guardhouse": {
      b.hall(1.6, 1.65, 2.5, [0.38, 0, -0.2], 0.48); b.gable(1.85, 1.9, 0.75, [0.38, 2.52, -0.2]);
      b.hall(1.15, 1.6, 1.3, [-0.95, 0, 0.35], 0.38); b.gable(1.32, 1.8, 0.42, [-0.95, 1.32, 0.35]);
      b.window(0.38, 1.78, 0.68, 0.15, 0.48); b.box([0.34, 0.3, 0.07], [0.38, 1.2, 0.7], BASE, "detail-static");
      // Round corner turret with a conical roof: the identity watchtower silhouette.
      b.cylinder(0.4, 0.44, 0.16, [-1.2, 0.08, -0.82], BASE);
      b.cylinder(0.34, 0.38, 2.45, [-1.2, 1.385, -0.82]);
      b.cylinder(0.41, 0.36, 0.14, [-1.2, 2.67, -0.82], EDGE);
      b.spire(0.42, 0.45, [-1.2, 2.74, -0.82], b.segments);
      if (lod !== "low") for (const y of [1.0, 1.8]) b.box([0.05, 0.26, 0.09], [-0.835, y, -0.82], DARK, "detail-static"); break;
    }
    case "workshop": {
      b.hall(2.6, 1.8, 1.3, [-0.1, 0, -0.2], 0.95); b.gable(2.85, 2.08, 0.48, [-0.1, 1.32, -0.2], "#56616B");
      b.box([2.7, 0.11, 0.65], [-0.1, 1.15, 0.97], ROOF, "roof", [0.15, 0, 0]);
      for (const x of [-1.3, 1.1]) b.box([0.1, 1.05, 0.1], [x, 0.525, 1.13], WOOD);
      b.box([0.34, 1.2, 0.36], [0.82, 1.55, -0.65], BASE); b.box([0.44, 0.1, 0.46], [0.82, 2.18, -0.65], EDGE);
      if (lod !== "low") for (const [x, z] of [[-0.95, 0.95], [-0.45, 1.05]]) b.box([0.38, 0.4, 0.38], [x!, 0.2, z!], WOOD, "detail-static"); break;
    }
    case "vault": {
      b.box([3.1, 0.22, 3.0], [0, 0.11, 0], BASE); b.hall(2.8, 2.5, 1.85, [0, 0.22, 0], 0.92);
      b.box([3.0, 0.25, 2.7], [0, 2.12, 0], EDGE, "roof"); b.box([2.65, 0.27, 2.35], [0, 2.36, 0], ROOF, "roof");
      // Battered corner buttresses read as heavy, protected masonry.
      for (const x of [-1.38, 1.38]) for (const z of [-1.32, 1.32]) { b.box([0.34, 1.7, 0.34], [x, 1.07, z], BASE); b.box([0.38, 0.12, 0.38], [x, 1.98, z], EDGE); }
      b.cylinder(0.43, 0.43, 0.1, [0, 0.98, 1.01], IRON, "interior-structure", [Math.PI / 2, 0, 0]);
      // Neutral schematic storage bays, not records, contents, or a security-state claim.
      // The central aisle remains open from the cutaway to the existing interior floor.
      for (const x of [-0.86, 0.86]) {
        b.box([0.42, 0.5, 1.3], [x, 0.715, -0.18], BASE, "interior-structure");
        if (lod !== "low") for (const z of [-0.48, 0.12])
          b.box([0.45, 0.06, 0.56], [x, 0.995, z], EDGE, "interior-structure");
      }
      if (lod !== "low") { b.add(new THREE.TorusGeometry(0.31, 0.045, 4, 16), EDGE, [0, 0.98, 1.08], "detail-static");
        for (const x of [-0.93, 0.93]) { b.window(x, 1.7, 1.28, 0.32, 0.12); b.box([0.2, 1.6, 0.32], [x, 1.02, 1.28], BASE, "detail-static"); }
      } break;
    }
    case "tool_annex": {
      b.hall(1.8, 1.65, 1.4, [-0.42, 0, 0], 0.55); b.hall(0.9, 1.4, 1.85, [0.91, 0, -0.13], 0.32);
      b.box([2.0, 0.16, 1.85], [-0.42, 1.48, 0], ROOF, "roof"); b.gable(1.1, 1.62, 0.34, [0.91, 1.85, -0.13], BRONZE);
      if (lod !== "low") for (const x of [-1.15, -0.82, -0.49, -0.16, 0.17]) b.box([0.07, 1.1, 0.25], [x, 0.63, 0.87], BASE, "detail-static"); break;
    }
    case "forge": {
      b.hall(3.4, 2.4, 1.55, [0, 0, 0], 1.1);
      for (const x of [-1.1, 0, 1.1]) b.gable(1.13, 2.62, 0.6, [x, 1.57 + (x === 0 ? 0.2 : 0), 0]);
      b.box([0.5, 2.7, 0.5], [1.26, 1.35, -0.77], BASE); b.box([0.65, 0.16, 0.65], [1.26, 2.74, -0.77], EDGE);
      b.box([0.12, 1.95, 0.12], [-1.42, 0.975, 1.4], IRON); b.box([1.1, 0.12, 0.14], [-0.93, 1.94, 1.4], IRON);
      if (lod !== "low") b.box([0.035, 0.65, 0.035], [-0.42, 1.6, 1.4], IRON, "detail-static"); break;
    }
    case "portal": {
      b.box([3.0, 0.2, 1.8], [0, 0.1, 0], BASE); b.arch(2.65, 2.65, 0.45, 1.55, 1.27, [0, 0.2, -0.23]);
      b.archTrim(1.55, 1.27, [0, 0.2, 0.28], EDGE); b.gable(2.95, 1.0, 0.45, [0, 2.86, 0], BRONZE);
      for (const x of [-1.1, 1.1]) b.box([0.4, 0.2, 0.85], [x, 0.3, 0], EDGE); break;
    }
  }
  return b.finish();
}
const cache = new Map<string, ModuleGeometry>();
export function moduleGeometry(id: ModuleId, lod: DetailLevel = "medium"): ModuleGeometry {
  const key = `${id}:${lod}`;
  let g = cache.get(key); if (!g) { g = build(id, lod); cache.set(key, g); } return g;
}
export const cachedModuleGeometryCount = () => cache.size;
export const architectureMaterials = {
  body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.87, metalness: 0.02 }),
  roof: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.76, metalness: 0.08 }),
};
export interface ModuleMaterials { body: THREE.MeshStandardMaterial; roof: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial; }
const materialFamilies = new Map<ModuleId, ModuleMaterials>();
const shaderMaterials = new Map<string, { id: ModuleId; material: THREE.Material }>();
/** Ten reusable families, not per-asset clones. Separate program keys prevent one failed shader
 * from poisoning the cached program used by unrelated module families, including shadow draws. */
export function moduleMaterials(id: ModuleId): ModuleMaterials {
  if (!Object.hasOwn(MODULE_CATALOG, id)) throw new Error("Unknown architectural material family");
  let materials = materialFamilies.get(id);
  if (!materials) {
    materials = { body: architectureMaterials.body.clone(), roof: architectureMaterials.roof.clone(), depth: new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }) };
    for (const [part, material] of Object.entries(materials)) {
      const name = `dk_arch_${id}_${part}`;
      material.name = name;
      material.customProgramCacheKey = () => `dk-architecture-v2:${id}:${part}`;
      shaderMaterials.set(name, { id, material });
    }
    materialFamilies.set(id, materials);
  }
  return materials;
}
export const ownedShaderMaterial = (name: string) => shaderMaterials.get(name);
export const cachedModuleMaterialCount = () => materialFamilies.size * 3;

const resourceOwners = new Map<object, { modules: number; refresh: () => void }>();
/** CPU geometry is reusable, but every WebGL renderer attaches dispose listeners to it and to
 * shared materials. Context loss alone does not remove those listeners. Release their GPU
 * registrations when a renderer's last module leaves, without deleting the bounded CPU cache.
 * Disposal also reaches any overlapping live renderer; explicitly refresh it so Three uploads
 * the retained buffers again rather than leaving that canvas with invalid GPU resources. */
export function retainArchitectureResources(renderer: object, refresh: () => void): () => void {
  const owner = resourceOwners.get(renderer) ?? { modules: 0, refresh };
  owner.modules++; resourceOwners.set(renderer, owner);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--owner.modules > 0) return;
    resourceOwners.delete(renderer);
    for (const geometry of cache.values()) for (const group of Object.values(geometry.groups)) group.dispose();
    for (const material of Object.values(architectureMaterials)) material.dispose();
    for (const family of materialFamilies.values()) for (const material of Object.values(family)) material.dispose();
    for (const live of resourceOwners.values()) live.refresh();
  };
}
