/** Controlled redesign verification only. Local synthetic records, fresh memory DB, no external services. */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createServer as createViteServer } from '../apps/web/node_modules/vite/dist/node/index.js';
import { expect, type Browser, type Page } from '@playwright/test';
import { openDb } from '../apps/server/src/db.ts';
import { Store } from '../apps/server/src/store.ts';
import { buildApp } from '../apps/server/src/app.ts';
import { seedDemo } from '../apps/server/src/seed.ts';

export const REDESIGN_ROOT = resolve(import.meta.dirname, '..');
export const REDESIGN_ARTIFACTS = join(REDESIGN_ROOT, 'artifacts/redesign/final');
export async function captureRedesign(page: Page, name: string) {
  mkdirSync(join(REDESIGN_ARTIFACTS, 'screenshots'), { recursive: true });
  const bytes = await page.screenshot({ path: join(REDESIGN_ARTIFACTS, 'screenshots', `${name}.png`) });
  const url = new URL(page.url()); const query: Record<string,string> = {};
  for (const key of ['fixture','moduleSheet','components','project']) { const value=url.searchParams.get(key); if(value) query[key]=value; }
  const pageInfo = await page.evaluate(() => ({ dpr:devicePixelRatio, build:document.querySelector('meta[name="dk-build"]')?.getAttribute('content'), reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,forcedColors:matchMedia('(forced-colors: active)').matches,cssZoom:getComputedStyle(document.documentElement).zoom }));
  writeFileSync(join(REDESIGN_ARTIFACTS, 'screenshots', `${name}.meta.json`), JSON.stringify({ name,file:`${name}.png`,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,capturedAt:new Date().toISOString(),viewport:page.viewportSize(),browser:page.context().browser()?.version(),...pageInfo,query,
    evidenceClass:query.fixture || query.moduleSheet || query.components ? 'explicit offline synthetic design fixture' : 'API-backed isolated synthetic server test; not live-production evidence',
    zoomNote:pageInfo.cssZoom==='2'?'CSS 200% emulation, not browser-chrome zoom or human approval':undefined,
    rendererNote:'Chromium headless SwiftShader requested; no real-GPU performance claim.' },null,2));
}

export async function createRedesignHarness() {
  mkdirSync(REDESIGN_ARTIFACTS, { recursive: true });
  const webDist = join(REDESIGN_ROOT, 'apps/web/dist');
  if (!existsSync(join(webDist, 'index.html'))) throw new Error('Run pnpm build before the redesign browser suite.');
  const db = openDb(':memory:');
  const store = new Store(db);
  seedDemo(store);
  seedDemo(store, { projectId: 'second-project' });
  const adminToken = store.createToken('Synthetic redesign administrator', 'admin').token;
  const viewerToken = store.createToken('Synthetic redesign viewer', 'viewer', ['demo-castle']).token;
  const app = await buildApp({ store, secret: randomBytes(32).toString('hex'), demoMode: false, planner: null, webDist, ssePollMs: 50 });
  const serverUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  let offlineUrl: string;
  let closeOffline: () => Promise<void>;
  if (process.env.DK_RED_OFFLINE_DIST) {
    const offlineDist = resolve(REDESIGN_ROOT, process.env.DK_RED_OFFLINE_DIST);
    if (!existsSync(join(offlineDist, 'index.html'))) throw new Error('Build the explicit synthetic snapshot before final verification.');
    const offlineApp = await buildApp({ store, secret: randomBytes(32).toString('hex'), demoMode: false, planner: null, webDist: offlineDist });
    offlineUrl = await offlineApp.listen({ host: '127.0.0.1', port: 0 });
    closeOffline = () => offlineApp.close();
  } else {
    const previous = process.env.VITE_DK_STATIC_DEMO;
    process.env.VITE_DK_STATIC_DEMO = '1';
    const offline = await createViteServer({ root: join(REDESIGN_ROOT, 'apps/web'), server: { host: '127.0.0.1', port: 0 } });
    if (previous === undefined) delete process.env.VITE_DK_STATIC_DEMO; else process.env.VITE_DK_STATIC_DEMO = previous;
    await offline.listen();
    const address = offline.httpServer!.address();
    offlineUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    closeOffline = () => offline.close();
  }
  return {
    offlineUrl, serverUrl, adminToken, viewerToken, store,
    disconnectClients() { app.server.closeAllConnections(); },
    async api(method: string, path: string, body?: unknown, token = adminToken) {
      const response = await fetch(serverUrl + path, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text(); let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
      return { status: response.status, json };
    },
    async close() { await closeOffline(); await app.close(); db.close(); },
  };
}
export type RedesignHarness = Awaited<ReturnType<typeof createRedesignHarness>>;
export async function loginRedesign(browser: Browser, h: RedesignHarness, options: { role?: 'admin' | 'viewer'; project?: string; viewport?: { width: number; height: number } } = {}) {
  const context = await browser.newContext({ viewport: options.viewport ?? { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${h.serverUrl}/?project=${encodeURIComponent(options.project ?? 'demo-castle')}`);
  await page.getByLabel('API token').fill(options.role === 'viewer' ? h.viewerToken : h.adminToken);
  await page.getByRole('button', { name: /^Sign in$/i }).click();
  await expect(page.locator('.app')).toBeVisible({ timeout: 30_000 });
  return { context, page };
}
export async function offlineRedesign(browser: Browser, h: RedesignHarness, query = '?fixture=F01', viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(h.offlineUrl + '/' + query);
  await expect(page.locator('.app')).toBeVisible({ timeout: 30_000 });
  return { context, page };
}
export async function rendererDetails(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return null;
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: String(gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER)), vendor: String(gl.getParameter(extension ? extension.UNMASKED_VENDOR_WEBGL : gl.VENDOR)) };
  });
}
export function writeRedesignEvidence(name: string, value: unknown) {
  mkdirSync(REDESIGN_ARTIFACTS, { recursive: true });
  writeFileSync(join(REDESIGN_ARTIFACTS, name), JSON.stringify(value, null, 2));
}
