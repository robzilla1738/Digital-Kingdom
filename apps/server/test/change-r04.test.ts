import { describe, expect, it } from "vitest";
import type { Graph } from "@dk/contracts";
import type { AuthSnapshot } from "../src/access/aws-policy.ts";
import type { ChangePlanInput } from "../src/change-review.ts";
import { setup, liveGraph } from "./helpers.ts";

/** R04.4 security change diff. */
const A = "111122223333";
const snap = (extra = false): AuthSnapshot => ({ snapshot_id: extra ? "cand" : "base", taken_at: "2026-10-22T00:00:00Z", organization: null, resources: [{ arn: "arn:aws:s3:::exports", account: A, policy: null }],
  principals: [{ arn: `arn:aws:iam::${A}:role/api`, account: A, type: "role", policies: [{ id: "p", Statement: [{ Effect: "Allow", Action: "s3:GetObject", Resource: "arn:aws:s3:::exports/reports/*" }, ...(extra ? [{ Effect: "Allow" as const, Action: "s3:*", Resource: "*" }] : [])] }] }] });
const g = liveGraph() as unknown as Graph;
const plan = (over: Partial<ChangePlanInput["candidate"]> = {}): ChangePlanInput => ({
  base: { commit: "aaa1", graph: g, snapshot: snap(), sources: [{ id: "app", asset_ids: ["api"] }, { id: "dba", asset_ids: ["db"] }], artifacts: { api: `sha256:${"1".repeat(64)}` } },
  candidate: { commit: "bbb2", graph: g, snapshot: snap(), sources: [{ id: "app", asset_ids: ["api"] }, { id: "dba", asset_ids: ["db"] }], artifacts: { api: `sha256:${"2".repeat(64)}` }, ...over },
  probes: [{ principal: `arn:aws:iam::${A}:role/api`, action: "s3:GetObject", resource: "arn:aws:s3:::exports/customers.csv" }],
});
const review = async (ctx: Awaited<ReturnType<typeof setup>>, p: ChangePlanInput) => (await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/changes/review", headers: ctx.h(ctx.viewer), payload: p })).json();

describe("R04.4 change review", () => {
  it("a new broad permission is surfaced although no finding exists", async () => {
    const ctx = await setup();
    const r = await review(ctx, plan({ snapshot: snap(true) }));
    expect(r.posture).toBe("review_required");
    expect(r.changes.map((c: { kind: string; detail: string }) => c.detail).join(" ")).toMatch(/blocked -> feasible.*new wildcard allow/);
    expect(r.suggested_tests.length).toBeGreaterThan(0);
  });
  it("unknown scope cannot be favourable; lost telemetry and new ingress are surfaced", async () => {
    const ctx = await setup();
    const r = await review(ctx, plan({ snapshot: null }));
    expect(r.posture).toBe("review_required");
    expect(r.unknowns.join(" ")).toMatch(/authority is unknown/);
    const g2 = { ...g, assets: [...g.assets, { id: "admin", name: "admin-panel", kind: "service", environment: "prod", allowed_zone_ids: ["application"], source_refs: ["m"] }], relationships: [...g.relationships, { id: "r9", source_id: "edge", target_id: "admin", kind: "calls", evidence_level: "declared", evidence_refs: ["m"] }] } as Graph;
    const r2 = await review(ctx, plan({ graph: g2, sources: [{ id: "app", asset_ids: ["api"] }] }));
    expect(r2.changes.map((c: { kind: string }) => c.kind)).toEqual(expect.arrayContaining(["new_ingress", "lost_telemetry"]));
    const same = await review(ctx, { ...plan(), candidate: { ...plan().base, commit: "aaa1" } });
    expect(same.posture).toBe("no_material_change_found");
    expect(same.note).toMatch(/not a statement that the change is safe/);
  });
  it("changing the candidate after review invalidates the old assessment; authors cannot self-accept", async () => {
    const ctx = await setup();
    const r = (await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/changes/review", headers: ctx.h(ctx.analyst), payload: plan() })).json();
    const changed = await review(ctx, plan({ artifacts: { api: `sha256:${"3".repeat(64)}` } }));
    expect(changed.candidate_digest).not.toBe(r.candidate_digest);
    const stale = await ctx.app.inject({ method: "POST", url: `/api/projects/demo-castle/changes/${r.id}/owner-review`, headers: ctx.h(ctx.admin), payload: { decision: "accepted", candidate_digest: changed.candidate_digest } });
    expect(stale.statusCode).toBe(409);
    expect((await ctx.app.inject({ method: "POST", url: `/api/projects/demo-castle/changes/${r.id}/owner-review`, headers: ctx.h(ctx.analyst), payload: { decision: "accepted", candidate_digest: r.candidate_digest } })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: "POST", url: `/api/projects/demo-castle/changes/${r.id}/owner-review`, headers: ctx.h(ctx.admin), payload: { decision: "accepted", candidate_digest: r.candidate_digest } })).json().owner_decision).toBe("accepted");
  });
  it("post-deploy observed state must match the reviewed change", async () => {
    const ctx = await setup();
    const r = await review(ctx, plan());
    const post = (b: unknown) => ctx.app.inject({ method: "POST", url: `/api/projects/demo-castle/changes/${r.id}/post-deploy`, headers: ctx.h(ctx.analyst), payload: b as object });
    expect((await post({ commit: "bbb2", artifacts: { api: `sha256:${"2".repeat(64)}` } })).json()).toMatchObject({ matches_review: true, drift: [] });
    const bad = (await post({ commit: "bbb2", artifacts: { api: `sha256:${"9".repeat(64)}` } })).json();
    expect(bad.matches_review).toBe(false);
    expect(bad.drift[0]).toMatch(/api runs sha256:9999.*reviewed sha256:2222/);
  });
});
