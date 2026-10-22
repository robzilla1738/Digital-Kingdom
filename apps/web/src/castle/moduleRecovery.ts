import { MODULE_CATALOG, type ModuleId } from "@dk/contracts";
import { moduleGeometry, type DetailLevel, type ModuleGeometry } from "./geometry.ts";

export type ModuleFailureCode = "invalid_asset_pack_geometry" | "module_render_failure" | "module_shader_failure";
export class ModuleGeometryError extends Error {
  constructor() { super("The local architectural module geometry is unavailable."); this.name = "ModuleGeometryError"; }
}
const validated = new WeakSet<ModuleGeometry>();
/** Validate each immutable cached CPU model once, before it reaches WebGL. No API or evidence
 * operation belongs here. Original construction errors are deliberately not logged or exposed. */
export function checkedModuleGeometry(id: ModuleId, lod: DetailLevel, build = moduleGeometry): ModuleGeometry {
  try {
    if (!Object.hasOwn(MODULE_CATALOG, id)) throw new ModuleGeometryError();
    const model = build(id, lod);
    if (validated.has(model)) return model;
    const bounds = [...model.bounds.min.toArray(), ...model.bounds.max.toArray()];
    if (!model.groups.structure || !bounds.every(Number.isFinite) || model.bounds.isEmpty() || !(model.triangles > 0)) throw new ModuleGeometryError();
    for (const geometry of Object.values(model.groups)) {
      const position = geometry.getAttribute("position");
      if (!position || position.itemSize !== 3 || position.count < 3) throw new ModuleGeometryError();
      for (const attribute of Object.values(geometry.attributes)) {
        if (attribute.count !== position.count || !Array.from(attribute.array).every(Number.isFinite)) throw new ModuleGeometryError();
      }
      if (geometry.index && Array.from(geometry.index.array).some(i => !Number.isInteger(i) || i < 0 || i >= position.count)) throw new ModuleGeometryError();
    }
    validated.add(model); return model;
  } catch { throw new ModuleGeometryError(); }
}
export function moduleFailureCode(error: unknown): ModuleFailureCode {
  return error instanceof ModuleGeometryError ? "invalid_asset_pack_geometry" : "module_render_failure";
}
export interface ModuleDiagnostic { code: ModuleFailureCode; module_id: string; recovery: "neutral_block"; }
/** Bounded and deduplicated; no asset names, project IDs, stack traces, raw errors, or source data. */
export class ModuleDiagnosticLog {
  private readonly seen = new Set<string>();
  constructor(private readonly limit = 20, private readonly log = (entry: ModuleDiagnostic) => console.warn("Digital Kingdom renderer", entry)) {}
  report(code: ModuleFailureCode, id: string): boolean {
    const module_id = Object.hasOwn(MODULE_CATALOG, id) ? id : "unknown-module", key = `${code}:${module_id}`;
    if (this.seen.has(key) || this.seen.size >= this.limit) return false;
    this.seen.add(key); this.log({ code, module_id, recovery: "neutral_block" }); return true;
  }
}
export const moduleDiagnostics = new ModuleDiagnosticLog();
