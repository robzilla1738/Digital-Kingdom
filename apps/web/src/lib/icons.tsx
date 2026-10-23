import type { SVGProps } from "react";
import type { OutcomeState } from "@dk/contracts";
import { OUTCOME_STYLE } from "./vocab.ts";

import { Play, Pause, SkipForward, PanelLeft, PanelRight, Layers, Search, X, Plus, Minus, Maximize, RotateCcw, Box, Network, Info, TriangleAlert, ChevronDown, ChevronRight, House, Circle, List, CircleHelp, SlidersHorizontal, ArrowUpRight, Castle } from "lucide-react";

const icons = {
  play: Play, pause: Pause, latest: SkipForward, "panel-left": PanelLeft, "panel-right": PanelRight,
  layers: Layers, search: Search, x: X, plus: Plus, minus: Minus, fit: Maximize, reset: RotateCcw,
  cube: Box, graph: Network, info: Info, alert: TriangleAlert, "chevron-down": ChevronDown,
  "chevron-right": ChevronRight, roof: House, dot: Circle, list: List, help: CircleHelp,
  filters: SlidersHorizontal, "arrow-up-right": ArrowUpRight, castle: Castle,
};
export function Icon({ name, size = 16, ...rest }: { name: keyof typeof icons; size?: number } & SVGProps<SVGSVGElement>) {
  const Glyph = icons[name];
  return <Glyph size={size} strokeWidth={1.65} aria-hidden="true" focusable="false" {...rest} />;
}

/**
 * Outcome marks. Every outcome has its own SHAPE as well as its colour, so state never depends on
 * colour alone (the same shapes are used as 3D markers in the castle).
 */
export function StateIcon({ state, size = 12, title }: { state: OutcomeState; size?: number; title?: string }) {
  const s = OUTCOME_STYLE[state];
  const c = s.color;
  let shape;
  switch (s.shape) {
    case "shield": shape = <path d="M8 1.8l5.2 2v4c0 3.1-2.2 5.3-5.2 6.4C5 13.1 2.8 10.9 2.8 7.8v-4L8 1.8z" fill={c} />; break;
    case "diamond": shape = <path d="M8 1.5l6.5 6.5L8 14.5 1.5 8 8 1.5z" fill={c} />; break;
    case "circle": shape = <circle cx="8" cy="8" r="5.5" fill={c} />; break;
    case "square": shape = <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="1.5" fill="none" stroke={c} strokeWidth="2" />; break;
    case "triangle": shape = <path d="M8 2l6.5 11.5h-13L8 2z" fill={c} />; break;
    case "ring": shape = <><circle cx="8" cy="8" r="5.25" fill="none" stroke={c} strokeWidth="2.2" /><circle cx="8" cy="8" r="1.8" fill={c} /></>; break;
    case "hatch": shape = <><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke={c} strokeWidth="1.6" /><path d="M5 11l6-6M2.8 8.2l5.4-5.4M7.8 13.2l5.4-5.4" stroke={c} strokeWidth="1.4" /></>; break;
  }
  return (
    <svg className="state-icon" width={size} height={size} viewBox="0 0 16 16" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {shape}
    </svg>
  );
}

/** Hatched square used everywhere for "coverage gap / unobserved" (pattern carries the meaning). */
export function GapIcon({ size = 12 }: { size?: number }) {
  return (
    <svg className="state-icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="var(--warn)" strokeWidth="1.5" strokeDasharray="2.5 1.5" />
      <path d="M5 11l6-6M4.5 7.5l3-3M8.5 11.5l3-3" stroke="var(--warn)" strokeWidth="1.3" />
    </svg>
  );
}
