import { mkdtempSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { canonicalJson, validateRepairPlan, type Graph, type RepairAction, type RepairPlan } from "@dk/contracts";
import { sha256, type Role } from "./security.ts";
import { HttpError, type Store } from "./store.ts";
import type { Cases } from "./cases.ts";
import { provenanceOf } from "./provenance.ts";
import { applyChanges, compareStates, evaluateWithCredentials, explainPath, graphFromState, keyOf, snapshotFromState, stateHash, type AnalysisState, type Change, type Element, type Exploration } from "./exploration.ts";
import type { AuthSnapshot } from "./access/aws-policy.ts";

/**
 * LP14 reviewable repair candidates (`dk.repair_candidates.v1`).
 *
 * Narrow repairs from a finite set of REVIEWED templates, each one of the five local action types of
 * `dk.local.repair_plan.v1`. A candidate is the LP13 change list a template produces, simulated in the analysis
 * namespace against the case's objective: the operations that must become impossible (prohibited) and the ones that
 * must keep working (permitted, the positive controls). Candidates are ranked on recorded criteria — objective
 * coverage, disruption of permitted operations, prerequisites, unknowns — and the ranking never claims global
 * optimality.
 *
 * Each candidate carries: a validated plan-only repair plan bound to the exact baseline and candidate state digests;
 * a config patch (`dk.config_patch.v1`) with exact baseline and artifact references that can be exported as a file
 * or materialised into a fresh disposable directory under the OS temp dir (never the operator checkout); expected
 * impact; positive controls; verification; and compensation (the exact inverse changes).
 *
 * What this module never does: read evidence text (it reads no events, packets or attributes), run a process, write
 * outside a fresh temp directory, contact a network, open or publish a pull request, apply a change, or record an
 * approval. The authorization check only answers whether an approval DESCRIPTOR still binds the current digests;
 * no executor exists in this phase (lab leases are LP16; human approval is deferred, EXT05).
 */
export const REPAIR_CANDIDATES = "dk.repair_candidates.v1";
export const CONFIG_PATCH = "dk.config_patch.v1";
export const REPAIR_TEMPLATE_CATALOG = "dk.repair_templates.v1";
export const REPAIR_LIMITS = { max_probes: 20, max_candidates: 12, plan_ttl_hours: 24 } as const;

export const REPAIR_MIGRATION = `
CREATE TABLE repair_candidate_sets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, case_id TEXT NOT NULL, base_state_hash TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX repair_candidate_sets_case ON repair_candidate_sets (project_id, case_id, created_at);
CREATE TRIGGER repair_candidate_sets_append_only_u BEFORE UPDATE ON repair_candidate_sets BEGIN SELECT RAISE(ABORT, 'repair candidate sets are append-only'); END;
CREATE TRIGGER repair_candidate_sets_append_only_d BEFORE DELETE ON repair_candidate_sets BEGIN SELECT RAISE(ABORT, 'repair candidate sets are append-only'); END;`;

export type ProbeKind = "permission" | "path" | "observer_gap" | "artifact_version" | "tenant_access";
export interface ObjectiveProbe { id: string; kind: ProbeKind; principal?: string; action?: string; resource?: string; from?: string; to?: string; source_id?: string; asset_id?: string; version?: string; tenant?: string; target_tenant?: string }
type Holds = "holds" | "does_not_hold" | "unknown";

/** Reviewed templates. Adding one is a reviewed code change with its own tests, never runtime input. */
export const REPAIR_TEMPLATES = [
  { id: "remove-test-grant", version: 1, action: "remove_test_grant", applies_to: ["permission"], disruption_class: "targeted", reversible: true,
    prerequisites: ["the grant is a run-owned synthetic test grant", "a local lab lease to apply it (LP16; none exists in this phase)"],
    explanation: "Remove the identity-policy allow statement(s) the evaluator cites for the prohibited operation." },
  { id: "deactivate-test-token", version: 1, action: "deactivate_test_token", applies_to: ["permission"], disruption_class: "broad_for_principal", reversible: true,
    prerequisites: ["the key is a run-owned synthetic test token", "a local lab lease to apply it (LP16; none exists in this phase)"],
    explanation: "Deactivate every active access key of the principal; everything that principal does through a key stops." },
  { id: "set-gateway-policy", version: 1, action: "set_gateway_policy", applies_to: ["path"], disruption_class: "targeted", reversible: true,
    prerequisites: ["the local tool gateway enforces the selected policy reference", "a local lab lease to apply it (LP16; none exists in this phase)"],
    explanation: "Replace the local gateway policy so the agent's link to this tool is denied." },
  { id: "select-test-artifact", version: 1, action: "select_test_artifact", applies_to: ["artifact_version"], disruption_class: "targeted", reversible: true,
    prerequisites: ["the alternative version already exists in the local test artifact depot", "a local lab lease to apply it (LP16; none exists in this phase)"],
    explanation: "Select an existing alternative test artifact version for the asset." },
  { id: "restart-test-observer", version: 1, action: "restart_test_observer", applies_to: ["observer_gap"], disruption_class: "none", reversible: true,
    prerequisites: ["the observer is run-owned", "a local lab lease to apply it (LP16; none exists in this phase)"],
    explanation: "Restart (re-enable) the run-owned observer so the operation can be independently observed again." },
  { id: "restore-reviewed-policy", version: 1, action: "set_gateway_policy", applies_to: ["tenant_access"], disruption_class: "targeted", reversible: true,
    prerequisites: ["the enforcement point is a run-owned local resource whose declared policy variant is in the latest local configuration snapshot", "a supervisor lab lease scoped to this plan (LP20) to apply it"],
    explanation: "Return the enforcement point from the deliberately weak policy variant to a reviewed variant, so its declared tenant isolation denies the cross-tenant operation again while own-tenant operations keep working." },
] as const;
type Template = (typeof REPAIR_TEMPLATES)[number];

/**
 * Declared semantics of the reviewed local templates' policy variants for tenant access (model-only; mirrors the
 * built-in local world services: a tenant API in isolated mode refuses another tenant's records unless its policy is
 * the deliberately weak lab variant; edge and agent gateways do not decide tenant access). Executed behaviour is
 * established only by LP22 independent effect verification, never by this table.
 */
export const LOCAL_TENANT_POLICY_MODEL = "dk.local.tenant_policy_model.v1";
export function tenantDecision(policy: Element, tenant: string, target: string): "allows" | "denies" {
  const a = policy.attrs;
  return a.template === "api" && a.tenant_mode === "isolated" && a.variant !== "deliberately_weak" && tenant !== target ? "denies" : "allows";
}
function tenantPaths(p: ObjectiveProbe, s: AnalysisState, graph: Graph) {
  const pols = s.elements.filter((e) => e.kind === "policy");
  const x = explainPath({ graph: graphFromState(graph, s), snap: null, namespace: s.namespace, from: p.from!, to: p.to! });
  const paths = x.paths.map((path) => {
    const assets = [p.from!, ...path.hops.map((h) => h.to)];
    const onPath = assets.map((id) => pols.find((e) => e.attrs.asset_id === id)).filter((e): e is Element => !!e);
    return { assets, onPath, deniedBy: onPath.find((e) => tenantDecision(e, p.tenant!, p.target_tenant!) === "denies") ?? null };
  });
  return { configured: pols.length > 0, reachable: x.reachable, paths };
}

const REF_RE = /[^A-Za-z0-9_.:-]/g;
const ref = (prefix: string, key: string) => `${prefix}-${sha256(key).slice(0, 12)}`;
const plainId = (s: string) => (s.replace(REF_RE, "-").replace(/^[^A-Za-z0-9]+/, "") || "x").slice(0, 120);
const revisionOf = (e: Element | undefined) => `rev-${sha256(canonicalJson(e?.attrs ?? null)).slice(0, 16)}`;

function checkProbe(p: unknown, i: number, list: string): ObjectiveProbe {
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new HttpError(422, `${list}[${i}] must be an object`);
  const o = p as Record<string, unknown>;
  const allowed: Record<ProbeKind, string[]> = { permission: ["principal", "action", "resource"], path: ["from", "to"], observer_gap: ["source_id"], artifact_version: ["asset_id", "version"], tenant_access: ["from", "to", "tenant", "target_tenant"] };
  if (!Object.keys(allowed).includes(o.kind as string)) throw new HttpError(422, `${list}[${i}].kind must be one of ${Object.keys(allowed).join(", ")}`);
  if (typeof o.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(o.id)) throw new HttpError(422, `${list}[${i}].id must be a plain id`);
  const fields = allowed[o.kind as ProbeKind];
  const extra = Object.keys(o).filter((k) => k !== "id" && k !== "kind" && !fields.includes(k));
  if (extra.length) throw new HttpError(422, `${list}[${i}] unsupported field(s) ${extra.join(", ")}`);
  for (const f of fields) if (typeof o[f] !== "string" || !(o[f] as string).length || (o[f] as string).length > 400) throw new HttpError(422, `${list}[${i}].${f} is required`);
  return o as unknown as ObjectiveProbe;
}

export class Repairs {
  constructor(private readonly store: Store, private readonly exploration: Exploration, private readonly cases: Cases) {}

  private probeIn(p: ObjectiveProbe, s: AnalysisState, snap: AuthSnapshot | null, graph: Graph): { holds: Holds; detail: string } {
    if (p.kind === "permission") {
      if (!snap) return { holds: "unknown", detail: "no authorization snapshot" };
      const d = evaluateWithCredentials(snapshotFromState(snap, s)!, p.principal!, p.action!, p.resource!);
      if (!/^s3:/i.test(p.action!) && p.action!.toLowerCase() !== "sts:assumerole") return { holds: "unknown", detail: "provider/action semantics outside the supported evaluator" };
      return { holds: d.result === "feasible" || d.result === "conditional" ? "holds" : d.result === "blocked" ? "does_not_hold" : "unknown", detail: `configured permission ${d.result}${d.condition_keys.length ? ` (conditions ${d.condition_keys.join(", ")})` : ""}` };
    }
    if (p.kind === "path") {
      const x = explainPath({ graph: graphFromState(graph, s), snap: null, namespace: s.namespace, from: p.from!, to: p.to! });
      return { holds: x.reachable === "unresolved" ? "unknown" : x.reachable === "no_declared_path_found" ? "does_not_hold" : "holds", detail: x.reachable };
    }
    if (p.kind === "tenant_access") {
      const t = tenantPaths(p, s, graph);
      if (!t.configured) return { holds: "unknown", detail: "no declared local configuration (dk.local.config_snapshot.v1) for this project; tenant enforcement is unknown" };
      if (t.reachable === "unresolved") return { holds: "unknown", detail: "unresolved: an endpoint is not in the inventory" };
      if (!t.paths.length) return { holds: "does_not_hold", detail: "no declared path" };
      const open = t.paths.find((x) => !x.deniedBy);
      return open ? { holds: "holds", detail: `declared path ${open.assets.join(" -> ")}; no enforcement point denies ${p.tenant} -> ${p.target_tenant} (${LOCAL_TENANT_POLICY_MODEL})` }
        : { holds: "does_not_hold", detail: `every declared path is denied (${[...new Set(t.paths.map((x) => `${x.deniedBy!.attrs.asset_id} ${String(x.deniedBy!.attrs.variant)}`))].join(", ")}; ${LOCAL_TENANT_POLICY_MODEL})` };
    }
    if (p.kind === "observer_gap") {
      const e = s.elements.find((x) => x.kind === "source" && x.id === p.source_id);
      return e ? { holds: e.attrs.disabled ? "holds" : "does_not_hold", detail: e.attrs.disabled ? "observer disabled" : "observer enabled" } : { holds: "unknown", detail: "observer not in the state" };
    }
    const a = s.elements.find((x) => x.kind === "artifact" && x.attrs.asset_id === p.asset_id);
    return a ? { holds: a.attrs.version === p.version ? "holds" : "does_not_hold", detail: `${p.asset_id} runs ${String(a.attrs.version)}` } : { holds: "unknown", detail: "no deployed artifact declared for the asset" };
  }

  /** Template proposals (change lists) for the objective in the baseline. Only reviewed templates; only declared elements. */
  private proposals(base: AnalysisState, snap: AuthSnapshot | null, graph: Graph, prohibited: ObjectiveProbe[], available: { asset_id: string; reference: string }[]) {
    const out: { template: Template; target: string; covers: string[]; changes: Change[]; actions: Omit<RepairAction, "id">[] }[] = [];
    for (const p of prohibited) {
      const now = this.probeIn(p, base, snap, graph);
      if (now.holds !== "holds") continue;
      if (p.kind === "permission" && snap) {
        const d = evaluateWithCredentials(snap, p.principal!, p.action!, p.resource!);
        const cited = base.elements.filter((e) => e.kind === "grant" && e.attrs.layer === "identity" && e.attrs.owner === p.principal && (e.attrs.statement as { Effect?: string })?.Effect === "Allow" && d.evidence.includes(`${String(e.attrs.doc)}#${String((e.attrs.statement as { Sid?: string }).Sid ?? e.attrs.order)}`));
        if (cited.length) out.push({ template: REPAIR_TEMPLATES[0], target: p.principal!, covers: [p.id], changes: cited.map((e) => ({ op: "remove" as const, kind: "grant" as const, authority: e.authority, id: e.id })),
          actions: cited.map((e) => ({ target_resource_id: plainId(String(e.attrs.owner).split(":").slice(5).join(":") || e.id), type: "remove_test_grant" as const, parameters: { grant_ref: ref("grant", keyOf(e)) }, expected_target_revision: revisionOf(e) })) });
        const keys = base.elements.filter((e) => e.kind === "credential" && e.attrs.owner === p.principal && e.attrs.status === "Active");
        if (keys.length) out.push({ template: REPAIR_TEMPLATES[1], target: p.principal!, covers: [p.id], changes: keys.map((e) => ({ op: "modify" as const, kind: "credential" as const, authority: e.authority, id: e.id, attrs: { status: "Inactive" } })),
          actions: keys.map((e) => ({ target_resource_id: plainId(String(e.attrs.key_id)), type: "deactivate_test_token" as const, parameters: { token_ref: ref("token", keyOf(e)) }, expected_target_revision: revisionOf(e) })) });
      }
      if (p.kind === "path") {
        const x = explainPath({ graph: graphFromState(graph, base), snap: null, namespace: "baseline", from: p.from!, to: p.to! });
        const links = new Set<string>();
        for (const path of x.paths) for (const h of path.hops) if (h.relationship_kind === "invokes_tool") links.add(`${h.from}->${h.to}`);
        for (const l of [...links].sort().slice(0, 3)) {
          const e = base.elements.find((y) => y.kind === "tool" && y.id === l);
          if (!e) continue;
          const policy = `deny-${plainId(l)}`.slice(0, 120);
          out.push({ template: REPAIR_TEMPLATES[2], target: l, covers: [p.id], changes: [{ op: "modify", kind: "tool", authority: e.authority, id: e.id, attrs: { gateway: "deny", policy_ref: policy } }],
            actions: [{ target_resource_id: plainId(String(e.attrs.agent)), type: "set_gateway_policy", parameters: { policy_ref: policy }, expected_target_revision: revisionOf(e) }] });
        }
      }
      if (p.kind === "artifact_version") {
        const e = base.elements.find((y) => y.kind === "artifact" && y.attrs.asset_id === p.asset_id);
        for (const alt of available.filter((a) => a.asset_id === p.asset_id).slice(0, 3)) {
          if (!e) break;
          const parsed = /@(.+)$/.exec(alt.reference)?.[1] ?? alt.reference.split(":").at(-1)!;
          if (parsed === p.version) continue;
          const altRef = ref("artifact", alt.reference);
          out.push({ template: REPAIR_TEMPLATES[3], target: `${p.asset_id}@${parsed}`, covers: [p.id], changes: [{ op: "modify", kind: "artifact", authority: e.authority, id: e.id, attrs: { version: parsed, reference: alt.reference } }],
            actions: [{ target_resource_id: plainId(p.asset_id!), type: "select_test_artifact", parameters: { artifact_ref: altRef }, expected_target_revision: revisionOf(e) }] });
        }
      }
      if (p.kind === "tenant_access") {
        // the weakened enforcement points on an open declared path, each returned to each reviewed variant
        const seen = new Set<string>();
        for (const path of tenantPaths(p, base, graph).paths.filter((x) => !x.deniedBy)) for (const e of path.onPath) {
          if (e.attrs.template !== "api" || e.attrs.tenant_mode !== "isolated" || e.attrs.variant !== "deliberately_weak" || seen.has(keyOf(e))) continue;
          seen.add(keyOf(e));
          for (const variant of ["baseline", "candidate"] as const) out.push({ template: REPAIR_TEMPLATES[5], target: `${String(e.attrs.asset_id)}@policy:${variant}`, covers: [p.id],
            changes: [{ op: "modify", kind: "policy", authority: e.authority, id: e.id, attrs: { variant } }],
            actions: [{ target_resource_id: plainId(String(e.attrs.asset_id)), type: "set_gateway_policy", parameters: { policy_ref: `policy:${variant}` }, expected_target_revision: typeof e.attrs.revision === "string" ? e.attrs.revision : revisionOf(e) }] });
        }
      }
      if (p.kind === "observer_gap") {
        const e = base.elements.find((y) => y.kind === "source" && y.id === p.source_id);
        if (e) out.push({ template: REPAIR_TEMPLATES[4], target: p.source_id!, covers: [p.id], changes: [{ op: "modify", kind: "source", authority: e.authority, id: e.id, attrs: { disabled: false } }],
          actions: [{ target_resource_id: plainId(p.source_id!), type: "restart_test_observer", parameters: { observer_ref: ref("observer", keyOf(e)) }, expected_target_revision: revisionOf(e) }] });
      }
    }
    // with several prohibited operations, also offer the union of the narrowest single-template proposals
    const distinct = new Set(out.map((o) => o.covers[0]!));
    if (distinct.size > 1) {
      const pick = [...distinct].map((id) => out.find((o) => o.covers[0] === id && o.template.disruption_class !== "broad_for_principal") ?? out.find((o) => o.covers[0] === id)!);
      const seen = new Set<string>(); const changes: Change[] = []; const actions: Omit<RepairAction, "id">[] = [];
      for (const p of pick) for (const [i, c] of p.changes.entries()) { const k = keyOf(c); if (seen.has(k)) continue; seen.add(k); changes.push(c); actions.push(p.actions[i] ?? p.actions[0]!); }
      out.push({ template: { ...pick[0]!.template, id: "combined" as never, explanation: `Combination of ${pick.map((p) => `${p.template.id} on ${p.target}`).join(" + ")}.` as never }, target: "combined", covers: [...distinct], changes, actions });
    }
    return out.slice(0, REPAIR_LIMITS.max_candidates);
  }

  generate(projectId: string, caseId: string, body: Record<string, unknown>, actor: string) {
    const bad = Object.keys(body).filter((k) => !["base_state_hash", "objective", "available_artifacts"].includes(k));
    if (bad.length) throw new HttpError(422, `unsupported field(s) ${bad.join(", ")}`);
    const c = this.cases.get(projectId, caseId);
    if (typeof body.base_state_hash !== "string" || !/^[a-f0-9]{64}$/.test(body.base_state_hash)) throw new HttpError(428, "base_state_hash (the baseline state you reviewed) is required");
    const o = body.objective as Record<string, unknown> | undefined;
    if (!o || typeof o !== "object" || Object.keys(o).some((k) => k !== "prohibited" && k !== "permitted")) throw new HttpError(422, "objective must be { prohibited: [...], permitted: [...] }");
    if (!Array.isArray(o.prohibited) || !o.prohibited.length || !Array.isArray(o.permitted) || !o.permitted.length || o.prohibited.length + o.permitted.length > REPAIR_LIMITS.max_probes)
      throw new HttpError(422, `objective needs at least one prohibited and one permitted operation (a repair that breaks legitimate traffic is not verified), at most ${REPAIR_LIMITS.max_probes} in total`);
    const prohibited = o.prohibited.map((p, i) => checkProbe(p, i, "prohibited")), permitted = o.permitted.map((p, i) => checkProbe(p, i, "permitted"));
    const ids = [...prohibited, ...permitted].map((p) => p.id);
    if (new Set(ids).size !== ids.length) throw new HttpError(422, "probe ids must be unique across prohibited and permitted");
    const availableIn = body.available_artifacts ?? [];
    if (!Array.isArray(availableIn) || availableIn.length > 20) throw new HttpError(422, "available_artifacts must be a list of at most 20 existing test artifact references");
    const available = availableIn.map((a, i) => { const x = a as Record<string, unknown>; if (!x || typeof x.asset_id !== "string" || typeof x.reference !== "string" || x.reference.length > 400 || Object.keys(x).some((k) => k !== "asset_id" && k !== "reference")) throw new HttpError(422, `available_artifacts[${i}] needs exactly asset_id and reference`); return { asset_id: x.asset_id, reference: x.reference }; });

    const snap = this.exploration.latestSnapshot(projectId);
    const { state: base, state_hash: baseHash } = this.exploration.baseline(projectId);
    if (baseHash !== body.base_state_hash) throw new HttpError(409, "the baseline changed since you reviewed it; generate against the current state", [`current base_state_hash ${baseHash}`], { current: { base_state_hash: baseHash } });
    const graph = this.store.getGraph(projectId) ?? { schema_version: "0.2", project_id: projectId, graph_revision: "not-imported", dataset_kind: "live", assets: [], relationships: [] } as unknown as Graph;
    const prov = provenanceOf(this.store.getProject(projectId)!);
    const runId = prov.local_run ? plainId(String(prov.run_id)) : `analysis-${baseHash.slice(0, 16)}`;
    const before = Object.fromEntries([...prohibited, ...permitted].map((p) => [p.id, this.probeIn(p, base, snap, graph)]));
    const expires = new Date(this.store.now().getTime() + REPAIR_LIMITS.plan_ttl_hours * 3600_000).toISOString();

    const candidates = this.proposals(base, snap, graph, prohibited, available).map((pr, idx) => {
      const namespace = `repair:${sha256(canonicalJson({ baseHash, changes: pr.changes })).slice(0, 16)}`;
      const cand = applyChanges(base, pr.changes, namespace);
      const candHash = stateHash(cand);
      const after = Object.fromEntries([...prohibited, ...permitted].map((p) => [p.id, this.probeIn(p, cand, snap, graph)]));
      const blocked = prohibited.filter((p) => before[p.id]!.holds === "holds" && after[p.id]!.holds === "does_not_hold").map((p) => p.id);
      const stillOpen = prohibited.filter((p) => after[p.id]!.holds === "holds").map((p) => p.id);
      const unknownP = prohibited.filter((p) => after[p.id]!.holds === "unknown").map((p) => p.id);
      const broken = permitted.filter((p) => before[p.id]!.holds === "holds" && after[p.id]!.holds !== "holds").map((p) => p.id);
      const cmp = compareStates({ base, candidate: cand, baseSnap: snap, baseGraph: graph, probes: permittedAndProhibitedPermission([...prohibited, ...permitted]), sources: [] });
      const unknowns = [...new Set([...unknownP.map((id) => `${id}: unknown after the change (${after[id]!.detail})`), ...cmp.unassessed_paths, ...permitted.filter((p) => after[p.id]!.holds === "unknown").map((p) => `${p.id}: positive control unknown after the change`)])];
      const plan: RepairPlan = {
        schema: "dk.local.repair_plan.v1", plan_id: `rp-${sha256(`${baseHash}:${candHash}`).slice(0, 16)}`, run_id: runId, case_id: plainId(caseId),
        baseline_digest: baseHash, candidate_digest: candHash,
        actions: pr.actions.map((a, i) => ({ ...a, id: `action-${i + 1}` })),
        verification_test_ids: prohibited.map((p) => p.id), positive_control_ids: permitted.map((p) => p.id),
        residual_unknowns: unknowns.slice(0, 20).map((u) => u.slice(0, 1000)), authority: "plan_only", expires_at: expires,
      };
      const check = validateRepairPlan(plan, { now: this.store.now().getTime() });
      const inverse: Change[] = pr.changes.map((ch) => { const e = base.elements.find((x) => keyOf(x) === keyOf(ch))!; return ch.op === "remove" ? { op: "add", kind: ch.kind, authority: ch.authority, id: ch.id, attrs: e.attrs } : { op: "modify", kind: ch.kind, authority: ch.authority, id: ch.id, attrs: Object.fromEntries(Object.keys(ch.attrs ?? {}).map((k) => [k, e.attrs[k] ?? null])) }; });
      return {
        candidate_id: `c${idx + 1}`, template: { id: pr.template.id, version: pr.template.version, catalog: REPAIR_TEMPLATE_CATALOG }, target: pr.target, explanation: pr.template.explanation,
        valid: check.ok && blocked.length > 0, plan_errors: check.errors,
        tradeoffs: {
          objective_coverage: { blocked: blocked.length, of: prohibited.length, still_possible: stillOpen, unknown: unknownP },
          disruption: { permitted_broken: broken, of: permitted.length, elements_changed: pr.changes.length, class: pr.template.disruption_class, reversible: pr.template.reversible },
          prerequisites: [...pr.template.prerequisites], unknowns,
        },
        breaks_permitted: broken.length > 0,
        expected_impact: [...prohibited, ...permitted].map((p) => ({ probe: p.id, role: prohibited.includes(p) ? "prohibited" : "permitted", before: before[p.id]!, after: after[p.id]! })),
        positive_controls: permitted.map((p) => ({ probe: p.id, expected: "still possible", modeled_after: after[p.id]!.holds })),
        verification: { model_only: { prohibited_blocked: blocked, permitted_kept: permitted.filter((p) => after[p.id]!.holds === "holds").map((p) => p.id) }, executed_local: "pending: needs a disposable run and a lab lease (LP16); not run", external: "deferred (EXT01)" },
        compensation: { changes: inverse, note: "Apply these exact inverse changes to restore the baseline element values; verify the positive controls again afterwards." },
        plan, patch: buildPatch(base, cand, pr.changes, inverse, snap, graph),
        analysis: { namespace, candidate_state_hash: candHash, mode: "model_only" as const },
      };
    });
    // Ranking on recorded criteria only: coverage, then fewer broken positive controls, fewer unknowns, fewer changes.
    const ranked = candidates.slice().sort((a, b) => (Number(b.valid) - Number(a.valid)) || (b.tradeoffs.objective_coverage.blocked - a.tradeoffs.objective_coverage.blocked) || (a.tradeoffs.disruption.permitted_broken.length - b.tradeoffs.disruption.permitted_broken.length) || (a.tradeoffs.unknowns.length - b.tradeoffs.unknowns.length) || (a.tradeoffs.disruption.elements_changed - b.tradeoffs.disruption.elements_changed) || a.candidate_id.localeCompare(b.candidate_id))
      .map((c, i) => ({ ...c, rank: i + 1 }));
    const valid = ranked.filter((c) => c.valid);
    const nothingToRepair = prohibited.every((p) => before[p.id]!.holds === "does_not_hold");
    const status = nothingToRepair ? "no_repair_needed" : valid.length >= 2 ? "candidates" : valid.length === 1 ? "single_candidate" : "no_supported_repair";
    const reasons = status === "no_supported_repair" ? [
      ...prohibited.filter((p) => before[p.id]!.holds === "unknown").map((p) => `${p.id}: ${before[p.id]!.detail}; no reviewed template can act on an unresolved operation`),
      ...prohibited.filter((p) => before[p.id]!.holds === "holds" && !ranked.some((c) => c.valid && c.tradeoffs.objective_coverage.blocked && c.expected_impact.find((x) => x.probe === p.id)?.after.holds === "does_not_hold")).map((p) => `${p.id}: no reviewed template (${REPAIR_TEMPLATES.map((t) => t.id).join(", ")}) applies to the declared elements behind it`),
    ] : [];
    const result = {
      schema: REPAIR_CANDIDATES, project_id: projectId, case_id: c.id, status, reasons,
      baseline: { state_hash: baseHash, graph_revision: base.base.graph_revision, snapshot_id: base.base.snapshot_id, snapshot_digest: base.base.snapshot_digest },
      objective: { prohibited, permitted }, templates: REPAIR_TEMPLATES.map((t) => ({ id: t.id, version: t.version, action: t.action })),
      candidates: ranked,
      ranking: { criteria: ["validity (plan validates and blocks at least one prohibited operation)", "objective coverage (prohibited operations blocked)", "disruption (positive controls broken)", "unknowns", "elements changed"], note: "Ordered by these recorded criteria within this finite candidate set from reviewed templates. It is not a claim of global optimality; read the tradeoffs." },
      not_claimed: ["Model-only simulation over declared/configured state; nothing was applied, executed or observed.", "No plan here is approved; approval recording is deferred (EXT05) and no executor exists in this phase.", "Evidence text was not read or interpreted to build any patch."],
    };
    const id = `rcs_${sha256(`${projectId}:${caseId}:${canonicalJson(result)}:${this.store.now().toISOString()}:${Math.random()}`).slice(0, 16)}`;
    const digest = sha256(canonicalJson(result));
    this.store.db.prepare("INSERT INTO repair_candidate_sets (id, project_id, case_id, base_state_hash, body, digest, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, projectId, c.id, baseHash, canonicalJson(result), digest, actor, this.store.now().toISOString());
    this.store.audit(actor, "repair.candidates", projectId, id, { case_id: c.id, status, candidates: ranked.length });
    // LP15: the local attention queue reads this from the project change stream (ids and counts only)
    this.store.emit(projectId, "repair_candidates", { id, case_id: c.id, status, valid_candidates: valid.length });
    return { id, digest, ...result };
  }

  get(projectId: string, id: string) {
    const r = this.store.db.prepare("SELECT * FROM repair_candidate_sets WHERE project_id = ? AND id = ?").get(projectId, id) as Record<string, string> | undefined;
    if (!r) throw new HttpError(404, "repair candidate set not found");
    const stored = JSON.parse(r.body!) as Omit<ReturnType<Repairs["generate"]>, "id" | "digest">;
    return { ...stored, id: r.id!, digest: r.digest!, created_at: r.created_at!, created_by: r.created_by! };
  }
  candidate(projectId: string, id: string, cid: string) {
    const set = this.get(projectId, id);
    const c = (set.candidates as { candidate_id: string }[]).find((x) => x.candidate_id === cid);
    if (!c) throw new HttpError(404, "candidate not found");
    return { set, candidate: c as ReturnType<Repairs["generate"]>["candidates"][number] };
  }
  /**
   * Does an approval DESCRIPTOR still bind this plan? Answers only about digests, plan id, current baseline and
   * expiry. It records nothing and executes nothing: `authorizes_execution` is always false in this phase.
   */
  authorizationCheck(projectId: string, id: string, cid: string, body: Record<string, unknown>) {
    const { candidate } = this.candidate(projectId, id, cid);
    const a = body.approval as Record<string, unknown> | undefined;
    if (!a || typeof a !== "object" || Object.keys(body).some((k) => k !== "approval")) throw new HttpError(422, "body must be { approval: { plan_id, baseline_digest, candidate_digest } }");
    const plan = candidate.plan;
    const reasons: string[] = [];
    if (a.plan_id !== plan.plan_id) reasons.push(`approval names plan ${String(a.plan_id)}, not ${plan.plan_id}`);
    if (a.baseline_digest !== plan.baseline_digest) reasons.push("approval baseline digest differs from the plan's baseline digest");
    if (a.candidate_digest !== plan.candidate_digest) reasons.push("approval candidate digest differs from the plan's candidate digest (the repair changed)");
    const current = this.exploration.baseline(projectId).state_hash;
    if (current !== plan.baseline_digest) reasons.push("the baseline state changed since the plan was generated (stale baseline); generate and review a new plan");
    if (!(Date.parse(plan.expires_at) > this.store.now().getTime())) reasons.push("the plan has expired");
    return { plan_id: plan.plan_id, binding_valid: reasons.length === 0, reasons, current_baseline_digest: current, authorizes_execution: false as const,
      execution: "unavailable: plan_only. No executor exists in this phase; a local lab lease (LP16) is not a human approval, and recording human approval is deferred (EXT05)." };
  }
}
const permittedAndProhibitedPermission = (ps: ObjectiveProbe[]) => ps.filter((p) => p.kind === "permission").map((p) => ({ principal: p.principal!, action: p.action!, resource: p.resource! }));

// ------------------------------------------------------------------------------------------------ patches
/** Pretty, stable JSON of the configuration document an element belongs to (secret values never exist here). */
function documents(s: AnalysisState, snap: AuthSnapshot | null, keys: string[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const touched = s.elements.filter((e) => keys.includes(keyOf(e)));
  const snapS = snapshotFromState(snap, s);
  for (const k of keys) {
    const e = touched.find((x) => keyOf(x) === k);
    const [kind, authority, ...rest] = k.split("|"); const id = rest.join("|");
    if (kind === "grant") {
      const owner = String(e?.attrs.owner ?? ""), doc = String(e?.attrs.doc ?? id.split("#")[2] ?? "doc");
      const ownerArn = owner || (snapS?.principals.find((p) => id.startsWith(p.arn.split(":").slice(5).join(":") + "#"))?.arn ?? "");
      const p = snapS?.principals.find((x) => x.arn === ownerArn);
      const pol = p && Array.isArray(p.policies) ? p.policies.find((d) => d.id === doc) ?? { id: doc, Statement: [] } : { id: doc, Statement: [] };
      out.set(`policies/${plainId(authority!)}/${plainId(id.split("#")[0]!)}/${plainId(doc)}.json`, pol);
    } else if (kind === "credential") out.set(`credentials/${plainId(authority!)}/${plainId(id)}.json`, e ? { key_id: e.attrs.key_id, owner: e.attrs.owner, status: e.attrs.status } : null);
    else if (kind === "tool") out.set(`gateways/${plainId(String(e?.attrs.agent ?? id.split("->")[0]))}.json`, s.elements.filter((x) => x.kind === "tool" && x.attrs.agent === (e?.attrs.agent ?? id.split("->")[0])).map((x) => ({ tool: x.attrs.tool, gateway: x.attrs.gateway ?? "allow", policy_ref: x.attrs.policy_ref ?? null })));
    else if (kind === "artifact") out.set(`deployments/${plainId(String(e?.attrs.asset_id ?? id.split(":")[0]))}.json`, e ? { asset_id: e.attrs.asset_id, registry: e.authority, name: e.attrs.name, version: e.attrs.version, reference: e.attrs.reference ?? null } : null);
    else if (kind === "policy") out.set(`local-policies/${plainId(String(e?.attrs.asset_id ?? id.split("#")[0]))}.json`, e ? { resource_id: e.attrs.asset_id, template: e.attrs.template, policy_variant: e.attrs.variant, tenant_mode: e.attrs.tenant_mode ?? null } : null);
    else if (kind === "source") out.set(`observers/${plainId(id)}.json`, e ? { id: e.id, asset_ids: e.attrs.asset_ids, enabled: !e.attrs.disabled } : null);
    else out.set(`${plainId(kind!)}/${plainId(id)}.json`, e?.attrs ?? null);
  }
  return out;
}
const pretty = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
function unified(path: string, before: string, after: string) {
  const a = before.split("\n").slice(0, -1), b = after.split("\n").slice(0, -1);
  return [`--- a/${path}`, `+++ b/${path}`, `@@ -1,${a.length} +1,${b.length} @@`, ...a.map((l) => `-${l}`), ...b.map((l) => `+${l}`)].join("\n") + "\n";
}
export function buildPatch(base: AnalysisState, cand: AnalysisState, changes: Change[], inverse: Change[], snap: AuthSnapshot | null, graph: Graph) {
  const keys = [...new Set(changes.map((c) => keyOf(c)))];
  const b = documents(base, snap, keys), a = documents(cand, snap, keys);
  const files = [...new Set([...b.keys(), ...a.keys()])].sort().map((path) => {
    const before = pretty(b.get(path) ?? null), after = pretty(a.get(path) ?? null);
    return { path, before_sha256: sha256(before), after_sha256: sha256(after), after };
  });
  const artifactRefs = base.elements.filter((e) => e.kind === "artifact").map((e) => ({ asset_id: e.attrs.asset_id, registry: e.authority, name: e.attrs.name, version: e.attrs.version, reference: e.attrs.reference ?? null }));
  const body = {
    format: CONFIG_PATCH,
    baseline: { state_hash: stateHash(base), graph_revision: base.base.graph_revision ?? graph.graph_revision ?? null, snapshot_id: base.base.snapshot_id, snapshot_digest: base.base.snapshot_digest, source_revisions: base.base.source_revisions },
    candidate_state_hash: stateHash(cand), artifact_refs: artifactRefs, changes, inverse, files,
    diff: files.map((f) => unified(f.path, pretty(b.get(f.path) ?? null), f.after)).join(""),
    apply: "not applied: this is a reviewable patch. It can be exported as a file or materialised in a fresh disposable directory; nothing writes the operator checkout or opens a pull request.",
  };
  return { ...body, patch_digest: sha256(canonicalJson(body)) };
}

/**
 * Write a patch into a NEW directory under the OS temp dir (or under `parent`, which must itself be outside the
 * operator checkout). Refuses any location inside `checkout` (default: the process working directory). Writes plain
 * files only; runs nothing.
 */
export function materializePatch(patch: ReturnType<typeof buildPatch>, opts: { parent?: string; checkout?: string } = {}) {
  const checkout = realpathSync(resolve(opts.checkout ?? process.cwd()));
  const parent = realpathSync(resolve(opts.parent ?? tmpdir()));
  const rel = relative(checkout, parent);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("refused: a repair patch is never written inside the operator checkout");
  const dir = mkdtempSync(join(parent, "dk-repair-"));
  for (const f of patch.files) {
    const target = resolve(dir, f.path);
    if (!target.startsWith(dir + "/")) throw new Error(`refused: ${f.path} escapes the disposable directory`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.after, { mode: 0o600 });
  }
  writeFileSync(join(dir, "PATCH.diff"), patch.diff, { mode: 0o600 });
  writeFileSync(join(dir, "BASELINE.json"), pretty({ baseline: patch.baseline, candidate_state_hash: patch.candidate_state_hash, artifact_refs: patch.artifact_refs, patch_digest: patch.patch_digest }), { mode: 0o600 });
  return dir;
}

export function registerRepairRoutes(app: FastifyInstance, d: { store: Store; exploration: Exploration; cases: Cases; authed: (minRole?: Role) => (req: FastifyRequest) => Promise<void>; who: (req: FastifyRequest) => string }) {
  const r = new Repairs(d.store, d.exploration, d.cases);
  const P = (req: FastifyRequest) => (req.params as { p: string }).p;
  const prm = (req: FastifyRequest) => req.params as { id: string; sid: string; cid: string };
  const body = (req: FastifyRequest) => ((req.body && typeof req.body === "object" && !Array.isArray(req.body)) ? req.body : {}) as Record<string, unknown>;
  app.get("/api/repairs/templates", { preHandler: d.authed() }, async () => ({ catalog: REPAIR_TEMPLATE_CATALOG, templates: REPAIR_TEMPLATES }));
  app.post("/api/projects/:p/cases/:id/repairs", { preHandler: d.authed("analyst") }, async (req) => r.generate(d.store.require(req.principal!, P(req), "analyst").id, prm(req).id, body(req), d.who(req)));
  app.get("/api/projects/:p/repairs/:sid", { preHandler: d.authed() }, async (req) => r.get(d.store.require(req.principal!, P(req), "viewer").id, prm(req).sid));
  app.get("/api/projects/:p/repairs/:sid/candidates/:cid/patch", { preHandler: d.authed() }, async (req, reply) => {
    const { candidate } = r.candidate(d.store.require(req.principal!, P(req), "viewer").id, prm(req).sid, prm(req).cid);
    reply.header("content-disposition", `attachment; filename="dk-repair-${prm(req).sid}-${prm(req).cid}.patch.json"`);
    return candidate.patch;
  });
  app.post("/api/projects/:p/repairs/:sid/candidates/:cid/authorization-check", { preHandler: d.authed() }, async (req) => r.authorizationCheck(d.store.require(req.principal!, P(req), "viewer").id, prm(req).sid, prm(req).cid, body(req)));
  return r;
}
export type { Exploration };
