/** Read-only layout audit. Explicit synthetic data, no action submission or production service. */
import { chromium, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRedesignHarness, loginRedesign, writeRedesignEvidence } from '../../../e2e/redesign-harness.ts';
const harness=await createRedesignHarness();
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader','--ignore-gpu-blocklist']});
const samples:any[]=[];
async function measure(page:any,width:number,state:string,selector:string){
  const controls=await page.locator(selector).evaluate((root:HTMLElement)=>Array.from(root.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,summary')).filter(element=>element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden'&&!element.matches(':disabled')).map(element=>{
    const label=element instanceof HTMLInputElement&&(element.type==='checkbox'||element.type==='radio')?element.labels?.[0]:null;const target=label??element;const r=target.getBoundingClientRect();return {tag:element.tagName,type:(element as HTMLInputElement).type,name:element.getAttribute('aria-label')||element.getAttribute('title')||label?.textContent?.trim().slice(0,110)||element.textContent?.trim().slice(0,110)||element.getAttribute('name')||element.id,width:r.width,height:r.height,associatedLabelTarget:!!label};
  }));expect(controls.length,`${state} must expose actual measured controls`).toBeGreaterThan(0);samples.push({width,state,evidenceClass:page.url().includes('fixture=')?'Explicit offline synthetic fixture':'Isolated API-backed synthetic test with a labeled long-payload response fixture',build:await page.locator('meta[name="dk-build"]').getAttribute('content'),controls,undersized:controls.filter((control:any)=>control.width<43.5||control.height<43.5)});
}
try{
  for(const width of [390,320]){
    const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:1});const page=await context.newPage();
    await page.goto(`${harness.offlineUrl}/?fixture=F01#workspace=investigate`);await expect(page.locator('.app')).toBeVisible();
    await page.getByRole('button',{name:'Filter findings',exact:true}).click();await measure(page,width,'expanded finding filters','.findings-workspace');
    await page.locator('.findings-workspace [data-finding-id]').first().click();await expect(page.locator('aside.evidence')).toBeVisible();await measure(page,width,'finding inspector','aside.evidence');
    await page.getByRole('button',{name:'Expand investigation',exact:true}).click();await expect(page.locator('aside.evidence')).toHaveAttribute('data-expanded','true');await expect(page.getByRole('navigation',{name:'Filtered finding queue'})).toBeVisible();await measure(page,width,'expanded finding and compact queue','aside.evidence');
    await page.getByTestId('evidence-card-raw').first().locator('summary').click();await expect(page.getByTestId('evidence-card-payload').first()).toBeVisible();await measure(page,width,'expanded finding with open raw evidence','aside.evidence');
    await page.goto(`${harness.offlineUrl}/?fixture=F01#workspace=investigate&sel=asset:api`);await expect(page.locator('aside.evidence')).toBeVisible();await measure(page,width,'asset inspector','aside.evidence');
    for(const summary of await page.locator('aside.evidence details:not([open]) > summary').all())await summary.click();await measure(page,width,'asset inspector expanded details','aside.evidence');
    await context.close();
    // Only the local test response is augmented, not production records or canonical event semantics.
    const target=(await harness.api('GET','/api/projects/demo-castle/findings')).json.find((finding:any)=>finding.counterevidence_event_ids.length);
    const live=await loginRedesign(browser,harness,{viewport:{width,height:844}});
    await live.page.route(`**/findings/${encodeURIComponent(target.id)}/evidence?*`,async route=>{
      const response=await route.fetch(),json=await response.json();
      for(const record of Object.values(json.evidence) as Record<string,unknown>[])record.synthetic_layout_payload='SYNTHETIC LONG PAYLOAD FOR READ-ONLY TOUCH AUDIT. '.repeat(400);
      await route.fulfill({response,json});
    });
    await live.page.evaluate(id=>{location.hash=new URLSearchParams({workspace:'investigate',sel:`finding:${id}`}).toString();},target.id);
    await expect(live.page.locator('aside.evidence')).toHaveAttribute('data-selection-id',target.id);
    await live.page.getByRole('button',{name:'Expand investigation',exact:true}).click();
    const raw=live.page.locator('article[data-evidence-role="supporting"]').first().getByTestId('evidence-card-raw');await raw.locator('summary').click();
    await raw.getByRole('button',{name:'Next text page',exact:true}).click();await expect(raw.getByRole('button',{name:'Previous text page',exact:true})).toBeEnabled();await expect(raw.getByRole('button',{name:'Next text page',exact:true})).toBeEnabled();
    await measure(live.page,width,'expanded finding queue and raw-text pagination page two','aside.evidence');
    await live.context.close();
  }
  writeRedesignEvidence('narrow-body-filter-touch-audit.json',{capturedAt:new Date().toISOString(),harnessSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),browser:browser.version(),node:process.version,scope:'Read-only Chromium bounding boxes at 390/320 CSS px. Native checkbox/radio associated labels count as their actual click target. Not a physical touch-device test or every possible application state.',samples});
  console.log(JSON.stringify(samples.map(sample=>({width:sample.width,state:sample.state,controls:sample.controls.length,undersized:sample.undersized})),null,2));
  expect(samples.flatMap(sample=>sample.undersized.map((control:any)=>({width:sample.width,state:sample.state,...control}))),'All measured effective touch targets meet 44 CSS px in both dimensions').toEqual([]);
}finally{await browser.close();await harness.close();}
