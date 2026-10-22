import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** D1 from the v1 evaluation: an unsupported manifest asset kind returned HTTP 500. */
type Ctx = Awaited<ReturnType<typeof setup>>;
const yaml = (ctx: Ctx) => ({ ...ctx.h(ctx.admin), "content-type": "application/yaml" });
async function project(ctx: Ctx) {
  await ctx.app.inject({ method: "POST", url: "/api/projects", headers: ctx.h(ctx.admin), payload: { id: "imp", name: "imp", dataset_kind: "live" } });
  const ok = await ctx.app.inject({ method: "POST", url: "/api/projects/imp/graph?format=manifest&revision=r1", headers: yaml(ctx), payload: "assets:\n  - {id: api, kind: service}\n  - {id: db, kind: database}\nrelationships:\n  - {from: api, to: db, kind: reads_from}\n" });
  expect(ok.statusCode).toBe(200);
}
const state = (ctx: Ctx) => ({
  graph: ctx.store.getGraph("imp"), scene: ctx.store.getScene("imp")?.digest,
  revisions: ctx.db.prepare("SELECT COUNT(*) AS n FROM graph_revisions WHERE project_id = 'imp'").get(),
  scenes: ctx.db.prepare("SELECT COUNT(*) AS n FROM scenes WHERE project_id = 'imp'").get(),
});

describe("manifest import validation", () => {
  it("unsupported asset kind -> 422 with a field error, and nothing changes", async () => {
    const ctx = await setup(); await project(ctx);
    const before = state(ctx);
    const r = await ctx.app.inject({ method: "POST", url: "/api/projects/imp/graph?format=manifest&revision=r2", headers: yaml(ctx), payload: "assets:\n  - {id: api, kind: service}\n  - {id: fn, kind: lambda}\n" });
    expect(r.statusCode).toBe(422);
    const body = r.json();
    expect(body.error).toBe("manifest rejected");
    expect(body.details).toEqual([expect.stringMatching(/^\/assets\/1\/kind: unsupported asset kind "lambda"; allowed: .*service/)]);
    expect(state(ctx)).toEqual(before);
  });
  it("reports every problem at once, including relationship kinds", async () => {
    const ctx = await setup(); await project(ctx);
    const r = await ctx.app.inject({ method: "POST", url: "/api/projects/imp/graph?format=manifest&revision=r2", headers: yaml(ctx), payload: "assets:\n  - {kind: service}\n  - {id: x, kind: 7}\nrelationships:\n  - {from: a, to: b, kind: teleports_to}\n" });
    expect(r.statusCode).toBe(422);
    expect(r.json().details).toEqual([
      "/assets/0/id: must be a non-empty string",
      expect.stringMatching(/^\/assets\/1\/kind: unsupported asset kind 7/),
      expect.stringMatching(/^\/relationships\/0\/kind: unsupported relationship kind "teleports_to"/),
    ]);
  });
  it("structural and YAML errors are 422, not 500", async () => {
    const ctx = await setup(); await project(ctx);
    const before = state(ctx);
    for (const [payload, re] of [["just a string", /^\/: manifest must be a mapping/], ["project: x\n", /^\/assets: required/], ["assets: [\n", /^\/: /], ["assets: []\nrelationships: nope\n", /^\/relationships: must be a list/]] as const) {
      const r = await ctx.app.inject({ method: "POST", url: "/api/projects/imp/graph?format=manifest&revision=r9", headers: yaml(ctx), payload });
      expect(r.statusCode, payload).toBe(422);
      expect(r.json().details[0]).toMatch(re);
    }
    const c = await ctx.app.inject({ method: "POST", url: "/api/projects/imp/graph?format=compose&revision=r9", headers: yaml(ctx), payload: "services: [\n" });
    expect(c.statusCode).toBe(422);
    expect(state(ctx)).toEqual(before);
  });
  it("unexpected internal errors stay distinguishable (500, generic message)", async () => {
    const ctx = await setup(); await project(ctx);
    ctx.store.putGraph = () => { throw new Error("disk I/O error"); };
    const r = await ctx.app.inject({ method: "POST", url: "/api/projects/imp/graph?format=manifest&revision=r3", headers: yaml(ctx), payload: "assets:\n  - {id: api, kind: service}\n" });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: "internal error" });
  });
  it("a valid manifest still imports", async () => {
    const ctx = await setup(); await project(ctx);
    const r = await ctx.app.inject({ method: "POST", url: "/api/projects/imp/graph?format=manifest&revision=r4", headers: yaml(ctx), payload: "assets:\n  - {id: api, kind: service}\n  - {id: q, kind: worker}\n" });
    expect(r.statusCode).toBe(200);
    expect(ctx.store.getGraph("imp")!.graph_revision).toBe("r4");
  });
});
