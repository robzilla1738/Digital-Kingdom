import { describe, expect, it } from "vitest";
import { runIntegratedLoop } from "../local/integrated-loop.ts";

/** LP31-A1: one scripted run covers launch, incident, investigation, repair, verification and export on the same candidate. No model. */
describe("LP31-A1: integrated local loop", () => {
  it("blueprint world → scenario → focused-MCP investigation → evidence/claim checks → candidates → lease → typed repair → independent verification → regression → comparison → capsule", async () => {
    const r = await runIntegratedLoop();
    const by = Object.fromEntries(r.stages.map((s) => [s.stage, s]));
    expect(r.stages.map((s) => s.stage)).toEqual(["world_and_scenario", "case_and_guided_contract", "investigation_focused_mcp", "evidence_and_claim_checks", "repair_candidates", "lease", "typed_local_repair", "independent_verification", "regression_capture_and_replay", "case_link_and_castle_comparison", "capsule_export_import"]);
    expect(by.world_and_scenario!.outcome).toBe("complete");
    expect(by.investigation_focused_mcp!.outcome).toBe("complete");
    expect(by.investigation_focused_mcp!.detail.write_tools_offered).toBe(false);
    expect(by.investigation_focused_mcp!.detail.tool_calls as number).toBeGreaterThan(1);
    expect(by.evidence_and_claim_checks!.outcome, JSON.stringify(by.evidence_and_claim_checks!.detail)).toBe("passed");
    expect(by.evidence_and_claim_checks!.detail.cited_missing).toBe(0);
    expect(by.evidence_and_claim_checks!.detail.boundary_violations_reported as number).toBeGreaterThan(0);
    expect(by.independent_verification!.outcome).toBe("success");
    expect(by.regression_capture_and_replay!.detail.replay_llm).toBe("not_used");
    expect(by.case_link_and_castle_comparison!.outcome, JSON.stringify(by.case_link_and_castle_comparison!.detail)).toBe("linked");
    expect(by.case_link_and_castle_comparison!.detail.executed_local).toEqual(["success/verified/local_run_only"]);
    expect(by.capsule_export_import!.outcome, JSON.stringify(by.capsule_export_import!.detail)).toBe("imported");
    expect(by.capsule_export_import!.detail.reimported_refs_equal).toBe(true);
    expect(by.capsule_export_import!.detail.canary_absent).toBe(true);
    expect(r.model).toEqual({ used: false, spend_usd: 0, ai_loop: "not_exercised_in_this_run" });
    expect(r.candidate.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(r.ok).toBe(true);
  }, 120_000);
});
