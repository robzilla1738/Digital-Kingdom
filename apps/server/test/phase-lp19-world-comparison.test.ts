import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts"; // first: db.ts and change-review.ts import each other
import { createHash } from "node:crypto";
import { EVALUATOR_VERSION, type AuthSnapshot } from "../src/access/aws-policy.ts";


/** LP19: baseline-versus-repair world comparison over LP13 comparisons (same synthetic world as the LP13 tests). */
const A = "111122223333", B = "444455556666";
const deployerA = `arn:aws:iam::${A}:user/deployer`, deployerB = `arn:aws:iam::${B}:user/deployer`;
const bucketA = "arn:aws:s3:::acme-a-exports", bucketB = "arn:aws:s3:::acme-b-exports";
const read = (bucket: string) => ({ id: "pol", Statement: [{ Sid: "Read", Effect: "Allow" as const, Action: ["s3:GetObject"], Resource: `${bucket}/*` }] });
const SNAP = (id = "lp13-1"): AuthSnapshot => ({
  snapshot_id: id, taken_at: "2026-10-23T18:00:00Z", organization: null,
  principals: [
    { arn: deployerA, account: A, type: "user", policies: [read(bucketA)] },
    { arn: deployerB, account: B, type: "user", policies: [read(bucketB)] },
  ],
  resources: [{ arn: bucketA, account: A, policy: null }, { arn: bucketB, account: B, policy: { id: "bp", Statement: [{ Sid: "Odd", Effect: "Deny", NotPrincipal: { AWS: deployerB }, Action: "s3:*", Resource: `${bucketB}/*` } as never] } }],
});
const graph = (project: string) => ({
  schema_version: "0.2", dataset_kind: "live", project_id: project, graph_revision: "r1",
  assets: [
    { id: "edge", name: "edge-proxy", kind: "edge", environment: "prod", allowed_zone_ids: ["public"], source_refs: ["manifest"], routes: [{ path: "/orders", methods: ["GET"] }] },
    { id: "api", name: "checkout-api", kind: "service", environment: "prod", allowed_zone_ids: ["application"], source_refs: ["manifest"], deployment: "registry.a.example/checkout:1.4@sha256:" + "a".repeat(64) },
    { id: "worker", name: "checkout-worker", kind: "worker", environment: "prod", allowed_zone_ids: ["application"], source_refs: ["manifest"], deployment: "registry.b.example/checkout:1.4@sha256:" + "b".repeat(64) },
    { id: "db", name: "checkout-db", kind: "database", environment: "prod", allowed_zone_ids: ["data"], source_refs: ["manifest"] },
    { id: "agent", name: "support-agent", kind: "agent", environment: "prod", allowed_zone_ids: ["application"], source_refs: ["manifest"] },
    { id: "mailer", name: "mailer-tool", kind: "tool_server", environment: "prod", allowed_zone_ids: ["application"], source_refs: ["manifest"] },
  ],
  relationships: [
    { id: "r1", source_id: "edge", target_id: "api", kind: "calls", evidence_level: "declared", evidence_refs: ["manifest"] },
    { id: "r2", source_id: "api", target_id: "db", kind: "reads_from", evidence_level: "observed", evidence_refs: ["ev-db-read-1"] },
  ],
});
async function world() {
  const ctx = await setup();
  const { app, admin, h } = ctx;
  expect((await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "shop", name: "Shop", dataset_kind: "live" } })).statusCode).toBe(200);
  const g = await app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: h(admin), payload: graph("shop") });
  expect(g.statusCode, g.body).toBe(200);
  expect((await app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: h(admin), payload: { id: "app", label: "app", kind: "app_security", asset_ids: ["api"], stale_after_seconds: 3600 } })).statusCode).toBe(200);
  expect((await app.inject({ method: "POST", url: "/api/projects/shop/access/snapshot", headers: h(admin), payload: SNAP() })).statusCode).toBe(200);
  const state = async () => (await app.inject({ method: "GET", url: "/api/projects/shop/analysis/state", headers: h(ctx.viewer) })).json();
  const compare = (payload: Record<string, unknown>, token = ctx.analyst) => app.inject({ method: "POST", url: "/api/projects/shop/analysis/comparisons", headers: h(token), payload });
  const paths = async (q: Record<string, string>) => { const r = await app.inject({ method: "GET", url: `/api/projects/shop/analysis/paths?${new URLSearchParams(q)}`, headers: h(ctx.viewer) }); expect(r.statusCode, r.body).toBe(200); return r.json(); };
  return { ctx, state, compare, paths };
}
const condRead = (bucket: string) => ({ Sid: "Read", Effect: "Allow", Action: ["s3:GetObject"], Resource: `${bucket}/*`, Condition: { Bool: { "aws:MultiFactorAuthPresent": "true" } } });
const grantA = { kind: "grant", authority: A, id: "user/deployer#identity#pol#Read" };

describe("LP19 baseline-versus-repair world comparison", () => {
  it("A1/A2/A3/A4: viewing projects exact changes onto the baseline rooms without changing baseline state, and never shows a simulated block as executed", async () => {
    const w = await world();
    const tables = ["projects", "graph_revisions", "scenes", "findings", "events", "sources", "source_revisions", "access_snapshots", "analysis_comparisons"];
    const digest = () => Object.fromEntries(tables.map((t) => [t, createHash("sha256").update(JSON.stringify(w.ctx.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())).digest("hex")]));
    const base = await w.state();
    const r = await w.compare({ base_state_hash: base.state_hash, label: "tighten deployer", changes: [
      { op: "modify", ...grantA, attrs: { statement: condRead(bucketA) } },
      { op: "remove", kind: "route", authority: "shop/prod", id: "edge GET /orders" },
      { op: "add", kind: "route", authority: "shop/prod", id: "edge POST /admin", attrs: { asset_id: "edge", path: "/admin", methods: ["POST"] } },
      { op: "modify", kind: "source", authority: "shop", id: "app", attrs: { disabled: true } },
    ], probes: [{ principal: deployerA, action: "s3:GetObject", resource: `${bucketA}/x.csv` }] });
    expect(r.statusCode, r.body).toBe(200);
    const id = r.json().id;
    const before = digest();
    const coverageBefore = (await w.ctx.app.inject({ url: "/api/projects/shop/snapshot", headers: w.ctx.h(w.ctx.viewer) })).json().coverage;
    const res = await w.ctx.app.inject({ url: `/api/projects/shop/analysis/comparisons/${id}/world`, headers: w.ctx.h(w.ctx.viewer) });
    expect(res.statusCode, res.body).toBe(200);
    const v = res.json();
    // A1: viewing changes nothing (tables, coverage, baseline hash)
    expect(digest()).toEqual(before);
    expect((await w.ctx.app.inject({ url: "/api/projects/shop/snapshot", headers: w.ctx.h(w.ctx.viewer) })).json().coverage).toEqual(coverageBefore);
    expect((await w.state()).state_hash).toBe(base.state_hash);
    // A4: both revisions identified; common layout
    expect(v.schema).toBe("dk.world_comparison.v1");
    expect(v.revisions.baseline).toMatchObject({ state_hash: base.state_hash, graph_revision: "r1", current: true });
    expect(v.revisions.candidate.state_hash).toBe(r.json().candidate_state_hash);
    expect(v.revisions.candidate.receipt_digest).toBe(r.json().receipt.receipt_digest);
    const scene = w.ctx.store.getScene("shop")!;
    expect(v.revisions.baseline.scene_digest).toBe(scene.digest);
    // A2: exact references, mapped to baseline rooms at their baseline positions; unresolved conditions kept
    const byKey = Object.fromEntries(v.changes.map((c: { key: string }) => [c.key, c]));
    expect(byKey["route|shop/prod|edge GET /orders"]).toMatchObject({ op: "removed", asset_ids: ["edge"] });
    expect(byKey["route|shop/prod|edge POST /admin"]).toMatchObject({ op: "added", asset_ids: ["edge"] });
    expect(byKey["source|shop|app"]).toMatchObject({ op: "changed", asset_ids: ["api"] });
    const edge = v.rooms.find((x: { asset_id: string }) => x.asset_id === "edge");
    expect(edge).toMatchObject({ change: "changed", placement: "baseline_room", baseline_position: scene.rooms.find((x) => x.asset_id === "edge")!.position });
    expect(edge.refs).toEqual(["route|shop/prod|edge GET /orders", "route|shop/prod|edge POST /admin"]);
    expect(v.model_only.unassessed_paths.length).toBeGreaterThan(0);
    expect(v.model_only.condition_keys).toContain("aws:MultiFactorAuthPresent");
    expect(byKey["route|shop/prod|edge POST /admin"].unresolved[0]).toMatch(/declared change only/);
    expect(v.warnings.join(" ")).toMatch(/not closed/);
    // A3: model-only access results are never executed or verified; executed-local is a separate, empty list
    expect(v.mode).toBe("model_only");
    for (const a of v.model_only.access) expect(a).toMatchObject({ executed: false, verified: false, basis: "configured_permission" });
    expect(v.executed_local.results).toEqual([]);
    expect(v.executed_local.note).toMatch(/not a verified executed control/);
    expect(v.not_claimed.join(" ")).toMatch(/never a security fact/);
    // export header, and a changed baseline is warned about (not silently re-based)
    const dl = await w.ctx.app.inject({ url: `/api/projects/shop/analysis/comparisons/${id}/world?download=1`, headers: w.ctx.h(w.ctx.viewer) });
    expect(dl.headers["content-disposition"]).toContain(`world-comparison-${id}.json`);
    expect((await w.ctx.app.inject({ method: "POST", url: "/api/projects/shop/access/snapshot", headers: w.ctx.h(w.ctx.admin), payload: { ...SNAP("lp19-2"), taken_at: "Fri 2026-10-23 2:00 PM CDT (UTC-05:00)" } })).statusCode).toBe(200);
    const stale = (await w.ctx.app.inject({ url: `/api/projects/shop/analysis/comparisons/${id}/world`, headers: w.ctx.h(w.ctx.viewer) })).json();
    expect(stale.revisions.baseline.current).toBe(false);
    expect(stale.warnings[0]).toMatch(/baseline changed since this comparison/);
    expect((await w.ctx.app.inject({ url: `/api/projects/shop/analysis/comparisons/nope/world`, headers: w.ctx.h(w.ctx.viewer) })).statusCode).toBe(404);
  });
});
