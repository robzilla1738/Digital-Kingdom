import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** R01.3 immutable, revision-pinned evidence bundles. */
type Ctx = Awaited<ReturnType<typeof setup>>;
const P = "/api/projects/demo-castle";
const get = (ctx: Ctx, url: string, token = ctx.viewer) => ctx.app.inject({ url: `${P}${url}`, headers: ctx.h(token) });
const post = (ctx: Ctx, url: string, payload: unknown = {}, token = ctx.viewer) => ctx.app.inject({ method: "POST", url: `${P}${url}`, headers: ctx.h(token), payload: payload as object });

async function withClock() {
  const clock = { t: Date.parse("2026-10-21T12:00:00Z") };
  const ctx = await setup({ store: { now: () => new Date(clock.t) } });
  const blocked = ((await get(ctx, "/findings")).json() as { id: string; kind: string; event_ids: string[]; revision: number }[]).find((f) => f.kind === "blocked_request_reported" && f.event_ids.length > 3)!;
  const addBlocked = (n: number) => {
    ctx.store.receive("demo-castle", "src-edge", { source_event_id: `late-${n}`, occurred_at: "2026-10-20T14:01:30Z", asset_ids: ["edge"], action: "waf_match", outcome: "blocked", rule_ref: "sqli-942100", severity: "medium", route: "/orders/1" }, new Date(clock.t).toISOString());
    while (ctx.store.processBatch().processed) { /* drain */ }
  };
  return { ctx, clock, blocked, addBlocked };
}

describe("R01.3 bundles pin a finding revision", () => {
  it("new evidence cannot silently change an already pinned comparison; the bundle reopens identically", async () => {
    const { ctx, clock, blocked, addBlocked } = await withClock();
    const b = (await post(ctx, `/findings/${blocked.id}/bundles`)).json();
    expect(b).toMatchObject({ finding_revision: blocked.revision, reference_count: blocked.event_ids.length, expired: false, pinned: false });
    const page1 = (await get(ctx, `/bundles/${b.bundle_id}/events?limit=500`)).json();
    expect(page1).toMatchObject({ bundle_digest: b.bundle_digest, complete_page: true, page: { total_references: blocked.event_ids.length } });
    clock.t += 60_000; addBlocked(1);
    const now = ((await get(ctx, "/findings")).json() as { id: string; revision: number; event_ids: string[] }[]).find((f) => f.id === blocked.id)!;
    expect(now.revision).toBe(blocked.revision + 1);
    expect(now.event_ids.length).toBe(blocked.event_ids.length + 1);
    const again = (await get(ctx, `/bundles/${b.bundle_id}/events?limit=500`)).json();
    expect(again.events.map((e: { id: string }) => e.id)).toEqual(page1.events.map((e: { id: string }) => e.id));
    expect(again.bundle_digest).toBe(b.bundle_digest);
    // a new pin of the new revision is a different bundle; re-pinning the old revision is the same one
    const b2 = (await post(ctx, `/findings/${blocked.id}/bundles`)).json();
    expect(b2.bundle_id).not.toBe(b.bundle_id);
    expect((await post(ctx, `/findings/${blocked.id}/bundles`, { revision: blocked.revision })).json().bundle_id).toBe(b.bundle_id);
    // the historical revision itself is retrievable
    const rev = (await get(ctx, `/findings/${blocked.id}/revisions/${blocked.revision}`)).json();
    expect(rev).toMatchObject({ revision: blocked.revision, current_revision: blocked.revision + 1 });
    expect(rev.finding.event_ids).toEqual(blocked.event_ids);
    expect((await get(ctx, `/findings/${blocked.id}/revisions/999`)).statusCode).toBe(404);
  });

  it("deleted evidence is reported missing, not returned as an empty complete answer", async () => {
    const { ctx, blocked } = await withClock();
    const b = (await post(ctx, `/findings/${blocked.id}/bundles`)).json();
    ctx.db.prepare("DELETE FROM events WHERE project_id = 'demo-castle' AND id = ?").run(blocked.event_ids[0]!);
    const r = (await get(ctx, `/bundles/${b.bundle_id}/events?limit=500`)).json();
    expect(r.complete_page).toBe(false);
    expect(r.missing_events).toEqual([{ event_id: blocked.event_ids[0], reason: "deleted or purged since the bundle was made" }]);
    // a record altered after pinning is flagged, not served as if it were the pinned version
    ctx.db.prepare("UPDATE events SET body = json_set(body, '$.severity', 'critical') WHERE project_id = 'demo-castle' AND id = ?").run(blocked.event_ids[1]!);
    const c = (await get(ctx, `/bundles/${b.bundle_id}/events?limit=500`)).json();
    expect(c.changed_event_ids).toEqual([blocked.event_ids[1]]);
  });

  it("bundles expire unless pinned; expiry returns metadata (410), not an empty result", async () => {
    const { ctx, clock, blocked } = await withClock();
    const b = (await post(ctx, `/findings/${blocked.id}/bundles`)).json();
    const kept = (await post(ctx, `/findings/${blocked.id}/bundles`, { revision: blocked.revision })).json();
    expect(kept.bundle_id).toBe(b.bundle_id);
    clock.t += 31 * 86_400_000;
    const gone = await get(ctx, `/bundles/${b.bundle_id}/events`);
    expect(gone.statusCode).toBe(410);
    expect(gone.json().bundle).toMatchObject({ bundle_id: b.bundle_id, expired: true });
    // a fresh pin of the same content renews it; pinning to a case keeps it indefinitely
    expect((await post(ctx, `/findings/${blocked.id}/bundles`, { revision: blocked.revision })).json().expired).toBe(false);
    expect((await post(ctx, `/bundles/${b.bundle_id}/pin`, { reason: "case 42" })).statusCode).toBe(403); // viewer
    const pinned = (await post(ctx, `/bundles/${b.bundle_id}/pin`, { reason: "case 42" }, ctx.analyst)).json();
    expect(pinned).toMatchObject({ pinned: true, expires_at: null });
    clock.t += 365 * 86_400_000;
    expect((await get(ctx, `/bundles/${b.bundle_id}`)).statusCode).toBe(200);
  });

  it("the API and the case export report the same bundle digest", async () => {
    const { ctx, blocked } = await withClock();
    const b = (await post(ctx, `/findings/${blocked.id}/bundles`)).json();
    const exp = (await post(ctx, `/cases/${blocked.id}/export`, {}, ctx.analyst)).json();
    expect(exp.manifest.bundle).toMatchObject({ bundle_id: b.bundle_id, bundle_digest: b.bundle_digest, finding_revision: blocked.revision });
  });

  it("authorization is rechecked on every read", async () => {
    const { ctx, blocked } = await withClock();
    const b = (await post(ctx, `/findings/${blocked.id}/bundles`)).json();
    await ctx.app.inject({ method: "POST", url: "/api/projects", headers: ctx.h(ctx.admin), payload: { id: "other", name: "Other", dataset_kind: "live" } });
    const outsider = ctx.store.createToken("outsider", "viewer", ["other"]).token;
    expect([403, 404]).toContain((await get(ctx, `/bundles/${b.bundle_id}/events`, outsider)).statusCode);
    expect((await ctx.app.inject({ url: `/api/projects/other/bundles/${b.bundle_id}`, headers: ctx.h(ctx.admin) })).statusCode).toBe(404);
    expect((await get(ctx, `/bundles/${b.bundle_id}/events?limit=0`)).statusCode).toBe(400);
  });
});
