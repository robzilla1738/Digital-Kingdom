import { describe, expect, it } from "vitest";
import { compileScene, defaultProposal } from "../src/index.ts";
import { demoGraph } from "../../../fixtures/testing/load.ts";
import { MODULE_CATALOG } from "@dk/contracts";

const clone = <T>(x:T):T => structuredClone(x);
function nonoverlap(rooms:ReturnType<typeof compileScene>["rooms"]) {
  for (let i=0;i<rooms.length;i++) for(let j=i+1;j<rooms.length;j++) {
    const a=rooms[i]!,b=rooms[j]!;
    expect(Math.abs(a.position.x-b.position.x)<(a.footprint.w+b.footprint.w)/2 && Math.abs(a.position.z-b.position.z)<(a.footprint.d+b.footprint.d)/2,`${a.asset_id} intersects ${b.asset_id}`).toBe(false);
  }
}
describe("redesigned courtyard layout",()=>{
 it("uses rotated world footprints and truthful actual heights",()=>{
  const g=demoGraph(),s=compileScene(g,defaultProposal(g));
  for(const r of s.rooms){const c=MODULE_CATALOG[r.module_id];expect(r.height).toBe(c.height);expect(r.footprint).toEqual(Math.abs(r.rotation_y)%180===90?{w:c.footprint.d,d:c.footprint.w}:c.footprint);}
  nonoverlap(s.rooms);
 });
 it("preserves approved coordinates even when capacity grows",()=>{
  const g=demoGraph(),before=compileScene(g,defaultProposal(g)),next=clone(g);
  for(let i=0;i<20;i++)next.assets.push({id:`extra-${i}`,name:`Extra ${i}`,kind:"service",environment:"demo",allowed_zone_ids:["application"],source_refs:["fixture"]});
  next.graph_revision="redesign-more";const after=compileScene(next,defaultProposal(next),{previous:before});
  for(const r of before.rooms)expect(after.rooms.find(x=>x.asset_id===r.asset_id)?.position).toEqual(r.position);
  nonoverlap(after.rooms);
 });
 it("keeps different actual environments physically distinct without inventing graph nodes",()=>{
  const g=demoGraph();g.assets[0]!.environment="staging";
  const scene=compileScene(g,defaultProposal(g)),edge=scene.rooms.find(r=>r.asset_id===g.assets[0]!.id)!;
  expect(scene.rooms).toHaveLength(g.assets.length);
  expect(Math.min(...scene.rooms.filter(r=>r!==edge).map(r=>Math.abs(r.position.x-edge.position.x)))).toBeGreaterThan(50);
  expect(scene.zones.every(z=>!z.enclosed)).toBe(true);
 });
 it("keeps prior environment origins when a lexically earlier environment is introduced",()=>{
  const graph=demoGraph(),before=compileScene(graph,defaultProposal(graph)),next=clone(graph);
  next.assets.push({id:"new-env",name:"New environment",kind:"service",environment:"aaa",allowed_zone_ids:["application"],source_refs:["fixture"]});
  const after=compileScene(next,defaultProposal(next),{previous:before});
  for(const room of before.rooms)expect(after.rooms.find(r=>r.asset_id===room.asset_id)!.position).toEqual(room.position);
  const added=after.rooms.find(r=>r.asset_id==="new-env")!;
  expect(added.position.x-added.footprint.w/2).toBeGreaterThan(Math.max(...before.rooms.map(r=>r.position.x+r.footprint.w/2))+50);
  nonoverlap(after.rooms);
 });
 it("adds subsequent rooms to the original environment rather than its new sorted index",()=>{
  const graph=demoGraph(),before=compileScene(graph,defaultProposal(graph));
  graph.assets.push({id:"new-env",name:"New environment",kind:"service",environment:"aaa",allowed_zone_ids:["application"],source_refs:["fixture"]});
  const introduced=compileScene(graph,defaultProposal(graph),{previous:before});
  graph.assets.push({id:"old-env-extra",name:"Original environment addition",kind:"service",environment:"demo",allowed_zone_ids:["application"],source_refs:["fixture"]});
  const after=compileScene(graph,defaultProposal(graph),{previous:introduced}),added=after.rooms.find(r=>r.asset_id==="old-env-extra")!,other=after.rooms.find(r=>r.asset_id==="new-env")!;
  for(const room of introduced.rooms)expect(after.rooms.find(r=>r.asset_id===room.asset_id)!.position).toEqual(room.position);
  expect(Math.abs(added.position.x)).toBeLessThan(40);expect(other.position.x-added.position.x).toBeGreaterThan(50);nonoverlap(after.rooms);
  const reordered=clone(graph);reordered.assets.reverse();expect(compileScene(reordered,defaultProposal(reordered),{previous:introduced}).rooms).toEqual(after.rooms);
 });
 it("keeps capacity growth inside its environment band while preserving both environments' pins",()=>{
  const graph=demoGraph(),before=compileScene(graph,defaultProposal(graph));
  graph.assets.push({id:"new-env",name:"New environment",kind:"service",environment:"aaa",allowed_zone_ids:["application"],source_refs:["fixture"]});
  const introduced=compileScene(graph,defaultProposal(graph),{previous:before});
  for(let i=0;i<180;i++)graph.assets.push({id:`growth-${i}`,name:`Growth ${i}`,kind:"service",environment:"demo",allowed_zone_ids:["application"],source_refs:["fixture"]});
  const after=compileScene(graph,defaultProposal(graph),{previous:introduced}),other=after.rooms.find(r=>r.asset_id==="new-env")!;
  for(const room of introduced.rooms)expect(after.rooms.find(r=>r.asset_id===room.asset_id)!.position).toEqual(room.position);
  expect(Math.max(...after.rooms.filter(r=>r!==other).map(r=>r.position.x+r.footprint.w/2))).toBeLessThan(other.position.x-other.footprint.w/2-18);nonoverlap(after.rooms);
 });
 it("remains deterministic after input order and display-name changes",()=>{
  const g=demoGraph(),a=compileScene(g,defaultProposal(g)),renamed=clone(g);
  renamed.assets.reverse();renamed.assets.forEach(a=>a.name="Renamed "+a.id);
  const b=compileScene(renamed,defaultProposal(renamed));
  expect(b.rooms).toEqual(a.rooms);
 });
 it("compiles 200 real logical asset memberships without collisions",()=>{
  const g=demoGraph();for(let i=0;i<187;i++)g.assets.push({id:`large-${i}`,name:`Synthetic ${i}`,kind:"service",environment:"demo",allowed_zone_ids:["application"],source_refs:["fixture"]});
  const s=compileScene(g,defaultProposal(g));expect(s.rooms).toHaveLength(200);nonoverlap(s.rooms);
 });
});
