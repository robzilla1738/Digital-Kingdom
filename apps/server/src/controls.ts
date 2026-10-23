import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { HttpError } from "./store.ts";

/**
 * Control inventory and verification records (roadmap R07.1).
 *
 * A control (a WAF rule, a policy deny, a tool-gateway allowlist, an MFA requirement) is DECLARED with its scope
 * and a config digest. Its state comes only from verification records:
 *   declared    no test yet
 *   configured  the provider reports it present, but no behavioural evidence
 *   tested      the latest test passed under the current config digest and has not expired
 *   failed      the latest conclusive test failed
 *   stale       a passing test exists but the config changed or the test expired
 *   unknown     the latest test was inconclusive (for example the observer was unavailable)
 * "Configured" is never "effective". Positive and negative results keep their conditions.
 */
export type ControlState = "declared" | "configured" | "tested" | "failed" | "stale" | "unknown";
export interface ControlRow { id: string; project_id: string; name: string; kind: string; asset_ids: string; scope: string; policy_version: string; config_digest: string; configured_evidence: string | null; created_at: string; updated_at: string }
export interface TestRow { id: string; control_id: string; outcome: "pass" | "fail" | "inconclusive"; config_digest: string; conditions: string; observer: string; observer_available: number; evidence_refs: string; run_at: string; expires_at: string; recorded_by: string }

export const CONTROLS_MIGRATION = `CREATE TABLE controls (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, asset_ids TEXT NOT NULL, scope TEXT NOT NULL, policy_version TEXT NOT NULL, config_digest TEXT NOT NULL, configured_evidence TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE control_tests (id TEXT PRIMARY KEY, control_id TEXT NOT NULL REFERENCES controls(id), outcome TEXT NOT NULL CHECK (outcome IN ('pass','fail','inconclusive')), config_digest TEXT NOT NULL, conditions TEXT NOT NULL, observer TEXT NOT NULL, observer_available INTEGER NOT NULL, evidence_refs TEXT NOT NULL, run_at TEXT NOT NULL, expires_at TEXT NOT NULL, recorded_by TEXT NOT NULL);
   CREATE TABLE control_history (control_id TEXT NOT NULL, at TEXT NOT NULL, actor TEXT NOT NULL, change TEXT NOT NULL);
   CREATE INDEX control_tests_by_control ON control_tests (control_id, run_at);`;

const KINDS = ["waf_rule", "network_policy", "iam_deny", "tool_allowlist", "mfa_requirement", "rate_limit", "egress_filter", "other"];
const s = (v: unknown, name: string, max: number) => { if (typeof v !== "string" || !v.trim() || v.length > max) throw new HttpError(400, `${name} is required (at most ${max} characters)`); return v.trim(); };

export class Controls {
  constructor(private readonly db: DatabaseSync, private readonly now: () => Date) {}
  private iso() { return this.now().toISOString(); }

  upsert(projectId: string, b: Record<string, unknown>, actor: string, assetExists: (id: string) => boolean) {
    const name = s(b.name, "name", 120), kind = s(b.kind, "kind", 40);
    if (!KINDS.includes(kind)) throw new HttpError(400, `kind must be one of ${KINDS.join(", ")}`);
    const assets = Array.isArray(b.asset_ids) ? b.asset_ids.map(String).slice(0, 50) : [];
    if (!assets.length || assets.some((a) => !assetExists(a))) throw new HttpError(422, "asset_ids must name existing assets");
    const scope = s(b.scope, "scope", 500), policyVersion = s(b.policy_version, "policy_version", 80);
    const config = b.config === undefined ? null : b.config;
    const digest = typeof b.config_digest === "string" && /^sha256:[0-9a-f]{64}$/.test(b.config_digest) ? b.config_digest : `sha256:${createHash("sha256").update(JSON.stringify(config ?? { policyVersion, scope })).digest("hex")}`;
    const id = typeof b.id === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(b.id) ? b.id : `ctl_${randomUUID().slice(0, 12)}`;
    const cur = this.db.prepare("SELECT * FROM controls WHERE id = ? AND project_id = ?").get(id, projectId) as unknown as ControlRow | undefined;
    const configured = typeof b.configured_evidence === "string" ? b.configured_evidence.slice(0, 400) : cur?.configured_evidence ?? null;
    if (cur) {
      this.db.prepare("UPDATE controls SET name = ?, kind = ?, asset_ids = ?, scope = ?, policy_version = ?, config_digest = ?, configured_evidence = ?, updated_at = ? WHERE id = ?").run(name, kind, JSON.stringify(assets), scope, policyVersion, digest, configured, this.iso(), id);
      if (cur.config_digest !== digest || cur.policy_version !== policyVersion) this.db.prepare("INSERT INTO control_history (control_id, at, actor, change) VALUES (?, ?, ?, ?)").run(id, this.iso(), actor, `config ${cur.config_digest.slice(0, 19)} -> ${digest.slice(0, 19)}, policy ${cur.policy_version} -> ${policyVersion}: earlier tests no longer apply`);
    } else {
      this.db.prepare("INSERT INTO controls (id, project_id, name, kind, asset_ids, scope, policy_version, config_digest, configured_evidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, projectId, name, kind, JSON.stringify(assets), scope, policyVersion, digest, configured, this.iso(), this.iso());
      this.db.prepare("INSERT INTO control_history (control_id, at, actor, change) VALUES (?, ?, ?, ?)").run(id, this.iso(), actor, "declared");
    }
    return this.get(projectId, id);
  }

  recordTest(projectId: string, controlId: string, b: Record<string, unknown>, actor: string) {
    const c = this.row(projectId, controlId);
    const outcome = String(b.outcome);
    if (!["pass", "fail", "inconclusive"].includes(outcome)) throw new HttpError(400, "outcome must be pass, fail or inconclusive");
    const observer = s(b.observer, "observer", 120);
    const available = b.observer_available !== false;
    const conditions = s(b.conditions, "conditions (what was tried, from where, against what)", 1000);
    const days = typeof b.valid_days === "number" && b.valid_days >= 1 && b.valid_days <= 365 ? b.valid_days : 30;
    const runAt = typeof b.run_at === "string" && !Number.isNaN(Date.parse(b.run_at)) ? new Date(b.run_at).toISOString() : this.iso();
    // A pass with no available observer is not evidence of enforcement.
    const stored = !available && outcome === "pass" ? "inconclusive" : outcome;
    const refs = Array.isArray(b.evidence_refs) ? b.evidence_refs.map(String).slice(0, 50) : [];
    const id = `ctt_${randomUUID().slice(0, 12)}`;
    this.db.prepare("INSERT INTO control_tests (id, control_id, outcome, config_digest, conditions, observer, observer_available, evidence_refs, run_at, expires_at, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, c.id, stored, typeof b.config_digest === "string" ? b.config_digest : c.config_digest, conditions, observer, available ? 1 : 0, JSON.stringify(refs), runAt, new Date(Date.parse(runAt) + days * 86_400_000).toISOString(), actor);
    return { test_id: id, recorded_outcome: stored, ...(stored !== outcome ? { note: "The observer was unavailable, so a pass was recorded as inconclusive." } : {}), control: this.get(projectId, controlId) };
  }

  private row(projectId: string, id: string) {
    const r = this.db.prepare("SELECT * FROM controls WHERE id = ? AND project_id = ?").get(id, projectId) as unknown as ControlRow | undefined;
    if (!r) throw new HttpError(404, "control not found");
    return r;
  }

  stateOf(c: ControlRow): { state: ControlState; reason: string; latest_test: TestRow | null } {
    const tests = this.db.prepare("SELECT * FROM control_tests WHERE control_id = ? ORDER BY run_at DESC").all(c.id) as unknown as TestRow[];
    const latest = tests[0] ?? null;
    const now = this.iso();
    if (!latest) return c.configured_evidence ? { state: "configured", reason: `present per ${c.configured_evidence}; no behavioural test, so not shown as effective`, latest_test: null } : { state: "declared", reason: "declared only; never tested", latest_test: null };
    if (latest.outcome === "inconclusive") return { state: "unknown", reason: latest.observer_available ? "latest test was inconclusive" : `latest test was inconclusive: observer ${latest.observer} was unavailable`, latest_test: latest };
    if (latest.outcome === "fail") return { state: latest.config_digest === c.config_digest ? "failed" : "stale", reason: latest.config_digest === c.config_digest ? "latest test failed under the current configuration" : "the failing test predates a configuration change; retest", latest_test: latest };
    if (latest.config_digest !== c.config_digest) return { state: "stale", reason: "configuration changed after the last passing test", latest_test: latest };
    if (latest.expires_at <= now) return { state: "stale", reason: `the passing test expired at ${latest.expires_at}`, latest_test: latest };
    return { state: "tested", reason: `passed under the current configuration (${latest.conditions.slice(0, 120)})`, latest_test: latest };
  }

  get(projectId: string, id: string) {
    const c = this.row(projectId, id);
    const st = this.stateOf(c);
    const tests = (this.db.prepare("SELECT * FROM control_tests WHERE control_id = ? ORDER BY run_at DESC LIMIT 50").all(c.id) as unknown as TestRow[]).map((t) => ({ id: t.id, outcome: t.outcome, conditions: t.conditions, observer: t.observer, observer_available: !!t.observer_available, applies_to_current_config: t.config_digest === c.config_digest, evidence_refs: JSON.parse(t.evidence_refs), run_at: t.run_at, expires_at: t.expires_at, recorded_by: t.recorded_by }));
    const history = this.db.prepare("SELECT at, actor, change FROM control_history WHERE control_id = ? ORDER BY at").all(c.id);
    return { id: c.id, name: c.name, kind: c.kind, asset_ids: JSON.parse(c.asset_ids), scope: c.scope, policy_version: c.policy_version, config_digest: c.config_digest, configured_evidence: c.configured_evidence, state: st.state, state_reason: st.reason, effective_claimed: st.state === "tested", tests, history };
  }

  list(projectId: string) {
    return (this.db.prepare("SELECT * FROM controls WHERE project_id = ? ORDER BY name").all(projectId) as unknown as ControlRow[]).map((c) => { const st = this.stateOf(c); return { id: c.id, name: c.name, kind: c.kind, asset_ids: JSON.parse(c.asset_ids), state: st.state, state_reason: st.reason }; });
  }
}
