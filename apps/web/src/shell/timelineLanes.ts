import type { Dataset } from '../lib/data.ts';
import type { ReplayBasis } from '@dk/detections';
import { ACTION_LABEL, EVENT_OUTCOME_COLOR, SEVERITY_COLOR } from '../lib/vocab.ts';
export interface TimelineRecord { id: string; kind: 'finding' | 'event'; time: number; label: string; color: string }
export interface TimelineLane { id: 'findings' | 'events' | 'coverage'; label: string; records: TimelineRecord[] }
/** Only canonical records become markers. Current administrative coverage is never backdated. */
export function timelineLanes(data: Dataset, basis: ReplayBasis, start: number, end: number): TimelineLane[] {
  const inRange = (records: TimelineRecord[]) => records.filter(record => Number.isFinite(record.time) && record.time >= start && record.time <= end).sort((a,b) => a.time-b.time || a.id.localeCompare(b.id));
  const events = data.events.map(event => ({ id:event.id, kind:'event' as const, time:Date.parse(basis === 'known' ? event.received_at : event.occurred_at), label:`${ACTION_LABEL[event.action] ?? event.action} · ${event.source_id} · ${event.id}`, color:EVENT_OUTCOME_COLOR[event.outcome], health:event.action === 'sensor_unavailable' || event.action === 'sensor_restored' }));
  return [
    { id:'findings', label:'Findings', records:inRange(data.findings.map(finding => ({ id:finding.id, kind:'finding', time:Date.parse(basis === 'known' ? finding.last_received : finding.first_seen), label:`${finding.title} · ${finding.id}`, color:SEVERITY_COLOR[finding.severity] }))) },
    { id:'events', label:'Events', records:inRange(events.filter(event => !event.health)) },
    { id:'coverage', label:'Health records', records:inRange(events.filter(event => event.health)) },
  ];
}

/** Dense marks are explicit time buckets; the exact record selector remains lossless. */
export function aggregateTimelineRecords(records: TimelineRecord[], start: number, end: number, bins = 24) {
  const grouped = new Map<number, TimelineRecord[]>();
  records.forEach((record, index) => {
    const key = records.length <= bins ? index : Math.min(bins-1, Math.max(0, Math.floor((record.time-start)/Math.max(1,end-start)*bins)));
    grouped.set(key, [...(grouped.get(key) ?? []),record]);
  });
  return [...grouped.values()].map(items => ({ records:items, time:(items[0]!.time+items.at(-1)!.time)/2, count:items.length }));
}
