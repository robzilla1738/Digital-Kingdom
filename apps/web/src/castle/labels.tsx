import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Screen-space label decluttering for the castle. Every label registers its world anchor and a
 * priority; once per frame the solver projects anchors, places labels greedily by priority and hides
 * any that would overlap one already placed. Selected and hovered labels are always placed. Work is
 * O(n²) over a few dozen labels and touches the DOM only through class toggles (no React renders).
 */
export const FORCE = 1000;

interface Entry { el: HTMLElement | null; pos: THREE.Vector3; priority: number; offsetY: number; visible: boolean | null }
const Ctx = createContext<Map<string, Entry> | null>(null);

export function LabelLayer({ children }: { children: ReactNode }) {
  const map = useRef(new Map<string, Entry>()).current;
  return <Ctx.Provider value={map}><LabelSolver map={map} />{children}</Ctx.Provider>;
}

/** Register a label; returns the ref callback for its DOM wrapper. Priority may change every render. */
export function useLabel(id: string, pos: [number, number, number], priority: number, offsetY = 0) {
  const map = useContext(Ctx);
  const ref = useRef<Entry | null>(null);
  const e = (ref.current ??= { el: null, pos: new THREE.Vector3(), priority, offsetY, visible: null });
  e.pos.set(pos[0], pos[1], pos[2]); e.priority = priority; e.offsetY = offsetY;
  return useCallback((el: HTMLElement | null) => {
    const cur = ref.current!;
    if (el) { cur.el = el; cur.visible = null; map?.set(id, cur); }
    else { cur.el = null; map?.delete(id); }
  }, [map, id]);
}

const v = new THREE.Vector3();
type R = { x0: number; y0: number; x1: number; y1: number };

function LabelSolver({ map }: { map: Map<string, Entry> }) {
  useFrame(({ camera, size }) => {
    const items: { e: Entry; r: R; depth: number }[] = [];
    for (const e of map.values()) {
      if (!e.el) continue;
      v.copy(e.pos).project(camera);
      const x = (v.x + 1) / 2 * size.width, y = (1 - v.y) / 2 * size.height + e.offsetY;
      const w = e.el.offsetWidth || 60, h = e.el.offsetHeight || 22;
      items.push({ e, depth: v.z, r: { x0: x - w / 2 - 3, y0: y - h / 2 - 2, x1: x + w / 2 + 3, y1: y + h / 2 + 2 } });
    }
    // higher priority first; nearer to the camera wins ties
    items.sort((a, b) => b.e.priority - a.e.priority || a.depth - b.depth);
    const placed: R[] = [];
    for (const it of items) {
      const { r } = it;
      const forced = it.e.priority >= FORCE;
      // forced labels may hang off an edge; everything else must fit fully inside the canvas
      const onScreen = forced ? r.x1 > 0 && r.x0 < size.width && r.y1 > 0 && r.y0 < size.height : r.x0 >= 0 && r.x1 <= size.width && r.y0 >= 0 && r.y1 <= size.height;
      let ok = onScreen && (forced || !placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0));
      if (it.e.priority < -500) ok = false;
      if (ok) placed.push(r);
      if (it.e.visible !== ok) {
        it.e.visible = ok;
        it.e.el!.classList.toggle("shown", ok);
        it.e.el!.classList.toggle("hidden", !ok);
      }
    }
  });
  return null;
}
