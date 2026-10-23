import { randomBytes } from 'node:crypto';
import { openDb } from '../../../apps/server/src/db.ts';
import { Store } from '../../../apps/server/src/store.ts';
import { buildApp } from '../../../apps/server/src/app.ts';
import type { CaseSpec } from '../scenarios.ts';
import type { Instance } from '../instance.ts';

/** Real HTTP API and MCP transport, isolated SQLite, and a fixed synthetic clock. No background arrivals. */
export async function startV2Instance(spec: CaseSpec): Promise<Instance & { clock: string }> {
  let clock = '2026-10-19T14:00:00.000Z';
  const db = openDb(':memory:');
  const store = new Store(db, { now: () => new Date(clock) });
  const admin = store.createToken('evaluation setup', 'admin').token;
  const app = await buildApp({ store, secret: randomBytes(32).toString('hex'), demoMode: false, planner: null, webDist: '/nonexistent' });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const api: Instance['api'] = async (method, path, body, token = admin) => {
    const response = await fetch(url + path, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': typeof body === 'string' ? 'application/yaml' : 'application/json' }) }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: response.status, json: await response.json() };
  };
  const stop = async () => { await app.close(); db.close(); };
  const must = async <T>(request: Promise<{ status: number; json: T }>): Promise<T> => {
    const response = await request;
    if (response.status >= 300) throw new Error(`evaluation setup HTTP ${response.status}: ${JSON.stringify(response.json)}`);
    return response.json;
  };
  try {
    const p = spec.project_id;
    await must(api('POST', '/api/projects', { id: p, name: spec.project_name, dataset_kind: 'live' }));
    await must(api('POST', `/api/projects/${p}/graph?format=manifest&revision=r1`, spec.manifest));
    const sourceKeys = new Map<string, string>();
    for (const source of spec.sources) sourceKeys.set(source.id, (await must(api<{ key: string }>('POST', `/api/projects/${p}/sources`, source))).key);
    for (const event of [...spec.events].sort((a, b) => String(a.body.occurred_at).localeCompare(String(b.body.occurred_at)))) {
      clock = new Date(Math.max(Date.parse(clock), Date.parse(String(event.body.occurred_at)) + 1000)).toISOString();
      const result = await must(api<{ accepted: number; rejected: number }>('POST', '/ingest/events', event.body, sourceKeys.get(event.source)));
      if (result.accepted !== 1 || result.rejected !== 0) throw new Error(`evaluation event rejected: ${JSON.stringify(result)}`);
      while (store.processBatch(200).processed) { /* process all accepted records */ }
    }
    clock = new Date(Date.parse(clock) + spec.settle_seconds * 1000 + 1000).toISOString();
    store.evaluateProject(p);
    const otherProjectId = 'other-team';
    await must(api('POST', '/api/projects', { id: otherProjectId, name: 'Other team', dataset_kind: 'live' }));
    const agentToken = store.createToken('evaluated agent', 'viewer', [p], undefined, 'service').token;
    const events = store.listEvents(p), findings = store.listFindings(p), graph = store.getGraph(p)!;
    const health = await must(api<{ coverage: unknown; unobserved_asset_ids: unknown }>('GET', `/api/projects/${p}/health`, undefined, agentToken));
    return { url, projectId: p, otherProjectId, agentToken, clock, api, stop,
      known: { events: events.map(e => e.id), source_event_ids: events.map(e => e.source_event_id), findings: findings.map(f => f.id), assets: graph.assets.map(a => a.id), relationships: graph.relationships.map(r => r.id), sources: spec.sources.map(s => s.id), evidence_refs: [...new Set(events.flatMap(e => e.evidence_refs ?? []))], request_ids: [...new Set(events.flatMap(e => e.request_id ? [e.request_id] : []))], actors: [...new Set(events.flatMap(e => [e.actor_ref, e.session_ref, e.run_id].filter((s): s is string => !!s)))] },
      snapshot: { findings: findings.map(({ id, kind, outcome_state, evidence_level, title }) => ({ id, kind, outcome_state, evidence_level, title })), coverage: health.coverage, unobserved: health.unobserved_asset_ids },
    };
  } catch (error) { await stop(); throw error; }
}
