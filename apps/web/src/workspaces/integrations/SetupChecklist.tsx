import { useApp } from '../../lib/state.tsx';
import { setupProgress } from './setupProgress.ts';
import './setup.css';

export function SetupChecklist() {
  const { vm, dispatch } = useApp();
  if (vm.data.mode !== 'server') return null;
  const progress = setupProgress(vm.latestData);
  if (progress.complete) return null;
  const setup = () => { dispatch({ type: 'workspace', workspace: 'integrations' }); dispatch({ type: 'panel', panel: 'inspector', open: false }); };
  return <section className="setup-checklist" aria-label="Project setup checklist">
    <h3>Start with real records.</h3>
    <p>{!progress.inventory ? 'No assets have been added to this project.' : !progress.source ? 'The map is available; activity visibility is not configured.' : 'Event receipt is not confirmed in the current server snapshot.'}</p>
    <ol>
      <li data-setup-step="inventory" data-complete={progress.inventory}><strong>Import inventory</strong><span>{progress.inventory ? `${vm.latestData.graph.assets.length} declared assets in server inventory.` : 'No imported assets.'}</span><button className="link" onClick={setup}>Open inventory setup</button></li>
      <li data-setup-step="source" data-complete={progress.source}><strong>Configure a supported source</strong><span>{progress.source ? `${vm.latestData.sources.length} configured source records, including any disabled sources.` : 'No source records configured.'}</span><button className="link" onClick={setup}>View supported source setup</button></li>
      <li data-setup-step="receipt" data-complete={progress.receipt}><strong>Confirm receipt of a test event</strong><span>{progress.receipt ? 'Server-recorded receipt is available. Verify the record is your intended test.' : 'No receipt confirmed from loaded events or source timestamps. Search stored records to check older receipt.'}</span><button className="link" onClick={() => { dispatch({ type: 'workspace', workspace: 'investigate' }); dispatch({ type: 'investigateTab', tab: 'events' }); dispatch({ type: 'panel', panel: 'inspector', open: false }); }}>Inspect stored events</button></li>
    </ol><p className="small muted">Status comes from current server data, not button clicks. Inventory, configuration and receipt do not establish protection or complete visibility.</p>
  </section>;
}
