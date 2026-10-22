import { useLayoutEffect, useRef } from "react";
import type { Graph, ScenePath } from "@dk/contracts";
import { MAX_EDGE_CHOICES } from "./edgePicking.ts";
export interface EdgeChoice { ids: string[]; x: number; y: number }
/** Nonmodal, keyboard-operable disambiguation. Selecting an edge never requests camera focus. */
export function EdgeChooser({ choice, paths, graph, width, height, onChoose, onClose }: { choice: EdgeChoice; paths: ScenePath[]; graph: Graph; width: number; height: number; onChoose: (id:string)=>void; onClose: ()=>void }) {
  const root=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{const before=document.activeElement as HTMLElement|null;root.current?.querySelector<HTMLButtonElement>("button[data-edge-choice]")?.focus();return()=>{if(before?.isConnected)before.focus();};},[]);
  const byId=new Map(paths.map(p=>[p.relationship_id,p])), names=new Map(graph.assets.map(a=>[a.id,a.name]));
  const shown=choice.ids.slice(0,MAX_EDGE_CHOICES).map(id=>byId.get(id)).filter((p):p is ScenePath=>!!p);
  return <div ref={root} role="dialog" aria-label="Choose relationship" data-edge-chooser onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();onClose();}}}
    style={{position:"absolute",zIndex:50,left:Math.max(12,Math.min(choice.x,width-344)),top:Math.max(12,Math.min(choice.y,height-360)),width:320,maxWidth:"calc(100% - 24px)",maxHeight:"calc(100% - 24px)",overflow:"auto",padding:14,background:"#121C29",border:"1px solid #70849B",borderRadius:10,color:"#EEF3FA",boxShadow:"0 8px 28px #0008",fontSize:13}}>
    <strong>{choice.ids.length} overlapping relationships</strong><p style={{margin:"6px 0 12px"}}>Choose one to inspect. The camera will stay in place.</p>
    {shown.map(p=><button key={p.relationship_id} data-edge-choice={p.relationship_id} className="btn sm" onClick={()=>onChoose(p.relationship_id)} style={{display:"block",width:"100%",textAlign:"left",whiteSpace:"normal",marginBottom:8}}>
      <span>{names.get(p.source_asset_id)??p.source_asset_id} → {names.get(p.target_asset_id)??p.target_asset_id}<small style={{display:"block"}}>{p.evidence_level} · {p.kind.replaceAll("_"," ")}</small><small style={{display:"block",overflowWrap:"anywhere",color:"#B5C3D3"}}>{p.relationship_id}</small></span>
    </button>)}
    {choice.ids.length>MAX_EDGE_CHOICES&&<p>Showing the nearest {MAX_EDGE_CHOICES}. Use the asset relationship list to inspect the remaining {choice.ids.length-MAX_EDGE_CHOICES}.</p>}
    <button className="btn sm" onClick={onClose}>Cancel</button>
  </div>;
}
