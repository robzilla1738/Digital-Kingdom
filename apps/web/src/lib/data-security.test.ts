import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api, ApiError, detectServer, loadFromServer, loadOfflineDemo } from './data.ts';

afterEach(() => vi.unstubAllGlobals());
describe('authorized dataset loading and mutation transport', () => {
  it('does not substitute synthetic data on a server error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(detectServer(new Api())).rejects.toThrow('offline');
  });
  it('maps only an actual401 to unauthenticated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'expired' }), { status: 401 })));
    expect(await detectServer(new Api())).toEqual({ name: '', role: 'none', kind: 'unauthenticated' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
    await expect(detectServer(new Api())).rejects.toMatchObject({ status: 403 });
  });
  it('does not silently fall back to another project when the requested project is forbidden', async () => {
    const get = vi.fn().mockResolvedValue([{ id: 'allowed', name: 'Allowed', dataset_kind: 'live' }]);
    await expect(loadFromServer({ get } as unknown as Api, 'forbidden')).rejects.toMatchObject({ status: 403 });
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('passes cancellation through every snapshot request and encodes project paths', async () => {
    const data = loadOfflineDemo(), signal = new AbortController().signal;
    const get = vi.fn().mockResolvedValueOnce([{ id: 'project/a b', name: 'One', dataset_kind: 'live' }]).mockResolvedValueOnce({ ...data, project: { ...data.project, id: 'project/a b', dataset_kind: 'live' }, server_time: '2026-10-22T12:00:00Z' });
    const result = await loadFromServer({ get } as unknown as Api, 'project/a b', signal);
    expect(get.mock.calls).toEqual([['/api/projects', signal], ['/api/projects/project%2Fa%20b/snapshot', signal]]);
    expect(result.mode).toBe('server'); expect(result.coverage_as_of).toBe('2026-10-22T12:00:00Z');
  });
  it('represents an empty real project honestly instead of synthetic inventory', async () => {
    const data = loadOfflineDemo();
    const get = vi.fn().mockResolvedValueOnce([{ id: 'empty', name: 'Empty', dataset_kind: 'live' }]).mockResolvedValueOnce({ ...data, graph: null, scene: null, events: [], findings: [], coverage: [], sources: [], evidence: {}, project: { id: 'empty', name: 'Empty', dataset_kind: 'live' }, server_time: '2026-10-22T12:00:00Z' });
    const result = await loadFromServer({ get } as unknown as Api, 'empty');
    expect(result.graph.assets).toEqual([]); expect(result.scene.rooms).toEqual([]); expect(result.mode).toBe('server');
  });
  it('sends existing raw inventory API with CSRF header and preserves422 issues', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid inventory', details: ['/assets/0: required', { unsafe: true }] }), { status: 422 })); vi.stubGlobal('fetch', fetch);
    await expect(new Api().sendText('POST', '/api/projects/p/graph?format=manifest', 'assets: []')).rejects.toEqual(new ApiError(422, 'invalid inventory', ['/assets/0: required']));
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ body: 'assets: []', credentials: 'same-origin', headers: { 'content-type': 'application/yaml', 'x-dk-request': '1' } });
  });
  it('does not advertise an empty body as JSON for case export', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}')); vi.stubGlobal('fetch', fetch);
    await new Api().send('POST', '/api/projects/p/cases/c/export');
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ 'x-dk-request': '1', accept: 'application/json' });
  });
  it('tags denial with the authorization scope captured before a delayed response', async () => {
    let scope = 3, finish!: (response: Response) => void;
    const events: CustomEvent[] = [];
    vi.stubGlobal('window', { dispatchEvent: (event: CustomEvent) => events.push(event) });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; })));
    const pending = new Api('', () => scope).get('/api/projects/old/containment');
    scope = 4;
    finish(new Response('{}', { status: 403 }));
    await expect(pending).rejects.toMatchObject({ status: 403 });
    expect(events[0]?.detail).toEqual({ status: 403, path: '/api/projects/old/containment', scope: 3 });
  });
  it('propagates aborts without reporting a login failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('request stopped', 'AbortError')));
    await expect(detectServer(new Api(), new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('combines caller and authorization cancellation for reads and exports', async () => {
    const scope = new AbortController(), caller = new AbortController();
    const fetch = vi.fn().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('scope stopped', 'AbortError')), { once: true });
    })); vi.stubGlobal('fetch', fetch);
    const api = new Api('', () => 1, () => scope.signal);
    const read = api.get('/api/projects/p/events/e', caller.signal), exported = api.send('POST', '/api/projects/p/cases/f/export');
    const readProof = expect(read).rejects.toMatchObject({ name: 'AbortError' });
    caller.abort(); await readProof;
    expect((fetch.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true);
    expect((fetch.mock.calls[1]![1] as RequestInit).signal?.aborted).toBe(false);
    const exportProof = expect(exported).rejects.toMatchObject({ name: 'AbortError' });
    scope.abort(); await exportProof;
    expect((fetch.mock.calls[1]![1] as RequestInit).signal?.aborted).toBe(true);
  });

});
