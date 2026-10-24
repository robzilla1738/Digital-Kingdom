import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { refuseTarget, runLabTest } from "./src/lab/runner.ts";
import { compileWorld, instantiateBlueprint, RunRefusal, Supervisor } from "@dk/local-world";

/**
 * LP05 negative test for the R07.2 runner (reproduced before the change): its loopback host allowlist accepts ANY
 * local listener, including one the lab never created, and its aggregate observer counter is not per-operation.
 * The runner is kept for its existing control tests but its receipts now say that target ownership was not
 * verified; run-owned targets go through the supervisor, which cannot even address an unowned listener.
 */
describe("LP05: the URL-allowlist runner does not establish target ownership", () => {
  it("refuseTarget admits an unrelated 127.0.0.1 service (the defect), and receipts now label ownership unverified", async () => {
    const stranger = createServer((_q, s) => { s.writeHead(200, { "content-type": "application/json" }).end("{}"); });
    await new Promise<void>((r) => stranger.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(stranger.address() as { port: number }).port}`;
    try {
      expect(refuseTarget({ target: { url, environment: "lab" }, approved_environments: ["lab"], allowed_hosts: ["127.0.0.1"] })).toBeNull();
      let n = 0;
      const r = await runLabTest({ test_id: "t", target: { url, environment: "lab" }, approved_environments: ["lab"], allowed_hosts: ["127.0.0.1"], probes: [{ name: "pc", method: "GET", path: "/", expect: "allowed", positive_control: true }], budget: { max_requests: 2, max_ms: 2000 }, observer: { name: "counter", snapshot: () => ++n, available: () => true } });
      expect(r.target_ownership).toBe("unverified_url_allowlist");
      expect(r.conditions).toMatch(/target ownership not verified/);
      expect(r.outcome).toBe("pass"); // an unowned stranger "passes": exactly why ownership must come from the supervisor
    } finally { stranger.close(); }
  });

  it("the supervisor has no way to address that same listener", async () => {
    const sup = new Supervisor({ services: {} as never });
    // a world whose templates have no implementation never starts, and no API accepts a URL or port as a target
    await expect(sup.start(compileWorld(instantiateBlueprint("saas-storefront", { seed: "x" })))).rejects.toBeInstanceOf(RunRefusal);
  });
});
