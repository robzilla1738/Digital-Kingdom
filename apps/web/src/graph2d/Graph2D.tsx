import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import type { AssetKind } from "@dk/contracts";
import { useApp } from "../lib/state.tsx";
import { KIND_LABEL, LAYER_STYLE, OUTCOME_STYLE, RELATIONSHIP_LAYER } from "../lib/vocab.ts";

const GLYPH: Record<AssetKind, string> = {
  edge: "GW", auth: "ID", service: "SV", worker: "WK", database: "DB", storage: "ST", agent: "AI", tool_server: "MCP", pipeline: "CI", third_party: "3P",
};

/**
 * The conventional 2D view over the SAME evidence and selection as the castle. Positions reuse the
 * compiled scene's ground plane so both views share one mental map. Fully keyboard operable.
 */
export function Graph2D() {
  const { ui, dispatch, vm } = useApp();
  const { scene, graph } = vm.data;
  // Same arrangement as the castle (data behind, gate in front, wings left/right), packed into tidy
  // per-zone grids so every label stays readable at normal zoom.
  const layout = useMemo(() => {
    const COL = 196, ROW = 96, GAP = 46, pad = 30;
    const inZone = (z: string) => scene.rooms.filter((r) => r.zone_id === z).sort((x, y) => x.slot - y.slot);
    const colsFor = (z: string, n: number) => (z === "application" ? Math.min(3, n) : z === "data" || z === "public" ? Math.min(4, n) : 1);
    const dims = (z: string) => { const n = inZone(z).length; const c = Math.max(1, colsFor(z, n)); return { n, c, r: Math.ceil(n / c), w: c * COL, h: Math.ceil(n / c) * ROW }; };
    const middle = (["delivery", "application", "automation", "external"] as const).filter((z) => inZone(z).length);
    const midW = middle.reduce((s2, z) => s2 + dims(z).w, 0) + GAP * Math.max(0, middle.length - 1);
    const midH = Math.max(0, ...middle.map((z) => dims(z).h));
    const top = dims("data"), bottom = dims("public");
    const W = Math.max(midW, top.w, bottom.w) + pad * 2;
    const origin: Record<string, { x: number; y: number }> = {};
    const topH = top.n ? top.h + GAP : 0;
    if (top.n) origin.data = { x: (W - top.w) / 2, y: pad + 22 };
    let x = (W - midW) / 2;
    for (const z of middle) { origin[z] = { x, y: pad + 22 + topH + (midH - dims(z).h) / 2 }; x += dims(z).w + GAP; }
    if (bottom.n) origin.public = { x: (W - bottom.w) / 2, y: pad + 22 + topH + midH + GAP };
    const pos = new Map<string, { x: number; y: number }>();
    for (const z of Object.keys(origin)) {
      const d = dims(z);
      inZone(z).forEach((r, i) => pos.set(r.asset_id, { x: origin[z]!.x + (i % d.c) * COL + COL / 2, y: origin[z]!.y + Math.floor(i / d.c) * ROW + ROW / 2 }));
    }
    const zones = scene.zones.filter((z) => origin[z.zone_id]).map((z) => { const d = dims(z.zone_id); return { ...z, box: { x: origin[z.zone_id]!.x - 6, y: origin[z.zone_id]!.y - 22, w: d.w + 12, h: d.h + 28 } }; });
    return { pos, zones, W, H: pad * 2 + 22 + topH + midH + (bottom.n ? GAP + bottom.h : 0) + 10 };
  }, [scene]);
  const W = layout.W, H = layout.H;
  const X = (id: string) => layout.pos.get(id)!.x;
  const Y = (id: string) => layout.pos.get(id)!.y;
  const [vb, setVb] = useState({ x: 0, y: 0, w: W, h: H });
  const drag = useRef<{ x: number; y: number; vb: typeof vb } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const rooms = useMemo(() => new Map(scene.rooms.map((r) => [r.asset_id, r])), [scene]);
  const sel = ui.selection;
  const q = ui.query.trim().toLowerCase();

  const onWheel = (e: WheelEvent) => {
    const k = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    const rect = svg.current!.getBoundingClientRect();
    const px = vb.x + ((e.clientX - rect.left) / rect.width) * vb.w, py = vb.y + ((e.clientY - rect.top) / rect.height) * vb.h;
    setVb({ x: px - (px - vb.x) * k, y: py - (py - vb.y) * k, w: vb.w * k, h: vb.h * k });
  };
  const onDown = (e: PointerEvent) => { if ((e.target as Element).closest("[data-node]")) return; drag.current = { x: e.clientX, y: e.clientY, vb }; (e.target as Element).setPointerCapture?.(e.pointerId); };
  const onMove = (e: PointerEvent) => {
    if (!drag.current) return;
    const rect = svg.current!.getBoundingClientRect();
    const dx = ((e.clientX - drag.current.x) / rect.width) * drag.current.vb.w, dy = ((e.clientY - drag.current.y) / rect.height) * drag.current.vb.h;
    setVb({ ...drag.current.vb, x: drag.current.vb.x - dx, y: drag.current.vb.y - dy });
  };
  const select = (id: string, name: string) => dispatch({ type: "select", selection: { kind: "asset", id }, announce: `Selected ${name}` });
  const key = (e: KeyboardEvent, id: string, name: string) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(id, name); } };

  return (
    <div className="graph-wrap">
      <svg ref={svg} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="graph2d" onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)}
        role="group" aria-label="2D asset graph. Tab through assets; press Enter to select." onClick={(e) => { if (e.target === svg.current) dispatch({ type: "select", selection: null }); }}>
        <defs>
          <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="none" /><line x1="0" y1="0" x2="0" y2="8" stroke="#d6dbe3" strokeWidth="3" /></pattern>
          {Object.entries(LAYER_STYLE).map(([k, v]) => (
            <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={v.color} /></marker>
          ))}
        </defs>
        {layout.zones.map((z) => (
          <g key={z.zone_id}>
            <rect x={z.box.x} y={z.box.y} width={z.box.w} height={z.box.h} rx={12} className={`zone-rect${z.enclosed ? " enclosed" : ""}`} />
            <text x={z.box.x + 10} y={z.box.y + 16} className="zone-text">{z.label.toUpperCase()}</text>
          </g>
        ))}
        {scene.paths.map((p) => {
          const a = rooms.get(p.source_asset_id), t = rooms.get(p.target_asset_id);
          if (!a || !t) return null;
          const layer = RELATIONSHIP_LAYER[p.kind] ?? "runtime";
          const touches = sel?.kind === "asset" && (sel.id === a.asset_id || sel.id === t.asset_id);
          const isSel = sel?.kind === "path" && sel.id === p.relationship_id;
          if (!touches && !isSel && (!ui.layers[layer] || (p.evidence_level === "hypothetical" && !ui.showHypothetical))) return null;
          const dashed = p.evidence_level === "hypothetical" || p.evidence_level === "inferred";
          const x1 = X(a.asset_id), y1 = Y(a.asset_id), x2 = X(t.asset_id), y2 = Y(t.asset_id);
          const mx = (x1 + x2) / 2 + (y2 - y1) * 0.08, my = (y1 + y2) / 2 - (x2 - x1) * 0.08;
          // shorten to node edge
          const len = Math.hypot(x2 - mx, y2 - my) || 1; const ex = x2 - ((x2 - mx) / len) * 40, ey = y2 - ((y2 - my) / len) * 30;
          return (
            <path key={p.relationship_id} d={`M${x1},${y1} Q${mx},${my} ${ex},${ey}`} fill="none" stroke={LAYER_STYLE[layer].color}
              strokeWidth={touches || isSel ? 3 : 1.6} strokeOpacity={touches || isSel ? 1 : sel ? 0.25 : 0.7} strokeDasharray={dashed ? "7 5" : undefined}
              markerEnd={`url(#arrow-${layer})`} className="edge" onClick={() => dispatch({ type: "select", selection: { kind: "path", id: p.relationship_id } })}>
              <title>{`${p.kind} (${p.evidence_level})`}</title>
            </path>
          );
        })}
        {scene.rooms.map((r) => {
          const a = graph.assets.find((x) => x.id === r.asset_id)!;
          const st = vm.assetStatus.get(r.asset_id);
          const isSel = (sel?.kind === "asset" && sel.id === r.asset_id) || (sel?.kind === "finding" && vm.findings.find((f) => f.id === sel.id)?.affected_asset_ids.includes(r.asset_id));
          const dim = q.length > 1 && !(a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q));
          const w = 176, h = 56, x = X(r.asset_id) - w / 2, y = Y(r.asset_id) - h / 2;
          const style = st?.worst ? OUTCOME_STYLE[st.worst] : null;
          return (
            <g key={r.asset_id} data-node transform={`translate(${x},${y})`} tabIndex={0} role="button" opacity={dim ? 0.3 : 1}
              aria-label={`${a.name}, ${KIND_LABEL[a.kind]}${style ? `, ${style.label}` : ""}${st?.coverage !== "reporting" ? ", coverage gap" : ""}`}
              aria-pressed={!!isSel} className={`node${isSel ? " selected" : ""}`}
              onClick={() => select(a.id, a.name)} onKeyDown={(e) => key(e, a.id, a.name)}
              onFocus={() => dispatch({ type: "hover", id: a.id })} onBlur={() => dispatch({ type: "hover", id: null })}>
              <rect width={w} height={h} rx={10} className="node-bg" />
              {st && st.coverage !== "reporting" && <rect width={w} height={h} rx={10} fill="url(#hatch)" opacity={st.coverage === "gap" ? 0.45 : 0.2} />}
              <rect x={8} y={13} width={26} height={24} rx={6} className="node-glyph-bg" /><text x={21} y={29} textAnchor="middle" className="node-glyph" aria-hidden>{GLYPH[a.kind]}</text>
              <text x={38} y={22} className="node-name">{a.name.length > 17 ? a.name.slice(0, 16) + "…" : a.name}</text>
              <text x={38} y={38} className="node-kind">{st?.coverage === "gap" ? "Coverage gap" : st?.coverage === "unobserved" ? "No telemetry" : KIND_LABEL[a.kind]}</text>
              {style && (
                <g transform={`translate(${w - 4},${-4})`}>
                  <circle r={12} fill={style.color} stroke="#0f141a" strokeWidth={2} />
                  <text textAnchor="middle" y={4.5} className="node-badge" aria-hidden>{style.glyph}</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <div className="graph-hint" aria-hidden>Drag to pan · scroll to zoom</div>
    </div>
  );
}
