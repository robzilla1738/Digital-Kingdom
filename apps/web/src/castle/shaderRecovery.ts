import type { Material, WebGLRenderer } from "three";
import type { ModuleId } from "@dk/contracts";
import { ownedShaderMaterial } from "./geometry.ts";

type Renderer = Pick<WebGLRenderer, "debug" | "getContext" | "domElement">;
type Owner = { id: ModuleId; materials: readonly Material[]; fail: () => void };
const monitors = new WeakMap<Renderer, ShaderMonitor>();
/** Only the fixed, generated shader header is read. Never retain/log shader text or driver logs. */
export function shaderOwnerMarker(source: string | null): string | null {
  if (!source) return null;
  const matches = [...source.matchAll(/^\s*#define\s+SHADER_NAME\s+(\w+)\s*$/gm)];
  return matches.length === 1 && ownedShaderMaterial(matches[0]![1]!) ? matches[0]![1]! : null;
}
class ShaderMonitor {
  private readonly owners = new Map<object, Owner>();
  private readonly globals = new Set<() => void>();
  private readonly failed = new Set<Material>(); // At most the 10 canonical families × 3 materials.
  private readonly notified = new Set<object>();
  private readonly prior: Renderer["debug"]["onShaderError"];
  private readonly priorChecks: boolean;
  private closed = false;
  private globalFailure = false;
  constructor(private readonly renderer: Renderer) {
    this.prior = renderer.debug.onShaderError; this.priorChecks = renderer.debug.checkShaderErrors;
    renderer.debug.onShaderError = this.onError; renderer.debug.checkShaderErrors = true;
  }
  private readonly onError: NonNullable<Renderer["debug"]["onShaderError"]> = (context, _program, vertex, fragment) => {
    // Lost contexts are not local model failures. The native context-loss path owns recovery.
    if (this.closed || context.isContextLost()) return;
    const a = shaderOwnerMarker(context.getShaderSource(vertex)), b = shaderOwnerMarker(context.getShaderSource(fragment));
    const owned = a && a === b ? ownedShaderMaterial(a) : undefined;
    const affected = owned ? [...this.owners].filter(([, owner]) => owner.id === owned.id && owner.materials.includes(owned.material)) : [];
    if (context !== this.renderer.getContext() || !owned || !affected.length) { this.unowned(); return; }
    this.failed.add(owned.material);
    for (const [token] of affected) this.notify(token);
  };
  private notify(token: object) {
    if (this.notified.has(token)) return;
    this.notified.add(token);
    // onShaderError runs inside Three's first program use. Do not mutate the scene or dispose
    // an active GL program there; recover after the render stack has returned.
    queueMicrotask(() => { if (!this.closed) this.owners.get(token)?.fail(); });
  }
  private unowned() {
    if (this.globalFailure) return;
    this.globalFailure = true;
    console.warn("Digital Kingdom renderer", { code: "renderer_shader_failure", recovery: "graph" });
    queueMicrotask(() => { if (!this.closed) for (const notify of this.globals) notify(); });
  }
  own(owner: Owner) {
    if (owner.materials.some(material => { const known = ownedShaderMaterial(material.name); return known?.id !== owner.id || known.material !== material; })) throw new Error("Invalid architectural shader ownership");
    const token = {}; this.owners.set(token, owner); this.stats();
    if (owner.materials.some(material => this.failed.has(material))) this.notify(token);
    let released = false;
    return () => { if (released) return; released = true; this.owners.delete(token); this.notified.delete(token); this.stats(); this.release(); };
  }
  watch(notify: () => void) {
    this.globals.add(notify);
    if (this.globalFailure) queueMicrotask(() => { if (!this.closed && this.globals.has(notify)) notify(); });
    return () => { this.globals.delete(notify); this.release(); };
  }
  private stats() { this.renderer.domElement.dataset.moduleShaderOwners = String(this.owners.size); }
  private release() {
    if (this.owners.size || this.globals.size) return;
    this.closed = true; this.failed.clear(); this.notified.clear();
    if (this.renderer.debug.onShaderError === this.onError) { this.renderer.debug.onShaderError = this.prior; this.renderer.debug.checkShaderErrors = this.priorChecks; }
    monitors.delete(this.renderer); delete this.renderer.domElement.dataset.moduleShaderOwners;
  }
}
function monitor(renderer: Renderer) {
  let value = monitors.get(renderer); if (!value) { value = new ShaderMonitor(renderer); monitors.set(renderer, value); } return value;
}
export const registerModuleShaders = (renderer: Renderer, owner: Owner) => monitor(renderer).own(owner);
export const watchRendererShaders = (renderer: Renderer, onUnownedFailure: () => void) => monitor(renderer).watch(onUnownedFailure);
