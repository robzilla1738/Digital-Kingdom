import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type Dispatch, type ReactNode } from 'react';
import type { CoverageRecord, Finding, SecurityEvent } from '@dk/contracts';
import { stateAt, type ReplayBasis } from '@dk/detections';
import type { Dataset } from './data.ts';
import type { Layer } from './vocab.ts';
import type { FocusMode } from './layers.ts';
import { currentCoveragePresentation, distinctSummary, type AssetStatus } from './presentation.ts';
import { parseNavigation, serializeNavigation, type NavigationState, type Selection, type View, type Workspace } from './navigation.ts';
export { worstOutcome, highestSeverity, ASSET_COVERAGE_LABEL, sortFindings } from './presentation.ts';
export type { AssetStatus, Selection, View, Workspace };

export interface UiState extends NavigationState {
  hover: string | null; playing: boolean; speed: number; roofs: boolean;
  layers: Record<Layer, boolean>; showHypothetical: boolean; focusMode: FocusMode; reducedMotion: boolean; reduceAutomaticAnnouncements: boolean;
  query: string; tab: 'findings' | 'assets' | 'coverage' | 'world'; webglFailed: string | null; announce: string;
  sidebar: boolean; inspector: boolean; focusRevision: number; focusHandledRevision: number; quality: 'low' | 'medium' | 'high'; shortcuts: boolean;
  resolvedEvent: { id: string; assetIds: string[] } | null; eventAssetFilter: string | null; inspectorSection: string; updateRevision: number;
  historyMode: 'push' | 'replace' | 'none'; navigationRevision: number;
  /** LP16: draw retired incarnations at their last position (outlines only, never live structures). */
  showArchived: boolean;
  /** LP16-A4: display details of the scoped case (id is navigation state; title/assets come from the case record). */
  caseScope: { id: string; title: string; assetIds: string[] } | null;
}
export type Action =
 | {type:'view';view:View} | {type:'workspace';workspace:Workspace} | {type:'investigateTab';tab:UiState['investigateTab']}
 | {type:'select';selection:Selection;announce?:string} | {type:'hover';id:string|null}
 | {type:'playhead';at:string|null} | {type:'playing';playing:boolean} | {type:'speed';speed:number} | {type:'basis';basis:ReplayBasis}
 | {type:'stepPlayhead';delta:number;start:number;end:number}
 | {type:'roofs';roofs:boolean} | {type:'layer';layer:Layer;on:boolean} | {type:'hypothetical';on:boolean} | {type:'focusMode';mode:FocusMode}
 | {type:'reduceAutomaticAnnouncements';on:boolean} | {type:'reducedMotion';on:boolean} | {type:'query';query:string} | {type:'tab';tab:UiState['tab']}
 | {type:'webglFailed';reason:string} | {type:'retryWebgl'} | {type:'panel';panel:'sidebar'|'inspector';open:boolean}
 | {type:'focus'} | {type:'focusHandled';revision:number} | {type:'quality';quality:UiState['quality']} | {type:'shortcuts';on:boolean}
 | {type:'eventAssetFilter';assetId:string|null} | {type:'inspectorSection';section:string}
 | {type:'resolvedEvent';id:string;assetIds:string[]}
 | {type:'acceptUpdates'} | {type:'announce';message:string} | {type:'restoreNavigation';state:NavigationState}
 | {type:'worldFocus';focus:string|null;announce?:string} | {type:'showArchived';on:boolean}
 | {type:'caseScope';scope:{id:string;title:string;assetIds:string[]}|null};
const navigate = (s:UiState, patch:Partial<UiState>, historyMode:'push'|'replace'='push'):UiState => ({...s,...patch,historyMode,navigationRevision:s.navigationRevision+1});
export function reducer(s:UiState,a:Action):UiState {
 switch(a.type) {
 case 'view': return navigate(s,{view:a.view});
 case 'workspace': return navigate(s,{workspace:a.workspace});
 case 'investigateTab': return navigate(s,{investigateTab:a.tab});
 case 'select': return navigate(s,{selection:a.selection,announce:a.announce ?? (a.selection ? `Selected ${a.selection.kind} ${a.selection.id}` : 'Selection cleared'),inspector:!!a.selection,resolvedEvent:a.selection?.kind==='event'&&a.selection.id===s.resolvedEvent?.id?s.resolvedEvent:null});
 case 'hover': return s.hover===a.id?s:{...s,hover:a.id};
 case 'playhead': return s.playhead===a.at?s:navigate(s,{playhead:a.at},'replace');
 case 'stepPlayhead': {
  const current=s.playhead?Date.parse(s.playhead):a.end;
  const playhead=new Date(Math.min(a.end,Math.max(a.start,current+a.delta))).toISOString();
  return s.playhead===playhead&&!s.playing?s:navigate(s,{playhead,playing:false},'replace');
 }
 case 'playing': return s.playing===a.playing?s:{...s,playing:a.playing};
 case 'speed': return {...s,speed:a.speed};
 case 'basis': return navigate(s,{basis:a.basis});
 case 'roofs': return {...s,roofs:a.roofs};
 case 'focusMode': return {...s,focusMode:a.mode};
 case 'layer': return {...s,layers:{...s.layers,[a.layer]:a.on}};
 case 'hypothetical': return {...s,showHypothetical:a.on};
 case 'reduceAutomaticAnnouncements': return {...s,reduceAutomaticAnnouncements:a.on,announce:a.on?'Automatic status announcements reduced. Direct action feedback remains enabled.':'Automatic status announcements enabled.'};
 case 'reducedMotion': return {...s,reducedMotion:a.on,playing:a.on?false:s.playing};
 case 'query': return {...s,query:a.query};
 case 'tab': return {...s,tab:a.tab};
 case 'webglFailed': return {...s,webglFailed:a.reason,view:'graph'};
 case 'retryWebgl': return {...s,webglFailed:null,view:'castle'};
 case 'panel': return {...s,[a.panel]:a.open};
 case 'focus': return navigate(s,{workspace:'kingdom',focusRevision:s.focusRevision+1});
 case 'focusHandled': return {...s,focusHandledRevision:Math.max(s.focusHandledRevision,Math.min(a.revision,s.focusRevision))};
 case 'quality': return {...s,quality:a.quality};
 case 'shortcuts': return {...s,shortcuts:a.on};
 case 'eventAssetFilter': return navigate(s,{workspace:'investigate',investigateTab:'events',eventAssetFilter:a.assetId});
 case 'inspectorSection': return {...s,inspectorSection:a.section};
 case 'resolvedEvent': return s.selection?.kind==='event'&&s.selection.id===a.id?{...s,resolvedEvent:{id:a.id,assetIds:[...new Set(a.assetIds)]}}:s;
 case 'acceptUpdates': return {...s,updateRevision:s.updateRevision+1,announce:'Latest confirmed snapshot applied'};
 case 'announce': return {...s,announce:a.message};
 case 'worldFocus': return s.focus===a.focus?s:navigate(s,{focus:a.focus,announce:a.announce??(a.focus?`World focus ${a.focus}`:'World focus cleared')});
 case 'showArchived': return {...s,showArchived:a.on};
 case 'caseScope': { const id=a.scope?.id??null; return id!==(s.caseId??null)?navigate(s,{caseId:id,caseScope:a.scope}):{...s,caseScope:a.scope}; }
 case 'restoreNavigation': return {...s,...a.state,caseScope:a.state.caseId&&a.state.caseId===s.caseScope?.id?s.caseScope:null,inspector:!!a.state.selection,resolvedEvent:a.state.selection?.kind==='event'&&a.state.selection.id===s.resolvedEvent?.id?s.resolvedEvent:null,historyMode:'none',navigationRevision:s.navigationRevision+1};
 }
}
export interface ViewModel {
 data:Dataset; latestData:Dataset; findings:Finding[]; coverage:CoverageRecord[]; unobserved:string[]; events:SecurityEvent[];
 lateEventIds:Set<string>; assetStatus:Map<string,AssetStatus>; at:string; isLatest:boolean;
 coverageAsOf:string; selectedEventAssets:string[]; pendingUpdates:number; summary:ReturnType<typeof distinctSummary>;
}
/** Current administrative disablement is not a historical sensor event. */
export function replayAt(data: Dataset, at: string, basis: 'known' | 'occurred') {
 const sources = data.sources.map(({ disabled: _currentDisabled, ...source }) => source);
 return stateAt(data.graph, data.events, at, basis, { sources });
}
const Ctx=createContext<{ui:UiState;dispatch:Dispatch<Action>;vm:ViewModel}|null>(null);
export function AppStateProvider({data:incoming,children}:{data:Dataset;children:ReactNode}) {
 const reduced=typeof matchMedia!=='undefined'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
 const narrow=typeof matchMedia!=='undefined'&&matchMedia('(max-width: 767px)').matches;
 const [ui,dispatch]=useReducer(reducer,undefined,()=>{
  const nav=parseNavigation(location.hash);
  if(!location.hash&&narrow)nav.view='graph';
  return {...nav,hover:null,playing:false,speed:30,roofs:true,layers:{runtime:true,identity:false,data:true,deployment:false,tools:true},showHypothetical:false,focusMode:'none',
   reducedMotion:reduced,reduceAutomaticAnnouncements:false,query:'',tab:'findings',webglFailed:null,announce:'',sidebar:true,inspector:!!nav.selection,
   focusRevision:0,focusHandledRevision:0,quality:narrow?'low':'medium',shortcuts:false,resolvedEvent:null,eventAssetFilter:null,inspectorSection:'summary',updateRevision:0,historyMode:'replace',navigationRevision:0,showArchived:false,caseScope:null} satisfies UiState;
 });
 const [data,setData]=useState(incoming);
 const appliedUpdate=useRef(0);
 useEffect(()=>{
  const explicitly=appliedUpdate.current!==ui.updateRevision;
  if(explicitly||(!ui.selection&&!ui.playhead)||incoming.role!==data.role) {setData(incoming);appliedUpdate.current=ui.updateRevision;}
 },[incoming,ui.selection,ui.playhead,ui.updateRevision,data.role]);
 useEffect(()=>{const restore=()=>dispatch({type:'restoreNavigation',state:parseNavigation(location.hash)});addEventListener('popstate',restore);addEventListener('hashchange',restore);return()=>{removeEventListener('popstate',restore);removeEventListener('hashchange',restore);};},[]);
 useEffect(()=>{
  if(ui.historyMode==='none')return;
  const next=serializeNavigation(ui);if(location.hash.slice(1)===next)return;
  history[ui.historyMode==='push'?'pushState':'replaceState'](null,'',`${location.pathname}${location.search}#${next}`);
 },[ui.navigationRevision]);
 useEffect(()=>{const mq=matchMedia('(prefers-reduced-motion: reduce)');const change=()=>{if(mq.matches)dispatch({type:'reducedMotion',on:true});};mq.addEventListener('change',change);return()=>mq.removeEventListener('change',change);},[]);
 const vm=useMemo<ViewModel>(()=>{
  const isLatest=ui.playhead===null,at=ui.playhead??data.window.end;
  let findings=data.findings,events=data.events;let late=new Set<string>();
  if(!isLatest){const s=replayAt(data,at,ui.basis);findings=s.findings;events=s.events;late=new Set(s.late_event_ids);}
  else for(const e of events)if(Date.parse(e.received_at)-Date.parse(e.occurred_at)>60000)late.add(e.id);
  // Coverage is explicitly CURRENT metadata, never repainted as historical certainty during replay.
  const {coverage,unobserved,coverageAsOf,assetStatus:status}=currentCoveragePresentation(data,incoming,findings),t=Date.parse(at);
  for(const e of events)if(t-Date.parse(e.occurred_at)<=45000&&t>=Date.parse(e.occurred_at))for(const id of e.asset_ids)status.get(id)?.recentEventIds.push(e.id);
  return {data,latestData:incoming,findings,coverage,unobserved,events,lateEventIds:late,assetStatus:status,at,isLatest,
   coverageAsOf,selectedEventAssets:ui.selection?.kind==='event'?(data.events.find(e=>e.id===ui.selection?.id)?.asset_ids??(ui.resolvedEvent?.id===ui.selection.id?ui.resolvedEvent.assetIds:[])):[],pendingUpdates:incoming!==data?Math.max(1,incoming.cursor-data.cursor):0,summary:distinctSummary(findings,status,coverage)};
 },[data,incoming,ui.playhead,ui.basis,ui.selection,ui.resolvedEvent]);
 useEffect(()=>{
  if(!ui.playing)return;
  const start=Date.parse(data.window.start),end=Date.parse(data.window.end);let cur=ui.playhead?Date.parse(ui.playhead):start;if(cur>=end)cur=start;
  let last=performance.now();const id=setInterval(()=>{const now=performance.now();cur=Math.min(end,cur+(now-last)*ui.speed);last=now;
   if(cur>=end){dispatch({type:'playing',playing:false});dispatch({type:'playhead',at:new Date(end).toISOString()});return;}
   dispatch({type:'playhead',at:new Date(Math.round(cur/1000)*1000).toISOString()});},125);return()=>clearInterval(id);
 },[ui.playing,ui.speed,data.window.start,data.window.end]);
 return <Ctx.Provider value={{ui,dispatch,vm}}>{children}</Ctx.Provider>;
}
export function useApp(){const c=useContext(Ctx);if(!c)throw new Error('useApp outside provider');return c;}
