/**
 * LP31 — the integrated local loop, end to end on one candidate and in ONE leased world (no model call, no network
 * beyond 127.0.0.1):
 *
 *   blueprint world (saas-storefront, LW-01) on a supervisor with leased lab actions → finite scenario (LP07) → case +
 *   guided contract (LP08/LP10) → scripted bring-your-agent investigation over the real stdio focused MCP profile
 *   (LP09/LP24, C3 investigation-read) → evidence + claim checks (every cited record exists in the case project; LP25
 *   referee grades claims against private truth the investigator never saw) → investigator token revoked → the
 *   launcher reports the run's declared enforcement-point configuration → LP14 generates reviewable candidates → the
 *   rank-1 generated plan, unmodified, is leased (LP20) and executed as a typed local repair (LP21) in the same run →
 *   independent effect verification (LP22) → regression capture + model-free replay (LP23) → link to the case and the
 *   LP13/LP19 castle comparison of that executed candidate's own change list → post-repair model check → evidence-only
 *   capsule export + import on a fresh instance (LP28) → an exact-candidate receipt (git HEAD, dirty flag, runtime,
 *   per-stage digests and outcomes).
 *
 * The lease is still required for the typed action; the default investigation world (no `lab` option) stays plan-only.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildApp } from "../../apps/server/src/app.ts";
import { openDb } from "../../apps/server/src/db.ts";
import { Store } from "../../apps/server/src/store.ts";
import { captureRegression, canonicalJson, EffectVerifier, RepairController, type VerificationProbe } from "../../packages/local-world/src/index.ts";
import type { RepairPlan } from "../../packages/contracts/src/index.ts";
import { replayRegression } from "../../examples/reference-app/src/lab/regression-replay.ts";
import { startLocalCase, type LocalCase } from "./controller.ts";
import { connectScoped } from "./recorder.ts";
import { scriptedInvestigate } from "./scripted.ts";
import { answerKey, gradeAnswer } from "./referee.ts";

const ROOT = join(import.meta.dirname, "../..");
const sha = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : canonicalJson(v)).digest("hex");
const git = (...a: string[]) => { try { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return null; } };

export interface LoopStage { stage: string; outcome: string; digest?: string; detail: Record<string, unknown> }
export interface LoopReceipt {
  schema: "dk.local.integrated_loop_receipt.v1"; candidate: { commit: string | null; dirty: boolean | null; node: string; platform: string };
  run: { run_id: string | null; lab_actions: "leased"; single_run: boolean };
  started_at: string; ended_at: string; model: { used: false; spend_usd: 0; ai_loop: "not_exercised_in_this_run" };
  scope: "local_only_synthetic"; stages: LoopStage[]; seams: string[]; ok: boolean;
}

export async function runIntegratedLoop(): Promise<LoopReceipt> {
  const started = new Date().toISOString();
  const stages: LoopStage[] = [];
  const add = (s: LoopStage) => { stages.push(s); return s; };
  let c: LocalCase | null = null;
  let runId: string | null = null;
  try {
    // 1-2. blueprint world + finite scenario + case (+ guided contract/job)
    const doc = JSON.parse(readFileSync(join(ROOT, "scenarios/local-world/dsl/LW-01.scenario.json"), "utf8"));
    c = await startLocalCase(doc, { lab: "leased" });
    runId = c.private.world.run.run_id;
    const events = await c.storedEvents();
    add({ stage: "world_and_scenario", outcome: c.private.result.status, digest: c.private.intended_digest,
      detail: { run_id: c.private.world.run.run_id, blueprint: doc.blueprint, scenario: doc.id, world_revision: c.private.world.world.revision ?? null, steps: doc.steps.length, stored_events: events.length } });
    add({ stage: "case_and_guided_contract", outcome: String(c.guided.job_status), detail: { case_id: c.public.case_id, readiness: c.guided.readiness, units: c.guided.units, contract_revision: c.guided.contract_revision } });

    // 3. scripted bring-your-agent investigation through the focused, read-only MCP profile (real stdio transport)
    const m = await connectScoped(c.public, "C3");
    let inv;
    try { inv = await scriptedInvestigate(m, c.public, "saas-storefront"); }
    finally { await m.close(); }
    const toolCalls = m.recorder.entries.filter((e) => e.kind === "tool_call").length;
    add({ stage: "investigation_focused_mcp", outcome: inv.complete ? "complete" : "incomplete", digest: sha(inv.answer),
      detail: { profile: "investigation-read (C3)", tools: [...m.tools].sort(), tool_calls: toolCalls, retrieved: inv.retrieved, operations: inv.answer.operations.length, write_tools_offered: m.tools.some((t) => /open_contract|run_step|propose/.test(t)) } });

    // 4. evidence + claim checks: every cited record is a stored record of this case's project; the referee grades claims
    const ids = new Set(events.map((e) => String(e.id)));
    const cited = inv.answer.operations.flatMap((o) => o.evidence);
    const missing = cited.filter((x) => !ids.has(x));
    const score = gradeAnswer(answerKey("saas-storefront", c.private.doc, c.private.truth, c.private.world.world), inv.answer);
    add({ stage: "evidence_and_claim_checks", outcome: missing.length === 0 && score.structured.passed === score.structured.eligible && score.unsupported_affirmatives === 0 ? "passed" : "failed",
      detail: { cited_records: cited.length, cited_missing: missing.length, claims_passed: score.structured.passed, claims_eligible: score.structured.eligible, unsupported_affirmatives: score.unsupported_affirmatives, boundary_violations_reported: inv.answer.operations.filter((o) => o.boundary_violation === "yes").length, referee: "LP25 private-truth referee (investigator never sees it)" } });

    // 5. repair candidates (LP14) on the same case. The investigator's token is revoked first; then the supervisor side
    //    (the launcher, holding the run's operator token) reports the run's declared configuration of its enforcement
    //    points, and the generator proposes reviewable typed candidates from the analysis model.
    c.revokeInvestigator();
    const P = `/api/projects/${c.public.project}`;
    const w = c.private.world, run = w.run, lab = c.private.lab!;
    const cfg = await c.adminApi("POST", `${P}/local-configuration`, run.configuration(w.operatorToken));
    const state = await c.adminApi("GET", `${P}/analysis/state`);
    const baseHash = String(state.json?.state_hash);
    const objective = {
      prohibited: [{ id: "cross-tenant-read", kind: "tenant_access", from: "ingress", to: "tenant-db", tenant: "tenant-a", target_tenant: "tenant-b" }],
      permitted: [{ id: "own-tenant-read", kind: "tenant_access", from: "ingress", to: "tenant-db", tenant: "tenant-a", target_tenant: "tenant-a" }],
    };
    const gen = await c.adminApi("POST", `${P}/cases/${c.public.case_id}/repairs`, { base_state_hash: baseHash, objective });
    type Cand = { candidate_id: string; rank: number; valid: boolean; template: { id: string }; plan: RepairPlan; patch: { changes: unknown[] }; analysis: { candidate_state_hash: string } };
    const cands = (gen.json?.candidates ?? []) as Cand[];
    const chosen = cands.find((x) => x.valid && x.rank === 1) ?? null;
    const actionsOf = (pl: RepairPlan) => pl.actions.map((a) => `${a.type}@${a.target_resource_id} ${Object.values(a.parameters).join(",")}`);
    add({ stage: "repair_candidates", outcome: gen.status === 200 ? `${cands.filter((x) => x.valid).length} valid of ${cands.length}` : `http_${gen.status}`,
      detail: { http: gen.status, status: gen.json?.status ?? null, config_snapshot_http: cfg.status, investigator_revoked_before_repair: (await fetch(`${c.public.url}${P}/cases/${c.public.case_id}`, { headers: { authorization: `Bearer ${c.public.token}` } })).status === 401,
        base_state_hash: baseHash, objective, candidates: cands.map((x) => ({ id: x.candidate_id, rank: x.rank, valid: x.valid, template: x.template?.id, actions: x.plan ? actionsOf(x.plan) : [] })),
        selected: chosen ? { candidate_id: chosen.candidate_id, rank: chosen.rank, template: chosen.template.id, actions: actionsOf(chosen.plan), plan_id: chosen.plan.plan_id, plan_digest: sha(chosen.plan) } : null,
        error: gen.status === 200 ? null : String(gen.json?.error ?? "").slice(0, 300) } });
    if (!chosen) throw new Error(`LP14 returned no valid rank-1 candidate: ${JSON.stringify(stages.at(-1)!.detail).slice(0, 600)}`);

    // 6-8. lease → typed local repair → independent verification, in the SAME run the investigation read
    const plan = chosen.plan;
    const ctl = w.supervisor.issueControllerToken(lab.operator, run.run_id);
    const sessionA = await w.login("acct:tenant-a:user");
    const h = { "x-world-session": sessionA };
    const probes: VerificationProbe[] = [
      { id: "cross-tenant-read", expectation: "prohibited", request: { resource: "ingress", method: "GET", path: "/tenants/tenant-b/records", headers: h }, effect: { observer: "audit", resource: "tenant-db" } },
      { id: "own-tenant-read", expectation: "permitted", request: { resource: "ingress", method: "GET", path: "/tenants/tenant-a/records", headers: h }, effect: { observer: "audit", resource: "tenant-db" } },
    ];
    const v = new EffectVerifier(run, w.supervisor.issue(run.run_id, { resources: "*", actions: ["request_route", "read_effects"] }));
    const before = await v.observe(probes, { repeats: 1 });
    const lease = w.supervisor.issueLease(lab.operator, { run_id: run.run_id, plan, controller_token: ctl });
    add({ stage: "lease", outcome: "issued", detail: { run_id: run.run_id, lease_id: lease.lease.lease_id, scoped_to_plan: plan.plan_id, plan_digest: sha(plan), operator_held_by: "launcher (not the investigator)", supervisor_lab_actions: "leased" } });
    const execution = await new RepairController(run, ctl).execute(lease.token, plan);
    add({ stage: "typed_local_repair", outcome: String((execution as { outcome?: string }).outcome ?? "executed"), digest: sha(execution),
      detail: { run_id: (execution as { run_id?: string }).run_id ?? null, plan_digest: sha(plan), plan_source: "LP14 generated candidate (rank 1), unmodified", actions: actionsOf(plan), repair_operations_recorded: run.truth.filter((t) => t.record.event === "repair_operation").length } });
    let verification = await v.verify({ plan, execution, probes, before });
    const after = run.configuration(w.operatorToken);
    await w.flush();
    await w.stop(); // stop + clean the run before finalizing: whole-run success needs the run's cleanup record
    verification = v.finalize(verification);
    add({ stage: "independent_verification", outcome: String(verification.whole_run.outcome), digest: sha(verification), detail: { run_id: verification.run_id, security_verdict: (verification as { security_verdict?: string }).security_verdict ?? null, verifier: "EffectVerifier (separate identity, observed effects)" } });

    // 9. regression capture + model-free replay (replay runs in its own fresh disposable world from the descriptor)
    const regression = captureRegression({ world: run.world, blueprint: "saas-storefront", blueprint_version: 1, seed: String(c.private.doc.seed),
      defect: [{ resource_id: "api", setting: "policy_variant", value: "deliberately_weak" }], principals: [{ ref: "principal-1", account: "acct:tenant-a:user", headers: h }],
      probes, plan, execution, verification, lesson: "The tenant API must refuse a tenant-a session reading tenant-b records while tenant-a reads keep working (repair: tenant API policy back to baseline).",
      case_id: plan.case_id, control_ids: ["ctl-tenant-isolation"], secrets: [sessionA, w.operatorToken, ctl, lab.operator] });
    const replay = await replayRegression(regression);
    add({ stage: "regression_capture_and_replay", outcome: String((replay as { outcome?: string }).outcome ?? (replay as { status?: string }).status ?? "replayed"), digest: regression.descriptor_digest, detail: { run_id: verification.run_id, regression_id: regression.regression_id, replay_llm: regression.replay.llm } });

    // 10. link to the investigated case + the castle comparison of the EXECUTED candidate's own LP13 change list
    const cmp = await c.adminApi("POST", `${P}/analysis/comparisons`, { base_state_hash: baseHash, label: `LP31 executed candidate ${chosen.candidate_id} (${chosen.plan.plan_id})`, changes: chosen.patch.changes });
    const link = await c.adminApi("POST", `${P}/cases/${c.public.case_id}/local-repairs`, { verification, regression, ...(cmp.status === 200 ? { comparison_id: cmp.json.id } : {}) });
    const world = cmp.status === 200 ? await c.adminApi("GET", `${P}/analysis/comparisons/${cmp.json.id}/world`) : null;
    const stored = cmp.status === 200 ? await c.adminApi("GET", `${P}/analysis/comparisons/${cmp.json.id}`) : null;
    add({ stage: "case_link_and_castle_comparison", outcome: link.status === 200 && world?.status === 200 ? "linked" : `link_${link.status}_comparison_${cmp.status}`,
      detail: { link_http: link.status, comparison_http: cmp.status, comparison_id: cmp.json?.id ?? null, base_state_hash: cmp.json?.base_state_hash ?? null, comparison_mode: world?.json?.mode ?? null,
        changes_equal_executed_candidate: !!stored && canonicalJson(stored.json.proposal.changes) === canonicalJson(chosen.patch.changes),
        changes: (world?.json?.changes ?? []).map((x: { key: string }) => x.key), rooms: (world?.json?.rooms ?? []).map((x: { asset_id: string; change: string }) => `${x.asset_id}:${x.change}`),
        executed_local: (world?.json?.executed_local?.results ?? []).map((r: { whole_run: string; verified: boolean; scope: string }) => `${r.whole_run}/${r.verified ? "verified" : "not_verified"}/${r.scope}`), error: link.status === 200 ? null : String(link.json?.error ?? "").slice(0, 300) } });

    // 10b. the model agrees after the executed repair: the run's post-repair configuration needs no repair for the objective
    const cfg2 = await c.adminApi("POST", `${P}/local-configuration`, after);
    const state2 = await c.adminApi("GET", `${P}/analysis/state`);
    const gen2 = await c.adminApi("POST", `${P}/cases/${c.public.case_id}/repairs`, { base_state_hash: state2.json?.state_hash, objective });
    add({ stage: "post_repair_model_check", outcome: gen2.status === 200 ? String(gen2.json.status) : `http_${gen2.status}`, detail: { config_snapshot_http: cfg2.status, api_policy_after: after.resources.find((x) => x.resource_id === "api")?.policy_variant ?? null } });

    // 11. evidence-only capsule + import on a fresh instance
    const cap = await c.adminApi("POST", `${P}/cases/${c.public.case_id}/capsule`, {});
    let imported: { status: number; json: any } | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (cap.status === 200) {
      const store = new Store(openDb(":memory:"));
      const admin = store.createToken("lp31 importer", "admin").token;
      const app = await buildApp({ store, secret: "lp31-other-instance", demoMode: false, webDist: "/nonexistent" });
      try { const r = await app.inject({ method: "POST", url: "/api/capsules/import", headers: { authorization: `Bearer ${admin}` }, payload: { archive_base64: cap.json.archive_base64 } }); imported = { status: r.statusCode, json: r.json() }; }
      finally { await app.close(); store.db.close(); }
    }
    const archiveText = cap.status === 200 ? Buffer.from(cap.json.archive_base64, "base64").toString("base64") : "";
    add({ stage: "capsule_export_import", outcome: imported?.status === 200 ? "imported" : `export_${cap.status}_import_${imported?.status ?? "skipped"}`, digest: cap.status === 200 ? sha(cap.json.archive_base64) : undefined,
      detail: { kind: cap.json?.manifest?.kind ?? null, entries: (cap.json?.manifest?.entries ?? []).map((e: { role: string }) => e.role), evidence_refs: cap.json?.manifest?.evidence_refs?.length ?? 0,
        reimported_refs_equal: imported?.status === 200 ? canonicalJson(imported.json.evidence_refs) === canonicalJson(cap.json.manifest.evidence_refs) : false,
        signature_on_other_instance: imported?.json?.checks?.signature ?? null, canary_absent: !archiveText.includes(c.private.canary) && !(cap.json ? JSON.stringify(cap.json.manifest) : "").includes(c.private.canary) } });
  } finally {
    await c?.stop();
  }
  const status = git("status", "--porcelain");
  const required: Record<string, (o: string) => boolean> = {
    world_and_scenario: (o) => o === "complete", investigation_focused_mcp: (o) => o === "complete", evidence_and_claim_checks: (o) => o === "passed",
    repair_candidates: (o) => /^[1-9]\d* valid of /.test(o), typed_local_repair: (o) => o !== "failed", post_repair_model_check: (o) => o === "no_repair_needed",
    independent_verification: (o) => o === "success", case_link_and_castle_comparison: (o) => o === "linked", capsule_export_import: (o) => o === "imported",
  };
  // one run: every stage that names a run names the investigated run, and the repair stages all ran
  const runStages = ["world_and_scenario", "lease", "typed_local_repair", "independent_verification", "regression_capture_and_replay"];
  const singleRun = runId !== null && runStages.every((k) => stages.find((x) => x.stage === k)?.detail.run_id === runId);
  return {
    schema: "dk.local.integrated_loop_receipt.v1", run: { run_id: runId, lab_actions: "leased", single_run: singleRun }, candidate: { commit: git("rev-parse", "HEAD"), dirty: status === null ? null : status.length > 0, node: process.version, platform: `${process.platform}-${process.arch}` },
    started_at: started, ended_at: new Date().toISOString(), model: { used: false, spend_usd: 0, ai_loop: "not_exercised_in_this_run" }, scope: "local_only_synthetic", stages,
    seams: [
      "One run: the LW-01 investigation world is started on a supervisor with leased lab actions; the launcher keeps the one-time operator credential and the investigator's token is revoked before any repair step. Every typed action still needs a lease scoped to the exact plan.",
      "The executed plan is the LP14 generator's rank-1 candidate, unmodified (plan digest recorded at generation, lease and execution). The generator is model-only over the run's declared configuration snapshot (dk.local.config_snapshot.v1) and the declared graph; its tenant-policy semantics (dk.local.tenant_policy_model.v1) are a model of the reviewed local templates, and only the LP22 independent verification is executed evidence.",
      "The castle comparison is the executed candidate's own LP13 change list on the generation baseline; the regression replay runs in its own fresh disposable world from the captured descriptor (that is what a regression is).",
    ],
    ok: singleRun && Object.entries(required).every(([k, f]) => { const s = stages.find((x) => x.stage === k); return !!s && f(s.outcome); }),
  };
}
