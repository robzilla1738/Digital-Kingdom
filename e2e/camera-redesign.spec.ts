import { test, expect } from '@playwright/test';
import { createRedesignHarness, captureRedesign, writeRedesignEvidence, type RedesignHarness } from './redesign-harness.ts';
let h: RedesignHarness;
const reports: unknown[]=[];
test.beforeAll(async()=>{h=await createRedesignHarness();});
test.afterAll(async()=>{writeRedesignEvidence('camera-and-picking-verification.json',reports);await h?.close();});

test('CASTLE-12: an actual pointer drag cancels active camera focus with no later snap-back',async({page})=>{
 await page.goto(h.offlineUrl+'/?fixture=F01#workspace=kingdom&view=castle&sel=asset:api');
 const canvas=page.locator('canvas');await expect(canvas).toBeVisible();await expect.poll(async()=>Number(await canvas.getAttribute('data-render-count'))).toBeGreaterThan(0);await page.waitForTimeout(700);
 const before=await canvas.getAttribute('data-camera-pose');
 await page.getByRole('toolbar',{name:'Castle view'}).getByRole('button',{name:'Focus selection',exact:true}).click();
 await expect(canvas).toHaveAttribute('data-camera-active','true');
 const rect=await canvas.boundingBox();expect(rect).not.toBeNull();
 await page.mouse.move(rect!.x+rect!.width*.12,rect!.y+rect!.height*.12);await page.mouse.down();
 await page.mouse.move(rect!.x+rect!.width*.26,rect!.y+rect!.height*.22,{steps:5});await page.mouse.up();
 await expect(canvas).toHaveAttribute('data-camera-active','false');await page.waitForTimeout(180);
 const stopped=await canvas.getAttribute('data-camera-pose');expect(stopped).not.toBe(before);
 await page.waitForTimeout(650);expect(await canvas.getAttribute('data-camera-pose')).toBe(stopped);
 const frameCount=await canvas.getAttribute('data-render-count');await page.waitForTimeout(400);expect(await canvas.getAttribute('data-render-count')).toBe(frameCount);
 await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id','api');
 await captureRedesign(page,'camera-user-drag-interrupts-focus');reports.push({case:'manual pointer drag cancels active focus',before,stopped,idleFrames:frameCount,selection:'api',result:'passed'});
});

test('overlapping graph relationships open a keyboard chooser; cancel/drag do not select or move camera',async({page})=>{
 await page.goto(h.offlineUrl+'/?fixture=F01#workspace=kingdom&view=graph&sel=asset:api');
 await expect(page.locator('svg.graph2d')).toBeVisible();await expect(page.locator('[data-edge-id]')).not.toHaveCount(0);await page.waitForTimeout(600);
 for(let i=0;i<6;i++)await page.getByRole("toolbar",{name:"Graph view"}).getByRole("button",{name:"Zoom out",exact:true}).click();
 const point=await page.evaluate(()=>{
   const paths=[...document.querySelectorAll<SVGPathElement>('[data-edge-id] .edge-hit')].map(path=>{const matrix=path.getScreenCTM()!,length=path.getTotalLength();return {id:path.parentElement!.getAttribute('data-edge-id')!,points:Array.from({length:121},(_,i)=>{const p=path.getPointAtLength(length*i/120);return{x:matrix.a*p.x+matrix.c*p.y+matrix.e,y:matrix.b*p.x+matrix.d*p.y+matrix.f};})};});
   for(let a=0;a<paths.length;a++)for(let b=a+1;b<paths.length;b++)for(const p of paths[a]!.points)for(const q of paths[b]!.points){
     if(Math.hypot(p.x-q.x,p.y-q.y)>9)continue;const x=(p.x+q.x)/2,y=(p.y+q.y)/2;
     if(document.elementFromPoint(x,y)?.closest('[data-edge-id]'))return{x,y,ids:[paths[a]!.id,paths[b]!.id]};
   }return null;
 });
 expect(point,'Fixture should contain a physically overlapping visible connection hit area').not.toBeNull();
 const vb=await page.locator('svg.graph2d').getAttribute('viewBox');
 await page.mouse.click(point!.x,point!.y);const chooser=page.getByRole('dialog',{name:'Choose relationship'});await expect(chooser).toBeVisible();
 const choices=await chooser.locator('[data-edge-choice]').evaluateAll(es=>es.map(e=>e.getAttribute('data-edge-choice')));expect(choices.length).toBeGreaterThan(1);expect(choices.length).toBeLessThanOrEqual(20);
 await expect(chooser.locator('[data-edge-choice]').first()).toBeFocused();await captureRedesign(page,'overlapping-relationship-keyboard-chooser');
 await page.keyboard.press('Escape');await expect(chooser).toBeHidden();await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id','api');
 await page.mouse.move(point!.x,point!.y);await page.mouse.down();await page.mouse.move(point!.x+24,point!.y+15,{steps:4});await page.mouse.up();await expect(chooser).toBeHidden();await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id','api');
 await page.mouse.click(point!.x,point!.y);await expect(chooser).toBeVisible();const chosen=await chooser.locator('[data-edge-choice]').first().getAttribute('data-edge-choice');await page.keyboard.press('Enter');
 await expect(chooser).toBeHidden();await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id',chosen!);expect(await page.locator('svg.graph2d').getAttribute('viewBox')).toBe(vb);
 reports.push({case:'overlapping edge chooser',pointer:point,choices,chosen,selectionDoesNotFocus:true,escapeAndDragPreserveSelection:true,result:'passed'});
});

test('overlapping 3D connections open the same real-ID chooser without moving camera',async({page})=>{
 const {createRequire}=await import('node:module');const THREE=createRequire(new URL('../apps/web/package.json',import.meta.url))('three') as typeof import('three');const {demoGraph}=await import('../fixtures/testing/load.ts');const {compileScene,defaultProposal}=await import('../packages/scene-compiler/src/index.ts');
 // Same documented F01 seed and presentation-only great_hall substitution; canonical graph IDs unchanged.
 const graph=demoGraph(),proposal=defaultProposal(graph,20261022);proposal.placements.find(p=>p.asset_id===graph.assets.find(a=>a.kind==='service')!.id)!.module_id='great_hall';const fixture={scene:compileScene(graph,proposal)};
 await page.goto(h.offlineUrl+'/?fixture=F01#workspace=kingdom&view=castle&sel=asset:api');const canvas=page.locator('canvas');await expect.poll(async()=>Number(await canvas.getAttribute('data-render-count'))).toBeGreaterThan(0);await page.waitForTimeout(650);
 for(let i=0;i<2;i++){await page.getByRole('toolbar',{name:'Castle view'}).getByRole('button',{name:'Zoom out',exact:true}).click();await page.waitForTimeout(420);}
 const rect=(await canvas.boundingBox())!,pose=JSON.parse((await canvas.getAttribute('data-camera-pose'))!);
 const camera=new THREE.OrthographicCamera(-rect.width/2,rect.width/2,rect.height/2,-rect.height/2,.1,800);camera.zoom=pose.zoom;camera.position.fromArray(pose.position);camera.lookAt(new THREE.Vector3(...pose.target));camera.updateProjectionMatrix();camera.updateMatrixWorld();
 const edges=fixture.scene.paths.filter(p=>(p.source_asset_id==='api'||p.target_asset_id==='api')&&p.evidence_level!=='hypothetical'&&p.kind!=='deploys').map(p=>({id:p.relationship_id,points:new THREE.CatmullRomCurve3(p.points.map(v=>new THREE.Vector3(v.x,v.y,v.z))).getPoints(100).map(v=>{v.project(camera);return{x:rect.x+(v.x+1)/2*rect.width,y:rect.y+(1-v.y)/2*rect.height};})}));
 const candidates:{x:number;y:number}[]=[];
 for(let a=0;a<edges.length;a++)for(let b=a+1;b<edges.length;b++)for(const p of edges[a]!.points)for(const q of edges[b]!.points){if(Math.hypot(p.x-q.x,p.y-q.y)<8){const x=(p.x+q.x)/2,y=(p.y+q.y)/2;if(x>rect.x+10&&x<rect.x+rect.width-160&&y>rect.y+10&&y<rect.y+rect.height-80&&!candidates.some(c=>Math.hypot(c.x-x,c.y-y)<8))candidates.push({x,y});}}
 expect(candidates.length).toBeGreaterThan(0);const chooser=page.getByRole('dialog',{name:'Choose relationship'});let clicked:null|{x:number;y:number}=null;
 for(const p of candidates.slice(0,40)){const clear=await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS',p);if(!clear)continue;await page.mouse.click(p.x,p.y);if(await chooser.isVisible()){clicked=p;break;}await page.evaluate(()=>{location.hash='workspace=kingdom&view=castle&sel=asset:api';});await page.waitForTimeout(40);}
 expect(clicked,'A visible projected 3D crossing must be pickable').not.toBeNull();await expect(chooser).toBeVisible();const ids=await chooser.locator('[data-edge-choice]').evaluateAll(es=>es.map(e=>e.getAttribute('data-edge-choice')));expect(ids.length).toBeGreaterThan(1);expect(ids.every(id=>fixture.scene.paths.some(p=>p.relationship_id===id))).toBe(true);
 const before=await canvas.getAttribute('data-camera-pose');await captureRedesign(page,'3d-overlapping-relationship-chooser');const chosen=ids[0]!;await page.keyboard.press('Enter');await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id',chosen);await page.waitForTimeout(120);expect(await canvas.getAttribute('data-camera-pose')).toBe(before);reports.push({case:'3D overlapping connections',clicked,ids,chosen,selectionDoesNotFocus:true,result:'passed'});
});

test('CASTLE-08: clicking a visible architectural roof resolves its canonical parent asset',async({page})=>{
 const {createRequire}=await import('node:module');const THREE=createRequire(new URL('../apps/web/package.json',import.meta.url))('three') as typeof import('three');
 const {demoGraph}=await import('../fixtures/testing/load.ts');const {compileScene,defaultProposal}=await import('../packages/scene-compiler/src/index.ts');const {moduleGeometry}=await import('../apps/web/src/castle/geometry.ts');
 const graph=demoGraph(),proposal=defaultProposal(graph,20261022);proposal.placements.find(p=>p.asset_id===graph.assets.find(a=>a.kind==='service')!.id)!.module_id='great_hall';
 const room=compileScene(graph,proposal).rooms.find(r=>r.asset_id==='edge')!;
 await page.goto(h.offlineUrl+'/?fixture=F01#workspace=kingdom&view=castle&sel=asset:edge');const canvas=page.locator('canvas');await expect.poll(async()=>Number(await canvas.getAttribute('data-render-count'))).toBeGreaterThan(0);await page.waitForTimeout(500);
 await page.getByRole('toolbar',{name:'Castle view'}).getByRole('button',{name:'Focus selection',exact:true}).click();await expect(canvas).toHaveAttribute('data-camera-active','true');await expect(canvas).toHaveAttribute('data-camera-active','false');
 await page.evaluate(()=>{location.hash='workspace=kingdom&view=castle&sel=asset:api';});await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id','api');await page.waitForTimeout(150);
 const rect=(await canvas.boundingBox())!,pose=JSON.parse((await canvas.getAttribute('data-camera-pose'))!),before=await canvas.getAttribute('data-camera-pose');
 const camera=new THREE.OrthographicCamera(-rect.width/2,rect.width/2,rect.height/2,-rect.height/2,.1,800);camera.zoom=pose.zoom;camera.position.fromArray(pose.position);camera.lookAt(new THREE.Vector3(...pose.target));camera.updateProjectionMatrix();camera.updateMatrixWorld();
 const roof=moduleGeometry(room.module_id).groups.roof!,vertices=roof.getAttribute('position'),matrix=new THREE.Matrix4().compose(new THREE.Vector3(room.position.x,.08,room.position.z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),room.rotation_y*Math.PI/180),new THREE.Vector3(1,1,1));
 const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(roof,material);mesh.applyMatrix4(matrix);mesh.updateMatrixWorld();let clicked:null|{x:number;y:number;world:number[]}=null;
 for(let i=0;i<Math.min(vertices.count,300);i+=3){const centre=new THREE.Vector3().add(new THREE.Vector3().fromBufferAttribute(vertices,i)).add(new THREE.Vector3().fromBufferAttribute(vertices,i+1)).add(new THREE.Vector3().fromBufferAttribute(vertices,i+2)).multiplyScalar(1/3).applyMatrix4(matrix);if(centre.y<3.1)continue;
   const screen=centre.clone().project(camera),x=rect.x+(screen.x+1)/2*rect.width,y=rect.y+(1-screen.y)/2*rect.height;if(x<rect.x+8||x>rect.x+rect.width-160||y<rect.y+8||y>rect.y+rect.height-80)continue;
   const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(screen.x,screen.y),camera);if(!ray.intersectObject(mesh).length)continue;
   if(!await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS',{x,y}))continue;
   await page.mouse.click(x,y);if(await page.locator('aside.evidence').getAttribute('data-selection-id')==='edge'){clicked={x,y,world:centre.toArray()};break;}
 }
 material.dispose();expect(clicked,'A real visible roof triangle must pick its parent edge asset').not.toBeNull();await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id','edge');await expect(page.locator('aside.evidence')).toContainText('public-edge');expect(await canvas.getAttribute('data-camera-pose')).toBe(before);
 await captureRedesign(page,'decorative-roof-selects-canonical-parent');reports.push({case:'decorative surface picking',module:room.module_id,clicked,canonicalAssetId:'edge',previousSelection:'api',selectionDoesNotFocus:true,result:'passed'});
});

test('CASTLE-11: an unlinked event highlights its asset without inventing or animating a causal trail',async({page})=>{
 const {demoGraph}=await import('../fixtures/testing/load.ts');const graph=demoGraph(),asset=graph.assets.find(a=>a.kind==='database')!,event='redesign-unlinked-data-access';
 await page.goto(h.offlineUrl+`/?fixture=F06#workspace=kingdom&view=graph&sel=asset:${asset.id}`);await expect(page.locator('svg.graph2d')).toBeVisible();
 const ids=await page.locator('[data-edge-id]').evaluateAll(es=>es.map(e=>e.getAttribute('data-edge-id')).sort());expect(ids.length).toBeGreaterThan(0);
 await page.evaluate(event=>{location.hash='workspace=kingdom&view=graph&sel=event:'+event;},event);await expect(page.getByTestId('event-unlinked')).toBeVisible();
 const eventIds=await page.locator('[data-edge-id]').evaluateAll(es=>es.map(e=>e.getAttribute('data-edge-id')).sort());expect(eventIds).toEqual(ids);expect(eventIds.every(id=>graph.relationships.some(r=>r.id===id))).toBe(true);
 await expect(page.locator('svg.graph2d animate, svg.graph2d animateMotion')).toHaveCount(0);expect(await page.locator('[data-edge-id]').evaluateAll(es=>es.flatMap(e=>e.getAnimations({subtree:true})).filter(a=>a.playState==='running').length)).toBe(0);
 await page.evaluate(asset=>{location.hash='workspace=kingdom&view=castle&sel=asset:'+asset;},asset.id);const canvas=page.locator('canvas');await expect.poll(async()=>Number(await canvas.getAttribute('data-render-count'))).toBeGreaterThan(0);await page.waitForTimeout(650);const before=await canvas.getAttribute('data-camera-pose');
 await page.evaluate(event=>{location.hash='workspace=kingdom&view=castle&sel=event:'+event;},event);await expect(page.getByTestId('event-unlinked')).toBeVisible();await expect(page.locator(`[data-asset-label="${asset.id}"]`)).toHaveClass(/is-selected/);await page.waitForTimeout(400);
 // Late demand frames can follow the selection change (CI run 40055538817 saw 6 -> 7 inside the idle window; same race as
 // D-M1-CI-2). With software rendering under load, demand frames can be several hundred ms apart, so first wait (bounded) for
 // one full quiet 700 ms window; a continuously animated trail never produces one and still fails. Then the unchanged assertion.
 await expect.poll(async()=>{const a=await canvas.getAttribute('data-render-count');await page.waitForTimeout(700);return a===await canvas.getAttribute('data-render-count');},{timeout:10_000}).toBe(true);
 const frames=await canvas.getAttribute('data-render-count');await page.waitForTimeout(700);expect(await canvas.getAttribute('data-render-count')).toBe(frames);expect(await canvas.getAttribute('data-camera-pose')).toBe(before);
 await captureRedesign(page,'unlinked-event-static-asset-highlight');reports.push({case:'unlinked event has no invented causal trail',event,asset:asset.id,existingStaticRelationshipIds:eventIds,renderCountStable:frames,cameraUnchanged:true,result:'passed'});
});

test('PERF-02: genuine background-tab visibility pauses rendering when supported by the browser',async({page})=>{
 await page.goto(h.offlineUrl+'/?fixture=F01#workspace=kingdom&view=castle&sel=asset:api');const canvas=page.locator('canvas');await expect.poll(async()=>Number(await canvas.getAttribute('data-render-count'))).toBeGreaterThan(0);await page.waitForTimeout(500);
 const other=await page.context().newPage();await other.goto('about:blank');await page.bringToFront();
 await page.getByRole('toolbar',{name:'Castle view'}).getByRole('button',{name:'Focus selection',exact:true}).click();await expect(canvas).toHaveAttribute('data-camera-active','true');await other.bringToFront();
 const visibility=await page.evaluate(()=>({hidden:document.hidden,state:document.visibilityState}));
 if(!visibility.hidden){reports.push({case:'real background-tab pause',result:'unsupported in this headless browser',visibility,reason:'Bringing a genuine second tab to the front does not change document visibility. No hidden-property override or synthetic visibility event used.'});await other.close();test.skip(true,'Headless Chromium keeps both real tabs visible; physical hidden-tab lifecycle is not proven.');}
 await page.waitForTimeout(150);const hiddenFrames=await canvas.getAttribute('data-render-count');await page.waitForTimeout(500);expect(await canvas.getAttribute('data-render-count')).toBe(hiddenFrames);await page.bringToFront();await expect.poll(async()=>page.evaluate(()=>document.hidden)).toBe(false);await expect(canvas).toHaveAttribute('data-camera-active','false');
 reports.push({case:'real background-tab pause',visibility,hiddenFrames,result:'passed'});await other.close();
});

test('PERF-05: sustained real slow active frames reduce quality without changing evidence or labels',async({page})=>{
 await page.addInitScript(()=>{
  const native=window.requestAnimationFrame.bind(window);
  (window as any).__dkSlowFrameMs=0;
  window.requestAnimationFrame=callback=>native(timestamp=>{
   const until=performance.now()+Number((window as any).__dkSlowFrameMs||0);
   while(performance.now()<until) { /* Deliberate test-only CPU contention; real wall time, no fabricated frame timestamps. */ }
   callback(timestamp);
  });
 });
 await page.goto(h.offlineUrl+'/?fixture=F01#workspace=kingdom&view=castle&sel=asset:api');
 const canvas=page.locator('canvas');await expect.poll(async()=>Number(await canvas.getAttribute('data-render-count'))).toBeGreaterThan(0);
 await page.waitForTimeout(650);const before=await canvas.getAttribute('data-quality');expect(before).toBe('medium');
 const inspector=page.locator('aside.evidence'),evidence=await inspector.innerText();const selectedLabel=page.locator('[data-asset-label="api"]');await expect(selectedLabel).toBeVisible();
 const rect=(await canvas.boundingBox())!;await page.mouse.move(rect.x+rect.width*.2,rect.y+rect.height*.6);await page.mouse.down();
 await page.evaluate(()=>{(window as any).__dkSlowFrameMs=75;});
 const qualities:string[]=[];
 for(let i=0;i<38;i++){
  await page.mouse.move(rect.x+rect.width*(.2+.1*Math.sin(i/9)),rect.y+rect.height*(.6+.05*Math.cos(i/9)));
  await page.waitForTimeout(90);qualities.push((await canvas.getAttribute('data-quality'))!);
 }
 await page.evaluate(()=>{(window as any).__dkSlowFrameMs=0;});await page.mouse.up();
 await expect(canvas).toHaveAttribute('data-quality','low');await expect(page.getByRole('status').filter({hasText:'Visual quality reduced for performance'})).toBeVisible();
 expect(await inspector.innerText()).toBe(evidence);await expect(inspector).toHaveAttribute('data-selection-id','api');await expect(selectedLabel).toBeVisible();await expect(selectedLabel).toHaveClass(/is-selected/);
 await page.waitForTimeout(700);await expect(canvas).toHaveAttribute('data-quality','low');
 expect(qualities[0]).toBe('medium');expect(qualities.includes('low')).toBe(true);
 const changes=qualities.filter((value,index)=>index>0&&value!==qualities[index-1]);expect(changes).toEqual(['low']);
 writeRedesignEvidence('adaptive-quality-fault-injection.json',{conditions:'Headless Chromium SwiftShader; test-only 75 ms actual CPU work before requestAnimationFrame callbacks during a genuine continuous pointer drag. Real wall time, no synthetic backend state or fabricated frame timestamps. This verifies adaptation behavior, not physical-device performance.',before,qualities,after:await canvas.getAttribute('data-quality'),evidenceUnchanged:true,selectedAsset:'api',labelRemainsVisible:true,qualityDoesNotOscillateAfterLoadRemoved:true});
});
