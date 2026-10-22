import { Component, memo, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { MODULE_CATALOG, type ModuleId } from "@dk/contracts";
import { moduleMaterials, retainArchitectureResources, type DetailLevel } from "./geometry.ts";
import { checkedModuleGeometry, moduleDiagnostics, moduleFailureCode, type ModuleFailureCode } from "./moduleRecovery.ts";
import { registerModuleShaders } from "./shaderRecovery.ts";

interface ModuleIdentity { assetId: string; name: string; width: number; depth: number; height: number; onFailure: (code: ModuleFailureCode) => void; }
class ModuleBoundary extends Component<{ id: ModuleId; identity?: ModuleIdentity; children: ReactNode }, { failure: ModuleFailureCode | null }> {
  override state: { failure: ModuleFailureCode | null } = { failure: null };
  static getDerivedStateFromError(error: unknown) { return { failure: moduleFailureCode(error) }; }
  override componentDidCatch(error: unknown) {
    const code = moduleFailureCode(error); moduleDiagnostics.report(code, this.props.id); this.props.identity?.onFailure(code);
  }
  override render() {
    return this.state.failure ? <NeutralModule id={this.props.id} identity={this.props.identity} failure={this.state.failure} /> : this.props.children;
  }
}
function NeutralModule({ id, identity, failure }: { id: ModuleId; identity?: ModuleIdentity; failure: ModuleFailureCode }) {
  const { gl, invalidate } = useThree(), spec = Object.hasOwn(MODULE_CATALOG, id) ? MODULE_CATALOG[id] : undefined;
  const width = identity?.width ?? spec?.footprint.w ?? 1, depth = identity?.depth ?? spec?.footprint.d ?? 1, height = identity?.height ?? spec?.height ?? 1;
  useLayoutEffect(() => { gl.shadowMap.needsUpdate = true; invalidate(); }, [gl, invalidate]);
  return <group name="neutral-module-fallback" userData={{ module_id: id, asset_id: identity?.assetId, renderer_failure: failure }}>
    <mesh position={[0, height / 2, 0]} raycast={() => null}><boxGeometry args={[width, height, depth]} /><meshBasicMaterial color="#8F9395" /></mesh>
    {!identity && <Html position={[0, height + 0.3, 0]} center><span className="room-label">{spec?.label ?? "Architectural module"} · model unavailable</span></Html>}
  </group>;
}

/** Only the local visual module is isolated. Hit proxies, asset labels and canonical records stay
 * outside this boundary. Shader compilation recovery uses proven isolated program ownership. */
export const CastleModule = memo(function CastleModule(props: { id: ModuleId; roofs: boolean; lod?: DetailLevel; identity?: ModuleIdentity; highContrast?: boolean; windowColor?: string | null }) {
  return <ModuleBoundary key={props.id} id={props.id} identity={props.identity}><ModuleMesh {...props} /></ModuleBoundary>;
});

/** Shared cached geometry is app-owned, never disposed by an individual room or recoloured by status. */
function ModuleMesh({ id, roofs, lod = "medium", identity }: { id: ModuleId; roofs: boolean; lod?: DetailLevel; identity?: ModuleIdentity }) {
  const geometry = checkedModuleGeometry(id, lod), spec = MODULE_CATALOG[id], materials = moduleMaterials(id);
  const { invalidate, gl } = useThree();
  const [shaderFailure, setShaderFailure] = useState(false);
  useLayoutEffect(() => {
    if (shaderFailure) return;
    return registerModuleShaders(gl, { id, materials: Object.values(materials), fail: () => {
      moduleDiagnostics.report("module_shader_failure", id); setShaderFailure(true); identity?.onFailure("module_shader_failure"); invalidate();
    } });
  }, [gl, id, materials, identity, invalidate, shaderFailure]);
  useEffect(() => { if (!shaderFailure) return retainArchitectureResources(gl, () => { gl.shadowMap.needsUpdate = true; invalidate(); }); }, [gl, invalidate, shaderFailure]);
  useLayoutEffect(() => { gl.shadowMap.needsUpdate = true; invalidate(); }, [roofs, lod, invalidate, gl]);
  if (shaderFailure) return <NeutralModule id={id} identity={identity} failure="module_shader_failure" />;
  return <group name="module-root" userData={{ module_id: id, lod }} dispose={null}>
    {Object.entries(geometry.groups).filter(([name]) => name !== "roof" || roofs).map(([name, g]) => <group key={name} name={name}>
      <mesh geometry={g} material={name === "roof" ? materials.roof : materials.body} customDepthMaterial={materials.depth} castShadow receiveShadow raycast={() => null} />
    </group>)}
    <group name="anchor-label" position={[0, spec.label_height, 0]} />
    <group name="anchor-status" position={[0, spec.height + 0.3, 0]} />
    <group name="anchor-connections" position={[0, 0.35, 0]} />
  </group>;
}
