import { describe, expect, it } from "vitest";
import type { Graph } from "@dk/contracts";
import { HYPOTHETICAL_COLOR, pathVisible, relationshipMeaning, relationshipStyle, serviceInterior } from "./layers.ts";

/** R06.3 security layers, relationship meaning, interiors and focus modes. */
const layers = { runtime: true, identity: true, data: true, deployment: true, tools: true };
const p = (id: string, kind: string, level: string) => ({ relationship_id: id, source_asset_id: "api", target_asset_id: "db", kind, evidence_level: level });
const opts = (o: Partial<Parameters<typeof pathVisible>[1]> = {}) => ({ layers, showHypothetical: false, focusMode: "none" as const, focusAssets: new Set(["api"]), selectedId: null, ...o });

describe("R06.3 layers", () => {
  it("permissions remain distinguishable from observed activity", () => {
    const perm = relationshipMeaning("may_assume", "declared"), seen = relationshipMeaning("calls", "observed");
    expect(perm).toMatchObject({ category: "permission", note: expect.stringMatching(/not observed use/) });
    expect(seen.category).toBe("activity");
    expect(relationshipStyle("may_assume", "declared", "#fff").dashed).toBe(true);
    expect(relationshipStyle("may_assume", "observed", "#fff").dashed).toBe(true); // a used grant is still drawn as a permission
    expect(relationshipStyle("calls", "observed", "#fff").dashed).toBe(false);
  });
  it("hypothetical movement cannot look like recorded intrusion", () => {
    const st = relationshipStyle("calls", "hypothetical", "#FF0000");
    expect(st.color).toBe(HYPOTHETICAL_COLOR);
    expect(relationshipMeaning("calls", "hypothetical").label).toMatch(/not recorded/);
    expect(pathVisible(p("h", "calls", "hypothetical"), opts())).toBe(false);
    expect(pathVisible(p("h", "calls", "hypothetical"), opts({ focusMode: "change" }))).toBe(true);
  });
  it("focus modes filter without camera state; selection always stays visible", () => {
    expect(pathVisible(p("d", "calls", "declared"), opts({ focusMode: "evidence" }))).toBe(false);
    expect(pathVisible(p("o", "calls", "observed"), opts({ focusMode: "evidence" }))).toBe(true);
    expect(pathVisible(p("d", "calls", "declared"), opts({ focusMode: "evidence", selectedId: "d" }))).toBe(true);
    expect(pathVisible(p("r", "reads_from", "observed"), opts({ layers: { ...layers, data: false } }))).toBe(false);
  });
  it("service interiors expose routes, deployment, instances, permissions and tools as list data", () => {
    const g = { schema_version: "0.2", dataset_kind: "synthetic", project_id: "x", graph_revision: "1",
      assets: [{ id: "api", name: "api", kind: "service", environment: "prod", allowed_zone_ids: [], source_refs: [], instance_count: 3, routes: [{ path: "/orders/{id}", methods: ["GET"] }] }, { id: "ci", name: "ci", kind: "service", environment: "prod", allowed_zone_ids: [], source_refs: [] }, { id: "role", name: "api-role", kind: "identity", environment: "prod", allowed_zone_ids: [], source_refs: [] }, { id: "mail", name: "email.send", kind: "tool", environment: "prod", allowed_zone_ids: [], source_refs: [] }],
      relationships: [{ id: "1", source_id: "ci", target_id: "api", kind: "deploys", evidence_level: "declared", evidence_refs: [] }, { id: "2", source_id: "api", target_id: "role", kind: "runs_as", evidence_level: "declared", evidence_refs: [] }, { id: "3", source_id: "api", target_id: "mail", kind: "invokes_tool", evidence_level: "observed", evidence_refs: [] }] } as unknown as Graph;
    const i = serviceInterior(g, "api")!;
    expect(i.routes).toEqual([{ method: "GET", path: "/orders/{id}" }]);
    expect(i.deployed_by).toEqual([{ name: "ci", evidence: "declared" }]);
    expect(i.instances).toBe(3);
    expect(i.permissions[0]).toMatchObject({ label: "Permission: runs as", target: "api-role" });
    expect(i.tools[0]).toMatchObject({ tool: "email.send", meaning: expect.stringMatching(/use a source recorded/) });
  });
});
