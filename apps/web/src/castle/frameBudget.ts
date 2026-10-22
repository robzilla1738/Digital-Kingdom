/** Demand-mode idle gaps are not frame-time samples. Only successive active camera frames count. */
export type FrameBudget = { active: boolean; samples: number; slow: number };
export function sampleFrameBudget(state: FrameBudget, seconds: number, active: boolean): { state: FrameBudget; reduce: boolean } {
  if (!active || !state.active) return { state: { active, samples: 0, slow: 0 }, reduce: false };
  if (!Number.isFinite(seconds) || seconds <= 0.005) return { state, reduce: false };
  const samples = Math.min(90, state.samples + 1);
  const slow = seconds > 0.25 ? state.slow + 3 : seconds > 0.05 ? state.slow + 1 : Math.max(0, state.slow - 1);
  const reduce = samples >= 20 && slow >= 18;
  return { state: { active, samples: reduce ? 0 : samples, slow: reduce ? 0 : slow }, reduce };
}
