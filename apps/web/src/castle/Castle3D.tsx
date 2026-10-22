import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls, OrthographicCamera } from "@react-three/drei";
import * as THREE from "three";
import type { CompiledScene, OutcomeState, SceneRoom } from "@dk/contracts";
import { CastleModule } from "./modules.tsx";
import { Environment } from "./Environment.tsx";
import { aoTexture, glowTexture, hatchTexture } from "./materials.ts";
import { FORCE, LabelLayer, useLabel } from "./labels.tsx";
import { useApp } from "../lib/state.tsx";
import { EVENT_OUTCOME_COLOR, LAYER_STYLE, OUTCOME_STYLE, RELATIONSHIP_LAYER } from "../lib/vocab.ts";
import { GapIcon, Icon, StateIcon } from "../lib/icons.tsx";

const BG = "#0b0d10";
const ACCENT = "#7c85ff";
const CAM_DIST = 110;
const CAM_AZIMUTH = Math.PI / 4;
const CAM_POLAR = 0.96;
/** Outcomes that light a building (windows + ground halo). Others are shown by marker and label only. */
const ACTIVE: OutcomeState[] = ["observed_effect", "needs_review", "attempted"];
/** Buildings are drawn larger than their compiled footprint so assets read before walls. Stays inside slot spacing. */
const MODULE_SCALE = 1.3;
const RANK: Record<OutcomeState, number> = { observed_effect: 7, needs_review: 6, attempted: 5, unknown: 4, blocked: 3, refused: 2, allowed: 1 };

type CamCmd = "in" | "out" | "reset";
const camEvent = (cmd: CamCmd) => dispatchEvent(new CustomEvent<CamCmd>("dk:camera", { detail: cmd }));

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
          shadows="soft"
          dpr={[1, 1.75]}
          frameloop={ui.reducedMotion && !ui.playing ? "demand" : "always"}
          gl={{ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.NeutralToneMapping;
            gl.toneMappingExposure = 1.12;
            gl.domElement.addEventListener("webglcontextlost", (e) => {
              e.preventDefault();
              // R3F deliberately drops the context when the canvas unmounts (switching views); only a loss
              // while the canvas is still on screen is a real failure.
              setTimeout(() => { if (gl.domElement.isConnected) dispatch({ type: "webglFailed", reason: "The graphics context was lost. Showing the 2D graph instead." }); }, 0);
            });
          }}
          onPointerMissed={() => dispatch({ type: "select", selection: null })}
        >
          <color attach="background" args={[hc ? "#0e1116" : BG]} />
          <fog attach="fog" args={[hc ? "#0e1116" : BG, CAM_DIST + 6, CAM_DIST + 95]} />
          <Rig scene={scene} />
          <Lights scene={scene} />
          <Invalidator />
          <LabelLayer>
            <Suspense fallback={null}>
              <Environment scene={scene} highContrast={hc} />
              {scene.rooms.map((r) => <Room key={r.asset_id} room={r} highContrast={hc} />)}
              <Paths scene={scene} />
            </Suspense>
          </LabelLayer>
        </Canvas>
      </CanvasBoundary>
      <div className="stage-tools" role="toolbar" aria-label="Castle view">
        <button className="icon-btn sm" onClick={() => camEvent("in")} aria-label="Zoom in" title="Zoom in"><Icon name="plus" size={15} /></button>
        <button className="icon-btn sm" onClick={() => camEvent("out")} aria-label="Zoom out" title="Zoom out"><Icon name="minus" size={15} /></button>
        <button className="icon-btn sm" onClick={() => camEvent("reset")} aria-label="Reset view" title="Reset view  (0)"><Icon name="fit" size={15} /></button>
        <div className="vr-h" />
        <button className={`icon-btn sm${ui.roofs ? " on" : ""}`} aria-pressed={ui.roofs} onClick={() => dispatch({ type: "roofs", roofs: !ui.roofs })} aria-label="Show roofs" title="Roofs  (R)"><Icon name="roof" size={15} /></button>
      </div>
    </div>
  );
}

/** In on-demand mode (reduced motion) DOM-only state changes still need a frame for labels/highlights. */
function Invalidator() {
  const { ui, vm } = useApp();
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => { invalidate(); }, [invalidate, ui.selection, ui.hover, ui.query, ui.roofs, ui.layers, vm]);
  return null;
}

function Rig({ scene }: { scene: CompiledScene }) {
  const { size, camera } = useThree();
  const { ui } = useApp();
  const ctl = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const b = scene.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const dir = useMemo(() => new THREE.Vector3().setFromSphericalCoords(1, CAM_POLAR, CAM_AZIMUTH), []);
  // fit: project the scene's bounding box onto the camera's screen axes
  const fitZoom = useMemo(() => {
    const fwd = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const x of [b.minX - 2, b.maxX + 2]) for (const z of [b.minZ - 2, b.maxZ + 2]) for (const y of [0, 4]) {
      const p = new THREE.Vector3(x - cx, y, z - cz);
      const px = p.dot(right), py = p.dot(up);
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    return Math.max(3, Math.min(size.width / (x1 - x0), size.height / (y1 - y0)) * 1.0);
  }, [b, cx, cz, dir, size.width, size.height]);
  const home = useMemo(() => ({ pos: new THREE.Vector3(cx, 0, cz).addScaledVector(dir, CAM_DIST), target: new THREE.Vector3(cx, 0.6, cz) }), [cx, cz, dir]);
  const tween = useRef<{ t: number; from: { pos: THREE.Vector3; target: THREE.Vector3; zoom: number }; to: { pos: THREE.Vector3; target: THREE.Vector3; zoom: number } } | null>(null);

  // initial framing + refit on resize
  useEffect(() => {
    const c = ctl.current; if (!c) return;
    const cam = camera as THREE.OrthographicCamera;
    cam.position.copy(home.pos); cam.zoom = fitZoom; cam.updateProjectionMatrix();
    c.target.copy(home.target); c.update(); c.saveState();
  }, [home, fitZoom, camera]);

  useEffect(() => {
    const go = (cmd: CamCmd) => {
      const c = ctl.current; if (!c) return;
      const cam = camera as THREE.OrthographicCamera;
      const from = { pos: cam.position.clone(), target: c.target.clone(), zoom: cam.zoom };
      const to = cmd === "reset" ? { pos: home.pos.clone(), target: home.target.clone(), zoom: fitZoom }
        : { pos: from.pos.clone(), target: from.target.clone(), zoom: THREE.MathUtils.clamp(cam.zoom * (cmd === "in" ? 1.3 : 1 / 1.3), fitZoom * 0.6, fitZoom * 4) };
      if (ui.reducedMotion) { cam.position.copy(to.pos); c.target.copy(to.target); cam.zoom = to.zoom; cam.updateProjectionMatrix(); c.update(); return; }
      tween.current = { t: 0, from, to };
      c.update();
    };
    const onCam = (e: Event) => go((e as CustomEvent<CamCmd>).detail);
    const onKey = (e: KeyboardEvent) => { if (e.key === "0" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) go("reset"); };
    addEventListener("dk:camera", onCam); addEventListener("keydown", onKey);
    return () => { removeEventListener("dk:camera", onCam); removeEventListener("keydown", onKey); };
  }, [camera, home, fitZoom, ui.reducedMotion]);

  useFrame((state, dt) => {
    const tw = tween.current; const c = ctl.current;
    if (!tw || !c) return;
    tw.t = Math.min(1, tw.t + dt / 0.45);
    const k = 1 - Math.pow(1 - tw.t, 3);
    const cam = camera as THREE.OrthographicCamera;
    cam.position.lerpVectors(tw.from.pos, tw.to.pos, k);
    c.target.lerpVectors(tw.from.target, tw.to.target, k);
    cam.zoom = THREE.MathUtils.lerp(tw.from.zoom, tw.to.zoom, k); cam.updateProjectionMatrix();
    c.update();
    if (tw.t >= 1) tween.current = null;
    state.invalidate();
  });

  // keep panning inside the castle's footprint
  const clampTarget = () => {
    const c = ctl.current; if (!c) return;
    const t = c.target; const cam = camera;
    const nx = THREE.MathUtils.clamp(t.x, b.minX, b.maxX), nz = THREE.MathUtils.clamp(t.z, b.minZ, b.maxZ), ny = THREE.MathUtils.clamp(t.y, -2, 6);
    if (nx !== t.x || nz !== t.z || ny !== t.y) { const d = new THREE.Vector3(nx - t.x, ny - t.y, nz - t.z); t.add(d); cam.position.add(d); }
  };

  return (
    <>
      <OrthographicCamera makeDefault position={home.pos.toArray()} zoom={fitZoom} near={-300} far={800} />
      <OrbitControls ref={ctl} target={home.target.toArray()} enableDamping={!ui.reducedMotion} dampingFactor={0.09} rotateSpeed={0.6} zoomSpeed={0.8}
        minPolarAngle={0.5} maxPolarAngle={1.18} minAzimuthAngle={CAM_AZIMUTH - 1.2} maxAzimuthAngle={CAM_AZIMUTH + 1.2}
        minZoom={fitZoom * 0.6} maxZoom={fitZoom * 4} screenSpacePanning makeDefault onChange={clampTarget} />
    </>
  );
}

function Lights({ scene }: { scene: CompiledScene }) {
  const cx = (scene.bounds.minX + scene.bounds.maxX) / 2, cz = (scene.bounds.minZ + scene.bounds.maxZ) / 2;
  const span = Math.max(scene.bounds.maxX - scene.bounds.minX, scene.bounds.maxZ - scene.bounds.minZ) / 2 + 10;
  const key = useRef<THREE.DirectionalLight>(null);
  const rim = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    for (const l of [key.current, rim.current]) if (l) { l.target.position.set(cx, 0, cz); l.target.updateMatrixWorld(); }
  }, [cx, cz]);
  return (
    <>
      {/* soft sky fill, warm bounce from the ground */}
      <hemisphereLight args={["#e3e9f2", "#2c2824", 1.25]} />
      <ambientLight intensity={0.12} />
      {/* key: high, front-left, warm white, soft shadows */}
      <directionalLight ref={key} position={[cx - 34, 62, cz + 30]} intensity={2.5} color="#fff3e2" castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.00035} shadow-normalBias={0.03} shadow-radius={4}
        shadow-camera-left={-span} shadow-camera-right={span} shadow-camera-top={span} shadow-camera-bottom={-span} shadow-camera-near={1} shadow-camera-far={200} />
      {/* rim: low from behind, cool, separates silhouettes from the ground */}
      <directionalLight ref={rim} position={[cx - 30, 22, cz - 60]} intensity={0.9} color="#a9c0e4" />
      {/* faint fill from the camera side so front faces never go black */}
      <directionalLight position={[cx + 60, 30, cz + 50]} intensity={0.35} color="#c9d4e6" />
    </>
  );
}

function Room({ room, highContrast }: { room: SceneRoom; highContrast: boolean }) {
  const { ui, dispatch, vm } = useApp();
  const asset = vm.data.graph.assets.find((a) => a.id === room.asset_id)!;
  const status = vm.assetStatus.get(room.asset_id);
  const selected = (ui.selection?.kind === "asset" && ui.selection.id === room.asset_id) ||
    (ui.selection?.kind === "finding" && !!vm.findings.find((f) => f.id === ui.selection!.id)?.affected_asset_ids.includes(room.asset_id)) ||
    (ui.selection?.kind === "event" && !!vm.data.events.find((e) => e.id === ui.selection!.id)?.asset_ids.includes(room.asset_id));
  const hovered = ui.hover === room.asset_id;
  const q = ui.query.trim().toLowerCase();
  const dim = q.length > 1 && !(asset.name.toLowerCase().includes(q) || asset.id.toLowerCase().includes(q) || (asset.owner ?? "").toLowerCase().includes(q));
  const select = () => dispatch({ type: "select", selection: { kind: "asset", id: room.asset_id }, announce: `Selected ${asset.name}` });
  const worst = status?.worst ?? null;
  const active = !!worst && ACTIVE.includes(worst);
  const gap = !!status && status.coverage !== "reporting";
  const S = MODULE_SCALE;
  const fw = room.footprint.w * S, fd = room.footprint.d * S, fh = room.height * S;
  const r = Math.max(fw, fd);
  const labelY = room.label_anchor.y * S + (worst ? 1.1 : 0.2);
  const priority = selected ? FORCE + 100 : hovered ? FORCE : dim ? -1000 : (worst ? RANK[worst] * 10 : 0) + (status?.findingIds.length ?? 0) + (gap ? 15 : 0) + room.height;
  const labelRef = useLabel(`room:${room.asset_id}`, [room.position.x, labelY, room.position.z], priority, -6);
  const count = status?.findingIds.length ?? 0;
  return (
    <group position={[room.position.x, 0, room.position.z]} userData={{ asset_id: room.asset_id, node_id: room.node_id }}>
      {/* contact shadow: cheap ambient occlusion that grounds every building */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]} renderOrder={1}>
        <planeGeometry args={[fw * 1.8, fd * 1.8]} />
        <meshBasicMaterial map={aoTexture()} transparent opacity={0.85} depthWrite={false} />
      </mesh>
      <group rotation={[0, (room.rotation_y * Math.PI) / 180, 0]} scale={S}>
        <CastleModule id={room.module_id} roofs={ui.roofs} highContrast={highContrast} windowColor={active ? OUTCOME_STYLE[worst!].color : null} />
      </group>
      {/* selectable proxy that matches the displayed footprint */}
      <mesh
        position={[0, fh / 2, 0]}
        userData={{ asset_id: room.asset_id }}
        onClick={(e) => { e.stopPropagation(); select(); }}
        onPointerOver={(e) => { e.stopPropagation(); dispatch({ type: "hover", id: room.asset_id }); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { dispatch({ type: "hover", id: null }); document.body.style.cursor = ""; }}
      >
        <boxGeometry args={[fw, fh + 0.6, fd]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {active && <Halo color={OUTCOME_STYLE[worst!].color} size={r * 2.4} />}
      {selected && <SelectionRing r={r * 0.72} />}
      {hovered && !selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.09, 0]} renderOrder={3}>
          <ringGeometry args={[r * 0.72, r * 0.72 + 0.09, 64]} />
          <meshBasicMaterial color="#d7dce4" transparent opacity={0.55} depthWrite={false} />
        </mesh>
      )}
      {gap && <CoverageHatch w={fw + 1.2} d={fd + 1.2} kind={status!.coverage as "gap" | "unobserved"} />}
      {worst && <Marker state={worst} y={fh + 0.9} />}
      {status && status.recentEventIds.length > 0 && !ui.reducedMotion && <Pulse r={r * 0.6} eventIds={status.recentEventIds} />}
      <Html position={[0, labelY, 0]} center zIndexRange={[20, 10]}>
        <div ref={labelRef} className="lbl">
          <button className={`room-label${selected ? " is-selected" : ""}${dim ? " dim" : ""}`} onClick={select}
            onPointerEnter={() => dispatch({ type: "hover", id: room.asset_id })} onPointerLeave={() => dispatch({ type: "hover", id: null })}
            aria-label={`${asset.name}, ${worst ? OUTCOME_STYLE[worst].label : "no open findings"}${gap ? ", coverage gap" : ""}`}>
            {worst && <StateIcon state={worst} size={11} />}
            <span className="name">{asset.name}</span>
            {count > 1 && <span className="n">{count}</span>}
            {gap && <span title={status?.coverageNote ?? "No telemetry"} style={{ display: "inline-flex" }}><GapIcon size={11} /></span>}
          </button>
        </div>
      </Html>
    </group>
  );
}

function SelectionRing({ r }: { r: number }) {
  return (
    <group position={[0, 0.095, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh renderOrder={4}>
        <ringGeometry args={[r, r + 0.16, 72]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={1} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh renderOrder={3}>
        <planeGeometry args={[r * 2.9, r * 2.9]} />
        <meshBasicMaterial map={glowTexture()} color={ACCENT} transparent opacity={0.7} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Halo({ color, size }: { color: string; size: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.085, 0]} renderOrder={2}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={glowTexture()} color={color} transparent opacity={0.45} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

function CoverageHatch({ w, d, kind }: { w: number; d: number; kind: "gap" | "unobserved" }) {
  const tex = useMemo(() => { const t = hatchTexture().clone(); t.repeat.set(w / 1.1, d / 1.1); t.needsUpdate = true; return t; }, [w, d]);
  const edge = useMemo(() => [[-w / 2, 0, -d / 2], [w / 2, 0, -d / 2], [w / 2, 0, d / 2], [-w / 2, 0, d / 2], [-w / 2, 0, -d / 2]] as [number, number, number][], [w, d]);
  const color = kind === "gap" ? "#e2b84f" : "#9aa3af";
  return (
    <group position={[0, 0.08, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial map={tex} color={color} transparent opacity={kind === "gap" ? 0.5 : 0.32} depthWrite={false} />
      </mesh>
      <Line points={edge} color={color} lineWidth={1.2} dashed dashSize={0.3} gapSize={0.2} transparent opacity={0.8} />
    </group>
  );
}

const markerGeo: Record<OutcomeState, () => THREE.BufferGeometry> = {
  blocked: () => new THREE.CylinderGeometry(0.36, 0.14, 0.46, 6),
  attempted: () => new THREE.OctahedronGeometry(0.34),
  allowed: () => new THREE.SphereGeometry(0.26, 20, 14),
  refused: () => new THREE.BoxGeometry(0.42, 0.42, 0.42),
  needs_review: () => new THREE.ConeGeometry(0.36, 0.58, 3),
  observed_effect: () => new THREE.TorusGeometry(0.3, 0.1, 12, 32),
  unknown: () => new THREE.DodecahedronGeometry(0.3),
};

function Marker({ state, y }: { state: OutcomeState; y: number }) {
  const ref = useRef<THREE.Group>(null);
  const { ui } = useApp();
  const geo = useMemo(() => markerGeo[state](), [state]);
  useFrame((s) => { if (ref.current && !ui.reducedMotion) { ref.current.position.y = y + Math.sin(s.clock.elapsedTime * 1.2) * 0.07; ref.current.rotation.y += 0.006; } });
  const color = OUTCOME_STYLE[state].color;
  const active = ACTIVE.includes(state);
  return (
    <group ref={ref} position={[0, y, 0]}>
      <mesh geometry={geo} castShadow>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={active ? 0.55 : 0.2} roughness={0.45} />
      </mesh>
    </group>
  );
}

function Pulse({ r, eventIds }: { r: number; eventIds: string[] }) {
  const { vm } = useApp();
  const ref = useRef<THREE.Mesh>(null);
  const last = vm.events.find((e) => e.id === eventIds[eventIds.length - 1]);
  const color = last ? EVENT_OUTCOME_COLOR[last.outcome] : "#ffffff";
  useFrame((s) => {
    if (!ref.current) return;
    const t = (s.clock.elapsedTime % 2) / 2;
    ref.current.scale.setScalar(1 + t * 1.2);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - t) * (1 - t);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]} userData={{ event_ids: eventIds }} renderOrder={5}>
      <ringGeometry args={[r, r + 0.12, 56]} />
      <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function Paths({ scene }: { scene: CompiledScene }) {
  const { ui, dispatch, vm } = useApp();
  const sel = ui.selection;
  const focus = useMemo(() => {
    if (sel?.kind === "asset") return new Set([sel.id]);
    if (sel?.kind === "finding") return new Set(vm.findings.find((f) => f.id === sel.id)?.affected_asset_ids ?? []);
    return new Set<string>();
  }, [sel, vm.findings]);
  const anyFocus = focus.size > 0 || sel?.kind === "path";
  return (
    <group>
      {scene.paths.map((p) => {
        const layer = RELATIONSHIP_LAYER[p.kind] ?? "runtime";
        const hypothetical = p.evidence_level === "hypothetical" || p.evidence_level === "inferred";
        const touchesSel = focus.has(p.source_asset_id) || focus.has(p.target_asset_id);
        const isSel = sel?.kind === "path" && sel.id === p.relationship_id;
        if (!(touchesSel || isSel) && (!ui.layers[layer] || (hypothetical && !ui.showHypothetical && p.evidence_level === "hypothetical"))) return null;
        const pts = curvePoints(p.points);
        const emphasis = touchesSel || isSel;
        return (
          <Line
            key={p.relationship_id}
            points={pts}
            color={LAYER_STYLE[layer].color}
            lineWidth={isSel ? 3 : emphasis ? 2.2 : 1.3}
            transparent
            opacity={emphasis ? 0.95 : anyFocus ? 0.12 : 0.5}
            dashed={hypothetical}
            dashSize={0.4}
            gapSize={0.28}
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
    c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, p.y, p.z)), false, "centripetal").getPoints(32);
    curveCache.set(key, c);
  }
  return c;
}
