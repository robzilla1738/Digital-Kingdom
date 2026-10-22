import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { MODULE_CATALOG, type ModuleId } from "@dk/contracts";
import { CastleModule } from "./modules.tsx";
import { moduleGeometry } from "./geometry.ts";

/** Explicitly synthetic comparison harness, not an inventory or backend replacement. */
export function ModuleSheet({ prototype = false, near = false }: { prototype?: boolean; near?: boolean }) {
  const [roofs, setRoofs] = useState(true);
  const ids: ModuleId[] = near ? ["gatehouse", "hall", "vault", "observatory"] : prototype ? ["gatehouse", "hall", "observatory"] : Object.keys(MODULE_CATALOG) as ModuleId[];
  return <section style={{ height: "100%", minHeight: 600, position: "relative", background: "#0B111B" }} aria-label="Synthetic architectural module comparison">
    <div style={{ position: "absolute", zIndex: 10, left: 24, top: 20, color: "#EEF3FA" }}>
      <h2 style={{ margin: 0 }}>Architectural kit · {near ? "four-module near inspection" : prototype ? "three-module prototype" : "ten stable module IDs"}</h2>
      <p>Synthetic module sheet. Same world scale, light and medium detail. Architecture is not a security claim.</p>
      <button onClick={() => setRoofs(!roofs)} aria-pressed={roofs}>{roofs ? "Hide roofs" : "Show roofs"}</button>
    </div>
    <Canvas shadows frameloop="demand" dpr={1.5} orthographic camera={{ position: [10, 17, 24], zoom: near ? 47 : prototype ? 49 : 35, near: 0.1, far: 150 }} onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; gl.toneMappingExposure = 1.05; }}>
      <color attach="background" args={["#0B111B"]} />
      <hemisphereLight args={["#E7EFF9", "#4D453A", 1.65]} />
      <directionalLight position={[-12, 20, 14]} intensity={3.1} color="#FFF1DA" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={20} shadow-camera-bottom={-20} shadow-normalBias={0.04} />
      <directionalLight position={[12, 9, -10]} intensity={1.1} color="#AAC9EF" />
      <OrbitControls target={[0, 1.8, 0]} enableDamping={false} minPolarAngle={0.4} maxPolarAngle={1.1} />
      {ids.map((id, i) => {
        const x = near ? (i - 1.5) * 6 : prototype ? (i - 1) * 6 : (i % 5 - 2) * 5.8, z = prototype || near ? 0 : (Math.floor(i / 5) - 0.5) * 7;
        return <group key={id} position={[x, 0, z]}>
          <mesh position={[0, -0.15, 0]} receiveShadow><boxGeometry args={[5.2, 0.3, 5.4]} /><meshStandardMaterial color="#293645" roughness={1} /></mesh>
          <CastleModule id={id} roofs={roofs} />
          <Html position={[0, 0.2, 2.65]} center><div style={{ whiteSpace: "nowrap", background: "#121C29", padding: "6px 10px", border: "1px solid #70849B", color: "#EEF3FA", borderRadius: 6, fontSize: 12 }}>{id} · {moduleGeometry(id).triangles} triangles</div></Html>
        </group>;
      })}
    </Canvas>
  </section>;
}
