import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** R03.4 deception registry, placements and triggers. */
async function env() {
  const ctx = await setup();
  const post = (url: string, payload: unknown, t = ctx.admin) => ctx.app.inject({ method: "POST", url: `/api/projects/demo-castle${url}`, headers: ctx.h(t), payload: payload as object });
  const decoy = (await post("/decoys", { kind: "aws_access_key", label: "deploy key in old CI config" })).json();
  const orig = (await post(`/decoys/${decoy.id}/placements`, { location: "repo ops-tools/.env.example" })).json();
  const fork = (await post(`/decoys/${decoy.id}/placements`, { location: "public fork mirror", parent_placement_id: orig.placement_id })).json();
  const report = async () => (await ctx.app.inject({ url: `/api/projects/demo-castle/decoys/${decoy.id}`, headers: ctx.h(ctx.viewer) })).json();
  return { ctx, post, decoy, orig, fork, report };
}

describe("R03.4 deception", () => {
  it("a trigger maps to its registered placement path, not to the original compromise or a person", async () => {
    const t = await env();
    const r = await t.ctx.app.inject({ url: `/ingest/decoy/${t.fork.placement_id}`, headers: { "user-agent": "curl/8" }, remoteAddress: "198.51.100.7" });
    expect(r.statusCode).toBe(204);
    const a = (await t.report()).activations[0];
    expect(a).toMatchObject({ trigger: "request", placement_path: ["repo ops-tools/.env.example", "public fork mirror"], network_locator: { value: "198.51.100.7", identity: false } });
    expect(a.not_established.join(" ")).toMatch(/not a person.*original compromise/);
    // unknown ids get the same answer and record nothing
    expect((await t.ctx.app.inject({ url: "/ingest/decoy/plc_AAAAAAAAAAAAAAAA" })).statusCode).toBe(204);
    expect((await t.report()).activations).toHaveLength(1);
  });

  it("a DNS resolver or proxy address is never treated as attacker identity", async () => {
    const t = await env();
    const ct = (await t.ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/sources", headers: t.ctx.h(t.ctx.admin), payload: { id: "canary", label: "Canarytokens", kind: "honeytoken", asset_ids: [t.ctx.store.getGraph("demo-castle")!.assets[0]!.id] } })).json().key;
    await t.ctx.app.inject({ method: "POST", url: "/ingest/canarytokens", headers: { authorization: `Bearer ${ct}` }, payload: { memo: `decoy ${t.orig.placement_id}`, channel: "DNS", src_ip: "8.8.8.8", time: "2026-10-21 10:00:00 UTC" } });
    await t.ctx.app.inject({ url: `/ingest/decoy/${t.orig.placement_id}`, headers: { "x-forwarded-for": "203.0.113.50" }, remoteAddress: "10.0.0.2" });
    const acts = (await t.report()).activations;
    expect(acts.find((a: { trigger: string }) => a.trigger === "dns_lookup").network_locator).toEqual({ value: "8.8.8.8", kind: "dns_resolver", identity: false });
    expect(acts.find((a: { via: string }) => a.via === "local-receiver").network_locator).toMatchObject({ kind: "proxy", identity: false });
  });

  it("authorized scanner or test activations are retained and annotated, not deleted", async () => {
    const t = await env();
    const now = Date.now();
    await t.post("/decoy-test-windows", { decoy_id: t.decoy.id, starts_at: new Date(now - 60_000).toISOString(), ends_at: new Date(now + 3600_000).toISOString(), purpose: "quarterly canary check" });
    await t.ctx.app.inject({ url: `/ingest/decoy/${t.orig.placement_id}`, headers: { "user-agent": "trufflehog/3.80 verifier" } });
    await t.ctx.app.inject({ url: `/ingest/decoy/${t.orig.placement_id}?t=doc`, headers: { "user-agent": "Mozilla/5.0" } });
    const acts = (await t.report()).activations;
    expect(acts.map((a: { trigger: string }) => a.trigger)).toEqual(["scanner_validation", "document_fetch"]);
    for (const a of acts) expect(a.authorized_test).toMatchObject({ note: expect.stringMatching(/retained, not deleted/) });
  });

  it("no decoy can be a working credential; values are shown once and stored as fingerprints", async () => {
    const t = await env();
    expect(t.decoy.value).toMatch(/^AKIA[A-Z0-9]{16}$/);
    expect(JSON.stringify(t.ctx.store.db.prepare("SELECT * FROM decoys").all())).not.toContain(t.decoy.value);
    await t.ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/access/snapshot", headers: t.ctx.h(t.ctx.admin), payload: { snapshot_id: "s1", taken_at: "2026-10-21T00:00:00Z", organization: null, resources: [], principals: [{ arn: "arn:aws:iam::111122223333:user/ci", account: "111122223333", type: "user", policies: [], access_keys: [{ id: "AKIAREALKEY000000001", status: "Active" }] }] } });
    expect((await t.post("/decoys", { kind: "aws_access_key", value: "AKIAREALKEY000000001" })).statusCode).toBe(422);
    expect((await t.post("/decoys", { kind: "document", value: "-----BEGIN RSA PRIVATE KEY-----" })).statusCode).toBe(422);
    await t.post(`/decoys/${t.decoy.id}/retire`, { reason: "rotated canary set" });
    expect((await t.report()).decoy.retired_at).toBeTruthy();
    expect((await t.post(`/decoys/${t.decoy.id}/placements`, { location: "x" })).statusCode).toBe(409);
  });
});
