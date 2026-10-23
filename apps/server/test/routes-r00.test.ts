import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";
import { matchDeclaredRoutes, parseRouteTarget, templateMatches, importManifest } from "@dk/graph-core";
import type { Graph } from "@dk/contracts";
import { validateGraph } from "@dk/graph-core";

/**
 * R00.3 route resolution. Under the previous resolver an unqualified route picked the asset with the most
 * matching events in the latest 20,000-event window. These cases pin the replacement behaviour:
 * declared inventory first, every candidate reported, inferred ownership labelled and never favorable.
 */
type Ctx = Awaited<ReturnType<typeof setup>>;

const graph = (): Graph => ({
  schema_version: "0.2", dataset_kind: "live", project_id: "routes", graph_revision: "r1",
  assets: [
    { id: "edge", name: "edge-proxy", kind: "edge", environment: "prod", allowed_zone_ids: ["public"], source_refs: ["manifest"] },
    { id: "accounts", name: "accounts-api", kind: "service", environment: "prod", allowed_zone_ids: ["application"], source_refs: ["manifest"],
      routes: [{ path: "/login", methods: ["POST"], hosts: ["accounts.example.com"] }, { path: "/users/{id}" }] },
    { id: "partners", name: "partners-api", kind: "service", environment: "prod", allowed_zone_ids: ["application"], source_refs: ["manifest"],
      routes: [{ path: "/login", hosts: ["partners.example.com"] }, { path: "/legacy/export" }] },
    { id: "accounts-stg", name: "accounts-api-staging", kind: "service", environment: "staging", allowed_zone_ids: ["application"], source_refs: ["manifest"],
      routes: [{ path: "/login" }] },
    { id: "reports", name: "reports-api", kind: "service", environment: "prod", allowed_zone_ids: ["application"], source_refs: ["manifest"] },
  ],
  relationships: [],
});

async function project(opts: { loginEventsOnPartners?: number } = {}) {
  const ctx = await setup();
  const { app, admin, h } = ctx;
  await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "routes", name: "Routes", dataset_kind: "live" } });
  const g = await app.inject({ method: "POST", url: "/api/projects/routes/graph", headers: h(admin), payload: graph() });
  expect(g.statusCode).toBe(200);
  const key = (await app.inject({ method: "POST", url: "/api/projects/routes/sources", headers: h(admin), payload: { id: "app", label: "App logs", kind: "app_security", asset_ids: ["edge", "accounts", "partners", "accounts-stg", "reports"] } })).json().key as string;
  const evs: Record<string, unknown>[] = [];
  const now = Date.now();
  // The busier service is partners-api: the old resolver would have chosen it for /login.
  for (let i = 0; i < (opts.loginEventsOnPartners ?? 40); i++) evs.push({ source_event_id: `p-${i}`, occurred_at: new Date(now - 60_000 + i).toISOString(), asset_ids: ["partners"], action: "request_received", outcome: "success", route: "/login" });
  evs.push({ source_event_id: "a-1", occurred_at: new Date(now - 50_000).toISOString(), asset_ids: ["accounts"], action: "request_received", outcome: "success", route: "/login" });
  evs.push({ source_event_id: "r-1", occurred_at: new Date(now - 40_000).toISOString(), asset_ids: ["reports"], action: "request_received", outcome: "success", route: "/reports/daily" });
  evs.push({ source_event_id: "r-2", occurred_at: new Date(now - 40_000).toISOString(), asset_ids: ["edge"], action: "request_received", outcome: "success", route: "/shared/health" });
  evs.push({ source_event_id: "r-3", occurred_at: new Date(now - 40_000).toISOString(), asset_ids: ["reports"], action: "request_received", outcome: "success", route: "/shared/health" });
  const r = await app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${key}` }, payload: { events: evs } });
  expect(r.statusCode).toBeLessThan(300);
  while (ctx.store.processBatch().processed) { /* drain */ }
  return ctx;
}
const assess = async (ctx: Ctx, body: Record<string, unknown>) => {
  const r = await ctx.app.inject({ method: "POST", url: "/api/projects/routes/assess-change", headers: ctx.h(ctx.viewer), payload: body });
  expect(r.statusCode).toBe(200);
  return r.json();
};
const context = (ctx: Ctx, qs: string) => ctx.app.inject({ url: `/api/projects/routes/context?${qs}`, headers: ctx.h(ctx.viewer) });

describe("R00.3 route identity helpers", () => {
  it("parses method, host and path and strips scheme, query and trailing slash", () => {
    expect(parseRouteTarget("POST https://Accounts.example.com/login/?next=/x")).toEqual({ method: "POST", host: "accounts.example.com", path: "/login" });
    expect(parseRouteTarget("/login", "prod")).toEqual({ path: "/login", environment: "prod" });
    expect(parseRouteTarget("FETCH /login")).toBeNull();
    expect(parseRouteTarget("login")).toBeNull();
  });
  it("matches declared templates by segment, never by prefix", () => {
    expect(templateMatches("/users/{id}", "/users/42")).toBe(true);
    expect(templateMatches("/users/:id", "/users/42")).toBe(true);
    expect(templateMatches("/users/{id}", "/users/42/delete")).toBe(false);
    expect(templateMatches("/login", "/login-legacy")).toBe(false);
    expect(templateMatches("/api/*", "/api/v1/x")).toBe(true);
  });
  it("an unqualified /login returns every owner; method, host and environment narrow it", () => {
    const g = graph();
    expect(matchDeclaredRoutes(g, { path: "/login" }).map((m) => m.asset_id).sort()).toEqual(["accounts", "accounts-stg", "partners"]);
    expect(matchDeclaredRoutes(g, { path: "/login", environment: "prod" }).map((m) => m.asset_id).sort()).toEqual(["accounts", "partners"]);
    expect(matchDeclaredRoutes(g, { path: "/login", environment: "prod", host: "accounts.example.com" }).map((m) => m.asset_id)).toEqual(["accounts"]);
    expect(matchDeclaredRoutes(g, { path: "/login", environment: "prod", method: "GET" }).map((m) => m.asset_id)).toEqual(["partners"]);
  });
  it("the graph schema and the manifest importer accept routes and reject malformed ones", () => {
    expect(validateGraph(graph()).ok).toBe(true);
    const bad = graph(); (bad.assets[1]!.routes as unknown[]) = [{ path: "login" }];
    expect(validateGraph(bad).ok).toBe(false);
    const m = importManifest("assets:\n  - id: a\n    kind: service\n    routes: ['POST /login', { path: '/users/{id}', methods: [GET], hosts: [a.example.com] }]\n", { revision: "r1" });
    expect(m.graph.assets[0]!.routes).toEqual([{ path: "/login", methods: ["POST"] }, { path: "/users/{id}", methods: ["GET"], hosts: ["a.example.com"] }]);
    expect(() => importManifest("assets:\n  - id: a\n    kind: service\n    routes: ['FETCH /x', { path: '/y', verbs: [GET] }]\n", { revision: "r1" })).toThrow(/manifest rejected/);
  });
});

describe("R00.3 route resolution in context and assessment", () => {
  it("two services with /login cannot produce an unexplained single owner", async () => {
    const ctx = await project();
    const c = await context(ctx, "route=/login&environment=prod");
    expect(c.statusCode).toBe(409);
    expect(c.json().error).toMatch(/matches 2 assets \(accounts, partners\)/);
    const a = await assess(ctx, { routes: ["/login"], environment: "prod" });
    expect(a.route_resolution[0]).toMatchObject({ status: "ambiguous", ownership: "declared" });
    expect(a.targets.map((t: { asset: { id: string } }) => t.asset.id).sort()).toEqual(["accounts", "partners"]); // every candidate, not the busier one
    expect(a.target_resolution).toMatchObject({ requested: 1, resolved: 1, assets_assessed: 2 });
    expect(a.recommendations[0]).toMatch(/matched several assets; every candidate was assessed/);
  });
  it("a qualified route resolves to its declared owner with provenance", async () => {
    const ctx = await project();
    const c = (await context(ctx, `route=${encodeURIComponent("POST accounts.example.com/login")}&environment=prod`)).json();
    expect(c.asset.id).toBe("accounts");
    expect(c.route_resolution).toMatchObject({ status: "declared", ownership: "declared", candidates: [{ asset_id: "accounts", provenance: "graph:r1" }] });
  });
  it("a declared route outside every event window remains discoverable from the inventory", async () => {
    const ctx = await project();
    const c = (await context(ctx, "route=/legacy/export")).json();
    expect(c.asset.id).toBe("partners");
    expect(c.route_resolution.status).toBe("declared");
    const a = await assess(ctx, { routes: ["/users/123"] });
    expect(a.targets[0].asset.id).toBe("accounts");
  });
  it("ownership inferred only from events is labelled and never favorable", async () => {
    const ctx = await project();
    const c = (await context(ctx, "route=/reports/daily")).json();
    expect(c.asset.id).toBe("reports");
    expect(c.route_resolution).toMatchObject({ status: "inferred", ownership: "inferred_from_events" });
    expect(c.guidance[0]).toMatch(/inferred from recorded events/);
    const a = await assess(ctx, { routes: ["/reports/daily"] });
    expect(a.favorable).toBe(false);
    expect(a.posture).toBe("insufficient_context");
    expect(a.evidence_sufficiency.insufficient_targets[0].reasons[0]).toMatchObject({ state: "ownership_inferred" });
    // the same asset named directly (declared identity) is assessed normally
    expect((await assess(ctx, { asset_ids: ["reports"] })).favorable).toBe(true);
  });
  it("several inferred owners are all assessed, not the most frequent one", async () => {
    const ctx = await project();
    const c = await context(ctx, "route=/shared/health");
    expect(c.statusCode).toBe(409);
    const a = await assess(ctx, { routes: ["/shared/health"] });
    expect(a.route_resolution[0]).toMatchObject({ status: "ambiguous", ownership: "inferred_from_events" });
    expect(a.targets.map((t: { asset: { id: string } }) => t.asset.id).sort()).toEqual(["edge", "reports"]);
    expect(a.favorable).toBe(false);
  });
  it("no matching route or an invalid route stays not_assessed", async () => {
    const ctx = await project();
    expect((await assess(ctx, { routes: ["/nothing/here"] })).posture).toBe("not_assessed");
    const inv = await assess(ctx, { routes: ["FETCH /login"] });
    expect(inv.posture).toBe("not_assessed");
    expect(inv.unresolved[0].reason).toBe("invalid_target");
    expect((await context(ctx, "route=/nothing/here")).statusCode).toBe(404);
    expect((await context(ctx, `route=${encodeURIComponent("FETCH /login")}`)).statusCode).toBe(400);
  });
  it("rejects malformed assessment bodies instead of failing inside the resolver", async () => {
    const ctx = await project();
    const r = await ctx.app.inject({ method: "POST", url: "/api/projects/routes/assess-change", headers: ctx.h(ctx.viewer), payload: { routes: "/login" } });
    expect(r.statusCode).toBe(400);
    const e = await ctx.app.inject({ method: "POST", url: "/api/projects/routes/assess-change", headers: ctx.h(ctx.viewer), payload: { routes: ["/login"], environment: 7 } });
    expect(e.statusCode).toBe(400);
  });
});
