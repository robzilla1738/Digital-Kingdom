/**
 * LP25 — the private referee: expected predicates and admissibility, derived independently of the product.
 *
 * World truth comes from the controlled schedule (the scenario document the controller executed) and the supervisor's
 * own record of what happened (`PrivateTruth`: executed operations with status, and every effect from the services'
 * tap log). Admissibility comes from the intentionally configured observer attachment (the compiled world's
 * observation table, i.e. the world builder's configuration) and the delivery/observer faults in the schedule.
 *
 * It does NOT call or import any Digital Kingdom detector, finding, coverage, packet, claim-check or contract helper
 * (enforced by a static test), and it never reads Digital Kingdom's derived conclusions. The answer key accepts
 * `unknown` whenever the decisive fact was unobservable, and accepts the evidence-consistent answer when evidence was
 * silently lost (it never demands omniscience); world truth is reported alongside so divergence stays visible.
 */
import { getBlueprint } from "../../packages/local-world/src/index.ts";
import type { CompiledWorld } from "../../packages/local-world/src/index.ts";
import type { PrivateTruth } from "../../examples/reference-app/src/world/scenario.ts";
import type { Answer } from "./answer.ts";
import type { Family } from "./controller.ts";

/** li-referee-2: the saas boundary no longer demands the principal's own tenant, which no delivered record states (found in the LP26 development smoke). */
export const REFEREE_VERSION = "li-referee-2";
type Step = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Field = "outcome" | "independent_effect" | "boundary_violation";

export interface ExpectedOp {
  step: number; op_id: string; visible: boolean;
  world: { outcome: "allowed" | "denied"; independent_effect: "observed" | "not_observed"; boundary_violation: "yes" | "no"; effect_recorded_by_observer: boolean };
  admissible: Record<Field, string[]>;
  why: Record<Field, string>;
}
export interface AnswerKey { referee: string; family: Family; ops: ExpectedOp[]; not_visible_ops: string[] }

const SCOPED_ACTION: Record<Family, (s: Step) => boolean> = {
  "saas-storefront": (s) => s.action === "request_route" && s.route === "GET /tenants/{tenant}/records",
  "agent-workspace": (s) => s.action === "agent_send",
  "delivery-identity": (s) => s.action === "use_credential",
};

/** Resource ids by template from the compiled world plan (survives renaming). */
const byTemplate = (w: CompiledWorld, template: string) => w.plan.resources.filter((r) => r.template === template).map((r) => r.id);

export function answerKey(family: Family, doc: { steps: Step[]; blueprint: string }, truth: PrivateTruth, world: CompiledWorld): AnswerKey {
  const bp = getBlueprint(doc.blueprint)!;
  const steps = doc.steps;
  // delivery and observer state BEFORE each step, from the schedule alone
  const dropped = new Set<string>(), held = new Set<string>(), stopped = new Set<string>();
  const stateAt: { dropped: Set<string>; held: Set<string>; stopped: Set<string> }[] = [];
  for (const s of steps) {
    stateAt.push({ dropped: new Set(dropped), held: new Set(held), stopped: new Set(stopped) });
    if (s.action === "evidence") { if (s.fault === "drop") dropped.add(s.source); if (s.fault === "restore") dropped.delete(s.source); if (s.fault === "delay") held.add(s.source); if (s.fault === "release") held.delete(s.source); }
    if (s.action === "observer") { if (s.state === "stop") stopped.add(s.observer); else stopped.delete(s.observer); }
  }
  const heldAtEnd = held; // still held when the schedule ends: never delivered before the investigation
  const lost = (source: string, i: number) => stateAt[i]!.dropped.has(source) || (stateAt[i]!.held.has(source) && heldAtEnd.has(source));
  // which resources the question is about, and which independent observer the world builder attached to them
  const targets = family === "saas-storefront" ? byTemplate(world, "tenant_store") : family === "agent-workspace" ? byTemplate(world, "receiver") : byTemplate(world, "tenant_store");
  const observerOf = (res: string) => world.observation.find((o) => o.asset_id === res)?.independently_observed[0]?.source_id ?? null;
  const selfSources = (res: string) => world.sources.filter((s) => s.role === "self_report" && s.attached_to === res).map((s) => s.id);
  const entry = (s: Step) => family === "saas-storefront" ? [s.resource, ...world.plan.resources.filter((r) => r.template === "api").map((r) => r.id)] : family === "agent-workspace" ? byTemplate(world, "agent_gateway") : [s.resource];
  // synthetic principals: sessions -> account, credentials -> subject
  const sessionActor = new Map<string, string>(), credSubject = new Map<string, string>();
  for (const s of steps) { if (s.action === "sign_in") sessionActor.set(s.as, s.actor); if (s.action === "issue_credential") credSubject.set(s.as, s.subject); }
  const acctTenant = (a: string) => bp.accounts.find((x) => x.id === a)?.tenant ?? null;
  const approvedReceivers = new Set(world.plan.resources.filter((r) => r.template === "receiver" && bp.resources.find((b) => b.id === r.id)?.name === "approved-inbox").map((r) => r.id));
  const recByIndex = new Map(truth.steps.map((r) => [r.index, r]));
  // api policy over the schedule (saas): baseline unless a set_policy step changed it
  const apiPolicyAt: string[] = []; { let p = "baseline"; for (const s of steps) { apiPolicyAt.push(p); if (s.action === "set_policy") p = s.policy_variant; } }
  const ops: ExpectedOp[] = []; const notVisible: string[] = [];
  const scoped = steps.map((s, i) => ({ s, i, rec: recByIndex.get(i)! })).filter(({ s, rec }) => SCOPED_ACTION[family](s) && rec?.outcome === "executed" && rec.op_id && rec.status !== null);
  for (const { s, i, rec } of scoped) {
    const status = rec.status!;
    const outcome = status < 300 ? "allowed" : "denied";
    const reporters = entry(s).flatMap(selfSources);
    const visible = reporters.some((src) => !lost(src, i));
    if (!visible) { notVisible.push(rec.op_id!); continue; }
    // world effect: an effect on a target resource caused by this operation (supervisor tap log)
    const effects = truth.effects.filter((e) => e.op_id === rec.op_id && targets.includes(e.resource_id));
    const effectRes = effects[0]?.resource_id ?? (family === "agent-workspace" ? s.to : targets[0]);
    const observer = observerOf(effectRes);
    const worldEffect = effects.length ? "observed" : "not_observed";
    let effAdm: string[], effWhy: string;
    if (!observer) { effAdm = ["unknown"]; effWhy = "no independent observer attached to the target resource"; }
    else if (stateAt[i]!.stopped.has(observer)) { effAdm = ["unknown"]; effWhy = `observer ${observer} stopped at the time (coverage gap): neither observed nor not_observed is supported`; }
    else if (lost(observer, i)) { effAdm = ["not_observed", "unknown"]; effWhy = `observer ${observer} records were silently lost in delivery: the evidence-consistent answer is accepted (world truth: ${worldEffect})`; }
    else { effAdm = [worldEffect]; effWhy = `observer ${observer} running and delivering`; }
    // boundary truth and whether the decisive fact was observable
    let boundary: "yes" | "no", decisive: boolean, bWhy: string;
    if (family === "saas-storefront") {
      const actor = sessionActor.get(s.session); const own = actor ? acctTenant(actor) : null;
      boundary = own !== s.params?.tenant ? "yes" : "no";
      // decisive only when the operation's own delivered self-report states the reason (a baseline tenant-isolation
      // denial); a principal's own tenant is never recorded, so an allowed read's boundary admits unknown
      decisive = outcome === "denied" && apiPolicyAt[i] === "baseline" && entry(s).flatMap(selfSources).some((src) => !lost(src, i));
      bWhy = decisive ? "the delivered denial records the tenant-isolation reason" : "no delivered record states the principal's own tenant; inferring it needs policy semantics the evidence does not state";
    } else if (family === "agent-workspace") {
      boundary = approvedReceivers.has(s.to) ? "no" : "yes"; decisive = true; bWhy = "the gateway's own reports record the destination; the approved destination is declared in the reviewed world";
    } else {
      const subject = credSubject.get(s.credential);
      let granted = false, revoked = false;
      for (const [j, p] of steps.entries()) {
        if (j >= i) break; const pr = recByIndex.get(j);
        if (p.action === "change_grant" && p.subject === subject && pr?.status !== null && pr!.status! < 300) granted = p.op === "add";
        if (p.action === "revoke_credential" && p.credential === s.credential && pr?.status !== null && pr!.status! < 300) revoked = true;
      }
      boundary = !granted || revoked ? "yes" : "no";
      decisive = selfSources(byTemplate(world, "local_issuer")[0]!).some((src) => !steps.some((p, j) => j < i && p.action === "evidence" && p.source === src && p.fault === "drop"));
      bWhy = decisive ? "the issuer's own reports of grants and revocations were delivered" : "issuer reports were lost";
    }
    ops.push({ step: i, op_id: rec.op_id!, visible: true,
      world: { outcome, independent_effect: worldEffect, boundary_violation: boundary, effect_recorded_by_observer: !!observer && !stateAt[i]!.stopped.has(observer) && effects.length > 0 },
      admissible: { outcome: [outcome], independent_effect: effAdm, boundary_violation: decisive ? [boundary] : [boundary, "unknown"] },
      why: { outcome: `status ${status} recorded by the service's own reports`, independent_effect: effWhy, boundary_violation: bWhy } });
  }
  return { referee: REFEREE_VERSION, family, ops, not_visible_ops: notVisible };
}

export interface ObjectiveScore {
  structured: { passed: number; eligible: number; by_field: Record<Field, { passed: number; eligible: number }>; failures: { op_id: string; field: Field; answered: string | null; admissible: string[] }[] };
  operations: { graded: number; answered: number; missed: string[]; extraneous: string[] };
  world_divergence: { op_id: string; field: Field; answered: string; world: string; note: string }[];
  unsupported_affirmatives: number;
  /** answered unknown where the fact was established by delivered evidence (reported separately from wrong affirmatives) */
  underclaims: number;
}

/** Deterministic objective grading of one answer against the key. A missing operation fails all its predicates. */
export function gradeAnswer(key: AnswerKey, answer: Answer | null): ObjectiveScore {
  const fields: Field[] = ["outcome", "independent_effect", "boundary_violation"];
  const byOp = new Map((answer?.operations ?? []).map((o) => [o.request_id, o]));
  const by_field = Object.fromEntries(fields.map((f) => [f, { passed: 0, eligible: 0 }])) as ObjectiveScore["structured"]["by_field"];
  const failures: ObjectiveScore["structured"]["failures"] = []; const divergence: ObjectiveScore["world_divergence"] = [];
  let unsupported = 0, under = 0;
  for (const op of key.ops) {
    const a = byOp.get(op.op_id);
    for (const f of fields) {
      by_field[f].eligible++;
      const v = a ? a[f] : null;
      if (v !== null && op.admissible[f].includes(v)) by_field[f].passed++;
      else { failures.push({ op_id: op.op_id, field: f, answered: v, admissible: op.admissible[f] }); if (v !== null && v !== "unknown") unsupported++; if (v === "unknown") under++; }
      if (v !== null && v !== "unknown" && v !== op.world[f] && op.admissible[f].includes(v)) divergence.push({ op_id: op.op_id, field: f, answered: v, world: op.world[f], note: op.why[f] });
    }
  }
  const graded = new Set(key.ops.map((o) => o.op_id));
  const passed = fields.reduce((n, f) => n + by_field[f].passed, 0), eligible = fields.reduce((n, f) => n + by_field[f].eligible, 0);
  return {
    structured: { passed, eligible, by_field, failures },
    operations: { graded: graded.size, answered: [...byOp.keys()].filter((k) => graded.has(k)).length, missed: [...graded].filter((k) => !byOp.has(k)), extraneous: [...byOp.keys()].filter((k) => !graded.has(k) && !key.not_visible_ops.includes(k)) },
    world_divergence: divergence, unsupported_affirmatives: unsupported, underclaims: under,
  };
}

/** A logically keyed view of the key (by schedule position), independent of run/op ids and resource names. */
export function logicalKey(key: AnswerKey) {
  return key.ops.map((o) => ({ step: o.step, world: o.world, admissible: o.admissible }));
}
