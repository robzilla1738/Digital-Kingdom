import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, DkClient } from "../src/server.ts";
import { DigitalKingdom } from "../../../packages/sdk-node/src/index.ts";
import { startReferenceApp } from "../../../examples/reference-app/src/app.ts";
import { openDb } from "../../server/src/db.ts";
import { Store } from "../../server/src/store.ts";
import { buildApp } from "../../server/src/app.ts";

/**
 * The "convincing demonstration" as one isolated non-production trial:
 * a controlled event in a non-production app appears against the correct asset; the human view and the
 * agent receive the same supporting evidence ids; a source outage becomes visible; an unknown target stays
 * unknown; a restart preserves acknowledged events; a proposed response changes nothing.
 */
describe("isolated non-production trial", () => {
  it("collection -> finding -> UI API -> MCP, outage, unknowns, restart, inert proposal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dk-trial-"));
    const path = join(dir, "db.sqlite");
    let clock = Date.parse("2026-10-21T15:00:00Z");
    const now = () => new Date(clock);
    const boot = async () => {
      const store = new Store(openDb(path), { now });
      const app = await buildApp({ store, secret: "trial-secret", demoMode: false, planner: null, webDist: "/nonexistent", ssePollMs: 20 });
      return { store, app };
    };
    let { store, app } = await boot();
    const admin = store.createToken("trial admin (human)", "admin").token;
    const H = { authorization: `Bearer ${admin}` };
    await app.inject({ method: "POST", url: "/api/projects", headers: H, payload: { id: "trial", name: "Non-production trial", dataset_kind: "live" } });
    const g = await app.inject({ method: "POST", url: "/api/projects/trial/graph?format=manifest&revision=r1", headers: { ...H, "content-type": "application/yaml" },
      payload: "project: trial\nenvironment: staging\nassets:\n  - {id: edge, name: local-edge, kind: edge}\n  - {id: checkout, name: checkout-api, kind: service, owner: payments}\n  - {id: db, name: checkout-db, kind: database}\nrelationships:\n  - {from: edge, to: checkout}\n  - {from: checkout, to: db, kind: reads_from}\n" });
    expect(g.statusCode, g.body).toBe(200);
    const appKey = (await app.inject({ method: "POST", url: "/api/projects/trial/sources", headers: H, payload: { id: "checkout-sdk", label: "checkout-api security events", kind: "app_security", asset_ids: ["checkout"], trusts_request_ids: true } })).json().key;
    const dbKey = (await app.inject({ method: "POST", url: "/api/projects/trial/sources", headers: H, payload: { id: "db-audit", label: "checkout-db audit", kind: "db_audit", asset_ids: ["db"], stale_after_seconds: 300 } })).json().key;
    const agentToken = (await app.inject({ method: "POST", url: "/api/tokens", headers: H, payload: { name: "coding agent", role: "analyst", principal_type: "service", projects: ["trial"] } })).json().token;

    // 1) controlled activity in the isolated app, via the real SDK and authenticated ingestion
    let base = await app.listen({ port: 0, host: "127.0.0.1" });
    const dk = new DigitalKingdom({ url: base, sourceKey: appKey, sessionSalt: randomUUID(), flushIntervalMs: 50 });
    const ref = await startReferenceApp({ dk });
    const post = (p: string, body: unknown) => fetch(ref.url + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    for (let i = 0; i < 5; i++) await post("/login", { user: "ops", password: "wrong" });
    await dk.close(); await ref.close();
    await fetch(`${base}/ingest/events`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${dbKey}` }, body: JSON.stringify({ source_event_id: "db-q-1", occurred_at: now().toISOString(), asset_ids: ["checkout-db"], action: "data_access", outcome: "success", actor_ref: "svc-checkout" }) });
    while (store.processBatch().processed) { /* drain */ }
    const finding = store.listFindings("trial").find((f) => f.kind === "repeated_auth_failure")!;
    expect(finding.affected_asset_ids).toEqual(["checkout"]);

    // 2) the human view and the agent get the same supporting evidence
    const human = (await app.inject({ url: `/api/projects/trial/findings/${finding.id}/evidence`, headers: H })).json();
    const mcp = createServer(new DkClient({ baseUrl: base, token: agentToken, project: "trial" }));
    const [a, b] = InMemoryTransport.createLinkedPair();
    const agent = new Client({ name: "trial-agent", version: "1" });
    await Promise.all([mcp.connect(a), agent.connect(b)]);
    const call = async (name: string, args: Record<string, unknown> = {}) => { const t = ((await agent.callTool({ name, arguments: args })).content as { text: string }[])[0]!.text; try { return JSON.parse(t); } catch { throw new Error(`${name}: ${t.slice(0, 400)}`); } };
    const agentView = await call("dk_get_finding", { id: finding.id });
    const ids = (evs: { id: string }[]) => evs.map((e) => e.id).sort();
    expect(ids(agentView.events)).toEqual(ids(human.events));
    expect(Object.keys(agentView.evidence.records).sort()).toEqual(Object.keys(human.evidence).sort());
    expect(agentView.completeness.complete).toBe(true);
    expect(human.complete).toBe(true);

    // 3) a source outage becomes visible to both
    clock += 10 * 60_000; // db-audit silent for 10 minutes (> 300 s)
    store.evaluateProject("trial");
    const cov = await call("dk_coverage");
    expect(cov.coverage.find((c: { source_id: string }) => c.source_id === "db-audit").state).toBe("degraded");
    expect(store.listFindings("trial").some((f) => f.kind === "coverage_loss")).toBe(true);

    // 4) unknown targets remain unknown
    const unknown = await call("dk_assess_change", { asset_ids: ["checkout-apii"] });
    expect(unknown.posture).toBe("not_assessed");
    const mixed = await call("dk_assess_change", { asset_ids: ["checkout-api", "payments-gw"] });
    expect(["hold", "insufficient_context"]).toContain(mixed.posture);
    expect(mixed.targets_unresolved).toBe(1);

    // 5) acknowledged-but-unprocessed events survive a restart
    const ack = await fetch(`${base}/ingest/events`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${dbKey}` }, body: JSON.stringify({ source_event_id: "db-q-2", occurred_at: now().toISOString(), asset_ids: ["checkout-db"], action: "data_access", outcome: "success", actor_ref: "svc-checkout" }) });
    expect(ack.status).toBe(202);
    await agent.close(); await app.close(); store.db.close();
    ({ store, app } = await boot());
    while (store.processBatch().processed) { /* drain */ }
    expect(store.listEvents("trial").some((e) => e.source_event_id === "db-q-2")).toBe(true);
    base = await app.listen({ port: 0, host: "127.0.0.1" });

    // 6) a proposed response changes nothing, even once a human approves it
    const snapshot = () => JSON.stringify({ e: store.listEvents("trial").length, f: store.listFindings("trial").map((f) => [f.id, f.revision]), s: store.listSources("trial") });
    const before = snapshot();
    const mcp2 = createServer(new DkClient({ baseUrl: base, token: agentToken, project: "trial" }));
    const [c, d] = InMemoryTransport.createLinkedPair();
    const agent2 = new Client({ name: "trial-agent", version: "1" });
    await Promise.all([mcp2.connect(c), agent2.connect(d)]);
    const pt = ((await agent2.callTool({ name: "dk_propose_containment", arguments: { finding_id: finding.id, action_id: "edge.tighten_rate_limit", rationale: "Repeated failed logins against checkout in the trial." } })).content as { text: string }[])[0]!.text;
    let proposal: { status: string; id: string };
    try { proposal = JSON.parse(pt).request; } catch { throw new Error(pt.slice(0, 400)); }
    expect(proposal.status).toBe("pending");
    expect((await app.inject({ method: "POST", url: `/api/projects/trial/containment/${proposal.id}/decision`, headers: { authorization: `Bearer ${agentToken}` }, payload: { decision: "approved" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/projects/trial/containment/${proposal.id}/decision`, headers: H, payload: { decision: "approved" } })).json().status).toBe("approved");
    expect(snapshot()).toBe(before);
    await agent2.close(); await app.close();
  }, 60_000);
});
