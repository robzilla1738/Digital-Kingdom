import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts"; // first: db.ts and change-review.ts import each other
import { createHash } from "node:crypto";
import { EVALUATOR_VERSION, type AuthSnapshot } from "../src/access/aws-policy.ts";
import { parseArtifact } from "../src/exploration.ts";

/** LP13: bounded path and change exploration (model-only analysis namespace, deterministic receipts). */
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

describe("LP13-A1 conditional permission is never observed use; unsupported semantics stay unresolved", () => {
  it("path hops carry provenance; only an observed relationship with evidence refs animates; configured and conditional permission never do", async () => {
    const w = await world();
    const p = await w.paths({ from: "edge", to: "db" });
    expect(p.schema).toBe("dk.path_explanation.v1");
    expect(p.reachable).toBe("declared_path_exists"); // one hop is only declared
    const [h1, h2] = p.paths[0].hops;
    expect(h1).toMatchObject({ ref: "r1", basis: "declared_relationship", observed: false, provenance: ["manifest"], presentation: { animate: false, line: "dashed_declared" } });
    expect(h2).toMatchObject({ ref: "r2", basis: "observed_activity", observed: true, provenance: ["ev-db-read-1"], presentation: { animate: true, line: "solid_observed" } });
    // feasible configured permission: still not observed, never animated
    const feasible = await w.paths({ from: "api", to: "db", principal: deployerA, action: "s3:GetObject", resource: `${bucketA}/x.csv` });
    expect(feasible.permission.result).toBe("feasible");
    for (const path of feasible.permission.paths) for (const hop of path.hops) expect(hop).toMatchObject({ basis: "configured_permission", observed: false, presentation: { animate: false } });
    // conditional permission (candidate adds an MFA condition): dashed conditional, the condition named as a prerequisite
    const base = await w.state();
    const cmp = await w.compare({ base_state_hash: base.state_hash, changes: [{ op: "modify", ...grantA, attrs: { statement: condRead(bucketA) } }], probes: [{ principal: deployerA, action: "s3:GetObject", resource: `${bucketA}/x.csv` }] });
    expect(cmp.statusCode, cmp.body).toBe(200);
    const cond = await w.paths({ from: "api", to: "db", principal: deployerA, action: "s3:GetObject", resource: `${bucketA}/x.csv`, comparison: cmp.json().id });
    expect(cond.permission.result).toBe("conditional");
    for (const path of cond.permission.paths) for (const hop of path.hops) expect(hop).toMatchObject({ observed: false, presentation: { animate: false, line: "dashed_conditional" } });
    expect(cond.permission.unresolved_prerequisites.join(" ")).toMatch(/conditions not evaluated: aws:MultiFactorAuthPresent/);
    expect(cmp.json().comparison.access[0]).toMatchObject({ base: { result: "feasible" }, candidate: { result: "conditional" }, basis: "configured_permission", observed_use: false });
    // unsupported provider/action semantics: unresolved, named
    const dyn = await w.paths({ from: "api", to: "db", principal: deployerA, action: "dynamodb:GetItem", resource: "arn:aws:dynamodb:us-east-1:111122223333:table/orders" });
    expect(dyn.permission).toMatchObject({ result: "unresolved", paths: [] });
    expect(dyn.permission.unresolved_prerequisites[0]).toMatch(/outside dk\.aws_policy_eval\.v2/);
    const gcp = await w.paths({ from: "api", to: "db", principal: deployerA, action: "s3:GetObject", resource: "gs://bucket/object" });
    expect(gcp.permission.result).toBe("unresolved");
    // an unsupported construct (NotPrincipal) that may apply keeps the answer unresolved
    const np = await w.paths({ from: "api", to: "db", principal: deployerB, action: "s3:GetObject", resource: `${bucketB}/y.csv` });
    expect(np.permission.result).toBe("unresolved");
    expect(np.permission.unresolved_prerequisites.join(" ")).toMatch(/NotPrincipal/);
    // a proposed tool link in a candidate is drawn as proposed, never observed
    const tool = await w.compare({ base_state_hash: base.state_hash, changes: [{ op: "add", kind: "tool", authority: "shop/prod", id: "agent->mailer", attrs: { agent: "agent", tool: "mailer" } }] });
    expect(tool.statusCode, tool.body).toBe(200);
    const tp = await w.paths({ from: "agent", to: "mailer", comparison: tool.json().id });
    expect(tp.paths[0].hops[0]).toMatchObject({ basis: "proposed_relationship", observed: false, presentation: { animate: false, line: "dotted_proposed" } });
    expect((await w.paths({ from: "agent", to: "mailer" })).reachable).toBe("no_declared_path_found");
  });
});

describe("LP13-A2 a proposed candidate cannot modify baseline facts, findings, scenes or approval receipts", () => {
  it("comparisons, candidate paths and rechecks change no baseline table; comparisons are append-only and analyst-only", async () => {
    const w = await world();
    const tables = ["projects", "graph_revisions", "scenes", "entities", "assertions", "reconciliations", "findings", "finding_revisions", "events", "sources", "source_revisions", "access_snapshots", "change_reviews", "containment_requests", "containment_approvals", "containment_verifications", "controls", "control_tests", "cases", "case_items", "regression_proposals"];
    const digest = () => Object.fromEntries(tables.map((t) => [t, createHash("sha256").update(JSON.stringify(w.ctx.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())).digest("hex")]));
    const before = digest();
    const sceneBefore = (await w.ctx.app.inject({ method: "GET", url: "/api/projects/shop/snapshot", headers: w.ctx.h(w.ctx.viewer) })).json().scene?.digest;
    const base = await w.state();
    expect((await w.compare({ base_state_hash: base.state_hash, changes: [{ op: "remove", kind: "route", authority: "shop/prod", id: "edge GET /orders" }] }, w.ctx.viewer)).statusCode).toBe(403);
    const r = await w.compare({ base_state_hash: base.state_hash, changes: [
      { op: "modify", ...grantA, attrs: { statement: { Sid: "Read", Effect: "Allow", Action: ["s3:*"], Resource: "*" } } },
      { op: "remove", kind: "route", authority: "shop/prod", id: "edge GET /orders" },
      { op: "add", kind: "tool", authority: "shop/prod", id: "agent->mailer", attrs: { agent: "agent", tool: "mailer" } },
      { op: "modify", kind: "source", authority: "shop", id: "app", attrs: { disabled: true } },
    ], probes: [{ principal: deployerA, action: "s3:GetObject", resource: `${bucketB}/y.csv` }] });
    expect(r.statusCode, r.body).toBe(200);
    const id = r.json().id;
    expect(r.json().namespace).toMatch(/^branch:[a-f0-9]{16}$/);
    expect(r.json().comparison.review.changes.map((c: { kind: string }) => c.kind)).toEqual(expect.arrayContaining(["tool_change", "lost_telemetry"]));
    await w.paths({ from: "agent", to: "mailer", comparison: id });
    await w.ctx.app.inject({ method: "GET", url: `/api/projects/shop/analysis/comparisons/${id}/recheck`, headers: w.ctx.h(w.ctx.viewer) });
    expect(digest()).toEqual(before);
    expect((await w.ctx.app.inject({ method: "GET", url: "/api/projects/shop/snapshot", headers: w.ctx.h(w.ctx.viewer) })).json().scene?.digest).toBe(sceneBefore);
    expect((await w.state()).state_hash).toBe(base.state_hash); // the baseline is exactly as it was
    expect(() => w.ctx.db.prepare("UPDATE analysis_comparisons SET receipt = '{}'").run()).toThrow(/append-only/);
    expect(() => w.ctx.db.prepare("DELETE FROM analysis_comparisons").run()).toThrow(/append-only/);
    // a candidate may not smuggle fields that target other records or executable configuration
    for (const bad of [
      { op: "modify", kind: "finding", authority: "shop", id: "f1", attrs: { lifecycle: "closed" } },
      { op: "modify", kind: "source", authority: "shop", id: "app", attrs: { endpoint: "http://10.0.0.1" } },
      { op: "add", kind: "route", authority: "shop/prod", id: "x", attrs: { path: "/x", command: "rm -rf /" } },
      { op: "modify", ...grantA, attrs: { statement: { Effect: "Allow", Action: "*", Resource: "*", Script: "x" } } },
    ]) expect((await w.compare({ base_state_hash: base.state_hash, changes: [bad] })).statusCode).toBe(422);
    expect((await w.compare({ base_state_hash: base.state_hash, changes: [{ op: "modify", ...grantA, attrs: { order: 0 } }], approval: "yes" } as never)).statusCode).toBe(422);
  });
});

describe("LP13-A3 same-name resources and versions under different authorities stay distinct", () => {
  it("same principal name in two accounts and the same artifact name in two registries are separate elements throughout", async () => {
    const w = await world();
    const base = await w.state();
    const keys = base.state.elements.map((e: { kind: string; authority: string; id: string }) => `${e.kind}|${e.authority}|${e.id}`);
    expect(keys).toContain(`grant|${A}|user/deployer#identity#pol#Read`);
    expect(keys).toContain(`grant|${B}|user/deployer#identity#pol#Read`);
    expect(parseArtifact("registry.a.example/checkout:1.4@sha256:" + "a".repeat(64))).toMatchObject({ authority: "registry.a.example", name: "checkout" });
    expect(keys).toContain("artifact|registry.a.example|api:checkout");
    expect(keys).toContain("artifact|registry.b.example|worker:checkout");
    // modifying account A's grant leaves account B's identically named grant untouched
    const r = await w.compare({ base_state_hash: base.state_hash, changes: [{ op: "modify", ...grantA, attrs: { statement: condRead(bucketA) } }], probes: [
      { principal: deployerA, action: "s3:GetObject", resource: `${bucketA}/x.csv` }, { principal: deployerB, action: "s3:GetObject", resource: `${bucketA}/x.csv` }] });
    expect(r.statusCode, r.body).toBe(200);
    const c = r.json().comparison;
    expect(c.modified.map((m: { key: string }) => m.key)).toEqual([`grant|${A}|user/deployer#identity#pol#Read`]);
    expect(c.access[0].candidate.result).toBe("conditional");
    expect(c.access[1].base.result).toBe(c.access[1].candidate.result); // B is not affected by A's change
    // addressing the element under the wrong authority is refused, never resolved by name
    const wrong = await w.compare({ base_state_hash: base.state_hash, changes: [{ op: "modify", kind: "artifact", authority: "registry.b.example", id: "api:checkout", attrs: { version: "1.5" } }] });
    expect(wrong.statusCode).toBe(409);
    expect(wrong.json().error).toMatch(/same name under another authority is a different element/);
    // moving api's artifact to another registry is a removal plus an addition, not a version bump
    const moved = await w.compare({ base_state_hash: base.state_hash, changes: [
      { op: "remove", kind: "artifact", authority: "registry.a.example", id: "api:checkout" },
      { op: "add", kind: "artifact", authority: "registry.b.example", id: "api:checkout", attrs: { asset_id: "api", name: "checkout", version: "sha256:" + "b".repeat(64) } }] });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json().comparison).toMatchObject({ added: ["artifact|registry.b.example|api:checkout"], removed: ["artifact|registry.a.example|api:checkout"], modified: [] });
    // a version change under the same authority is a modification of that element only
    const bump = await w.compare({ base_state_hash: base.state_hash, changes: [{ op: "modify", kind: "artifact", authority: "registry.a.example", id: "api:checkout", attrs: { version: "1.5", reference: "registry.a.example/checkout:1.5" } }] });
    expect(bump.json().comparison.modified.map((m: { key: string }) => m.key)).toEqual(["artifact|registry.a.example|api:checkout"]);
  });
});

describe("LP13-A4 a comparison records the exact state, policy version, conditions and unassessed paths", () => {
  it("receipts are deterministic, bound to the base state, and name what was not assessed", async () => {
    const w = await world();
    const base = await w.state();
    const payload = { base_state_hash: base.state_hash, changes: [
      { op: "modify", ...grantA, attrs: { statement: condRead(bucketA) } },
      { op: "modify", kind: "grant", authority: B, id: "user/deployer#identity#pol#Read", attrs: { statement: { Sid: "Read", Effect: "Allow", Action: ["s3:PutObject"], Resource: `${bucketB}/*` } } },
      { op: "add", kind: "route", authority: "shop/prod", id: "edge POST /admin", attrs: { asset_id: "edge", path: "/admin", methods: ["POST"] } },
    ], probes: [{ principal: deployerA, action: "s3:GetObject", resource: `${bucketA}/x.csv` }, { principal: deployerA, action: "dynamodb:GetItem", resource: "arn:aws:dynamodb:us-east-1:1:table/t" }] };
    const r1 = (await w.compare(payload)).json(), r2 = (await w.compare(payload)).json();
    expect(r1.id).not.toBe(r2.id);
    expect(r1.receipt.receipt_digest).toBe(r2.receipt.receipt_digest);
    expect(r1.candidate_state_hash).toBe(r2.candidate_state_hash);
    const rc = r1.receipt;
    expect(rc).toMatchObject({ schema: "dk.analysis_receipt.v1", mode: "model_only", base_state_hash: base.state_hash, candidate_state_hash: r1.candidate_state_hash, policy_version: EVALUATOR_VERSION,
      state: { schema: "dk.analysis_state.v1", graph_revision: "r1", snapshot_id: "lp13-1", snapshot_digest: expect.stringMatching(/^[a-f0-9]{64}$/), source_revisions: { app: expect.any(Number) } } });
    expect(rc.condition_keys).toContain("aws:MultiFactorAuthPresent");
    const un = rc.unassessed_paths.join("\n");
    expect(un).toMatch(/conditional on aws:MultiFactorAuthPresent/);
    expect(un).toMatch(/dynamodb:GetItem .*outside dk\.aws_policy_eval\.v2/);
    expect(un).toMatch(new RegExp(`grant\\|${B}\\|user/deployer#identity#pol#Read: changed grant not exercised by any probe`));
    expect(un).toMatch(/route\|shop\/prod\|edge POST \/admin: declared change only/);
    const { receipt_digest, ...rest } = rc;
    expect(createHash("sha256").update(canonical(rest)).digest("hex")).toBe(receipt_digest);
    const stored = (await w.ctx.app.inject({ method: "GET", url: `/api/projects/shop/analysis/comparisons/${r1.id}`, headers: w.ctx.h(w.ctx.viewer) })).json();
    expect(stored.receipt).toEqual(rc);
    expect((await w.ctx.app.inject({ method: "GET", url: `/api/projects/shop/analysis/comparisons/${r1.id}/recheck`, headers: w.ctx.h(w.ctx.viewer) })).json()).toMatchObject({ reproducible: true });
    // a changed baseline (new snapshot) refuses the old base hash and the old receipt no longer reproduces
    expect((await w.ctx.app.inject({ method: "POST", url: "/api/projects/shop/access/snapshot", headers: w.ctx.h(w.ctx.admin), payload: { ...SNAP("lp13-2"), taken_at: "2026-10-23T19:00:00Z" } })).statusCode).toBe(200);
    const stale = await w.compare(payload);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current.base_state_hash).not.toBe(base.state_hash);
    expect((await w.ctx.app.inject({ method: "GET", url: `/api/projects/shop/analysis/comparisons/${r1.id}/recheck`, headers: w.ctx.h(w.ctx.viewer) })).json()).toMatchObject({ reproducible: false, stored_base_state_hash: base.state_hash });
    expect((await w.compare({ changes: payload.changes })).statusCode).toBe(428);
  });
});

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
}
