import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

export const FORCE = 1000;
interface Entry { id: string; el: HTMLElement | null; pos: THREE.Vector3; priority: number; offsetY: number; visible: boolean | null }
const Ctx = createContext<Map<string, Entry> | null>(null);
export function LabelLayer({ children, budget = 12, reservedLeft = 0 }: { children: ReactNode; budget?: number; reservedLeft?: number }) {
  const map = useRef(new Map<string, Entry>()).current;
  return <Ctx.Provider value={map}><LabelSolver map={map} budget={budget} reservedLeft={reservedLeft} />{children}</Ctx.Provider>;
}
export function useLabel(id: string, pos: [number, number, number], priority: number, offsetY = 0) {
  const map = useContext(Ctx), ref = useRef<Entry | null>(null), invalidate = useThree(s => s.invalidate);
  const e = ref.current ??= { id, el: null, pos: new THREE.Vector3(), priority, offsetY, visible: null };
  e.pos.set(...pos); e.priority = priority; e.offsetY = offsetY;
  return useCallback((el: HTMLElement | null) => { const cur = ref.current!; cur.el = el; cur.visible = null; if (el) { map?.set(id, cur); invalidate(); } else map?.delete(id); }, [map, id, invalidate]);
}
export type LabelRect = { x0: number; y0: number; x1: number; y1: number };
export const labelsOverlap = (a: LabelRect, b: LabelRect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
function LabelSolver({ map, budget, reservedLeft }: { map: Map<string, Entry>; budget: number; reservedLeft: number }) {
  const last = useRef("");
  useFrame(({ camera, size }) => {
    const signature = `${size.width}:${size.height}:${reservedLeft}:` + camera.matrixWorld.elements.map(v => v.toFixed(2)).join() + camera.projectionMatrix.elements.map(v => v.toFixed(3)).join() + [...map.values()].map(e => `${e.id}:${e.priority}:${e.el?.offsetWidth}:${e.el?.offsetHeight}`).join("|");
    if (signature === last.current) return; last.current = signature;
    const items: { e: Entry; r: LabelRect; depth: number; dx: number; dy: number }[] = [], p = new THREE.Vector3();
    for (const e of map.values()) {
      if (!e.el) continue; p.copy(e.pos).project(camera);
      const x = (p.x + 1) / 2 * size.width, y = (1 - p.y) / 2 * size.height + e.offsetY;
      const w = e.el.offsetWidth || 100, h = e.el.offsetHeight || 24;
      const r = { x0: x - w / 2 - 4, y0: y - h / 2 - 3, x1: x + w / 2 + 4, y1: y + h / 2 + 3 };
      let dx = 0, dy = 0;
      if (e.priority >= FORCE) {
        dx = r.x0 < 10 ? 10 - r.x0 : r.x1 > size.width - 10 ? size.width - 10 - r.x1 : 0;
        dy = r.y0 < 12 ? 12 - r.y0 : r.y1 > size.height - 70 ? size.height - 70 - r.y1 : 0;
        r.x0 += dx; r.x1 += dx; r.y0 += dy; r.y1 += dy;
        if (reservedLeft && r.x0 < reservedLeft && r.y0 < Math.min(size.height * 0.6, 420)) { const extra = reservedLeft + 8 - r.x0; if (r.x1 + extra < size.width - 10) { dx += extra; r.x0 += extra; r.x1 += extra; } }
      }
      items.push({ e, r, depth: p.z, dx, dy });
    }
    items.sort((a, b) => b.e.priority - a.e.priority || Number(b.e.visible) - Number(a.e.visible) || a.e.id.localeCompare(b.e.id));
    const placed: LabelRect[] = [{ x0: size.width - 150, y0: Math.max(0, size.height - 340), x1: size.width, y1: size.height }, ...(reservedLeft ? [{ x0: 0, y0: 0, x1: reservedLeft, y1: Math.min(size.height * 0.6, 420) }] : [])]; let ordinary = 0;
    for (const it of items) {
      const forced = it.e.priority >= FORCE, important = it.e.priority >= 180;
      let r = it.r, displacement = 0;
      if (forced && placed.some(p => labelsOverlap(p, r))) {
        const height = r.y1 - r.y0 + 6;
        for (const n of [-1, 1, -2, 2, -3, 3]) {
          const candidate = { ...r, y0: r.y0 + height * n, y1: r.y1 + height * n };
          if (candidate.y0 >= 10 && candidate.y1 <= size.height - 70 && !placed.some(p => labelsOverlap(p, candidate))) { r = candidate; displacement = height * n; break; }
        }
      }
      const onScreen = r.x0 >= 6 && r.x1 <= size.width - 6 && r.y0 >= 6 && r.y1 <= size.height - 64 && it.depth >= -1 && it.depth <= 1;
      const ok = it.e.priority > -500 && onScreen && (forced || important || ordinary < budget) && !placed.some(p => labelsOverlap(p, r));
      if (ok) { placed.push(r); if (!forced && !important) ordinary++; }
      const el = it.e.el!;
      el.style.transform = `translate(${it.dx}px, ${it.dy + displacement}px)`;
      el.dataset.labelVisible = String(ok);
      if (it.e.visible !== ok) { it.e.visible = ok; el.classList.toggle("shown", ok); el.classList.toggle("hidden", !ok); }
    }
  });
  return null;
}
