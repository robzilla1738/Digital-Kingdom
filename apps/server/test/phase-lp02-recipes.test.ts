import { describe, expect, it } from "vitest";
import { setup, liveGraph } from "./helpers.ts";
import { runRecipe } from "../src/recipes.ts";
import { searchEvents } from "../src/investigate.ts";

/**
 * LP02: recipe conclusions and incomplete work. Written against recipes@1 (dk.recipe_run.v1) first; see the LP02
 * receipt for which of these failed before the repair.
 */
const T0 = Date.parse("2026-10-23T10:00:00Z");
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
type Hyp = { id: string; status: string; kind?: string; supporting_event_ids: string[] };

interface Opts {
  /** identity_namespace of the database audit source (default shared with the app: idp:corp). */
  dbNamespace?: string | null;
  /** omit the database audit source entirely */
  noDbSource?: boolean;
  /** graph without any data store */
  noDataAssets?: boolean;
  /** benign follow-on requests by alice before the decisive read */
  padding?: number;
}
async function world(o: Opts = {}) {
  const clock = { t: T0 - 3600_000 };
  const ctx = await setup({ store: { now: () => new Date(clock.t) } });
  const { app, admin, h } = ctx;
  await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "shop", name: "Shop", dataset_kind: "live" } });
  const g = liveGraph();
  if (o.noDataAssets) { g.assets = g.assets.filter((a) => a.kind !== "database"); g.relationships = g.relationships.filter((r) => r.target_id !== "db"); }
  expect((await app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: h(admin), payload: g })).statusCode).toBe(200);
  const sources: Record<string, unknown>[] = [{ id: "app", label: "checkout app", kind: "app_security", asset_ids: ["api"], identity_namespace: "idp:corp", stale_after_seconds: 3600 }];
  if (!o.noDbSource && !o.noDataAssets) sources.push({ id: "dbaudit", label: "db audit", kind: "db_audit", asset_ids: ["db"], ...(o.dbNamespace === null ? {} : { identity_namespace: o.dbNamespace ?? "idp:corp" }), stale_after_seconds: 3600 });
  for (const s of sources) expect((await app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: h(admin), payload: s })).statusCode).toBe(200);
  let n = 0;
  const send = (src: string, sec: number, p: Record<string, unknown>) => ctx.store.receive("shop", src, { source_event_id: `e${++n}`, occurred_at: at(sec), asset_ids: [src === "app" ? "api" : "db"], ...p }, at(sec));
  for (let i = 0; i < 6; i++) send("app", i * 10, { action: "authentication", outcome: "failure", actor_ref: "alice", client_ip: "203.0.113.9" });
  send("app", 70, { action: "authentication", outcome: "success", actor_ref: "alice", client_ip: "203.0.113.9" });
  for (let i = 0; i < (o.padding ?? 0); i++) send("app", 80 + i, { action: "request_received", outcome: "allowed", actor_ref: "alice", route: "/orders" });
  if (sources.some((s) => s.id === "dbaudit")) for (let s = 0; s <= 7200; s += 600) send("dbaudit", s, { action: "data_access", outcome: "success", actor_ref: s === 3000 ? "alice" : "etl" });
  while (ctx.store.processBatch().processed) { /* drain */ }
  clock.t = T0 + 3 * 3600_000;
  const finding = ctx.store.listFindings("shop").find((f) => f.kind === "repeated_auth_failure")!;
  expect(finding).toBeTruthy();
  const decisive = () => ctx.store.listEvents("shop", { limit: 5000 }).find((e) => e.action === "data_access" && e.actor_ref === "alice");
  return { ctx, finding, decisive, run: (max = 6, deps?: Parameters<typeof runRecipe>[6]) => runRecipe(ctx.store, "shop", "auth-burst-then-success", finding.id, "test-secret", max, deps) };
}

describe("LP02-A1 unknown work stays unknown", () => {
  it("budget exhaustion: coverage questions that never ran block the conclusion and are listed as not run", async () => {
    const { run } = await world();
    const r = run(1) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.budget.exhausted).toBe(true);
    expect(r.conclusion_allowed).toBe(false);
    expect(r.completeness).toBe("partial");
    expect(r.stop_conditions.find((s: { condition: string }) => s.condition.startsWith("authentication observer")).triggered).toBe(true);
    expect(r.stop_conditions.find((s: { condition: string }) => s.condition.startsWith("data-access observer")).triggered).toBe(true);
    expect(r.obligations.filter((o: { status: string }) => o.status === "not_started").length).toBeGreaterThan(0);
    for (const s of r.stop_conditions) expect(s.reason).not.toMatch(/was observable/);
  });

  it("a failed page is recorded as failed, outstanding and blocking (not an empty result, not a crash)", async () => {
    const { run } = await world();
    let calls = 0;
    const failing: typeof searchEvents = (...args) => { if (++calls === 1) throw new Error("disk I/O error"); return searchEvents(...args); };
    const r = run(6, { search: failing }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const failed = r.queries.find((q: { status: string }) => q.status === "failed");
    expect(failed).toMatchObject({ status: "failed", error: expect.stringMatching(/disk I\/O/), follow_on_event_ids: [] });
    expect(r.outstanding.some((x: { purpose: string }) => x.purpose === failed.purpose)).toBe(true);
    expect(r.conclusion_allowed).toBe(false);
    expect(r.hypotheses.find((h: Hyp) => h.id === "failures_then_success_same_identity").status).toBe("unresolved");
  });

  it("zero configured observers for the data store never reads as 'data access was observable'", async () => {
    const { run } = await world({ noDbSource: true });
    const r = run() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const stop = r.stop_conditions.find((s: { condition: string }) => s.condition.startsWith("data-access observer"));
    expect(stop.triggered).toBe(true);
    expect(r.conclusion_allowed).toBe(false);
  });

  it("a graph with no declared data store makes the read question unavailable, not answered", async () => {
    const { run } = await world({ noDataAssets: true });
    const r = run() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.stop_conditions.find((s: { condition: string }) => s.condition.startsWith("data-access observer"))).toMatchObject({ triggered: true, reason: expect.stringMatching(/no data store/i) });
    expect(r.obligations.find((o: { id: string }) => o.id.startsWith("coverage:data_access"))).toMatchObject({ status: "unavailable" });
  });
});

describe("LP02-A2 results beyond the first page", () => {
  it("a decisive event after 100+ follow-on records is retrieved through continuation pages", async () => {
    const { run, decisive } = await world({ padding: 130 });
    const r = run(12) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const follow = r.queries.find((q: { params: { actor_ref?: string } }) => q.params.actor_ref === "alice");
    expect(follow.pages).toBeGreaterThan(1);
    expect(follow.status).toBe("complete");
    expect(r.unlinked_follow_on_event_ids).toContain(decisive()!.id);
    expect(r.hypotheses.find((h: Hyp) => h.id === "failures_then_success_same_identity").supporting_event_ids).toContain(decisive()!.id);
  });

  it("when the budget stops after page one, the query is partial with a resumable continuation and nothing is concluded", async () => {
    const { run, decisive } = await world({ padding: 130 });
    const r = run(1) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const follow = r.queries.find((q: { params: { actor_ref?: string } }) => q.params.actor_ref === "alice");
    expect(follow).toMatchObject({ status: "partial", pages: 1 });
    expect(follow.follow_on_event_ids).not.toContain(decisive()!.id);
    const out = r.outstanding.find((x: { purpose: string }) => x.purpose === follow.purpose);
    expect(out).toMatchObject({ reason: expect.stringMatching(/budget/), continuation: { cursor: expect.any(String) } });
    expect(r.completeness).toBe("partial");
    expect(r.conclusion_allowed).toBe(false);
  });
});

describe("LP02-A3 namespaces bound every pivot", () => {
  it("the same raw actor string from an unrelated authority is excluded from support", async () => {
    const { run, decisive } = await world({ dbNamespace: "idp:partner" });
    const r = run() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const id = decisive()!.id;
    const hyp = r.hypotheses.find((h: Hyp) => h.id === "failures_then_success_same_identity");
    expect(hyp.supporting_event_ids).not.toContain(id);
    const follow = r.queries.find((q: { params: { actor_ref?: string } }) => q.params.actor_ref === "alice");
    expect(follow.scope).toMatchObject({ type: "actor", namespace: "idp:corp" });
    expect(follow.other_authority_event_ids).toContain(id);
  });
  it("an undeclared (per-source) namespace never joins with the identity provider's account", async () => {
    const { run, decisive } = await world({ dbNamespace: null });
    const r = run() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.hypotheses.find((h: Hyp) => h.id === "failures_then_success_same_identity").supporting_event_ids).not.toContain(decisive()!.id);
  });
  it("a shared authority still correlates (positive control)", async () => {
    const { run, decisive } = await world();
    const r = run() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.hypotheses.find((h: Hyp) => h.id === "failures_then_success_same_identity").supporting_event_ids).toContain(decisive()!.id);
  });
});

describe("LP02-A4 observable propositions are separated from intent and approval", () => {
  it("failures, a success and ordinary activity support only the observable proposition, never guessing", async () => {
    const { run } = await world();
    const r = run() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.schema).toBe("dk.recipe_run.v2");
    expect(r.recipe.version).toBe(2);
    expect(r.hypotheses.find((h: Hyp) => h.id === "failures_then_success_same_identity")).toMatchObject({ kind: "observable", status: "supported" });
    const intent = r.hypotheses.filter((h: Hyp) => h.kind === "intent" || h.kind === "authorization");
    expect(intent.map((h: Hyp) => h.id).sort()).toEqual(["credential_guessing", "legitimate_mistyping"]);
    for (const h of intent) { expect(h.status).not.toBe("supported"); expect(h.supporting_event_ids).toEqual([]); }
    expect(r.hypotheses.some((h: { statement: string; kind: string }) => h.kind === "observable" && /guess/i.test(h.statement))).toBe(false);
  });

  it("an allowed and independently observed tool call never establishes approval", async () => {
    const clock = { t: T0 - 3600_000 };
    const ctx = await setup({ store: { now: () => new Date(clock.t) } });
    const { app, admin, h } = ctx;
    await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "ag", name: "Agent", dataset_kind: "live" } });
    await app.inject({ method: "POST", url: "/api/projects/ag/graph", headers: h(admin), payload: { schema_version: "0.2", dataset_kind: "live", project_id: "ag", graph_revision: "r1", assets: [
      { id: "agent", name: "helper", kind: "agent", environment: "lab", allowed_zone_ids: ["automation"], source_refs: ["m"] },
      { id: "tools", name: "tool gw", kind: "tool_server", environment: "lab", allowed_zone_ids: ["automation"], source_refs: ["m"] }], relationships: [{ id: "r1", source_id: "agent", target_id: "tools", kind: "invokes_tool", evidence_level: "declared", evidence_refs: ["m"] }] } });
    for (const s of [{ id: "gw", label: "gateway", kind: "agent_observer", asset_ids: ["agent", "tools"], run_namespace: "rt:lab", stale_after_seconds: 3600 }, { id: "obs", label: "observer", kind: "effect_observer", asset_ids: ["tools"], run_namespace: "rt:lab", stale_after_seconds: 3600 }])
      expect((await app.inject({ method: "POST", url: "/api/projects/ag/sources", headers: h(admin), payload: s })).statusCode).toBe(200);
    let n = 0;
    const send = (src: string, sec: number, p: Record<string, unknown>) => ctx.store.receive("ag", src, { source_event_id: `a${++n}`, occurred_at: at(sec), ...p }, at(sec));
    send("gw", 0, { asset_ids: ["agent"], action: "tool_invocation", outcome: "allowed", run_id: "run-7", agent: { phase: "decision", origin: "policy_enforcer", tool: "upload" } });
    send("gw", 1, { asset_ids: ["tools"], action: "tool_invocation", outcome: "success", run_id: "run-7", agent: { phase: "execution", origin: "tool_wrapper", tool: "upload" } });
    send("obs", 2, { asset_ids: ["tools"], action: "side_effect_observed", outcome: "observed", run_id: "run-7", agent: { phase: "effect", origin: "independent_observer", tool: "upload" } });
    for (let s = 600; s <= 7200; s += 600) { send("obs", s, { asset_ids: ["tools"], action: "sensor_restored", outcome: "unknown" }); send("gw", s, { asset_ids: ["agent"], action: "sensor_restored", outcome: "unknown" }); }
    while (ctx.store.processBatch().processed) { /* drain */ }
    clock.t = T0 + 3 * 3600_000;
    const f = ctx.store.listFindings("ag").find((x) => x.kind === "agent_effect_observed");
    expect(f, JSON.stringify(ctx.store.listFindings("ag").map((x) => x.kind))).toBeTruthy();
    const r = runRecipe(ctx.store, "ag", "agent-effect-attribution", f!.id, "test-secret") as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const approval = r.hypotheses.find((x: Hyp) => x.id === "call_was_approved");
    expect(approval).toMatchObject({ kind: "authorization", supporting_event_ids: [] });
    expect(approval.status).not.toBe("supported");
    expect(r.hypotheses.some((x: { id: string; statement: string; status: string }) => x.status === "supported" && /approv/i.test(x.statement))).toBe(false);
  });
});
