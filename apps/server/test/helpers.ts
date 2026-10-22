import { openDb } from "../src/db.ts";
import { Store, type StoreOptions } from "../src/store.ts";
import { buildApp } from "../src/app.ts";
import { seedDemo } from "../src/seed.ts";
import type { ModelCall } from "@dk/scene-compiler";

export async function setup(opts: { demoMode?: boolean; store?: StoreOptions; planner?: ModelCall | null; dbPath?: string } = {}) {
  const db = openDb(opts.dbPath ?? ":memory:");
  const store = new Store(db, opts.store);
  seedDemo(store);
  const admin = store.createToken("admin", "admin").token;
  const analyst = store.createToken("analyst", "analyst").token;
  const viewer = store.createToken("viewer", "viewer").token;
  const app = await buildApp({ store, secret: "test-secret", demoMode: opts.demoMode ?? false, planner: opts.planner ?? null, webDist: "/nonexistent", ssePollMs: 20 });
  const h = (t: string) => ({ authorization: `Bearer ${t}` });
  return { db, store, app, admin, analyst, viewer, h };
}

export function liveGraph(project = "shop") {
  return {
    schema_version: "0.2", dataset_kind: "live", project_id: project, graph_revision: "r1",
    assets: [
      { id: "edge", name: "edge-proxy", kind: "edge", environment: "prod", allowed_zone_ids: ["public"], source_refs: ["manifest"] },
      { id: "api", name: "checkout-api", kind: "service", environment: "prod", allowed_zone_ids: ["application"], source_refs: ["manifest"], aliases: ["checkout"] },
      { id: "db", name: "checkout-db", kind: "database", environment: "prod", allowed_zone_ids: ["data"], source_refs: ["manifest"] },
    ],
    relationships: [
      { id: "r1", source_id: "edge", target_id: "api", kind: "calls", evidence_level: "declared", evidence_refs: ["manifest"] },
      { id: "r2", source_id: "api", target_id: "db", kind: "reads_from", evidence_level: "declared", evidence_refs: ["manifest"] },
    ],
  };
}
