import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, DkClient } from "../src/server.ts";
import { setup } from "../../server/test/helpers.ts";

/** End-to-end: MCP client -> MCP server -> real Digital Kingdom HTTP server -> same engine as the castle. */
let ctx: Awaited<ReturnType<typeof setup>>;
let base: string;
const connect = async (token: string) => {
  const server = createServer(new DkClient({ baseUrl: base, token, project: "demo-castle" }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
};
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = await c.callTool({ name, arguments: args });
  const text = (r.content as { text: string }[])[0]!.text;
  return { isError: !!r.isError, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
};

beforeAll(async () => { ctx = await setup(); base = await ctx.app.listen({ port: 0, host: "127.0.0.1" }); });
afterAll(async () => { await ctx.app.close(); });

describe("Digital Kingdom MCP", () => {
  it("lists the agent tools", async () => {
    const c = await connect(ctx.viewer);
    const tools = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["dk_access_paths", "dk_assess_change", "dk_asset_interior", "dk_capabilities", "dk_case_changes", "dk_containment_options", "dk_coverage", "dk_coverage_history", "dk_create_bundle", "dk_credential_aftermath", "dk_facts", "dk_get_bundle_events", "dk_get_case", "dk_get_event", "dk_get_finding", "dk_list_cases", "dk_list_findings", "dk_list_recipes", "dk_local_missions", "dk_overview", "dk_propose_containment", "dk_run_recipe", "dk_search_events", "dk_security_context", "dk_world_hierarchy", "dk_world_locate"]);
  });
  it("shares one engine with the castle: findings match the server's", async () => {
    const c = await connect(ctx.viewer);
    const r = await call(c, "dk_list_findings");
    expect(r.json.count).toBe(ctx.store.listFindings("demo-castle").length);
  });
  it("gives a coding agent context for the auth endpoint it is changing", async () => {
    const c = await connect(ctx.viewer);
    const r = await call(c, "dk_assess_change", { asset_ids: ["identity-service"], summary: "refactor login handler" });
    expect(["hold", "proceed_with_care"]).toContain(r.json.posture);
    expect(r.json.recommendations.join(" ")).toMatch(/rate limiting|lockout/);
  });
  it("route lookup resolves the endpoint under attack", async () => {
    const c = await connect(ctx.viewer);
    const r = await call(c, "dk_security_context", { route: "/admin/roles" });
    expect(r.json.asset.name).toBe("orders-api");
    expect(r.json.findings.direct.some((f: { kind: string }) => f.kind === "sensitive_privilege_change")).toBe(true);
  });
  it("wraps evidence as untrusted data and never leaks redacted secrets", async () => {
    const c = await connect(ctx.viewer);
    const f = ctx.store.listFindings("demo-castle").find((x) => x.kind === "repeated_auth_failure")!;
    const r = await call(c, "dk_get_finding", { id: f.id });
    expect(r.json.note).toMatch(/untrusted/);
    expect(r.json.evidence.untrusted).toBe(true);
    expect(r.text).not.toContain("hunter2");
  });
  it("a viewer-token agent cannot propose containment; an analyst can, and it stays pending", async () => {
    const f = ctx.store.listFindings("demo-castle").find((x) => x.kind === "decoy_credential_used")!;
    const viewer = await connect(ctx.viewer);
    const denied = await call(viewer, "dk_propose_containment", { finding_id: f.id, action_id: "secrets.rotate_credentials", rationale: "decoy used in agent env" });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/403/);
    const analyst = await connect(ctx.analyst);
    const ok = await call(analyst, "dk_propose_containment", { finding_id: f.id, action_id: "secrets.rotate_credentials", rationale: "decoy used in agent env" });
    expect(ok.json.request.status).toBe("pending");
    expect(ok.json.next).toMatch(/Nothing has been changed/);
  });
  it("coverage reports unknown assets honestly", async () => {
    const c = await connect(ctx.viewer);
    const r = await call(c, "dk_coverage");
    expect(r.json.unobserved_asset_ids).toEqual(expect.arrayContaining(["ci", "stripe"]));
  });
});
