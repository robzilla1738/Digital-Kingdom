export type ScreenPoint = { x: number; y: number };
export type EdgePick = { id: string; points: ScreenPoint[] };
export const EDGE_HIT_RADIUS = 6;
export const MAX_EDGE_CHOICES = 20;
export function pointSegmentDistance(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx=b.x-a.x,dy=b.y-a.y,denom=dx*dx+dy*dy;
  const t=denom?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/denom)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
/** Pure view hit testing. Caller supplies only visible, policy-filtered real relationships. */
export function overlappingEdges(edges: EdgePick[], point: ScreenPoint, radius=EDGE_HIT_RADIUS): string[] {
  const matches=new Map<string,number>();
  for(const edge of edges){let d=Infinity;for(let i=1;i<edge.points.length;i++)d=Math.min(d,pointSegmentDistance(point,edge.points[i-1]!,edge.points[i]!));
    if(d<=radius)matches.set(edge.id,Math.min(d,matches.get(edge.id)??Infinity));}
  return [...matches].sort((a,b)=>a[1]-b[1]||a[0].localeCompare(b[0])).map(([id])=>id);
}
export function pointerWasDrag(start: ScreenPoint | null, end: ScreenPoint): boolean { return !!start && Math.hypot(end.x-start.x,end.y-start.y)>6; }
