import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { pathVisible, relationshipMeaning, relationshipStyle } from "../lib/layers.ts";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { CompiledScene, SceneRoom } from "@dk/contracts";
import { CastleModule } from "./modules.tsx";
import { InteriorMarkers } from "./InteriorMarkers.tsx";
import { ComparisonBadges, ComparisonPanel, useNarrowLayout, useWorldComparison } from "./ComparisonOverlay.tsx";
import { Environment } from "./Environment.tsx";
import { hatchTexture } from "./materials.ts";
import { EdgeChooser, type EdgeChoice } from "./EdgeChooser.tsx";
import { overlappingEdges, pointerWasDrag, type ScreenPoint } from "./edgePicking.ts";
import { sampleFrameBudget, type FrameBudget } from "./frameBudget.ts";
import { FORCE, LabelLayer, useLabel } from "./labels.tsx";
import { useApp } from "../lib/state.tsx";
import { ASSET_COVERAGE_LABEL } from "../lib/presentation.ts";
import { LAYER_STYLE, OUTCOME_STYLE, RELATIONSHIP_LAYER, SEVERITY_RANK } from "../lib/vocab.ts";
import { Icon, StateIcon } from "../lib/icons.tsx";
import { groupSummary, presentationMembers, selectionDistrictKey, presentationGroups, presentationTopologyKey, groupMembershipKey, realmPresentation, presentationScene, environmentPackingMap, presentationCollisions, selectionAssets, selectionProxy, SEVERITY_COLOR, type PresentationGroup } from "./scenePresentation.ts";
import { cachedModuleGeometryCount, type DetailLevel } from "./geometry.ts";
import type { ModuleFailureCode } from "./moduleRecovery.ts";
import { watchRendererShaders } from "./shaderRecovery.ts";
import { semanticLevelForScale, type SemanticLevel } from "@dk/scene-compiler";
import { districtGroupKey, focusMembers, worldHierarchy } from "../lib/world.ts";
import { viewFraming } from "../lib/framing.ts";

const ACCENT = "#c3cbf5", CAM_DIST = 110;
type Command = { n: number; type: "in" | "out" | "fit" | "focus" | "back"; group?: string; ids?: string[] };
type Pose = { pos: THREE.Vector3; target: THREE.Vector3; zoom: number };
// Harmless camera-only context survives Castle/Graph toggles. Bounded; never contains evidence.
const cameraPoses = new Map<string, Pose>();
const districtPoses = new Map<string, string | null>();
// LP16: the last world focus each project's castle framed, so a remount (Graph -> Castle, WebGL recovery) restores the
// saved camera instead of re-running an old focus animation.
const handledFocus = new Map<string, string | null>();
const LABEL_BUDGET: Record<SemanticLevel, number> = { realm: 4, environment: 5, district: 8, structure: 12, interior: 12, evidence: 12 };
class CanvasBoundary extends Component<{ onError: (msg: string) => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(e: Error) { this.props.onError(e.message || "3D renderer failed"); }
  override render() { return this.state.failed ? null : this.props.children; }
}
export function Castle3D() {
  const { ui, dispatch, vm } = useApp();
  const topologyKey = presentationTopologyKey(vm.data.scene), membershipKey = groupMembershipKey(vm.data.graph);
  // next-C: display-only realm packing bounds the empty lawn between environments; the stored layout/digest are unchanged.
  const scene = useMemo(() => realmPresentation(vm.data.scene, vm.data.graph), [topologyKey, membershipKey]);
  const packX = useMemo(() => environmentPackingMap(presentationScene(vm.data.scene), vm.data.graph) ?? undefined, [topologyKey, membershipKey]);
  const collisions = useMemo(() => presentationCollisions(scene.rooms), [scene]);
  const wrap = useRef<HTMLDivElement>(null);
  const comparison = useWorldComparison(); const narrowLayout = useNarrowLayout();
  const [edgeChoice, setEdgeChoice] = useState<EdgeChoice | null>(null);
  useEffect(() => { setEdgeChoice(null); }, [ui.selection, ui.layers, ui.showHypothetical, topologyKey]);
  const groups = useMemo(() => presentationGroups(scene, vm.data.graph), [scene, membershipKey]);
  const [district, setDistrict] = useState<string | null>(() => districtPoses.get(scene.project_id) ?? null), [help, setHelp] = useState(false);
  const [quality, setQuality] = useState(ui.quality), [reduced, setReduced] = useState(false);
  const [cmd, setCmd] = useState<Command>({ n: 0, type: "fit" });
  const send = (type: Command["type"], group?: string, ids?: string[]) => setCmd(c => ({ n: c.n + 1, type, group, ids }));
  const [level, setLevel] = useState<SemanticLevel>("environment");
  const hierarchy = worldHierarchy(vm.data.graph, vm.data.scene);
  useEffect(() => { setQuality(ui.quality); setReduced(false); }, [ui.quality]);
  const latestDistrict = useRef(district); latestDistrict.current = district;
  useEffect(() => { setDistrict(districtPoses.get(scene.project_id) ?? null); return () => { districtPoses.set(scene.project_id, latestDistrict.current); if (districtPoses.size > 4) districtPoses.delete(districtPoses.keys().next().value!); }; }, [scene.project_id]);
  const grouped = scene.rooms.length > 50;
  const focus = useMemo(() => selectionAssets(ui.selection, vm), [ui.selection, vm.findings, vm.data, vm.latestData, vm.selectedEventAssets]);
  // Inspecting one member must keep the other explicitly focused endpoints reachable.
  const [focusedLabels, setFocusedLabels] = useState<ReadonlySet<string>>(focus);
  const membership = useMemo(() => presentationMembers(groups, district, focus), [groups, district, focus]);
  const districtRooms = membership.members;
  const visibleRooms = grouped ? membership.visible : scene.rooms;
  useEffect(() => { if (ui.focusRevision <= ui.focusHandledRevision) return;
    if (grouped) { const key = selectionDistrictKey(groups, focus); if (key) { setDistrict(key); setFocusedLabels(focus); } }
  }, [ui.focusRevision, ui.focusHandledRevision, grouped, groups, focus]);
  const visibleIds = useMemo(() => new Set(visibleRooms.map(r => r.asset_id)), [visibleRooms]);
  // LP16: a world focus chosen in the navigator, graph or castle frames the same stable hierarchy node here.
  useEffect(() => {
    if ((handledFocus.get(scene.project_id) ?? null) === (ui.focus ?? null)) return;
    handledFocus.set(scene.project_id, ui.focus ?? null);
    if (handledFocus.size > 4) handledFocus.delete(handledFocus.keys().next().value!);
    const target = focusMembers(hierarchy, ui.focus);
    if (!target) { if (!ui.focus) return; send("fit"); return; }
    const key = districtGroupKey(target.node.id);
    if (grouped) setDistrict(key ?? (target.node.kind === "structure" ? selectionDistrictKey(groups, target.assetIds) : null));
    if (target.node.kind === "realm") send("fit"); else send("focus", undefined, [...target.assetIds]);
  }, [ui.focus, hierarchy, grouped, groups, scene.project_id]);
  // next-C: in a mixed world the first frame is the active environment (explicit Realm overview in the toolbar).
  const framing = viewFraming(hierarchy, ui.focus, vm.assetStatus, scene.rooms.length);
  const initialRooms = useMemo(() => { if (!framing.implicit || !framing.id) return undefined; const ids = focusMembers(hierarchy, framing.id)?.assetIds; return ids ? scene.rooms.filter(r => ids.has(r.asset_id)) : undefined; }, [framing.implicit, framing.id, hierarchy, scene]);
  const archived = ui.showArchived ? scene.historical_rooms ?? [] : [];
  return <div ref={wrap} className="castle-wrap" data-semantic-level={level} data-framing={framing.id ?? "all"} data-framing-implicit={framing.implicit} role="region" tabIndex={0} aria-label={`Architectural map of ${scene.rooms.length} assets. Select a building to inspect it; Focus moves the camera. Graph and lists show the same evidence.`}
    onKeyDown={e => {
      if (!ui.shortcuts || e.target !== e.currentTarget || e.ctrlKey || e.metaKey || e.altKey) return;
      if (["+", "=", "-", "0", "f"].includes(e.key)) { e.preventDefault(); if (e.key === "f") dispatch({ type: "focus" }); else send(e.key === "0" ? "fit" : e.key === "-" ? "out" : "in"); }
    }}>
    <CanvasBoundary onError={msg => dispatch({ type: "webglFailed", reason: msg })}>
      <Canvas orthographic style={{ isolation: "isolate" }} shadows={quality !== "low" ? "soft" : false} dpr={quality === "low" ? 1 : quality === "high" ? [1, 2] : [1, 1.5]} frameloop="demand"
        camera={{ position: [60, 68, 60], zoom: 12, near: 0.1, far: 800 }}
        gl={{ antialias: quality !== "low", powerPreference: "default", preserveDrawingBuffer: false }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.AgXToneMapping; gl.toneMappingExposure = 1.02; gl.shadowMap.type = THREE.PCFSoftShadowMap; gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = true; }}
        onPointerMissed={e => { if (e.type === "click") dispatch({ type: "select", selection: null }); }}>
        <Sky />
        <Rig scene={scene} command={cmd} groups={groups} onLevel={setLevel} initialRooms={initialRooms} />
        <Lights scene={scene} quality={quality} />
        <SceneLifecycle quality={quality} onSlow={() => { if (quality !== "low") { setQuality(quality === "high" ? "medium" : "low"); setReduced(true); } }} />
        <LabelLayer budget={district ? 12 : LABEL_BUDGET[level]} reservedLeft={grouped ? 320 : 0}>
          <Suspense fallback={null}>
            <Environment scene={scene} groups={groups} quality={quality} highContrast={scene.style_profile === "high-contrast-v1"} />
            {visibleRooms.map(room => <Room key={room.asset_id} room={room} selected={focus.has(room.asset_id)} focused={grouped && !!district && focusedLabels.has(room.asset_id)} quality={quality} />)}
            {grouped && !district && groups.map(g => <District key={g.key} group={g} onFocus={() => { setDistrict(g.key); send("focus", g.key); }} />)}
            <Paths scene={scene} visibleIds={visibleIds} onChoice={setEdgeChoice} />
            {comparison.view && <ComparisonBadges view={comparison.view} mapX={packX} />}
            {archived.map(r => <ArchivedPlacement key={`${r.asset_id}:${r.incarnation_id ?? r.retired_in_revision}`} room={r} />)}
          </Suspense>
        </LabelLayer>
      </Canvas>
    </CanvasBoundary>
    {edgeChoice && <EdgeChooser choice={edgeChoice} paths={scene.paths} graph={vm.data.graph} width={wrap.current?.clientWidth ?? 800} height={wrap.current?.clientHeight ?? 600} onChoose={id => { dispatch({ type: "select", selection: { kind: "path", id } }); setEdgeChoice(null); }} onClose={() => setEdgeChoice(null)} />}
    {!narrowLayout && <ComparisonPanel view={comparison.view} error={comparison.error} id={comparison.id} />}
    <div className="stage-tools" style={{ zIndex: 30 }} role="toolbar" aria-label="Castle view">
      <button className="icon-btn sm" onClick={() => send("in")} aria-label="Zoom in" title="Zoom in  (+)"><Icon name="plus" size={15} /></button>
      <button className="icon-btn sm" onClick={() => send("out")} aria-label="Zoom out" title="Zoom out  (−)"><Icon name="minus" size={15} /></button>
      <button className="icon-btn sm" onClick={() => { setDistrict(null); send("fit"); }} aria-label="Fit all assets" title="Fit all assets  (0)"><Icon name="fit" size={15} /></button>
      <div className="vr-h" />
      <button onClick={() => dispatch({ type: "focus" })} disabled={!focus.size} title="Move the camera to the selection  (f)">Focus selection</button>
      <button className="icon-btn sm" onClick={() => send("back")} aria-label="Back to previous camera view" title="Back to previous view"><Icon name="reset" size={15} /></button>
      <div className="vr-h" />
      <button className={`icon-btn sm${ui.roofs ? " on" : ""}`} aria-pressed={ui.roofs} onClick={() => dispatch({ type: "roofs", roofs: !ui.roofs })} aria-label="Show roofs" title={ui.roofs ? "Hide roofs" : "Show roofs"}><Icon name="roof" size={15} /></button>
      <button className={`icon-btn sm${help ? " on" : ""}`} onClick={() => setHelp(!help)} aria-expanded={help} aria-label="View help" title="How to read and navigate the map"><Icon name="help" size={15} /></button>
      <span className="semantic-level" data-testid="semantic-level" title="Semantic zoom level: distant levels suppress label detail, never findings or unobserved resources">{level}</span>
    </div>
    {!!collisions.length && <div role="status" aria-live={ui.reduceAutomaticAnnouncements ? "off" : "polite"} style={panelStyle}>This stored layout has {collisions.length} overlapping module bounds with the upgraded kit. Positions are preserved; use Graph or request an explicit layout reflow.</div>}
    {help && <div className="scene-help" style={panelStyle}><strong>Architectural map</strong><p>Drag empty space to orbit. Right-drag to pan. Scroll to zoom. Click selects without moving the camera. Focus selection moves it; Back restores the previous view.</p><p>Terraces are organizational, not security boundaries. Marker border is finding severity; the glyph describes outcome. Hatching is current source coverage, not asset health.</p><button onClick={() => dispatch({ type: "view", view: "graph" })}>Use graph and list view</button></div>}
    {reduced && <div role="status" aria-live={ui.reduceAutomaticAnnouncements ? "off" : "polite"} style={{ ...panelStyle, top: "auto", bottom: 72 }}>Visual quality reduced for performance. Evidence and selection are unchanged.</div>}
    {grouped && <div className="scene-group-panel" style={{ ...panelStyle, maxWidth: 280 }}>
      <strong>{district ? membership.groups.length > 1 ? `Combined focus · ${membership.groups.length} districts` : `${membership.groups[0]?.label ?? "District"} members` : "District overview"}</strong>
      <p>{scene.rooms.length} logical assets. Groups are presentation only. {district ? `Showing ${visibleRooms.length} of ${districtRooms.length} buildings; selected assets are prioritized and all members remain accessible below.` : "Choose a district to expand its assets."}</p>
      {membership.selectedOverflow > 0 && <p role="status">Only 50 of {membership.selectedCount} selected assets can be rendered together. {membership.selectedOverflow} selected assets are not drawn; every member remains in the list below. Select an individual asset to inspect it.</p>}
      {!district ? groups.map(g => { const s = groupSummary(g, vm.assetStatus); return <button className="btn sm" style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 6, whiteSpace: "normal" }} key={g.key} onClick={() => { setDistrict(g.key); send("focus", g.key); }}><span><strong>{g.label}</strong> · {g.environment}<br />{g.rooms.length} assets · {s.findings} distinct findings<small style={{ display: "block", lineHeight: 1.5 }}>{Object.entries(s.coverage).map(([k,n]) => `${n} assets: ${ASSET_COVERAGE_LABEL[k as keyof typeof ASSET_COVERAGE_LABEL] ?? k}`).join(" · ")}</small></span></button>; }) : <>
        <button className="btn sm" onClick={() => { setDistrict(null); send("fit"); }}>Back to district overview</button>
        <ul>{districtRooms.map(r => <li key={r.asset_id}><button className="btn sm" onClick={() => { dispatch({ type: "select", selection: { kind: "asset", id: r.asset_id } }); }}>{vm.data.graph.assets.find(a => a.id === r.asset_id)?.name ?? r.asset_id}</button></li>)}</ul>
      </>}
    </div>}
  </div>;
}
const panelStyle = { position: "absolute", left: 16, top: 16, zIndex: 12, maxWidth: 330, maxHeight: "min(55%, 380px)", overflow: "auto", background: "#121C29", color: "#EEF3FA", border: "1px solid #70849B", borderRadius: 10, padding: 14, fontSize: 13 } as const;

function SceneLifecycle({ quality, onSlow }: { quality: DetailLevel; onSlow: () => void }) {
  const { ui, vm, dispatch } = useApp(), { gl, invalidate, setFrameloop } = useThree();
  const count = useRef(0), budget = useRef<FrameBudget>({ active: false, samples: 0, slow: 0 });
  const rendererLifetime = useRef(0);
  useLayoutEffect(() => watchRendererShaders(gl, () => dispatch({ type: "webglFailed", reason: "A scene shader failed to compile. Graph and records retain the same selection and evidence." })), [gl, dispatch]);
  useEffect(() => {
    const generation = ++rendererLifetime.current;
    // Let module cleanups release shared GPU registrations first. A StrictMode effect replay
    // immediately acquires the next generation and must not dispose its still-live renderer.
    return () => { queueMicrotask(() => { if (rendererLifetime.current === generation) gl.dispose(); }); };
  }, [gl]);
  useEffect(() => { gl.shadowMap.needsUpdate = true; invalidate(); }, [gl, invalidate, ui.roofs, quality, vm.data.scene, ui.selection, ui.hover, ui.query, ui.layers, ui.playhead]);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (e: Event) => { e.preventDefault(); setTimeout(() => { if (canvas.isConnected) dispatch({ type: "webglFailed", reason: "The graphics context was lost. Graph and records retain the same selection and evidence." }); }, 0); };
    const visibility = () => { setFrameloop(document.hidden ? "never" : "demand"); if (!document.hidden) invalidate(); };
    canvas.addEventListener("webglcontextlost", lost); document.addEventListener("visibilitychange", visibility);
    return () => { canvas.removeEventListener("webglcontextlost", lost); document.removeEventListener("visibilitychange", visibility); document.body.style.cursor = ""; };
  }, [gl, dispatch, invalidate, setFrameloop]);
  useFrame((_, dt) => {
    const c = gl.domElement; c.dataset.renderCount = String(++count.current); c.dataset.drawCalls = String(gl.info.render.calls); c.dataset.triangles = String(gl.info.render.triangles); c.dataset.quality = quality; c.dataset.moduleGeometryBuilds = String(cachedModuleGeometryCount()); c.dataset.gpuGeometries = String(gl.info.memory.geometries); c.dataset.gpuTextures = String(gl.info.memory.textures); c.dataset.gpuPrograms = String(gl.info.programs?.length ?? 0);
    // These counters describe the previous render. A restored, stationary camera may
    // need only one demand frame, so publish its completed render on one follow-up.
    if (count.current === 1) invalidate();
    const sampled = sampleFrameBudget(budget.current, dt, c.dataset.cameraActive === "true");
    budget.current = sampled.state; if (sampled.reduce) onSlow();
  });
  return null;
}
function Rig({ scene, command, groups, onLevel, initialRooms }: { scene: CompiledScene; command: Command; groups: PresentationGroup[]; onLevel: (level: SemanticLevel) => void; initialRooms?: SceneRoom[] }) {
  const lastLevel = useRef<SemanticLevel | null>(null);
  const { camera, size, invalidate, gl } = useThree(), { ui, vm, dispatch } = useApp();
  const ctl = useRef<React.ComponentRef<typeof OrbitControls>>(null), tween = useRef<{ t: number; from: Pose; to: Pose; focusRevision?: number } | null>(null);
  const focusInFlight = useRef(0);
  const history = useRef<Pose[]>([]), initialized = useRef(false), manual = useRef(false);
  const b = scene.bounds, key = `${scene.project_id}:${scene.graph_revision}`;
  const dir = useMemo(() => new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(52), Math.PI / 4), []);
  const fit = (rooms?: SceneRoom[], maxZoom = 140): Pose => {
    const xs = rooms?.length ? rooms.flatMap(r => [r.position.x - r.footprint.w / 2, r.position.x + r.footprint.w / 2]) : [b.minX, b.maxX];
    const zs = rooms?.length ? rooms.flatMap(r => [r.position.z - r.footprint.d / 2, r.position.z + r.footprint.d / 2]) : [b.minZ, b.maxZ];
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const maxY = Math.max(3, ...(rooms ?? scene.rooms).map(r => r.label_anchor.y + 0.7));
    const target = new THREE.Vector3((minX + maxX) / 2, maxY * 0.22, (minZ + maxZ) / 2);
    const right = new THREE.Vector3().crossVectors(dir.clone().negate(), new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(right, dir.clone().negate()).normalize();
    const px: number[] = [], py: number[] = [];
    // Project each ACTUAL module/label bound, not all empty corners of a huge district rectangle.
    const fittedRooms = rooms?.length ? rooms : scene.rooms;
    for (const r of fittedRooms) for (const x of [r.position.x - r.footprint.w / 2 - 0.25, r.position.x + r.footprint.w / 2 + 0.25]) for (const z of [r.position.z - r.footprint.d / 2 - 0.25, r.position.z + r.footprint.d / 2 + 0.25]) for (const y of [0, r.label_anchor.y + 0.25]) {
      const p = new THREE.Vector3(x, y, z).sub(target); px.push(p.dot(right)); py.push(p.dot(up));
    }
    if (!px.length) { px.push(-5, 5); py.push(-5, 5); }
    const x0 = Math.min(...px), x1 = Math.max(...px), y0 = Math.min(...py), y1 = Math.max(...py);
    target.addScaledVector(right, (x0 + x1) / 2).addScaledVector(up, (y0 + y1) / 2);
    const zoom = Math.min(maxZoom, Math.max(1, Math.min((size.width - 64) / (x1 - x0), (size.height - 88) / (y1 - y0)) * 0.94));
    return { pos: target.clone().addScaledVector(dir, CAM_DIST), target, zoom };
  };
  const current = (): Pose => ({ pos: camera.position.clone(), target: ctl.current!.target.clone(), zoom: (camera as THREE.OrthographicCamera).zoom });
  const publishPose = () => {
    gl.domElement.dataset.cameraPose = JSON.stringify({ position: camera.position.toArray().map(v => +v.toFixed(3)), target: ctl.current!.target.toArray().map(v => +v.toFixed(3)), zoom: +(camera as THREE.OrthographicCamera).zoom.toFixed(3) });
    gl.domElement.dataset.cameraViewport = `${size.width}x${size.height}`;
  };
  const apply = (p: Pose) => { camera.position.copy(p.pos); ctl.current!.target.copy(p.target); (camera as THREE.OrthographicCamera).zoom = p.zoom; camera.updateProjectionMatrix(); ctl.current!.update(); publishPose(); invalidate(); };
  const go = (to: Pose, remember = true) => {
    if (!ctl.current) return;
    if (remember) { history.current.push(current()); if (history.current.length > 12) history.current.shift(); }
    manual.current = true;
    if (ui.reducedMotion) apply(to); else { tween.current = { t: 0, from: current(), to }; gl.domElement.dataset.cameraActive = "true"; invalidate(); }
  };
  useLayoutEffect(() => {
    if (!ctl.current) return;
    if (!initialized.current) { const saved = cameraPoses.get(key); apply(saved ?? fit(initialRooms)); manual.current = !!saved; initialized.current = true; }
    else if (!manual.current) apply(fit(initialRooms));
    // React clears the ref before passive unmount cleanup. Capture the live control instance so
    // returning from Graph restores the interacted camera, rather than the last resize/overview.
    const control = ctl.current;
    return () => { cameraPoses.set(key, { pos: camera.position.clone(), target: control.target.clone(), zoom: (camera as THREE.OrthographicCamera).zoom }); if (cameraPoses.size > 4) cameraPoses.delete(cameraPoses.keys().next().value!); };
    // Deliberate panel resizing preserves an interacted camera; initial scene fit still responds.
  }, [key, size.width, size.height]);
  useEffect(() => {
    if (!command.n || !ctl.current) return;
    if (command.type === "back") { const p = history.current.pop(); if (p) go(p, false); }
    else if (command.type === "fit") go(fit());
    else if (command.type === "focus") { const ids = command.ids ? new Set(command.ids) : selectionAssets(ui.selection, vm); const rs = command.group ? groups.find(g => g.key === command.group)?.rooms : scene.rooms.filter(r => ids.has(r.asset_id)); if (rs?.length) go(fit(rs, command.ids ? 42 : 140)); }
    else { const p = current(); p.zoom = THREE.MathUtils.clamp(p.zoom * (command.type === "in" ? 1.25 : 0.8), 1, 140); go(p); }
  }, [command.n]);
  useEffect(() => {
    if (ui.focusRevision <= ui.focusHandledRevision || ui.focusRevision === focusInFlight.current || !ctl.current) return;
    const ids = selectionAssets(ui.selection, vm), rs = scene.rooms.filter(r => ids.has(r.asset_id));
    if (rs.length) { focusInFlight.current = ui.focusRevision; go(fit(rs)); if (ui.reducedMotion) dispatch({ type: "focusHandled", revision: ui.focusRevision }); else if (tween.current) tween.current.focusRevision = ui.focusRevision; }
  }, [ui.focusRevision, ui.focusHandledRevision, vm.selectedEventAssets]);
  useFrame((_, dt) => {
    if (!ctl.current) return;
    const t = tween.current;
    if (t) { t.t = Math.min(1, t.t + Math.min(dt, 0.05) / 0.38); const k = 1 - (1 - t.t) ** 3;
      apply({ pos: t.from.pos.clone().lerp(t.to.pos, k), target: t.from.target.clone().lerp(t.to.target, k), zoom: THREE.MathUtils.lerp(t.from.zoom, t.to.zoom, k) }); if (t.t === 1) { tween.current = null; gl.domElement.dataset.cameraActive = "false"; if (t.focusRevision) dispatch({ type: "focusHandled", revision: t.focusRevision }); }
    }
    publishPose();
    const level = semanticLevelForScale((camera as THREE.OrthographicCamera).zoom, !ui.roofs);
    if (level !== lastLevel.current) { lastLevel.current = level; gl.domElement.dataset.semanticLevel = level; onLevel(level); }
  });
  return <OrbitControls ref={ctl} makeDefault enableDamping={false} rotateSpeed={0.6} zoomSpeed={0.8} minPolarAngle={THREE.MathUtils.degToRad(25)} maxPolarAngle={THREE.MathUtils.degToRad(65)} minZoom={1} maxZoom={140}
    onStart={() => { gl.domElement.dataset.cameraActive = "true"; if (tween.current?.focusRevision) dispatch({ type: "focusHandled", revision: tween.current.focusRevision }); tween.current = null; manual.current = true; }} onEnd={() => { gl.domElement.dataset.cameraActive = "false"; }} onChange={() => { const c = ctl.current; if (!c) return;
      const x = THREE.MathUtils.clamp(c.target.x, b.minX - 5, b.maxX + 5), z = THREE.MathUtils.clamp(c.target.z, b.minZ - 5, b.maxZ + 5); const delta = new THREE.Vector3(x - c.target.x, 0, z - c.target.z); c.target.add(delta); camera.position.add(delta); invalidate(); }} />;
}
/** Dusk sky with a soft vignette, drawn as one full-screen gradient quad behind everything. No texture: a
 * canvas-backed background texture is re-uploaded by every renderer and retained DOM across project switches. */
const SKY_VERTEX = `varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const SKY_FRAGMENT = `varying vec2 vUv; void main() {
  float d = distance(vUv, vec2(0.5, 1.15));
  vec3 c = mix(vec3(0.169, 0.227, 0.322), vec3(0.094, 0.129, 0.184), smoothstep(0.0, 0.6, d));
  c = mix(c, vec3(0.051, 0.067, 0.094), smoothstep(0.6, 1.25, d));
  c *= 1.0 - 0.55 * smoothstep(0.35, 0.85, distance(vUv, vec2(0.5, 0.45)));
  gl_FragColor = vec4(c, 1.0); }`;
function Sky() {
  return <mesh frustumCulled={false} renderOrder={-1} raycast={() => null}>
    <planeGeometry args={[2, 2]} />
    <shaderMaterial vertexShader={SKY_VERTEX} fragmentShader={SKY_FRAGMENT} depthWrite={false} depthTest={false} />
  </mesh>;
}
function Lights({ scene, quality }: { scene: CompiledScene; quality: DetailLevel }) {
  const cx = (scene.bounds.minX + scene.bounds.maxX) / 2, cz = (scene.bounds.minZ + scene.bounds.maxZ) / 2;
  const span = Math.max(scene.bounds.maxX - scene.bounds.minX, scene.bounds.maxZ - scene.bounds.minZ) / 2 + 6;
  const key = useRef<THREE.DirectionalLight>(null);
  useEffect(() => { if (key.current) { key.current.target.position.set(cx, 0, cz); key.current.target.updateMatrixWorld(); } }, [cx, cz]);
  // Late-afternoon sun, a cool sky fill and a warm ground bounce; long, soft shadows give the campus depth.
  return <><hemisphereLight args={["#CFE0F5", "#5A4630", 0.95]} />
    <directionalLight ref={key} position={[cx - 34, 38, cz + 30]} intensity={4.2} color="#FFD9A8" castShadow={quality !== "low"} shadow-mapSize={quality === "high" ? [2048, 2048] : [1024, 1024]} shadow-bias={-0.0002} shadow-normalBias={0.03} shadow-radius={3}
      shadow-camera-left={-span} shadow-camera-right={span} shadow-camera-top={span} shadow-camera-bottom={-span} shadow-camera-near={1} shadow-camera-far={200} />
    <directionalLight position={[cx + 26, 18, cz - 30]} intensity={0.7} color="#8FB4E8" />
  </>;
}
function Room({ room, selected, focused, quality }: { room: SceneRoom; selected: boolean; focused: boolean; quality: DetailLevel }) {
  const { ui, dispatch, vm } = useApp(), status = vm.assetStatus.get(room.asset_id), asset = vm.data.graph.assets.find(a => a.id === room.asset_id)!;
  const [moduleFault, setModuleFault] = useState<{ id: string; code: ModuleFailureCode } | null>(null);
  const moduleFailure = moduleFault?.id === room.module_id ? moduleFault.code : null;
  const [lod, setLod] = useState<DetailLevel>(quality === "low" ? "low" : "medium"), previousPixels = useRef(0);
  useFrame(({ camera }) => {
    const pixels = Math.max(room.footprint.w, room.footprint.d) * (camera as THREE.OrthographicCamera).zoom;
    if (Math.abs(previousPixels.current - pixels) < 18 && !selected) return;
    previousPixels.current = pixels;
    const next = quality === "low" ? "low" : quality === "high" && (selected || pixels > 175) ? "high" : pixels < 42 && !selected ? "low" : "medium";
    if (next !== lod) setLod(next);
  });
  useEffect(() => { setLod(quality === "low" ? "low" : selected && quality === "high" ? "high" : "medium"); }, [quality, selected]);
  const hovered = ui.hover === room.asset_id, q = ui.query.trim().toLowerCase(), dim = !!q && !`${asset.name} ${asset.id} ${asset.owner ?? ""}`.toLowerCase().includes(q);
  const gap = status && status.coverage !== "reporting", severity = status?.severity;
  const priority = selected ? FORCE + 200 : focused ? FORCE + 150 : hovered ? FORCE + 100 : moduleFailure ? FORCE + 50 : dim ? -1000 : (severity ? SEVERITY_RANK[severity] * 45 : 0) + (gap ? 15 : 0);
  const labelRef = useLabel(`room:${room.asset_id}`, [room.position.x, room.label_anchor.y, room.position.z], priority);
  const select = () => dispatch({ type: "select", selection: { kind: "asset", id: room.asset_id }, announce: `Selected ${asset.name}. ${status ? ASSET_COVERAGE_LABEL[status.coverage] : "Coverage not assessed"}.` });
  const w = room.footprint.w, d = room.footprint.d;
  // LP17-A2: full volume with roofs on; a low plinth under the floor with roofs off so interiors stay clickable.
  const proxy = selectionProxy({ footprint: room.footprint, height: room.height }, ui.roofs);
  const moduleIdentity = useMemo(() => ({ assetId: asset.id, name: asset.name, width: room.rotation_y % 180 ? d : w, depth: room.rotation_y % 180 ? w : d, height: room.height,
    onFailure: (code: ModuleFailureCode) => setModuleFault({ id: room.module_id, code }) }), [asset.id, asset.name, w, d, room.rotation_y, room.height, room.module_id]);
  return <group name={`asset:${room.asset_id}`} position={[room.position.x, 0.08, room.position.z]} userData={{ asset_id: room.asset_id, node_id: room.node_id }}>
    <group rotation={[0, room.rotation_y * Math.PI / 180, 0]}><CastleModule id={room.module_id} roofs={ui.roofs} lod={lod}
      identity={moduleIdentity} /></group>
    <mesh name="hit-proxy" position={[0, proxy.y, 0]} userData={{ asset_id: room.asset_id, roofs_off_plinth: !ui.roofs || undefined }} onClick={e => { if (e.delta > 6) return; e.stopPropagation(); select(); }} onDoubleClick={e => { e.stopPropagation(); select(); dispatch({ type: "focus" }); }}
      onPointerOver={e => { e.stopPropagation(); dispatch({ type: "hover", id: room.asset_id }); document.body.style.cursor = "pointer"; }} onPointerOut={() => { dispatch({ type: "hover", id: null }); document.body.style.cursor = ""; }}>
      <boxGeometry args={[proxy.w, proxy.h, proxy.d]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
    {(selected || hovered) && <Line points={[[-w / 2 - 0.18, 0.06, -d / 2 - 0.18], [w / 2 + 0.18, 0.06, -d / 2 - 0.18], [w / 2 + 0.18, 0.06, d / 2 + 0.18], [-w / 2 - 0.18, 0.06, d / 2 + 0.18], [-w / 2 - 0.18, 0.06, -d / 2 - 0.18]]} color={selected ? ACCENT : "#EEF3FA"} lineWidth={selected ? 2.6 : 1.5} raycast={() => null} />}
    {selected && !ui.roofs && <InteriorMarkers assetId={room.asset_id} />}
    {gap && <CoverageHatch w={w + 0.32} d={d + 0.32} warning={status.coverage === "gap" || status.coverage === "partial"} />}
    <Html position={[0, room.label_anchor.y - 0.08, 0]} center zIndexRange={[20, 10]}>
      <div ref={labelRef} className="lbl"><button data-asset-label={asset.id} data-module-recovery={moduleFailure ?? undefined} className={`room-label${selected ? " is-selected" : ""}${dim ? " dim" : ""}`} onClick={e => { e.stopPropagation(); select(); }} onDoubleClick={e => { e.stopPropagation(); dispatch({ type: "focus" }); }}
        onFocus={() => dispatch({ type: "hover", id: asset.id })} onBlur={() => dispatch({ type: "hover", id: null })}
        aria-label={`${asset.name}. ${moduleFailure ? "Visual module unavailable; neutral block. " : ""}${severity ? severity + " severity. " : ""}${status?.worst ? OUTCOME_STYLE[status.worst].label + ". " : "No open findings. "}${status ? ASSET_COVERAGE_LABEL[status.coverage] : "Coverage not assessed"}`}
        style={{ borderColor: selected ? ACCENT : severity ? SEVERITY_COLOR[severity] : undefined, maxWidth: selected ? 230 : 170, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, borderRadius: 7, padding: "6px 9px" }}>
        <span className="name" style={{ whiteSpace: selected ? "normal" : undefined }}>{asset.name}</span>
        {moduleFailure && <small role="status" aria-live={ui.reduceAutomaticAnnouncements ? "off" : "polite"}>Model unavailable · neutral block</small>}
        {status?.worst && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><StateIcon state={status.worst} size={12} /><span>{OUTCOME_STYLE[status.worst].label}</span></span>}
        {severity && <small style={{ color: SEVERITY_COLOR[severity] }}>{severity} · {status!.findingIds.length} finding{status!.findingIds.length === 1 ? "" : "s"}</small>}
        {gap && <small data-coverage={status.coverage} style={{ color: "#E8BE78" }}>{ASSET_COVERAGE_LABEL[status.coverage]}</small>}
      </button></div>
    </Html>
  </group>;
}
function CoverageHatch({ w, d, warning }: { w: number; d: number; warning: boolean }) {
  const tex = useMemo(() => { const t = hatchTexture().clone(); t.repeat.set(w * 1.4, d * 1.4); t.needsUpdate = true; return t; }, [w, d]);
  useEffect(() => () => tex.dispose(), [tex]);
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} renderOrder={2} raycast={() => null}><planeGeometry args={[w, d]} /><meshBasicMaterial map={tex} color={warning ? "#E8BE78" : "#B2BBC8"} transparent opacity={0.44} depthWrite={false} /></mesh>;
}
function District({ group, onFocus }: { group: PresentationGroup; onFocus: () => void }) {
  const b = group.bounds, pos: [number, number, number] = [(b.minX + b.maxX) / 2, 1.5, (b.minZ + b.maxZ) / 2];
  const ref = useLabel(`district:${group.key}`, pos, 100);
  return <Html position={pos} center><div ref={ref} className="lbl"><button onClick={onFocus} style={{ padding: "7px 10px", background: "#192637", border: "1px solid #70849B", borderRadius: 8, color: "#EEF3FA", maxWidth: 170, fontSize: 12 }} aria-label={`Expand ${group.label}, ${group.environment}, ${group.rooms.length} assets`}>
    <strong>{group.label}</strong><br />{group.rooms.length} assets
  </button></div></Html>;
}
function Paths({ scene, visibleIds, onChoice }: { scene: CompiledScene; visibleIds: Set<string>; onChoice: (choice: EdgeChoice) => void }) {
  const { ui, dispatch, vm } = useApp(), { camera, gl, size } = useThree(), focus = selectionAssets(ui.selection, vm), down = useRef<ScreenPoint | null>(null);
  const visible = scene.paths.filter(p => {
    if (!visibleIds.has(p.source_asset_id) || !visibleIds.has(p.target_asset_id)) return false;
    return pathVisible(p, { layers: ui.layers, showHypothetical: ui.showHypothetical, focusMode: ui.focusMode, focusAssets: focus, selectedId: (ui.selection?.kind === "path" || ui.selection?.kind === "relationship") ? ui.selection.id : null });
  }).map(p => ({ p, points: p.points.map(v => new THREE.Vector3(v.x, v.y, v.z)), curved: new THREE.CatmullRomCurve3(p.points.map(v => new THREE.Vector3(v.x, v.y, v.z))).getPoints(40) }));
  const choose = (e: { clientX: number; clientY: number; delta: number; stopPropagation: () => void }) => {
    e.stopPropagation(); const pointer = { x: e.clientX, y: e.clientY };
    if (e.delta > 6 || pointerWasDrag(down.current, pointer)) return;
    const rect = gl.domElement.getBoundingClientRect();
    const ids = overlappingEdges(visible.map(({ p, curved }) => ({ id: p.relationship_id, points: curved.map(v => { const s = v.clone().project(camera); return { x: rect.left + (s.x + 1) / 2 * size.width, y: rect.top + (1 - s.y) / 2 * size.height }; }) })), pointer);
    if (ids.length > 1) onChoice({ ids, x: e.clientX - rect.left, y: e.clientY - rect.top });
    else if (ids.length === 1) dispatch({ type: "select", selection: { kind: "path", id: ids[0]! } });
  };
  return <group name="evidence-relationship-overlays">{visible.map(({ p, points, curved }) => {
    const layer = RELATIONSHIP_LAYER[p.kind] ?? "runtime", chosen = (ui.selection?.kind === "path" || ui.selection?.kind === "relationship") && ui.selection.id === p.relationship_id;
    const inferred = p.evidence_level === "inferred", st = relationshipStyle(p.kind, p.evidence_level, LAYER_STYLE[layer].color);
    const end = curved[curved.length - 1]!, before = curved[curved.length - 3]!, direction = end.clone().sub(before).normalize(), side = new THREE.Vector3(-direction.z, 0, direction.x).multiplyScalar(0.2), tail = end.clone().addScaledVector(direction, -0.45);
    return <group key={p.relationship_id}><Line points={curved} color={chosen ? ACCENT : st.color} lineWidth={chosen ? 2.5 : 1.5} dashed={st.dashed} dashSize={st.dashSize} gapSize={st.gapSize} raycast={() => null} />
      <Line name={`relationship-hit:${p.relationship_id}`} userData={{ relationship_id: p.relationship_id }} points={curved} lineWidth={12} transparent opacity={0} depthWrite={false}
        onPointerDown={e => { down.current = { x: e.clientX, y: e.clientY }; }} onClick={choose} />
      {inferred && <Line points={curved} color={LAYER_STYLE[layer].color} lineWidth={1.4} dashed dashSize={0.035} gapSize={0.48} dashOffset={0.37} raycast={() => null} />}
      <Line points={[tail.clone().add(side), end, tail.clone().sub(side)]} color={chosen ? ACCENT : st.color} lineWidth={1.5} raycast={() => null} />
      {chosen && <Html position={points[1]!.toArray()} center><span style={{ background: "#121C29", color: "#EEF3FA", padding: 6, fontSize: 12 }}>{relationshipMeaning(p.kind, p.evidence_level).label}</span></Html>}
    </group>;
  })}</group>;
}

/** LP16: a retired incarnation at its last position. Outline and label only: never architecture, never a hit proxy,
 * never status. Selecting it opens the asset record, which states that it is not in the current graph. */
function ArchivedPlacement({ room }: { room: NonNullable<CompiledScene["historical_rooms"]>[number] }) {
  const { dispatch } = useApp();
  const w = room.footprint.w / 2 + 0.1, d = room.footprint.d / 2 + 0.1, y = 0.12;
  // Anchored at the footprint's front edge (shown on explicit request) so it never sits on a live label at the same spot.
  const ref = useLabel(`archived:${room.asset_id}:${room.incarnation_id ?? room.retired_in_revision}`, [room.position.x, 0.1, room.position.z + d + 0.9], 185, 18);
  return <group name={`archived:${room.asset_id}`} position={[room.position.x, 0, room.position.z]} userData={{ archived: true, asset_id: room.asset_id, incarnation_id: room.incarnation_id ?? null }}>
    <Line points={[[-w, y, -d], [w, y, -d], [w, y, d], [-w, y, d], [-w, y, -d]]} color="#9AA4B1" lineWidth={1.4} dashed dashSize={0.3} gapSize={0.22} raycast={() => null} />
    <Html position={[0, 0.1, d + 0.9]} center zIndexRange={[18, 9]}><div ref={ref} className="lbl"><button className="room-label archived-label" data-archived-asset={room.asset_id} data-incarnation={room.incarnation_id ?? ""}
      aria-label={`Archived placement of ${room.asset_id}${room.incarnation_id ? `, incarnation ${room.incarnation_id}` : ""}, retired in graph revision ${room.retired_in_revision}. Not a live structure.`}
      onClick={e => { e.stopPropagation(); dispatch({ type: "select", selection: { kind: "asset", id: room.asset_id }, announce: `Selected archived placement of ${room.asset_id}. Not a live structure.` }); }}>
      <span className="name">Archived · {room.asset_id}</span><small>retired in {room.retired_in_revision}</small></button></div></Html>
  </group>;
}
