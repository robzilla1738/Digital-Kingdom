import { describe, expect, it } from "vitest";
import type { Graph, SecurityEvent } from "@dk/contracts";
import { ASSET_INTERIOR, buildInterior } from "@dk/scene-compiler";
import { setup } from "./helpers.ts";

const P = "/api/projects/demo-castle";

describe("LP18 evidence-linked interiors (dk.asset_interior.v1)", () => {
  it("A1: every interior object opens its exact authoritative record and provenance (API), for every demo asset", async () => {
    const ctx = await setup();
    const graph = ctx.store.getGraph("demo-castle")!;
    const events = ctx.store.listEvents("demo-castle", { limit: 5000 });
    const sources = ctx.store.listSources("demo-castle");
    let objects = 0;
    for (const a of graph.assets) {
      const res = await ctx.app.inject({ url: `${P}/assets/${a.id}/interior`, headers: ctx.h(ctx.viewer) });
      expect(res.statusCode, a.id).toBe(200);
      const it = res.json();
      expect(it.schema).toBe(ASSET_INTERIOR);
      expect(it.asset_id).toBe(a.id);
      expect(it.graph_revision).toBe(graph.graph_revision);
      for (const o of it.objects) {
        objects++;
        expect(o.provenance.length, o.object_id).toBeGreaterThan(0);
        if (o.record.type === "relationship") {
          const r = graph.relationships.find((x) => x.id === o.record.id)!;
          expect(r, o.object_id).toBeTruthy();
          expect(o.record.body).toMatchObject({ id: r.id, source_id: r.source_id, target_id: r.target_id, kind: r.kind, evidence_level: r.evidence_level });
        } else if (o.record.type === "event" && !o.object_id.startsWith("run:")) {
          const e = events.find((x) => x.id === o.record.id)!;
          expect(e, o.object_id).toBeTruthy();
          expect(o.record.body).toMatchObject({ id: e.id, source_id: e.source_id, occurred_at: e.occurred_at, action: e.action, outcome: e.outcome });
          expect(e.asset_ids).toContain(a.id);
        } else if (o.record.type === "source") {
          const s = sources.find((x) => x.id === o.record.id)!;
          expect(s.asset_ids).toContain(a.id);
          expect(o.record.body.label).toBe(s.label);
        } else if (o.record.type === "artifact_reference") {
          expect(o.record.body.reference).toBe(a.deployment);
        }
        // the label is copied from records, never a generated narrative
        expect(o.label.length).toBeLessThan(400);
      }
    }
    expect(objects).toBeGreaterThan(10);
    expect((await ctx.app.inject({ url: `${P}/assets/no-such-asset/interior`, headers: ctx.h(ctx.viewer) })).statusCode).toBe(404);
    expect((await ctx.app.inject({ url: `${P}/assets/api/interior` })).statusCode).toBe(401);
  });

  it("A2: declared/configured links are never transit, and every status is text plus a glyph (never colour only)", async () => {
    const ctx = await setup();
    const graph = ctx.store.getGraph("demo-castle")!;
    for (const a of graph.assets) {
      const it = (await ctx.app.inject({ url: `${P}/assets/${a.id}/interior`, headers: ctx.h(ctx.viewer) })).json();
      for (const o of it.objects) {
        // transit only for observed records; a coverage source is never transit
        if (o.draw.transit) expect(o.basis, o.object_id).toBe("observed");
        if (o.basis !== "observed" || o.kind === "source") expect(o.draw.transit, o.object_id).toBe(false);
        if (o.basis === "declared" || o.basis === "configured") expect(o.draw.line).toMatch(/^patterned_/);
        expect(o.status.text.length).toBeGreaterThan(10);
        expect(o.status.glyph).toBeTruthy();
      }
    }
    // a declared relationship is labelled as declared, not observed
    const declared = graph.relationships.find((r) => r.kind === "reads_from" && r.evidence_level === "declared");
    if (declared) {
      const it = (await ctx.app.inject({ url: `${P}/assets/${declared.target_id}/interior`, headers: ctx.h(ctx.viewer) })).json();
      const o = it.objects.find((x: { record: { id: string } }) => x.record.id === declared.id);
      expect(o.basis).toBe("declared"); expect(o.draw.transit).toBe(false);
      expect(o.status.text).toMatch(/Declared data relationship/);
    }
    // controls registry present -> no controls "unavailable"; grants with no snapshot are unknown, never absent
    const anyProvider = graph.assets.find((a) => a.provider_ref);
    if (anyProvider) {
      const it = (await ctx.app.inject({ url: `${P}/assets/${anyProvider.id}/interior`, headers: ctx.h(ctx.viewer) })).json();
      expect(it.unavailable.some((u: { what: string }) => u.what === "grants and credentials")).toBe(true);
    }
  });

  it("A3: decisions, executions and effects stay distinct objects with independent evidence; a self-reported effect is not an effect", () => {
    const graph: Graph = { schema_version: "0.2", dataset_kind: "synthetic", project_id: "p", graph_revision: "r1",
      assets: [{ id: "bot", name: "support-agent", kind: "agent", environment: "lab", allowed_zone_ids: ["automation"], source_refs: ["fixture:lp18"] }], relationships: [] } as Graph;
    const base = { schema_version: "0.2", dataset_kind: "synthetic", project_id: "p", asset_ids: ["bot"], received_at: "2026-10-20T14:00:01Z", evidence_refs: [] } as const;
    const ev = (id: string, extra: Partial<SecurityEvent>): SecurityEvent => ({ ...base, id, source_id: "agent-log", source_event_id: id, action: "tool_invocation", outcome: "success", occurred_at: "2026-10-20T14:00:00Z", ...extra } as SecurityEvent);
    const events = [
      ev("d1", { run_id: "run-1", agent: { phase: "decision", origin: "runtime_self_report", tool: "refund" } as SecurityEvent["agent"] }),
      ev("x1", { run_id: "run-1", agent: { phase: "execution", origin: "tool_wrapper", tool: "refund" } as SecurityEvent["agent"] }),
      ev("f-self", { run_id: "run-1", agent: { phase: "effect", origin: "runtime_self_report", tool: "refund" } as SecurityEvent["agent"] }),
      ev("f-obs", { source_id: "ledger-audit", action: "side_effect_observed", run_id: "run-1" }),
    ];
    const it = buildInterior({ project_id: "p", graph, asset_id: "bot", events, sources: [], coverage: [], controls: null, grants: null })!;
    const kinds = Object.fromEntries(it.objects.filter((o) => o.record.type === "event" && !o.object_id.startsWith("run:")).map((o) => [o.record.id, o.kind]));
    expect(kinds).toEqual({ d1: "decision", x1: "execution", "f-obs": "effect" });
    const effect = it.objects.find((o) => o.kind === "effect")!;
    expect(effect.provenance).toContain("source:ledger-audit");
    expect(it.objects.find((o) => o.object_id === "run:run-1")!.status.text).toMatch(/correlation is not causation/);
    expect(it.unavailable.map((u) => u.what)).toContain("controls");
  });
});
