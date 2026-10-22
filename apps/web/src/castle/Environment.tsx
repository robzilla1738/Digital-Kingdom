import { useMemo } from "react";
import * as THREE from "three";
import type { CompiledScene } from "@dk/contracts";
import { materials, merlons } from "./materials.ts";

const WALL_H = 1.7, WALL_T = 0.7, MOAT = 2.4;

/** Ground, moat, curtain wall with towers, zone plates and zone labels. Static geometry: built once per scene. */
export function Environment({ scene, highContrast }: { scene: CompiledScene; highContrast: boolean }) {
  const m = materials(highContrast);
  const pub = scene.rooms.filter((r) => r.zone_id === "public");
  const w = scene.wall;
  // The south wall runs through the gatehouses: they ARE the gates.
  const southZ = pub.length ? Math.min(...pub.map((r) => r.position.z)) : w.maxZ;
  const north = w.minZ, west = w.minX, east = w.maxX;
  const gaps = pub.map((r) => [r.position.x - r.footprint.w / 2 + 0.2, r.position.x + r.footprint.w / 2 - 0.2] as [number, number]).sort((a, b) => a[0] - b[0]);

  const southSegments = useMemo(() => {
    const segs: [number, number][] = [];
    let cur = west;
    for (const [a, b] of gaps) { if (a > cur) segs.push([cur, a]); cur = Math.max(cur, b); }
    if (cur < east) segs.push([cur, east]);
    return segs;
  }, [west, east, gaps]);

  const width = east - west, depth = southZ - north;
  const cx = (west + east) / 2, cz = (north + southZ) / 2;
  const span = Math.max(scene.bounds.maxX - scene.bounds.minX, scene.bounds.maxZ - scene.bounds.minZ) + 160;

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.08, cz]} material={m.grass} receiveShadow>
        <planeGeometry args={[span, span]} />
      </mesh>
      {/* low plinth the castle sits on: gives the diorama a clean edge against the ground */}
      <mesh position={[cx, -0.2, cz]} receiveShadow>
        <meshStandardMaterial color="#1f2226" roughness={1} />
        <boxGeometry args={[width + 2 * (MOAT + WALL_T) + 1.6, 0.3, depth + 2 * (MOAT + WALL_T) + 1.6]} />
      </mesh>
      {/* moat ring */}
      {[
        [cx, north - WALL_T - MOAT / 2, width + 2 * (MOAT + WALL_T) + 0.0, MOAT],
        [cx, southZ + WALL_T + MOAT / 2, width + 2 * (MOAT + WALL_T), MOAT],
        [west - WALL_T - MOAT / 2, cz, MOAT, depth + 2 * WALL_T],
        [east + WALL_T + MOAT / 2, cz, MOAT, depth + 2 * WALL_T],
      ].map(([x, z, sx, sz], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x!, -0.04, z!]} material={m.water} receiveShadow>
          <planeGeometry args={[sx!, sz!]} />
        </mesh>
      ))}
      {/* bridges in front of each gate */}
      {pub.map((r) => (
        <mesh key={r.asset_id} position={[r.position.x, 0.02, southZ + WALL_T + MOAT / 2 + 0.6]} material={m.wood} receiveShadow castShadow>
          <boxGeometry args={[1.5, 0.12, MOAT + 2.2]} />
        </mesh>
      ))}
      {/* courtyard paving */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.02, cz]} material={m.courtyard} receiveShadow>
        <planeGeometry args={[width, depth]} />
      </mesh>

      {/* curtain walls */}
      <WallRun from={[west, north]} to={[east, north]} />
      <WallRun from={[west, north]} to={[west, southZ]} />
      <WallRun from={[east, north]} to={[east, southZ]} />
      {southSegments.map(([a, b], i) => <WallRun key={i} from={[a, southZ]} to={[b, southZ]} />)}
      {[[west, north], [east, north], [west, southZ], [east, southZ]].map(([x, z], i) => <Tower key={i} x={x!} z={z!} highContrast={highContrast} />)}

      {/* zone plates + labels */}
      {scene.zones.map((z) => {
        const zw = z.bounds.maxX - z.bounds.minX, zd = z.bounds.maxZ - z.bounds.minZ;
        const tint = highContrast ? "#3a3d42" : { public: "#47494c", application: "#45484b", data: "#43474b", automation: "#45474e", delivery: "#48474a", external: "#3c4043" }[z.zone_id];
        return (
          <group key={z.zone_id}>
            <mesh position={[(z.bounds.minX + z.bounds.maxX) / 2, 0.02, (z.bounds.minZ + z.bounds.maxZ) / 2]} receiveShadow>
              <boxGeometry args={[zw, 0.08, zd]} />
              <meshStandardMaterial color={tint} roughness={1} />
            </mesh>
            {z.enclosed && <LowWall b={z.bounds} />}
            <ZoneLabel label={z.label} x={z.bounds.minX + 0.5} z={z.bounds.maxZ - 0.35} maxW={zw - 0.9} />
          </group>
        );
      })}
    </group>
  );
}

function WallRun({ from, to }: { from: [number, number]; to: [number, number] }) {
  const m = materials();
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (len < 0.3) return null;
  const angle = -Math.atan2(to[1] - from[1], to[0] - from[0]);
  const geo = merlons(len, 0.36, WALL_T * 0.45, 0.6);
  return (
    <group position={[(from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2]} rotation={[0, angle, 0]}>
      <mesh position={[0, WALL_H / 2, 0]} material={m.wall} castShadow receiveShadow><boxGeometry args={[len, WALL_H, WALL_T]} /></mesh>
      <mesh position={[0, WALL_H, WALL_T * 0.28]} geometry={geo} material={m.wallTop} castShadow />
      <mesh position={[0, WALL_H, -WALL_T * 0.28]} geometry={geo} material={m.wallTop} castShadow />
    </group>
  );
}

function Tower({ x, z, highContrast }: { x: number; z: number; highContrast: boolean }) {
  const m = materials(highContrast);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1.4, 0]} material={m.wall} castShadow receiveShadow><cylinderGeometry args={[1.0, 1.15, 2.8, 20]} /></mesh>
      <mesh position={[0, 3.25, 0]} material={m.roof} castShadow><coneGeometry args={[1.25, 1.6, 16]} /></mesh>
    </group>
  );
}

function LowWall({ b }: { b: { minX: number; maxX: number; minZ: number; maxZ: number } }) {
  const m = materials();
  const h = 0.45, t = 0.22;
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const segs: [number, number, number, number][] = [
    [cx, b.minZ, w, t], [cx - w / 4 - 0.6, b.maxZ, w / 2 - 1.2, t], [cx + w / 4 + 0.6, b.maxZ, w / 2 - 1.2, t], [b.minX, cz, t, d], [b.maxX, cz, t, d],
  ];
  return <>{segs.map(([x, z, sx, sz], i) => <mesh key={i} position={[x, h / 2, z]} material={m.stoneDark} castShadow receiveShadow><boxGeometry args={[sx, h, sz]} /></mesh>)}</>;
}


/**
 * Zone names painted onto the ground plates (a canvas texture, no font download). Being part of the
 * scene, they foreshorten and get occluded like real markings instead of floating over buildings.
 */
const zoneTexCache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();
function zoneTexture(label: string) {
  let hit = zoneTexCache.get(label);
  if (hit) return hit;
  const text = label.toUpperCase();
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = '600 56px Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.font = font;
  const spacing = 10;
  const w = Math.ceil([...text].reduce((s, ch) => s + ctx.measureText(ch).width + spacing, 0)) + 8;
  c.width = w; c.height = 80;
  ctx.font = font; ctx.fillStyle = "rgba(226,230,236,0.92)"; ctx.textBaseline = "middle";
  let x = 4;
  for (const ch of text) { ctx.fillText(ch, x, 42); x += ctx.measureText(ch).width + spacing; }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  hit = { tex, aspect: c.width / c.height };
  zoneTexCache.set(label, hit);
  return hit;
}

function ZoneLabel({ label, x, z, maxW }: { label: string; x: number; z: number; maxW: number }) {
  const { tex, aspect } = zoneTexture(label);
  const h = Math.min(0.9, maxW / aspect);
  const w = h * aspect;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x + w / 2, 0.075, z - h / 2]} renderOrder={1}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} transparent opacity={0.5} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
