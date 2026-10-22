import { useEffect, useMemo } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CompiledScene } from "@dk/contracts";
import { useLabel } from "./labels.tsx";
import type { PresentationGroup } from "./scenePresentation.ts";

/** Local, nonselectable organizational terraces. No moat, control wall or inferred security perimeter. */
export function Environment({ scene, groups, highContrast, quality = "medium" }: { scene: CompiledScene; groups: PresentationGroup[]; highContrast: boolean; quality?: "low" | "medium" | "high" }) {
  const geo = useMemo(() => {
    const foundations: THREE.BufferGeometry[] = [], paving: THREE.BufferGeometry[] = [], trim: THREE.BufferGeometry[] = [];
    const box = (s: [number, number, number], p: [number, number, number], to: THREE.BufferGeometry[]) => { const g = new THREE.BoxGeometry(...s); g.translate(...p); to.push(g); };
    // A shallow, chamfered base follows the occupied campus silhouette, not an enormous empty rectangle.
    for (const environment of new Set(groups.map(g => g.environment))) {
      const points = groups.filter(g => g.environment === environment).flatMap(g => g.rooms.flatMap(r => [-1, 1].flatMap(x => [-1, 1].map(z => [r.position.x + x * (r.footprint.w / 2 + 1.15), r.position.z + z * (r.footprint.d / 2 + 1.15)] as [number, number]))));
      const hull = convexHull(points); if (hull.length < 3) continue;
      const shape = new THREE.Shape(hull.map(([x, z]) => new THREE.Vector2(x, -z)));
      const slab = new THREE.ExtrudeGeometry(shape, { depth: 0.26, bevelEnabled: quality !== "low", bevelSegments: 1, bevelSize: 0.16, bevelThickness: 0.08, steps: 1 });
      slab.rotateX(-Math.PI / 2); slab.translate(0, -0.4, 0); foundations.push(slab);
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
    const joined = [paving, trim, foundations].map(parts => { const g = parts.length ? mergeGeometries(parts, false)! : new THREE.BufferGeometry(); parts.forEach(p => p.dispose()); return g; });
    return joined;
  }, [groups, quality]);
  useEffect(() => () => geo.forEach(g => g.dispose()), [geo]);
  return <group name="presentation-decoration" raycast={() => null}>
    <mesh geometry={geo[2]} receiveShadow raycast={() => null}><meshStandardMaterial color={highContrast ? "#263343" : "#182331"} roughness={1} /></mesh>
    <mesh geometry={geo[0]} receiveShadow raycast={() => null}><meshStandardMaterial color="#344252" roughness={0.97} /></mesh>
    <mesh geometry={geo[1]} receiveShadow raycast={() => null}><meshStandardMaterial color="#59636A" roughness={0.95} /></mesh>
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
