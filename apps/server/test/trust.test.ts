import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup, liveGraph } from "./helpers.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";

async function liveProject(ctx: Awaited<ReturnType<typeof setup>>) {
  const { app, admin, h } = ctx;
  await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "shop", name: "Shop", dataset_kind: "live" } });
  await app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: h(admin), payload: liveGraph() });
  const waf = (await app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: h(admin), payload: { id: "waf", label: "Edge WAF", kind: "waf", asset_ids: ["edge"], trusts_request_ids: true } })).json().key as string;
  const appSrc = (await app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: h(admin), payload: { id: "app", label: "checkout events", kind: "app_security", asset_ids: ["api"] } })).json().key as string;
  return { waf, appSrc };
}
const send = (ctx: Awaited<ReturnType<typeof setup>>, key: string, payload: Record<string, unknown>) => ctx.app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${key}` }, payload });

// ---------------------------------------------------------------- fix 1
describe("fix 1: sensitive input never reaches durable storage", () => {
  const M = { pw: "PWMARKER7f3a91", bearer: "BEARERMARKER0c1d2e3f4a5b", jwt: "eyJhbGciOiJIUzI1NiJ9.eyJtYXJrZXIiOiJKV1RNQVJLRVIifQ.SIGMARKERabcdefgh", query: "QUERYMARKER55aa", cookie: "COOKIEMARKER99bb", attr: "ATTRMARKER12cd" };
  const scan = (dir: string) => {
    const blobs = readdirSync(dir).filter((f) => f.startsWith("db.sqlite")).map((f) => readFileSync(join(dir, f)).toString("latin1")).join("\n");
    return Object.entries(M).filter(([, v]) => blobs.includes(v) || blobs.includes(v.slice(0, 14))).map(([k]) => k);
  };
  it("markers are absent from journal, tables and on-disk files before processing, after processing, and after restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dk-redact-"));
    const ctx = await setup({ dbPath: join(dir, "db.sqlite") });
    const { appSrc } = await liveProject(ctx);
    const r = await send(ctx, appSrc, {
      source_event_id: "login-1", occurred_at: "2026-10-21T10:00:00Z", asset_ids: ["api"], action: "authentication", outcome: "failure", actor_ref: "acct-x",
      route: `/login?api_key=${M.query}&next=/home`,
      coverage_note: `client sent Authorization: Bearer ${M.bearer}`,
      attributes: { password: M.attr, ok: "yes" },
      evidence: { password: M.pw, headers: { cookie: `sid=${M.cookie}`, "x-note": `token ${M.jwt}` } },
    });
    expect(r.statusCode).toBe(202);
    const journal = ctx.db.prepare("SELECT payload FROM journal").all().map((x) => (x as { payload: string }).payload).join();
    for (const v of Object.values(M)) expect(journal).not.toContain(v);
    expect(journal).toContain("[redacted]");
    ctx.db.exec("PRAGMA wal_checkpoint(FULL)");
    expect(scan(dir)).toEqual([]); // before processing
    ctx.store.processBatch();
    const tables = ["events", "evidence", "findings", "finding_revisions", "rejections", "outbox", "audit_log"].map((t) => JSON.stringify(ctx.db.prepare(`SELECT * FROM ${t}`).all())).join();
    for (const v of Object.values(M)) expect(tables).not.toContain(v);
    ctx.db.exec("PRAGMA wal_checkpoint(FULL)");
    expect(scan(dir)).toEqual([]); // after processing
    await ctx.app.close(); ctx.db.close();
    const store2 = new Store(openDb(join(dir, "db.sqlite")));
    while (store2.processBatch().processed) { /* drain */ }
    store2.db.close();
    expect(scan(dir)).toEqual([]); // after restart
  });
  it("the redaction is recorded so analysts know fields were removed", async () => {
    const ctx = await setup();
    const { appSrc } = await liveProject(ctx);
    await send(ctx, appSrc, { source_event_id: "x1", occurred_at: "2026-10-21T10:00:00Z", asset_ids: ["api"], action: "authentication", outcome: "failure", actor_ref: "a", evidence: { password: "p" } });
    ctx.store.processBatch();
    const e = ctx.store.listEvents("shop")[0]!;
    expect(e.coverage_note).toMatch(/Redacted at ingestion: 1 field/);
    expect(ctx.store.getEvidence("shop", `evidence:${e.id}`)!.redacted).toBe(true);
  });
  it("schema rejections never echo submitted values", async () => {
    const ctx = await setup();
    const { appSrc } = await liveProject(ctx);
    await send(ctx, appSrc, { source_event_id: "x2", occurred_at: "2026-10-21T10:00:00Z", asset_ids: ["api"], action: "authentication", outcome: "failure", secret_field: M.pw });
    expect(JSON.stringify(ctx.db.prepare("SELECT * FROM rejections").all())).not.toContain(M.pw);
  });
});

// ---------------------------------------------------------------- fix 2
describe("fix 2: unresolved targets never receive a favorable assessment", () => {
  const assess = async (ctx: Awaited<ReturnType<typeof setup>>, body: Record<string, unknown>, project = "demo-castle") => (await ctx.app.inject({ method: "POST", url: `/api/projects/${project}/assess-change`, headers: ctx.h(ctx.viewer), payload: body })).json();
  it("unknown asset -> not_assessed", async () => {
    const r = await assess(await setup(), { asset_ids: ["ordres-api"] });
    expect(r).toMatchObject({ posture: "not_assessed", target_resolution: { complete: false }, targets_requested: 1, targets_resolved: 0, targets_unresolved: 1 });
    expect(r.unresolved[0].reason).toBe("unknown_target");
  });
  it("unknown route -> not_assessed", async () => {
    const r = await assess(await setup(), { routes: ["/does/not/exist"] });
    expect(r.posture).toBe("not_assessed");
  });
  it("missing graph -> not_assessed with reason missing_graph", async () => {
    const ctx = await setup();
    await ctx.app.inject({ method: "POST", url: "/api/projects", headers: ctx.h(ctx.admin), payload: { id: "empty", name: "Empty", dataset_kind: "live" } });
    const r = await assess(ctx, { asset_ids: ["anything"] }, "empty");
    expect(r.posture).toBe("not_assessed");
    expect(r.unresolved[0].reason).toBe("missing_graph");
  });
  it("mixed clean and unknown targets -> insufficient_context, never no_recorded_concerns", async () => {
    const ctx = await setup();
    const clean = await assess(ctx, { asset_ids: ["storefront-web"] });
    expect(clean.posture).toBe("no_recorded_concerns");
    const mixed = await assess(ctx, { asset_ids: ["storefront-web", "ghost-service"] });
    expect(mixed).toMatchObject({ posture: "insufficient_context", targets_resolved: 1, targets_unresolved: 1, target_resolution: { complete: false } });
    expect(mixed.recommendations[0]).toMatch(/ghost-service/);
  });
  it("a severe finding still holds even when another target is unknown", async () => {
    const r = await assess(await setup(), { asset_ids: ["public-edge", "ghost"] });
    expect(r.posture).toBe("hold");
    expect(r.targets_unresolved).toBe(1);
  });
  it("internal lookup failure -> not_assessed with reason lookup_error", async () => {
    const ctx = await setup();
    ctx.store.listFindings = () => { throw new Error("disk I/O error"); };
    const r = await assess(ctx, { asset_ids: ["storefront-web"] });
    expect(r.posture).toBe("not_assessed");
    expect(r.unresolved[0].reason).toBe("lookup_error");
  });
});

// ---------------------------------------------------------------- fix 3
describe("fix 3: source capabilities are enforced server-side", () => {
  it("a source scoped to one service cannot report about another service", async () => {
    const ctx = await setup();
    const { appSrc } = await liveProject(ctx);
    const r = await send(ctx, appSrc, { source_event_id: "s1", occurred_at: "2026-10-21T10:00:00Z", asset_ids: ["checkout-db"], action: "authorization_change", outcome: "success", actor_ref: "x" });
    expect(r.statusCode).toBe(422);
    expect(r.json().errors[0].reason).toBe("asset_not_permitted");
  });
  it("an application source cannot claim an independently observed effect", async () => {
    const ctx = await setup();
    const { appSrc } = await liveProject(ctx);
    const r = await send(ctx, appSrc, { source_event_id: "s2", occurred_at: "2026-10-21T10:00:00Z", asset_ids: ["api"], action: "side_effect_observed", outcome: "observed" });
    expect(r.json().errors[0].reason).toBe("action_not_permitted");
  });
  it("sources must be assigned assets and a known kind", async () => {
    const ctx = await setup();
    await liveProject(ctx);
    const post = (payload: Record<string, unknown>) => ctx.app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: ctx.h(ctx.admin), payload });
    expect((await post({ id: "a", label: "a" })).statusCode).toBe(400);
    expect((await post({ id: "b", label: "b", asset_ids: ["api"], kind: "mystery" })).statusCode).toBe(400);
    expect((await post({ id: "c", label: "c", asset_ids: ["nope"] })).statusCode).toBe(422);
  });
  it("relays of one observer share an independence group and do not create a contradiction", async () => {
    const ctx = await setup();
    const { waf } = await liveProject(ctx);
    const relay = (await ctx.app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: ctx.h(ctx.admin), payload: { id: "waf-relay", label: "WAF logs via shipper", kind: "effect_observer", asset_ids: ["db"], trusts_request_ids: true, independence_group: "waf" } })).json().key;
    await send(ctx, waf, { source_event_id: "b1", occurred_at: "2026-10-21T10:00:00Z", asset_ids: ["edge"], action: "waf_match", outcome: "blocked", request_id: "rq1", rule_ref: "r" });
    await send(ctx, relay, { source_event_id: "e1", occurred_at: "2026-10-21T10:00:01Z", asset_ids: ["db"], action: "side_effect_observed", outcome: "observed", request_id: "rq1" });
    ctx.store.processBatch();
    expect(ctx.store.listFindings("shop").map((f) => f.kind)).not.toContain("source_contradiction");
  });
});

// ---------------------------------------------------------------- approvals
describe("containment approvals distinguish human and service principals", () => {
  it("a service token (agent) can request but never decide; a different human token can", async () => {
    const ctx = await setup();
    const svc = (await ctx.app.inject({ method: "POST", url: "/api/tokens", headers: ctx.h(ctx.admin), payload: { name: "coding-agent", role: "analyst", principal_type: "service" } })).json();
    expect(svc.principal_type).toBe("service");
    expect((await ctx.app.inject({ method: "POST", url: "/api/tokens", headers: ctx.h(ctx.admin), payload: { name: "x", role: "admin", principal_type: "service" } })).statusCode).toBe(400);
    const f = ctx.store.listFindings("demo-castle").find((x) => x.kind === "repeated_auth_failure")!;
    const req = (await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/containment", headers: ctx.h(svc.token), payload: { finding_id: f.id, action_id: "auth.force_reauth", rationale: "agent proposal" } })).json();
    expect(req).toMatchObject({ status: "pending", requested_by_type: "service" });
    const svcAdmin = ctx.store.createToken("svc-admin", "admin", "*", undefined, "service").token;
    expect((await ctx.app.inject({ method: "POST", url: `/api/projects/demo-castle/containment/${req.id}/decision`, headers: ctx.h(svcAdmin), payload: { decision: "approved" } })).statusCode).toBe(403);
    const ok = await ctx.app.inject({ method: "POST", url: `/api/projects/demo-castle/containment/${req.id}/decision`, headers: ctx.h(ctx.admin), payload: { decision: "approved" } });
    expect(ok.json().status).toBe("approved");
  });
});
