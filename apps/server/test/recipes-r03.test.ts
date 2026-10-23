import { describe, expect, it } from "vitest";
import { setup, liveGraph } from "./helpers.ts";

/** R03.2 deterministic investigation recipes. LP02 (recipes@2): "guessing_succeeded" was split into the observable
 * "failures_then_success_same_identity" and the intent hypothesis "credential_guessing", which telemetry never supports. */
const T0 = Date.parse("2026-10-21T10:00:00Z");
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();

async function scenario(opts: { dbDark?: boolean } = {}) {
  const clock = { t: T0 - 3600_000 };
  const ctx = await setup({ store: { now: () => new Date(clock.t) } });
  const { app, admin, h } = ctx;
  await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "shop", name: "Shop", dataset_kind: "live" } });
  await app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: h(admin), payload: liveGraph() });
  for (const s of [
    { id: "app", label: "checkout app", kind: "app_security", asset_ids: ["api"], identity_namespace: "idp:corp", stale_after_seconds: 3600 },
    { id: "dbaudit", label: "db audit", kind: "db_audit", asset_ids: ["db"], identity_namespace: "idp:corp", stale_after_seconds: 3600 },
  ]) await app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: h(admin), payload: s });
  let n = 0;
  const send = (src: string, sec: number, p: Record<string, unknown>) => ctx.store.receive("shop", src, { source_event_id: `e${++n}`, occurred_at: at(sec), asset_ids: [src === "app" ? "api" : "db"], ...p }, at(sec));
  for (let i = 0; i < 6; i++) send("app", i * 10, { action: "authentication", outcome: "failure", actor_ref: "alice", client_ip: "203.0.113.9" });
  send("app", 70, { action: "authentication", outcome: "success", actor_ref: "alice", client_ip: "203.0.113.9" });
  send("app", 90, { action: "request_received", outcome: "allowed", actor_ref: "bob", client_ip: "203.0.113.9", route: "/orders" }); // shared-IP bait
  if (opts.dbDark) send("dbaudit", 0, { action: "sensor_unavailable", outcome: "unknown", coverage_note: "audit permission revoked" });
  else for (let s = 0; s <= 7200; s += 600) send("dbaudit", s, { action: "data_access", outcome: "success", actor_ref: s === 600 ? "alice" : "etl" });
  while (ctx.store.processBatch().processed) { /* drain */ }
  clock.t = T0 + 3 * 3600_000;
  const finding = ctx.store.listFindings("shop").find((f) => f.kind === "repeated_auth_failure")!;
  const run = async (recipe: string, body: Record<string, unknown> = {}, token = ctx.viewer) => ctx.app.inject({ method: "POST", url: `/api/projects/shop/recipes/${recipe}/run`, headers: h(token), payload: { finding_id: finding.id, ...body } });
  return { ctx, finding, run };
}

describe("R03.2 recipes distinguish explanations", () => {
  it("shared-IP attribution bait stays separate", async () => {
    const { finding, run } = await scenario();
    expect(finding).toBeTruthy();
    const r = (await run("auth-burst-then-success")).json();
    const shared = r.hypotheses.find((x: { id: string }) => x.id === "shared_locator");
    expect(shared).toMatchObject({ status: "unresolved", needs: expect.stringMatching(/identity link/) });
    const guessing = r.hypotheses.find((x: { id: string }) => x.id === "failures_then_success_same_identity");
    // bob's request (same IP) is never evidence about alice
    const ipQuery = r.queries.find((q: { params: { client_ip?: string } }) => q.params.client_ip);
    expect(ipQuery.follow_on_event_ids.length).toBeGreaterThan(0);
    for (const id of ipQuery.follow_on_event_ids) expect(guessing.supporting_event_ids).not.toContain(id);
  });

  it("recipes query unlinked follow-on events, not only the finding's references", async () => {
    const { ctx, finding, run } = await scenario();
    const r = (await run("auth-burst-then-success")).json();
    const aliceRead = ctx.store.listEvents("shop", { limit: 500 }).find((e) => e.action === "data_access" && e.actor_ref === "alice")!;
    expect(finding.event_ids).not.toContain(aliceRead.id);
    expect(r.unlinked_follow_on_event_ids).toContain(aliceRead.id);
    expect(r.hypotheses.find((x: { id: string }) => x.id === "failures_then_success_same_identity")).toMatchObject({ kind: "observable", status: "supported", supporting_event_ids: expect.arrayContaining([aliceRead.id]) });
    expect(r.hypotheses.find((x: { id: string }) => x.id === "credential_guessing")).toMatchObject({ kind: "intent", status: "open", supporting_event_ids: [] });
    expect(r.conclusion_allowed).toBe(true);
    expect(r.budget.used).toBeLessThanOrEqual(r.budget.max_queries);
  });

  it("missing observer capability stops an unjustified conclusion", async () => {
    const { run } = await scenario({ dbDark: true });
    const r = (await run("auth-burst-then-success")).json();
    expect(r.conclusion_allowed).toBe(false);
    expect(r.stop_conditions.find((s: { condition: string }) => s.condition.startsWith("data-access")).reason).toMatch(/No conclusion that data was NOT accessed: db/);
  });

  it("a benign maintenance case can be resolved without changing facts", async () => {
    const { ctx, finding, run } = await scenario();
    const assertions = () => (ctx.db.prepare("SELECT COUNT(*) AS n FROM assertions WHERE project_id = 'shop'").get() as { n: number }).n;
    const before = assertions();
    const c = (await ctx.app.inject({ method: "POST", url: "/api/projects/shop/cases", headers: ctx.h(ctx.analyst), payload: { title: "Burst on alice", scope: { question: "Was this alice?", asset_ids: ["api"] }, closure_criteria: "Owner confirms or refutes." } })).json();
    const attached = await run("auth-burst-then-success", { case_id: c.id, expected_version: 1 }, ctx.analyst);
    expect(attached.statusCode, attached.body).toBe(200);
    let cur = (await ctx.app.inject({ url: `/api/projects/shop/cases/${c.id}`, headers: ctx.h(ctx.viewer) })).json();
    for (const h of cur.items.filter((i: { kind: string }) => i.kind === "hypothesis")) {
      const status = h.text.includes("mistyped") ? "supported" : h.text.includes("guessing") ? "refuted" : "accepted_unresolved";
      cur = (await ctx.app.inject({ method: "POST", url: `/api/projects/shop/cases/${c.id}/items/${h.item_id}/question`, headers: ctx.h(ctx.analyst), payload: { status, answer: "Alice confirmed she mistyped during scheduled password rotation.", expected_version: cur.version } })).json();
    }
    const closed = await ctx.app.inject({ method: "POST", url: `/api/projects/shop/cases/${c.id}/status`, headers: ctx.h(ctx.analyst), payload: { status: "closed", statement: "Benign: owner-confirmed during maintenance.", expected_version: cur.version } });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(assertions()).toBe(before);
    expect(ctx.store.listFindings("shop").find((f) => f.id === finding.id)!.event_ids).toEqual(finding.event_ids);
  });

  it("recipes are versioned, scoped to finding kinds, and viewers cannot attach to cases", async () => {
    const { ctx, run } = await scenario();
    expect((await ctx.app.inject({ url: "/api/recipes", headers: ctx.h(ctx.viewer) })).json().recipes.map((r: { id: string; version: number }) => `${r.id}@${r.version}`)).toContain("auth-burst-then-success@2");
    expect((await run("blocked-request-scope")).statusCode).toBe(422);
    expect((await run("nope")).statusCode).toBe(404);
    expect((await run("auth-burst-then-success", { case_id: "case_x", expected_version: 1 })).statusCode).toBe(403);
  });
});
