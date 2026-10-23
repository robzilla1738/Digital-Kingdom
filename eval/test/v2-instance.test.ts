import { it, expect } from 'vitest';
import { generateCases } from '../src/v2/harness.ts';
import { startV2Instance } from '../src/v2/instance.ts';
import { authorityProbes } from '../src/instance.ts';

it('loads every development family with a fixed clock and enforced viewer authority', async () => {
  for (const { spec } of generateCases(73).cases.filter(c => c.spec.split === 'dev')) {
    const instance = await startV2Instance(spec);
    try {
      expect(instance.known.events).toHaveLength(spec.events.length);
      expect(instance.clock).toMatch(/^2026-10-19/);
      expect(Object.values(await authorityProbes(instance)).every(p => p.ok)).toBe(true);
    } finally { await instance.stop(); }
  }
}, 180_000);

it('proves evidence equivalence through the actual MCP condition allowlists', async () => {
  const { prepareCase } = await import('../src/v2/preflight.ts');
  for (const { spec } of generateCases(73).cases.filter(c => c.spec.split === 'dev')) {
    const instance = await startV2Instance(spec);
    try {
      const prepared = await prepareCase(instance);
      expect(prepared.result.valid).toBe(true);
      expect(prepared.result.manifests.C2!.event_ids).toHaveLength(instance.known.events.length);
    } finally { await instance.stop(); }
  }
}, 180_000);
