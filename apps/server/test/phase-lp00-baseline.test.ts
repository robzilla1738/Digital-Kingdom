import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compare, currentDigests, FROZEN_TREES, MANIFEST, ROOT, type TreeDigest } from "../../../scripts/phase-frozen-digests.ts";
import { plannerFromEnv } from "../src/planner-model.ts";
import { setup } from "./helpers.ts";

/** Local Intelligence Phase LP00: baseline recovery, frozen history and local-only runtime defaults. */
const phase = (p: string) => join(ROOT, "docs/phases/local-intelligence", p);

describe("LP00 phase ledger and frozen history", () => {
  it("LP00-A1: the ledger records the recovered baseline and an explicit (not automatic) rebase decision", () => {
    const status = JSON.parse(readFileSync(phase("STATUS.json"), "utf8"));
    expect(status.schema).toBe("dk.local_phase.status.v1");
    expect(status.baseline.recovered_head).toMatch(/^[0-9a-f]{40}$/);
    expect(status.baseline.package_baseline).toBe("9fec7ed24dea46157af8a7c0ef09bee77c2ffa88");
    expect(status.baseline.working_tree_at_recovery).toBeTruthy();
    expect(status.baseline.rebase_decision).toMatch(/explicit/i);
    // the previous roadmap ledger is kept alongside, not replaced
    expect(status.previous_ledgers).toContain("docs/roadmap/STATUS.json");
    expect(existsSync(join(ROOT, "docs/roadmap/STATUS.json"))).toBe(true);
    // every acceptance id in the package is mapped, and nothing passed without executed evidence
    const acceptance = JSON.parse(readFileSync(phase("package/ACCEPTANCE.json"), "utf8")).requirements as { id: string }[];
    const ledgerReqs = status.requirements as Record<string, { status: string; evidence: string[] }>;
    expect(Object.keys(ledgerReqs).sort()).toEqual(acceptance.map((a) => a.id).sort());
    for (const [id, r] of Object.entries(ledgerReqs)) {
      expect(["not_run", "passed_local", "failed", "deferred", "not_exercised", "blocked"], id).toContain(r.status);
      if (r.status === "passed_local") expect(r.evidence.length, `${id} passed without evidence`).toBeGreaterThan(0);
    }
    // deferred external gates stay deferred, never passed
    for (const d of status.deferrals as { id: string; status: string }[]) expect(d.status).toBe("deferred_by_owner");
  });

  it("LP00-A2: historical evaluation and receipt trees are byte-identical to the bootstrap fingerprints", () => {
    const recorded = JSON.parse(readFileSync(join(ROOT, MANIFEST), "utf8")) as { recorded_at_head: string; trees: TreeDigest[] };
    expect(recorded.recorded_at_head).toBe("9fec7ed24dea46157af8a7c0ef09bee77c2ffa88");
    expect(recorded.trees.map((t) => t.path)).toEqual([...FROZEN_TREES]);
    for (const t of recorded.trees) expect(t.files, t.path).toBeGreaterThan(0);
    const current = currentDigests();
    expect(compare(recorded.trees, current)).toEqual([]);
    // the comparison actually detects a change (mutation check on the checker itself)
    const tampered = recorded.trees.map((t, i) => (i === 0 ? { ...t, sha256: "0".repeat(64) } : t));
    expect(compare(tampered, current)).toEqual([expect.stringMatching(/^artifacts\/completion: changed/)]);
  }, 90_000); // hashes every tracked file of the frozen trees (hundreds of screenshots); slow on a loaded 2-CPU runner
});

describe("LP00-A3 runtime defaults: no external access, no new provider calls, plan-only actions", () => {
  it("a default server reports every outbound path off and local actions plan-only", async () => {
    const ctx = await setup();
    const caps = (await ctx.app.inject({ url: "/api/capabilities", headers: ctx.h(ctx.viewer) })).json();
    expect(caps.runtime_policy).toMatchObject({
      schema: "dk.local_phase.runtime_policy.v1", defaults_hold: true,
      external_network: { default: "none", configured_outbound: [] },
      model_calls: { configured_routes: [], new_provider_calls: "none", inherited_budget_usd: 0 },
      local_actions: { mode: "plan_only", executor: "not_available", lease_required: true },
    });
  });

  it("the report is computed from configuration: a configured model route is disclosed, never hidden", async () => {
    const ctx = await setup({ planner: async () => "{}" });
    const caps = (await ctx.app.inject({ url: "/api/capabilities", headers: ctx.h(ctx.viewer) })).json();
    expect(caps.runtime_policy.defaults_hold).toBe(false);
    expect(caps.runtime_policy.model_calls.configured_routes).toEqual(["layout_planner_model"]);
  });

  it("no model client exists without explicit configuration", () => {
    expect(plannerFromEnv({})).toBeNull();
  });

  it("the evaluation runner refuses to call a model without an approved credential", () => {
    const out = mkdtempSync(join(tmpdir(), "dk-lp00-"));
    try {
      const env = { ...process.env }; delete env.AI_GATEWAY_API_KEY;
      const r = spawnSync(process.execPath, ["--import", "tsx", resolve(ROOT, "eval/src/run.ts"), "--mode", "dk", "--split", "dev", "--cases", "DK-T01", "--reps", "1", "--out", out], { cwd: ROOT, env, encoding: "utf8", timeout: 60_000 });
      expect(r.status).toBe(2);
      const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
      expect(manifest.model_execution).toMatch(/^BLOCKED: no approved model credential/);
      expect(existsSync(join(out, "summary.json"))).toBe(false);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });
});
