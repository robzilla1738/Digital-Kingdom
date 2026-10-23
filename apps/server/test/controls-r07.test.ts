import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** R07.1 control inventory and verification records. */
async function env() {
  const clock = { t: Date.parse("2026-10-20T10:00:00Z") };
  const ctx = await setup({ store: { now: () => new Date(clock.t) } });
  const asset = ctx.store.getGraph("demo-castle")!.assets[0]!.id;
  const post = (url: string, payload: unknown, t = ctx.admin) => ctx.app.inject({ method: "POST", url: `/api/projects/demo-castle${url}`, headers: ctx.h(t), payload: payload as object });
  const ctl = (await post("/controls", { id: "waf-sqli", name: "Edge SQL injection rule", kind: "waf_rule", asset_ids: [asset], scope: "all public routes on the edge", policy_version: "crs-4.3", config: { rule: 942100, mode: "block" }, configured_evidence: "edge config export 2026-10-20" })).json();
  return { ctx, clock, asset, post, ctl };
}
const test = (over: Record<string, unknown> = {}) => ({ outcome: "pass", observer: "edge request log", conditions: "10 benign and 10 SQLi probes from the lab runner to /search; probes blocked, benign allowed", evidence_refs: ["ev-1"], ...over });

describe("R07.1 controls", () => {
  it("configured is not effective; a pass under the current config makes it tested", async () => {
    const { ctl, post, ctx } = await env();
    expect(ctl).toMatchObject({ state: "configured", effective_claimed: false });
    expect(ctl.state_reason).toMatch(/not shown as effective/);
    const r = (await post("/controls/waf-sqli/tests", test(), ctx.analyst)).json();
    expect(r.control).toMatchObject({ state: "tested", effective_claimed: true });
  });

  it("a relevant config change invalidates the old test claim", async () => {
    const { post, ctx, asset } = await env();
    await post("/controls/waf-sqli/tests", test(), ctx.analyst);
    const changed = (await post("/controls", { id: "waf-sqli", name: "Edge SQL injection rule", kind: "waf_rule", asset_ids: [asset], scope: "all public routes on the edge", policy_version: "crs-4.3", config: { rule: 942100, mode: "detect" } })).json();
    expect(changed).toMatchObject({ state: "stale", effective_claimed: false });
    expect(changed.tests[0].applies_to_current_config).toBe(false);
    expect(changed.history.at(-1).change).toMatch(/earlier tests no longer apply/);
  });

  it("an unavailable observer yields inconclusive, never a pass; expiry makes a pass stale", async () => {
    const { post, ctx, clock } = await env();
    const r = (await post("/controls/waf-sqli/tests", test({ observer_available: false }), ctx.analyst)).json();
    expect(r).toMatchObject({ recorded_outcome: "inconclusive", control: { state: "unknown" } });
    expect(r.control.state_reason).toMatch(/observer edge request log was unavailable/);
    await post("/controls/waf-sqli/tests", test({ valid_days: 7 }), ctx.analyst);
    clock.t += 8 * 86_400_000;
    expect((await ctx.app.inject({ url: "/api/projects/demo-castle/controls/waf-sqli", headers: ctx.h(ctx.viewer) })).json()).toMatchObject({ state: "stale" });
  });

  it("positive and negative results keep their conditions; every control opens a full record", async () => {
    const { post, ctx } = await env();
    await post("/controls/waf-sqli/tests", test(), ctx.analyst);
    await post("/controls/waf-sqli/tests", test({ outcome: "fail", conditions: "encoded payload %27%20OR%201=1 to /search from lab runner; passed through" }), ctx.analyst);
    const c = (await ctx.app.inject({ url: "/api/projects/demo-castle/controls/waf-sqli", headers: ctx.h(ctx.viewer) })).json();
    expect(c.state).toBe("failed");
    expect(c.tests.map((t: { outcome: string; conditions: string }) => `${t.outcome}:${t.conditions.slice(0, 7)}`)).toEqual(["fail:encoded", "pass:10 beni"]);
    const list = (await ctx.app.inject({ url: "/api/projects/demo-castle/controls", headers: ctx.h(ctx.viewer) })).json().controls;
    for (const x of list) expect((await ctx.app.inject({ url: `/api/projects/demo-castle/controls/${x.id}`, headers: ctx.h(ctx.viewer) })).statusCode).toBe(200);
    expect((await post("/controls/waf-sqli/tests", test(), ctx.viewer)).statusCode).toBe(403);
    expect((await post("/controls/waf-sqli/tests", { outcome: "pass", observer: "x" }, ctx.analyst)).statusCode).toBe(400); // conditions required
  });
});
