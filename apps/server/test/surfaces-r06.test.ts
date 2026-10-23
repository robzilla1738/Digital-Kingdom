import { describe, expect, it } from "vitest";
import { SURFACES, SUPPORT_LEVELS, surfaceForAsset } from "@dk/contracts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setup } from "./helpers.ts";

/** R06.2 capability-aware surface mappings. */
const MATRIX = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../docs/roadmap/forward-from-14d205f/SURFACE_EXPANSION_MATRIX.json"), "utf8")) as { surfaces: { id: string; presentation: string }[] };

describe("R06.2 surfaces", () => {
  it("all 28 surfaces are described with a machine-readable support level", async () => {
    expect(SURFACES.map((s) => s.id)).toEqual(MATRIX.surfaces.map((s) => s.id));
    for (const s of SURFACES) { expect(SUPPORT_LEVELS).toContain(s.support); expect(s.support_evidence.length).toBeGreaterThan(5); }
    const ctx = await setup();
    const r = (await ctx.app.inject({ url: "/api/surfaces", headers: ctx.h(ctx.viewer) })).json();
    expect(r.version).toBe("dk-surfaces-1");
    expect(r.surfaces).toHaveLength(28);
  });

  it("a drawn watchtower never implies a connected sensor", async () => {
    const ctx = await setup();
    const r = (await ctx.app.inject({ url: "/api/projects/demo-castle/surfaces", headers: ctx.h(ctx.viewer) })).json();
    const covered = new Set(ctx.store.health("demo-castle").coverage.flatMap((c) => c.asset_ids));
    for (const st of r.structures) {
      const towers = st.overlays.filter((o: { kind: string }) => o.kind === "watchtower");
      if (!covered.has(st.entity.id)) expect(towers).toEqual([]);
      for (const t of towers) expect(ctx.store.listSources("demo-castle").some((s) => s.id === t.entity.id && s.asset_ids.includes(st.entity.id))).toBe(true);
      expect(st.overlays.filter((o: { kind: string }) => o.kind === "shield")).toEqual([]); // no tested controls in the demo
    }
    expect(r.decorations.every((d: { selectable: boolean }) => d.selectable === false)).toBe(true);
    expect(r.boundaries[0].note).toMatch(/not an enforcement control/);
  });

  it("every selectable structure resolves to a permitted entity", async () => {
    const ctx = await setup();
    const r = (await ctx.app.inject({ url: "/api/projects/demo-castle/surfaces", headers: ctx.h(ctx.viewer) })).json();
    for (const st of r.structures.filter((x: { selectable: boolean }) => x.selectable)) expect((await ctx.app.inject({ url: `/api/projects/demo-castle/context?asset=${encodeURIComponent(st.entity.id)}`, headers: ctx.h(ctx.viewer) })).json().asset?.id ?? st.entity.id).toBe(st.entity.id);
    for (const st of r.structures) expect(ctx.store.getGraph("demo-castle")!.assets.some((a) => a.id === st.entity.id)).toBe(true);
    expect(surfaceForAsset({ kind: "pipeline", provider_ref: { scope: "github", id: "repository:1" } }).id).toBe("DK-S-repository");
    expect(surfaceForAsset({ kind: "storage" }).family).toBe("archive");
  });

  it("historical events keep their meaning under the richer surface model", async () => {
    const ctx = await setup();
    const before = ctx.store.listEvents("demo-castle", { limit: 200 }).map((e) => `${e.id}:${e.action}:${e.outcome}:${e.asset_ids.join(",")}`);
    await ctx.app.inject({ url: "/api/projects/demo-castle/surfaces", headers: ctx.h(ctx.viewer) });
    expect(ctx.store.listEvents("demo-castle", { limit: 200 }).map((e) => `${e.id}:${e.action}:${e.outcome}:${e.asset_ids.join(",")}`)).toEqual(before);
    const findings = ctx.store.listFindings("demo-castle").map((f) => `${f.id}@${f.revision}`);
    expect(ctx.store.listFindings("demo-castle").map((f) => `${f.id}@${f.revision}`)).toEqual(findings);
  });
});
