import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import type { AssetKind } from "@dk/contracts";
import { useApp } from "../lib/state.tsx";
import { KIND_LABEL, LAYER_STYLE, OUTCOME_STYLE, RELATIONSHIP_LAYER } from "../lib/vocab.ts";
import { Icon } from "../lib/icons.tsx";

const MONO: Record<AssetKind, string> = {
  edge: "GW", auth: "ID", service: "SV", worker: "WK", database: "DB", storage: "ST", agent: "AI", tool_server: "MCP", pipeline: "CI", third_party: "3P",
};

const NODE_W = 184, NODE_H = 54, COL = NODE_W + 14, ROW = NODE_H + 14;
const ZPAD = 12, ZHEAD = 30, GAP = 34, OUTER = 20;
const MAX_SCALE = 1.3, MIN_SCALE = 0.25;

type Rect = { x: number; y: number; w: number; h: number };
type Side = "top" | "bottom" | "left" | "right";

/** Shape paths for outcome marks inside SVG (same shapes as StateIcon / 3D markers). */
function OutcomeMark({ state, x, y, r = 7 }: { state: keyof typeof OUTCOME_STYLE; x: number; y: number; r?: number }) {
  const s = OUTCOME_STYLE[state]; const c = s.color;
  const k = r / 7;
  const t = `translate(${x},${y}) scale(${k})`;
  switch (s.shape) {
    case "shield": return <path transform={t} d="M0-6.5l5.5 2.1v4.1c0 3.3-2.3 5.6-5.5 6.8C-3.2 5.3-5.5 3-5.5-.3v-4.1z" fill={c} />;
    case "diamond": return <path transform={t} d="M0-7L7 0 0 7-7 0z" fill={c} />;
    case "circle": return <circle cx={x} cy={y} r={r * 0.8} fill={c} />;
    case "square": return <rect transform={t} x={-5.5} y={-5.5} width={11} height={11} rx={1.5} fill="none" stroke={c} strokeWidth={2} />;
    case "triangle": return <path transform={t} d="M0-6.5L7 5.8H-7z" fill={c} />;
    case "ring": return <g transform={t}><circle r={5.5} fill="none" stroke={c} strokeWidth={2.2} /><circle r={1.9} fill={c} /></g>;
    case "hatch": return <g transform={t}><rect x={-5.5} y={-5.5} width={11} height={11} rx={1.5} fill="none" stroke={c} strokeWidth={1.6} /><path d="M-3 3l6-6M-5.2.2L.2-5.2M-.2 5.2L5.2-.2" stroke={c} strokeWidth={1.4} /></g>;
  }
}

/**
 * The conventional 2D view over the SAME evidence and selection as the castle. Zones keep the castle's
 * layering (data behind, application core, gate in front) with the side wings stacked beside it, in aligned grids so
 * every card stays readable at the default fit. Fully keyboard operable.
 */
export function Graph2D() {
  const { ui, dispatch, vm } = useApp();
  const { scene, graph } = vm.data;

  const layout = useMemo(() => {
    const inZone = (z: string) => scene.rooms.filter((r) => r.zone_id === z).sort((x, y) => x.slot - y.slot);
    const appN = inZone("application").length;
    const centerCols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(Math.max(1, appN) / 2))));
    const colsFor = (z: string, n: number) => (z === "application" || z === "data" || z === "public" ? Math.max(1, Math.min(n, Math.max(centerCols, z === "application" ? 1 : Math.min(n, 4)))) : n > 4 ? 2 : 1);
    const dims = (z: string) => {
      const n = inZone(z).length; const c = colsFor(z, n); const r = Math.ceil(n / c);
      return { n, c, r, w: c * COL - (COL - NODE_W) + ZPAD * 2, h: r * ROW - (ROW - NODE_H) + ZPAD + ZHEAD };
    };
    const has = (z: string) => inZone(z).length > 0;
    const center = (["data", "application", "public"] as const).filter(has);
    // Side zones stack in one column beside the core so the map stays close to square and readable.
    const left: string[] = [];
    const right = (["automation", "delivery", "external"] as const).filter(has);
    const stackH = (zs: readonly string[]) => zs.reduce((s, z) => s + dims(z).h, 0) + GAP * Math.max(0, zs.length - 1);
    const stackW = (zs: readonly string[]) => Math.max(0, ...zs.map((z) => dims(z).w));
    const cW = stackW(center), lW = stackW(left), rW = stackW(right);
    const totalH = Math.max(stackH(center), stackH(left), stackH(right));
    const origin: Record<string, { x: number; y: number; w: number; h: number }> = {};
    const place = (zs: readonly string[], x: number, colW: number, align: "center" | "start") => {
      let y = OUTER + (align === "center" ? (totalH - stackH(zs)) / 2 : 0);
      for (const z of zs) { const d = dims(z); origin[z] = { x: x + (colW - d.w) / 2, y, w: d.w, h: d.h }; y += d.h + GAP; }
    };
    let x = OUTER;
    if (left.length) { place(left, x, lW, "center"); x += lW + GAP; }
    // the application zone sits at the vertical middle; data above, public edge below
    place(center, x, cW, "start"); x += cW;
    if (right.length) { x += GAP; place(right, x, rW, "center"); x += rW; }
    const W = x + OUTER, H = totalH + OUTER * 2;
    const pos = new Map<string, Rect>();
    for (const z of Object.keys(origin)) {
      const d = dims(z); const o = origin[z]!;
      const innerW = d.c * COL - (COL - NODE_W);
      const ox = o.x + (o.w - innerW) / 2;
      inZone(z).forEach((r, i) => {
        const row = Math.floor(i / d.c), inRow = Math.min(d.c, d.n - row * d.c);
        const rowOff = ((d.c - inRow) * COL) / 2; // centre a short last row
        pos.set(r.asset_id, { x: ox + rowOff + (i % d.c) * COL, y: o.y + ZHEAD + row * ROW, w: NODE_W, h: NODE_H });
      });
    }
    const zones = scene.zones.filter((z) => origin[z.zone_id]).map((z) => ({ ...z, box: origin[z.zone_id]!, n: inZone(z.zone_id).length }));
    return { pos, zones, W, H };
  }, [scene]);

  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [vb, setVb] = useState({ x: 0, y: 0, w: layout.W, h: layout.H });
  const moved = useRef(false);
  const drag = useRef<{ x: number; y: number; vb: typeof vb; id: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const fit = useCallback((w = size.w, h = size.h) => {
    const s = Math.min(w / layout.W, h / layout.H, MAX_SCALE);
    const vw = w / s, vh = h / s;
    setVb({ x: (layout.W - vw) / 2, y: (layout.H - vh) / 2, w: vw, h: vh });
    moved.current = false;
  }, [layout.W, layout.H, size.w, size.h]);

  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (!e) return; const w = Math.max(1, e.contentRect.width), h = Math.max(1, e.contentRect.height); setSize({ w, h }); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  // keep the fit on resize until the user pans or zooms; keep the zoom level after that
  useLayoutEffect(() => {
    if (!moved.current) fit(size.w, size.h);
    else setVb((v) => { const s = size.w / v.w; const cx = v.x + v.w / 2, cy = v.y + v.h / 2; const w = size.w / s, h = size.h / s; return { x: cx - w / 2, y: cy - h / 2, w, h }; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, layout.W, layout.H]);

  const zoomBy = useCallback((k: number, px?: number, py?: number) => {
    setVb((v) => {
      const s = size.w / v.w; const ns = Math.min(MAX_SCALE * 2.5, Math.max(MIN_SCALE, s / k)); const kk = s / ns;
      const cx = px ?? v.x + v.w / 2, cy = py ?? v.y + v.h / 2;
      return { x: cx - (cx - v.x) * kk, y: cy - (cy - v.y) * kk, w: v.w * kk, h: v.h * kk };
    });
    moved.current = true;
  }, [size.w]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "+" || e.key === "=") zoomBy(1 / 1.2);
      if (e.key === "-") zoomBy(1.2);
      if (e.key === "0") fit();
    };
    addEventListener("keydown", onKey); return () => removeEventListener("keydown", onKey);
  }, [zoomBy, fit]);

  const toUser = (cx: number, cy: number) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: vb.x + ((cx - r.left) / r.width) * vb.w, y: vb.y + ((cy - r.top) / r.height) * vb.h };
  };
  const onWheel = (e: WheelEvent) => { const p = toUser(e.clientX, e.clientY); zoomBy(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), p.x, p.y); };
  const onDown = (e: PointerEvent) => {
    if ((e.target as Element).closest("[data-node],[data-edge]")) return;
    drag.current = { x: e.clientX, y: e.clientY, vb, id: e.pointerId };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current; if (!d) return;
    if (!panning && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;
    if (!panning) { setPanning(true); svg.current?.setPointerCapture?.(d.id); }
    const r = svg.current!.getBoundingClientRect();
    const dx = ((e.clientX - d.x) / r.width) * d.vb.w, dy = ((e.clientY - d.y) / r.height) * d.vb.h;
    setVb({ ...d.vb, x: d.vb.x - dx, y: d.vb.y - dy }); moved.current = true;
  };
  const onUp = (e: PointerEvent) => {
    const wasPan = panning; drag.current = null; setPanning(false);
    if (!wasPan && !(e.target as Element).closest("[data-node],[data-edge]")) dispatch({ type: "select", selection: null });
  };

  const sel = ui.selection;
  const q = ui.query.trim().toLowerCase();
  const focusIds = useMemo(() => {
    if (sel?.kind === "asset") return new Set([sel.id]);
    if (sel?.kind === "finding") return new Set(vm.findings.find((f) => f.id === sel.id)?.affected_asset_ids ?? []);
    if (sel?.kind === "event") return new Set(vm.data.events.find((e) => e.id === sel.id)?.asset_ids ?? []);
    return new Set<string>();
  }, [sel, vm.findings, vm.data.events]);

  // visible edges + port assignment (edges spread along each card side so arrowheads never stack)
  const edges = useMemo(() => {
    const vis = scene.paths.filter((p) => {
      if (!layout.pos.has(p.source_asset_id) || !layout.pos.has(p.target_asset_id)) return false;
      const layer = RELATIONSHIP_LAYER[p.kind] ?? "runtime";
      const touches = focusIds.has(p.source_asset_id) || focusIds.has(p.target_asset_id);
      const isSel = sel?.kind === "path" && sel.id === p.relationship_id;
      return touches || isSel || (ui.layers[layer] && !(p.evidence_level === "hypothetical" && !ui.showHypothetical));
    });
    const sideOf = (a: Rect, b: Rect): [Side, Side] => {
      const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
      const dx = bx - ax, dy = by - ay;
      if (Math.abs(dy) > a.h && Math.abs(dy) * 2.2 > Math.abs(dx)) return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
      return dx > 0 ? ["right", "left"] : ["left", "right"];
    };
    type End = { edge: number; end: 0 | 1; other: Rect };
    const slots = new Map<string, End[]>();
    const sides = vis.map((p, i) => {
      const a = layout.pos.get(p.source_asset_id)!, b = layout.pos.get(p.target_asset_id)!;
      const [sa, sb] = sideOf(a, b);
      (slots.get(`${p.source_asset_id}|${sa}`) ?? slots.set(`${p.source_asset_id}|${sa}`, []).get(`${p.source_asset_id}|${sa}`)!).push({ edge: i, end: 0, other: b });
      (slots.get(`${p.target_asset_id}|${sb}`) ?? slots.set(`${p.target_asset_id}|${sb}`, []).get(`${p.target_asset_id}|${sb}`)!).push({ edge: i, end: 1, other: a });
      return [sa, sb] as [Side, Side];
    });
    const ports = vis.map(() => [{ x: 0, y: 0 }, { x: 0, y: 0 }]);
    for (const [key, list] of slots) {
      const [id, side] = key.split("|") as [string, Side];
      const r = layout.pos.get(id)!;
      const horiz = side === "top" || side === "bottom";
      list.sort((m, n) => (horiz ? m.other.x - n.other.x : m.other.y - n.other.y));
      list.forEach((s, i) => {
        const f = (i + 1) / (list.length + 1);
        const span = horiz ? r.w * 0.7 : r.h * 0.6;
        const off = (f - 0.5) * span;
        const p = side === "top" ? { x: r.x + r.w / 2 + off, y: r.y } : side === "bottom" ? { x: r.x + r.w / 2 + off, y: r.y + r.h } : side === "left" ? { x: r.x, y: r.y + r.h / 2 + off } : { x: r.x + r.w, y: r.y + r.h / 2 + off };
        ports[s.edge]![s.end] = p;
      });
    }
    const normal = (s: Side) => (s === "top" ? [0, -1] : s === "bottom" ? [0, 1] : s === "left" ? [-1, 0] : [1, 0]) as [number, number];
    return vis.map((p, i) => {
      const [sa, sb] = sides[i]!; const [p0, p3] = ports[i]! as [{ x: number; y: number }, { x: number; y: number }];
      const n0 = normal(sa), n3 = normal(sb);
      const gap = 4; const end = { x: p3.x + n3[0] * gap, y: p3.y + n3[1] * gap };
      const d = Math.hypot(end.x - p0.x, end.y - p0.y); const k = Math.max(22, Math.min(90, d * 0.42));
      const path = `M${p0.x},${p0.y} C${p0.x + n0[0] * k},${p0.y + n0[1] * k} ${end.x + n3[0] * k},${end.y + n3[1] * k} ${end.x},${end.y}`;
      return { p, path };
    });
  }, [scene.paths, layout.pos, focusIds, sel, ui.layers, ui.showHypothetical]);

  const select = (id: string, name: string) => dispatch({ type: "select", selection: { kind: "asset", id }, announce: `Selected ${name}` });
  const key = (e: KeyboardEvent, id: string, name: string) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); select(id, name); } };
  const hasFocus = focusIds.size > 0 || sel?.kind === "path";
  const scale = size.w / vb.w;

  return (
    <div className="graph-wrap" ref={wrap}>
      <svg ref={svg} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className={`graph2d${panning ? " panning" : ""}`} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        role="group" aria-label="2D asset graph. Tab through assets; press Enter to select." shapeRendering="geometricPrecision">
        <defs>
          <pattern id="dk-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" className="grid-dot" /></pattern>
          <pattern id="dk-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#e2b84f" strokeWidth="1.6" strokeOpacity=".55" /></pattern>
          {Object.entries(LAYER_STYLE).map(([k, v]) => (
            <marker key={k} id={`dk-arrow-${k}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M1,1.2 L9,5 L1,8.8 L2.6,5 z" fill={v.color} />
            </marker>
          ))}
        </defs>
        <rect x={vb.x - 24} y={vb.y - 24} width={vb.w + 48} height={vb.h + 48} fill="url(#dk-grid)" opacity={scale > 0.45 ? 1 : 0} />
        {layout.zones.map((z) => (
          <rect key={z.zone_id} x={z.box.x} y={z.box.y} width={z.box.w} height={z.box.h} rx={10} className={`zone-rect${z.enclosed ? " enclosed" : ""}`} aria-hidden />
        ))}
        <g>
          {edges.map(({ p, path }) => {
            const layer = RELATIONSHIP_LAYER[p.kind] ?? "runtime";
            const touches = focusIds.has(p.source_asset_id) || focusIds.has(p.target_asset_id);
            const isSel = sel?.kind === "path" && sel.id === p.relationship_id;
            const emph = touches || isSel;
            const dashed = p.evidence_level === "hypothetical" || p.evidence_level === "inferred";
            const onClick = () => dispatch({ type: "select", selection: { kind: "path", id: p.relationship_id } });
            return (
              <g key={p.relationship_id} data-edge onClick={onClick}>
                <path d={path} className="edge" stroke={LAYER_STYLE[layer].color} strokeWidth={isSel ? 2.4 : emph ? 1.8 : 1.25}
                  strokeOpacity={emph ? 0.95 : hasFocus ? 0.14 : 0.5} strokeDasharray={dashed ? "5 4" : undefined} markerEnd={`url(#dk-arrow-${layer})`} />
                <path d={path} className="edge-hit"><title>{`${p.kind.replace(/_/g, " ")} (${p.evidence_level})`}</title></path>
              </g>
            );
          })}
        </g>
        {/* zone captions sit above edges with a knockout stroke so lines pass cleanly underneath */}
        {layout.zones.map((z) => (
          <g key={z.zone_id} aria-hidden className="zone-caption">
            <text x={z.box.x + ZPAD + 2} y={z.box.y + 19} className="zone-text">{z.label.toUpperCase()}</text>
            <text x={z.box.x + z.box.w - ZPAD - 2} y={z.box.y + 19} textAnchor="end" className="zone-count">{z.n}</text>
          </g>
        ))}
        {scene.rooms.map((r) => {
          const a = graph.assets.find((x) => x.id === r.asset_id); const rect = layout.pos.get(r.asset_id);
          if (!a || !rect) return null;
          const st = vm.assetStatus.get(r.asset_id);
          const isSel = focusIds.has(r.asset_id);
          const dim = (q.length > 1 && !(a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)));
          const style = st?.worst ? OUTCOME_STYLE[st.worst] : null;
          const gap = !!st && st.coverage !== "reporting";
          const nameFit = a.name.length > 19 ? a.name.slice(0, 18) + "…" : a.name;
          const sub = st?.coverage === "gap" ? "Coverage gap" : st?.coverage === "unobserved" ? "No telemetry" : KIND_LABEL[a.kind];
          const nF = st?.findingIds.length ?? 0;
          return (
            <g key={r.asset_id} data-node data-asset-id={r.asset_id} transform={`translate(${rect.x},${rect.y})`} tabIndex={0} role="button" opacity={dim ? 0.28 : 1}
              aria-label={`${a.name}, ${KIND_LABEL[a.kind]}${style ? `, ${style.label}` : ""}${nF ? `, ${nF} open findings` : ""}${gap ? ", coverage gap" : ""}`}
              aria-pressed={isSel} className={`node${isSel ? " selected" : ""}${gap ? " gap" : ""}`}
              onClick={() => select(a.id, a.name)} onKeyDown={(e) => key(e, a.id, a.name)}
              onMouseEnter={() => dispatch({ type: "hover", id: a.id })} onMouseLeave={() => dispatch({ type: "hover", id: null })}
              onFocus={() => dispatch({ type: "hover", id: a.id })} onBlur={() => dispatch({ type: "hover", id: null })}>
              <title>{a.name}</title>
              <rect x={-3} y={-3} width={rect.w + 6} height={rect.h + 6} rx={11} className="node-ring" />
              <rect width={rect.w} height={rect.h} rx={8} className="node-bg" />
              {gap && <path d={`M8,0.5 A7.5,7.5 0 0 0 0.5,8 V${rect.h - 8} A7.5,7.5 0 0 0 8,${rect.h - 0.5} Z`} fill="url(#dk-hatch)" />}
              {style && <rect x={rect.w - 3} y={12} width={3} height={rect.h - 24} rx={1.5} fill={style.color} opacity={0.9} />}
              <rect x={12} y={(rect.h - 28) / 2} width={28} height={28} rx={6} className="node-tile" />
              {style ? <OutcomeMark state={st!.worst!} x={26} y={rect.h / 2} r={7} /> : <text x={26} y={rect.h / 2 + 3.5} textAnchor="middle" className="node-mono" aria-hidden>{MONO[a.kind]}</text>}
              <text x={50} y={rect.h / 2 - 3} className="node-name">{nameFit}</text>
              <text x={50} y={rect.h / 2 + 13} className={`node-kind${gap ? " warn" : ""}`}>{sub}</text>
              {nF > 1 && <text x={rect.w - 12} y={rect.h / 2 + 13} textAnchor="end" className="node-count">{nF}</text>}
            </g>
          );
        })}
      </svg>
      <div className="stage-tools" role="toolbar" aria-label="Graph view">
        <button className="icon-btn sm" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom in" title="Zoom in  (+)"><Icon name="plus" size={15} /></button>
        <button className="icon-btn sm" onClick={() => zoomBy(1.25)} aria-label="Zoom out" title="Zoom out  (−)"><Icon name="minus" size={15} /></button>
        <div className="vr-h" />
        <button className="icon-btn sm" onClick={() => fit()} aria-label="Fit to view" title="Fit to view  (0)"><Icon name="fit" size={15} /></button>
      </div>
    </div>
  );
}

