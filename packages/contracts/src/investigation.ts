import investigationContractSchema from "../schemas/local/investigation-contract.v1.schema.json" with { type: "json" };
import conclusionSchema from "../schemas/local/conclusion.v1.schema.json" with { type: "json" };
import * as generated from "./generated/validators.js";
import { formatErrors, type ValidationResult } from "./validate.ts";
import type { EventAction } from "./types.ts";

/**
 * Local Intelligence Phase investigation contracts (LP08) and structured conclusions (LP08/LP10).
 *
 * Adopted from the phase package proposals (`dk.local.investigation_contract.proposed.v1`,
 * `dk.local.conclusion.proposed.v1`) the same way LP03 adopted its contracts: ids drop `proposed`, every object rejects
 * unknown fields, and the semantic checks below add what JSON Schema cannot express. A proposal-id document is
 * rejected until migrated by changing only `schema`.
 *
 * Schemas enforce shape. Whether an obligation was really satisfied by scoped evidence, whether a cited record was
 * really delivered, and whether a claim is supported are decided by the server's deterministic checkers, never by a
 * document asserting it.
 */
export const INVESTIGATION_CONTRACTS = {
  investigation_contract: "dk.local.investigation_contract.v1",
  conclusion: "dk.local.conclusion.v1",
  obligation_catalog: "dk.obligation_catalog.v1",
} as const;

export const OBLIGATION_STATUSES = ["not_started", "running", "satisfied", "partial", "unavailable", "inapplicable_with_reason", "failed"] as const;
export type ObligationState = (typeof OBLIGATION_STATUSES)[number];
export const OBLIGATION_KINDS = ["retrieve_activity", "coverage", "recipe", "bundle_integrity", "linked_events"] as const;
export type ObligationKind = (typeof OBLIGATION_KINDS)[number];
export const READINESS = ["not_started", "collecting", "bounded_answer_ready", "unresolved_answer_ready", "blocked"] as const;
export type Readiness = (typeof READINESS)[number];

export interface ContractObligation {
  id: string; kind: ObligationKind; question: string;
  target: { asset_id?: string; action?: EventAction; finding_id?: string; finding_revision?: number; bundle_id?: string; recipe?: string; event_ids?: string[] };
  basis: string; status: ObligationState; evidence_refs: string[]; evidence_ref_count?: number; query_refs: string[]; reason: string;
  supports_negative_claims: boolean; decided_at_revision?: number;
  validity?: { snapshot_seq?: number; matched?: number; source_config_revisions?: Record<string, number>; finding_revision?: number; bundle_digest?: string; digest?: string };
}
export interface InvestigationContract {
  schema: "dk.local.investigation_contract.v1"; id: string; case_id: string; project_id: string; run_id: string | null; revision: number;
  question: string; scope: { asset_ids: string[]; after: string; before: string };
  derivation: { catalog: "dk.obligation_catalog.v1"; case_version: number; graph_revision: string | null; recipes: string[]; inputs: string[]; inputs_digest: string };
  obligations: ContractObligation[];
  negative_claim_requirements: { id: string; asset_id: string; action: EventAction; requires: string[]; assessable: boolean; reason: string }[];
  closure_prerequisites: { id: string; requirement: string; met: boolean; reason: string }[];
  readiness: Readiness; readiness_reason: string; snapshot_refs: string[]; private_truth_access: false;
}
export type ClaimType = "observed" | "not_observed_in_scope" | "hypothesis" | "unresolved";
export interface ConclusionClaim {
  id: string; type: ClaimType; text: string; evidence_refs: string[]; coverage_refs: string[]; obligation_ids: string[]; uncertainty: string;
  predicate?: { kind: "action_observed" | "action_not_observed"; asset_id: string; action: EventAction; outcome?: string; actor_ref?: string; after?: string; before?: string };
}
export interface Conclusion {
  schema: "dk.local.conclusion.v1"; case_id: string; run_id: string | null; contract_revision: number; claims: ConclusionClaim[];
  status: "draft" | "machine_checked_structured" | "unresolved" | "rejected"; semantic_review: "not_reviewed" | "ai_advisory"; scope_note: string;
  requested_next_step: "retrieve_more" | "inspect_configuration" | "compare_repairs" | "request_local_lease" | "bounded_conclusion";
}

/** Longest interval a contract may cover (the event-search interval bound). */
export const CONTRACT_MAX_INTERVAL_DAYS = 31;
const DONE: ObligationState[] = ["satisfied", "inapplicable_with_reason"];
const TERMINAL_GAP: ObligationState[] = ["unavailable", "partial"];

/**
 * Readiness from obligation states alone (shared by the server and the validator so they cannot disagree).
 * `resumable` names partial obligations that still have committed work to continue (a continuation cursor or an
 * unspent plan); those keep the contract collecting. `unresolved_answer_ready` needs every obligation attempted:
 * it is never an escape hatch for work that was not tried.
 */
export function deriveReadiness(obligations: Pick<ContractObligation, "id" | "status" | "reason">[], resumable: ReadonlySet<string> = new Set()): { readiness: Readiness; reason: string } {
  const by = (s: ObligationState) => obligations.filter((o) => o.status === s);
  if (obligations.every((o) => o.status === "not_started")) return { readiness: "not_started", reason: `${obligations.length} obligation(s), none attempted yet.` };
  const open = obligations.filter((o) => o.status === "not_started" || o.status === "running" || (o.status === "partial" && resumable.has(o.id)));
  if (open.length) return { readiness: "collecting", reason: `${open.length} obligation(s) still open: ${open.slice(0, 5).map((o) => `${o.id} (${o.status}${o.status === "partial" ? ", resumable" : ""})`).join(", ")}${open.length > 5 ? ", ..." : ""}.` };
  const failed = by("failed");
  if (failed.length) return { readiness: "blocked", reason: `${failed.length} obligation(s) failed and need a retry or an inapplicability decision: ${failed.slice(0, 5).map((o) => o.id).join(", ")}.` };
  const gaps = obligations.filter((o) => TERMINAL_GAP.includes(o.status));
  if (!gaps.length) return { readiness: "bounded_answer_ready", reason: "Every obligation is satisfied by scoped evidence or documented as inapplicable. A bounded answer about observable propositions is possible; intent and authorization still need records outside the telemetry." };
  return { readiness: "unresolved_answer_ready", reason: `Every obligation was attempted; ${gaps.length} could not be met (${gaps.slice(0, 5).map((o) => `${o.id}: ${o.reason || o.status}`).join("; ")}). Only an unresolved answer is honest for the parts those obligations bear on (absence of those actions on those assets, in their uncovered spans); recorded observations, other assets and actions, and covered sub-intervals stay answerable.` };
}

const g = generated as unknown as Record<string, ((d: unknown) => boolean) & { errors?: unknown }>;
const schemaCheck = <T>(fn: ((d: unknown) => boolean) & { errors?: unknown }, data: unknown): ValidationResult<T> => fn(data) ? { ok: true, value: data as T, errors: [] } : { ok: false, errors: formatErrors(fn.errors as never) };
const withSemantics = <T>(r: ValidationResult<T>, sem: (v: T) => string[]): ValidationResult<T> => { if (!r.ok) return r; const e = sem(r.value!); return e.length ? { ok: false, errors: e } : r; };

export function validateInvestigationContract(d: unknown): ValidationResult<InvestigationContract> {
  return withSemantics(schemaCheck<InvestigationContract>(g.validateInvestigationContract!, d), (c) => {
    const errors: string[] = [];
    const a = Date.parse(c.scope.after), b = Date.parse(c.scope.before);
    if (!(b > a)) errors.push("/scope interval must be ordered: before later than after");
    else if (b - a > CONTRACT_MAX_INTERVAL_DAYS * 86_400_000) errors.push(`/scope interval longer than ${CONTRACT_MAX_INTERVAL_DAYS} days`);
    if (new Set(c.scope.asset_ids).size !== c.scope.asset_ids.length) errors.push("/scope duplicate asset id");
    const ids = c.obligations.map((o) => o.id);
    for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) errors.push(`/obligations duplicate obligation id ${id}`);
    for (const [i, o] of c.obligations.entries()) {
      if (o.status === "satisfied" && !o.query_refs.length) errors.push(`/obligations/${i} satisfied requires the query/step references that satisfied it`);
      if (o.status === "inapplicable_with_reason" && o.reason.trim().length < 10) errors.push(`/obligations/${i} inapplicable_with_reason requires a documented reason (at least 10 characters)`);
      if ((o.status === "unavailable" || o.status === "partial" || o.status === "failed") && !o.reason.trim()) errors.push(`/obligations/${i} ${o.status} requires a reason`);
      if (o.target.asset_id && !c.scope.asset_ids.includes(o.target.asset_id)) errors.push(`/obligations/${i} target asset ${o.target.asset_id} is outside the contract scope`);
      if (o.kind === "coverage" && (!o.target.asset_id || !o.target.action)) errors.push(`/obligations/${i} coverage obligation needs target asset_id and action`);
      if (o.kind === "retrieve_activity" && !o.target.asset_id) errors.push(`/obligations/${i} retrieve_activity obligation needs target asset_id`);
    }
    for (const [i, n] of c.negative_claim_requirements.entries()) {
      for (const r of n.requires) if (!ids.includes(r)) errors.push(`/negative_claim_requirements/${i} requires absent obligation ${r}`);
      if (n.assessable && n.requires.some((r) => c.obligations.find((o) => o.id === r)?.status !== "satisfied")) errors.push(`/negative_claim_requirements/${i} assessable requires every required obligation satisfied`);
    }
    const derived = deriveReadiness(c.obligations).readiness;
    const allowed: Record<Readiness, Readiness[]> = {
      not_started: ["not_started"], collecting: ["collecting"], blocked: ["blocked", "collecting"],
      bounded_answer_ready: ["bounded_answer_ready"],
      // a partial obligation may still be resumable, which the document alone cannot show
      unresolved_answer_ready: ["unresolved_answer_ready", "collecting"],
    };
    if (!allowed[derived].includes(c.readiness)) errors.push(`/readiness ${c.readiness} is inconsistent with obligation states (derived ${derived})`);
    if (c.readiness === "bounded_answer_ready" && c.obligations.some((o) => !DONE.includes(o.status))) errors.push("/readiness bounded_answer_ready requires every obligation satisfied or inapplicable_with_reason");
    return [...new Set(errors)];
  });
}

export function validateConclusion(d: unknown): ValidationResult<Conclusion> {
  return withSemantics(schemaCheck<Conclusion>(g.validateConclusion!, d), (c) => {
    const errors: string[] = [];
    const ids = c.claims.map((x) => x.id);
    if (new Set(ids).size !== ids.length) errors.push("/claims duplicate claim id");
    for (const [i, cl] of c.claims.entries()) {
      if (cl.predicate) {
        if (cl.predicate.kind === "action_observed" && cl.type !== "observed") errors.push(`/claims/${i} an action_observed predicate belongs to an observed claim`);
        if (cl.predicate.kind === "action_not_observed" && cl.type !== "not_observed_in_scope") errors.push(`/claims/${i} an action_not_observed predicate belongs to a not_observed_in_scope claim`);
        if (cl.predicate.after && cl.predicate.before && !(Date.parse(cl.predicate.before) > Date.parse(cl.predicate.after))) errors.push(`/claims/${i} predicate interval must be ordered`);
      }
    }
    return errors;
  });
}

export const investigationSchemas = { investigationContract: investigationContractSchema, conclusion: conclusionSchema };
