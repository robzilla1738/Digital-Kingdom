import { describe, expect, it } from "vitest";
import { graphAsOf } from "@dk/graph-core";
import type { Graph } from "@dk/contracts";
import { setup } from "./helpers.ts";

/** R01.1 versioned domain facts: bitemporal assertions, entity incarnations, conflicts and reconciliation. */
type Ctx = Awaited<ReturnType<typeof setup>>;
const T = (h: number) => new Date(Date.parse("2026-10-01T00:00:00Z") + h * 3600_000).toISOString();

const asset = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, kind: "service", environment: "prod", allowed_zone_ids: ["application"], source_refs: ["manifest"], ...extra });
const graph = (rev: string, createdAt: string, assets: Record<string, unknown>[]): Graph => ({ schema_version: "0.2", dataset_kind: "live", project_id: "facts", graph_revision: rev, created_at: createdAt, assets, relationships: [] } as unknown as Graph);

async function project() {
  const clock = { t: Date.parse(T(0)) };
  const ctx = await setup({ store: { now: () => new Date(clock.t) } });
  await ctx.app.inject({ method: "POST", url: "/api/projects", headers: ctx.h(ctx.admin), payload: { id: "facts", name: "Facts", dataset_kind: "live" } });
  const put = async (g: Graph) => { const r = await ctx.app.inject({ method: "POST", url: "/api/projects/facts/graph", headers: ctx.h(ctx.admin), payload: g }); expect(r.statusCode, r.body).toBe(200); };
  const view = async (q = "") => { const r = await ctx.app.inject({ url: `/api/projects/facts/facts${q}`, headers: ctx.h(ctx.viewer) }); expect(r.statusCode, r.body).toBe(200); return r.json(); };
  return { ctx, clock, put, view };
}
const ids = (v: { entities: { kind: string; app_id: string }[] }) => v.entities.filter((e) => e.kind === "asset").map((e) => e.app_id).sort();
const q = (o: Record<string, string>) => "?" + new URLSearchParams(o).toString();

describe("R01.1 bitemporal history", () => {
  it("late configuration discovery changes what is known without rewriting what was known earlier", async () => {
    const { clock, put, view } = await project();
    clock.t = Date.parse(T(1));
    await put(graph("r1", T(1), [asset("api", { owner: "team-a" })]));
    const knownBefore = T(2);
    clock.t = Date.parse(T(5));
    // discovered at T5: a legacy service that has existed since T0.5, and the api changed owner at T5
    await put(graph("r2", T(5), [asset("api", { owner: "team-b" }), asset("legacy", { valid_from: new Date(Date.parse(T(0)) + 1800_000).toISOString() })]));
    const thenAsKnownThen = await view(q({ valid_at: T(1), known_at: knownBefore }));
    expect(ids(thenAsKnownThen)).toEqual(["api"]);
    expect(thenAsKnownThen.entities[0].attributes.owner.value).toBe("team-a");
    const thenAsKnownNow = await view(q({ valid_at: T(1) }));
    expect(ids(thenAsKnownNow)).toEqual(["api", "legacy"]);
    expect(thenAsKnownNow.entities.find((e: { app_id: string }) => e.app_id === "api").attributes.owner.value).toBe("team-a"); // the change is not back-dated
    const now = await view();
    expect(now.entities.find((e: { app_id: string }) => e.app_id === "api").attributes.owner.value).toBe("team-b");
    // nothing known at T2 was rewritten
    expect(await view(q({ valid_at: T(1), known_at: knownBefore }))).toEqual(thenAsKnownThen);
  });

  it("a deleted and recreated resource with the same name is a new incarnation, not silently the same identity", async () => {
    const { ctx, clock, put, view } = await project();
    clock.t = Date.parse(T(1)); await put(graph("r1", T(1), [asset("api"), asset("cache")]));
    clock.t = Date.parse(T(2)); await put(graph("r2", T(2), [asset("api")]));
    clock.t = Date.parse(T(3)); await put(graph("r3", T(3), [asset("api"), asset("cache")]));
    const now = await view();
    const cache = now.entities.find((e: { app_id: string }) => e.app_id === "cache");
    expect(cache).toMatchObject({ entity_ref: "ent:facts:asset:cache#2", incarnation: 2, exists: true });
    const hist = (await ctx.app.inject({ url: `/api/projects/facts/facts/entities/${encodeURIComponent("ent:facts:asset:cache")}`, headers: ctx.h(ctx.viewer) })).json();
    expect(hist.incarnations.map((i: { incarnation: number }) => i.incarnation)).toEqual([1, 2]);
    expect(hist.assertions.filter((a: { attribute: string }) => a.attribute === "exists").map((a: { value: boolean }) => a.value)).toEqual([true, false]);
    const during = await view(q({ valid_at: new Date(Date.parse(T(2)) + 60_000).toISOString() }));
    expect(ids(during)).toEqual(["api"]);
    const before = await view(q({ valid_at: new Date(Date.parse(T(1)) + 60_000).toISOString() }));
    expect(before.entities.find((e: { app_id: string }) => e.app_id === "cache").entity_ref).toBe("ent:facts:asset:cache");
  });

  it("a different provider id under the same asset id is a new entity; the same provider id coming back is the same one", async () => {
    const { put, clock, view } = await project();
    const pr = (id: string) => ({ provider_ref: { scope: "aws:111111111111:us-east-1", id } });
    clock.t = Date.parse(T(1)); await put(graph("r1", T(1), [asset("db", pr("arn:db-1"))]));
    clock.t = Date.parse(T(2)); await put(graph("r2", T(2), [asset("db", pr("arn:db-2"))]));
    let v = await view();
    expect(v.entities.find((e: { app_id: string }) => e.app_id === "db")).toMatchObject({ incarnation: 2, provider_ref: { id: "arn:db-2" } });
    clock.t = Date.parse(T(3)); await put(graph("r3", T(3), [asset("other")]));
    clock.t = Date.parse(T(4)); await put(graph("r4", T(4), [asset("db", pr("arn:db-2"))]));
    v = await view();
    expect(v.entities.find((e: { app_id: string }) => e.app_id === "db")).toMatchObject({ incarnation: 2, exists: true });
  });

  it("graph history and the current view agree for equivalent temporal inputs", async () => {
    const { put, clock, view } = await project();
    const g = graph("r1", T(0), [
      asset("always"),
      asset("from2", { valid_from: T(2) }),
      asset("until3", { valid_to: T(3) }),
      asset("window", { valid_from: T(1), valid_to: T(4) }),
    ]);
    clock.t = Date.parse(T(10)); await put(g);
    for (const h of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5]) {
      const t = new Date(Date.parse(T(0)) + h * 3600_000).toISOString();
      expect(ids(await view(q({ valid_at: t }))), `at ${t}`).toEqual(graphAsOf(g, t).assets.map((a) => a.id).sort());
    }
  });

  it("re-importing an unchanged graph records nothing new", async () => {
    const { ctx, put, clock } = await project();
    clock.t = Date.parse(T(1)); await put(graph("r1", T(1), [asset("api", { owner: "a" })]));
    const n = () => (ctx.db.prepare("SELECT COUNT(*) AS n FROM assertions WHERE project_id = 'facts'").get() as { n: number }).n;
    const before = n();
    clock.t = Date.parse(T(2)); await put(graph("r2", T(2), [asset("api", { owner: "a" })]));
    expect(n()).toBe(before);
  });
});

describe("R01.1 conflicts are kept and reconciled explicitly", () => {
  it("declared and observed configuration that disagree stay a conflict until an attributed decision", async () => {
    const { ctx, clock, put, view } = await project();
    clock.t = Date.parse(T(1)); await put(graph("r1", T(1), [asset("api", { owner: "team-a" })]));
    clock.t = Date.parse(T(2));
    const posted = await ctx.app.inject({ method: "POST", url: "/api/projects/facts/facts/assertions", headers: ctx.h(ctx.admin), payload: { kind: "asset", app_id: "api", assertion_type: "observed_config", source_ref: "aws-config", attribute: "owner", value: "team-b", valid_from: T(1.5), observed_at: T(1.9) } });
    expect(posted.statusCode, posted.body).toBe(200);
    const c = (await ctx.app.inject({ url: "/api/projects/facts/facts/conflicts", headers: ctx.h(ctx.viewer) })).json();
    expect(c.conflicts).toHaveLength(1);
    expect(c.conflicts[0].candidates.map((x: { source_ref: string; value: string }) => `${x.source_ref}=${x.value}`).sort()).toEqual(["aws-config=team-b", "graph=team-a"]);
    // before the observation took effect there is no conflict
    expect((await view(q({ valid_at: T(1.2) }))).conflicts).toBe(0);
    clock.t = Date.parse(T(3));
    const chosen = c.conflicts[0].candidates.find((x: { source_ref: string }) => x.source_ref === "aws-config").assertion_id;
    const rec = (body: Record<string, unknown>) => ctx.app.inject({ method: "POST", url: "/api/projects/facts/facts/reconciliations", headers: ctx.h(ctx.analyst), payload: { entity_ref: "ent:facts:asset:api", attribute: "owner", chosen_assertion_id: chosen, rationale: "IAM tags are authoritative for ownership", ...body } });
    expect((await rec({})).statusCode).toBe(428);
    expect((await rec({ expected_version: 0 })).statusCode).toBe(200);
    expect((await rec({ expected_version: 0 })).statusCode).toBe(409); // a second analyst from the same base
    const after = await view();
    expect(after.entities[0].attributes.owner).toMatchObject({ state: "reconciled", value: "team-b", reconciliation: { decided_by: expect.stringContaining("analyst") } });
    // the decision is not back-dated into what was known before it
    expect((await view(q({ known_at: new Date(Date.parse(T(2)) + 60_000).toISOString() }))).entities[0].attributes.owner.state).toBe("conflict");
    // a later graph change makes the decision stale and the conflict reappears
    clock.t = Date.parse(T(4)); await put(graph("r2", T(4), [asset("api", { owner: "team-c" })]));
    const latest = await view();
    expect(latest.entities[0].attributes.owner.state).toBe("reconciled"); // team-b observation still chosen and current
    clock.t = Date.parse(T(5));
    await ctx.app.inject({ method: "POST", url: "/api/projects/facts/facts/assertions", headers: ctx.h(ctx.admin), payload: { kind: "asset", app_id: "api", assertion_type: "observed_config", source_ref: "aws-config", attribute: "owner", value: "team-d", valid_from: T(4.5) } });
    const stale = await view();
    expect(stale.entities[0].attributes.owner).toMatchObject({ state: "conflict", stale_reconciliation: { reason: expect.stringMatching(/no longer current/) } });
  });

  it("assertion input is validated and role-checked", async () => {
    const { ctx, clock, put } = await project();
    clock.t = Date.parse(T(1)); await put(graph("r1", T(1), [asset("api")]));
    const post = (payload: Record<string, unknown>, token = ctx.admin) => ctx.app.inject({ method: "POST", url: "/api/projects/facts/facts/assertions", headers: ctx.h(token), payload });
    const base = { kind: "asset", app_id: "api", assertion_type: "observed_config", source_ref: "scanner", attribute: "owner", value: "x", valid_from: T(1) };
    expect((await post({ ...base, source_ref: "graph" })).statusCode).toBe(400);
    expect((await post({ ...base, assertion_type: "fact" })).statusCode).toBe(400);
    expect((await post({ ...base, valid_from: "yesterday" })).statusCode).toBe(400);
    expect((await post({ ...base, valid_to: T(0) })).statusCode).toBe(400);
    expect((await post({ ...base, attribute: "Owner Name" })).statusCode).toBe(400);
    expect((await post({ ...base, app_id: "ghost" })).statusCode).toBe(404);
    expect((await post({ ...base, value: "x".repeat(9000) })).statusCode).toBe(413);
    expect((await post(base, ctx.analyst)).statusCode).toBe(403);
    expect((await ctx.app.inject({ url: "/api/projects/facts/facts?valid_at=nope", headers: ctx.h(ctx.viewer) })).statusCode).toBe(400);
  });
});

describe("R01.1 legacy projects", () => {
  it("projects created before fact history are backfilled with legacy, unknown provenance", async () => {
    const ctx: Ctx = await setup();
    ctx.db.exec("DELETE FROM assertions; DELETE FROM entities;"); // the demo as it existed before migration 6
    const v = (await ctx.app.inject({ url: "/api/projects/demo-castle/facts", headers: ctx.h(ctx.viewer) })).json();
    expect(v.entities.filter((e: { kind: string }) => e.kind === "asset")).toHaveLength(ctx.store.getGraph("demo-castle")!.assets.length);
    const h = (await ctx.app.inject({ url: `/api/projects/demo-castle/facts/entities/${encodeURIComponent("ent:demo-castle:asset:api")}`, headers: ctx.h(ctx.viewer) })).json();
    expect(h.assertions[0]).toMatchObject({ method: "legacy_backfill", provenance: { note: expect.stringMatching(/observation time unknown/) } });
  });
});
