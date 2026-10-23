import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";
import { verifyFixture } from "../src/regression.ts";

/** R07.4 sanitized regression proposals from closed cases. */
type Ctx = Awaited<ReturnType<typeof setup>>;
const P = "/api/projects/demo-castle";
const call = (ctx: Ctx, method: "GET" | "POST", url: string, payload?: unknown, token = ctx.analyst) => ctx.app.inject({ method, url: `${P}${url}`, headers: ctx.h(token), ...(payload !== undefined ? { payload: payload as object } : {}) });
const ok = async (p: ReturnType<typeof call>) => { const r = await p; expect(r.statusCode, r.body).toBe(200); return r.json(); };

async function closedCase(ctx: Ctx) {
  const f = ctx.store.listFindings("demo-castle").find((x) => x.rule_id === "auth.repeated_failure")!;
  let c = await ok(call(ctx, "POST", "/cases", { title: "Password spray against checkout login", scope: { question: "Was the spray against the login stopped?", asset_ids: [] }, closure_criteria: "Every failure attributed." }));
  for (const id of f.event_ids) c = await ok(call(ctx, "POST", `/cases/${c.id}/items`, { kind: "event", ref: id, expected_version: c.version }));
  c = await ok(call(ctx, "POST", `/cases/${c.id}/status`, { status: "closed", statement: "Spray blocked after lockout.", expected_version: c.version }));
  const cited = new Set(ctx.store.listFindings("demo-castle").flatMap((x) => [...x.event_ids, ...x.counterevidence_event_ids]));
  const benign = ctx.store.listEvents("demo-castle", { limit: 5000 }).filter((e) => !cited.has(e.id) && e.action === "authentication" && e.outcome === "success").map((e) => e.id);
  return { c, f, benign };
}

describe("R07.4 regression proposals", () => {
  it("minimizes to a synthetic fixture with no private identifiers, verifies corrected vs broken, and keeps benign counterexamples quiet", async () => {
    const ctx = await setup();
    const { c, f, benign } = await closedCase(ctx);
    const open = await ok(call(ctx, "POST", "/cases", { title: "still open", scope: { question: "q", asset_ids: [] }, closure_criteria: "x" }));
    expect((await call(ctx, "POST", `/cases/${open.id}/regression-proposal`, { lesson: "x", expected: { rule_id: "auth.repeated_failure", fires: true }, benign_event_ids: benign })).statusCode).toBe(409);
    expect((await call(ctx, "POST", `/cases/${c.id}/regression-proposal`, { lesson: "x", expected: { rule_id: "auth.repeated_failure", fires: true } })).statusCode).toBe(400); // benign required
    const p = await ok(call(ctx, "POST", `/cases/${c.id}/regression-proposal`, { lesson: "Repeated failures from one actor against one login still raise auth.repeated_failure; one success does not.", expected: { rule_id: "auth.repeated_failure", fires: true }, benign_event_ids: benign.slice(0, 2) }));
    expect(p.status).toBe("proposed");
    expect(p.verification).toMatchObject({ corrected_condition: "passes", broken_condition: "fails, as it should", benign_counterexamples: "do not fire", ok: true });
    const text = JSON.stringify(p.fixture);
    const originals = ctx.store.listEvents("demo-castle", { limit: 5000 }).filter((e) => f.event_ids.includes(e.id)).flatMap((e) => [e.id, e.source_id, e.actor_ref, e.session_ref, e.client_ip, e.request_id, e.route, ...e.asset_ids].filter((x): x is string => !!x && x.length >= 4));
    const leaves: string[] = [];
    const walk = (v: unknown, key = ""): void => { if (typeof v === "string") { if (key !== "kind" && key !== "allowed_zone_ids") leaves.push(v); } else if (Array.isArray(v)) v.forEach((x) => walk(x, key)); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k); };
    walk(p.fixture);
    for (const o of originals) { expect(leaves).not.toContain(o); if (o.length >= 8) expect(text).not.toContain(o); }
    expect(text).not.toContain("demo-castle");
    expect(text).not.toContain(c.id);
    expect(p.fixture.positive.every((e: { occurred_at: string; dataset_kind: string }) => e.occurred_at.startsWith("2030-01-01") && e.dataset_kind === "synthetic")).toBe(true);
    expect(p.fixture.expected_outcome).toMatchObject({ version: 1, rule_id: "auth.repeated_failure", fires: true, ruleset_version: expect.stringMatching(/^dk-rules-/) });
    // the stored fixture alone reproduces the verification
    expect(verifyFixture(p.fixture, p.fixture.expected_outcome).ok).toBe(true);
  });

  it("refuses secrets in the lesson and records a failed verification when the benign counterexample fires", async () => {
    const ctx = await setup();
    const { c, f, benign } = await closedCase(ctx);
    const leak = await call(ctx, "POST", `/cases/${c.id}/regression-proposal`, { lesson: "token sk_live_abcdef123456 was used", expected: { rule_id: "auth.repeated_failure", fires: true }, benign_event_ids: benign });
    expect(leak.statusCode).toBe(422);
    expect(leak.body).not.toContain("sk_live_abcdef123456");
    const ip = await call(ctx, "POST", `/cases/${c.id}/regression-proposal`, { lesson: "attacker at 203.0.113.9 and ops@example.com", expected: { rule_id: "auth.repeated_failure", fires: true }, benign_event_ids: benign });
    expect(ip.json().details).toEqual(expect.arrayContaining(["email address", "non-documentation ip address"]));
    const bad = await ok(call(ctx, "POST", `/cases/${c.id}/regression-proposal`, { lesson: "spray fires", expected: { rule_id: "auth.repeated_failure", fires: true }, benign_event_ids: f.event_ids }));
    expect(bad.status).toBe("verification_failed");
    expect(bad.verification.benign_counterexamples).toBe("FIRE");
    expect((await call(ctx, "POST", `/regressions/${bad.id}/decision`, { decision: "approve", fixture_digest: bad.fixture_digest }, ctx.admin)).statusCode).toBe(409);
  });

  it("an agent cannot approve, the author cannot self-approve, and export never publishes", async () => {
    const ctx = await setup();
    const { c, benign } = await closedCase(ctx);
    const p = await ok(call(ctx, "POST", `/cases/${c.id}/regression-proposal`, { lesson: "spray still fires", expected: { rule_id: "auth.repeated_failure", fires: true }, benign_event_ids: benign }));
    expect((await call(ctx, "POST", `/regressions/${p.id}/export`)).statusCode).toBe(409);
    const agent = ctx.store.createToken("agent", "analyst", "*", undefined, "service").token;
    expect((await call(ctx, "POST", `/regressions/${p.id}/decision`, { decision: "approve", fixture_digest: p.fixture_digest }, agent)).statusCode).toBe(403);
    expect((await call(ctx, "POST", `/regressions/${p.id}/decision`, { decision: "approve", fixture_digest: p.fixture_digest })).statusCode).toBe(403);
    const reviewer = ctx.store.createToken("reviewer", "analyst").token;
    expect((await call(ctx, "POST", `/regressions/${p.id}/decision`, { decision: "approve", fixture_digest: "sha256:wrong" }, reviewer)).statusCode).toBe(409);
    const d = await ok(call(ctx, "POST", `/regressions/${p.id}/decision`, { decision: "approve", fixture_digest: p.fixture_digest }, reviewer));
    expect(d.status).toBe("approved");
    const ex = await ok(call(ctx, "POST", `/regressions/${p.id}/export`));
    expect(ex.files[0].path).toMatch(/^scenarios\/regressions\/auth\.repeated.failure-[0-9a-f]{8}\.json$/);
    expect(ex.publication).toMatch(/not published/);
    expect(ex.pull_request.body).toMatch(/not a validated defence/);
    expect(verifyFixture(JSON.parse(ex.files[0].content), JSON.parse(ex.files[0].content).expected_outcome).ok).toBe(true);
    const list = await ok(call(ctx, "GET", "/regressions", undefined, ctx.viewer));
    expect(list.proposals[0]).toMatchObject({ id: p.id, status: "approved", verification_ok: true });
  });
});
