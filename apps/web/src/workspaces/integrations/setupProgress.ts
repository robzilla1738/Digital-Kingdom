import type { Dataset } from '../../lib/data.ts';

/** Server observations, never locally checked steps or an assertion of protection. */
export function setupProgress(data: Pick<Dataset, 'graph' | 'sources' | 'events' | 'coverage'>) {
  const inventory = data.graph.assets.length > 0;
  const source = data.sources.length > 0;
  const receipt = data.events.length > 0 || data.coverage.some(record => !!record.last_event_at);
  return { inventory, source, receipt, complete: inventory && source && receipt };
}
