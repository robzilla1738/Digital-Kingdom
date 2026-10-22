/** Build a reproducible index from screenshot metadata emitted by the browser suite. */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const dir=join(root,'artifacts/redesign/final');
const sourceSha=process.argv[2]||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const meta=readdirSync(join(dir,'screenshots')).filter(f=>f.endsWith('.meta.json')).sort().map(f=>JSON.parse(readFileSync(join(dir,'screenshots',f),'utf8')));
const mismatchedBuilds=meta.filter(item=>item.build!==sourceSha).map(item=>({file:item.file,build:item.build}));
if(mismatchedBuilds.length)throw new Error(`Captures must come from the exact candidate build ${sourceSha}: ${JSON.stringify(mismatchedBuilds)}`);
for(const item of meta){const bytes=readFileSync(join(dir,'screenshots',item.file));if(createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error(`Screenshot hash mismatch: ${item.file}`);}
const requirements=Array.from({length:16},(_,i)=>`V${String(i+1).padStart(2,'0')}`);
const missing=requirements.filter(id=>!meta.some(item=>item.name.startsWith(id)));
if(missing.length)throw new Error(`Missing required final screenshots: ${missing.join(', ')}`);
const pngs=readdirSync(join(dir,'screenshots')).filter(f=>f.endsWith('.png'));
const unindexed=pngs.filter(f=>!meta.some(m=>m.file===f));if(unindexed.length)throw new Error(`Unindexed PNGs must be categorized as nonfinal: ${unindexed.join(', ')}`);
const report={sourceSha,generatedAt:new Date().toISOString(),requiredViews:requirements,totalScreenshots:meta.length,totalPngBytes:meta.reduce((n,m)=>n+statSync(join(dir,'screenshots',m.file)).size,0),screenshots:meta,limitations:['All design screenshots contain synthetic data. API-backed isolated fault-injection fixtures are not production/live-customer evidence.','Chromium headless uses SwiftShader. No real-GPU performance, cross-browser, physical-device or human approval is asserted.','The 200% capture uses CSS zoom emulation, not browser-chrome zoom.','Automated axe results require manual follow-up for incompletes and do not certify WCAG conformance.']};
writeFileSync(join(dir,'screenshot-index.json'),JSON.stringify(report,null,2)+'\n');
const title={V01:'Kingdom overview',V02:'Selected finding in Kingdom',V03:'Same selection in graph',V04:'Contradictory claim and both evidence kinds',V05:'Pinned event query and separate completeness',V06:'Unlinked exact event',V07:'Partial and unobserved coverage',V08:'3D coverage and selected asset',V09:'All ten architectural modules',V10:'Near-detail modules and actual roofs-off geometry',V11:'Late evidence and replay/record scope',V12:'Actual disconnected browser and stale retained records',V13:'Page-two evidence failure with prior page retained',V14:'Responsive and CSS-zoom layouts',V15:'Reduced motion and forced colors',V16:'50/200-asset scale presentations'};
let md=`# Final screenshot index\n\nSource candidate: \`${sourceSha}\`. ${meta.length} actual browser captures, DPR 1 unless metadata states otherwise. Each PNG has a neighboring metadata file with capture time, viewport, browser, fixture, SHA-256 and evidence classification.\n\n## Evidence boundaries\n\n${report.limitations.map(x=>'- '+x).join('\n')}\n\nBefore images and the isolated original live pilot are indexed separately in [baseline/README.md](../baseline/README.md). Failed/intermediate captures remain local in the ignored nonfinal directory.\n\n`;
for(const id of requirements){md+=`## ${id}: ${title[id]}\n\n`;for(const item of meta.filter(m=>m.name.startsWith(id))){const fixture=item.query.fixture|| (item.query.moduleSheet?`moduleSheet=${item.query.moduleSheet}`:'canonical server-seeded synthetic data plus local fault injection');md+=`- [${item.file}](screenshots/${item.file}) · ${item.viewport.width} × ${item.viewport.height} · ${fixture} · ${item.evidenceClass}${item.zoomNote?'; '+item.zoomNote:''}.\n`;}md+='\n';}
md+='## Additional safety/fallback captures\n\n';for(const item of meta.filter(m=>!/^V\d{2}/.test(m.name)))md+=`- [${item.file}](screenshots/${item.file}) · ${item.viewport.width} × ${item.viewport.height} · ${item.query.fixture||'synthetic fixture'} · ${item.evidenceClass}.\n`;
writeFileSync(join(dir,'SCREENSHOT_INDEX.md'),md);
console.log(JSON.stringify({sourceSha,screenshots:meta.length,pngBytes:report.totalPngBytes,requiredViews:16}));
