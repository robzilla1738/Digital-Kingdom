import { describe, expect, it } from "vitest";
import { validateEventSchema, validateGraphSchema, validateIngestEventSchema, validateSceneProposalSchema, canonicalJson, digest, stableId } from "../src/index.ts";
import { demoGraph, legacyExample } from "../../../fixtures/testing/load.ts";

describe("contracts", () => {
  it("accepts the blueprint v0.1 examples (backward compatible)", () => {
    expect(validateGraphSchema(legacyExample("graph.json")).ok).toBe(true);
    expect(validateSceneProposalSchema(legacyExample("scene-proposal.json")).ok).toBe(true);
    for (const e of legacyExample("events.json")) expect(validateEventSchema(e).errors).toEqual([]);
  });
  it("accepts the v0.2 demo graph", () => {
    expect(validateGraphSchema(demoGraph()).errors).toEqual([]);
  });
  it("rejects unknown fields and bad ids", () => {
    const g = demoGraph() as unknown as Record<string, unknown>;
    expect(validateGraphSchema({ ...g, extra: 1 }).ok).toBe(false);
    expect(validateIngestEventSchema({ source_event_id: "x y", occurred_at: "2026-01-01T00:00:00Z", asset_ids: ["a"], action: "authentication", outcome: "success" }).ok).toBe(false);
    expect(validateIngestEventSchema({ source_event_id: "x", occurred_at: "not-a-date", asset_ids: ["a"], action: "authentication", outcome: "success" }).ok).toBe(false);
  });
  it("bounds attribute cardinality", () => {
    const attributes = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, "v"]));
    expect(validateIngestEventSchema({ source_event_id: "x", occurred_at: "2026-01-01T00:00:00Z", asset_ids: ["a"], action: "authentication", outcome: "success", attributes }).ok).toBe(false);
  });
  it("canonical json and digests are order independent", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }));
    expect(stableId("ev", "p", "s", "1")).toBe(stableId("ev", "p", "s", "1"));
    expect(stableId("ev", "p", "s", "1")).not.toBe(stableId("ev", "p", "s", "2"));
  });
});

describe("precompiled validators", () => {
  it("are in sync with the schemas", async () => {
    const { readFileSync } = await import("node:fs");
    const { execFileSync } = await import("node:child_process");
    const file = new URL("../src/generated/validators.js", import.meta.url);
    const before = readFileSync(file, "utf8");
    execFileSync(process.execPath, ["--import", "tsx", new URL("../scripts/generate-validators.ts", import.meta.url).pathname], { stdio: "pipe" });
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});
