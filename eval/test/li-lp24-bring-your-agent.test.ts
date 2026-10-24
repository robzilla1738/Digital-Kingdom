import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StdioClientTransport } from "../../apps/mcp/test/sdk-client.ts";
import { startLocalCase, type LocalCase } from "../local/controller.ts";
import { connectScoped, mcpEnv } from "../local/recorder.ts";
import { scriptedInvestigate } from "../local/scripted.ts";
import { declareMode, ModeError } from "../local/modes.ts";
import { nativeAgentKit } from "../local/native-agent.ts";
import { modelInvestigate } from "../local/model-agent.ts";
import { DEFAULT_LIMITS } from "../src/agent.ts";
import { fakeProvider, FAKE_REASONING } from "./li-fake-provider.ts";

/** LP24 — bring-your-agent local investigation over the real stdio MCP transport. No paid model call. */
const ROOT = join(import.meta.dirname, "../..");
const doc = (id: string) => JSON.parse(readFileSync(join(ROOT, `scenarios/local-world/dsl/${id}.scenario.json`), "utf8"));
const open: LocalCase[] = [];
afterEach(async () => { for (const c of open.splice(0)) await c.stop(); });
const start = async (id: string) => { const c = await startLocalCase(doc(id)); open.push(c); return c; };

describe("LP24-A1: a real stdio client investigates the local world through normal authenticated endpoints", () => {
  it("scripted investigators reach the LP07 world through each profile with a scoped service viewer token and answer every in-scope request", async () => {
    const c = await start("LW-01");
    expect(c.private.result.status).toBe("complete");
    expect(c.guided.job_status).toBe("completed");
    // test-local expectation (not the LP25 referee): the in-scope operations the controller executed, with their status
    const scoped = c.private.truth.steps.filter((s) => s.action === "request_route" && s.op_id && c.private.doc.steps[s.index]!.route === "GET /tenants/{tenant}/records");
    const expected = scoped.map((s) => ({ request_id: s.op_id!, outcome: s.status! < 300 ? "allowed" : "denied" }));
    expect(expected.length).toBe(5);
    for (const cond of ["C1", "C2", "C3"] as const) {
      const m = await connectScoped(c.public, cond);
      try {
        const r = await scriptedInvestigate(m, c.public, "saas-storefront");
        expect(r.complete).toBe(true);
        expect(r.answer.operations.map((o) => ({ request_id: o.request_id, outcome: o.outcome })), cond).toEqual(expected);
        expect(r.answer.operations.every((o) => o.evidence.length > 0)).toBe(true);
        expect(m.recorder.entries.filter((e) => e.kind === "tool_call").length).toBeGreaterThan(1);
      } finally { await m.close(); }
    }
    // the guided profile is the focused investigation-read profile: no write tool is offered
    const m3 = await connectScoped(c.public, "C3");
    expect(m3.tools.sort()).toEqual(["dk_check_conclusion", "dk_get_packet", "dk_inspect_refs", "dk_job_status", "dk_next_step", "dk_read_contract", "dk_resume", "dk_session"]);
    const s = await m3.call("dk_session");
    expect(s.json.data.principal).toMatchObject({ role: "viewer" });
    expect(s.json.data.writes_effective).toBe(false);
    // endpoints are authenticated on every call: revoking the token stops the same live session
    c.revokeInvestigator();
    const after = await m3.call("dk_read_contract", { case_id: c.public.case_id });
    expect(after.isError).toBe(true);
    expect(m3.recorder.denials().at(-1)!.denial).toBe("authority_refused");
    await m3.close();
  }, 90_000);

  it("the native-agent kit launches the real server through the recording proxy and records observable tool I/O", async () => {
    const c = await start("LW-02");
    const dir = mkdtempSync(join(tmpdir(), "dk-li-native-"));
    const kit = nativeAgentKit(c, dir);
    const entry = kit.config.mcpServers["digital-kingdom-local-investigation"];
    const client = new Client({ name: "native-agent-standin", version: "1" });
    await client.connect(new StdioClientTransport({ command: entry.command, args: entry.args, cwd: ROOT, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_NO_WARNINGS: "1", ...entry.env }, stderr: "pipe" }));
    try {
      const tools = (await client.listTools()).tools.map((t: { name: string }) => t.name);
      expect(tools).toContain("dk_get_packet");
      expect(tools).not.toContain("dk_run_step");
      const pkt = await client.callTool({ name: "dk_get_packet", arguments: { case_id: c.public.case_id } });
      expect(pkt.isError).toBeFalsy();
      await client.callTool({ name: "read_file", arguments: { path: "/etc/passwd" } }).catch(() => undefined);
    } finally { await client.close(); }
    await new Promise((r) => setTimeout(r, 200));
    const trace = readFileSync(kit.trace, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(trace.map((e) => e.kind)).toEqual(expect.arrayContaining(["note", "tools_list", "tool_call"]));
    const calls = trace.filter((e) => e.kind === "tool_call");
    expect(calls.find((e) => e.tool === "dk_get_packet")!.response).toContain("dk.evidence_packet.v1");
    expect(calls.find((e) => e.tool === "read_file")).toMatchObject({ denied: true, denial: "unknown_tool" });
    expect(readFileSync(kit.trace, "utf8")).not.toContain(c.public.token);
    expect(statSync(kit.trace).mode & 0o077).toBe(0);
    expect(kit.task).toContain(c.public.task);
    expect(kit.task).not.toContain(c.private.doc.seed);
  }, 60_000);
});

describe("LP24-A2: no provider route is silently selected; missing model availability stays not_exercised", () => {
  it("a mode must be stated, and incomplete routes resolve to not_exercised with the reason instead of a fallback", () => {
    const c = { mcp_profile: "investigation-read", credential: "service viewer" };
    expect(() => declareMode(undefined, {}, c)).toThrow(ModeError);
    expect(() => declareMode("auto", {}, c)).toThrow(/explicitly/);
    const none = declareMode("approved_provider", {}, c);
    expect(none).toMatchObject({ status: "not_exercised", ai_checks: "not_exercised", route: null });
    expect(none.reason).toMatch(/DK_LI_ROUTE.*DK_LI_MODEL.*DK_LI_CAP_USD.*AI_GATEWAY_API_KEY/);
    // a key alone, or the historical v2 approval, selects nothing
    expect(declareMode("approved_provider", { AI_GATEWAY_API_KEY: "k".repeat(20) }, c).status).toBe("not_exercised");
    const v2 = declareMode("approved_provider", { AI_GATEWAY_API_KEY: "k".repeat(20), DK_EVAL_V2_APPROVED: "1", DK_LI_ROUTE: "ai-gateway", DK_LI_MODEL: "m", DK_LI_CAP_USD: "5" }, c);
    expect(v2.status).toBe("not_exercised");
    expect(v2.reason).toMatch(/historical v2 approval and is not accepted/);
    expect(() => declareMode("approved_provider", { AI_GATEWAY_API_KEY: "k".repeat(20), DK_LI_ROUTE: "openrouter", DK_LI_MODEL: "m", DK_LI_CAP_USD: "1", DK_LI_APPROVED: "local-intelligence-phase" }, c)).toThrow(/unknown provider route/);
    const ok = declareMode("approved_provider", { AI_GATEWAY_API_KEY: "k".repeat(20), DK_LI_ROUTE: "ai-gateway", DK_LI_MODEL: "meta/muse-spark-1.3-contributor", DK_LI_CAP_USD: "2", DK_LI_APPROVED: "local-intelligence-phase" }, c);
    expect(ok).toMatchObject({ status: "ready", ai_checks: "exercised", label: "restricted_model", route: { kind: "ai_gateway", model: "meta/muse-spark-1.3-contributor", cap_usd: 2 } });
    expect(declareMode("local_model", {}, c)).toMatchObject({ status: "not_exercised", ai_checks: "not_exercised" });
    expect(() => declareMode("local_model", { DK_LI_LOCAL_MODEL_URL: "https://api.example.com/v1", DK_LI_LOCAL_MODEL: "m" }, c)).toThrow(/loopback/);
    expect(declareMode("scripted", {}, c)).toMatchObject({ status: "ready", ai_checks: "not_exercised", label: "scripted" });
  });
});

describe("LP24-A3: a native coding agent with repo/oracle access is development_assisted, never held-out blinded", () => {
  it("labels follow capabilities, not claims", async () => {
    const c = { mcp_profile: "investigation-read", credential: "service viewer" };
    const native = declareMode("native_agent", {}, c);
    expect(native).toMatchObject({ label: "development_assisted", blinded: false, capabilities: { repository_access: true, shell: true, prior_exposure_to_fixtures: true } });
    expect(() => declareMode("native_agent", {}, c, { blinded: true })).toThrow(/cannot be declared blinded/);
    // a native agent that says it has no repository access is still development_assisted (it may have seen fixtures)
    expect(declareMode("native_agent", {}, { ...c, repository_access: false, filesystem: false, shell: false, prior_exposure_to_fixtures: false }).label).toBe("development_assisted");
    const env = { DK_LI_LOCAL_MODEL_URL: "http://127.0.0.1:9/v1", DK_LI_LOCAL_MODEL: "m" };
    expect(declareMode("local_model", env, c).label).toBe("restricted_model");
    expect(declareMode("local_model", env, { ...c, repository_access: true }).label).toBe("development_assisted");
    expect(() => declareMode("local_model", env, { ...c, filesystem: true }, { blinded: true })).toThrow();
    const lc = await start("LW-03");
    const kit = nativeAgentKit(lc, mkdtempSync(join(tmpdir(), "dk-li-native-")));
    expect(kit.mode.label).toBe("development_assisted");
    expect(kit.task).toMatch(/development_assisted.*not a blinded or held-out evaluation/s);
  }, 60_000);
});

describe("LP24-A4: traces hold observable tool I/O and claims, never hidden reasoning or tokens", () => {
  it("a model investigator (loopback stand-in, local_model mode) leaves no reasoning payload or credential in its record", async () => {
    const c = await start("LW-03");
    const fake = await fakeProvider((n) => n === 1 ? { tool_calls: [{ name: "dk_session", arguments: {} }, { name: "dk_get_packet", arguments: { case_id: c.public.case_id } }] } : { content: JSON.stringify({ schema: "dk.local.eval_answer.v1", operations: [], summary: "none", unknowns: [] }) });
    try {
      const mode = declareMode("local_model", { DK_LI_LOCAL_MODEL_URL: fake.url, DK_LI_LOCAL_MODEL: "stand-in" }, { mcp_profile: "investigation-read", credential: "service viewer" });
      expect(mode.status).toBe("ready");
      const m = await connectScoped(c.public, "C3");
      const r = await modelInvestigate(m, c.public, { ...DEFAULT_LIMITS, model: "stand-in", gatewayUrl: fake.url, apiKey: "local-no-key" }, []);
      await m.close();
      expect(r.status).toBe("completed");
      const record = JSON.stringify({ trace: m.recorder.toJSON(), turns: r.turns });
      expect(record).not.toContain(FAKE_REASONING);
      expect(record).not.toMatch(/reasoning_details|"reasoning"/);
      expect(record).not.toContain(c.public.token);
      expect(new Set(m.recorder.entries.map((e) => e.kind))).toEqual(new Set(["tools_list", "tool_call"]));
      expect(m.recorder.toJSON().never_contains).toEqual(expect.arrayContaining(["model reasoning", "token-level data", "credentials"]));
      // the reasoning payload was not replayed to the provider either
      expect(JSON.stringify(fake.bodies)).not.toContain(FAKE_REASONING);
      // the MCP subprocess environment is the public handle only
      expect(Object.keys(mcpEnv(c.public, "C3")).sort()).toEqual(["DK_MCP_PROFILE", "DK_PROJECT", "DK_TOKEN", "DK_URL"]);
    } finally { await fake.close(); }
    expect(existsSync(c.private.oracle_file)).toBe(true);
  }, 60_000);
});
