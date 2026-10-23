/** Scoped navigation and session-boundary regressions, isolated synthetic server only. */
import { test, expect } from '@playwright/test';
import { createRedesignHarness, loginRedesign, offlineRedesign, writeRedesignEvidence, type RedesignHarness } from './redesign-harness.ts';
test.use({ trace: 'off' }); // This file measures retained DOM/listeners/heap without trace instrumentation.
let h: RedesignHarness;
test.beforeAll(async()=>{ h=await createRedesignHarness(); });
test.afterAll(async()=>{ await h?.close(); });

test('legacy project relationship view time basis survives reload and browser Back; local navigation search sends no query',async({browser})=>{
 const {context,page}=await loginRedesign(browser,h);
 try {
  const snapshot=(await h.api('GET','/api/projects/demo-castle/snapshot')).json;
  const relationship=snapshot.graph.relationships[0].id, cutoff='2026-10-20T14:05:00.000Z';
  const hash=new URLSearchParams({sel:`path:${relationship}`,view:'graph',t:cutoff,basis:'known'});
  await page.goto(`${h.serverUrl}/?project=demo-castle#${hash}`);
  await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id',relationship);
  await expect(page.getByRole('radio',{name:'2D graph',exact:true})).toBeChecked();
  await expect(page.getByTestId('timeline-mode')).toContainText('Received time');
  await expect(page.getByRole('slider',{name:'Replay position'})).toHaveValue(String(Date.parse(cutoff)));
  await page.reload(); await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id',relationship);
  await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('button',{name:'Coverage',exact:true}).click();
  const row=page.locator('.coverage-workspace tr[data-source-id]').first(), source=await row.getAttribute('data-source-id');
  await row.getByRole('button').first().click(); await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id',source!);
  await page.goBack(); await page.goBack();
  await expect(page.getByRole('main')).toHaveAttribute('aria-label','Kingdom workspace');
  await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id',relationship);
  await expect(page.getByRole('slider',{name:'Replay position'})).toHaveValue(String(Date.parse(cutoff)));
  const queries:string[]=[];page.on('request',request=>{if(/\/api\/.+search/.test(request.url()))queries.push(request.url());});
  await page.locator('input.search').fill('orders');await expect(page.locator('.search-results')).toBeVisible();
  await page.waitForTimeout(300);expect(queries).toEqual([]);
 } finally { await context.close(); }
});

test('logout clears records and a delayed prior-session export cannot download after same-project sign-in',async({browser})=>{
 const {context,page}=await loginRedesign(browser,h);let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});let held=false,downloads=0;
 try {
  await installLifecycleProbe(context); await page.reload(); await expect.poll(()=>page.evaluate(()=>(window as any).__dkLifecycle.activeStreams)).toBe(1);
  const finding=(await h.api('GET','/api/projects/demo-castle/findings')).json[0];
  await page.evaluate(id=>{location.hash=new URLSearchParams({workspace:'investigate',view:'graph',sel:`finding:${id}`}).toString();},finding.id);
  await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id',finding.id);
  page.on('download',()=>{downloads++;});
  await page.route(`**/cases/${encodeURIComponent(finding.id)}/export`,async route=>{const response=await route.fetch();held=true;await gate;await route.fulfill({response}).catch(()=>{});});
  await page.getByRole('button',{name:'Export case',exact:true}).click();
  await page.getByRole('dialog',{name:'Case export scope'}).getByRole('button',{name:'Download case export'}).click();
  await expect.poll(()=>held).toBe(true);await page.keyboard.press('Escape');
  const aborted=page.waitForEvent('requestfailed',{predicate:request=>request.url().includes(`/cases/${encodeURIComponent(finding.id)}/export`)});
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  expect((await aborted).failure()?.errorText).toMatch(/ABORTED|cancel/i);
  await expect.poll(()=>page.evaluate(()=>(window as any).__dkLifecycle.activeStreams)).toBe(0);
  await expect.poll(()=>page.evaluate(()=>(window as any).__dkLifecycle.pendingFetches)).toBe(0);
  await expect(page.getByLabel('API token')).toBeVisible();await expect(page.locator('aside.evidence')).toHaveCount(0);await expect(page.locator('.app')).toHaveCount(0);
  await page.getByLabel('API token').fill(h.adminToken);await page.getByRole('button',{name:/^Sign in$/i}).click();await expect(page.locator('.app')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>(window as any).__dkLifecycle.activeStreams)).toBe(1); release();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));expect(downloads).toBe(0);
 } finally { release();await context.close(); }
});

test('a warmed deep link cannot restore evidence after project access is denied',async({browser})=>{
 const {context,page}=await loginRedesign(browser,h);
 try {
  const finding=(await h.api('GET','/api/projects/demo-castle/findings')).json[0];
  await page.evaluate(id=>{location.hash=new URLSearchParams({workspace:'investigate',view:'graph',sel:`finding:${id}`}).toString();},finding.id);
  await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id',finding.id);
  await page.route('**/api/projects/demo-castle/snapshot',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'Synthetic revoked project access'})}));
  await page.reload();await expect(page.getByRole('alert')).toContainText(/Access denied|not available/);
  await expect(page.locator('.app')).toHaveCount(0);await expect(page.locator('aside.evidence')).toHaveCount(0);
  await expect(page.getByRole('alert')).not.toContainText(finding.claim);
 } finally {await context.close();}
});


async function installLifecycleProbe(context: import('@playwright/test').BrowserContext) {
 await context.addInitScript(()=>{
  const report={activeStreams:0,openedStreams:0,closedStreams:0,pendingFetches:0,listenerKeys:[] as string[]};
  (window as any).__dkLifecycle=report;
  const Native=window.EventSource;
  window.EventSource=class extends Native { private counted=true; constructor(url:string|URL,options?:EventSourceInit){super(url,options);report.activeStreams++;report.openedStreams++;} override close(){if(this.counted){this.counted=false;report.activeStreams--;report.closedStreams++;}super.close();} };
  const nativeFetch=window.fetch;
  window.fetch=async(...args)=>{report.pendingFetches++;try{return await nativeFetch(...args);}finally{report.pendingFetches--;}};
  const ids=new WeakMap<object,number>();let next=0;const active=new Set<string>();
  for(const [name,target] of [['window',window],['document',document]] as const){
   const add=target.addEventListener.bind(target),remove=target.removeEventListener.bind(target);
   const key=(type:string,listener:any,options:any)=>{if(!listener)return '';if(!ids.has(listener))ids.set(listener,++next);return `${name}:${type}:${ids.get(listener)}:${typeof options==='boolean'?options:!!options?.capture}`;};
   target.addEventListener=((type:any,listener:any,options:any)=>{active.add(key(type,listener,options));report.listenerKeys=[...active].sort();add(type,listener,options);}) as any;
   target.removeEventListener=((type:any,listener:any,options:any)=>{active.delete(key(type,listener,options));report.listenerKeys=[...active].sort();remove(type,listener,options);}) as any;
  }
 });
}

// Retained tracing adds DOM/snapshot instrumentation to the very resources measured here.
// Keep the real DOM/listener/heap limits unchanged and measure without that observer.
test('six project switches retain one live stream and bounded global listeners requests and collected browser heap',async({browser})=>{
 const {context,page}=await loginRedesign(browser,h);
 try {
  await installLifecycleProbe(context);await page.reload();await expect(page.locator('.app')).toBeVisible();
  await page.getByRole('radio',{name:'2D graph',exact:true}).click();
  const cdp=await context.newCDPSession(page);
  const sample=async()=>{await expect.poll(()=>page.evaluate(()=>(window as any).__dkLifecycle.activeStreams)).toBe(1);await expect.poll(()=>page.evaluate(()=>(window as any).__dkLifecycle.pendingFetches)).toBe(0);await page.waitForTimeout(800);await cdp.send('HeapProfiler.collectGarbage');await page.waitForTimeout(100);await cdp.send('HeapProfiler.collectGarbage');return {probe:await page.evaluate(()=>({...((window as any).__dkLifecycle)})),heap:await cdp.send('Runtime.getHeapUsage'),dom:await cdp.send('Memory.getDOMCounters')};};
  const switchProject=async(index:number)=>{const id=index%2===0?'second-project':'demo-castle';await page.getByLabel('Project',{exact:true}).selectOption(id);await expect(page.getByLabel('Project',{exact:true})).toHaveValue(id);await expect(page.locator('.app')).toBeVisible();await page.getByRole('radio',{name:'2D graph',exact:true}).click();await expect(page.locator('svg.graph2d')).toBeVisible();return sample();};
  // Warm both project paths twice, including the actual transient Castle teardown. R3F's
  // delayed disposal is 500 ms, so immediate Graph appearance is not a settled memory sample.
  for(let i=0;i<4;i++)await switchProject(i);
  const initial=await sample(), samples=[];
  for(let i=0;i<6;i++)samples.push(await switchProject(i));
  const last=samples.at(-1)!;
  expect(last.probe.activeStreams).toBe(1);expect(last.probe.closedStreams-initial.probe.closedStreams).toBe(6);expect(last.probe.openedStreams-initial.probe.openedStreams).toBe(6);
  // Compare active listener types/counts, not fresh callback IDs. CDP also counts native
  // and detached DOM listeners that the scoped window/document instrumentation cannot see.
  const counts=(keys:string[])=>keys.reduce<Record<string,number>>((map,key)=>{const kind=key.split(':').slice(0,2).join(':');map[kind]=(map[kind]??0)+1;return map;},{});
  expect(counts(last.probe.listenerKeys)).toEqual(counts(initial.probe.listenerKeys));
  expect(last.dom.nodes-initial.dom.nodes).toBeLessThanOrEqual(32);expect(last.dom.jsEventListeners-initial.dom.jsEventListeners).toBeLessThanOrEqual(32);
  expect(last.heap.usedSize-initial.heap.usedSize).toBeLessThan(2*1024*1024);
  writeRedesignEvidence('project-switch-resource-check.json',{recordedAt:new Date().toISOString(),conditions:'Both local synthetic projects warmed twice, then six measured switches with actual transient Castle mounts; 800 ms settling plus two GC passes 100 ms apart. Headless Chromium, SwiftShader, CDP DOM/listener and collected-heap counters plus scoped stream/fetch instrumentation. A bounded regression, not a zero-leak or physical-device performance proof.',browser:browser.version(),warmupSwitches:4,initial,samples,retainedHeapDeltaBytes:last.heap.usedSize-initial.heap.usedSize});
 }finally{await context.close();}
});


test('focused Castle and zoomed Graph each preserve their own camera on two-way return',async({browser})=>{
 const cutoff='2026-10-20T14:05:00.000Z';
 const {context,page}=await offlineRedesign(browser,h,'?fixture=F01#workspace=kingdom&view=castle&sel=asset:api&t='+encodeURIComponent(cutoff)+'&basis=known');
 try {
  await page.locator('.display-menu summary').click();await page.getByLabel('Runtime calls',{exact:true}).uncheck();await page.locator('.display-menu summary').click();
  const canvas=page.locator('.stage canvas');await expect.poll(()=>canvas.getAttribute('data-camera-pose')).toBeTruthy();
  const overview=await canvas.getAttribute('data-camera-pose');
  await page.getByRole('toolbar',{name:'Castle view'}).getByRole('button',{name:'Focus selection',exact:true}).click();
  await expect(canvas).toHaveAttribute('data-camera-active','true');await expect(canvas).toHaveAttribute('data-camera-active','false');
  const focused=await canvas.getAttribute('data-camera-pose');expect(focused).not.toBe(overview);
  await page.getByRole('radio',{name:'2D graph',exact:true}).click();const graph=page.locator('svg.graph2d');await expect(graph).toBeVisible();
  const graphOverview=await graph.getAttribute('viewBox');await page.getByRole('toolbar',{name:'Graph view'}).getByRole('button',{name:'Zoom in',exact:true}).click();
  const zoomed=await graph.getAttribute('viewBox');expect(zoomed).not.toBe(graphOverview);
  await page.getByRole('radio',{name:'3D castle',exact:true}).click();await expect.poll(()=>canvas.getAttribute('data-camera-pose')).toBe(focused);
  await expect(canvas).not.toHaveAttribute('data-camera-active','true');await page.waitForTimeout(500);await expect(canvas).not.toHaveAttribute('data-camera-active','true');expect(await canvas.getAttribute('data-camera-pose')).toBe(focused);
  await page.getByRole('radio',{name:'2D graph',exact:true}).click();await expect(graph).toHaveAttribute('viewBox',zoomed!);
  await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id','api');
  await expect(page.getByRole('slider',{name:'Replay position'})).toHaveValue(String(Date.parse(cutoff)));
  await expect(page.getByTestId('timeline-mode')).toContainText('Received time');
  await page.locator('.display-menu summary').click();await expect(page.getByLabel('Runtime calls',{exact:true})).not.toBeChecked();await page.locator('.display-menu summary').click();
 } finally{await context.close();}
});
