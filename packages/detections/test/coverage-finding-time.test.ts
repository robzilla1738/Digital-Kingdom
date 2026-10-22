import { describe, expect, it } from "vitest";
import { evaluate } from "../src/index.ts";
import type { Graph, SecurityEvent } from "@dk/contracts";

// Regression (pilot, 2026-10-22): a stale-source finding has no events, so it was stamped with the Unix
// epoch (shown as 00:00:00 and sorted first) and labelled "synthetic" even in a live project.
const graph = { schema_version: "0.2", project_id: "p", revision: "r1", environment: "staging", assets: [{ id: "db", name: "db", kind: "database" }], relationships: [] } as unknown as Graph;
const ev: SecurityEvent = { id: "ev-1", project_id: "p", source_id: "db-audit", source_event_id: "a", dataset_kind: "live", occurred_at: "2026-10-22T10:00:00.000Z", received_at: "2026-10-22T10:00:01.000Z", asset_ids: ["db"], action: "data_access", outcome: "success", evidence_refs: [] } as unknown as SecurityEvent;

describe("coverage-loss finding timing and dataset kind", () => {
  it("uses the derived moment the source went stale and the project's dataset kind", () => {
    const r = evaluate(graph, [ev], { sources: [{ id: "db-audit", label: "db audit", asset_ids: ["db"], stale_after_seconds: 3 }], now: "2026-10-22T10:05:00.000Z" });
    const f = r.findings.find((x) => x.kind === "coverage_loss")!;
    expect(f).toBeDefined();
    expect(f.event_ids).toEqual([]);
    expect(f.first_seen).toBe("2026-10-22T10:00:04.000Z");
    expect(Date.parse(f.first_seen)).toBeGreaterThan(0);
    expect(f.dataset_kind).toBe("live");
    // stable across later sweeps (no revision churn from a moving "now")
    const r2 = evaluate(graph, [ev], { sources: [{ id: "db-audit", label: "db audit", asset_ids: ["db"], stale_after_seconds: 3 }], now: "2026-10-22T11:00:00.000Z" });
    expect(r2.findings.find((x) => x.kind === "coverage_loss")!.first_seen).toBe(f.first_seen);
  });
});
