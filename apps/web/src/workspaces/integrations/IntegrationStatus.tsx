import { useApp } from '../../lib/state.tsx';
import { fmtDateTime } from '../../lib/vocab.ts';
import './setup.css';

/** Declared source kind is configuration metadata, not proof that an external adapter is connected. */
export function IntegrationStatus({ kind }: { kind: 'application' | 'otel' | 'falco' | 'inventory' }) {
  const { vm, dispatch } = useApp();
  const data = vm.latestData;
  if (kind === 'inventory') return <div className="integration-status" data-integration-status={kind}><strong>{data.graph.assets.length ? 'Declared inventory present' : 'Inventory not configured'}</strong><p>{data.graph.assets.length} assets · revision <code>{data.graph.graph_revision}</code>.</p><p>Stored declarations do not establish how they were imported or whether runtime activity is observed.</p></div>;
  const kinds = kind === 'application' ? ['app_security', 'app_auth'] : [kind];
  const sources = data.sources.filter(source => kinds.includes(source.kind ?? ''));
  const disabled = sources.filter(source => source.disabled).length;
  const reporting = sources.filter(source => !source.disabled && data.coverage.some(record => record.source_id === source.id && record.state === 'healthy')).length;
  const gaps = sources.filter(source => !source.disabled && data.coverage.some(record => record.source_id === source.id && (record.state === 'degraded' || record.state === 'offline'))).length;
  const unknown = sources.length - disabled - reporting - gaps;
  return <div className="integration-status" data-integration-status={kind}>
    <strong>{sources.length ? `${sources.length} matching source records configured` : 'No matching source records configured'}</strong>
    <p>Declared kinds: <code>{kinds.join(', ')}</code>. {kind === 'application' ? 'SDK installation is not observable from this metadata.' : 'A registered source is not proof of an external connection.'}</p>
    {sources.length > 0 && <><p>Current assessment: {reporting} reporting · {gaps} with reported gaps · {disabled} disabled · {unknown} not assessed.</p><p>As of {fmtDateTime(vm.coverageAsOf)}. {data.mode === 'offline-demo' ? 'Synthetic fixture states, not live connections.' : 'Current coverage, not historical coverage or a security verdict.'}</p></>}
    <button className="link" onClick={() => { dispatch({ type: 'workspace', workspace: 'coverage' }); dispatch({ type: 'panel', panel: 'inspector', open: false }); }}>Inspect source records and timestamps</button>
  </div>;
}
