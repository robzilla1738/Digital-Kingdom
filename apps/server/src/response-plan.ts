import type { Graph } from "@dk/contracts";
import { digest } from "@dk/contracts";
import { HttpError } from "./store.ts";
import type { ContainmentAction } from "./containment.ts";

/**
 * Exact response plans (roadmap R08.2). A plan pins WHAT would be done: targets (asset ids with their provider
 * ids), parameters, the artifact digest when relevant, a state fingerprint of the targets, the evidence bundle
 * reviewed, the policy revision, a TTL and the computed blast radius. Its digest is part of what an approval binds,
 * so changing any of these needs fresh approval. Reversibility comes from the action, with compensation steps for
 * irreversible actions (a revoked key cannot be un-revoked; it is replaced). There is no executor and no generic
 * command: an action without a typed plan schema is refused, never turned into a shell step.
 */
export interface ResponsePlan {
  schema: "dk.response_plan.v1"; action_id: string;
  targets: { asset_id: string; provider_id: string | null }[];
  parameters: Record<string, string | number | boolean>;
  artifact_digest: string | null;
  state_fingerprint: string; evidence_bundle_id: string | null; policy_revision: string;
  ttl_seconds: number; blast_radius: { declared: string; downstream_asset_ids: string[] };
  reversibility: { reversible: boolean; rollback: string[]; compensation: string[] };
  verification: { effect_observer_source_ids: string[]; verified_success_possible: boolean; reason: string };
  digest: string;
}

/** Typed parameter schemas per action. Anything not listed here is unsupported. */
const PARAMS: Record<string, Record<string, "string" | "number" | "boolean">> = {
  "edge.tighten_rate_limit": { route: "string", requests_per_minute: "number" },
  "edge.block_source_range": { cidr: "string", duration_minutes: "number" },
  "auth.force_reauth": { account_ref: "string" },
  "auth.revert_privilege_change": { account_ref: "string", grant: "string" },
  "secrets.rotate_credentials": { credential_ref: "string" },
  "agent.suspend_tool": { tool: "string" },
  "deploy.pause_rollout": { reason: "string" },
  "data.restrict_access": { principal_ref: "string" },
};
const COMPENSATION: Record<string, string[]> = {
  "secrets.rotate_credentials": ["A revoked credential cannot be restored: issue a new credential to every legitimate consumer.", "Confirm each consumer works with the new credential."],
};

export function targetFingerprint(graph: Graph, assetIds: string[], artifactDigest: string | null) {
  const assets = assetIds.map((id) => graph.assets.find((a) => a.id === id)).map((a) => a ? { id: a.id, kind: a.kind, environment: a.environment, provider: a.provider_ref ?? null, lifecycle: a.lifecycle ?? "active" } : null);
  return digest({ assets, artifactDigest });
}

export function buildPlan(input: { action: ContainmentAction; graph: Graph; targets: unknown; parameters: unknown; artifact_digest?: unknown; evidence_bundle_id?: unknown; policy_revision: string; ttl_seconds?: unknown; effectObservers: (assetIds: string[]) => string[] }): ResponsePlan {
  const schema = PARAMS[input.action.id];
  if (!schema) throw new HttpError(422, `${input.action.id} has no typed plan; unsupported actions are never turned into commands`);
  if (!Array.isArray(input.targets) || !input.targets.length || input.targets.length > 20) throw new HttpError(400, "targets must list 1 to 20 asset ids");
  const targets = input.targets.map((t) => {
    const a = input.graph.assets.find((x) => x.id === t);
    if (!a) throw new HttpError(422, `unknown target ${String(t)}`);
    if (!input.action.applies_to_kinds.includes(a.kind)) throw new HttpError(422, `${input.action.id} does not apply to ${a.kind} ${a.id}`);
    return { asset_id: a.id, provider_id: a.provider_ref?.id ?? null };
  });
  const p = (input.parameters ?? {}) as Record<string, unknown>;
  const extra = Object.keys(p).filter((k) => !(k in schema));
  if (extra.length) throw new HttpError(422, `unsupported parameters: ${extra.join(", ")}`);
  const parameters: ResponsePlan["parameters"] = {};
  for (const [k, type] of Object.entries(schema)) {
    if (typeof p[k] !== type) throw new HttpError(422, `parameter ${k} must be a ${type}`);
    if (type === "string" && (String(p[k]).length > 200 || /[;&|`$<>\n]/.test(String(p[k])))) throw new HttpError(422, `parameter ${k} contains characters that are never accepted`);
    parameters[k] = p[k] as string | number | boolean;
  }
  const art = typeof input.artifact_digest === "string" ? (/^sha256:[0-9a-f]{64}$/.test(input.artifact_digest) ? input.artifact_digest : (() => { throw new HttpError(422, "artifact_digest must be sha256:<64 hex>"); })()) : null;
  const ids = targets.map((t) => t.asset_id);
  const downstream = new Set<string>();
  const frontier = [...ids];
  while (frontier.length && downstream.size < 200) { const cur = frontier.shift()!; for (const r of input.graph.relationships) if (r.source_id === cur && !ids.includes(r.target_id) && !downstream.has(r.target_id)) { downstream.add(r.target_id); frontier.push(r.target_id); } }
  const obs = input.effectObservers(ids);
  const ttl = typeof input.ttl_seconds === "number" && input.ttl_seconds >= 60 && input.ttl_seconds <= 86_400 ? input.ttl_seconds : 3600;
  const body = {
    schema: "dk.response_plan.v1" as const, action_id: input.action.id, targets, parameters, artifact_digest: art,
    state_fingerprint: targetFingerprint(input.graph, ids, art), evidence_bundle_id: typeof input.evidence_bundle_id === "string" ? input.evidence_bundle_id.slice(0, 80) : null,
    policy_revision: input.policy_revision, ttl_seconds: ttl, blast_radius: { declared: input.action.blast_radius, downstream_asset_ids: [...downstream].sort() },
    reversibility: { reversible: input.action.reversible, rollback: input.action.reversible ? input.action.runbook.filter((s) => /restore|revert|re-?enable|remove|lift|resume|undo/i.test(s)) : [], compensation: input.action.reversible ? [] : (COMPENSATION[input.action.id] ?? ["This action cannot be undone; plan a compensating change before approval."]) },
    verification: { effect_observer_source_ids: obs, verified_success_possible: obs.length > 0, reason: obs.length ? "an independent effect observer covers the targets" : "no independent effect observer covers the targets: success could only be reported, never verified" },
  };
  return { ...body, digest: digest(body) };
}

/** Recheck immediately before execution or after drift: same targets, state and policy, within TTL. */
export function precheck(plan: ResponsePlan, current: { graph: Graph; policy_revision: string; now: Date; created_at: string }) {
  const problems: string[] = [];
  const fp = targetFingerprint(current.graph, plan.targets.map((t) => t.asset_id), plan.artifact_digest);
  if (fp !== plan.state_fingerprint) problems.push("target state changed since the plan was made (provider id, environment, lifecycle or artifact)");
  for (const t of plan.targets) { const a = current.graph.assets.find((x) => x.id === t.asset_id); if (!a) problems.push(`target ${t.asset_id} no longer exists`); else if ((a.provider_ref?.id ?? null) !== t.provider_id) problems.push(`target ${t.asset_id} is a different provider resource now`); }
  if (current.policy_revision !== plan.policy_revision) problems.push("containment policy changed since the plan was made");
  if (current.now.getTime() > Date.parse(current.created_at) + plan.ttl_seconds * 1000) problems.push("the plan's TTL has passed");
  return { ok: problems.length === 0, problems, verified_success_possible: plan.verification.verified_success_possible, executor: "none: Digital Kingdom does not execute response actions" };
}
