import type { FastifyInstance, FastifyRequest } from "fastify";
import { BLUEPRINTS, CATALOG_VERSION, TEMPLATE_CATALOG, WORLD_TEMPLATES, WorldPlanError, catalogDigest, compileWorld, getBlueprint, instantiateBlueprint, previewDescriptor, previewWorld, templateDigest, type DescriptorFormat } from "@dk/local-world";
import { sourceCapabilities } from "@dk/detections";
import { HttpError, type Store } from "./store.ts";
import { provenanceOf } from "./provenance.ts";
import type { Role } from "./security.ts";

/**
 * LP04 local world builder API. Preview is a pure read: it needs no project, source, endpoint or provider
 * credential, creates nothing and contacts nothing. Starting a run is the supervisor's job (LP05), not this API's.
 */
export interface LocalWorldDeps { store: Store; authed: (minRole?: Role) => (req: FastifyRequest) => Promise<void> }

/**
 * LP06: exactly which local capabilities are reporting. One row per (source, asset, action) the source is DECLARED
 * to report (server-side source record: kind, scope, independence group), with what has actually arrived. Nothing
 * here is inferred from a payload; a declared capability with no event is "silent", a source whose latest health
 * record is sensor_unavailable is "unavailable", and coverage state comes from the existing coverage derivation.
 */
export function reportingView(store: Store, projectId: string) {
  const proj = store.getProject(projectId)!;
  const prov = provenanceOf(proj);
  const coverage = store.evaluation(projectId).coverage;
  const rows = store.db.prepare("SELECT source_id, action, asset_ids, COUNT(*) AS n, MAX(occurred_at) AS last_at FROM events WHERE project_id = ? GROUP BY source_id, action, asset_ids").all(projectId) as { source_id: string; action: string; asset_ids: string; n: number; last_at: string }[];
  const health = store.sourceState(projectId);
  const rejected = store.db.prepare("SELECT source_id, COUNT(*) AS n FROM rejections WHERE project_id = ? GROUP BY source_id").all(projectId) as { source_id: string; n: number }[];
  const sources = store.listSources(projectId).map((src) => {
    const cap = sourceCapabilities(src);
    const cov = coverage.find((c) => c.source_id === src.id);
    const lh = health[src.id]?.last_health;
    const unavailable = lh?.action === "sensor_unavailable";
    const capabilities = [...cap.assetIds].sort().flatMap((asset) => [...cap.actions].filter((a) => a !== "sensor_unavailable" && a !== "sensor_restored").sort().map((action) => {
      const hits = rows.filter((r) => r.source_id === src.id && r.action === action && (JSON.parse(r.asset_ids) as string[]).includes(asset));
      const n = hits.reduce((a, r) => a + Number(r.n), 0);
      const last = hits.map((r) => r.last_at).sort().at(-1) ?? null;
      return { asset_id: asset, action, events: n, last_event_at: last, status: src.disabled ? "disabled" : unavailable ? "unavailable" : n ? "reporting" : "silent" };
    }));
    return {
      source_id: src.id, label: src.label, kind: src.kind ?? "generic", role: src.kind === "effect_observer" ? "independent_observer" : "self_report",
      independence_group: cap.independenceGroup, identity_namespace: src.identity_namespace ?? null, run_namespace: src.run_namespace ?? null,
      coverage_state: cov?.state ?? "unknown", last_event_at: cov?.last_event_at ?? null, rejected: Number(rejected.find((r) => r.source_id === src.id)?.n ?? 0),
      health: unavailable ? { state: "unavailable", since: lh?.occurred_at ?? null, note: lh?.coverage_note ?? null, event_id: lh?.id ?? null } : lh ? { state: "restored", since: lh.occurred_at, event_id: lh.id } : { state: "no_outage_reported" },
      capabilities,
    };
  });
  const all = sources.flatMap((s) => s.capabilities);
  return {
    schema: "dk.local.reporting.v1", project_id: projectId, provenance: prov,
    summary: { sources: sources.length, capabilities: all.length, reporting: all.filter((c) => c.status === "reporting").length, silent: all.filter((c) => c.status === "silent").length, unavailable: all.filter((c) => c.status === "unavailable").length },
    sources,
    note: "Declared capabilities from registered source records; 'silent' means nothing has arrived, not that nothing happened.",
  };
}

export function registerLocalWorld(app: FastifyInstance, d: LocalWorldDeps) {
  app.get("/api/projects/:p/local-world/reporting", { preHandler: d.authed() }, async (req) => {
    const proj = d.store.require(req.principal!, (req.params as { p: string }).p, "viewer");
    return reportingView(d.store, proj.id);
  });

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
