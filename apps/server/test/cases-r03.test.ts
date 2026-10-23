import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** R03.1 durable cases. */
type Ctx = Awaited<ReturnType<typeof setup>>;
const P = "/api/projects/demo-castle";
const req = (ctx: Ctx, method: "GET" | "POST", url: string, payload?: unknown, token = ctx.analyst) => ctx.app.inject({ method, url: `${P}${url}`, headers: ctx.h(token), ...(payload !== undefined ? { payload: payload as object } : {}) });
const ok = async (p: ReturnType<typeof req>) => { const r = await p; expect(r.statusCode, r.body).toBe(200); return r.json(); };

async function withCase() {
  const ctx = await setup();
  const c = await ok(req(ctx, "POST", "/cases", { title: "Suspicious checkout traffic", scope: { question: "Did anything reach orders-db?", asset_ids: ["api", "db"], after: "2026-10-20T13:00:00Z", before: "2026-10-20T16:00:00Z" }, closure_criteria: "Every database read in scope is attributed or explained." }));
  return { ctx, c };
}

describe("R03.1 cases are separate from findings", () => {
  it("a case may contain an event that produced no finding", async () => {
    const { ctx, c } = await withCase();
    const findings = ctx.store.listFindings("demo-castle");
    const cited = new Set(findings.flatMap((f) => [...f.event_ids, ...f.counterevidence_event_ids]));
    const orphan = ctx.store.listEvents("demo-castle", { limit: 5000 }).find((e) => !cited.has(e.id))!;
    expect(orphan).toBeTruthy();
    const after = await ok(req(ctx, "POST", `/cases/${c.id}/items`, { kind: "event", ref: orphan.id, why: "request to the admin route with no rule match", expected_version: 1 }));
    const item = after.items.find((i: { kind: string }) => i.kind === "event");
    expect(item).toMatchObject({ ref: orphan.id, produced_finding: false, why: expect.stringContaining("admin route") });
    expect(after.version).toBe(2);
  });

  it("a closed detector finding does not close an unresolved case", async () => {
    const { ctx, c } = await withCase();
    const f = ctx.store.listFindings("demo-castle")[0]!;
    await ok(req(ctx, "POST", `/cases/${c.id}/items`, { kind: "finding", ref: f.id, expected_version: 1 }));
    await ok(req(ctx, "POST", `/findings/${f.id}/disposition`, { lifecycle: "closed", disposition: "benign", expected_state_version: 0 }));
    const now = await ok(req(ctx, "GET", `/cases/${c.id}`, undefined, ctx.viewer));
    expect(now.status).toBe("open");
    expect(now.linked_findings[0]).toMatchObject({ finding_id: f.id, current_lifecycle: "closed" });
  });

  it("closing needs every question answered or accepted unresolved, a statement, and the owner or an admin", async () => {
    const { ctx, c } = await withCase();
    let cur = await ok(req(ctx, "POST", `/cases/${c.id}/items`, { kind: "question", text: "Which account issued the reads?", expected_version: 1 }));
    const q = cur.items.find((i: { kind: string }) => i.kind === "question");
    const blocked = await req(ctx, "POST", `/cases/${c.id}/status`, { status: "closed", statement: "done", expected_version: cur.version });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().details).toEqual([q.item_id]);
    cur = await ok(req(ctx, "POST", `/cases/${c.id}/items/${q.item_id}/question`, { status: "accepted_unresolved", answer: "No identity telemetry on the database; recorded as a coverage gap.", expected_version: cur.version }));
    const other = ctx.store.createToken("another analyst", "analyst").token;
    expect((await req(ctx, "POST", `/cases/${c.id}/status`, { status: "closed", statement: "x", expected_version: cur.version }, other)).statusCode).toBe(403);
    expect((await req(ctx, "POST", `/cases/${c.id}/status`, { status: "closed", expected_version: cur.version })).statusCode).toBe(400);
    const closed = await ok(req(ctx, "POST", `/cases/${c.id}/status`, { status: "closed", statement: "Reads attributed to the nightly export job; one gap accepted.", expected_version: cur.version }));
    expect(closed).toMatchObject({ status: "closed", closure: { statement: expect.stringContaining("nightly export"), criteria: c.closure_criteria } });
    expect((await req(ctx, "POST", `/cases/${c.id}/items`, { kind: "note", text: "late", expected_version: closed.version })).statusCode).toBe(409);
  });
});

describe("R03.1 history and concurrency", () => {
  it("concurrent edits and scope changes retain history; a stale editor gets 409 with the changes", async () => {
    const { ctx, c } = await withCase();
    const second = ctx.store.createToken("second analyst", "analyst").token;
    await ok(req(ctx, "POST", `/cases/${c.id}`, { scope: { question: "Did anything reach orders-db or blob storage?", asset_ids: ["api", "db", "blob"] }, reason: "blob added after triage", expected_version: 1 }));
    const stale = await req(ctx, "POST", `/cases/${c.id}`, { title: "Renamed", expected_version: 1 }, second);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().changes_since[0]).toMatchObject({ version: 2, before: { scope: { asset_ids: ["api", "db"] } }, after: { scope: { asset_ids: ["api", "db", "blob"] } }, reason: "blob added after triage" });
    expect((await req(ctx, "POST", `/cases/${c.id}`, { title: "Renamed" })).statusCode).toBe(428);
    const removed = await ok(req(ctx, "POST", `/cases/${c.id}/items`, { kind: "note", text: "first thought", expected_version: 2 }));
    const note = removed.items.find((i: { kind: string }) => i.kind === "note");
    const after = await ok(req(ctx, "POST", `/cases/${c.id}/items/${note.item_id}/remove`, { reason: "superseded", expected_version: 3 }));
    expect(after.items.find((i: { item_id: string }) => i.item_id === note.item_id).removed).toMatchObject({ reason: "superseded" }); // tombstone, not deletion
    expect(after.history.map((h: { version: number }) => h.version)).toEqual([1, 2, 3, 4]);
  });

  it("viewers can read but not change cases", async () => {
    const { ctx, c } = await withCase();
    expect((await req(ctx, "GET", "/cases", undefined, ctx.viewer)).json().cases[0]).toMatchObject({ id: c.id, open_questions: 0 });
    expect((await req(ctx, "POST", `/cases/${c.id}/items`, { kind: "note", text: "x", expected_version: 1 }, ctx.viewer)).statusCode).toBe(403);
    expect((await req(ctx, "POST", "/cases", { title: "x", scope: { question: "q", asset_ids: ["ghost"] }, closure_criteria: "c" })).statusCode).toBe(422);
  });
});

describe("R03.1 case export", () => {
  it("reopens with matching references and lists unavailable records explicitly", async () => {
    const { ctx, c } = await withCase();
    const f = ctx.store.listFindings("demo-castle").find((x) => x.event_ids.length > 2)!;
    let cur = await ok(req(ctx, "POST", `/cases/${c.id}/items`, { kind: "finding", ref: f.id, expected_version: 1 }));
    const bundleId = cur.linked_findings[0].bundle_id;
    cur = await ok(req(ctx, "POST", `/cases/${c.id}/items`, { kind: "event", ref: f.event_ids[0], expected_version: cur.version }));
    const first = await ok(req(ctx, "POST", `/cases/${c.id}/export`, {}));
    expect(first.manifest).toMatchObject({ format: "digital-kingdom-case/2", case_id: c.id, complete: true });
    expect(first.manifest.bundle_digests[bundleId]).toBe((await ok(req(ctx, "GET", `/bundles/${bundleId}`, undefined, ctx.viewer))).bundle_digest);
    expect((await ctx.app.inject({ method: "POST", url: "/api/verify-export", headers: ctx.h(ctx.viewer), payload: first })).json().valid).toBe(true);
    // the bundle is pinned to the case, so it never expires
    expect((await ok(req(ctx, "GET", `/bundles/${bundleId}`, undefined, ctx.viewer))).pinned).toBe(true);
    ctx.db.prepare("DELETE FROM events WHERE project_id = 'demo-castle' AND id = ?").run(f.event_ids[1]!);
    const second = await ok(req(ctx, "POST", `/cases/${c.id}/export`, {}));
    expect(second.manifest.complete).toBe(false);
    expect(second.sections.unavailable).toEqual([{ item: expect.any(String), ref: f.event_ids[1], reason: "deleted or purged since the bundle was made" }]);
    expect(second.sections.bundles[0].events.map((e: { id: string }) => e.id)).toEqual(first.sections.bundles[0].events.map((e: { id: string }) => e.id).filter((id: string) => id !== f.event_ids[1]));
  });
});
