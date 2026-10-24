import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts"; // first: db.ts and change-review.ts import each other
import { readFileSync } from "node:fs";

/**
 * LP23 server linkage: LP22 verifications + LP23 regressions linked to a case and to the LP13/LP19 comparison they
 * test; closure gate (A4); staleness propagation (A2); executed-local list in the world comparison (closes the LP19
 * gap). Fixtures are real local lab outputs (examples/reference-app/capture-lr01.ts), no model.
 */
type Ctx = Awaited<ReturnType<typeof setup>>;
const P = "/api/projects/demo-castle";
const fx = (n: string) => JSON.parse(readFileSync(new URL(n, import.meta.url), "utf8"));
const OK = fx("./fixtures/lp23/verification-success.json"), BAD = fx("./fixtures/lp23/verification-failed.json");
const REG = fx("../../../scenarios/local-world/regressions/LR-01-saas-cross-tenant-api.json");
const req = (ctx: Ctx, method: "GET" | "POST", url: string, payload?: unknown, token = ctx.analyst) => ctx.app.inject({ method, url: `${P}${url}`, headers: ctx.h(token), ...(payload !== undefined ? { payload: payload as object } : {}) });

async function withCase(ctx: Ctx) {
  const r = await req(ctx, "POST", "/cases", { title: "Cross-tenant reads in the lab", scope: { question: "Is tenant isolation repaired?", asset_ids: ["api"] }, closure_criteria: "Repair verified locally or the gap accepted" });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { id: string; version: number; owner: string };
}
const close = (ctx: Ctx, c: { id: string }, version: number, extra: Record<string, unknown> = {}) => req(ctx, "POST", `/cases/${c.id}/status`, { status: "closed", expected_version: version, statement: "verified in the local lab", ...extra });

describe("LP23 local repair linkage", () => {
  it("A4 (negative first): a failed verification cannot silently close a case; accepted unknowns are recorded", async () => {
    const ctx = await setup();
    const c = await withCase(ctx);
    // forged/invalid documents are refused
    expect((await req(ctx, "POST", `/cases/${c.id}/local-repairs`, { verification: { ...OK, whole_run: { ...OK.whole_run, outcome: "success", success: true }, security_verdict: "fail" } })).statusCode).toBe(422);
    expect((await req(ctx, "POST", `/cases/${c.id}/local-repairs`, { verification: OK, regression: { ...REG, lesson: "tampered" } })).statusCode).toBe(422);
    expect((await req(ctx, "POST", `/cases/${c.id}/local-repairs`, { verification: BAD, regression: REG })).json().error).toMatch(/not captured from this verification/);
    expect((await req(ctx, "POST", `/cases/${c.id}/local-repairs`, { verification: BAD }, ctx.viewer)).statusCode).toBe(403);
    const l = await req(ctx, "POST", `/cases/${c.id}/local-repairs`, { verification: BAD });
    expect(l.statusCode, l.body).toBe(200);
    expect(l.json().verifications[0]).toMatchObject({ whole_run: "security_failed", verified: false, residual_access: ["cross-tenant-read"] });
    const blocker = l.json().closure_blockers[0];
    expect(blocker.reason).toMatch(/security_failed, not a verified repair/);
    const v = (await req(ctx, "GET", `/cases/${c.id}`)).json().version;
    const refused = await close(ctx, c, v, {}, );
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatch(/failed verification cannot silently close/);
    expect((await close(ctx, c, v, { accepted_unknowns: [{ ref: blocker.ref, reason: "  " }] })).statusCode).toBe(409);
    const closed = await close(ctx, c, v, { accepted_unknowns: [{ ref: blocker.ref, reason: "wrong repair; isolation gap stays open and is tracked as residual risk" }] });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json().closure.accepted_unknowns).toEqual([expect.objectContaining({ ref: blocker.ref, accepted_reason: expect.stringMatching(/residual risk/) })]);
    expect((await req(ctx, "POST", `/cases/${c.id}/local-repairs`, { verification: OK })).statusCode).toBe(409); // closed case
  });

  it("A2: a verified repair + regression closes without extra; a changed tool version marks it stale and gates closure again", async () => {
    const ctx = await setup();
    const c = await withCase(ctx);
    const l = await req(ctx, "POST", `/cases/${c.id}/local-repairs`, { verification: OK, regression: REG });
    expect(l.statusCode, l.body).toBe(200);
    const view = l.json();
    expect(view.closure_blockers).toEqual([]);
    expect(view.regressions[0]).toMatchObject({ regression_id: REG.regression_id, validation: "valid", controls: [{ id: "cross-tenant-read", control: "negative" }, { id: "own-tenant-read", control: "positive" }], control_ids: ["ctl-tenant-isolation"], replay: { llm: "not_used" } });
    expect((await req(ctx, "POST", `/cases/${c.id}/local-repairs`, { verification: OK })).statusCode).toBe(409); // duplicate
    expect((await req(ctx, "POST", "/local-regressions/check", {})).json().regressions[0]).toMatchObject({ validation: "valid", changed: [] });
    const chk = (await req(ctx, "POST", "/local-regressions/check", { tools: { effect_verifier: "dk-effect-verifier-2" } })).json().regressions[0];
    expect(chk).toMatchObject({ validation: "stale", changed: ["tool:effect_verifier dk-effect-verifier-1 -> dk-effect-verifier-2"] });
    // sticky: re-checking with the old versions does not silently re-validate
    expect((await req(ctx, "POST", "/local-regressions/check", {})).json().regressions[0].validation).toBe("stale");
    const after = (await req(ctx, "GET", `/cases/${c.id}/local-repairs`)).json();
    expect(after.regressions[0]).toMatchObject({ validation: "stale", stale_reasons: ["tool:effect_verifier dk-effect-verifier-1 -> dk-effect-verifier-2"] });
    expect(after.closure_blockers[0].reason).toMatch(/regression validation is stale/);
    const v = (await req(ctx, "GET", `/cases/${c.id}`)).json().version;
    expect((await close(ctx, c, v)).statusCode).toBe(409);
    expect((await close(ctx, c, v, { accepted_unknowns: [{ ref: after.closure_blockers[0].ref, reason: "replay under the new verifier is scheduled" }] })).statusCode).toBe(200);
    expect(ctx.db.prepare("SELECT action FROM audit_log WHERE action LIKE 'case.local_%' ORDER BY rowid").all().map((r) => (r as { action: string }).action)).toEqual(["case.local_repair_linked", "case.local_regression_stale"]);
  });

  it("LP19 gap: a linked verification appears in the comparison's executed-local list, separate from model-only", async () => {
    const ctx = await setup();
    const c = await withCase(ctx);
    const state = (await req(ctx, "GET", "/analysis/state", undefined, ctx.viewer)).json();
    const src = ctx.store.listSources("demo-castle")[0]!;
    const cmp = await req(ctx, "POST", "/analysis/comparisons", { base_state_hash: state.state_hash, label: "repair", changes: [{ op: "modify", kind: "source", authority: "demo-castle", id: src.id, attrs: { disabled: true } }] });
    expect(cmp.statusCode, cmp.body).toBe(200);
    const id = cmp.json().id;
    expect((await req(ctx, "GET", `/analysis/comparisons/${id}/world`, undefined, ctx.viewer)).json().executed_local.results).toEqual([]);
    expect((await req(ctx, "POST", `/cases/${c.id}/local-repairs`, { verification: OK, comparison_id: "nope" })).statusCode).toBe(404);
    expect((await req(ctx, "POST", `/cases/${c.id}/local-repairs`, { verification: OK, comparison_id: id })).statusCode).toBe(200);
    expect((await req(ctx, "POST", `/cases/${c.id}/local-repairs`, { verification: BAD, comparison_id: id })).statusCode).toBe(200);
    const w = (await req(ctx, "GET", `/analysis/comparisons/${id}/world`, undefined, ctx.viewer)).json();
    expect(w.mode).toBe("model_only");
    for (const a of w.model_only.access) expect(a).toMatchObject({ executed: false, verified: false });
    expect(w.executed_local.results.map((r: { whole_run: string; verified: boolean; executed: boolean; scope: string }) => [r.whole_run, r.verified, r.executed, r.scope])).toEqual([["success", true, true, "local_run_only"], ["security_failed", false, true, "local_run_only"]]);
    expect(w.executed_local.results[0]).toMatchObject({ tested_target_revision: OK.verification_receipt.tested_target_revision, residual_access: [], disruption: [] });
    expect(w.executed_local.note).toMatch(/2 executed local verification\(s\) linked/);
  });
});
