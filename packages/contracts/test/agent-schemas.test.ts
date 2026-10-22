import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020Mod from "ajv/dist/2020.js";
import { setup } from "../../../apps/server/test/helpers.ts";

/** Live server responses conform to the agent-facing response contracts in schemas/agent/. */
const Ajv2020 = (Ajv2020Mod as unknown as { default?: typeof Ajv2020Mod }).default ?? Ajv2020Mod;
const ajv = new (Ajv2020 as unknown as new (o: object) => { compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown } })({ allErrors: true, strict: false });
const load = (n: string) => ajv.compile(JSON.parse(readFileSync(join(import.meta.dirname, "../schemas/agent", n), "utf8")));
const V = { search: load("event-search.v1.schema.json"), detail: load("event-detail.v1.schema.json"), assess: load("change-assessment.v2.schema.json"), error: load("validation-error.schema.json") };
const ok = (v: ReturnType<typeof load>, d: unknown) => { const r = v(d); if (!r) console.error(JSON.stringify(v.errors, null, 2)); return r; };

describe("agent response contracts", () => {
  it("event search, event detail, change assessment and validation errors match their schemas", async () => {
    const ctx = await setup();
    const evs = ctx.store.listEvents("demo-castle", { limit: 50_000 });
    expect(evs.length).toBeGreaterThan(0);
    const t = evs.map((e) => Date.parse(e.occurred_at));
    const q = new URLSearchParams({ after: new Date(Math.min(...t) - 1000).toISOString(), before: new Date(Math.min(Math.max(...t) + 1000, Math.min(...t) + 30 * 86_400_000)).toISOString(), limit: "20" });
    const s = (await ctx.app.inject({ method: "GET", url: `/api/projects/demo-castle/events/search?${q}`, headers: ctx.h(ctx.viewer) })).json();
    expect(ok(V.search, s)).toBe(true);
    const d = (await ctx.app.inject({ method: "GET", url: `/api/projects/demo-castle/events/${s.events[0].id}`, headers: ctx.h(ctx.viewer) })).json();
    expect(ok(V.detail, d)).toBe(true);
    for (const body of [{ asset_ids: ["storefront-web"] }, { asset_ids: ["public-edge", "ghost"] }, { asset_ids: ["ghost"] }]) {
      const a = (await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/assess-change", headers: ctx.h(ctx.viewer), payload: body })).json();
      expect(ok(V.assess, a)).toBe(true);
    }
    const e = (await ctx.app.inject({ method: "GET", url: "/api/projects/demo-castle/events/search?after=nope", headers: ctx.h(ctx.viewer) })).json();
    expect(ok(V.error, e)).toBe(true);
    const v2 = (await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/assess-change", headers: ctx.h(ctx.viewer), payload: { asset_ids: ["storefront-web"] } })).json() as Record<string, unknown>;
    expect(V.assess({ ...v2, assessment_complete: true })).toBe(false); // the removed v1 field is rejected by the v2 contract
    expect(V.assess({ ...v2, favorable: true, evidence_sufficiency: { sufficient: false, insufficient_targets: [] } })).toBe(false); // favorable requires sufficiency
  });
});
