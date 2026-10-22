import { readFileSync } from "node:fs";
import type { Graph } from "@dk/contracts";
import type { Delivery, SourceConfig } from "@dk/detections";
import type { Store } from "./store.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/demo/${name}`, import.meta.url), "utf8"));

/**
 * Seed the isolated synthetic demo project. It is a separate project with dataset_kind "synthetic";
 * synthetic sources cannot write to live projects and vice versa. Deliveries go through the same
 * receive -> journal -> normalize path as live data (including the duplicate and rejected ones).
 */
export function seedDemo(store: Store, opts: { projectId?: string } = {}) {
  const id = opts.projectId ?? "demo-castle";
  if (store.getProject(id)) return { created: false };
  const graph = fixture("graph.json") as Graph;
  const sources = fixture("sources.json") as SourceConfig[];
  const deliveries = fixture("deliveries.json") as Delivery[];
  const meta = fixture("meta.json");
  store.createProject(id, meta.title, "synthetic", { description: meta.description, start: meta.start, end: meta.end, demo: true });
  store.putGraph(id, { ...graph, project_id: id }, "seed");
  for (const s of sources) store.upsertSource(id, { ...s, dataset_kind: "synthetic" }, "seed");
  for (const d of deliveries) store.receive(id, d.source_id, d.payload, d.received_at); // fixture receive times preserve the late delivery
  while (store.processBatch(500).processed) { /* drain */ }
  return { created: true, deliveries: deliveries.length };
}
