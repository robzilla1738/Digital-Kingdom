/**
 * LP31 — the integrated local loop, end to end on one candidate (no model call, no network beyond 127.0.0.1):
 *
 *   blueprint world (saas-storefront, LW-01) → finite scenario (LP07) → case + guided contract (LP08/LP10)
 *   → scripted bring-your-agent investigation over the real stdio focused MCP profile (LP09/LP24, C3 investigation-read)
 *   → evidence + claim checks (every cited record exists in the case project; LP25 referee grades claims against
 *     private truth the investigator never saw) → repair candidates (LP14 generator on the same case; recorded as returned)
 *   → lease (LP20) → typed local repair (LP21, set_gateway_policy under the supervisor lease) → independent effect
 *     verification (LP22) → regression capture + model-free replay (LP23) → link to the case and a castle comparison
 *     (LP19/LP23 executed-local list) → evidence-only capsule export + import on a fresh instance (LP28)
 *   → an exact-candidate receipt (git HEAD, dirty flag, runtime, per-stage digests and outcomes).
 *
 * Seams, stated rather than hidden: the repair runs in a second disposable supervisor run of the SAME blueprint with the
 * same deliberately weak tenant-API defect (the LW-01 world is started without leased lab actions, so it cannot be
 * repaired in place); the LP14 generator reasons over the analysis model, and for this world it may return no candidate
 * that maps to the reviewed local action — the receipt records exactly what it returned, and the typed action executed is
 * the reviewed `set_gateway_policy` on `api`, which the investigation's boundary-violation finding points at.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildApp } from "../../apps/server/src/app.ts";
import { openDb } from "../../apps/server/src/db.ts";
import { Store } from "../../apps/server/src/store.ts";
import { captureRegression, canonicalJson, EffectVerifier, type VerificationProbe } from "../../packages/local-world/src/index.ts";
import { weakStorefront } from "../../examples/reference-app/repair-lab.ts";
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
  started_at: string; ended_at: string; model: { used: false; spend_usd: 0; ai_loop: "not_exercised_in_this_run" };
  scope: "local_only_synthetic"; stages: LoopStage[]; seams: string[]; ok: boolean;
}

export async function runIntegratedLoop(): Promise<LoopReceipt> {
  const started = new Date().toISOString();
  const stages: LoopStage[] = [];
  const cleanups: (() => Promise<void> | void)[] = [];
  const add = (s: LoopStage) => { stages.push(s); return s; };
  let c: LocalCase | null = null;
  try {
    // 1-2. blueprint world + finite scenario + case (+ guided contract/job)
    const doc = JSON.parse(readFileSync(join(ROOT, "scenarios/local-world/dsl/LW-01.scenario.json"), "utf8"));
    c = await startLocalCase(doc);
    const events = await c.storedEvents();
    add({ stage: "world_and_scenario", outcome: c.private.result.status, digest: c.private.intended_digest,
      detail: { blueprint: doc.blueprint, scenario: doc.id, world_revision: c.private.world.world.revision ?? null, steps: doc.steps.length, stored_events: events.length } });
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

    // 5. repair candidates (LP14) on the same case, recorded exactly as returned
    const state = await c.adminApi("GET", `/api/projects/${c.public.project}/analysis/state`);
    const gen = await c.adminApi("POST", `/api/projects/${c.public.project}/cases/${c.public.case_id}/repairs`, {
      base_state_hash: state.json?.state_hash,
      objective: { prohibited: [{ id: "cross-tenant-path", kind: "path", from: "ingress", to: "tenant-db" }], permitted: [{ id: "edge-to-api", kind: "path", from: "ingress", to: "api" }] },
    });
    const cands = (gen.json?.candidates ?? []) as { candidate_id: string; valid: boolean; template: { id: string }; plan?: { actions?: { type: string; target_resource_id: string }[] } }[];
    add({ stage: "repair_candidates", outcome: gen.status === 200 ? `${cands.filter((x) => x.valid).length} valid of ${cands.length}` : `http_${gen.status}`,
      detail: { http: gen.status, candidates: cands.map((x) => ({ id: x.candidate_id, valid: x.valid, template: x.template?.id, actions: x.plan?.actions?.map((a) => `${a.type}@${a.target_resource_id}`) ?? [] })), error: gen.status === 200 ? null : String(gen.json?.error ?? "").slice(0, 300) } });

    // 6-8. lease → typed local repair → independent verification (second disposable run of the same blueprint + defect)
    const s = await weakStorefront(cleanups, "lp31-integrated");
    const h = { "x-world-session": s.sessionA };
    const probes: VerificationProbe[] = [
      { id: "cross-tenant-read", expectation: "prohibited", request: { resource: "ingress", method: "GET", path: "/tenants/tenant-b/records", headers: h }, effect: { observer: "audit", resource: "tenant-db" } },
      { id: "own-tenant-read", expectation: "permitted", request: { resource: "ingress", method: "GET", path: "/tenants/tenant-a/records", headers: h }, effect: { observer: "audit", resource: "tenant-db" } },
    ];
    const v = new EffectVerifier(s.run, s.sup.issue(s.run.run_id, { resources: "*", actions: ["request_route", "read_effects"] }));
    const before = await v.observe(probes, { repeats: 1 });
    const plan = s.plan([s.action({ id: "a1", target_resource_id: "api", type: "set_gateway_policy", parameters: { policy_ref: "policy:baseline" } })], { case_id: "case-lp31", verification_test_ids: ["cross-tenant-read"], positive_control_ids: ["own-tenant-read"] });
    const lease = s.lease(plan);
    add({ stage: "lease", outcome: "issued", detail: { scoped_to_plan: plan.plan_id, run: "disposable supervisor run", operator_held_by: "launcher (not the investigator)" } });
    const execution = await s.controller().execute(lease.token, plan);
    add({ stage: "typed_local_repair", outcome: String((execution as { outcome?: string }).outcome ?? "executed"), digest: sha(execution), detail: { actions: plan.actions.map((a) => `${a.type}@${a.target_resource_id}`), repair_operations_recorded: s.repairOps().length } });
    let verification = await v.verify({ plan, execution, probes, before });
    await s.run.stop(s.operatorToken); s.run.cleanup();
    verification = v.finalize(verification);
    add({ stage: "independent_verification", outcome: String(verification.whole_run.outcome), digest: sha(verification), detail: { security_verdict: (verification as { security_verdict?: string }).security_verdict ?? null, verifier: "EffectVerifier (separate identity, observed effects)" } });

    // 9. regression capture + model-free replay
    const regression = captureRegression({ world: s.run.world, blueprint: "saas-storefront", blueprint_version: 1, seed: "lp31-integrated",
      defect: [{ resource_id: "api", setting: "policy_variant", value: "deliberately_weak" }], principals: [{ ref: "principal-1", account: "acct:tenant-a:user", headers: h }],
      probes, plan, execution, verification, lesson: "The tenant API must refuse a tenant-a session reading tenant-b records while tenant-a reads keep working (repair: tenant API policy back to baseline).",
      case_id: "case-lp31", control_ids: ["ctl-tenant-isolation"], secrets: [s.sessionA, s.sessionB, s.operatorToken, s.ctl] });
    const replay = await replayRegression(regression);
    add({ stage: "regression_capture_and_replay", outcome: String((replay as { outcome?: string }).outcome ?? (replay as { status?: string }).status ?? "replayed"), digest: regression.descriptor_digest, detail: { regression_id: regression.regression_id, replay_llm: regression.replay.llm } });

    // 10. link to the investigated case + castle comparison (executed-local list)
    const P = `/api/projects/${c.public.project}`;
    const cmp = await c.adminApi("POST", `${P}/analysis/comparisons`, { base_state_hash: state.json?.state_hash, label: "LP31 integrated repair", changes: [{ op: "modify", kind: "source", authority: c.public.project, id: (await c.adminApi("GET", `${P}/sources`)).json?.[0]?.id ?? "none", attrs: { disabled: true } }] });
    const link = await c.adminApi("POST", `${P}/cases/${c.public.case_id}/local-repairs`, { verification, regression, ...(cmp.status === 200 ? { comparison_id: cmp.json.id } : {}) });
    const world = cmp.status === 200 ? await c.adminApi("GET", `${P}/analysis/comparisons/${cmp.json.id}/world`) : null;
    add({ stage: "case_link_and_castle_comparison", outcome: link.status === 200 && world?.status === 200 ? "linked" : `link_${link.status}_comparison_${cmp.status}`,
      detail: { link_http: link.status, comparison_http: cmp.status, comparison_mode: world?.json?.mode ?? null, executed_local: (world?.json?.executed_local?.results ?? []).map((r: { whole_run: string; verified: boolean; scope: string }) => `${r.whole_run}/${r.verified ? "verified" : "not_verified"}/${r.scope}`), error: link.status === 200 ? null : String(link.json?.error ?? "").slice(0, 300) } });

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
    for (const f of cleanups.splice(0).reverse()) await f();
    await c?.stop();
  }
  const status = git("status", "--porcelain");
  const required: Record<string, (o: string) => boolean> = {
    world_and_scenario: (o) => o === "complete", investigation_focused_mcp: (o) => o === "complete", evidence_and_claim_checks: (o) => o === "passed",
    independent_verification: (o) => o === "success", case_link_and_castle_comparison: (o) => o === "linked", capsule_export_import: (o) => o === "imported",
  };
  return {
    schema: "dk.local.integrated_loop_receipt.v1", candidate: { commit: git("rev-parse", "HEAD"), dirty: status === null ? null : status.length > 0, node: process.version, platform: `${process.platform}-${process.arch}` },
    started_at: started, ended_at: new Date().toISOString(), model: { used: false, spend_usd: 0, ai_loop: "not_exercised_in_this_run" }, scope: "local_only_synthetic", stages,
    seams: [
      "Repair, verification and regression run in a second disposable supervisor run of the same blueprint (saas-storefront) with the same deliberately weak tenant-API defect; the LW-01 investigation world has no leased lab actions.",
      "The LP14 generator reasons over the analysis model; its output for this case is recorded as returned. The executed typed action is the reviewed set_gateway_policy on api.",
      "The castle comparison's model-only change is a placeholder source toggle used to open the comparison; only its executed-local list carries the verified repair.",
    ],
    ok: Object.entries(required).every(([k, f]) => { const s = stages.find((x) => x.stage === k); return !!s && f(s.outcome); }),
  };
}
