import { canonicalJson, REPAIR_ACTION_PARAMETER, validateRepairRegression, type RepairExecution, type RepairPlan, type RepairRegression, type RepairVerification } from "@dk/contracts";
import { sha256 } from "../catalog.ts";
import type { CompiledWorld } from "../compile.ts";
import type { VerificationProbe } from "./effects.ts";
import { planDigest } from "./lease.ts";

/**
 * LP23: capture an executed AND independently verified local repair (LP21 execution + LP22 verification) as a
 * replayable regression (`dk.local.repair_regression.v1`), and decide whether an earlier validation still holds.
 *
 * Capture is typed and minimizing: only the public synthetic world identity, the typed defect prerequisite, the
 * principals as synthetic account references, the typed repair actions and the probes' route shape survive. Headers,
 * bodies, sessions, credentials, run ids, operation ids, nonces, observations and private truth are never copied, and
 * the canonical descriptor is scanned for every run secret the caller holds plus secret-shaped values before it is
 * returned. Replay (examples/reference-app/src/lab/regression-replay.ts) needs no model: it rebuilds the world from the
 * blueprint and seed, re-applies the defect, re-runs the typed actions under a fresh supervisor lease and verifies
 * the effects with a fresh independent verifier.
 *
 * A passing regression shows the supported boundary result reproduces in the local lab under the pinned versions; it
 * is not a validated defence of any real system.
 */
export const LOCAL_REGRESSION = "dk.local.repair_regression.v1";
export const LOCAL_REGRESSION_TOOLS = {
  effect_verifier: "dk-effect-verifier-1",
  repair_controller: "dk-repair-controller-1",
  /** Digest of the typed operation table's public shape (action type -> its single reference parameter). */
  repair_operations: `ops-${sha256(canonicalJson(REPAIR_ACTION_PARAMETER)).slice(0, 16)}`,
  replayer: "dk-local-regression-replay-1",
} as const;
export type RegressionTools = { -readonly [K in keyof typeof LOCAL_REGRESSION_TOOLS]: string };

/** Values that must never appear in a descriptor, by shape. Categories only are reported, never values. */
const SECRET_SHAPES: [string, RegExp][] = [
  ["session token", /\bses-[a-f0-9]{8,}/], ["synthetic password", /\bsynthetic-[a-f0-9]{16}\b/], ["credential secret", /\bcs-[a-f0-9]{8,}|\bsecret-[a-f0-9]{8,}/],
  ["run token", /\btok-[A-Za-z0-9_-]{8,}|\bdkr_[A-Za-z0-9_-]{8,}/], ["aws access key", /AKIA[0-9A-Z]{16}/], ["api secret", /\bsk_(live|test)_[A-Za-z0-9]{6,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY/], ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./], ["github token", /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ["email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/], ["ip address", /\b(?:\d{1,3}\.){3}\d{1,3}\b/], ["url", /\b[a-z][a-z0-9+.-]*:\/\//i],
  ["provider arn", /\barn:aws[a-z-]*:/], ["host path", /(^|[\s"])\/(etc|home|root|tmp|var|usr|proc|Users)\//],
];
/** Private-truth and oracle vocabulary: a descriptor naming these is refused (the schema has no field for them). */
const PRIVATE_KEYS = /"(oracle|truth|private_truth_path|answer_key|canary|master_seed|labels?|expected_answer)"\s*:/;

export function regressionLeaks(text: string, secrets: Iterable<string> = []): string[] {
  const out: string[] = [];
  let n = 0; for (const s of secrets) if (s && s.length >= 6 && text.includes(s)) n++;
  if (n) out.push(`${n} run secret(s) present`);
  for (const [name, re] of SECRET_SHAPES) if (re.test(text)) out.push(name);
  if (PRIVATE_KEYS.test(text)) out.push("private truth / oracle field");
  return out;
}

export class RegressionRefusal extends Error {
  constructor(readonly code: "not_verified" | "mismatch" | "unsupported" | "leak" | "invalid", message: string, readonly problems: string[] = []) { super(message); }
}

export const caseRef = (caseId: string) => `sha256:${sha256(`case|${caseId}`).slice(0, 16)}`;
export const descriptorDigest = (d: Omit<RepairRegression, "descriptor_digest"> | RepairRegression) => {
  const { descriptor_digest: _x, ...rest } = d as RepairRegression;
  return sha256(canonicalJson(rest));
};

/** Pinned versions of the resources a regression depends on, read from the compiled world (never from the run's output). */
export function regressionPolicyVersions(world: CompiledWorld, revisions: Record<string, string>) {
  const out: RepairRegression["versions"]["policies"] = {};
  for (const id of Object.keys(revisions).sort()) {
    const t = world.templates.find((x) => x.resource_id === id);
    if (!t) throw new RegressionRefusal("unsupported", `resource ${id} is not in the compiled world`);
    out[id] = { template: t.template, template_version: t.version, template_digest: t.digest, revision_at_validation: revisions[id]! };
  }
  return out;
}

export interface CaptureInput {
  world: CompiledWorld; blueprint: RepairRegression["world"]["blueprint"]; blueprint_version: number; seed: string;
  defect: RepairRegression["prerequisites"]["defect"];
  /** Principals by ref, with the run-local header values that identify them (used only to map and to scan, never copied). */
  principals: { ref: string; account: string; headers: Record<string, string> }[];
  probes: VerificationProbe[];
  plan: RepairPlan; execution: RepairExecution; verification: RepairVerification;
  lesson: string; case_id: string; control_ids?: string[]; residual_uncertainty?: string[];
  /** Every run secret the caller holds (session values, credential secrets, tokens): the descriptor must contain none. */
  secrets?: string[];
  /** Artifact digests the repair depends on (select_test_artifact), pinned for staleness. */
  artifacts?: Record<string, string>;
  tools?: Partial<RegressionTools>;
}

export function captureRegression(i: CaptureInput): RepairRegression {
  const v = i.verification;
  if (!v.whole_run.success || v.security_verdict !== "pass") throw new RegressionRefusal("not_verified", `only an executed and independently verified repair (whole-run success) can become a regression; this one is ${v.whole_run.outcome} / ${v.security_verdict}`);
  if (i.execution.state !== "completed") throw new RegressionRefusal("not_verified", `the execution is ${i.execution.state}, not completed`);
  const pd = planDigest(i.plan);
  if (v.plan_digest !== pd || i.execution.plan_digest !== pd) throw new RegressionRefusal("mismatch", "the verification and the execution must both be for this exact plan");
  if (v.execution.receipt_digest !== sha256(canonicalJson(i.execution))) throw new RegressionRefusal("mismatch", "the verification was made against a different execution receipt");
  if (!v.before?.length) throw new RegressionRefusal("not_verified", "the verification has no pre-repair baseline; a regression must show the baseline failing");
  const probeIds = [...new Set(v.observations.map((o) => o.probe_id))].sort();
  if (canonicalJson(probeIds) !== canonicalJson(i.probes.map((p) => p.id).sort())) throw new RegressionRefusal("mismatch", "the probes must be exactly the probes the verification observed");
  const resIds = new Set(i.world.plan.resources.map((r) => r.id));
  const principalOf = (p: VerificationProbe) => {
    if (p.request.body !== undefined) throw new RegressionRefusal("unsupported", `probe ${p.id}: request bodies are not captured`);
    const h = canonicalJson(p.request.headers ?? {});
    const m = i.principals.find((x) => canonicalJson(x.headers) === h);
    if (!m) throw new RegressionRefusal("unsupported", `probe ${p.id}: its headers do not identify exactly one declared principal; arbitrary headers are not captured`);
    return m.ref;
  };
  for (const p of i.probes) for (const r of [p.request.resource, p.effect.observer, p.effect.resource]) if (!resIds.has(r)) throw new RegressionRefusal("unsupported", `probe ${p.id} names ${r}, which is not a resource of this world`);
  const before = new Map(v.before.map((b) => [b.probe_id, b.actual_effect]));
  const revisions: Record<string, string> = {};
  for (const a of i.plan.actions) revisions[a.target_resource_id] = a.expected_target_revision;
  for (const dft of i.defect) {
    if (!resIds.has(dft.resource_id)) throw new RegressionRefusal("unsupported", `defect resource ${dft.resource_id} is not in this world`);
    revisions[dft.resource_id] ??= i.execution.revisions_before[dft.resource_id] ?? "unknown";
  }
  const body: Omit<RepairRegression, "descriptor_digest"> = {
    schema: "dk.local.repair_regression.v1",
    regression_id: `lrg-${sha256(`${pd}|${sha256(canonicalJson(v))}|${caseRef(i.case_id)}`).slice(0, 16)}`,
    lesson: i.lesson.trim().slice(0, 2000),
    world: { blueprint: i.blueprint, blueprint_version: i.blueprint_version, seed: i.seed, plan_digest: i.world.plan_digest, catalog_version: i.world.catalog.version, catalog_digest: i.world.catalog.digest },
    prerequisites: { defect: i.defect.map((d) => ({ ...d })), principals: i.principals.map((p) => ({ ref: p.ref, kind: "session" as const, account: p.account })) },
    repair: { actions: i.plan.actions.map((a) => ({ action_id: a.id, type: a.type, target_resource_id: a.target_resource_id, parameters: { ...a.parameters } as Record<string, string>, expected_target_revision: a.expected_target_revision })) },
    probes: i.probes.map((p) => ({ id: p.id, expectation: p.expectation, control: p.expectation === "prohibited" ? "negative" as const : "positive" as const, request: { resource: p.request.resource, method: p.request.method as "GET" | "POST", path: p.request.path, principal: principalOf(p) }, effect: { observer: p.effect.observer, resource: p.effect.resource } })),
    expected: {
      baseline: i.probes.map((p) => ({ probe_id: p.id, actual_effect: before.get(p.id) ?? "unknown" })),
      without_repair: { prohibited_effects: "observed" },
      after_repair: { security_verdict: "pass", residual_access: [], disruption: [], whole_run: "success" },
    },
    versions: { policies: regressionPolicyVersions(i.world, revisions), tools: { ...LOCAL_REGRESSION_TOOLS, ...(i.tools ?? {}) }, artifacts: { ...(i.artifacts ?? {}) } },
    linkage: { case_ref: caseRef(i.case_id), control_ids: [...(i.control_ids ?? [])], plan_digest: pd, execution_receipt_digest: v.execution.receipt_digest, verification_digest: sha256(canonicalJson(v)), verification_outcome: "success" },
    residual_uncertainty: [
      ...(i.residual_uncertainty ?? []),
      ...v.verification_receipt.unassessed_paths.map((u) => `unassessed in the source verification: ${u}`.slice(0, 400)),
      "Local synthetic lab only: a reproduced boundary result is not a validated defence of any real system (EXT01 deferred).",
      "Paths that never reach an observed resource are invisible to the verifier and are not covered by this regression.",
    ],
    replay: { llm: "not_used", executor: "typed_repair_controller_under_supervisor_lease", scope: "local_run_only", data_origin: "synthetic_local", private_truth: "not_included" },
  };
  const d = { ...body, descriptor_digest: descriptorDigest(body) } as RepairRegression;
  const secrets = [...(i.secrets ?? []), ...i.principals.flatMap((p) => Object.values(p.headers)), v.run_id, i.execution.run_id, i.plan.run_id, ...v.observations.map((o) => o.operation_id)];
  const problems = regressionLeaks(canonicalJson(d), secrets);
  if (problems.length) throw new RegressionRefusal("leak", `the regression descriptor would contain sensitive data (${problems.join("; ")})`, problems);
  const ok = checkRegression(d);
  if (!ok.ok) throw new RegressionRefusal("invalid", `invalid regression descriptor: ${ok.errors.join("; ")}`, ok.errors);
  return d;
}

/** Schema + semantic validation + digest + leak scan. Use before replaying or importing any descriptor. */
export function checkRegression(d: unknown): { ok: true; value: RepairRegression; errors: [] } | { ok: false; errors: string[] } {
  const text = (() => { try { return canonicalJson(d); } catch { return ""; } })();
  const leaks = regressionLeaks(text);
  if (leaks.length) return { ok: false, errors: leaks.map((l) => `sensitive content: ${l}`) };
  const r = validateRepairRegression(d);
  if (!r.ok || !r.value) return { ok: false, errors: r.errors };
  if (descriptorDigest(r.value) !== r.value.descriptor_digest) return { ok: false, errors: ["/descriptor_digest does not match the descriptor (integrity check only; a matching digest is not proof the regression is correct)"] };
  return { ok: true, value: r.value, errors: [] };
}

export interface CurrentVersions { world: CompiledWorld; tools?: Partial<RegressionTools>; artifacts?: Record<string, string> }
/**
 * Is an earlier validation still current? Any change to the world plan or catalog, a pinned policy resource's
 * template (version or digest), a tool version or a pinned artifact digest marks it `stale`: the old pass no longer
 * says anything about the current versions until the regression is replayed under them.
 */
export function regressionValidity(d: RepairRegression, cur: CurrentVersions): { status: "valid" | "stale"; changed: string[] } {
  const changed: string[] = [];
  if (cur.world.plan_digest !== d.world.plan_digest) changed.push("world.plan_digest");
  if (cur.world.catalog.version !== d.world.catalog_version || cur.world.catalog.digest !== d.world.catalog_digest) changed.push("world.catalog");
  for (const [id, p] of Object.entries(d.versions.policies)) {
    const t = cur.world.templates.find((x) => x.resource_id === id);
    if (!t) changed.push(`policy:${id} removed`);
    else { if (t.version !== p.template_version) changed.push(`policy:${id} template_version ${p.template_version} -> ${t.version}`); if (t.digest !== p.template_digest) changed.push(`policy:${id} template_digest`); }
  }
  const tools = { ...LOCAL_REGRESSION_TOOLS, ...(cur.tools ?? {}) } as Record<string, string>;
  for (const [k, ver] of Object.entries(d.versions.tools)) if (tools[k] !== ver) changed.push(`tool:${k} ${ver} -> ${tools[k] ?? "absent"}`);
  const arts = cur.artifacts ?? {};
  for (const [k, dg] of Object.entries(d.versions.artifacts)) if (arts[k] !== dg) changed.push(`artifact:${k}`);
  return { status: changed.length ? "stale" : "valid", changed };
}
