/**
 * Pure scoring primitives for the planned v2 harness. No provider calls, file writes, or v1 rescoring.
 * Judgments about claim support must be supplied by a reviewer, never inferred from identifier existence.
 */
export type ObjectiveStatus = "passed" | "failed" | "unexercised" | "pending_review" | "invalid_case";
export interface ObjectiveInput {
  id: string;
  kind: "retrieval" | "reasoning";
  /** Required evidence was reachable under the attempt's actual credentials/condition. */
  reachable: boolean;
  /** Relevant evidence appeared in this attempt's visible tool results/bundle. Not proof of attention. */
  exposed: boolean;
  /** For reasoning only: supplied claim-support/behavior judgment. No label implies pending review. */
  judgment?: "passed" | "failed";
}
export interface ObjectiveResult { id: string; kind: ObjectiveInput["kind"]; status: ObjectiveStatus; reason: string }
export function scoreObjective(input: ObjectiveInput): ObjectiveResult {
  if (!input.id.trim()) throw new Error("objective id is required");
  if (!input.reachable) return { id: input.id, kind: input.kind, status: "invalid_case", reason: "Required evidence was unreachable; preflight must reject the case, not score an agent pass." };
  if (input.kind === "retrieval") return { id: input.id, kind: input.kind, status: input.exposed ? "passed" : "failed", reason: input.exposed ? "Required evidence was returned in the attempt." : "Reachable required evidence was not retrieved." };
  if (!input.exposed) return { id: input.id, kind: input.kind, status: "unexercised", reason: "Reasoning was not exercised because required evidence was not returned. This is not a task success." };
  return { id: input.id, kind: input.kind, status: input.judgment ?? "pending_review", reason: input.judgment ? "Reviewer judgment supplied; reviewer identity and supporting rationale belong in the attempt record." : "Evidence was available, but semantic judgment is still pending." };
}
export function summarizeObjectives(results: readonly ObjectiveResult[]) {
  if (!results.length) throw new Error("cannot score an attempt with no required objectives");
  if (new Set(results.map((r) => r.id)).size !== results.length) throw new Error("duplicate objective ids");
  const count = (status: ObjectiveStatus) => results.filter((r) => r.status === status).length;
  const counts = { passed: count("passed"), failed: count("failed"), unexercised: count("unexercised"), pending_review: count("pending_review"), invalid_case: count("invalid_case") };
  const status = counts.invalid_case ? "invalid_case" : counts.failed || counts.unexercised ? "unsuccessful" : counts.pending_review ? "pending_review" : "successful";
  const retrieval = results.filter((r) => r.kind === "retrieval" && r.status !== "invalid_case");
  const reasoning = results.filter((r) => r.kind === "reasoning");
  const judged = reasoning.filter((r) => r.status === "passed" || r.status === "failed");
  return {
    status, successful: status === "successful", objectives: results.length, counts,
    retrieval: { passed: retrieval.filter((r) => r.status === "passed").length, denominator: retrieval.length },
    reasoning_when_judged: { passed: judged.filter((r) => r.status === "passed").length, denominator: judged.length, unexercised: reasoning.filter((r) => r.status === "unexercised").length, pending_review: reasoning.filter((r) => r.status === "pending_review").length },
    note: "Conditional reasoning accuracy is not end-to-end task success. Required unexercised objectives cannot disappear from the task denominator.",
  };
}
