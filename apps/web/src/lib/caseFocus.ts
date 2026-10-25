import type { Workbench } from "./workbench.ts";

type Obligation = Workbench["evidence_questions"][number];
const ORDER: Record<string, number> = { failed: 0, partial: 1, not_started: 2, unavailable: 3 };
/**
 * next-C: the next evidence obligation to work on, for the case focus strip. Failed and partial obligations come
 * before untouched ones; unavailable (no coverage to answer it) last, but still named, never hidden. Satisfied and
 * reasoned-inapplicable obligations are done. Ties keep the server's order.
 */
export function nextObligation(obligations: readonly Obligation[]): Obligation | null {
  let best: Obligation | null = null, rank = Infinity;
  for (const o of obligations) { const r = ORDER[o.status]; if (r !== undefined && r < rank) { best = o; rank = r; } }
  return best;
}
