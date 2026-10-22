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
