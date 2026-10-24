import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runIntegratedLoop } from "../local/integrated-loop.ts";
import { startLocalCase } from "../local/controller.ts";

/**
 * LP31-A1: one scripted run covers launch, incident, investigation, repair, verification and export on the same candidate
 * and in ONE leased world: the LP14 candidate the generator returned is the plan that is leased, executed and verified, and
 * the castle comparison is that candidate's own LP13 change list. No model.
 */
describe("LP31-A1: integrated local loop", () => {
  it("blueprint world → scenario → focused-MCP investigation → evidence/claim checks → generated candidate → lease → typed repair → independent verification → regression → comparison of the executed candidate → capsule, all in one run", async () => {
    const r = await runIntegratedLoop();
    const by = Object.fromEntries(r.stages.map((s) => [s.stage, s]));
    expect(r.stages.map((s) => s.stage)).toEqual(["world_and_scenario", "case_and_guided_contract", "investigation_focused_mcp", "evidence_and_claim_checks", "repair_candidates", "lease", "typed_local_repair", "independent_verification", "regression_capture_and_replay", "case_link_and_castle_comparison", "post_repair_model_check", "capsule_export_import"]);
    expect(by.world_and_scenario!.outcome).toBe("complete");
    expect(by.investigation_focused_mcp!.outcome).toBe("complete");
    expect(by.investigation_focused_mcp!.detail.write_tools_offered).toBe(false);
    expect(by.investigation_focused_mcp!.detail.tool_calls as number).toBeGreaterThan(1);
    expect(by.evidence_and_claim_checks!.outcome, JSON.stringify(by.evidence_and_claim_checks!.detail)).toBe("passed");
    expect(by.evidence_and_claim_checks!.detail.cited_missing).toBe(0);
    expect(by.evidence_and_claim_checks!.detail.boundary_violations_reported as number).toBeGreaterThan(0);

    // (1) the generator returns reviewable candidates for this local world, and the executed plan IS the rank-1 candidate
    const cand = by.repair_candidates!;
    expect(cand.outcome, JSON.stringify(cand.detail)).toBe("2 valid of 2");
    expect(cand.detail.status).toBe("candidates");
    expect(cand.detail.investigator_revoked_before_repair).toBe(true);
    expect(cand.detail.selected).toMatchObject({ candidate_id: "c1", rank: 1, template: "restore-reviewed-policy", actions: ["set_gateway_policy@api policy:baseline"] });
    expect(by.lease!.detail.plan_digest).toBe((cand.detail.selected as { plan_digest: string }).plan_digest);
    expect(by.typed_local_repair!.detail.plan_digest).toBe((cand.detail.selected as { plan_digest: string }).plan_digest);
    expect(by.typed_local_repair!.detail.plan_source).toBe("LP14 generated candidate (rank 1), unmodified");

    // (2) one leased world: the investigated run is the repaired, verified and regression-captured run
    expect(r.run.lab_actions).toBe("leased");
    expect(r.run.single_run).toBe(true);
    for (const s of ["world_and_scenario", "lease", "typed_local_repair", "independent_verification", "regression_capture_and_replay"]) expect(by[s]!.detail.run_id, s).toBe(r.run.run_id);
    expect(by.independent_verification!.outcome).toBe("success");
    expect(by.regression_capture_and_replay!.detail.replay_llm).toBe("not_used");

    // (3) the castle comparison is the executed candidate's own change list on the generation baseline
    const cmp = by.case_link_and_castle_comparison!;
    expect(cmp.outcome, JSON.stringify(cmp.detail)).toBe("linked");
    expect(cmp.detail.changes_equal_executed_candidate).toBe(true);
    expect(cmp.detail.base_state_hash).toBe(cand.detail.base_state_hash);
    expect((cmp.detail.changes as string[]).map((k) => k.replace(/\|[^|]*\|/, "|*|"))).toEqual(["policy|*|api#policy"]);
    expect(cmp.detail.rooms).toEqual(["api:changed"]);
    expect(cmp.detail.executed_local).toEqual(["success/verified/local_run_only"]);
    expect(by.post_repair_model_check!.outcome).toBe("no_repair_needed");

    expect(by.capsule_export_import!.outcome, JSON.stringify(by.capsule_export_import!.detail)).toBe("imported");
    expect(by.capsule_export_import!.detail.reimported_refs_equal).toBe(true);
    expect(by.capsule_export_import!.detail.canary_absent).toBe(true);
    expect(r.seams.join(" ")).not.toMatch(/second disposable|placeholder/);
    expect(r.model).toEqual({ used: false, spend_usd: 0, ai_loop: "not_exercised_in_this_run" });
    expect(r.candidate.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(r.ok).toBe(true);
  }, 120_000);

  it("the default investigation world stays plan-only (no operator credential, no lease can be issued)", async () => {
    const doc = JSON.parse(readFileSync(join(import.meta.dirname, "../../scenarios/local-world/dsl/LW-01.scenario.json"), "utf8"));
    const c = await startLocalCase(doc, { guided: false });
    try {
      expect(c.private.lab).toBeNull();
      const sup = c.private.world.supervisor, runId = c.private.world.run.run_id;
      const op = sup.operatorCredential(); // even with the operator credential, a plan-only supervisor issues no lease
      const ctl = sup.issueControllerToken(op, runId);
      expect(() => sup.issueLease(op, { run_id: runId, plan: {}, controller_token: ctl } as never)).toThrow(/plan-only/);
    } finally { await c.stop(); }
  }, 60_000);
});
