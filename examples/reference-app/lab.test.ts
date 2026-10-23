import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { DigitalKingdom } from "@dk/sdk-node";
import { startReferenceApp } from "./src/app.ts";
import { runLabTest, type LabTest } from "./src/lab/runner.ts";

/** R07.2 isolated lab runner against the owned reference app. */
async function lab() {
  let reads = 0;
  const dk = new DigitalKingdom({ url: "http://127.0.0.1:9", sourceKey: "unused", sessionSalt: "lab", fetchImpl: (async () => new Response("{}", { status: 202 })) as typeof fetch, flushIntervalMs: 60_000 });
  const ref = await startReferenceApp({ dk, onDbRead: () => { reads++; } });
  const base = (over: Partial<LabTest> = {}): LabTest => ({
    test_id: "lab-1", control_id: "input-filter", target: { url: ref.url, environment: "lab" }, approved_environments: ["lab"], allowed_hosts: ["127.0.0.1"],
    probes: [
      { name: "benign-orders", method: "GET", path: "/orders", headers: { "x-demo-user": "lab" }, expect: "allowed", positive_control: true },
      { name: "sqli-or", method: "GET", path: "/orders?q=1'+OR+1=1", expect: "blocked" },
      { name: "sqli-union", method: "GET", path: "/orders?q=x+union+select+1", expect: "blocked" },
    ],
    budget: { max_requests: 10, max_ms: 5000 }, observer: { name: "db read counter", snapshot: () => reads, available: () => true },
    cleanup: async () => ({ ok: true, detail: "no state created" }), ...over,
  });
  return { ref, base, stop: async () => { await ref.close(); await dk.close(); } };
}

describe("R07.2 lab runner", () => {
  it("prohibited inputs are blocked while legitimate work still functions", async () => {
    const t = await lab();
    try {
      const r = await runLabTest(t.base());
      expect(r.outcome, JSON.stringify(r)).toBe("pass");
      expect(r.probes.map((p) => `${p.name}:${p.status}:${p.effect_observed}`)).toEqual(["benign-orders:200:true", "sqli-or:400:false", "sqli-union:400:false"]);
      expect(r.conditions).toMatch(/3\/3 probes .* in lab; observer db read counter/);
    } finally { await t.stop(); }
  });

  it("cannot target an unapproved environment, production, or an arbitrary external address", async () => {
    const t = await lab();
    try {
      expect((await runLabTest(t.base({ target: { url: t.ref.url, environment: "staging" } }))).reasons[0]).toMatch(/not an approved lab environment/);
      expect((await runLabTest(t.base({ target: { url: t.ref.url, environment: "prod" }, approved_environments: ["prod"] }))).reasons[0]).toMatch(/production environments can never/);
      expect((await runLabTest(t.base({ target: { url: "https://example.com", environment: "lab" }, allowed_hosts: ["example.com"] }))).reasons[0]).toMatch(/neither loopback nor/);
      expect((await runLabTest(t.base({ target: { url: "http://10.0.0.5", environment: "lab" } }))).outcome).toBe("refused");
      expect((await runLabTest(t.base({ probes: [{ name: "x", method: "GET", path: "http://evil.example/", expect: "allowed", positive_control: true }] }))).outcome).toBe("refused");
    } finally { await t.stop(); }
  });

  it("failed cleanup, aborts and budget exhaustion stay visible as partial outcomes", async () => {
    const t = await lab();
    try {
      const failedCleanup = await runLabTest(t.base({ cleanup: async () => ({ ok: false, detail: "temporary rule could not be removed" }) }));
      expect(failedCleanup.cleanup).toEqual({ ran: true, ok: false, detail: "temporary rule could not be removed" });
      expect(failedCleanup.reasons.join(" ")).toMatch(/cleanup failed/);
      const budget = await runLabTest(t.base({ budget: { max_requests: 2, max_ms: 5000 } }));
      expect(budget).toMatchObject({ outcome: "inconclusive", requests_used: 2 });
      expect(budget.reasons.join(" ")).toMatch(/request budget 2 reached.*partial run/);
      const ac = new AbortController(); ac.abort();
      const aborted = await runLabTest(t.base({ signal: ac.signal }));
      expect(aborted).toMatchObject({ aborted: true, outcome: "inconclusive", cleanup: { ran: true, ok: true } });
    } finally { await t.stop(); }
  });

  it("an availability failure is never mistaken for enforcement", async () => {
    const down = createServer((_q, s) => { s.writeHead(503).end(); });
    await new Promise<void>((r) => down.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(down.address() as { port: number }).port}`;
    try {
      const t = await lab();
      const r = await runLabTest(t.base({ target: { url, environment: "lab" } }));
      expect(r.outcome).toBe("inconclusive");
      expect(r.probes.every((p) => p.verdict === "inconclusive")).toBe(true);
      expect(r.reasons.join(" ")).toMatch(/positive control did not succeed/);
      const unobserved = await runLabTest(t.base({ observer: { name: "db read counter", snapshot: () => 0, available: () => false } }));
      expect(unobserved.outcome).toBe("inconclusive");
      await t.stop();
    } finally { down.close(); }
  });
});
