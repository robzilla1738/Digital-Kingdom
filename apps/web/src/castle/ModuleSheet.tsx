import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { MODULE_CATALOG, type ModuleId } from "@dk/contracts";
import { CastleModule } from "./modules.tsx";
import { moduleGeometry } from "./geometry.ts";

/** Explicitly synthetic comparison harness, not an inventory or backend replacement. */
export const FAMILY_SHEET_IDS: ModuleId[] = ["dns_registry", "dispatch_house", "key_registry", "supply_depot", "archive", "outpost"];
/** Grid placement for a sheet: near/prototype use one row, families 3×2, the full kit a centred 4-column grid. */
function sheetCell(i: number, count: number, mode: "near" | "prototype" | "families" | "all"): [number, number] {
  if (mode === "near" || mode === "prototype") return [(i - (count - 1) / 2) * 6, 0];
  const cols = mode === "families" ? 3 : 4, rows = Math.ceil(count / cols);
  return [(i % cols - (cols - 1) / 2) * 7, (Math.floor(i / cols) - (rows - 1) / 2) * 8.6];
}
export function ModuleSheet({ prototype = false, near = false, families = false }: { prototype?: boolean; near?: boolean; families?: boolean }) {
  const [roofs, setRoofs] = useState(true);
  const mode = near ? "near" : prototype ? "prototype" : families ? "families" : "all";
  const ids: ModuleId[] = near ? ["gatehouse", "hall", "vault", "observatory"] : prototype ? ["gatehouse", "hall", "observatory"] : families ? FAMILY_SHEET_IDS : Object.keys(MODULE_CATALOG) as ModuleId[];
  const title = near ? "four-module near inspection" : prototype ? "three-module prototype" : families ? "six architectural families (kit 2.1.0)" : `${ids.length} stable module IDs`;
  const zoom = near ? 47 : prototype ? 49 : families ? 40 : 24;
  // Grid sheets use a higher three-quarter view so rows separate on screen and each label sits in front of its own plinth.
  const cameraPosition: [number, number, number] = mode === "families" || mode === "all" ? [7, 24, 21] : [10, 17, 24];
  return <section data-module-sheet={mode} data-module-count={ids.length} style={{ height: "100%", minHeight: 600, position: "relative", background: "#0B111B" }} aria-label="Synthetic architectural module comparison">
    <div style={{ position: "absolute", zIndex: 10, left: 24, top: 20, color: "#EEF3FA" }}>
      <h2 style={{ margin: 0 }}>Architectural kit · {title}</h2>
      <p>Synthetic module sheet. Same world scale, light and medium detail. Architecture is not a security claim{families ? "; a family's shape does not mean the asset is discovered, monitored or protected" : ""}.</p>
      <button onClick={() => setRoofs(!roofs)} aria-pressed={roofs}>{roofs ? "Hide roofs" : "Show roofs"}</button>
    </div>
    <Canvas shadows frameloop="demand" dpr={1.5} orthographic camera={{ position: cameraPosition, zoom, near: 0.1, far: 150 }} onCreated={({ gl }) => { gl.toneMapping = THREE.NeutralToneMapping; gl.toneMappingExposure = 1.05; }}>
      <color attach="background" args={["#0B111B"]} />
      <hemisphereLight args={["#E7EFF9", "#4D453A", 1.65]} />
      <directionalLight position={[-12, 20, 14]} intensity={3.1} color="#FFF1DA" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={20} shadow-camera-bottom={-20} shadow-normalBias={0.04} />
      <directionalLight position={[12, 9, -10]} intensity={1.1} color="#AAC9EF" />
      <OrbitControls target={[0, 1.8, 0]} enableDamping={false} minPolarAngle={0.4} maxPolarAngle={1.1} />
      {ids.map((id, i) => {
        const [x, z] = sheetCell(i, ids.length, mode);
        return <group key={id} position={[x, 0, z]}>
          <mesh position={[0, -0.15, 0]} receiveShadow><boxGeometry args={[5.2, 0.3, 5.4]} /><meshStandardMaterial color="#293645" roughness={1} /></mesh>
          <CastleModule id={id} roofs={roofs} />
          <Html position={[0, 0.2, 2.65]} center><div data-sheet-module={id} style={{ whiteSpace: "nowrap", background: "#121C29", padding: "6px 10px", border: "1px solid #70849B", color: "#EEF3FA", borderRadius: 6, fontSize: 12 }}>{id} · {moduleGeometry(id).triangles} triangles</div></Html>
        </group>;
      })}
    </Canvas>
  </section>;
}
