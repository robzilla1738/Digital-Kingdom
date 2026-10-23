import { Api, ApiError, type Dataset } from './data.ts';
import type { FindingDetailResult, FindingEvidenceResult } from './investigation.ts';
/** Existing server evidence pages are not revision-pinned. Bracket retrieval with revision checks,
 * retain any prior successful pages, and never present a changing/error bundle as complete. */
export async function loadFindingEvidence(api: Api, projectId: string, id: string, signal?: AbortSignal): Promise<FindingEvidenceResult> {
 const path=`/api/projects/${encodeURIComponent(projectId)}/findings/${encodeURIComponent(id)}`;
 const initial=await api.get<FindingDetailResult>(path,signal);
 type Page={expected_event_count:number;events:Dataset['events'];evidence:Dataset['evidence'];missing_event_ids:string[];missing_evidence_refs:string[];next_offset:number|null};
 const result:FindingEvidenceResult={events:[],evidence:{},expected:new Set([...initial.finding.event_ids,...initial.finding.counterevidence_event_ids]).size,missingEvents:[],missingEvidence:[],complete:false,revision:initial.finding.revision};
 let offset:number|null=0;
 const visited=new Set<number>();
 while(offset!==null&&result.events.length<5000){
  if(visited.has(offset)){result.error='Evidence pagination did not advance. Loaded records retained; bundle incomplete.';break;}visited.add(offset);
  try {
   const page:Page=await api.get<Page>(`${path}/evidence?offset=${offset}&limit=500`,signal);
   result.expected=page.expected_event_count;result.events.push(...page.events);Object.assign(result.evidence,page.evidence);
   result.missingEvents.push(...page.missing_event_ids);result.missingEvidence.push(...page.missing_evidence_refs);offset=page.next_offset;
  }catch(error){
   if(signal?.aborted||(error instanceof ApiError&&(error.status===401||error.status===403)))throw error;
   result.error=`Evidence retrieval failed after ${result.events.length} loaded records: ${(error as Error).message}`;break;
  }
 }
 if(offset!==null&&!result.error)result.error='Evidence retrieval reached the 5,000-record browser bound. Bundle incomplete.';
 try {
  const latest=await api.get<FindingDetailResult>(path,signal);
  if(latest.finding.revision!==initial.finding.revision){result.revisionChanged=true;result.error='Finding revision changed during evidence retrieval. Loaded records retained for inspection; refresh before drawing conclusions.';}
 }catch(error){if(signal?.aborted||(error instanceof ApiError&&(error.status===401||error.status===403)))throw error;result.error??='Could not verify the final finding revision. Bundle incomplete.';}
 result.events=[...new Map(result.events.map(e=>[e.id,e])).values()];
 result.missingEvents=[...new Set(result.missingEvents)];result.missingEvidence=[...new Set(result.missingEvidence)];
 result.complete=offset===null&&!result.error&&!result.missingEvents.length&&!result.missingEvidence.length&&result.events.length===result.expected;
 return result;
}

/** Read only records whose digests still match an immutable server bundle. */
export async function loadBundleEvidence(api: Api, projectId: string, bundle: { bundle_id: string; bundle_digest: string; finding_revision: number; reference_count: number }, signal?: AbortSignal): Promise<FindingEvidenceResult> {
 const path = `/api/projects/${encodeURIComponent(projectId)}/bundles/${encodeURIComponent(bundle.bundle_id)}/events`;
 const result: FindingEvidenceResult = { events: [], evidence: {}, expected: bundle.reference_count, missingEvents: [], missingEvidence: [], complete: false, revision: bundle.finding_revision };
 type Page = { bundle_id: string; bundle_digest: string; finding_revision: number; events: Dataset['events']; evidence: Dataset['evidence']; missing_events: { event_id: string }[]; changed_event_ids: string[]; missing_evidence_refs: string[]; page: { has_more: boolean; total_references: number } };
 let more = true;
 for (let offset = 0; more && offset < 5000; offset += 500) {
  try {
   const page = await api.get<Page>(`${path}?offset=${offset}&limit=500`, signal);
   if (page.bundle_id !== bundle.bundle_id || page.bundle_digest !== bundle.bundle_digest || page.finding_revision !== bundle.finding_revision || page.page.total_references !== bundle.reference_count) throw new Error('Evidence page does not match the pinned bundle.');
   result.events.push(...page.events); Object.assign(result.evidence, page.evidence);
   result.missingEvents.push(...page.missing_events.map(item => item.event_id), ...page.changed_event_ids);
   result.missingEvidence.push(...page.missing_evidence_refs);
   if (page.changed_event_ids.length) result.error = 'Some records changed since this bundle was created and were withheld.';
   more = page.page.has_more;
  } catch (error) {
   if (signal?.aborted || (error instanceof ApiError && [401, 403].includes(error.status))) throw error;
   result.error = `Pinned evidence unavailable: ${(error as Error).message}`; break;
  }
 }
 if (more && !result.error) result.error = 'Pinned evidence exceeds the 5,000-reference browser limit.';
 result.events = [...new Map(result.events.map(event => [event.id, event])).values()];
 result.complete = !more && !result.error && !result.missingEvents.length && !result.missingEvidence.length && result.events.length === result.expected;
 return result;
}
