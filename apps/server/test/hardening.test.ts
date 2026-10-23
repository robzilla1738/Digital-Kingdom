import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup, liveGraph } from "./helpers.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";

type Ctx = Awaited<ReturnType<typeof setup>>;
async function liveProject(ctx: Ctx) {
  const { app, admin, h } = ctx;
  await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "shop", name: "Shop", dataset_kind: "live" } });
  await app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: h(admin), payload: liveGraph() });
  const appSrc = (await app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: h(admin), payload: { id: "app", label: "checkout events", kind: "app_security", asset_ids: ["api"] } })).json().key as string;
  return { appSrc };
}
const ok = (n: number, extra: Record<string, unknown> = {}) => ({ source_event_id: `ok-${n}`, occurred_at: "2026-10-21T10:00:00Z", asset_ids: ["api"], action: "authentication", outcome: "failure", actor_ref: "a", ...extra });

// ---------------------------------------------------------------- blocker 1
describe("token delegation cannot escalate scope", () => {
  const mint = (ctx: Ctx, token: string, payload: Record<string, unknown>) => ctx.app.inject({ method: "POST", url: "/api/tokens", headers: ctx.h(token), payload });
  async function scopedAdmin() {
    const ctx = await setup();
    await liveProject(ctx); // projects: demo-castle and shop
    const pa = ctx.store.createToken("project-a admin", "admin", ["demo-castle"]).token;
    return { ctx, pa };
  }
  it("a project-A admin cannot issue a '*' token", async () => {
    const { ctx, pa } = await scopedAdmin();
    expect((await mint(ctx, pa, { name: "x", role: "viewer", projects: "*" })).statusCode).toBe(403);
  });
  it("a project-A admin cannot issue a project-B token", async () => {
    const { ctx, pa } = await scopedAdmin();
    const r = await mint(ctx, pa, { name: "x", role: "admin", projects: ["shop"] });
    expect(r.statusCode).toBe(403);
    expect((await mint(ctx, pa, { name: "x", role: "admin", projects: ["demo-castle", "shop"] })).statusCode).toBe(403);
  });
  it("omitting projects defaults to the issuer's scope, never '*'", async () => {
    const { ctx, pa } = await scopedAdmin();
    const r = (await mint(ctx, pa, { name: "child", role: "analyst" })).json();
    expect(r.projects).toEqual(["demo-castle"]);
    const list = (await ctx.app.inject({ url: "/api/projects", headers: ctx.h(r.token) })).json().map((p: { id: string }) => p.id);
    expect(list).toEqual(["demo-castle"]);
    expect((await ctx.app.inject({ url: "/api/projects/shop/findings", headers: ctx.h(r.token) })).statusCode).toBe(404);
  });
  it("in-scope delegation and installation-admin issuance still work", async () => {
    const { ctx, pa } = await scopedAdmin();
    expect((await mint(ctx, pa, { name: "a", role: "viewer", projects: ["demo-castle"] })).statusCode).toBe(200);
    const g = (await mint(ctx, ctx.admin, { name: "global", role: "admin", projects: "*" })).json();
    expect(g.projects).toBe("*");
    expect((await mint(ctx, ctx.admin, { name: "bad", role: "viewer", projects: ["nope"] })).statusCode).toBe(422);
  });
  it("a role can never exceed the issuer's", async () => {
    const { ctx } = await scopedAdmin();
    // analysts can't reach the endpoint at all; the role check is defence in depth
    expect((await mint(ctx, ctx.analyst, { name: "x", role: "admin" })).statusCode).toBe(403);
  });
  it("service identities cannot mint identities (no route to becoming a human approver)", async () => {
    const { ctx } = await scopedAdmin();
    const svcAdmin = ctx.store.createToken("forced service admin", "admin", "*", undefined, "service").token; // even if one existed
    const r = await mint(ctx, svcAdmin, { name: "human-me", role: "admin", principal_type: "human" });
    expect(r.statusCode).toBe(403);
    const svcAnalyst = (await mint(ctx, ctx.admin, { name: "agent", role: "analyst", principal_type: "service" })).json().token;
    expect((await mint(ctx, svcAnalyst, { name: "human-me", role: "viewer" })).statusCode).toBe(403);
  });
  it("project admins cannot create projects and only see their own audit entries", async () => {
    const { ctx, pa } = await scopedAdmin();
    expect((await ctx.app.inject({ method: "POST", url: "/api/projects", headers: ctx.h(pa), payload: { id: "mine", name: "m" } })).statusCode).toBe(403);
    const audit = (await ctx.app.inject({ url: "/api/audit", headers: ctx.h(pa) })).json() as { project_id: string | null }[];
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((a) => a.project_id === "demo-castle")).toBe(true);
    expect((await ctx.app.inject({ url: "/api/audit?project=shop", headers: ctx.h(pa) })).statusCode).toBe(404);
    const all = (await ctx.app.inject({ url: "/api/audit", headers: ctx.h(ctx.admin) })).json() as { project_id: string | null }[];
    expect(all.some((a) => a.project_id === "shop")).toBe(true);
  });
});

// ---------------------------------------------------------------- blocker 2
describe("internal metadata is server-controlled and malformed records cannot stall the worker", () => {
  it("producer-supplied _dk_ metadata is rejected at the boundary, whatever its shape or depth", async () => {
    const ctx = await setup();
    const { appSrc } = await liveProject(ctx);
    const values: unknown[] = [5, "x", null, [1, 2], { removed_keys: 5, masked_values: "lots" }, { removed_keys: ["a"], masked_values: 1 }];
    for (const [i, v] of values.entries()) {
      for (const evidence of [{ _dk_redaction: v }, { nested: { deeper: [{ _DK_redaction: v }] } }]) {
        const r = await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${appSrc}` }, payload: ok(i, { source_event_id: `r-${i}-${JSON.stringify(evidence).length}`, evidence }) });
        expect(r.statusCode).toBe(422);
        expect(r.json().errors[0].detail).toMatch(/reserved field name/);
      }
    }
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM journal WHERE project_id = 'shop'").get()).toEqual({ n: 0 });
  });
  it("stored metadata of any type is sanitized on replay instead of throwing", async () => {
    const ctx = await setup();
    await liveProject(ctx);
    const metas = [{ redaction: { removed_keys: 5 } }, { redaction: { removed_keys: "x", masked_values: -3 } }, { redaction: null }, { redaction: [1] }, { redaction: { removed_keys: [{ a: 1 }, "ok"], masked_values: 1e99 } }, "garbage"];
    metas.forEach((m, i) => ctx.db.prepare("INSERT INTO journal (project_id, source_id, source_event_id, payload, received_at, meta, minimized) VALUES ('shop','app',?,?,?,?,1)").run(`m-${i}`, JSON.stringify(ok(100 + i, { source_event_id: `m-${i}` })), "2026-10-21T10:00:00Z", JSON.stringify(m)));
    const r = ctx.store.processBatch();
    expect(r.quarantined).toBe(0);
    expect(ctx.store.listEvents("shop")).toHaveLength(metas.length);
  });
  it("one malformed record followed by a valid one: the valid one is processed, the bad one quarantined, counted and audited", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dk-q-"));
    const ctx = await setup({ dbPath: join(dir, "db.sqlite") });
    const { appSrc } = await liveProject(ctx);
    ctx.db.prepare("INSERT INTO journal (project_id, source_id, source_event_id, payload, received_at, minimized) VALUES ('shop','app','poison','{not json',?,1)").run("2026-10-21T10:00:00Z");
    await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${appSrc}` }, payload: ok(1) });
    const r = ctx.store.processBatch();
    expect(r).toMatchObject({ processed: 2, quarantined: 1 });
    expect(ctx.store.listEvents("shop").map((e) => e.source_event_id)).toEqual(["ok-1"]);
    const q = (await ctx.app.inject({ url: "/api/projects/shop/quarantine", headers: ctx.h(ctx.admin) })).json().records;
    expect(q).toHaveLength(1);
    expect(q[0].source_event_id).toBe("poison");
    expect(ctx.db.prepare("SELECT value FROM counters WHERE project_id='shop' AND metric='rejected:quarantined'").get()).toEqual({ value: 1 });
    expect(ctx.store.listAudit("shop").some((a) => (a as { action: string }).action === "journal.quarantine")).toBe(true);
    await ctx.app.close(); ctx.db.close();
    const again = new Store(openDb(join(dir, "db.sqlite")));
    expect(again.processBatch().processed).toBe(0); // restart does not resurrect the poison record
    again.db.close();
  });
  it("infrastructure errors are not quarantined: the batch rolls back and the checkpoint does not move", async () => {
    const ctx = await setup();
    const { appSrc } = await liveProject(ctx);
    await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${appSrc}` }, payload: ok(1) });
    const before = ctx.store.checkpoint();
    const failing = new Store(ctx.db, { skipLegacyMinimization: true, faultHook: (s) => { if (s === "record") throw Object.assign(new Error("disk I/O error"), { code: "ERR_SQLITE_ERROR" }); } });
    expect(() => failing.processBatch()).toThrow(/disk I\/O/);
    expect(ctx.store.checkpoint()).toBe(before);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM quarantine").get()).toEqual({ n: 0 });
    expect(ctx.store.processBatch().processed).toBe(1); // retry succeeds once the fault clears
    expect(ctx.store.listEvents("shop")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- legacy upgrade
describe("upgrading a v0.2 database purges raw journal payloads", () => {
  const M = { pw: "LEGACYPW8c1f2e", bearer: "LEGACYBEARER4d5e6f7a8b9c", jwt: "eyJhbGciOiJIUzI1NiJ9.eyJsZWdhY3kiOiJ5In0.LEGACYSIGxyzw" };
  const scan = (dir: string) => {
    const blob = readdirSync(dir).filter((f) => f.startsWith("db.sqlite")).map((f) => readFileSync(join(dir, f)).toString("latin1")).join("\n");
    return Object.entries(M).filter(([, v]) => blob.includes(v)).map(([k]) => k);
  };
  it("pending and processed legacy rows are minimized; dedup, checkpoint and restart behave", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dk-legacy-"));
    const path = join(dir, "db.sqlite");
    const ctx = await setup({ dbPath: path });
    const { appSrc } = await liveProject(ctx);
    const raw = (n: number) => ok(n, { source_event_id: `legacy-${n}`, coverage_note: `Authorization: Bearer ${M.bearer}`, evidence: { password: M.pw, note: `jwt ${M.jwt}` } });
    for (const n of [1, 2]) await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${appSrc}` }, payload: raw(n) });
    ctx.store.processBatch(1); // legacy-1 processed, legacy-2 still pending
    await ctx.app.close();
    // Rewind the file to the v0.2 shape: v0.2 schema (migration 1 only) and raw payloads in the journal.
    const db = ctx.db;
    for (const n of [1, 2]) db.prepare("UPDATE journal SET payload = ? WHERE source_event_id = ?").run(JSON.stringify(raw(n)), `legacy-${n}`);
    db.exec(`DROP TABLE quarantine; ALTER TABLE journal DROP COLUMN meta; ALTER TABLE journal DROP COLUMN minimized;
      DROP INDEX events_project_seq; ALTER TABLE sources DROP COLUMN allowed_actions; ALTER TABLE sources DROP COLUMN independence_group;
      ALTER TABLE sources DROP COLUMN identity_namespace; ALTER TABLE sources DROP COLUMN run_namespace;
      ALTER TABLE findings DROP COLUMN state_version; DROP TABLE state_changes; ALTER TABLE sources DROP COLUMN config_revision; DROP TABLE source_revisions;
      ALTER TABLE containment_requests DROP COLUMN finding_revision; ALTER TABLE containment_requests DROP COLUMN policy_digest; ALTER TABLE containment_requests DROP COLUMN expires_at;
      DROP TABLE entities; DROP TABLE assertions; DROP TABLE reconciliations;
      ALTER TABLE sources DROP COLUMN sampling_ratio; ALTER TABLE sources DROP COLUMN retention_days; ALTER TABLE sources DROP COLUMN outcomes_reported;
      DROP INDEX events_source_received; DROP INDEX events_source_action; DROP TABLE bundles;
      DROP INDEX events_time_id; CREATE INDEX events_project_time ON events (project_id, occurred_at); DROP INDEX events_action_time; DROP INDEX events_source_time; DROP INDEX events_actor; DROP INDEX events_session; DROP INDEX events_request;
      DROP INDEX events_run; DROP INDEX events_client_ip; DROP INDEX events_route; DROP INDEX events_rule; DROP INDEX events_trace; DROP TABLE cases; DROP TABLE case_items; ALTER TABLE sources DROP COLUMN connector_id; ALTER TABLE sources DROP COLUMN granted_scopes; DROP TABLE collection_reports; ALTER TABLE api_tokens DROP COLUMN expires_at; ALTER TABLE api_tokens DROP COLUMN rotated_to; ALTER TABLE api_tokens DROP COLUMN oidc_issuer; ALTER TABLE api_tokens DROP COLUMN oidc_subject; DROP TABLE oidc_subjects;
      ALTER TABLE api_tokens DROP COLUMN principal_type; ALTER TABLE containment_requests DROP COLUMN requested_by_type;
      DELETE FROM schema_migrations WHERE version > 1; PRAGMA wal_checkpoint(TRUNCATE);`);
    db.close();
    expect(scan(dir).sort()).toEqual(["bearer", "jwt", "pw"]); // sanity: the legacy file really holds the markers

    // Upgrade: open with the current code (migrations + legacy minimization), then restart.
    const s1 = new Store(openDb(path));
    expect(scan(dir)).toEqual([]);
    expect(s1.db.prepare("SELECT COUNT(*) AS n FROM journal WHERE project_id = 'shop' AND minimized = 1").get()).toEqual({ n: 2 });
    expect(s1.processBatch()).toMatchObject({ processed: 1, quarantined: 0 }); // only the pending legacy row
    expect(s1.listEvents("shop").map((e) => e.source_event_id).sort()).toEqual(["legacy-1", "legacy-2"]);
    expect(s1.listEvents("shop").find((e) => e.source_event_id === "legacy-2")!.coverage_note).toMatch(/Redacted at ingestion/);
    expect(s1.receive("shop", "app", raw(1)).status).toBe("duplicate"); // dedup survives the rewrite
    s1.db.close();
    const s2 = new Store(openDb(path));
    expect(s2.processBatch().processed).toBe(0);
    expect(s2.minimizeLegacyJournal()).toEqual({ rewritten: 0, tombstoned: 0 });
    s2.db.close();
    expect(scan(dir)).toEqual([]);
  });
});
