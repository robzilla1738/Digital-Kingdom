import { canonicalJson } from '../../../packages/contracts/src/index.ts';

/** Count full normalized records, never an identifier merely mentioned by a finding. */
export function exposedEventIds(events: { id: string }[], returnedTexts: string[]): string[] {
  const expected = new Map(events.map(event => [event.id, canonicalJson(event)]));
  const exposed = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    const object = value as Record<string, unknown>;
    if (typeof object.id === 'string' && expected.get(object.id) === canonicalJson(object)) exposed.add(object.id);
    for (const child of Object.values(object)) visit(child);
  };
  for (const text of returnedTexts) { try { visit(JSON.parse(text)); } catch { /* Non-JSON errors expose no record. */ } }
  return [...exposed].sort();
}
