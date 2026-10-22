import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { setupProgress } from './setupProgress.ts';
const context = vi.hoisted(() => ({ value: {} as any }));
vi.mock('../../lib/state.tsx', () => ({ useApp: () => context.value }));
import { SetupChecklist } from './SetupChecklist.tsx';
import { IntegrationStatus } from './IntegrationStatus.tsx';
const data = (overrides = {}) => ({ mode: 'server', graph: { assets: [], graph_revision: 'not-imported' }, sources: [], events: [], coverage: [], ...overrides } as any);
const render = (current: any, component: any) => { context.value = { vm: { data: current, latestData: current, coverageAsOf: '2026-10-22T19:00:00Z' }, dispatch: vi.fn() }; return renderToStaticMarkup(component); };
describe('real first-run progress and declared integration status', () => {
  it('has three incomplete steps for an empty server, with no click-driven completion', () => {
    const empty = data(); expect(setupProgress(empty)).toEqual({ inventory: false, source: false, receipt: false, complete: false });
    const html = render(empty, createElement(SetupChecklist));
    expect(html).toContain('No assets have been added'); expect(html.match(/data-complete="false"/g)).toHaveLength(3);
    expect(html).toContain('Confirm receipt of a test event'); expect(html).toContain('not button clicks');
  });
  it('does not treat configuration or a healthy flag alone as receipt, and accepts an actual server timestamp', () => {
    const configured = data({ graph: { assets: [{ id: 'api' }] }, sources: [{ id: 'app' }], coverage: [{ source_id: 'app', state: 'healthy' }] });
    expect(setupProgress(configured)).toEqual({ inventory: true, source: true, receipt: false, complete: false });
    configured.coverage[0].last_event_at = '2026-10-22T18:00:00Z'; expect(setupProgress(configured).receipt).toBe(true);
    expect(render(configured, createElement(SetupChecklist))).toBe('');
    expect(render(data({ mode: 'offline-demo' }), createElement(SetupChecklist))).toBe('');
  });
  it('separates missing assessments, gaps, administrative disablement and reporting without inventing connections', () => {
    const current = data({ sources: ['reporting', 'gap', 'disabled', 'missing', 'unknown'].map(id => ({ id, kind: 'otel', disabled: id === 'disabled' })), coverage: [{ source_id: 'reporting', state: 'healthy' }, { source_id: 'gap', state: 'offline' }, { source_id: 'disabled', state: 'healthy' }, { source_id: 'unknown', state: 'not_assessed' }] });
    const html = render(current, createElement(IntegrationStatus, { kind: 'otel' }));
    expect(html).toContain('5 matching source records configured'); expect(html).toContain('1 reporting · 1 with reported gaps · 1 disabled · 2 not assessed');
    expect(html).toContain('not proof of an external connection'); expect(html).not.toContain('Connected');
  });
  it('shows unconfigured status and does not infer SDK installation from arbitrary kinds', () => {
    const current = data({ sources: [{ id: 'runtime', kind: 'falco' }] });
    const html = render(current, createElement(IntegrationStatus, { kind: 'application' }));
    expect(html).toContain('No matching source records configured'); expect(html).toContain('SDK installation is not observable');
  });
});
