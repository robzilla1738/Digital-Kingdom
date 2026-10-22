import { useMemo } from "react";
import type { ModuleId } from "@dk/contracts";
import { materials, merlons, windowLit, type Materials } from "./materials.ts";
import type * as THREE from "three";

/**
 * The Digital Kingdom castle kit: ten original modules built from primitives (Apache-2.0, no third-party
 * meshes). Each has a recognisable silhouette, a consistent origin at ground centre, units in metres, and
 * a roof group that can be hidden to reveal the interior. See assets/castle-kit/MANIFEST.json.
 */
type V3 = [number, number, number];
interface P { m: Materials; roofs: boolean }

function B({ s, p, m, r }: { s: V3; p: V3; m: THREE.Material; r?: V3 }) {
  return <mesh position={p} rotation={r} material={m} castShadow receiveShadow><boxGeometry args={s} /></mesh>;
}
function Cyl({ rt, rb, h, p, m, seg = 16, r }: { rt: number; rb: number; h: number; p: V3; m: THREE.Material; seg?: number; r?: V3 }) {
  return <mesh position={p} rotation={r} material={m} castShadow receiveShadow><cylinderGeometry args={[rt, rb, h, seg]} /></mesh>;
}
function Cone({ r, h, p, m, seg = 16, rot }: { r: number; h: number; p: V3; m: THREE.Material; seg?: number; rot?: V3 }) {
  return <mesh position={p} rotation={rot} material={m} castShadow><coneGeometry args={[r, h, seg]} /></mesh>;
}
function Parapet({ w, d, y, m }: { w: number; d: number; y: number; m: THREE.Material }) {
  const gx = useMemo(() => merlons(w), [w]);
  const gz = useMemo(() => merlons(d), [d]);
  return (
    <group position={[0, y, 0]}>
      <mesh geometry={gx} position={[0, 0, d / 2 - 0.17]} material={m} castShadow />
      <mesh geometry={gx} position={[0, 0, -d / 2 + 0.17]} material={m} castShadow />
      <mesh geometry={gz} position={[w / 2 - 0.17, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={m} castShadow />
      <mesh geometry={gz} position={[-w / 2 + 0.17, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={m} castShadow />
    </group>
  );
}
function RoundParapet({ r, y, m, n = 10 }: { r: number; y: number; m: THREE.Material; n?: number }) {
  return (
    <group position={[0, y, 0]}>
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return <mesh key={i} position={[Math.cos(a) * r, 0.15, Math.sin(a) * r]} rotation={[0, -a, 0]} material={m} castShadow><boxGeometry args={[0.28, 0.3, 0.26]} /></mesh>;
      })}
    </group>
  );
}
function Windows({ xs, y, z, m }: { xs: number[]; y: number; z: number; m: THREE.Material }) {
  return <>{xs.map((x, i) => <mesh key={i} position={[x, y, z]} material={m}><boxGeometry args={[0.22, 0.42, 0.04]} /></mesh>)}</>;
}
function Banner({ p, m }: { p: V3; m: THREE.Material }) {
  return (
    <group position={p}>
      <mesh material={m} position={[0.22, -0.3, 0]}><planeGeometry args={[0.42, 0.6]} /></mesh>
      <mesh position={[0, 0, 0]}><cylinderGeometry args={[0.025, 0.025, 1.1, 6]} /><meshStandardMaterial color="#2e2a26" roughness={0.9} /></mesh>
    </group>
  );
}

function Gatehouse({ m, roofs }: P) {
  return (
    <group>
      {[-1.15, 1.15].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <B s={[1.0, 2.9, 1.5]} p={[0, 1.45, 0]} m={m.stone} />
          <Parapet w={1.1} d={1.6} y={2.9} m={m.stoneLight} />
          {roofs && <Cone r={0.78} h={1.2} p={[0, 3.6, 0]} m={m.roof} seg={4} rot={[0, Math.PI / 4, 0]} />}
          <Windows xs={[0]} y={2.1} z={0.76} m={m.window} />
        </group>
      ))}
      <B s={[1.3, 0.9, 1.3]} p={[0, 2.25, 0]} m={m.stoneDark} />
      <Parapet w={1.3} d={1.3} y={2.7} m={m.stoneLight} />
      <B s={[1.3, 1.8, 1.25]} p={[0, 0.9, -0.05]} m={m.door} />
      <B s={[1.36, 0.12, 1.32]} p={[0, 1.78, 0]} m={m.metal} />
      {[-0.4, -0.13, 0.13, 0.4].map((x) => <B key={x} s={[0.05, 1.5, 0.05]} p={[x, 1.0, 0.62]} m={m.metal} />)}
      <Banner p={[-1.15, 3.1, 0.8]} m={m.banner} />
      <Banner p={[1.15, 3.1, 0.8]} m={m.banner} />
    </group>
  );
}

function Guardhouse({ m, roofs }: P) {
  return (
    <group>
      <B s={[1.5, 2.6, 1.5]} p={[0, 1.3, 0]} m={m.stone} />
      <Parapet w={1.6} d={1.6} y={2.6} m={m.stoneLight} />
      {roofs && <Cone r={1.12} h={1.1} p={[0, 3.3, 0]} m={m.roof} seg={4} rot={[0, Math.PI / 4, 0]} />}
      <B s={[0.9, 1.1, 1.0]} p={[-0.95, 0.55, 0.25]} m={m.stoneDark} />
      {roofs && <B s={[1.0, 0.12, 1.1]} p={[-0.95, 1.16, 0.25]} m={m.roofWarm} r={[0, 0, 0.18]} />}
      <B s={[0.45, 0.85, 0.05]} p={[0.3, 0.43, 0.76]} m={m.door} />
      <Windows xs={[-0.35, 0.35]} y={1.8} z={0.76} m={m.window} />
      <Cyl rt={0.05} rb={0.05} h={0.9} p={[0.7, 3.0, 0.7]} m={m.metal} seg={6} />
    </group>
  );
}

function Hall({ m, roofs, big }: P & { big?: boolean }) {
  const w = big ? 3.4 : 2.7, d = big ? 2.1 : 1.8, h = big ? 1.9 : 1.5;
  return (
    <group>
      <B s={[w, h, d]} p={[0, h / 2, 0]} m={m.stone} />
      <B s={[w + 0.1, 0.18, d + 0.1]} p={[0, 0.09, 0]} m={m.stoneDark} />
      {roofs && (
        <mesh position={[0, h + d * 0.28, 0]} rotation={[0, 0, Math.PI / 2]} scale={[d * 0.6, 1, d * 0.62]} material={m.roof} castShadow>
          <cylinderGeometry args={[0.95, 0.95, w + 0.25, 3]} />
        </mesh>
      )}
      <B s={[0.5, 0.9, 0.06]} p={[0, 0.45, d / 2 + 0.01]} m={m.door} />
      <Windows xs={big ? [-1.2, -0.65, 0.65, 1.2] : [-0.9, -0.45, 0.45, 0.9]} y={h * 0.62} z={d / 2 + 0.02} m={m.window} />
      <B s={[0.32, 1.0, 0.32]} p={[w / 2 - 0.45, h + 0.75, -d / 4]} m={m.stoneDark} />
      {big && (
        <>
          {[-w / 2, -w / 6, w / 6, w / 2].map((x) => <B key={x} s={[0.26, h * 0.8, 0.3]} p={[x, h * 0.4, d / 2 + 0.12]} m={m.stoneDark} />)}
          <Cyl rt={0.38} rb={0.42} h={1.0} p={[0, h + 1.15, 0]} m={m.stoneLight} />
          {roofs && <Cone r={0.5} h={0.8} p={[0, h + 2.05, 0]} m={m.roof} seg={8} />}
          <Banner p={[0, h + 2.9, 0]} m={m.bannerBlue} />
        </>
      )}
    </group>
  );
}

function Workshop({ m, roofs }: P) {
  return (
    <group>
      <B s={[2.3, 1.2, 1.7]} p={[0, 0.6, 0]} m={m.stone} />
      {roofs && <B s={[2.45, 0.12, 1.95]} p={[0, 1.38, 0]} m={m.roofWarm} r={[0.28, 0, 0]} />}
      <B s={[0.36, 1.3, 0.36]} p={[0.75, 1.5, -0.45]} m={m.stoneDark} />
      <B s={[0.9, 0.7, 0.06]} p={[-0.4, 0.35, 0.86]} m={m.wood} />
      <mesh position={[1.22, 0.75, 0.3]} rotation={[0, Math.PI / 2, 0]} material={m.wood} castShadow><torusGeometry args={[0.38, 0.07, 6, 12]} /></mesh>
      <Cyl rt={0.08} rb={0.08} h={0.2} p={[1.25, 0.75, 0.3]} m={m.metal} r={[0, 0, Math.PI / 2]} seg={8} />
      <Windows xs={[0.55]} y={0.75} z={0.86} m={m.window} />
      {[[-0.8, 0.95], [-0.5, 1.1]].map(([x, z], i) => <B key={i} s={[0.32, 0.32, 0.32]} p={[x!, 0.16, z!]} m={m.wood} />)}
    </group>
  );
}

function Vault({ m, roofs }: P) {
  return (
    <group>
      <B s={[2.2, 1.6, 2.2]} p={[0, 0.8, 0]} m={m.stoneDark} />
      <B s={[2.4, 0.25, 2.4]} p={[0, 0.12, 0]} m={m.stone} />
      {[0.5, 1.15].map((y) => <B key={y} s={[2.24, 0.1, 2.24]} p={[0, y, 0]} m={m.metal} />)}
      <Parapet w={2.3} d={2.3} y={1.6} m={m.stone} />
      {roofs && (
        <mesh position={[0, 1.6, 0]} material={m.roofTeal} castShadow>
          <sphereGeometry args={[0.95, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
      )}
      <mesh position={[0, 0.62, 1.11]} material={m.metal}><cylinderGeometry args={[0.42, 0.42, 0.08, 20]} /></mesh>
      <mesh position={[0, 0.62, 1.15]} rotation={[Math.PI / 2, 0, 0]} material={m.door}><torusGeometry args={[0.2, 0.04, 6, 16]} /></mesh>
    </group>
  );
}

function Observatory({ m, roofs }: P) {
  return (
    <group>
      <Cyl rt={0.75} rb={0.95} h={4.2} p={[0, 2.1, 0]} m={m.stone} seg={20} />
      <Cyl rt={0.98} rb={0.98} h={0.25} p={[0, 0.12, 0]} m={m.stoneDark} seg={20} />
      <RoundParapet r={0.82} y={4.2} m={m.stoneLight} n={12} />
      {roofs && (
        <mesh position={[0, 4.25, 0]} material={m.glass} castShadow><sphereGeometry args={[0.68, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
      )}
      <mesh position={[0, 3.2, 0]} rotation={[Math.PI / 2, 0, 0]} material={m.metal}><torusGeometry args={[0.9, 0.05, 6, 28]} /></mesh>
      <Cyl rt={0.1} rb={0.14} h={1.1} p={[0.35, 4.75, 0.2]} m={m.metal} r={[0.6, 0, -0.5]} seg={10} />
      {[1.2, 2.2, 3.0].map((y, i) => <mesh key={y} position={[Math.cos(i * 2) * 0.86, y, Math.sin(i * 2) * 0.86]} rotation={[0, -i * 2 + Math.PI / 2, 0]} material={m.window}><boxGeometry args={[0.2, 0.34, 0.04]} /></mesh>)}
    </group>
  );
}

function ToolAnnex({ m, roofs }: P) {
  return (
    <group>
      <B s={[1.4, 1.1, 1.3]} p={[-0.25, 0.55, 0]} m={m.stone} />
      {roofs && <B s={[1.5, 0.1, 1.42]} p={[-0.25, 1.15, 0]} m={m.roofTeal} />}
      <Cyl rt={0.48} rb={0.52} h={1.7} p={[0.65, 0.85, -0.1]} m={m.stoneLight} seg={14} />
      {roofs && <Cone r={0.62} h={0.9} p={[0.65, 2.15, -0.1]} m={m.roofTeal} seg={14} />}
      {[-0.65, -0.25, 0.15].map((x) => <B key={x} s={[0.22, 0.22, 0.22]} p={[x, 0.11, 0.85]} m={m.metal} />)}
      <B s={[0.4, 0.7, 0.05]} p={[-0.25, 0.35, 0.66]} m={m.door} />
    </group>
  );
}

function Forge({ m, roofs }: P) {
  return (
    <group>
      <B s={[2.4, 1.3, 1.8]} p={[0, 0.65, 0]} m={m.stone} />
      {roofs && (
        <mesh position={[0, 1.3 + 0.45, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.95, 1, 1.0]} material={m.roofWarm} castShadow>
          <cylinderGeometry args={[0.95, 0.95, 2.55, 3]} />
        </mesh>
      )}
      <B s={[0.6, 2.4, 0.6]} p={[0.8, 1.6, -0.4]} m={m.stoneDark} />
      <B s={[0.7, 0.12, 0.7]} p={[0.8, 2.85, -0.4]} m={m.stone} />
      <B s={[0.9, 0.6, 0.06]} p={[-0.3, 0.45, 0.91]} m={m.forgeGlow} />
      <B s={[0.6, 0.35, 0.3]} p={[-0.3, 0.18, 1.3]} m={m.metal} />
      <B s={[0.25, 0.3, 0.25]} p={[-0.3, 0.5, 1.3]} m={m.metal} />
    </group>
  );
}

function Portal({ m }: P) {
  return (
    <group>
      <B s={[0.5, 2.6, 0.6]} p={[-0.95, 1.3, 0]} m={m.stoneLight} />
      <B s={[0.5, 2.6, 0.6]} p={[0.95, 1.3, 0]} m={m.stoneLight} />
      <B s={[2.5, 0.45, 0.7]} p={[0, 2.8, 0]} m={m.stone} />
      <mesh position={[0, 1.3, 0]} material={m.portal}><planeGeometry args={[1.4, 2.5]} /></mesh>
      <B s={[2.6, 0.12, 1.1]} p={[0, 0.06, 0]} m={m.stoneDark} />
    </group>
  );
}

export function CastleModule({ id, roofs, highContrast, windowColor }: { id: ModuleId; roofs: boolean; highContrast?: boolean; windowColor?: string | null }) {
  const base = materials(highContrast);
  // evidence state lights the windows; otherwise they stay dark and matte
  const m = useMemo<Materials>(() => (windowColor ? { ...base, window: windowLit(windowColor) } : base), [base, windowColor]);
  switch (id) {
    case "gatehouse": return <Gatehouse m={m} roofs={roofs} />;
    case "guardhouse": return <Guardhouse m={m} roofs={roofs} />;
    case "hall": return <Hall m={m} roofs={roofs} />;
    case "great_hall": return <Hall m={m} roofs={roofs} big />;
    case "workshop": return <Workshop m={m} roofs={roofs} />;
    case "vault": return <Vault m={m} roofs={roofs} />;
    case "observatory": return <Observatory m={m} roofs={roofs} />;
    case "tool_annex": return <ToolAnnex m={m} roofs={roofs} />;
    case "forge": return <Forge m={m} roofs={roofs} />;
    case "portal": return <Portal m={m} roofs={roofs} />;
  }
}

