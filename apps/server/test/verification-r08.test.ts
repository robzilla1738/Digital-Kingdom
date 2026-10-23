import { describe, expect, it } from "vitest";
import type { SecurityEvent } from "@dk/contracts";
import { verifyContainment, type VerifyInput } from "../src/verification.ts";
import { setup } from "./helpers.ts";

/** R08.4 independent containment and service-recovery verification. */
const T = (m: number) => new Date(Date.parse("2026-10-23T12:00:00Z") + m * 60_000).toISOString();
let n = 0;
const ev = (m: number, o: Partial<SecurityEvent>): SecurityEvent => ({ schema_version: "0.2", dataset_kind: "synthetic", id: `e${++n}`, project_id: "p", source_id: "waf", source_event_id: `s${n}`, received_at: T(m), occurred_at: T(m), asset_ids: ["api"], action: "authentication", outcome: "success", evidence_refs: [], ...o } as SecurityEvent);
const attack = [ev(-30, { actor_ref: "u-attacker", outcome: "failure" }), ev(-29, { actor_ref: "u-attacker", outcome: "success" })];
const base = (over: Partial<VerifyInput> = {}): VerifyInput => ({
  plan: { action_id: "auth.force_reauth", targets: [{ asset_id: "api", provider_id: null }], blast_radius: { declared: "sessions on api", downstream_asset_ids: ["db"] }, verification: { effect_observer_source_ids: ["observer"], verified_success_possible: true, reason: "" } },
  finding: { affected_asset_ids: ["api"], events: attack },
  events: [...attack, ev(-20, { actor_ref: "u-legit", source_id: "observer" }), ev(-10, { actor_ref: "u-legit2", source_id: "observer" })],
  sources: [{ id: "observer", asset_ids: ["api"] }, { id: "waf", asset_ids: ["api"] }],
  report: { provider_accepted: true, accepted_at: T(0), provider_ref: "op-1" }, now: new Date(T(30)), propagation_seconds: 300, ...over,
});

describe("R08.4 containment verification", () => {
  it("provider accepts a no-op yet the observer still sees the access: failed, case unresolved", () => {
    const r = verifyContainment(base({ events: [...base().events, ev(12, { actor_ref: "u-attacker", source_id: "observer" }), ev(13, { actor_ref: "u-legit", source_id: "observer" })] }));
    expect(r.containment.state).toBe("failed");
    expect(r.containment.reasons[0]).toMatch(/provider acceptance notwithstanding/);
    expect(r.case_effect).toBe("the case remains unresolved");
    expect(r.service_restoration.state).toBe("service_observed");
    expect(r.historical_exposure.state).toBe("not_assessed");
  });
  it("original credential disabled but descendant access survives: failed", () => {
    const r = verifyContainment(base({ events: [...base().events, ev(12, { actor_ref: "u-legit", source_id: "observer" })], residual_authority: { status: "unresolved", residual: [{ kind: "access_key", id: "AKIADESCENDANT000001", surviving_permission: "s3:GetObject on exports" }] } }));
    expect(r.containment.state).toBe("failed");
    expect(r.containment.reasons.join(" ")).toMatch(/AKIADESCENDANT000001.*s3:GetObject/);
  });
  it("legitimate service disruption is detected while the observer keeps reporting", () => {
    const r = verifyContainment(base({ events: [...base().events, ev(15, { actor_ref: "u-legit", source_id: "observer", outcome: "denied" })] }));
    expect(r.containment.state).toBe("verified");
    expect(r.service_restoration.state).toBe("disruption_detected");
  });
  it("every claim names its tested scope and unassessed paths; silence and missing observers are inconclusive; pending inside the window", () => {
    const ok = verifyContainment(base({ events: [...base().events, ev(12, { actor_ref: "u-legit", source_id: "observer" })] }));
    expect(ok.containment.state).toBe("verified");
    expect(ok.case_effect).toMatch(/tested scope only/);
    expect(ok.tested_scope).toMatchObject({ target_asset_ids: ["api"], observer_source_ids: ["observer"], identities_checked: 1, window: { from: T(5) } });
    expect(ok.unassessed.join(" ")).toMatch(/downstream asset db has no independent observer/);
    expect(verifyContainment(base()).containment.state).toBe("inconclusive"); // observer silent since the change
    expect(verifyContainment(base({ plan: { ...base().plan, verification: { effect_observer_source_ids: [], verified_success_possible: false, reason: "" } } })).containment.state).toBe("inconclusive");
    expect(verifyContainment(base({ now: new Date(T(2)) })).containment.state).toBe("pending");
    expect(verifyContainment(base({ report: { provider_accepted: false, accepted_at: T(0) } })).containment.state).toBe("failed");
    const comp = verifyContainment(base({ residual_authority: { status: "unresolved", residual: [{ kind: "session", id: "s", surviving_permission: null }] }, compensation: { applied: true, note: "replacement key issued, old sessions revoked" } }));
    expect(comp.containment.state).toBe("compensated");
  });
  it("the API verifies only approved requests with plans and keeps every verification", async () => {
    const ctx = await setup();
    const post = (url: string, payload: unknown, t = ctx.analyst) => ctx.app.inject({ method: "POST", url: `/api/projects/demo-castle${url}`, headers: ctx.h(t), payload: payload as object });
    const graph = ctx.store.getGraph("demo-castle")!;
    let c: { id: string } | null = null, target = "", action = "";
    for (const f of ctx.store.listFindings("demo-castle")) { for (const a of ctx.store.containmentCatalog("demo-castle").filter((x) => x.id === "auth.force_reauth" || x.id === "edge.tighten_rate_limit")) { const t = f.affected_asset_ids.find((id) => a.applies_to_kinds.includes(graph.assets.find((x) => x.id === id)!.kind)); if (!t) continue; const r = await post("/containment", { finding_id: f.id, action_id: a.id, rationale: "verify test rationale" }); if (r.statusCode === 200) { c = r.json(); target = t; action = a.id; break; } } if (c) break; }
    expect(c).toBeTruthy();
    const report = { provider_accepted: true, accepted_at: new Date(ctx.store.now().getTime() - 3600_000).toISOString() };
    expect((await post(`/containment/${c!.id}/verify`, { report })).statusCode).toBe(409); // not approved
    const params = action === "auth.force_reauth" ? { account_ref: "acct-1" } : { route: "/login", requests_per_minute: 30 };
    expect((await post(`/containment/${c!.id}/plan`, { targets: [target], parameters: params })).statusCode).toBe(200);
    const d = await post(`/containment/${c!.id}/decision`, { decision: "approved" }, ctx.admin);
    expect(d.json().status, d.body).toBe("approved");
    const v = (await post(`/containment/${c!.id}/verify`, { report })).json();
    expect(["verified", "failed", "inconclusive"]).toContain(v.containment.state);
    expect(v.tested_scope.target_asset_ids).toEqual([target]);
    const list = (await ctx.app.inject({ url: `/api/projects/demo-castle/containment/${c!.id}/verifications`, headers: ctx.h(ctx.viewer) })).json();
    expect(list.verifications).toHaveLength(1);
  });
});
