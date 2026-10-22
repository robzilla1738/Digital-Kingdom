export type ReplayInterval = { start: string; end: string };
/** Accepted snapshots may advance the latest rail; historical/custom intervals are user-owned. */
export function syncReplayInterval(current: ReplayInterval, snapshot: ReplayInterval, latest: boolean, custom: boolean): ReplayInterval {
  if (!latest || custom || (current.start === snapshot.start && current.end === snapshot.end)) return current;
  return snapshot;
}
