import type { FastifyInstance, FastifyRequest } from "fastify";
import { BLUEPRINTS, CATALOG_VERSION, TEMPLATE_CATALOG, WORLD_TEMPLATES, WorldPlanError, catalogDigest, compileWorld, getBlueprint, instantiateBlueprint, previewDescriptor, previewWorld, templateDigest, type DescriptorFormat } from "@dk/local-world";
import { HttpError, type Store } from "./store.ts";
import type { Role } from "./security.ts";

/**
 * LP04 local world builder API. Preview is a pure read: it needs no project, source, endpoint or provider
 * credential, creates nothing and contacts nothing. Starting a run is the supervisor's job (LP05), not this API's.
 */
export interface LocalWorldDeps { store: Store; authed: (minRole?: Role) => (req: FastifyRequest) => Promise<void> }

export function registerLocalWorld(app: FastifyInstance, d: LocalWorldDeps) {
  app.get("/api/local-world/catalog", { preHandler: d.authed() }, async () => ({
    schema: "dk.local.catalog.v1", catalog_version: CATALOG_VERSION, catalog_digest: catalogDigest(),
    templates: WORLD_TEMPLATES.map((t) => ({ ...TEMPLATE_CATALOG[t], digest: templateDigest(t) })),
    blueprints: BLUEPRINTS.map((b) => ({ id: b.id, version: b.version, title: b.title, summary: b.summary, resources: b.resources.length, limitations: b.limitations })),
    note: "Reviewed local templates only. Endpoints are allocated by the run supervisor; no plan names a port, URL, image or command.",
  }));

  app.post("/api/local-world/preview", { preHandler: d.authed(), bodyLimit: 600_000 }, async (req) => {
    const b = (req.body ?? {}) as { blueprint?: unknown; version?: unknown; seed?: unknown; descriptor?: { format?: unknown; text?: unknown } };
    if (b.descriptor !== undefined) {
      if (b.blueprint !== undefined) throw new HttpError(400, "preview either a blueprint or a descriptor, not both");
      const fmt = String(b.descriptor?.format ?? "") as DescriptorFormat;
      if (!["compose", "openapi", "manifest"].includes(fmt)) throw new HttpError(400, "descriptor.format must be compose, openapi or manifest");
      if (typeof b.descriptor?.text !== "string") throw new HttpError(400, "descriptor.text must be a string");
      return previewDescriptor({ format: fmt, text: b.descriptor.text });
    }
    const bp = getBlueprint(String(b.blueprint ?? ""), b.version === undefined ? undefined : Number(b.version));
    if (!bp) throw new HttpError(404, `unknown blueprint ${String(b.blueprint ?? "").slice(0, 60)}; see /api/local-world/catalog`);
    const seed = b.seed === undefined ? "preview" : b.seed;
    if (typeof seed !== "string") throw new HttpError(400, "seed must be a string");
    try { return previewWorld(compileWorld(instantiateBlueprint(bp, { seed }), { blueprint: bp })); }
    catch (e) { if (e instanceof WorldPlanError) throw new HttpError(422, "world plan rejected", e.issues); throw e; }
  });
}
