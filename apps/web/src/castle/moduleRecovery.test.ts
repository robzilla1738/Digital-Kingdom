import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { MODULE_CATALOG, type ModuleId } from "@dk/contracts";
import { moduleGeometry, moduleMaterials, cachedModuleMaterialCount, retainArchitectureResources, type ModuleGeometry } from "./geometry.ts";
import { checkedModuleGeometry, ModuleDiagnosticLog, ModuleGeometryError, moduleFailureCode, type ModuleDiagnostic } from "./moduleRecovery.ts";
import { registerModuleShaders, shaderOwnerMarker, watchRendererShaders } from "./shaderRecovery.ts";

describe("local visual-module recovery", () => {
  it("accepts all ten cached models and preserves reusable geometry identity", () => {
    for (const id of Object.keys(MODULE_CATALOG) as ModuleId[]) for (const lod of ["low", "medium", "high"] as const)
      expect(checkedModuleGeometry(id, lod)).toBe(moduleGeometry(id, lod));
  });
  it("rejects unknown models and sanitizes construction failures without exposing their payload", () => {
    expect(() => checkedModuleGeometry("not-a-module" as ModuleId, "medium")).toThrow(ModuleGeometryError);
    try { checkedModuleGeometry("hall", "medium", () => { throw new Error("private source payload must not reach diagnostics"); }); }
    catch (error) {
      expect(error).toBeInstanceOf(ModuleGeometryError);
      expect((error as Error).message).not.toContain("private");
      expect((error as Error).cause).toBeUndefined();
      expect(moduleFailureCode(error)).toBe("invalid_asset_pack_geometry");
    }
  });
  it("rejects nonfinite vertices, invalid indexes and empty model structure before WebGL", () => {
    const valid = moduleGeometry("hall"), geometry = valid.groups.structure!.clone();
    const invalid = (): ModuleGeometry => ({ ...valid, groups: { structure: geometry } });
    geometry.getAttribute("position").setX(0, NaN);
    expect(() => checkedModuleGeometry("hall", "medium", invalid)).toThrow(ModuleGeometryError);
    geometry.getAttribute("position").setX(0, 0); geometry.setIndex([0, 1, 999999]);
    expect(() => checkedModuleGeometry("hall", "medium", invalid)).toThrow(ModuleGeometryError);
    expect(() => checkedModuleGeometry("hall", "medium", () => ({ ...valid, groups: {}, bounds: new THREE.Box3() }))).toThrow(ModuleGeometryError);
    geometry.dispose();
  });
  it("bounds and deduplicates classified diagnostics without source/asset/error text", () => {
    const entries: ModuleDiagnostic[] = [], log = new ModuleDiagnosticLog(2, entry => entries.push(entry));
    for (let i = 0; i < 30; i++) log.report("invalid_asset_pack_geometry", "gatehouse");
    log.report("module_render_failure", "private-unrecognized-id");
    log.report("invalid_asset_pack_geometry", "hall");
    expect(entries).toEqual([
      { code: "invalid_asset_pack_geometry", module_id: "gatehouse", recovery: "neutral_block" },
      { code: "module_render_failure", module_id: "unknown-module", recovery: "neutral_block" },
    ]);
    expect(moduleFailureCode(new Error("local React module render failed"))).toBe("module_render_failure");
    // No API/auth/WebGL classification is inferred from arbitrary message strings. Those failure
    // domains are outside the geometry classifier; owned shader compilation has a separate monitor.
    expect(JSON.stringify(entries)).not.toMatch(/private|api_failure|authorization_failure|webgl_unavailable/);
  });
});

describe("owned module shader recovery", () => {
  function fakeRenderer() {
    const vertex = {} as WebGLShader, fragment = {} as WebGLShader;
    let vertexSource = "", fragmentSource = "", lost = false;
    const context = { isContextLost: () => lost, getShaderSource: (shader: WebGLShader) => shader === vertex ? vertexSource : fragmentSource } as unknown as WebGLRenderingContext;
    const prior = vi.fn();
    const renderer = { debug: { checkShaderErrors: false, onShaderError: prior }, getContext: () => context, domElement: { dataset: {} } } as unknown as THREE.WebGLRenderer;
    return { renderer, prior, fail(name: string, contextLost = false, fragmentName = name) { vertexSource = `#define SHADER_NAME ${name}\nPRIVATE_DRIVER_PAYLOAD`; fragmentSource = `#define SHADER_NAME ${fragmentName}\nPRIVATE_DRIVER_PAYLOAD`; lost = contextLost; renderer.debug.onShaderError!(context, {} as Parameters<NonNullable<typeof renderer.debug.onShaderError>>[1], vertex, fragment); } };
  }
  it("reuses a bounded 48-material pool (16 modules x 3, kit 2.1.0) with unique programs and matching default shadow packing", () => {
    const keys = new Set<string>(), names = new Set<string>();
    for (const id of Object.keys(MODULE_CATALOG) as ModuleId[]) {
      const family = moduleMaterials(id); expect(moduleMaterials(id)).toBe(family);
      expect(family.depth.depthPacking).toBe(THREE.RGBADepthPacking);
      for (const material of Object.values(family)) { keys.add(material.customProgramCacheKey()); names.add(material.name); }
    }
    expect(keys.size).toBe(48); expect(names.size).toBe(48); expect(cachedModuleMaterialCount()).toBe(48);
    expect(() => moduleMaterials("private-invalid-family" as ModuleId)).toThrow(); expect(cachedModuleMaterialCount()).toBe(48);
  });
  it("notifies all proven same-family owners once, including depth failures, but no healthy family", async () => {
    const { renderer, prior, fail } = fakeRenderer(), bad = moduleMaterials("gatehouse"), healthy = moduleMaterials("hall");
    const first = vi.fn(), second = vi.fn(), other = vi.fn(), global = vi.fn();
    const unwatch = watchRendererShaders(renderer, global);
    const a = registerModuleShaders(renderer, { id: "gatehouse", materials: Object.values(bad), fail: first });
    const b = registerModuleShaders(renderer, { id: "gatehouse", materials: Object.values(bad), fail: second });
    const c = registerModuleShaders(renderer, { id: "hall", materials: Object.values(healthy), fail: other });
    fail(bad.depth.name); fail(bad.depth.name); await Promise.resolve();
    expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1); expect(other).not.toHaveBeenCalled(); expect(global).not.toHaveBeenCalled();
    a(); b(); expect(renderer.domElement.dataset.moduleShaderOwners).toBe("1");
    const replacement = vi.fn(), d = registerModuleShaders(renderer, { id: "hall", materials: Object.values(healthy), fail: replacement });
    await Promise.resolve(); expect(replacement).not.toHaveBeenCalled();
    c(); d(); unwatch(); expect(renderer.debug.onShaderError).toBe(prior); expect(renderer.debug.checkShaderErrors).toBe(false);
    expect(renderer.domElement.dataset.moduleShaderOwners).toBeUndefined();
  });
  it("keeps lost contexts and unowned shaders out of local asset recovery and logs no raw payload", async () => {
    const { renderer, fail } = fakeRenderer(), family = moduleMaterials("gatehouse"), local = vi.fn(), global = vi.fn();
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unwatch = watchRendererShaders(renderer, global), release = registerModuleShaders(renderer, { id: "gatehouse", materials: Object.values(family), fail: local });
    try {
      fail(family.body.name, true); await Promise.resolve(); expect(local).not.toHaveBeenCalled(); expect(global).not.toHaveBeenCalled();
      fail("unowned_shared_shader"); fail("unowned_shared_shader"); await Promise.resolve();
      expect(global).toHaveBeenCalledTimes(1); expect(local).not.toHaveBeenCalled(); expect(log).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|unowned_shared_shader/);
      expect(shaderOwnerMarker(`#define SHADER_NAME ${family.body.name}\n#define SHADER_NAME ${family.roof.name}`)).toBeNull();
    } finally { release(); unwatch(); log.mockRestore(); }
  });
  it.each(["mismatched-stages", "known-but-unregistered"])("routes %s callback ownership to renderer fallback, never an arbitrary asset", async mode => {
    const { renderer, prior, fail } = fakeRenderer(), family = moduleMaterials("gatehouse"), other = moduleMaterials("hall");
    const local = vi.fn(), global = vi.fn(), log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unwatch = watchRendererShaders(renderer, global), release = registerModuleShaders(renderer, { id: "gatehouse", materials: Object.values(family), fail: local });
    try {
      if (mode === "mismatched-stages") fail(family.body.name, false, other.body.name);
      else fail(other.body.name);
      await Promise.resolve(); expect(global).toHaveBeenCalledTimes(1); expect(local).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith("Digital Kingdom renderer", { code: "renderer_shader_failure", recovery: "graph" });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|dk_arch/);
    } finally { release(); unwatch(); log.mockRestore(); }
    expect(renderer.debug.onShaderError).toBe(prior); expect(renderer.domElement.dataset.moduleShaderOwners).toBeUndefined();
  });
  it("replays a failed family to later owners but cancels removed owner callbacks", async () => {
    const { renderer, fail } = fakeRenderer(), family = moduleMaterials("gatehouse"), first = vi.fn(), later = vi.fn();
    const unwatch = watchRendererShaders(renderer, vi.fn());
    const a = registerModuleShaders(renderer, { id: "gatehouse", materials: Object.values(family), fail: first });
    fail(family.body.name); a(); await Promise.resolve(); expect(first).not.toHaveBeenCalled();
    const b = registerModuleShaders(renderer, { id: "gatehouse", materials: Object.values(family), fail: later });
    await Promise.resolve(); expect(later).toHaveBeenCalledTimes(1); b(); unwatch();
  });
  it("cancels deferred callbacks on unmount and releases every new material registration", async () => {
    const { renderer, prior, fail } = fakeRenderer(), family = moduleMaterials("gatehouse"), local = vi.fn();
    const release = registerModuleShaders(renderer, { id: "gatehouse", materials: Object.values(family), fail: local });
    fail(family.body.name); release(); await Promise.resolve(); expect(local).not.toHaveBeenCalled(); expect(renderer.debug.onShaderError).toBe(prior);
    let disposed = 0;
    for (const material of Object.values(family)) { const listener = () => { disposed++; material.removeEventListener("dispose", listener); }; material.addEventListener("dispose", listener); }
    const cleanup = retainArchitectureResources({}, () => {}); cleanup(); cleanup();
    expect(disposed).toBe(3); expect(moduleMaterials("gatehouse")).toBe(family);
  });
});
