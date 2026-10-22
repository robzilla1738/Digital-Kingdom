import { useEffect, useMemo } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CompiledScene } from "@dk/contracts";
import { useLabel } from "./labels.tsx";
import type { PresentationGroup } from "./scenePresentation.ts";

const LAWN = new THREE.Color("#3C5243"), LAWN_HC = new THREE.Color("#52705A"), EARTH = new THREE.Color("#4A3F33");
const CANOPY = ["#3F5E49", "#4B6A50", "#365444"].map(c => new THREE.Color(c)), TRUNK = new THREE.Color("#5A4634");
/** Deterministic hash in [0, 1): decoration placement never depends on time, events or randomness. */
const hash = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
function paint(g: THREE.BufferGeometry, color: (normalY: number, y: number) => THREE.Color) {
  const n = g.getAttribute("normal"), p = g.getAttribute("position"), out = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const c = color(n.getY(i), p.getY(i)); out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(out, 3)); return g;
}

/** Local, nonselectable organizational terraces on a lawn island. No moat, control wall or inferred
 * security perimeter: trees are scattered decoration placed only outside every district's bounds. */
export function Environment({ scene, groups, highContrast, quality = "medium" }: { scene: CompiledScene; groups: PresentationGroup[]; highContrast: boolean; quality?: "low" | "medium" | "high" }) {
  const geo = useMemo(() => {
    const foundations: THREE.BufferGeometry[] = [], paving: THREE.BufferGeometry[] = [], trim: THREE.BufferGeometry[] = [], trees: THREE.BufferGeometry[] = [];
    const box = (s: [number, number, number], p: [number, number, number], to: THREE.BufferGeometry[]) => { const g = new THREE.BoxGeometry(...s); g.translate(...p); to.push(g); };
    // A shallow, chamfered base follows the occupied campus silhouette, not an enormous empty rectangle.
    for (const environment of new Set(groups.map(g => g.environment))) {
      const points = groups.filter(g => g.environment === environment).flatMap(g => g.rooms.flatMap(r => [-1, 1].flatMap(x => [-1, 1].map(z => [r.position.x + x * (r.footprint.w / 2 + 1.15), r.position.z + z * (r.footprint.d / 2 + 1.15)] as [number, number]))));
      // The lawn also covers the paved connectors between districts, so no path overhangs the edge.
      { const ds = groups.filter(g => g.environment === environment), c = ds.find(g => g.zoneId === "application") ?? ds[0];
        if (c) { const cx = (c.bounds.minX + c.bounds.maxX) / 2, cz = (c.bounds.minZ + c.bounds.maxZ) / 2;
          for (const g of ds) { const x = (g.bounds.minX + g.bounds.maxX) / 2, z = (g.bounds.minZ + g.bounds.maxZ) / 2;
            for (const [px, pz] of [[x, cz], [cx, cz], [x, z]] as [number, number][]) for (const dx of [-1.4, 1.4]) for (const dz of [-1.4, 1.4]) points.push([px + dx, pz + dz]); } } }
      const hull = convexHull(points); if (hull.length < 3) continue;
      const shape = new THREE.Shape(hull.map(([x, z]) => new THREE.Vector2(x, -z)));
      const slab = new THREE.ExtrudeGeometry(shape, { depth: 0.26, bevelEnabled: quality !== "low", bevelSegments: 1, bevelSize: 0.16, bevelThickness: 0.08, steps: 1 });
      slab.rotateX(-Math.PI / 2); slab.translate(0, -0.4, 0); slab.deleteAttribute("uv");
      // Lawn on top, banded earth on the chamfered sides.
      foundations.push(paint(slab.index ? slab.toNonIndexed() : slab, (ny, y) => ny > 0.6 ? (highContrast ? LAWN_HC : LAWN) : EARTH.clone().multiplyScalar(0.8 + 0.25 * Math.min(1, Math.max(0, (y + 0.4) / 0.35)))));
      if (quality !== "low") {
        const districtsHere = groups.filter(g => g.environment === environment), xs = hull.map(h => h[0]), zs = hull.map(h => h[1]);
        const inside = (x: number, z: number) => hull.every((a, i) => { const b = hull[(i + 1) % hull.length]!; return (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0.55 * Math.hypot(b[0] - a[0], b[1] - a[1]); });
        const clear = (x: number, z: number) => districtsHere.every(g => x < g.bounds.minX - 0.75 || x > g.bounds.maxX + 0.75 || z < g.bounds.minZ - 0.75 || z > g.bounds.maxZ + 0.75);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
        let placed = 0;
        for (let gx = minX; gx <= maxX && placed < 34; gx += 1.6) for (let gz = minZ; gz <= maxZ && placed < 34; gz += 1.6) {
          const x = gx + (hash(gx, gz) - 0.5) * 1.1, z = gz + (hash(gz, gx) - 0.5) * 1.1;
          if (hash(x, z) < 0.55 || !inside(x, z) || !clear(x, z)) continue;
          const s = 0.75 + hash(z, x) * 0.5, canopy = CANOPY[Math.floor(hash(x + 1, z) * CANOPY.length)]!;
          const trunk = new THREE.CylinderGeometry(0.06 * s, 0.08 * s, 0.34 * s, 5); trunk.translate(x, -0.12 + 0.17 * s, z);
          const lower = new THREE.ConeGeometry(0.42 * s, 0.78 * s, 7); lower.translate(x, -0.12 + 0.62 * s, z);
          const upper = new THREE.ConeGeometry(0.3 * s, 0.6 * s, 7); upper.translate(x, -0.12 + 1.0 * s, z);
          trees.push(paint(trunk.toNonIndexed(), () => TRUNK), paint(lower.toNonIndexed(), (_ny, y) => canopy.clone().multiplyScalar(0.85 + 0.15 * (y - (-0.12 + 0.23 * s)) / (0.78 * s))), paint(upper.toNonIndexed(), () => canopy.clone().multiplyScalar(1.08)));
          [trunk, lower, upper].forEach(g => g.dispose()); placed++;
        }
      }
      const districts = groups.filter(g => g.environment === environment), centre = districts.find(g => g.zoneId === "application") ?? districts[0];
      if (centre) { const cx = (centre.bounds.minX + centre.bounds.maxX) / 2, cz = (centre.bounds.minZ + centre.bounds.maxZ) / 2;
        for (const g of districts) { const x = (g.bounds.minX + g.bounds.maxX) / 2, z = (g.bounds.minZ + g.bounds.maxZ) / 2;
          box([Math.abs(x - cx) + 1.05, 0.04, 1.05], [(x + cx) / 2, -0.09, cz], paving);
          box([1.05, 0.04, Math.abs(z - cz) + 1.05], [x, -0.09, (z + cz) / 2], paving);
        }
      }
    }
    for (const g of groups) {
      const b = g.bounds, w = b.maxX - b.minX, d = b.maxZ - b.minZ, x = (b.minX + b.maxX) / 2, z = (b.minZ + b.maxZ) / 2;
      box([w + 0.35, 0.26, d + 0.35], [x, -0.18, z], paving);
      box([w, 0.09, d], [x, -0.005, z], paving);
      // Inset seams and shallow chamfer-like tiers supply contact, not enclosure.
      for (const edge of [-1, 1]) {
        box([w, 0.04, 0.07], [x, 0.045, z + edge * (d / 2 - 0.14)], trim);
        box([0.07, 0.04, d], [x + edge * (w / 2 - 0.14), 0.045, z], trim);
      }
      if (quality !== "low" && g.zoneId === "application") {
        // Flush stone joints identify the central court without decorative security symbolism.
        for (let sx = b.minX + 1.4; sx < b.maxX; sx += 1.4) box([0.025, 0.012, d - 0.35], [sx, 0.048, z], trim);
        for (let sz = b.minZ + 1.4; sz < b.maxZ; sz += 1.4) box([w - 0.35, 0.012, 0.025], [x, 0.048, sz], trim);
      }
      for (const room of g.rooms) {
        box([room.footprint.w + 0.35, 0.04, room.footprint.d + 0.35], [room.position.x, 0.05, room.position.z], trim);
      }
    }
    for (const parts of [paving, trim]) parts.forEach((g, i) => { const flat = g.index ? g.toNonIndexed() : g; if (flat !== g) g.dispose(); flat.deleteAttribute("uv"); parts[i] = flat; });
    const joined = [paving, trim, foundations, trees].map(parts => { const g = parts.length ? mergeGeometries(parts, false)! : new THREE.BufferGeometry(); parts.forEach(p => p.dispose()); return g; });
    return joined;
  }, [groups, quality, highContrast]);
  useEffect(() => () => geo.forEach(g => g.dispose()), [geo]);
  return <group name="presentation-decoration" raycast={() => null}>
    <mesh geometry={geo[2]} receiveShadow raycast={() => null}><meshStandardMaterial vertexColors roughness={1} /></mesh>
    <mesh geometry={geo[0]} receiveShadow raycast={() => null}><meshStandardMaterial color={highContrast ? "#7A7F80" : "#625F58"} roughness={0.95} /></mesh>
    <mesh geometry={geo[1]} receiveShadow raycast={() => null}><meshStandardMaterial color="#8A857A" roughness={0.92} /></mesh>
    {geo[3]!.getAttribute("position") && <mesh geometry={geo[3]} castShadow receiveShadow raycast={() => null}><meshStandardMaterial vertexColors roughness={0.9} flatShading /></mesh>}
    {groups.map(g => <ZoneLabel key={g.key} group={g} />)}
  </group>;
}
function ZoneLabel({ group }: { group: PresentationGroup }) {
  const x = (group.bounds.minX + group.bounds.maxX) / 2, z = group.bounds.maxZ + 0.2;
  const ref = useLabel(`zone:${group.key}`, [x, 0.1, z], -20);
  return <Html position={[x, 0.1, z]} center zIndexRange={[9, 1]}><div ref={ref} className="lbl"><span className="zone-label" style={{ display: "block", color: "#B5C3D3", background: "#121C29", fontSize: 12, lineHeight: "16px", padding: "4px 7px", borderRadius: 4 }}>{group.label} · {group.environment}</span></div></Html>;
}

/** Monotonic-chain convex hull with deterministic sorting; presentation geometry only. */
function convexHull(points: [number, number][]) {
  const sorted = points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const half = (ps: [number, number][]) => { const h: [number, number][] = []; for (const p of ps) { while (h.length >= 2 && cross(h[h.length - 2]!, h[h.length - 1]!, p) <= 0) h.pop(); h.push(p); } return h; };
  const a = half(sorted), b = half([...sorted].reverse()); a.pop(); b.pop(); return [...a, ...b];
}
