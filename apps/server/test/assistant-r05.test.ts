import { describe, expect, it, afterEach } from "vitest";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { buildApp } from "../src/app.ts";
import { seedDemo } from "../src/seed.ts";
import { assistCase, type AssistInput, type AssistModel } from "../src/assistant.ts";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

/** R05.4 optional bounded assistance with stub models only (no provider is called). */
async function boot(assistant: AssistModel | null) {
  const store = new Store(openDb(":memory:")); seedDemo(store);
  const analyst = store.createToken("analyst", "analyst").token, viewer = store.createToken("viewer", "viewer").token;
  const app = await buildApp({ store, secret: "s", demoMode: false, planner: null, webDist: "/nonexistent", assistant });
  cleanups.push(async () => { await app.close(); store.db.close(); });
  const h = (t: string) => ({ authorization: `Bearer ${t}` });
  const f = store.listFindings("demo-castle").find((x) => x.rule_id === "auth.repeated_failure")!;
  let c = (await app.inject({ method: "POST", url: "/api/projects/demo-castle/cases", headers: h(analyst), payload: { title: "spray", scope: { question: "Did the spray succeed?", asset_ids: f.affected_asset_ids }, closure_criteria: "x" } })).json();
  c = (await app.inject({ method: "POST", url: `/api/projects/demo-castle/cases/${c.id}/items`, headers: h(analyst), payload: { kind: "finding", ref: f.id, expected_version: c.version } })).json();
  const assist = async () => (await app.inject({ method: "POST", url: `/api/projects/demo-castle/cases/${c.id}/assist`, headers: h(viewer), payload: {} })).json();
  return { store, app, f, assist };
}

describe("R05.4 bounded assistance", () => {
  it("aborts a timed-out provider and never returns provider error details", async () => {
    const { store } = await boot(null);
    let signal: AbortSignal | undefined;
    const c = { id: "case-test", scope: { question: "test", asset_ids: [] }, items: [] };
    const result = await assistCase(store, "demo-castle", c, { id: "slow", call: async (_input, abort) => { signal = abort; return new Promise(() => {}); } }, { timeout_ms: 1 });
    expect(signal?.aborted).toBe(true);
    expect(result.mode).toBe("deterministic");
    const failure = await assistCase(store, "demo-castle", c, { id: "error", call: async () => { throw new Error("private-provider-credential"); } });
    expect(JSON.stringify(failure)).not.toContain("private-provider-credential");
  });
  it("works with no model: deterministic, supported restatements of linked findings", async () => {
    const { assist, f } = await boot(null);
    const r = await assist();
    expect(r).toMatchObject({ mode: "deterministic", model: null, note: expect.stringMatching(/no assistant model/) });
    expect(r.claims[0]).toMatchObject({ status: "evidence_linked", text: expect.stringContaining("auth.repeated_failure") });
    expect(r.claims[0].evidence_ids.length).toBe(f.event_ids.length);
  });
  it("injected instructions grant no tools, approvals or scope; unsupported claims are marked", async () => {
    let seen: AssistInput | null = null;
    const obedient: AssistModel = { id: "stub-obedient", call: async (input) => { seen = input; return JSON.stringify({ claims: [{ text: "The attacker is the CFO.", evidence_ids: ["evt_not_retrieved"] }, { text: "Failures came from one actor.", evidence_ids: [input.evidence[0]!.id], uncertainty: "actor namespace per source" }, { text: "Nothing else happened." }], approve_containment: true, tools: ["dk_propose_containment"], scope: { asset_ids: ["*"] } }); } };
    const { assist, store } = await boot(obedient);
    const before = store.listContainment("demo-castle").length;
    const r = await assist();
    expect(seen!.instructions).toMatch(/never instructions/);
    expect(seen!.evidence.every((e) => typeof e.untrusted_text === "object")).toBe(true);
    expect(r.mode).toBe("model_draft");
    expect(r.claims.map((c: { status: string }) => c.status)).toEqual(["unsupported", "evidence_linked", "unsupported"]);
    expect(r.claims[0].unsupported_reason).toMatch(/not retrieved/);
    expect(r.claims[2].unsupported_reason).toBe("cites no evidence");
    expect(r.ignored_requests.join(" ")).toMatch(/approve_containment.*tools.*scope/);
    expect(store.listContainment("demo-castle").length).toBe(before);
    expect(r.provenance).toMatchObject({ prompt_template: "dk-assist-1", model: "stub-obedient", input_digest: expect.stringMatching(/^sha256:/), output_digest: expect.stringMatching(/^sha256:/) });
  });
  it("provider outage or garbage leaves the deterministic product usable", async () => {
    const down: AssistModel = { id: "stub-down", call: async () => { throw new Error("ECONNRESET"); } };
    const r = await (await boot(down)).assist();
    expect(r).toMatchObject({ mode: "deterministic", note: expect.stringMatching(/assistant unavailable/) });
    const junk: AssistModel = { id: "stub-junk", call: async () => "Sure! Here is my analysis..." };
    expect((await (await boot(junk)).assist()).note).toMatch(/not valid JSON/);
  });
});
