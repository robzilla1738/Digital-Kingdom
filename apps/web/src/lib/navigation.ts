export type Selection = { kind: 'asset' | 'finding' | 'path' | 'relationship' | 'event' | 'source'; id: string } | null;
export type View = 'castle' | 'graph';
export type Workspace = 'kingdom' | 'investigate' | 'coverage' | 'integrations';
export interface NavigationState { workspace: Workspace; view: View; selection: Selection; playhead: string | null; basis: 'known' | 'occurred'; investigateTab: 'findings' | 'events' | 'cases';
  /** LP16: semantic world focus by stable hierarchy id (realm:/env:/district:/structure:), shared by castle, graph and lists. */
  focus?: string | null;
  /** LP16-A4: the open case that scopes the workflow; survives view switches, WebGL loss, resize and back navigation. */
  caseId?: string | null }
/** Accept legacy links; allowlisted reference-only state never serializes queries, evidence, or credentials. */
export function parseNavigation(hash: string): NavigationState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const workspace = p.get('workspace'), view = p.get('view'), basis = p.get('basis'), t = p.get('t'), sel = p.get('sel'), wf = p.get('wf'), kase = p.get('case');
  let selection: Selection = null;
  if (sel && /^(asset|finding|path|relationship|event|source):.{1,500}$/.test(sel)) { const i = sel.indexOf(':'); selection = { kind: sel.slice(0,i) as NonNullable<Selection>['kind'], id: sel.slice(i+1) }; }
  return { workspace: workspace === 'investigate' || workspace === 'coverage' || workspace === 'integrations' ? workspace : 'kingdom',
    view: view === 'graph' ? 'graph' : 'castle', selection,
    playhead: t && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : null,
    basis: basis === 'known' ? 'known' : 'occurred', investigateTab: p.get('tab') === 'events' ? 'events' : p.get('tab') === 'cases' ? 'cases' : 'findings',
    focus: wf && /^(realm|env):[^\u0000-\u001f]{1,600}$/.test(wf) ? wf : null, caseId: kase && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(kase) ? kase : null };
}
export function serializeNavigation(s: NavigationState): string {
  const p = new URLSearchParams({ v: '2', workspace: s.workspace, view: s.view });
  if (s.selection) p.set('sel', `${s.selection.kind}:${s.selection.id}`);
  if (s.playhead) p.set('t', s.playhead);
  if (s.basis !== 'occurred') p.set('basis', s.basis);
  if (s.investigateTab !== 'findings') p.set('tab', s.investigateTab);
  if (s.focus) p.set('wf', s.focus);
  if (s.caseId) p.set('case', s.caseId);
  return p.toString();
}
