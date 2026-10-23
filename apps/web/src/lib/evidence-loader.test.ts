import { describe,it,expect } from 'vitest';
import { loadFindingEvidence } from './evidence-loader.ts';
import { Api,ApiError,loadOfflineDemo } from './data.ts';

describe('bounded exact finding evidence loader',()=>{
 const data=loadOfflineDemo(),finding=data.findings[0]!,event=data.events[0]!;
 const detail={finding:{...finding,event_ids:[event.id,'second'],counterevidence_event_ids:[]},revisions:[],notes:[]};
 it('retains first page when second fails and never mutates dataset evidence',async()=>{
  let calls=0;const api={get:async(path:string)=>{calls++;if(!path.includes('/evidence?'))return detail;if(path.includes('offset=0'))return{expected_event_count:2,events:[event],evidence:{one:{text:'retained'}},missing_event_ids:[],missing_evidence_refs:[],next_offset:500};throw new ApiError(503,'injected page failure');}} as unknown as Api;
  const r=await loadFindingEvidence(api,'project',finding.id);
  expect(r.events).toEqual([event]);expect(r.evidence.one).toEqual({text:'retained'});expect(r.complete).toBe(false);expect(r.error).toContain('after 1 loaded');expect(calls).toBe(4);
 });
 it('rejects authorization failure rather than retaining sensitive pages',async()=>{
  const api={get:async(path:string)=>{if(!path.includes('/evidence?'))return detail;throw new ApiError(403,'denied');}} as unknown as Api;
  await expect(loadFindingEvidence(api,'project',finding.id)).rejects.toMatchObject({status:403});
 });
 it('detects a finding revision changing during paging',async()=>{
  let detailCalls=0;const api={get:async(path:string)=>{if(!path.includes('/evidence?'))return{...detail,finding:{...detail.finding,revision:++detailCalls}};return{expected_event_count:1,events:[event],evidence:{},missing_event_ids:[],missing_evidence_refs:[],next_offset:null};}} as unknown as Api;
  const r=await loadFindingEvidence(api,'project',finding.id);expect(r.revisionChanged).toBe(true);expect(r.complete).toBe(false);expect(r.events).toHaveLength(1);
 });
 it('marks exact missing references incomplete and propagates cancellation',async()=>{
  const api={get:async(path:string)=>path.includes('/evidence?')?{expected_event_count:2,events:[event],evidence:{},missing_event_ids:['second'],missing_evidence_refs:['evidence:missing'],next_offset:null}:detail} as unknown as Api;
  const r=await loadFindingEvidence(api,'project',finding.id);expect(r.missingEvents).toEqual(['second']);expect(r.complete).toBe(false);
  const controller=new AbortController();controller.abort();const abort={get:async()=>{throw new DOMException('aborted','AbortError');}} as unknown as Api;
  await expect(loadFindingEvidence(abort,'project',finding.id,controller.signal)).rejects.toMatchObject({name:'AbortError'});
 });
});

describe('immutable bundle evidence', () => {
 it('withholds changed records and rejects pages from another bundle', async () => {
  const { loadBundleEvidence } = await import('./evidence-loader.ts');
  const bundle = { bundle_id: 'pinned', bundle_digest: 'digest', finding_revision: 1, reference_count: 1 };
  const page = { ...bundle, events: [], evidence: {}, missing_events: [], changed_event_ids: ['changed'], missing_evidence_refs: [], page: { has_more: false, total_references: 1 } };
  const api = { get: async () => page } as unknown as Api;
  const result = await loadBundleEvidence(api, 'project', bundle);
  expect(result.complete).toBe(false); expect(result.events).toEqual([]); expect(result.missingEvents).toEqual(['changed']);
  const wrong = await loadBundleEvidence({ get: async () => ({ ...page, bundle_digest: 'other' }) } as unknown as Api, 'project', bundle);
  expect(wrong.error).toMatch(/does not match/);
 });
 it('does not retain bundle data after access is revoked', async () => {
  const { loadBundleEvidence } = await import('./evidence-loader.ts');
  const api = { get: async () => { throw new ApiError(403, 'denied'); } } as unknown as Api;
  await expect(loadBundleEvidence(api, 'project', { bundle_id: 'b', bundle_digest: 'd', finding_revision: 1, reference_count: 1 })).rejects.toMatchObject({ status: 403 });
 });
});
