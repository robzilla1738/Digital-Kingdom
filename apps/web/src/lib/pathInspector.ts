/** LP13 `dk.path_explanation.v1` (fields the console reads) and the one presentation rule for path hops. */
export interface PathHop { kind: "relationship" | "permission"; from: string; to: string; ref: string; relationship_kind?: string; evidence_level?: string; result?: string; basis: string; observed: boolean; provenance: string[]; condition_keys: string[]; presentation: { animate: boolean; line: string } }
export interface PathExplanation {
  schema: "dk.path_explanation.v1"; namespace: string; from: string; to: string; evaluator: string; state_hash: string;
  reachable: "observed_path_exists" | "declared_path_exists" | "no_declared_path_found" | "unresolved";
  paths: { hops: PathHop[]; result: string }[]; unresolved_prerequisites: string[];
  permission: null | { result: string; paths: { hops: PathHop[]; result: string; reasons: string[]; unsupported: string[] }[]; unresolved_prerequisites: string[] };
  note: string;
}
/**
 * The console animates a hop only when it is observed activity with evidence references. This is enforced here as
 * well as on the server: configured permission (feasible or conditional), declared, inferred and proposed links are
 * never drawn as observed use, whatever a response says.
 */
export function hopStyle(h: PathHop): { animate: boolean; label: string; dash: string } {
  const observed = h.kind === "relationship" && h.basis === "observed_activity" && h.observed && h.provenance.length > 0;
  if (observed) return { animate: true, label: "observed activity", dash: "" };
  if (h.kind === "permission") return { animate: false, label: h.result === "conditional" ? "conditional permission (conditions not evaluated)" : `configured permission: ${h.result ?? "unresolved"}`, dash: h.result === "conditional" ? "2 4" : "6 3 1 3" };
  if (h.basis === "proposed_relationship") return { animate: false, label: "proposed (candidate only)", dash: "1 4" };
  return { animate: false, label: h.basis === "inferred_relationship" ? "inferred relationship" : "declared relationship", dash: h.basis === "inferred_relationship" ? "10 4 2 4" : "8 5" };
}
export const REACHABLE_LABEL: Record<PathExplanation["reachable"], string> = {
  observed_path_exists: "An observed path exists", declared_path_exists: "Declared path (not observed end to end)", no_declared_path_found: "No declared path found (not proof none exists)", unresolved: "Unresolved",
};
