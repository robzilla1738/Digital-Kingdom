import { afterEach, describe, expect, it } from "vitest";
import { setup, liveGraph } from "./helpers.ts";

type Ctx = Awaited<ReturnType<typeof setup>>;
const opened: Ctx[] = [];
const NOW = "2026-10-22T16:00:00.000Z";
afterEach(async () => { for (const c of opened.splice(0)) { await c.app.close(); c.db.close(); } });
async function project() {
  const c = await setup({ store: { now: () => new Date(NOW) } });
  opened.push(c);
  c.store.createProject("shop", "Quality-gate fixture", "live");
  c.store.putGraph("shop", liveGraph() as Parameters<typeof c.store.putGraph>[1], "test");
  const { key } = c.store.upsertSource("shop", { id: "app", label: "App security", kind: "app_security", asset_ids: ["api"], stale_after_seconds: 60 }, "test");
  return { c, key };
}
function record(c: Ctx, action = "authentication", extra: Record<string, unknown> = {}) {
  expect(c.store.receive("shop", "app", { source_event_id: `fixture-${action}`, occurred_at: NOW, asset_ids: ["api"], action, outcome: "success", ...extra }).status).toBe("accepted");
  c.store.processBatch();
}
function disable(c: Ctx, source = "app", value = 1) {
  c.db.prepare("UPDATE sources SET disabled = ? WHERE project_id = ? AND id = ?").run(value, "shop", source);
}
async function assess(c: Ctx, assets = ["api"]) {
  const r = await c.app.inject({ method: "POST", url: "/api/projects/shop/assess-change", headers: c.h(c.viewer), payload: { asset_ids: assets } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}

describe("disabled-source coverage is consistent across the shared engine and HTTP views", () => {
  it("recent successful telemetry does not make a disabled source healthy", async () => {
    const { c, key } = await project();
    record(c);
    expect((await assess(c)).favorable).toBe(true);
    disable(c);
    const result = await assess(c);
    expect(result).toMatchObject({ posture: "insufficient_context", favorable: false, target_resolution: { complete: true }, evidence_sufficiency: { sufficient: false } });
    expect(result.evidence_sufficiency.insufficient_targets[0].reasons[0]).toMatchObject({ source_id: "app", state: "offline" });
    expect(result.evidence_sufficiency.insufficient_targets[0].reasons[0].detail).toMatch(/administratively disabled/);
    for (const path of ["health", "snapshot"]) {
      const response = await c.app.inject({ url: `/api/projects/shop/${path}`, headers: c.h(c.viewer) });
      expect(response.statusCode).toBe(200);
      expect(response.json().coverage.find((s: { source_id: string }) => s.source_id === "app").state).toBe("offline");
    }
    const search = await c.app.inject({ url: "/api/projects/shop/events/search?after=2026-10-22T00:00:00Z&before=2026-10-23T00:00:00Z&asset_id=api", headers: c.h(c.viewer) });
    expect(search.json().source_coverage.sources[0]).toMatchObject({ disabled: true, current_state: "offline" });
    const ingest = await c.app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${key}` }, payload: {} });
    expect(ingest.statusCode).toBe(401);
  });
  it("a disabled source with no events remains insufficient, not healthy", async () => {
    const { c } = await project(); disable(c);
    expect((await assess(c)).posture).toBe("insufficient_context");
    expect(c.store.evaluation("shop").coverage[0]!.state).toBe("offline");
  });
  it("an old sensor-restored message cannot override administrative disablement", async () => {
    const { c } = await project(); record(c, "sensor_restored"); disable(c);
    expect((await assess(c)).evidence_sufficiency.sufficient).toBe(false);
  });
  it("a severe finding still holds and the disabled-source gap is retained", async () => {
    const { c } = await project(); record(c, "authorization_change", { severity: "high" }); disable(c);
    const result = await assess(c);
    expect(result.posture).toBe("hold");
    expect(result.evidence_sufficiency.sufficient).toBe(false);
    expect(result.blocking_findings.some((f: { kind: string }) => f.kind === "sensitive_privilege_change")).toBe(true);
  });
  it("disabling an unrelated source does not affect the target", async () => {
    const { c } = await project(); record(c);
    c.store.upsertSource("shop", { id: "db-source", label: "Database", kind: "db_audit", asset_ids: ["db"] }, "test");
    disable(c, "db-source");
    expect((await assess(c)).posture).toBe("no_recorded_concerns");
  });
  it("re-enabling returns to ordinary freshness checks", async () => {
    const { c } = await project(); record(c); disable(c);
    expect((await assess(c)).favorable).toBe(false);
    disable(c, "app", 0);
    expect((await assess(c)).evidence_sufficiency.sufficient).toBe(true);
  });
});

describe("import validation happens before graph and scene mutation", () => {
  const wrongValues: unknown[] = [42, true, [], {}, null];
  for (const field of ["environment", "project"]) for (const value of wrongValues) {
    it(`manifest ${field}=${JSON.stringify(value)} returns 422 with a field path`, async () => {
      const { c } = await project();
      const before = JSON.stringify({ graph: c.store.getGraph("shop"), scene: c.store.getScene("shop") });
      const body = { project: "shop", environment: "staging", assets: [{ id: "api", kind: "service" }], [field]: value };
      const r = await c.app.inject({ method: "POST", url: "/api/projects/shop/graph?format=manifest&revision=invalid", headers: { ...c.h(c.admin), "content-type": "application/yaml" }, payload: JSON.stringify(body) });
      expect(r.statusCode, r.body).toBe(422);
      expect(r.json().details.some((x: string) => x.startsWith(`/${field}:`))).toBe(true);
      expect(JSON.stringify({ graph: c.store.getGraph("shop"), scene: c.store.getScene("shop") })).toBe(before);
    });
  }
  const badCompose = [
    { services: [] }, { services: null }, { services: "wrong" },
    { services: { api: 3 } }, { services: { api: [] } }, { services: { api: null } },
    { services: { api: { image: 3 } } }, { services: { api: { labels: [3] } } },
    { services: { api: { labels: { "dk.kind": "lambda" } } } },
    { services: { api: { depends_on: 3 } } }, { services: { api: { depends_on: [true] } } },
    { services: { api: { ports: "80:80" } } },
  ];
  for (const body of badCompose) it(`rejects malformed compose ${JSON.stringify(body)}`, async () => {
    const { c } = await project();
    const before = JSON.stringify({ graph: c.store.getGraph("shop"), scene: c.store.getScene("shop") });
    const r = await c.app.inject({ method: "POST", url: "/api/projects/shop/graph?format=compose&revision=invalid", headers: { ...c.h(c.admin), "content-type": "application/yaml" }, payload: JSON.stringify(body) });
    expect(r.statusCode, r.body).toBe(422);
    expect(r.json().details[0]).toMatch(/^\/services/);
    expect(JSON.stringify({ graph: c.store.getGraph("shop"), scene: c.store.getScene("shop") })).toBe(before);
  });
  it("valid manifest and supported compose metadata still import", async () => {
    const { c } = await project();
    for (const [format, body] of [
      ["manifest", { project: "shop", environment: "staging", assets: [{ id: "api", kind: "service", aliases: ["checkout"] }] }],
      ["compose", { services: { api: { image: "example/api:1", labels: ["dk.kind=service"], depends_on: { db: { condition: "service_healthy" } } }, db: { image: "postgres:16", labels: { "dk.kind": "database" } } } }],
    ] as const) {
      const r = await c.app.inject({ method: "POST", url: `/api/projects/shop/graph?format=${format}&revision=${format}`, headers: { ...c.h(c.admin), "content-type": "application/yaml" }, payload: JSON.stringify(body) });
      expect(r.statusCode, r.body).toBe(200);
    }
  });
});
