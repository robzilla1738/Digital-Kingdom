import { describe, expect, it } from "vitest";
import { MAX_EDGE_CHOICES, overlappingEdges, pointSegmentDistance, pointerWasDrag } from "./edgePicking.ts";
const horizontal={id:"real:a",points:[{x:0,y:0},{x:100,y:0}]},vertical={id:"real:b",points:[{x:50,y:-50},{x:50,y:50}]};
describe("overlapping relationship hit testing",()=>{
 it("offers both real IDs at a crossing instead of choosing arbitrarily",()=>expect(overlappingEdges([horizontal,vertical],{x:50,y:0})).toEqual(["real:a","real:b"]));
 it("uses bounded six-pixel hits, not a broad nearest-edge snap",()=>{expect(overlappingEdges([horizontal],{x:50,y:6})).toEqual(["real:a"]);expect(overlappingEdges([horizontal],{x:50,y:6.01})).toEqual([]);});
 it("does not invent candidates absent from the visible policy-filtered paths",()=>expect(overlappingEdges([horizontal],{x:50,y:0})).toEqual(["real:a"]));
 it("deduplicates actual IDs and sorts deterministic ties independently of draw order",()=>expect(overlappingEdges([vertical,horizontal,horizontal],{x:50,y:0})).toEqual(["real:a","real:b"]));
 it("clamps distance to finite endpoints and tolerates zero-length segments",()=>{expect(pointSegmentDistance({x:110,y:0},{x:0,y:0},{x:100,y:0})).toBe(10);expect(pointSegmentDistance({x:3,y:4},{x:0,y:0},{x:0,y:0})).toBe(5);});
 it("rejects drags while retaining small pointer motion as a click",()=>{expect(pointerWasDrag({x:0,y:0},{x:7,y:0})).toBe(true);expect(pointerWasDrag({x:0,y:0},{x:3,y:4})).toBe(false);expect(pointerWasDrag(null,{x:30,y:40})).toBe(false);});
 it("bounds chooser DOM candidates without changing canonical memberships",()=>expect(MAX_EDGE_CHOICES).toBe(20));
});
