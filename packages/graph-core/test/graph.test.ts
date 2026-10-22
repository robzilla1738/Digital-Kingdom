import { describe, expect, it } from "vitest";
import { GraphIndex, diffGraphs, graphAsOf, importCompose, importManifest, validateGraph } from "../src/index.ts";
import { demoGraph } from "../../../fixtures/testing/load.ts";

describe("graph validation", () => {
  it("accepts the demo graph", () => {
    const r = validateGraph(demoGraph());
    expect(r.errors).toEqual([]);
  });
  it("rejects duplicate assets and dangling relationships", () => {
    const g = demoGraph();
    g.assets.push({ ...g.assets[0]! });
    g.relationships.push({ id: "bad", source_id: "edge", target_id: "nope", kind: "calls", evidence_level: "declared", evidence_refs: ["x"] });
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(/duplicate asset id: edge/);
    expect(r.errors.join("\n")).toMatch(/target nope is not a known asset/);
  });
  it("checks provenance when evidence ids are known", () => {
    const r = validateGraph(demoGraph(), { knownEvidenceRefs: new Set(["something-else"]) });
    expect(r.ok).toBe(false);
  });
});

describe("GraphIndex", () => {
  it("resolves ids, names and aliases case-insensitively; ambiguous aliases resolve to nothing", () => {
    const g = demoGraph();
    g.assets.find((a) => a.id === "web")!.aliases = ["shared-alias"];
    g.assets.find((a) => a.id === "pay")!.aliases = ["shared-alias"];
    const idx = new GraphIndex(g);
    expect(idx.resolve("ORDERS-API")).toBe("api");
    expect(idx.resolve("order-worker-consumer")).toBe("worker");
    expect(idx.resolve("shared-alias")).toBeUndefined();
    expect(idx.resolve("unknown")).toBeUndefined();
  });
  it("bounded reachability", () => {
    const idx = new GraphIndex(demoGraph());
    expect(idx.reachable("edge")).toContain("db");
    expect(idx.reachable("edge", 1)).not.toContain("db");
  });
});

describe("temporal topology (E10, E11)", () => {
  it("historical replay keeps a since-removed asset", () => {
    const g = demoGraph();
    g.assets.push({ id: "legacy", name: "legacy-admin", kind: "service", environment: "demo", allowed_zone_ids: ["application"], source_refs: ["x"], lifecycle: "tombstoned", valid_to: "2026-10-20T13:30:00.000Z" });
    g.relationships.push({ id: "rel-legacy", source_id: "edge", target_id: "legacy", kind: "calls", evidence_level: "declared", evidence_refs: ["x"], valid_to: "2026-10-20T13:30:00.000Z" });
    expect(graphAsOf(g, "2026-10-20T13:00:00Z").assets.some((a) => a.id === "legacy")).toBe(true);
    expect(graphAsOf(g, "2026-10-20T14:00:00Z").assets.some((a) => a.id === "legacy")).toBe(false);
    expect(graphAsOf(g, "2026-10-20T14:00:00Z").relationships.some((r) => r.id === "rel-legacy")).toBe(false);
  });
  it("a redeploy changes deployment metadata, not identity", () => {
    const a = demoGraph(); const b = demoGraph();
    b.graph_revision = "demo-r4";
    b.assets.find((x) => x.id === "api")!.deployment = "orders-api@2026.10.21-1";
    const d = diffGraphs(a, b);
    expect(d.added).toEqual([]); expect(d.removed).toEqual([]); expect(d.changed).toEqual(["api"]);
  });
});

describe("importers (TK-015)", () => {
  const compose = `
services:
  proxy:
    image: nginx:1.27
    ports: ["443:443"]
    depends_on: [api]
  api:
    image: example/orders:1
    ports: ["8080"]
    environment:
      DATABASE_PASSWORD: super-secret
    labels:
      dk.kind: service
      dk.owner: orders-team
    depends_on:
      db: { condition: service_healthy }
  db:
    image: postgres:16
  jobs:
    build: ./jobs
    command: ["node", "run.js"]
`;
  it("reads only allowlisted keys and never environment values", () => {
    const r = importCompose(compose, { projectId: "p", environment: "local", revision: "r1" });
    expect(r.graph.assets.map((a) => [a.id, a.kind])).toEqual([["proxy", "edge"], ["api", "service"], ["db", "database"], ["jobs", "worker"]]);
    expect(JSON.stringify(r.graph)).not.toContain("super-secret");
    expect(r.ignoredKeys).toEqual(["command", "environment"]);
    expect(r.graph.relationships.map((x) => `${x.source_id}->${x.target_id}:${x.kind}`)).toEqual(["proxy->api:calls", "api->db:reads_from"]);
    expect(r.unresolved.some((u) => u.includes("jobs"))).toBe(true);
    expect(validateGraph(r.graph).ok).toBe(true);
  });
  it("refuses YAML alias bombs", () => {
    const bomb = "a: &a [x,x,x,x,x,x,x,x,x]\n" + Array.from({ length: 8 }, (_, i) => `${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [${Array(9).fill("*" + String.fromCharCode(97 + i)).join(",")}]`).join("\n") + "\nservices: {}\n";
    expect(() => importCompose(bomb, { projectId: "p", environment: "e", revision: "r" })).toThrow();
  });
  it("imports an explicit manifest", () => {
    const r = importManifest(`project: shop\nenvironment: prod\nassets:\n  - {id: edge, name: edge, kind: edge}\n  - {id: api, name: api, kind: service, owner: team}\nrelationships:\n  - {from: edge, to: api}\n  - {from: api, to: ghost}\n`, { revision: "r1" });
    expect(r.graph.assets).toHaveLength(2);
    expect(r.graph.relationships).toHaveLength(1);
    expect(r.unresolved).toHaveLength(1);
  });
});
