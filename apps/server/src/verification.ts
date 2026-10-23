import { randomBytes } from "node:crypto";
import type { SecurityEvent } from "@dk/contracts";
import { HttpError, type Store } from "./store.ts";
import type { ResponsePlan } from "./response-plan.ts";
import { credentialAftermath } from "./aftermath.ts";
import type { AuthSnapshot } from "./access/aws-policy.ts";

/**
 * Independent containment verification (roadmap R08.4). A provider saying "accepted" does not close anything.
 * After the propagation window, recorded observations from the plan's independent effect observers decide:
 *
 * - failed: the contained behaviour (the finding's actions by the finding's identities) still succeeds on a target,
 *   or a credential's descendants still hold authority, or the provider never accepted.
 * - inconclusive: no independent observer, an observer silent since the change, or a missing snapshot.
 * - pending: still inside the propagation window.
 * - verified: observers reported, the behaviour did not recur, and no residual authority is known, FOR THE TESTED
 *   SCOPE ONLY; every result names that scope and the paths it did not assess.
 * - compensated: an irreversible action whose failure was compensated by a recorded follow-up (not a success).
 *
 * Containment, service restoration and historical exposure are three separate conclusions. Legitimate traffic
 * vanishing from a target that its observer still reports on is a detected service disruption. Historical exposure
 * is never concluded here.
 */
/** Table (migration inline in db.ts): `CREATE TABLE containment_verifications (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, containment_id TEXT NOT NULL, state TEXT NOT NULL, result TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);` */

export type VerifyState = "pending" | "verified" | "failed" | "inconclusive" | "compensated";
export interface ProviderReport { provider_accepted: boolean; accepted_at: string; provider_ref?: string }
export interface VerifyInput {
  plan: Pick<ResponsePlan, "action_id" | "targets" | "blast_radius" | "verification">;
  finding: { affected_asset_ids: string[]; events: SecurityEvent[] };
  events: SecurityEvent[];
  sources: { id: string; asset_ids: string[] }[];
  report: ProviderReport;
  now: Date;
  propagation_seconds?: number;
  residual_authority?: { status: "resolved" | "unresolved" | "unknown"; residual: { kind: string; id: string; surviving_permission: string | null }[] } | null;
  compensation?: { applied: boolean; note: string } | null;
  prior_state?: VerifyState | null;
}

const WORKS = new Set(["allowed", "success", "observed"]);

export function verifyContainment(i: VerifyInput) {
  const reasons: string[] = [];
  const targets = i.plan.targets.map((t) => t.asset_id);
  const prop = Math.max(0, i.propagation_seconds ?? 300);
  const acceptedAt = Date.parse(i.report.accepted_at);
  if (Number.isNaN(acceptedAt)) throw new HttpError(400, "report.accepted_at must be an ISO 8601 time");
  const effective = acceptedAt + prop * 1000;
  const window = { from: new Date(effective).toISOString(), to: i.now.toISOString() };
  const observers = i.plan.verification.effect_observer_source_ids.filter((id) => i.sources.some((s) => s.id === id));
  const covered = new Set(i.sources.filter((s) => observers.includes(s.id)).flatMap((s) => s.asset_ids));
  const unassessed = [
    ...i.plan.blast_radius.downstream_asset_ids.filter((a) => !covered.has(a)).map((a) => `downstream asset ${a} has no independent observer`),
    ...targets.filter((a) => !covered.has(a)).map((a) => `target ${a} has no independent observer`),
    "paths through assets without telemetry, and identities not seen in the finding",
  ];
  // identities the finding is about; legitimate traffic is everything else
  const ids = (e: SecurityEvent) => [e.actor_ref && `actor:${e.actor_ref}`, e.session_ref && `session:${e.session_ref}`, e.client_ip && `ip:${e.client_ip}`, e.run_id && `run:${e.run_id}`].filter(Boolean) as string[];
  const suspect = new Set(i.finding.events.flatMap(ids));
  const actions = new Set(i.finding.events.map((e) => e.action));
  const onTarget = (e: SecurityEvent) => e.asset_ids.some((a) => targets.includes(a));
  const after = i.events.filter((e) => Date.parse(e.occurred_at) >= effective && Date.parse(e.occurred_at) <= i.now.getTime() && onTarget(e));
  const fromObs = after.filter((e) => observers.includes(e.source_id));
  const recurred = fromObs.filter((e) => actions.has(e.action) && WORKS.has(e.outcome) && ids(e).some((x) => suspect.has(x)));
  const obsReported = i.events.some((e) => observers.includes(e.source_id) && Date.parse(e.occurred_at) >= effective && Date.parse(e.occurred_at) <= i.now.getTime());

  let state: VerifyState;
  if (!i.report.provider_accepted) { state = "failed"; reasons.push("the provider did not accept the change: nothing was contained"); }
  else if (i.now.getTime() < effective) { state = "pending"; reasons.push(`inside the ${prop}s propagation window until ${window.from}`); }
  else if (recurred.length) { state = "failed"; reasons.push(`an independent observer recorded ${recurred.length} successful occurrence(s) of the contained behaviour after the change (provider acceptance notwithstanding)`); }
  else if (i.residual_authority && i.residual_authority.status === "unresolved") { state = "failed"; reasons.push(`residual authority survives: ${i.residual_authority.residual.map((r) => `${r.kind} ${r.id}${r.surviving_permission ? ` (${r.surviving_permission})` : ""}`).join("; ")}`); }
  else if (!observers.length) { state = "inconclusive"; reasons.push("no independent effect observer covers the targets: a provider report is all there is"); }
  else if (!obsReported) { state = "inconclusive"; reasons.push("the observers reported nothing since the change: silence is not evidence the behaviour stopped"); }
  else if (i.residual_authority && i.residual_authority.status === "unknown") { state = "inconclusive"; reasons.push("residual authority is unknown (missing snapshot or audit gap)"); }
  else { state = "verified"; reasons.push("observers reported after the propagation window and the contained behaviour did not recur"); }
  if ((state === "failed") && i.compensation?.applied) { state = "compensated"; reasons.push(`compensation recorded: ${i.compensation.note}`); }

  // service restoration: legitimate (non-suspect) successful traffic on targets, before vs after, same length
  const span = Math.max(60_000, i.now.getTime() - effective);
  const legit = (e: SecurityEvent) => onTarget(e) && WORKS.has(e.outcome) && !ids(e).some((x) => suspect.has(x));
  const before = i.events.filter((e) => legit(e) && Date.parse(e.occurred_at) < acceptedAt && Date.parse(e.occurred_at) >= acceptedAt - span).length;
  const afterLegit = after.filter(legit).length;
  const service = state === "pending" ? { state: "pending", detail: "inside the propagation window" }
    : afterLegit > 0 ? { state: "service_observed", detail: `${afterLegit} legitimate successful request(s) on the targets after the change (${before} in the equal window before)` }
    : before > 0 && obsReported ? { state: "disruption_detected", detail: `${before} legitimate successful request(s) in the window before and none after, while observers still report` }
    : { state: "unknown", detail: "no legitimate traffic to compare" };

  return {
    schema: "dk.containment_verification.v1",
    containment: { state, reasons },
    service_restoration: service,
    historical_exposure: { state: "not_assessed", detail: `containment verification does not conclude what happened before the change; ${i.finding.events.length} finding event(s) predate it and belong to the case` },
    tested_scope: { target_asset_ids: targets, observer_source_ids: observers, window, identities_checked: suspect.size, actions_checked: [...actions] },
    unassessed,
    provider_report: i.report,
    case_effect: state === "verified" ? "containment verified for the tested scope only; the case closes on its own criteria" : "the case remains unresolved",
  };
}

export class Verifications {
  constructor(private readonly store: Store) {}
  verify(projectId: string, containmentId: string, b: Record<string, unknown>, actor: string) {
    const c = this.store.getContainment(projectId, containmentId) as Record<string, unknown> | undefined;
    if (!c) throw new HttpError(404, "no such containment request");
    if (c.status !== "approved") throw new HttpError(409, "only an approved containment request can be verified");
    if (!c.plan) throw new HttpError(409, "the request has no exact plan to verify against");
    const plan = JSON.parse(String(c.plan)) as ResponsePlan;
    const rep = b.report as Partial<ProviderReport> | undefined;
    if (!rep || typeof rep.provider_accepted !== "boolean" || typeof rep.accepted_at !== "string") throw new HttpError(400, "report must be { provider_accepted, accepted_at, provider_ref? }");
    const f = this.store.getFinding(projectId, String(c.finding_id));
    if (!f) throw new HttpError(409, "the finding no longer exists");
    const all = this.store.listEvents(projectId, { limit: 50_000 });
    const fe = all.filter((e) => f.finding.event_ids.includes(e.id));
    let residual: VerifyInput["residual_authority"] = null;
    if (plan.action_id === "secrets.rotate_credentials" && typeof b.aws_key_id === "string") {
      const snap = (b.snapshot ?? null) as AuthSnapshot | null;
      const a = credentialAftermath(this.store, projectId, b.aws_key_id, { snapshot: snap });
      residual = { status: a.status, residual: a.residual.map((d) => ({ kind: d.kind, id: d.id, surviving_permission: d.surviving_permission })) };
    }
    const prev = this.store.db.prepare("SELECT state FROM containment_verifications WHERE project_id = ? AND containment_id = ? ORDER BY created_at DESC LIMIT 1").get(projectId, containmentId) as { state: VerifyState } | undefined;
    const comp = b.compensation as { applied?: unknown; note?: unknown } | undefined;
    const result = verifyContainment({
      plan, finding: { affected_asset_ids: f.finding.affected_asset_ids, events: fe }, events: all, sources: this.store.listSources(projectId), report: rep as ProviderReport, now: this.store.now(),
      propagation_seconds: typeof b.propagation_seconds === "number" ? b.propagation_seconds : undefined, residual_authority: residual,
      compensation: comp && comp.applied === true && typeof comp.note === "string" ? { applied: true, note: comp.note.slice(0, 500) } : null, prior_state: prev?.state ?? null,
    });
    const id = `cv_${randomBytes(8).toString("hex")}`;
    this.store.db.prepare("INSERT INTO containment_verifications (id, project_id, containment_id, state, result, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, projectId, containmentId, result.containment.state, JSON.stringify(result), actor, this.store.now().toISOString());
    this.store.audit(actor, `containment.verification.${result.containment.state}`, projectId, containmentId, {});
    return { id, ...result };
  }
  list(projectId: string, containmentId: string) {
    return { verifications: (this.store.db.prepare("SELECT id, state, result, created_by, created_at FROM containment_verifications WHERE project_id = ? AND containment_id = ? ORDER BY created_at").all(projectId, containmentId) as { id: string; state: string; result: string; created_by: string; created_at: string }[]).map((r) => ({ id: r.id, state: r.state, created_by: r.created_by, created_at: r.created_at, result: JSON.parse(r.result) })) };
  }
}
