import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, DkClient } from "../../apps/mcp/src/server.ts";
import { resetPack, startPack } from "./src/pack.ts";
import demoGraph from "../../fixtures/demo/graph.json" with { type: "json" };

/** R02.2 one-command local application pack. */
describe("R02.2 local application pack", () => {
  it("a fresh start walks authorize/preview/import/validate/first-event and the SDK event lands on the right asset", async () => {
    const pack = await startPack();
    try {
      expect(pack.steps.map((s) => `${s.step}:${s.ok}`)).toEqual(["authorize:true", "preview:true", "import:true", "validate:true", "first_event:true"]);
      const ev = pack.store.listEvents("local", { limit: 20 }).find((e) => e.source_id === "checkout-sdk")!;
      expect(ev.asset_ids).toEqual(["checkout"]);
      const read = pack.store.listEvents("local", { limit: 20 }).find((e) => e.source_id === "db-audit")!;
      expect(read).toMatchObject({ asset_ids: ["db"], action: "data_access" });
      // the same evidence through the HTTP API (what the UI loads) and through MCP
      const http = await (await fetch(`${pack.url}/api/projects/local/events/${encodeURIComponent(ev.id)}`, { headers: { authorization: `Bearer ${pack.adminToken}` } })).json();
      const server = createServer(new DkClient({ baseUrl: pack.url, token: pack.adminToken, project: "local" }));
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "pack-test", version: "1" });
      await Promise.all([server.connect(a), client.connect(b)]);
      const r = await client.callTool({ name: "dk_get_event", arguments: { id: ev.id } });
      const mcp = JSON.parse((r.content as { text: string }[])[0]!.text);
      expect(mcp.event).toEqual(http.event);
      expect(mcp.evidence).toEqual(http.evidence);
      await client.close();
    } finally { await pack.stop(); }
  });

  it("a deliberate source outage becomes a visible gap; the agent run is independently corroborated", async () => {
    const pack = await startPack();
    try {
      const t0 = new Date(Date.now() - 1000).toISOString();
      pack.sdk.db.sensorDown("db", "Pack drill: audit collection stopped deliberately.");
      await pack.flush();
      const health = await (await fetch(`${pack.url}/api/projects/local/health`, { headers: { authorization: `Bearer ${pack.adminToken}` } })).json();
      expect(health.coverage.find((c: { source_id: string }) => c.source_id === "db-audit")).toMatchObject({ state: "offline", note: "Pack drill: audit collection stopped deliberately." });
      const hist = await (await fetch(`${pack.url}/api/projects/local/coverage/history?asset=db&action=data_access&after=${t0}&before=${new Date(Date.now() + 1000).toISOString()}`, { headers: { authorization: `Bearer ${pack.adminToken}` } })).json();
      expect(hist.totals_ms.unknown).toBeGreaterThan(0);
      await pack.runAgentTask("pack-run-1");
      const effect = pack.store.listFindings("local").find((f) => f.kind === "agent_effect_observed");
      expect(effect).toMatchObject({ evidence_level: "corroborated" });
      expect(pack.store.listFindings("local").some((f) => f.kind === "agent_action_denied")).toBe(true);
    } finally { await pack.stop(); }
  });

  it("restarts on the same data directory without duplicating sources, and reset removes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dk-pack-"));
    const p1 = await startPack({ dataDir: dir }); await p1.stop();
    const p2 = await startPack({ dataDir: dir });
    try { expect(p2.store.listSources("local").map((s) => s.id).sort()).toEqual(["agent-wrapper", "checkout-sdk", "db-audit", "sink-observer"]); }
    finally { await p2.stop(); }
    resetPack(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it("the static demo stays distinctly synthetic while the pack is live", async () => {
    expect((demoGraph as { dataset_kind: string }).dataset_kind).toBe("synthetic");
    const pack = await startPack();
    try { expect(pack.store.getProject("local")!.dataset_kind).toBe("live"); } finally { await pack.stop(); }
  });
});
