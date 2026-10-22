import { describe, expect, it } from 'vitest';
import { loadOfflineDemo } from '../lib/data.ts';
import { aggregateTimelineRecords, timelineLanes } from './timelineLanes.ts';
describe('expanded timeline canonical record lanes', () => {
  it('separates findings, ordinary events and recorded source-health changes with exact identifiers', () => {
    const data=loadOfflineDemo(), lanes=timelineLanes(data,'occurred',Date.parse(data.window.start),Date.parse(data.window.end));
    expect(lanes.map(lane=>lane.id)).toEqual(['findings','events','coverage']);
    expect(lanes[0]!.records.every(record=>data.findings.some(f=>f.id===record.id))).toBe(true);
    expect(lanes[2]!.records.length).toBeGreaterThan(0);
    expect(lanes[2]!.records.every(record=>data.events.some(e=>e.id===record.id && /sensor_/.test(e.action)))).toBe(true);
    expect(lanes[1]!.records.some(record=>lanes[2]!.records.some(health=>health.id===record.id))).toBe(false);
  });
  it('uses received timestamps for known-time markers and bounds every lane', () => {
    const data=loadOfflineDemo(), cutoff=Date.parse(data.window.start);
    const lanes=timelineLanes(data,'known',cutoff,cutoff+1);
    expect(lanes.every(lane=>lane.records.length===0)).toBe(true);
    const all=timelineLanes(data,'known',0,Infinity);
    expect(all[0]!.records[0]!.time).toBe(Date.parse(data.findings.find(f=>f.id===all[0]!.records[0]!.id)!.last_received));
    expect(all[1]!.records[0]!.time).toBe(Date.parse(data.events.find(e=>e.id===all[1]!.records[0]!.id)!.received_at));
  });
  it('does not invent historical markers from current disabled metadata or coverage summaries', () => {
    const data=loadOfflineDemo();data.events=[];data.findings=[];data.sources=data.sources.map(source=>({...source,disabled:true}));
    expect(timelineLanes(data,'occurred',0,Infinity).every(lane=>lane.records.length===0)).toBe(true);
  });
  it('aggregates dense marks without losing or inventing exact records', () => {
    const records=Array.from({length:1000},(_,i)=>({id:`event-${i}`,kind:'event' as const,time:i,label:`Record ${i}`,color:'#ffffff'}));
    const marks=aggregateTimelineRecords(records,0,999);
    expect(marks.length).toBeLessThanOrEqual(24);
    expect(marks.reduce((count,mark)=>count+mark.count,0)).toBe(1000);
    expect(marks.flatMap(mark=>mark.records.map(record=>record.id))).toEqual(records.map(record=>record.id));
  });

});
