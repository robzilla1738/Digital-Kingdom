import { toMs, type Graph, type SecurityEvent } from "@dk/contracts";
import { graphAsOf } from "@dk/graph-core";
import { evaluate, type EvaluateOptions, type EvaluationResult } from "./rules.ts";

export type ReplayBasis = "occurred" | "known";

/**
 * Evidence state at a moment. "occurred" replays what happened by event time; "known" replays what the
 * system knew by receive time, so late arrivals visibly revise history instead of silently rewriting it.
 * Topology comes from the graph as of that moment (tombstoned assets stay available to old cases).
 */
export function stateAt(graph: Graph, events: SecurityEvent[], atIso: string, basis: ReplayBasis = "occurred", opts: EvaluateOptions = {}): EvaluationResult & { events: SecurityEvent[]; late_event_ids: string[] } {
  const t = toMs(atIso);
  const subset = events.filter((e) => toMs(basis === "occurred" ? e.occurred_at : e.received_at) <= t);
  const late = subset.filter((e) => toMs(e.received_at) - toMs(e.occurred_at) > 60_000).map((e) => e.id);
  const { now: _ignored, ...rest } = opts;
  return { ...evaluate(graphAsOf(graph, atIso), subset, rest), events: subset, late_event_ids: late };
}
