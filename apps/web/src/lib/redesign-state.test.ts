import { describe, it, expect } from 'vitest';
import type { Finding } from '@dk/contracts';
import { loadOfflineDemo } from './data.ts';
import { currentCoveragePresentation, deriveAssetStatus, distinctSummary, highestSeverity, sortFindings } from './presentation.ts';
import { parseNavigation, serializeNavigation } from './navigation.ts';
import { reducer, replayAt, type UiState } from './state.tsx';

describe('redesign evidence dimensions and navigation',()=>{
 it('keeps mixed coverage partial and disabled sources nonreporting',()=>{
  const d=loadOfflineDemo(),id=d.graph.assets[0]!.id;
  const source=d.sources[0]!;
  d.sources=[{...source,id:'reporting',asset_ids:[id],disabled:false},{...source,id:'disabled',asset_ids:[id],disabled:true}];
  const record=d.coverage[0]!;
  d.coverage=[{...record,source_id:'reporting',asset_ids:[id],state:'healthy'},{...record,source_id:'disabled',asset_ids:[id],state:'healthy'}];
  const s=deriveAssetStatus(d,[],d.coverage).get(id)!;
  expect(s.coverage).toBe('partial');expect(s.reportingSources).toBe(1);expect(s.configuredSources).toBe(2);
  d.sources[0]!.disabled=true;expect(deriveAssetStatus(d,[],d.coverage).get(id)!.coverage).toBe('gap');
  d.sources=[];expect(deriveAssetStatus(d,[],d.coverage).get(id)!.coverage).toBe('unobserved');
  d.sources=[{...source,id:'missing',asset_ids:[id]}];expect(deriveAssetStatus(d,[],[]).get(id)!.coverage).toBe('unassessed');
 });
 it('keeps current coverage separate from a pinned evidence dataset',()=>{
  const pinned=loadOfflineDemo(), current=structuredClone(pinned);
  current.sources=current.sources.map(source=>({...source,disabled:true}));
  current.coverage_as_of='2026-10-22T18:20:00.000Z';
  const view=currentCoveragePresentation(pinned,current,pinned.findings);
  expect(view.assetStatus.get('edge')?.coverage).toBe('gap');
  expect(view.coverageAsOf).toBe(current.coverage_as_of);
  expect(pinned.sources.every(source=>!source.disabled)).toBe(true);
  expect(pinned.findings).toEqual(loadOfflineDemo().findings);
 });
 it('actual severity outranks outcome and records count once across assets',()=>{
  const d=loadOfflineDemo(),base=d.findings[0]!,ids=d.graph.assets.slice(0,2).map(a=>a.id);
  const effect={...base,id:'effect',severity:'low',outcome_state:'observed_effect',affected_asset_ids:ids,lifecycle:'open'} as Finding;
  const attempt={...base,id:'attempt',severity:'critical',outcome_state:'attempted',affected_asset_ids:ids,lifecycle:'open'} as Finding;
  const fs=[effect,attempt],status=deriveAssetStatus(d,fs,d.coverage);
  expect(sortFindings(fs)[0]!.id).toBe('attempt');expect(highestSeverity(['low','critical'])).toBe('critical');
  expect(status.get(ids[0]!)!.severity).toBe('critical');expect(status.get(ids[0]!)!.worst).toBe('observed_effect');
  expect(distinctSummary([...fs,attempt],status,d.coverage).openFindings).toBe(2);
 });
 it('accepts legacy path, occurred/known basis and serializes only allowed references',()=>{
  const s=parseNavigation('#view=graph&sel=path:rel%3Aone&t=2026-10-01T10:00:00Z&basis=known&token=secret&client_ip=1.2.3.4');
  expect(s.selection).toEqual({kind:'path',id:'rel:one'});expect(s.basis).toBe('known');expect(s.workspace).toBe('kingdom');
  const encoded=serializeNavigation(s);expect(encoded).toContain('v=2');expect(encoded).not.toMatch(/token|secret|client_ip|1.2.3.4/);
  expect(parseNavigation(encoded)).toEqual(s);
 });
 it('new workspace/source links round-trip and malformed navigation is bounded',()=>{
  const s=parseNavigation('#workspace=coverage&sel=source:db-audit&view=graph');expect(parseNavigation(serializeNavigation(s))).toEqual(s);
  expect(parseNavigation('#workspace=evil&sel=script:alert(1)&t=bad').selection).toBeNull();
  expect(parseNavigation('#sel=asset:'+ 'x'.repeat(501)).selection).toBeNull();
 });
 it('selection opens detail without moving camera; explicit focus does; navigation preserves context',()=>{
  const s={...parseNavigation('#view=graph&t=2026-10-01T10:00:00Z&basis=known'),focusRevision:0,inspector:false,navigationRevision:0,query:'order',eventAssetFilter:'orders',announce:''} as UiState;
  const selected=reducer(s,{type:'select',selection:{kind:'asset',id:'orders'}});
  expect(selected.inspector).toBe(true);expect(selected.focusRevision).toBe(0);expect(selected.historyMode).toBe('push');
  const focused=reducer(selected,{type:'focus'});expect(focused.focusRevision).toBe(1);
  const castle=reducer(focused,{type:'view',view:'castle'});expect(castle.selection).toEqual(selected.selection);expect(castle.query).toBe('order');expect(castle.playhead).toBe(s.playhead);
  expect(reducer(castle,{type:'webglFailed',reason:'Lost'}).selection).toEqual(selected.selection);
 });
 it('continuous replay writes replace history and explicit live is separate',()=>{
  const s={...parseNavigation(''),navigationRevision:0,playing:true} as UiState;
  const final=reducer(reducer(s,{type:'playing',playing:false}),{type:'playhead',at:'2026-10-01T11:00:00.000Z'});
  expect(final.playing).toBe(false);expect(final.playhead).not.toBeNull();expect(final.historyMode).toBe('replace');
 });
 it('does not invent historical coverage loss from a source disabled now',()=>{
  const d=loadOfflineDemo(); d.sources=d.sources.map(source=>({...source,disabled:true}));
  const historical=replayAt(d,d.window.start,'known');
  expect(historical.events).toEqual([]);expect(historical.findings).toEqual([]);
  expect(deriveAssetStatus(d,d.findings,d.coverage).get('edge')?.coverage).toBe('gap');
 });
 it('keeps authorized exact event asset metadata only for the selected record',()=>{
  const s={...parseNavigation('#sel=event:old'),navigationRevision:0,resolvedEvent:null} as UiState;
  expect(reducer(s,{type:'resolvedEvent',id:'stale',assetIds:['other']}).resolvedEvent).toBeNull();
  const exact=reducer(s,{type:'resolvedEvent',id:'old',assetIds:['db','db']});
  expect(exact.resolvedEvent).toEqual({id:'old',assetIds:['db']});
  expect(reducer(exact,{type:'view',view:'graph'}).resolvedEvent).toEqual(exact.resolvedEvent);
  expect(reducer(exact,{type:'select',selection:{kind:'asset',id:'db'}}).resolvedEvent).toBeNull();
 });

});

describe('local announcement preference', () => {
 it('reduces automatic status independently of motion and keeps direct action feedback', () => {
  const initial = { ...parseNavigation(''), navigationRevision: 0, reduceAutomaticAnnouncements: false, reducedMotion: false, playing: true, announce: '' } as UiState;
  const quiet = reducer(initial, { type: 'reduceAutomaticAnnouncements', on: true });
  expect(quiet.reduceAutomaticAnnouncements).toBe(true);
  expect(quiet.reducedMotion).toBe(false); expect(quiet.playing).toBe(true);
  expect(quiet.announce).toContain('Direct action feedback remains enabled');
  const selected = reducer(quiet, { type: 'select', selection: { kind: 'finding', id: 'bounded-reference' } });
  expect(selected.announce).toBe('Selected finding bounded-reference');
  expect(reducer(selected, { type: 'announce', message: 'Review saved' }).announce).toBe('Review saved');
  expect(serializeNavigation(selected)).not.toMatch(/reduceAutomaticAnnouncements|Review saved/);
  expect(reducer(selected, { type: 'reduceAutomaticAnnouncements', on: false }).reduceAutomaticAnnouncements).toBe(false);
 });
});
