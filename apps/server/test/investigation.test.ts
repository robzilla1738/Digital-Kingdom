import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setup } from "./helpers.ts";
import type { StoreOptions } from "../src/store.ts";

/**
 * Event-level investigation (dk.event_search.v1 / dk.event_detail.v1). Cases s2 and s6 are the frozen v1
 * evaluation fixtures (eval/scenarios/v1), loaded exactly as the evaluation harness loads them.
 */
type Ctx = Awaited<ReturnType<typeof setup>>;
interface Spec { project_id: string; project_name: string; manifest: string; task: string; sources: { id: string; asset_ids: string[] }[]; events: { source: string; body: Record<string, any> }[] }
const SCEN = join(import.meta.dirname, "../../../eval/scenarios/v1");
const spec = (name: string) => JSON.parse(readFileSync(join(SCEN, `${name}.json`), "utf8")) as Spec;

async function loadCase(ctx: Ctx, s: Spec) {
  const { app, admin, h } = ctx;
  expect((await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: s.project_id, name: s.project_name, dataset_kind: "live" } })).statusCode).toBe(200);
  expect((await app.inject({ method: "POST", url: `/api/projects/${s.project_id}/graph?format=manifest&revision=r1`, headers: { ...h(admin), "content-type": "application/yaml" }, payload: s.manifest })).statusCode).toBe(200);
  for (const src of s.sources) {
    const key = (await app.inject({ method: "POST", url: `/api/projects/${s.project_id}/sources`, headers: h(admin), payload: src })).json().key as string;
    const evs = s.events.filter((e) => e.source === src.id).map((e) => e.body);
    if (evs.length) expect((await app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${key}` }, payload: { events: evs } })).statusCode).toBeLessThan(300);
  }
  while (ctx.store.processBatch().processed) { /* drain */ }
}
const interval = (s: Spec) => {
  const t = s.events.map((e) => Date.parse(e.body.occurred_at));
  return { after: new Date(Math.min(...t) - 3_600_000).toISOString(), before: new Date(Math.max(...t) + 3_600_000).toISOString() };
};
const search = async (ctx: Ctx, project: string, q: Record<string, string>, token = ctx.admin) =>
  ctx.app.inject({ method: "GET", url: `/api/projects/${project}/events/search?${new URLSearchParams(q)}`, headers: ctx.h(token) });

describe("case 2: follow-on data read is discoverable without a finding", () => {
  for (const v of ["a", "b"]) it(`variant ${v}`, async () => {
    const ctx = await setup(); const s = spec(`s2-failures-then-success-${v}`);
    await loadCase(ctx, s);
    const read = s.events.find((e) => e.body.action === "data_access")!.body;
    const actor = read.actor_ref as string;
    expect(s.task).toContain(actor);
    const viewer = ctx.store.createToken("agent", "viewer", [s.project_id], undefined, "service").token;
    const r = await search(ctx, s.project_id, { ...interval(s), actor_ref: actor }, viewer);
    expect(r.statusCode).toBe(200);
    const body = r.json();
    const found = body.events.find((e: any) => e.action === "data_access");
    expect(found).toMatchObject({ actor_ref: actor, source_event_id: read.source_event_id, asset_ids: read.asset_ids });
    // It is genuinely unlinked: no finding references it, which is why v1 MCP mode could not reach it.
    const referenced = ctx.store.listFindings(s.project_id).flatMap((f) => [...f.event_ids, ...f.counterevidence_event_ids]);
    expect(referenced).not.toContain(found.id);
    expect(body.query_completeness).toMatchObject({ complete: true, truncated: false, matching_in_snapshot: body.events.length });
    expect(body.correlation.find((c: any) => c.filter === "actor_ref").trust).toMatch(/per source|lead, not proof/i);
    // detail view is reachable for an unlinked event and says so
    const d = (await ctx.app.inject({ method: "GET", url: `/api/projects/${s.project_id}/events/${encodeURIComponent(found.id)}`, headers: ctx.h(viewer) })).json();
    expect(d.event.id).toBe(found.id);
    expect(d.referenced_by_findings).toEqual([]);
    expect(d.evidence.untrusted).toBe(true);
  });
});

describe("case 6: same-address sign-in is discoverable but never attributed", () => {
  for (const v of ["a", "b"]) it(`variant ${v}`, async () => {
    const ctx = await setup(); const s = spec(`s6-honeytoken-${v}`);
    await loadCase(ctx, s);
    const decoy = s.events.filter((e) => e.body.action === "decoy_used").map((e) => e.body);
    const signin = s.events.find((e) => e.body.action === "authentication")!.body;
    const ip = decoy[0]!.client_ip as string;
    expect(signin.client_ip).toBe(ip);
    const r = (await search(ctx, s.project_id, { ...interval(s), client_ip: ip })).json();
    expect(r.events.map((e: any) => e.source_event_id).sort()).toEqual([...decoy.map((d) => d.source_event_id), signin.source_event_id].sort());
    // Decoy events carry no identity, and nothing in the response joins them to the signed-in account.
    for (const e of r.events.filter((x: any) => x.action === "decoy_used")) expect(e.actor_ref).toBeUndefined();
    const ipNote = r.correlation.find((c: any) => c.filter === "client_ip");
    expect(ipNote.namespace).toMatch(/not identity/);
    expect(ipNote.trust).toMatch(/NOT attributed/);
    const decoyFinding = ctx.store.listFindings(s.project_id).find((f) => f.kind === "decoy_credential_used")!;
    expect(JSON.stringify(decoyFinding)).not.toContain(signin.actor_ref);
    const signinEv = r.events.find((e: any) => e.action === "authentication");
    const d = (await ctx.app.inject({ method: "GET", url: `/api/projects/${s.project_id}/events/${encodeURIComponent(signinEv.id)}`, headers: ctx.h(ctx.admin) })).json();
    expect(d.referenced_by_findings.map((f: any) => f.id)).not.toContain(decoyFinding.id);
    expect(d.correlation.find((c: any) => c.field === "client_ip").trust).toMatch(/must not be treated as the same person/);
  });
});

// ---------------------------------------------------------------- synthetic project helpers
async function bulkProject(ctx: Ctx, id: string, n: number, opts: { evidence?: boolean } = {}) {
  const { app, admin, h } = ctx;
  await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id, name: id, dataset_kind: "live" } });
  await app.inject({ method: "POST", url: `/api/projects/${id}/graph?format=manifest&revision=r1`, headers: { ...h(admin), "content-type": "application/yaml" }, payload: "assets:\n  - {id: auth, kind: auth}\n  - {id: db, kind: database}\n  - {id: dark, kind: worker}\n" });
  const key = (await app.inject({ method: "POST", url: `/api/projects/${id}/sources`, headers: h(admin), payload: { id: "signin", label: "sign-in log", kind: "app_security", asset_ids: ["auth"] } })).json().key as string;
  const ingest = async (events: Record<string, unknown>[]) => {
    for (let i = 0; i < events.length; i += 100) expect((await app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${key}` }, payload: { events: events.slice(i, i + 100) } })).statusCode).toBeLessThan(300);
    while (ctx.store.processBatch().processed) { /* drain */ }
  };
  // Many events share an identical timestamp so ordering must fall back to the id tiebreaker.
  const base = Date.parse("2026-10-20T12:00:00Z");
  await ingest(Array.from({ length: n }, (_, i) => ({
    source_event_id: `${id}-e${i}`, occurred_at: new Date(base + Math.floor(i / 7) * 60_000).toISOString(), asset_ids: ["auth"], action: "authentication",
    outcome: i % 3 ? "success" : "failure", actor_ref: i % 2 ? "u-even" : "u-odd", client_ip: "192.0.2.10",
    ...(opts.evidence ? { evidence: { note: `record ${i}` } } : {}),
  })));
  return { ingest, base };
}
const window = { after: "2026-10-20T00:00:00Z", before: "2026-10-21T00:00:00Z" };

describe("pagination", () => {
  it("returns every match exactly once across pages, including ties on occurred_at", async () => {
    const ctx = await setup();
    await bulkProject(ctx, "pg", 257);
    const expected = (ctx.db.prepare("SELECT id FROM events WHERE project_id = 'pg' AND json_extract(body,'$.actor_ref') = 'u-even' ORDER BY id").all() as { id: string }[]).map((r) => r.id);
    const seen: string[] = []; let cursor: string | undefined; let pages = 0; let last: any;
    do {
      const r = await search(ctx, "pg", { ...window, actor_ref: "u-even", limit: "10", ...(cursor ? { cursor } : {}) });
      expect(r.statusCode).toBe(200);
      last = r.json(); pages++;
      expect(last.query_completeness.matching_in_snapshot).toBe(expected.length);
      if (last.page.has_more) expect(last.query_completeness).toMatchObject({ complete: false, truncated: true });
      seen.push(...last.events.map((e: any) => e.id));
      cursor = last.page.next_cursor ?? undefined;
    } while (cursor);
    expect(pages).toBe(Math.ceil(expected.length / 10));
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual(expected);
    expect(last.query_completeness).toMatchObject({ complete: true, truncated: false, returned_through_this_page: expected.length });
  });
  it("is pinned to a snapshot: events arriving mid-pagination cause no duplicate or silent gap and are reported", async () => {
    const ctx = await setup();
    const { ingest, base } = await bulkProject(ctx, "pin", 60);
    const first = (await search(ctx, "pin", { ...window, limit: "25" })).json();
    expect(first.query_completeness.matching_in_snapshot).toBe(60);
    // late arrivals with timestamps both before and after the cursor position
    await ingest([0, 1, 2].map((i) => ({ source_event_id: `late-${i}`, occurred_at: new Date(base + (i - 1) * 30_000).toISOString(), asset_ids: ["auth"], action: "authentication", outcome: "success", actor_ref: "u-late" })));
    const ids = first.events.map((e: any) => e.id);
    let cursor = first.page.next_cursor; let last: any;
    while (cursor) { last = (await search(ctx, "pin", { ...window, limit: "25", cursor })).json(); ids.push(...last.events.map((e: any) => e.id)); cursor = last.page.next_cursor; }
    expect(ids.length).toBe(60);
    expect(new Set(ids).size).toBe(60);
    expect(last.query_completeness).toMatchObject({ complete: true, later_arrivals_not_included: 3 });
    expect(last.query_completeness.note).toMatch(/new search/);
    const fresh = (await search(ctx, "pin", { ...window, limit: "100" })).json();
    expect(fresh.query_completeness.matching_in_snapshot).toBe(63);
  });
  it("a cursor is bound to its filters and cannot be forged", async () => {
    const ctx = await setup();
    await bulkProject(ctx, "bind", 30);
    const c = (await search(ctx, "bind", { ...window, actor_ref: "u-odd", limit: "5" })).json().page.next_cursor as string;
    expect((await search(ctx, "bind", { ...window, actor_ref: "u-even", limit: "5", cursor: c })).statusCode).toBe(400);
    expect((await search(ctx, "bind", { ...window, after: "2026-10-19T00:00:00Z", actor_ref: "u-odd", cursor: c })).statusCode).toBe(400);
    const [body, sig] = c.split(".");
    const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, "base64url").toString()), n: 0 })).toString("base64url");
    expect((await search(ctx, "bind", { ...window, actor_ref: "u-odd", cursor: `${tampered}.${sig}` })).statusCode).toBe(400);
    // a different page size with the same filters is allowed
    expect((await search(ctx, "bind", { ...window, actor_ref: "u-odd", limit: "7", cursor: c })).statusCode).toBe(200);
  });
});

describe("project authorization on every request and page", () => {
  it("denies other projects, including reuse of a cursor issued for another project", async () => {
    const ctx = await setup();
    await bulkProject(ctx, "alpha", 40); await bulkProject(ctx, "beta", 40);
    const alphaViewer = ctx.store.createToken("agent", "viewer", ["alpha"], undefined, "service").token;
    const page1 = (await search(ctx, "alpha", { ...window, limit: "10" }, alphaViewer)).json();
    expect(page1.events.every((e: any) => e.project_id === "alpha")).toBe(true);
    const cursor = page1.page.next_cursor as string;
    // scoped token: other project refused outright (search, cursor reuse, event detail)
    expect([403, 404]).toContain((await search(ctx, "beta", window, alphaViewer)).statusCode);
    expect([403, 404]).toContain((await search(ctx, "beta", { ...window, limit: "10", cursor }, alphaViewer)).statusCode);
    const betaEvent = (ctx.db.prepare("SELECT id FROM events WHERE project_id = 'beta' LIMIT 1").get() as { id: string }).id;
    expect([403, 404]).toContain((await ctx.app.inject({ method: "GET", url: `/api/projects/beta/events/${betaEvent}`, headers: ctx.h(alphaViewer) })).statusCode);
    // an event id from another project is not found through an authorized project either
    expect((await ctx.app.inject({ method: "GET", url: `/api/projects/alpha/events/${betaEvent}`, headers: ctx.h(alphaViewer) })).statusCode).toBe(404);
    // an installation-wide principal still cannot carry alpha's cursor into beta
    const r = await search(ctx, "beta", { ...window, limit: "10", cursor }, ctx.admin);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/different project/);
    // authorization is re-checked per page: a revoked/unknown token cannot continue with a valid cursor
    expect((await search(ctx, "alpha", { ...window, limit: "10", cursor }, "dk_not_a_token")).statusCode).toBe(401);
    // unauthenticated
    expect((await ctx.app.inject({ method: "GET", url: `/api/projects/alpha/events/search?${new URLSearchParams(window)}` })).statusCode).toBe(401);
  });
  it("is read-only: no write verb is routed", async () => {
    const ctx = await setup();
    for (const m of ["POST", "PUT", "DELETE", "PATCH"] as const) expect([404, 405]).toContain((await ctx.app.inject({ method: m, url: "/api/projects/demo-castle/events/search", headers: ctx.h(ctx.admin), payload: {} })).statusCode);
  });
});

describe("bounds and validation", () => {
  it("requires a declared, bounded interval and known filters", async () => {
    const ctx = await setup();
    const bad = async (q: Record<string, string>, re: RegExp) => { const r = await search(ctx, "demo-castle", q); expect(r.statusCode).toBe(422); expect(r.json().details.join(" ")).toMatch(re); };
    await bad({ before: window.before }, /after: required/);
    await bad({ after: "2026-01-01T00:00:00Z", before: "2026-03-01T00:00:00Z" }, /longer than 31 days/);
    await bad({ after: window.before, before: window.after }, /later than after/);
    await bad({ ...window, limit: "500" }, /limit/);
    await bad({ ...window, sql: "1=1" }, /sql: unsupported filter/);
    await bad({ ...window, action: "drop_table" }, /action: unsupported/);
    await bad({ after: "yesterday", before: window.before }, /ISO 8601/);
  });
  it("search results come from the redacted store (no secret reaches a response)", async () => {
    const ctx = await setup();
    await bulkProject(ctx, "red", 1);
    const key = (await ctx.app.inject({ method: "POST", url: "/api/projects/red/sources", headers: ctx.h(ctx.admin), payload: { id: "app2", label: "app", kind: "app_security", asset_ids: ["auth"] } })).json().key as string;
    await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${key}` }, payload: { source_event_id: "s1", occurred_at: "2026-10-20T13:00:00Z", asset_ids: ["auth"], action: "authentication", outcome: "failure", actor_ref: "u-x", route: "/login?api_key=QUERYSECRET42", attributes: { password: "ATTRSECRET42" }, evidence: { password: "EVIDSECRET42" } } });
    while (ctx.store.processBatch().processed) { /* drain */ }
    const r = await search(ctx, "red", { ...window, actor_ref: "u-x" });
    const d = await ctx.app.inject({ method: "GET", url: `/api/projects/red/events/${r.json().events[0].id}`, headers: ctx.h(ctx.admin) });
    for (const text of [r.body, d.body]) for (const m of ["QUERYSECRET42", "ATTRSECRET42", "EVIDSECRET42"]) expect(text).not.toContain(m);
  });
});

describe("missing evidence and absent coverage stay explicit", () => {
  it("a deleted evidence record is reported missing, not silently dropped", async () => {
    const ctx = await setup();
    await bulkProject(ctx, "ev", 3, { evidence: true });
    const e = (await search(ctx, "ev", window)).json().events[0];
    const ref = e.evidence_refs.find((x: string) => x.startsWith("evidence:"));
    expect(ref).toBeTruthy();
    const ok = (await ctx.app.inject({ method: "GET", url: `/api/projects/ev/events/${e.id}`, headers: ctx.h(ctx.admin) })).json();
    expect(ok.evidence_completeness).toMatchObject({ complete: true, expected_records: 1, returned_records: 1 });
    ctx.db.prepare("DELETE FROM evidence WHERE project_id = 'ev' AND ref = ?").run(ref);
    const d = (await ctx.app.inject({ method: "GET", url: `/api/projects/ev/events/${e.id}`, headers: ctx.h(ctx.admin) })).json();
    expect(d.evidence_completeness).toMatchObject({ complete: false, missing_evidence_refs: [ref], returned_records: 0 });
  });
  it("an event with no stored evidence says only the normalized event exists", async () => {
    const ctx = await setup();
    await bulkProject(ctx, "noev", 1);
    const e = (await search(ctx, "noev", window)).json().events[0];
    const d = (await ctx.app.inject({ method: "GET", url: `/api/projects/noev/events/${e.id}`, headers: ctx.h(ctx.admin) })).json();
    expect(d.evidence_completeness.note).toMatch(/no stored evidence/);
  });
  it("an empty result on an unobserved asset is complete for the query but flags absent coverage", async () => {
    const ctx = await setup();
    await bulkProject(ctx, "dark", 5);
    const r = (await search(ctx, "dark", { ...window, asset_id: "dark" })).json();
    expect(r.events).toEqual([]);
    expect(r.query_completeness.complete).toBe(true);
    expect(r.source_coverage.gaps.join(" ")).toMatch(/No configured source reports asset dark/);
    expect(r.source_coverage.unobserved_asset_ids).toContain("dark");
    expect(r.limits.join(" ")).toMatch(/does not mean the activity did not occur/);
  });
  it("a silent or stale source is reported as a coverage gap, separate from query completeness", async () => {
    const t = { now: Date.parse("2026-10-20T12:30:00Z") };
    const ctx = await setup({ store: { now: () => new Date(t.now) } as StoreOptions });
    await ctx.app.inject({ method: "POST", url: "/api/projects", headers: ctx.h(ctx.admin), payload: { id: "st", name: "st", dataset_kind: "live" } });
    await ctx.app.inject({ method: "POST", url: "/api/projects/st/graph?format=manifest&revision=r1", headers: { ...ctx.h(ctx.admin), "content-type": "application/yaml" }, payload: "assets:\n  - {id: db, kind: database}\n" });
    const key = (await ctx.app.inject({ method: "POST", url: "/api/projects/st/sources", headers: ctx.h(ctx.admin), payload: { id: "audit", label: "db audit", kind: "db_audit", asset_ids: ["db"], stale_after_seconds: 60 } })).json().key as string;
    await ctx.app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${key}` }, payload: { source_event_id: "a1", occurred_at: "2026-10-20T12:29:00Z", asset_ids: ["db"], action: "data_access", outcome: "success", actor_ref: "svc" } });
    while (ctx.store.processBatch().processed) { /* drain */ }
    t.now = Date.parse("2026-10-20T15:00:00Z");
    const r = (await search(ctx, "st", { ...window, actor_ref: "nobody" })).json();
    expect(r.events).toEqual([]);
    expect(r.query_completeness.complete).toBe(true);
    const audit = r.source_coverage.sources.find((x: any) => x.source_id === "audit");
    expect(audit.current_state).not.toBe("healthy");
    expect(r.source_coverage.gaps.join(" ")).toMatch(/audit is currently/);
  });
});
