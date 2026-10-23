import { join } from 'node:path';
import { canonicalJson } from '../../../packages/contracts/src/index.ts';
import { Client, StdioClientTransport } from '../../../apps/mcp/test/sdk-client.ts';
import { ROOT, baselineBundle, type Instance } from '../instance.ts';
import { CONDITIONS, buildC3Bundle, manifestOf, preflight, type CaseManifest, type CommonMetadata } from './harness.ts';
import type { SecurityEvent } from '../../../packages/contracts/src/types.ts';

export async function prepareCase(instance: Instance & { clock: string }) {
  const raw = await baselineBundle(instance);
  const events = raw.events as SecurityEvent[];
  const metadata: CommonMetadata = { clock: instance.clock, sources: raw.sources as unknown[], inventory: raw.assets as unknown[], limits: ['Synthetic isolated case; no production coverage implied.', 'No late arrivals. All stored events fit this bounded case.', 'Current source status does not establish historical coverage.'] };
  const evidence = (raw.evidence_records as { records: Record<string, unknown> }).records;
  const bundle = buildC3Bundle(events, evidence, metadata);
  const manifests: Record<string, CaseManifest> = { C3: manifestOf(events, metadata) };
  const schemas: Record<string, unknown> = {};
  const after = '2026-10-19T00:00:00.000Z', before = '2026-10-20T00:00:00.000Z';
  for (const condition of CONDITIONS.filter(c => c.delivery === 'mcp')) {
    const client = new Client({ name: 'dk-v2-preflight', version: '2' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', join(ROOT, 'apps/mcp/src/main.ts')], cwd: ROOT, stderr: 'pipe', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', DK_URL: instance.url, DK_TOKEN: instance.agentToken, DK_PROJECT: instance.projectId, DK_MCP_TOOLS: condition.tools.join(',') } }));
      const tools = (await client.listTools()).tools;
      schemas[condition.id] = tools;
      if (JSON.stringify(tools.map(t => t.name).sort()) !== JSON.stringify([...condition.tools].sort())) throw new Error(`${condition.id} tool allowlist mismatch`);
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args });
        if (result.isError) throw new Error(`${condition.id} preflight tool failed: ${name}`);
        const text = (result.content as { text?: string }[]).map(c => c.text ?? '').join('\n');
        return JSON.parse(text);
      };
      const retrieved: SecurityEvent[] = [];
      let cursor: string | null = null;
      do {
        const page = await call('dk_search_events', { after, before, limit: 100, ...(cursor ? { cursor } : {}) });
        retrieved.push(...page.events.records);
        cursor = page.page.next_cursor;
      } while (cursor);
      for (const event of retrieved) {
        const detail = await call('dk_get_event', { id: event.id });
        if (JSON.stringify(detail.event) !== JSON.stringify(event)) throw new Error('event changed during preflight');
        for (const ref of event.evidence_refs.filter(ref => ref.startsWith('evidence:'))) {
          const expected = evidence[ref] as { unavailable?: string; ref?: string; record?: unknown } | undefined;
          if (expected?.unavailable === 'HTTP 404') {
            if (!detail.evidence_completeness.missing_evidence_refs.includes(ref)) throw new Error('missing evidence differs across conditions');
          } else if (expected?.ref !== ref || canonicalJson(detail.evidence.records[ref]) !== canonicalJson(expected.record)) {
            throw new Error('stored evidence differs across conditions');
          }
        }
      }
      manifests[condition.id] = manifestOf(retrieved, metadata);
    } finally { await client.close(); }
  }
  const result = preflight(manifests as Record<'C1' | 'C2' | 'C3', CaseManifest>, events.map(e => e.id), bundle);
  return { result, metadata, bundle: JSON.parse(bundle), schemas, events };
}
