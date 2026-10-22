import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DigitalKingdom } from "@dk/sdk-node";
import { startReferenceApp } from "./src/app.ts";
import { setup } from "../../apps/server/test/helpers.ts";

/**
 * Live local end-to-end (ACCEPTANCE §E): real benign actions against an isolated reference app produce
 * real source events through authenticated ingestion -> journal -> normalization -> findings. Nothing is
 * posted to the renderer directly.
 */
describe("reference app end-to-end", () => {
  it("benign and controlled actions become evidence-linked findings in the correct room", async () => {
    const ctx = await setup();
    const { app, admin, h, store } = ctx;
    await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "ref", name: "Reference app", dataset_kind: "live" } });
    const graph = await app.inject({ method: "POST", url: "/api/projects/ref/graph?format=manifest&revision=r1", headers: { ...h(admin), "content-type": "application/yaml" },
      payload: "project: ref\nenvironment: local\nassets:\n  - {id: edge, name: local-edge, kind: edge}\n  - {id: checkout, name: checkout-api, kind: service, owner: payments}\n  - {id: db, name: checkout-db, kind: database}\nrelationships:\n  - {from: edge, to: checkout}\n  - {from: checkout, to: db, kind: reads_from}\n" });
    expect(graph.statusCode, graph.body).toBe(200);
    const { key } = (await app.inject({ method: "POST", url: "/api/projects/ref/sources", headers: h(admin), payload: { id: "checkout-sdk", label: "checkout-api security events", kind: "app_security", asset_ids: ["checkout"], trusts_request_ids: true } })).json();
    const base = await app.listen({ port: 0, host: "127.0.0.1" });
    const dk = new DigitalKingdom({ url: base, sourceKey: key, sessionSalt: randomUUID(), flushIntervalMs: 50 });
    const ref = await startReferenceApp({ dk });
    const post = (p: string, body: unknown) => fetch(ref.url + p, { method: "POST", headers: { "content-type": "application/json", "x-request-id": "forged-by-public" }, body: JSON.stringify(body) });

    expect((await fetch(ref.url + "/orders")).status).toBe(200); // normal request
    expect((await fetch(ref.url + "/orders?q=1'+OR+1=1")).status).toBe(400); // rejected suspicious input
    for (let i = 0; i < 5; i++) await post("/login", { user: "ops", password: "wrong" }); // repeated failures
    expect((await post("/login", { user: "ops", password: "wrong" })).status).toBe(429); // rate limit engaged
    const alice = await (await post("/login", { user: "alice", password: "correct-horse" })).json();
    expect((await post("/admin/roles", { session: alice.session, grant: "admin" })).status).toBe(403); // denied escalation

    await dk.close();
    while (store.processBatch().processed) { /* drain */ }
    const events = store.listEvents("ref");
    expect(events.length).toBe(10);
    expect(events.every((e) => e.asset_ids[0] === "checkout" && e.dataset_kind === "live")).toBe(true);
    expect(events.some((e) => e.request_id === "forged-by-public")).toBe(false); // public header never trusted
    expect(JSON.stringify(events)).not.toMatch(/correct-horse|"ops"|"alice"/); // pseudonymized, no passwords
    const kinds = store.listFindings("ref").map((f) => f.kind).sort();
    expect(kinds).toEqual(["blocked_request_reported", "repeated_auth_failure"]);
    expect(dk.stats.dropped).toBe(0);
    await ref.close(); await app.close();
  });
});
