import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls, OrthographicCamera } from "@react-three/drei";
import * as THREE from "three";
import type { CompiledScene, OutcomeState, SceneRoom } from "@dk/contracts";
import { CastleModule } from "./modules.tsx";
import { Environment } from "./Environment.tsx";
import { hatchTexture } from "./materials.ts";
import { useApp } from "../lib/state.tsx";
import { EVENT_OUTCOME_COLOR, LAYER_STYLE, OUTCOME_STYLE, RELATIONSHIP_LAYER } from "../lib/vocab.ts";

class CanvasBoundary extends Component<{ onError: (msg: string) => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(e: Error) { this.props.onError(e.message || "3D renderer failed"); }
  override render() { return this.state.failed ? null : this.props.children; }
}

export function Castle3D() {
  const { ui, dispatch, vm } = useApp();
  const scene = vm.data.scene;
  const hc = scene.style_profile === "high-contrast-v1";
  return (
    <div className="castle-wrap" role="img" aria-label={`Isometric castle map of ${vm.data.graph.assets.length} assets. Use the asset list or the 2D graph for a fully keyboard-accessible view.`}>
      <CanvasBoundary onError={(msg) => dispatch({ type: "webglFailed", reason: msg })}>
        <Canvas
          shadows
          dpr={[1, 1.75]}
          frameloop={ui.reducedMotion && !ui.playing ? "demand" : "always"}
          gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.05;
            gl.domElement.addEventListener("webglcontextlost", (e) => {
              e.preventDefault();
              // R3F deliberately drops the context when the canvas unmounts (switching views); only a loss
              // while the canvas is still on screen is a real failure.
              setTimeout(() => { if (gl.domElement.isConnected) dispatch({ type: "webglFailed", reason: "The graphics context was lost. Showing the 2D graph instead." }); }, 0);
            });
          }}
          onPointerMissed={() => dispatch({ type: "select", selection: null })}
        >
          <color attach="background" args={[hc ? "#0e1116" : "#151b22"]} />
          <fog attach="fog" args={[hc ? "#0e1116" : "#151b22", 120, 260]} />
          <Rig scene={scene} />
          <Lights scene={scene} />
          <Suspense fallback={null}>
            <Environment scene={scene} highContrast={hc} />
            {scene.rooms.map((r) => <Room key={r.asset_id} room={r} highContrast={hc} />)}
            <Paths scene={scene} />
          </Suspense>
        </Canvas>
      </CanvasBoundary>
    </div>
  );
}

function Rig({ scene }: { scene: CompiledScene }) {
  const { size } = useThree();
  const cx = (scene.bounds.minX + scene.bounds.maxX) / 2, cz = (scene.bounds.minZ + scene.bounds.maxZ) / 2;
  const spanX = scene.bounds.maxX - scene.bounds.minX + 10, spanZ = scene.bounds.maxZ - scene.bounds.minZ + 10;
  // isometric projection footprint of the bounds
  const projW = (spanX + spanZ) * Math.SQRT1_2, projH = (spanX + spanZ) * Math.SQRT1_2 * 0.62 + 8;
  const zoom = Math.max(4, Math.min(size.width / projW, size.height / projH) * 1.3);
  const ctl = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const { ui } = useApp();
  useEffect(() => { ctl.current?.target.set(cx, 0, cz); ctl.current?.update(); }, [cx, cz]);
  // keyboard: "0" resets the view
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "0" && !(e.target instanceof HTMLInputElement)) ctl.current?.reset(); };
    addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <OrthographicCamera makeDefault position={[cx + 60, 62, cz + 60]} zoom={zoom} near={-200} far={600} />
      <OrbitControls ref={ctl} target={[cx, 0, cz]} enableDamping={!ui.reducedMotion} dampingFactor={0.12} minPolarAngle={0.35} maxPolarAngle={1.25} minZoom={zoom * 0.5} maxZoom={zoom * 5} screenSpacePanning makeDefault />
    </>
  );
}

function Lights({ scene }: { scene: CompiledScene }) {
  const cx = (scene.bounds.minX + scene.bounds.maxX) / 2, cz = (scene.bounds.minZ + scene.bounds.maxZ) / 2;
  const span = Math.max(scene.bounds.maxX - scene.bounds.minX, scene.bounds.maxZ - scene.bounds.minZ) / 2 + 12;
  const light = useRef<THREE.DirectionalLight>(null);
  useEffect(() => { if (light.current) { light.current.target.position.set(cx, 0, cz); light.current.target.updateMatrixWorld(); } }, [cx, cz]);
  return (
    <>
      <hemisphereLight args={["#d9e3f0", "#2b2f26", 0.75]} />
      <ambientLight intensity={0.18} />
      <directionalLight ref={light} position={[cx - 30, 55, cz + 25]} intensity={2.1} color="#fff1db" castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-span} shadow-camera-right={span} shadow-camera-top={span} shadow-camera-bottom={-span} shadow-camera-near={1} shadow-camera-far={160} />
      <directionalLight position={[cx + 40, 30, cz - 30]} intensity={0.35} color="#9fb6d9" />
    </>
  );
}

function Room({ room, highContrast }: { room: SceneRoom; highContrast: boolean }) {
  const { ui, dispatch, vm } = useApp();
  const asset = vm.data.graph.assets.find((a) => a.id === room.asset_id)!;
  const status = vm.assetStatus.get(room.asset_id);
  const selected = (ui.selection?.kind === "asset" && ui.selection.id === room.asset_id) ||
    (ui.selection?.kind === "finding" && vm.findings.find((f) => f.id === ui.selection!.id)?.affected_asset_ids.includes(room.asset_id));
  const hovered = ui.hover === room.asset_id;
  const q = ui.query.trim().toLowerCase();
  const dim = q.length > 1 && !(asset.name.toLowerCase().includes(q) || asset.id.toLowerCase().includes(q) || (asset.owner ?? "").toLowerCase().includes(q));
  const select = () => dispatch({ type: "select", selection: { kind: "asset", id: room.asset_id }, announce: `Selected ${asset.name}` });
  const ringR = Math.max(room.footprint.w, room.footprint.d) * 0.68;
  return (
    <group position={[room.position.x, 0, room.position.z]} userData={{ asset_id: room.asset_id, node_id: room.node_id }}>
      <group rotation={[0, (room.rotation_y * Math.PI) / 180, 0]}>
        <CastleModule id={room.module_id} roofs={ui.roofs} highContrast={highContrast} />
      </group>
      {/* selectable proxy that matches the displayed footprint */}
      <mesh
        position={[0, room.height / 2, 0]}
        userData={{ asset_id: room.asset_id }}
        onClick={(e) => { e.stopPropagation(); select(); }}
        onPointerOver={(e) => { e.stopPropagation(); dispatch({ type: "hover", id: room.asset_id }); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { dispatch({ type: "hover", id: null }); document.body.style.cursor = ""; }}
      >
        <boxGeometry args={[room.footprint.w, room.height + 0.6, room.footprint.d]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {(selected || hovered) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[ringR, ringR + (selected ? 0.22 : 0.12), 48]} />
          <meshBasicMaterial color={selected ? "#f3e2b5" : "#c9d3e0"} transparent opacity={selected ? 0.95 : 0.6} />
        </mesh>
      )}
      {status && status.coverage !== "reporting" && <CoverageHatch room={room} kind={status.coverage} />}
      {status?.worst && <Marker state={status.worst} y={room.height + 1.2} count={status.findingIds.length} />}
      {status && status.recentEventIds.length > 0 && !ui.reducedMotion && <Pulse room={room} eventIds={status.recentEventIds} />}
      <Html position={[0, room.label_anchor.y + (status?.worst ? 1.2 : 0.2), 0]} center zIndexRange={[20, 10]} style={{ opacity: dim ? 0.25 : 1 }}>
        <button className={`room-label${selected ? " is-selected" : ""}`} onClick={select} aria-label={`${asset.name}, ${status?.worst ? OUTCOME_STYLE[status.worst].label : "no open findings"}${status?.coverage !== "reporting" ? ", coverage gap" : ""}`}>
          {status?.worst && <span className="glyph" style={{ color: OUTCOME_STYLE[status.worst].color }} aria-hidden>{OUTCOME_STYLE[status.worst].glyph}</span>}
          <span className="name">{asset.name}</span>
          {status?.coverage !== "reporting" && <span className="gap" title={status?.coverageNote ?? "No telemetry"} aria-hidden>?</span>}
        </button>
      </Html>
    </group>
  );
}

function CoverageHatch({ room, kind }: { room: SceneRoom; kind: "gap" | "unobserved" }) {
  const tex = useMemo(() => { const t = hatchTexture().clone(); t.repeat.set(room.footprint.w / 1.2, room.footprint.d / 1.2); t.needsUpdate = true; return t; }, [room.footprint.w, room.footprint.d]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
      <planeGeometry args={[room.footprint.w + 1.2, room.footprint.d + 1.2]} />
      <meshBasicMaterial map={tex} color={kind === "gap" ? "#f0b45b" : "#aab2bf"} transparent opacity={kind === "gap" ? 0.75 : 0.45} depthWrite={false} />
    </mesh>
  );
}

const markerGeo: Record<OutcomeState, () => THREE.BufferGeometry> = {
  blocked: () => new THREE.CylinderGeometry(0.42, 0.18, 0.55, 6),
  attempted: () => new THREE.OctahedronGeometry(0.42),
  allowed: () => new THREE.SphereGeometry(0.3, 16, 12),
  refused: () => new THREE.BoxGeometry(0.5, 0.5, 0.5),
  needs_review: () => new THREE.ConeGeometry(0.45, 0.7, 3),
  observed_effect: () => new THREE.TorusGeometry(0.38, 0.12, 10, 28),
  unknown: () => new THREE.DodecahedronGeometry(0.36),
};

function Marker({ state, y, count }: { state: OutcomeState; y: number; count: number }) {
  const ref = useRef<THREE.Group>(null);
  const { ui } = useApp();
  const geo = useMemo(() => markerGeo[state](), [state]);
  useFrame((s) => { if (ref.current && !ui.reducedMotion) { ref.current.position.y = y + Math.sin(s.clock.elapsedTime * 1.6) * 0.12; ref.current.rotation.y += 0.01; } });
  const color = OUTCOME_STYLE[state].color;
  return (
    <group ref={ref} position={[0, y, 0]}>
      <mesh geometry={geo} castShadow>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.55} roughness={0.4} />
      </mesh>
      {count > 1 && (
        <Html position={[0.55, 0.35, 0]} center zIndexRange={[25, 15]} style={{ pointerEvents: "none" }}>
          <span className="marker-count">{count}</span>
        </Html>
      )}
    </group>
  );
}

function Pulse({ room, eventIds }: { room: SceneRoom; eventIds: string[] }) {
  const { vm } = useApp();
  const ref = useRef<THREE.Mesh>(null);
  const last = vm.events.find((e) => e.id === eventIds[eventIds.length - 1]);
  const color = last ? EVENT_OUTCOME_COLOR[last.outcome] : "#ffffff";
  useFrame((s) => {
    if (!ref.current) return;
    const t = (s.clock.elapsedTime % 1.6) / 1.6;
    ref.current.scale.setScalar(1 + t * 1.6);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t);
  });
  const r = Math.max(room.footprint.w, room.footprint.d) * 0.55;
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} userData={{ event_ids: eventIds }}>
      <ringGeometry args={[r, r + 0.18, 40]} />
      <meshBasicMaterial color={color} transparent opacity={0.6} depthWrite={false} />
    </mesh>
  );
}

function Paths({ scene }: { scene: CompiledScene }) {
  const { ui, dispatch } = useApp();
  const sel = ui.selection;
  return (
    <group>
      {scene.paths.map((p) => {
        const layer = RELATIONSHIP_LAYER[p.kind] ?? "runtime";
        const hypothetical = p.evidence_level === "hypothetical" || p.evidence_level === "inferred";
        const touchesSel = sel?.kind === "asset" && (p.source_asset_id === sel.id || p.target_asset_id === sel.id);
        const isSel = sel?.kind === "path" && sel.id === p.relationship_id;
        if (!(touchesSel || isSel) && (!ui.layers[layer] || (hypothetical && !ui.showHypothetical && p.evidence_level === "hypothetical"))) return null;
        const pts = curvePoints(p.points);
        const emphasis = touchesSel || isSel;
        return (
          <Line
            key={p.relationship_id}
            points={pts}
            color={LAYER_STYLE[layer].color}
            lineWidth={emphasis ? 3.2 : 1.6}
            transparent
            opacity={emphasis ? 1 : sel ? 0.25 : 0.7}
            dashed={hypothetical}
            dashSize={0.45}
            gapSize={0.3}
            onClick={(e) => { e.stopPropagation(); dispatch({ type: "select", selection: { kind: "path", id: p.relationship_id } }); }}
          />
        );
      })}
    </group>
  );
}

const curveCache = new Map<string, THREE.Vector3[]>();
function curvePoints(points: { x: number; y: number; z: number }[]): THREE.Vector3[] {
  const key = points.map((p) => `${p.x},${p.y},${p.z}`).join("|");
  let c = curveCache.get(key);
  if (!c) {
    c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, p.y, p.z)), false, "centripetal").getPoints(28);
    curveCache.set(key, c);
  }
  return c;
}
