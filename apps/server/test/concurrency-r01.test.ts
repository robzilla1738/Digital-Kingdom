import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** R01.4 optimistic concurrency and decision history. */
type Ctx = Awaited<ReturnType<typeof setup>>;
const P = "/api/projects/demo-castle";
const post = (ctx: Ctx, url: string, payload: unknown, token = ctx.analyst, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: "POST", url: `${P}${url}`, headers: { ...ctx.h(token), ...headers }, payload: payload as object });
const get = (ctx: Ctx, url: string, token = ctx.viewer) => ctx.app.inject({ url: `${P}${url}`, headers: ctx.h(token) });

describe("R01.4 finding review preconditions", () => {
  it("two concurrent edits from the same base cannot both silently win", async () => {
    const ctx = await setup();
    const f = (await get(ctx, "/findings")).json()[0];
    expect(f.state_version).toBe(0);
    const second = ctx.store.createToken("second analyst", "analyst").token;
    const a = await post(ctx, `/findings/${f.id}/disposition`, { lifecycle: "acknowledged", disposition: "true_positive", expected_state_version: 0 });
    expect(a.statusCode).toBe(200);
    expect(a.json().finding.state_version).toBe(1);
    const b = await post(ctx, `/findings/${f.id}/disposition`, { lifecycle: "closed", disposition: "benign", expected_state_version: 0 }, second);
    expect(b.statusCode).toBe(409);
    expect(b.json()).toMatchObject({ current: { lifecycle: "acknowledged", disposition: "true_positive", state_version: 1 } });
    expect(b.json().changes_since).toHaveLength(1);
    expect(b.json().changes_since[0]).toMatchObject({ version: 1, before: { lifecycle: "open", disposition: "unreviewed" }, after: { lifecycle: "acknowledged", disposition: "true_positive" } });
    // the first writer's result stands
    expect((await get(ctx, `/findings/${f.id}`)).json().finding).toMatchObject({ lifecycle: "acknowledged", disposition: "true_positive", state_version: 1 });
  });
  it("a state change without a precondition is refused (428); a note alone is accepted and never overwrites", async () => {
    const ctx = await setup();
    const f = (await get(ctx, "/findings")).json()[0];
    const r = await post(ctx, `/findings/${f.id}/disposition`, { disposition: "benign" });
    expect(r.statusCode).toBe(428);
    expect(r.json().current.state_version).toBe(0);
    const n = await post(ctx, `/findings/${f.id}/disposition`, { note: "context only" });
    expect(n.statusCode).toBe(200);
    expect(n.json().finding.state_version).toBe(0);
    expect((await post(ctx, `/findings/${f.id}/disposition`, { disposition: "benign", expected_state_version: "0" })).statusCode).toBe(400);
  });
  it("records actor, before and after for each change", async () => {
    const ctx = await setup();
    const f = (await get(ctx, "/findings")).json()[0];
    await post(ctx, `/findings/${f.id}/disposition`, { lifecycle: "acknowledged", expected_state_version: 0 });
    await post(ctx, `/findings/${f.id}/disposition`, { disposition: "expected_test", expected_state_version: 1, note: "lab traffic" });
    const d = (await get(ctx, `/findings/${f.id}`)).json();
    expect(d.state_changes.map((c: { version: number }) => c.version)).toEqual([1, 2]);
    expect(d.state_changes[1]).toMatchObject({ actor: expect.stringContaining("analyst"), before: { lifecycle: "acknowledged", disposition: "unreviewed" }, after: { lifecycle: "acknowledged", disposition: "expected_test" }, reason: "lab traffic" });
  });
});

describe("R01.4 historical annotations are explicit", () => {
  it("current annotations are labelled current; as_of retrieves notes and state as recorded then", async () => {
    const clock = { t: Date.parse("2026-10-21T12:00:00Z") };
    const ctx = await setup({ store: { now: () => new Date(clock.t) } });
    const f = (await get(ctx, "/findings")).json()[0];
    await post(ctx, `/findings/${f.id}/disposition`, { note: "first look", lifecycle: "acknowledged", expected_state_version: 0 });
    clock.t += 3600_000;
    await post(ctx, `/findings/${f.id}/disposition`, { note: "closing", lifecycle: "closed", disposition: "benign", expected_state_version: 1 });
    const cur = (await get(ctx, `/findings/${f.id}`)).json();
    expect(cur.annotations.basis).toBe("current");
    expect(cur.notes).toHaveLength(2);
    const then = (await get(ctx, `/findings/${f.id}?as_of=${encodeURIComponent("2026-10-21T12:30:00Z")}`)).json();
    expect(then.annotations).toMatchObject({ basis: "as_of", lifecycle: "acknowledged", disposition: "unreviewed", excluded_later_notes: 1 });
    expect(then.notes.map((n: { note: string }) => n.note)).toEqual(["first look"]);
    const before = (await get(ctx, `/findings/${f.id}?as_of=${encodeURIComponent("2026-10-21T11:00:00Z")}`)).json();
    expect(before.annotations).toMatchObject({ lifecycle: "open", disposition: "unreviewed" });
    expect((await get(ctx, `/findings/${f.id}?as_of=yesterday`)).statusCode).toBe(400);
  });
});

describe("R01.4 containment approvals bind the reviewed policy and evidence", () => {
  const propose = async (ctx: Ctx) => {
    const findings = (await get(ctx, "/findings")).json() as { id: string; affected_asset_ids: string[] }[];
    const catalog = (await get(ctx, "/containment")).json().catalog as { id: string; applies_to_kinds: string[] }[];
    const graph = ctx.store.getGraph("demo-castle")!;
    for (const f of findings) for (const a of catalog) {
      if (!a.applies_to_kinds.some((k) => f.affected_asset_ids.some((id) => graph.assets.find((x) => x.id === id)?.kind === k))) continue;
      const r = await post(ctx, "/containment", { finding_id: f.id, action_id: a.id, rationale: "test" });
      if (r.statusCode === 200) return r.json();
    }
    throw new Error("no applicable action");
  };
  it("an expired proposal requires renewed review; rejection is still possible", async () => {
    const clock = { t: Date.parse("2026-10-21T12:00:00Z") };
    const ctx = await setup({ store: { now: () => new Date(clock.t), containmentTtlHours: 1 } });
    const c = await propose(ctx);
    expect(c).toMatchObject({ status: "pending", approvable: true });
    clock.t += 2 * 3600_000;
    const listed = (await get(ctx, "/containment")).json().requests.find((x: { id: string }) => x.id === c.id);
    expect(listed).toMatchObject({ approvable: false, renewal_reason: expect.stringMatching(/expired/) });
    const r = await post(ctx, `/containment/${c.id}/decision`, { decision: "approved" }, ctx.admin);
    expect(r.statusCode).toBe(409);
    expect(r.json().renewal_required).toBe(true);
    expect((await post(ctx, `/containment/${c.id}/decision`, { decision: "rejected" }, ctx.admin)).statusCode).toBe(200);
  });
  it("a changed policy snapshot requires renewed review", async () => {
    const ctx = await setup();
    const c = await propose(ctx);
    ctx.db.prepare("UPDATE projects SET meta = json_set(meta, '$.containment_action_ids', json('[]')) WHERE id = 'demo-castle'").run();
    const r = await post(ctx, `/containment/${c.id}/decision`, { decision: "approved" }, ctx.admin);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/policy changed/);
  });
  it("a proposal made before policy snapshots cannot be approved as-is", async () => {
    const ctx = await setup();
    const c = await propose(ctx);
    ctx.db.prepare("UPDATE containment_requests SET policy_digest = NULL, expires_at = NULL WHERE id = ?").run(c.id);
    const r = await post(ctx, `/containment/${c.id}/decision`, { decision: "approved" }, ctx.admin);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/predates policy snapshots/);
  });
  it("a fresh, unchanged proposal is approvable by a different human", async () => {
    const ctx = await setup();
    const c = await propose(ctx);
    expect((await post(ctx, `/containment/${c.id}/decision`, { decision: "approved" }, ctx.admin)).statusCode).toBe(200);
  });
});

describe("R01.4 source configuration preconditions", () => {
  it("re-registering an existing source needs the current revision; history records every change without keys", async () => {
    const ctx = await setup();
    const body = { id: "src-edge", label: "Edge WAF", kind: "waf", asset_ids: ["edge"], trusts_request_ids: true, stale_after_seconds: 600 };
    expect((await post(ctx, "/sources", body, ctx.admin)).statusCode).toBe(428);
    const ok = await post(ctx, "/sources", { ...body, expected_revision: 1 }, ctx.admin);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().config_revision).toBe(2);
    const stale = await post(ctx, "/sources", { ...body, expected_revision: 1 }, ctx.admin);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current.config_revision).toBe(2);
    const hist = (await get(ctx, "/sources/src-edge/history")).json();
    expect(hist.revisions.map((r: { revision: number }) => r.revision)).toEqual([1, 2]);
    expect(JSON.stringify(hist)).not.toMatch(/dks_|key_hash/);
  });
  it("enable/disable is a precondition-checked transition with an effective time", async () => {
    const clock = { t: Date.parse("2026-10-21T12:00:00Z") };
    const ctx = await setup({ store: { now: () => new Date(clock.t) } });
    const off = await post(ctx, "/sources/src-db-audit/state", { disabled: true, expected_revision: 1, reason: "maintenance", effective_at: "2026-10-21T11:00:00Z" }, ctx.admin);
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ disabled: true, config_revision: 2, effective_at: "2026-10-21T11:00:00.000Z" });
    expect((await post(ctx, "/sources/src-db-audit/state", { disabled: false, expected_revision: 1, reason: "x" }, ctx.admin)).statusCode).toBe(409);
    expect((await post(ctx, "/sources/src-db-audit/state", { disabled: false, reason: "x" }, ctx.admin)).statusCode).toBe(428);
    expect((await post(ctx, "/sources/src-db-audit/state", { disabled: false, expected_revision: 2, reason: "x", effective_at: "2026-10-22T12:00:00Z" }, ctx.admin)).statusCode).toBe(400);
    expect((await post(ctx, "/sources/src-db-audit/state", { disabled: false, expected_revision: 2, reason: "x" }, ctx.analyst)).statusCode).toBe(403);
  });
});

describe("R01.4 scene layout precondition (optional If-Match)", () => {
  it("a stale If-Match is refused; omitting it keeps the existing behaviour", async () => {
    const ctx = await setup();
    const scene = (await get(ctx, "/scene")).json();
    const proposal = ctx.db.prepare("SELECT proposal FROM scenes WHERE project_id = 'demo-castle' AND graph_revision = ?").get(scene.graph_revision) as { proposal: string };
    const body = JSON.parse(proposal.proposal);
    expect((await post(ctx, "/scene", body, ctx.analyst, { "if-match": `"${scene.digest}"` })).statusCode).toBe(200);
    expect((await post(ctx, "/scene", body, ctx.analyst, { "if-match": '"not-the-digest"' })).statusCode).toBe(409);
    expect((await post(ctx, "/scene", body)).statusCode).toBe(200);
  });
});
