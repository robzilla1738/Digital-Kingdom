import { canonicalJson, validateRepairVerification, type RepairVerification } from "@dk/contracts";
import { checkRegression, compileWorld, instantiateBlueprint, regressionValidity, type RepairRegression } from "@dk/local-world";
import { sha256 } from "./security.ts";
import { HttpError, type Store } from "./store.ts";

/**
 * LP23 server linkage of executed local repairs. A `dk.local.repair_verification.v1` (LP22) and, optionally, the
 * `dk.local.repair_regression.v1` captured from it are linked to a case (and to the LP13/LP19 comparison they test),
 * append-only, with their digests. The server executes nothing: it validates and records what the local lab produced.
 *
 * - Case closure: a linked verification that is not a whole-run success, or a regression whose validation went stale,
 *   blocks closing until a person accepts it as an explicit unknown with a reason (recorded in the closure).
 * - Staleness propagation: `check` re-evaluates every linked regression against the world compiled by the current code
 *   and the tool/artifact versions reported by the lab; a changed relevant version marks the old validation stale.
 * - LP19: verifications linked to a comparison appear in its world view's executed-local list, separate from the
 *   model-only results; only a whole-run success is `verified`.
 */
export const LOCAL_REPAIR_MIGRATION = `CREATE TABLE local_repair_links (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, case_id TEXT NOT NULL, comparison_id TEXT, kind TEXT NOT NULL, ref TEXT, body TEXT NOT NULL, digest TEXT NOT NULL, status TEXT NOT NULL, stale_reasons TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL); CREATE INDEX local_repair_links_case ON local_repair_links(project_id, case_id);`;
interface Row { id: string; project_id: string; case_id: string; comparison_id: string | null; kind: "verification" | "regression"; ref: string | null; body: string; digest: string; status: string; stale_reasons: string | null; created_by: string; created_at: string }

export function executedLocalFor(store: Store, projectId: string, comparisonId: string) {
  const rows = store.db.prepare("SELECT * FROM local_repair_links WHERE project_id = ? AND comparison_id = ? AND kind = 'verification' ORDER BY created_at, id").all(projectId, comparisonId) as unknown as Row[];
  return rows.map((r) => {
    const v = JSON.parse(r.body) as RepairVerification;
    return {
      link_id: r.id, case_id: r.case_id, verification_digest: r.digest, run_id: v.run_id, plan_digest: v.plan_digest, execution_state: v.execution.state,
      tested_target_revision: v.verification_receipt.tested_target_revision, security_verdict: v.security_verdict, whole_run: v.whole_run.outcome,
      residual_access: v.residual_access, disruption: v.disruption, cleanup: v.cleanup.outcome, unassessed_paths: v.verification_receipt.unassessed_paths,
      executed: true, verified: v.whole_run.success, scope: v.scope, basis: "independent local effect verification (LP22)",
    };
  });
}

export class LocalRepairs {
  constructor(private readonly store: Store) {}
  private get db() { return this.store.db; }
  private now() { return this.store.now().toISOString(); }
  private caseRow(projectId: string, caseId: string) {
    const c = this.db.prepare("SELECT status FROM cases WHERE id = ? AND project_id = ?").get(caseId, projectId) as { status: string } | undefined;
    if (!c) throw new HttpError(404, "no such case");
    return c;
  }

  link(projectId: string, caseId: string, b: Record<string, unknown>, actor: string) {
    return this.store.transaction(() => {
      if (this.caseRow(projectId, caseId).status === "closed") throw new HttpError(409, "the case is closed; reopen it before linking a local repair");
      const vr = validateRepairVerification(b.verification);
      if (!vr.ok || !vr.value) throw new HttpError(422, `verification must be a valid dk.local.repair_verification.v1: ${vr.errors.slice(0, 5).join("; ")}`, vr.errors);
      const v = vr.value;
      const vdigest = sha256(canonicalJson(v));
      let comparison: string | null = null;
      if (b.comparison_id !== undefined) {
        if (typeof b.comparison_id !== "string" || !this.db.prepare("SELECT 1 FROM analysis_comparisons WHERE project_id = ? AND id = ?").get(projectId, b.comparison_id)) throw new HttpError(404, "comparison_id names no comparison in this project");
        comparison = b.comparison_id;
      }
      let reg: RepairRegression | null = null;
      if (b.regression !== undefined) {
        const rc = checkRegression(b.regression);
        if (!rc.ok) throw new HttpError(422, `regression refused: ${rc.errors.slice(0, 5).join("; ")}`, rc.errors);
        reg = rc.value;
        if (reg.linkage.verification_digest !== vdigest) throw new HttpError(422, "the regression was not captured from this verification (verification digest differs)");
      }
      if (this.db.prepare("SELECT 1 FROM local_repair_links WHERE project_id = ? AND case_id = ? AND digest = ?").get(projectId, caseId, vdigest)) throw new HttpError(409, "this verification is already linked to the case");
      const id = (k: string) => `lr_${sha256(`${projectId}:${caseId}:${k}:${this.now()}:${Math.random()}`).slice(0, 12)}`;
      const ins = this.db.prepare("INSERT INTO local_repair_links (id, project_id, case_id, comparison_id, kind, ref, body, digest, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const vid = id("v");
      ins.run(vid, projectId, caseId, comparison, "verification", v.plan_digest, canonicalJson(v), vdigest, v.whole_run.outcome, actor, this.now());
      let rid: string | null = null;
      if (reg) { rid = id("r"); ins.run(rid, projectId, caseId, comparison, "regression", reg.regression_id, canonicalJson(reg), reg.descriptor_digest, "valid", actor, this.now()); }
      this.store.audit(actor, "case.local_repair_linked", projectId, caseId, { verification: vid, regression: rid, whole_run: v.whole_run.outcome, comparison });
      return this.list(projectId, caseId);
    });
  }

  list(projectId: string, caseId: string) {
    this.caseRow(projectId, caseId);
    const rows = this.db.prepare("SELECT * FROM local_repair_links WHERE project_id = ? AND case_id = ? ORDER BY created_at, id").all(projectId, caseId) as unknown as Row[];
    return {
      case_id: caseId,
      verifications: rows.filter((r) => r.kind === "verification").map((r) => { const v = JSON.parse(r.body) as RepairVerification; return { link_id: r.id, digest: r.digest, comparison_id: r.comparison_id, run_id: v.run_id, plan_digest: v.plan_digest, security_verdict: v.security_verdict, whole_run: v.whole_run.outcome, verified: v.whole_run.success, residual_access: v.residual_access, disruption: v.disruption, cleanup: v.cleanup.outcome, scope: v.scope }; }),
      regressions: rows.filter((r) => r.kind === "regression").map((r) => { const d = JSON.parse(r.body) as RepairRegression; return { link_id: r.id, regression_id: d.regression_id, descriptor_digest: r.digest, comparison_id: r.comparison_id, validation: r.status, stale_reasons: r.stale_reasons ? JSON.parse(r.stale_reasons) as string[] : [], lesson: d.lesson, controls: d.probes.map((p) => ({ id: p.id, control: p.control })), control_ids: d.linkage.control_ids, versions: d.versions, residual_uncertainty: d.residual_uncertainty, replay: d.replay }; }),
      closure_blockers: this.closureBlockers(projectId, caseId),
    };
  }

  /** Re-check every linked regression of the project against the current code's world and the reported tool/artifact versions. */
  check(projectId: string, b: Record<string, unknown>, actor: string) {
    const tools = b.tools && typeof b.tools === "object" ? b.tools as Record<string, string> : undefined;
    const artifacts = b.artifacts && typeof b.artifacts === "object" ? b.artifacts as Record<string, string> : undefined;
    const rows = this.db.prepare("SELECT * FROM local_repair_links WHERE project_id = ? AND kind = 'regression' ORDER BY created_at, id").all(projectId) as unknown as Row[];
    return this.store.transaction(() => rows.map((r) => {
      const d = JSON.parse(r.body) as RepairRegression;
      const world = compileWorld(instantiateBlueprint(d.world.blueprint, { seed: d.world.seed }));
      const v = regressionValidity(d, { world, ...(tools ? { tools } : {}), ...(artifacts ? { artifacts } : {}) });
      // stale is sticky: an old validation never becomes current again by itself; a new replay must be linked
      const status = r.status === "stale" || v.status === "stale" ? "stale" : "valid";
      const reasons = [...new Set([...(r.stale_reasons ? JSON.parse(r.stale_reasons) as string[] : []), ...v.changed])];
      if (status !== r.status || reasons.length !== (r.stale_reasons ? (JSON.parse(r.stale_reasons) as string[]).length : 0)) {
        this.db.prepare("UPDATE local_repair_links SET status = ?, stale_reasons = ? WHERE id = ?").run(status, reasons.length ? JSON.stringify(reasons) : null, r.id);
        if (status === "stale") this.store.audit(actor, "case.local_regression_stale", projectId, r.case_id, { regression: d.regression_id, changed: v.changed });
      }
      return { link_id: r.id, case_id: r.case_id, regression_id: d.regression_id, validation: status, changed: reasons };
    }));
  }

  /** Raw linked documents for a case capsule (LP28): regressions are synthetic descriptors; verifications carry no secrets. */
  documents(projectId: string, caseId: string) {
    const rows = this.db.prepare("SELECT kind, body FROM local_repair_links WHERE project_id = ? AND case_id = ? ORDER BY created_at, id").all(projectId, caseId) as { kind: string; body: string }[];
    return { regressions: rows.filter((r) => r.kind === "regression").map((r) => JSON.parse(r.body) as unknown), verifications: rows.filter((r) => r.kind === "verification").map((r) => JSON.parse(r.body) as unknown) };
  }

  /** What must be accepted as an explicit unknown before the case can close. */
  closureBlockers(projectId: string, caseId: string) {
    const rows = this.db.prepare("SELECT * FROM local_repair_links WHERE project_id = ? AND case_id = ?").all(projectId, caseId) as unknown as Row[];
    return rows.flatMap((r) => {
      if (r.kind === "verification" && r.status !== "success") return [{ ref: r.id, reason: `local verification is ${r.status}, not a verified repair` }];
      if (r.kind === "regression" && r.status === "stale") return [{ ref: r.id, reason: `regression validation is stale: ${(JSON.parse(r.stale_reasons ?? "[]") as string[]).join(", ")}` }];
      return [];
    });
  }
}
