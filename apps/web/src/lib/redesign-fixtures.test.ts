import { describe, it, expect } from 'vitest';
import { applyRedesignFixture } from '../../../../fixtures/redesign/offline.ts';
import { loadOfflineDemo } from './data.ts';

describe('explicit offline synthetic redesign fixtures', () => {
  it('does not change the base and represents all ten module IDs without modifying evidence', () => {
    const base = loadOfflineDemo(); const before = JSON.stringify(base); const d = applyRedesignFixture(base, 'F01');
    expect(JSON.stringify(base)).toBe(before); expect(d.events).toEqual(base.events); expect(d.findings).toEqual(base.findings);
    expect(new Set(d.scene.rooms.map(r => r.module_id)).size).toBe(10);
  });
  it('rejects application to server-backed data, even synthetic server projects', () => {
    const base = loadOfflineDemo(); base.mode = 'server';
    expect(() => applyRedesignFixture(base, 'F12')).toThrow(/only.*offline synthetic/i);
  });
  it('rejects live data', () => {
    const base = loadOfflineDemo(); base.project.dataset_kind = 'live';
    expect(() => applyRedesignFixture(base, 'F12')).toThrow(/only.*offline synthetic/i);
  });
  it('keeps unknown selectors inert', () => { const base = loadOfflineDemo(); expect(applyRedesignFixture(base, 'arbitrary')).toBe(base); });
  it('keeps the unlinked success event outside every finding', () => {
    const d = applyRedesignFixture(loadOfflineDemo(), 'F06'); const event = d.events.find(e => e.id === 'redesign-unlinked-data-access')!;
    expect(event.outcome).toBe('success'); expect(d.findings.some(f => f.event_ids.includes(event.id))).toBe(false);
  });
  it.each([['F12', 50], ['F13', 200]] as const)('creates %s with %i exact logical assets and no extra evidence', (id, count) => {
    const base = loadOfflineDemo(); const d = applyRedesignFixture(base, id);
    expect(d.graph.assets).toHaveLength(count); expect(d.scene.rooms).toHaveLength(count); expect(d.events).toEqual(base.events);
    expect(d.unobserved_asset_ids).toContain(`redesign-asset-${String(count).padStart(3, '0')}`);
  });
  it('uses an honest empty presentation rather than a compiled invented scene', () => {
    const d = applyRedesignFixture(loadOfflineDemo(), 'F14'); expect(d.graph.assets).toHaveLength(0); expect(d.scene.rooms).toHaveLength(0);
    expect(d.scene.digest).toBe('not-compiled-empty-project'); expect(d.findings).toHaveLength(0);
  });
});
