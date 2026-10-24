import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startLocalCase, type LocalCase } from "../local/controller.ts";

/**
 * LP26.1 — in a local run the guided contract's coverage obligations must reflect the observers that were actually
 * live. li-m6-c2c34916 C3 reported every coverage obligation `unavailable` ("3 minute(s) with no capable live
 * observer") although the effect observer was registered and reporting, so C3 could never answer not_observed.
 * Causes: (1) the case interval began 60 s before the world (and its observers) existed and ended 120 s in the future;
 * (2) coverage history called a source "silent for more than 600s" between its registration and its first receipt
 * milliseconds later. Truly uncovered time must still make the obligation unavailable.
 */
const ROOT = join(import.meta.dirname, "../..");
const doc = (id: string) => JSON.parse(readFileSync(join(ROOT, `scenarios/local-world/dsl/${id}.scenario.json`), "utf8"));
const open: LocalCase[] = [];
afterEach(async () => { for (const c of open.splice(0)) await c.stop(); });

type Obligation = { id: string; kind: string; status: string; reason: string; target: { asset_id: string; action: string } };
const coverage = async (c: LocalCase) => {
  const v = await c.adminApi("GET", `/api/projects/${c.public.project}/cases/${c.public.case_id}/contract`);
  expect(v.status).toBe(200);
  return (v.json.contract.obligations as Obligation[]).filter((o) => o.kind === "coverage");
};

describe("LP26.1: local-run coverage reflects live observers", () => {
  it("the effect observer's coverage obligation is satisfied when the observer was live for the whole case interval", async () => {
    const c = await startLocalCase(doc("LW-03")); open.push(c);
    const cov = await coverage(c);
    const effect = cov.find((o) => o.target.asset_id === "deploy-data" && o.target.action === "data_access")!;
    expect(effect, JSON.stringify(cov.map((o) => [o.id, o.status]))).toBeDefined();
    expect(effect.status, effect.reason).toBe("satisfied");
    // the case interval holds every stored record and does not extend into the future or before the world existed
    const { after, before } = c.public.interval;
    for (const e of await c.storedEvents()) {
      expect(Date.parse(String(e.occurred_at))).toBeGreaterThanOrEqual(Date.parse(after));
      expect(Date.parse(String(e.received_at))).toBeLessThanOrEqual(Date.parse(before));
    }
    expect(Date.parse(before)).toBeLessThanOrEqual(Date.now());
    const sources = c.productStore.listSources(c.public.project);
    expect(Date.parse(after)).toBeGreaterThanOrEqual(Math.max(...sources.map((s) => Date.parse(s.created_at))));
  }, 90_000);

  it("an observer that was not live (disabled for the interval) still leaves the obligation unavailable", async () => {
    const c = await startLocalCase(doc("LW-03")); open.push(c);
    const p = c.public.project;
    const off = await c.adminApi("POST", `/api/projects/${p}/sources/use-observer/state`, { disabled: true, expected_revision: 1, reason: "LP26.1 negative control", effective_at: c.public.interval.after });
    expect(off.status, JSON.stringify(off.json)).toBe(200);
    expect((await c.adminApi("POST", `/api/projects/${p}/cases/${c.public.case_id}/contract`, {})).status).toBeLessThan(300);
    const job = await c.adminApi("POST", `/api/projects/${p}/cases/${c.public.case_id}/jobs`, {});
    expect(job.status, JSON.stringify(job.json)).toBeLessThan(300);
    for (let i = 0; i < 10; i++) { const a = await c.adminApi("POST", `/api/projects/${p}/jobs/${job.json.id}/advance`, { max_units: 20 }); if (!["queued", "running"].includes(a.json.job.status)) break; }
    const effect = (await coverage(c)).find((o) => o.target.asset_id === "deploy-data" && o.target.action === "data_access")!;
    expect(effect.status).toBe("unavailable");
  }, 90_000);

  it("the v1 interval (60 s before the world existed, 120 s into the future) is still honestly unavailable", async () => {
    const c = await startLocalCase(doc("LW-03"), { legacyInterval: true }); open.push(c);
    const effect = (await coverage(c)).find((o) => o.target.asset_id === "deploy-data" && o.target.action === "data_access")!;
    expect(effect.status).toBe("unavailable");
  }, 90_000);
});
