import { describe, expect, it } from 'vitest';
import { loadOfflineDemo } from '../lib/data.ts';
import { applyRedesignFixture } from '../../../../fixtures/redesign/offline.ts';
import { presentationGroups, presentationMembers, presentationScene, selectionAssets, selectionDistrictKey, type PresentationGroup } from './scenePresentation.ts';

function canonical() {
  const data = applyRedesignFixture(loadOfflineDemo(), 'F13');
  return { data, vm: { data, latestData: data, findings: data.findings, selectedEventAssets: [] }, groups: presentationGroups(presentationScene(data.scene), data.graph) };
}
function largeGroup(): PresentationGroup {
  const base = canonical().groups[0]!;
  return { ...base, rooms: Array.from({ length: 70 }, (_, i) => ({ ...base.rooms[0]!, asset_id: `asset-${String(i).padStart(3, '0')}`, slot: i })) };
}
describe('bounded multi-district selection presentation', () => {
  it('uses current source membership against pinned graph IDs without rewriting historical evidence', () => {
    const { data, vm } = canonical(), original = JSON.stringify(data);
    const source = data.sources[0]!;
    const pinned = { ...data, sources: [{ ...source, id: 'changed-source', asset_ids: ['blob'] }, { ...source, id: 'removed-source', asset_ids: ['blob'] }] };
    const latestData = { ...data, sources: [{ ...source, id: 'changed-source', asset_ids: ['edge', 'new-asset-not-in-pinned-graph'] }, { ...source, id: 'new-source', asset_ids: ['db'] }] };
    const current = { ...vm, data: pinned, latestData };
    expect([...selectionAssets({ kind: 'source', id: 'changed-source' }, current)]).toEqual(['edge']);
    expect([...selectionAssets({ kind: 'source', id: 'new-source' }, current)]).toEqual(['db']);
    expect([...selectionAssets({ kind: 'source', id: 'removed-source' }, current)]).toEqual([]);
    expect(pinned.sources[0]!.asset_ids).toEqual(['blob']);
    expect(JSON.stringify(data)).toBe(original);
  });

  it('retains both edge and blob for the canonical F13 cross-district finding', () => {
    const { groups, vm } = canonical();
    const selected = selectionAssets({ kind: 'finding', id: 'f-1ogfivz17xdjzf' }, vm);
    expect([...selected].sort()).toEqual(['blob', 'edge']);
    const result = presentationMembers(groups, selectionDistrictKey(groups, selected), selected);
    expect(result.groups).toHaveLength(2);
    expect(result.visible.slice(0, 2).map(room => room.asset_id).sort()).toEqual(['blob', 'edge']);
    expect(result.members.map(room => room.asset_id)).toEqual(expect.arrayContaining(['blob', 'db', 'edge']));
    expect(result.visible.length).toBeLessThanOrEqual(50); expect(result.selectedOverflow).toBe(0);
  });
  it('retains every endpoint of cross-district path and relationship selections', () => {
    const { groups, vm, data } = canonical();
    const relationship = data.graph.relationships.find(edge => groups.find(g => g.rooms.some(r => r.asset_id === edge.source_id))?.key !== groups.find(g => g.rooms.some(r => r.asset_id === edge.target_id))?.key)!;
    expect(relationship).toBeTruthy();
    for (const kind of ['path', 'relationship'] as const) {
      const selected = selectionAssets({ kind, id: relationship.id }, vm);
      const result = presentationMembers(groups, selectionDistrictKey(groups, selected), selected);
      expect(result.visible.map(room => room.asset_id)).toEqual(expect.arrayContaining([relationship.source_id, relationship.target_id]));
      expect(result.groups.length).toBeGreaterThan(1);
    }
  });
  it('keeps two selected members beyond index 49 before filling remaining context', () => {
    const group = largeGroup(), selected = new Set(['asset-055', 'asset-069']);
    const original = JSON.stringify(group), result = presentationMembers([group], group.key, selected);
    expect(result.visible).toHaveLength(50); expect(result.visible.slice(0, 2).map(room => room.asset_id)).toEqual(['asset-055', 'asset-069']);
    expect(result.members).toHaveLength(70); expect(result.selectedOverflow).toBe(0); expect(JSON.stringify(group)).toBe(original);
  });
  it('exposes deterministic overflow when selected assets alone exceed the 50-member cap', () => {
    const group = largeGroup(), selected = new Set(group.rooms.slice(0, 65).map(room => room.asset_id));
    const result = presentationMembers([group], selectionDistrictKey([group], selected), selected);
    expect(result.visible.map(room => room.asset_id)).toEqual(group.rooms.slice(0, 50).map(room => room.asset_id));
    expect(result.selectedCount).toBe(65); expect(result.selectedOverflow).toBe(15); expect(result.members).toHaveLength(70);
    expect(presentationMembers([group], group.key, new Set(['asset-064'])).visible[0]!.asset_id).toBe('asset-064');
  });
  it('remembers focused group membership until explicit scope change, not incidental selection', () => {
    const { groups } = canonical(), key = selectionDistrictKey(groups, new Set(['edge', 'blob']));
    const first = presentationMembers(groups, key, new Set(['edge', 'blob']));
    const next = presentationMembers(groups, key, new Set(['blob']));
    expect(next.members.map(room => room.asset_id)).toEqual(first.members.map(room => room.asset_id));
    expect(selectionDistrictKey(groups, new Set(['not-in-this-scene']))).toBeNull();
  });
});
