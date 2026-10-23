import { describe, expect, it } from "vitest";
import { evaluate } from "@dk/detections";
import { setup, liveGraph } from "./helpers.ts";
import { parseSearchQuery, searchEvents } from "../src/investigate.ts";

/** R01.5 bounded query work and snapshot semantics. */
const T = "2026-10-21T10:00:00.000Z";
async function project() {
  const clock = { t: Date.parse("2026-10-21T12:00:00Z") };
  const ctx = await setup({ store: { now: () => new Date(clock.t) } });
  const { app, admin, h } = ctx;
  await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "shop", name: "Shop", dataset_kind: "live" } });
  await app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: h(admin), payload: liveGraph() });
  await app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: h(admin), payload: { id: "app", label: "app", kind: "app_security", asset_ids: ["api"] } });
  let n = 0;
  const add = (count: number, occ = T, extra: Record<string, unknown> = {}) => {
    for (let i = 0; i < count; i++) ctx.store.receive("shop", "app", { source_event_id: `e-${++n}`, occurred_at: occ, asset_ids: ["api"], action: "request_received", outcome: "success", ...extra });
    while (ctx.store.processBatch().processed) { /* drain */ }
  };
  const q = (extra: Record<string, string> = {}) => parseSearchQuery({ after: "2026-10-21T09:00:00Z", before: "2026-10-21T11:00:00Z", limit: "7", ...extra });
  return { ctx, clock, add, q };
}

describe("R01.5 snapshot semantics", () => {
  it("tied timestamps and late arrivals never skip or duplicate results across pages", async () => {
    const { ctx, add, q } = await project();
    add(30); // 30 events with the SAME occurred_at
    const seen: string[] = [];
    let cursor: string | undefined; let pages = 0;
    do {
      const { query } = q();
      const r = searchEvents(ctx.store, "shop", query, "s", cursor);
      seen.push(...r.events.map((e) => e.id));
      cursor = r.page.next_cursor ?? undefined; pages++;
      if (pages === 2) add(5); // late arrivals between pages, same timestamp
    } while (cursor && pages < 20);
    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
    const fresh = searchEvents(ctx.store, "shop", q().query, "s");
    expect(fresh.query_completeness.matching_in_snapshot).toBe(35);
  });

  it("records removed after the first page are reported, not silently skipped", async () => {
    const { ctx, add, q } = await project();
    add(20);
    const p1 = searchEvents(ctx.store, "shop", q().query, "s");
    const last = p1.events.at(-1)!.id;
    ctx.db.prepare("DELETE FROM events WHERE project_id = 'shop' AND id IN (SELECT id FROM events WHERE project_id = 'shop' AND id > ? ORDER BY id LIMIT 3)").run(last);
    const p2 = searchEvents(ctx.store, "shop", q().query, "s", p1.page.next_cursor!);
    expect(p2.query_completeness).toMatchObject({ complete: false, removed_since_first_page: 3 });
    expect(p2.query_completeness.note).toMatch(/removed from storage after the first page/);
  });

  it("cursors expire with a stated time", async () => {
    const { ctx, clock, add, q } = await project();
    add(20);
    const p1 = searchEvents(ctx.store, "shop", q().query, "s");
    expect(p1.scanned_scope.cursor_expires_at).toBe("2026-10-21T13:00:00.000Z");
    clock.t += 61 * 60_000;
    expect(() => searchEvents(ctx.store, "shop", q().query, "s", p1.page.next_cursor!)).toThrow(/cursor expired at 2026-10-21T13:00:00.000Z/);
  });
});

describe("R01.5 work budgets", () => {
  it("counts stop at the cap and say so; the result is never presented as complete", async () => {
    const { ctx, add, q } = await project();
    add(25);
    const r = searchEvents(ctx.store, "shop", q({ limit: "100" }).query, "s", undefined, { countCap: 10 });
    expect(r.query_completeness).toMatchObject({ matching_in_snapshot: 10, matching_capped: true, complete: false });
    expect(r.query_completeness.note).toMatch(/count is capped/);
    expect(r.events).toHaveLength(25); // the page itself is still exact
  });
  it("a page stops at the response byte budget and continues by cursor", async () => {
    const { ctx, add, q } = await project();
    add(10, T, { coverage_note: "x".repeat(400) });
    const r = searchEvents(ctx.store, "shop", q({ limit: "100" }).query, "s", undefined, { byteBudget: 2500 });
    expect(r.events.length).toBeGreaterThan(0);
    expect(r.events.length).toBeLessThan(10);
    expect(r.scanned_scope.truncated_by).toBe("byte_budget");
    expect(r.page.has_more).toBe(true);
    let total = r.events.length, cursor = r.page.next_cursor;
    while (cursor) { const n = searchEvents(ctx.store, "shop", q({ limit: "100" }).query, "s", cursor, { byteBudget: 2500 }); total += n.events.length; cursor = n.page.next_cursor; }
    expect(total).toBe(10);
  });
  it("results state their scanned scope and budgets", async () => {
    const { ctx, add, q } = await project();
    add(3);
    const r = searchEvents(ctx.store, "shop", q().query, "s");
    expect(r.scanned_scope).toMatchObject({ interval: { after: "2026-10-21T09:00:00.000Z" }, sources_in_scope: ["app"], budgets: { count_cap: 100000, page_byte_budget: 1000000, cursor_ttl_seconds: 3600 }, truncated_by: null, cursor_expires_at: null });
  });
  it("each principal is rate limited (one caller cannot monopolize the event loop)", async () => {
    const { ctx } = await project();
    const url = "/api/projects/shop/events/search?after=2026-10-21T09:00:00Z&before=2026-10-21T11:00:00Z";
    const codes: number[] = [];
    for (let i = 0; i < 32; i++) codes.push((await ctx.app.inject({ url, headers: ctx.h(ctx.viewer) })).statusCode);
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
    expect((await ctx.app.inject({ url, headers: ctx.h(ctx.analyst) })).statusCode).toBe(200); // per principal
  });
});

describe("R01.5 current coverage without a rule run", () => {
  it("the cheap coverage path equals the full evaluation's coverage", async () => {
    const { ctx } = await project();
    const ix = ctx.store.getGraph("demo-castle")!;
    const full = evaluate(ix, ctx.store.listEvents("demo-castle", { limit: 50_000 }), { sources: ctx.store.listSources("demo-castle") });
    const cheap = ctx.store.evaluation("demo-castle");
    expect(cheap.coverage).toEqual(full.coverage);
    expect(cheap.unobserved_asset_ids).toEqual(full.unobserved_asset_ids);
  });
});
