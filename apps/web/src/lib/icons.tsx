import type { SVGProps } from "react";
import type { OutcomeState } from "@dk/contracts";
import { OUTCOME_STYLE } from "./vocab.ts";

/**
 * A small, consistent line-icon set (24px grid, 1.75 stroke) drawn inline so nothing is fetched at
 * runtime. Icons are decorative by default: the control that holds one carries the accessible name.
 */
type IconName =
  | "play" | "pause" | "latest" | "panel-left" | "panel-right" | "layers" | "search" | "x" | "plus" | "minus"
  | "fit" | "reset" | "cube" | "graph" | "info" | "alert" | "chevron-down" | "chevron-right" | "roof" | "dot" | "list" | "help";

const PATHS: Record<IconName, string> = {
  play: "M7 5.5v13a.5.5 0 0 0 .77.42l10.2-6.5a.5.5 0 0 0 0-.84L7.77 5.08A.5.5 0 0 0 7 5.5z",
  pause: "M8 5v14M16 5v14",
  latest: "M6 5l7 7-7 7M17 5v14",
  "panel-left": "M4 5h16v14H4zM9.5 5v14",
  "panel-right": "M4 5h16v14H4zM14.5 5v14",
  layers: "M12 4l8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 16l8 4 8-4",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  x: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  reset: "M4 12a8 8 0 1 0 2.34-5.66M4 4v4h4",
  cube: "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM12 12l8-4.5M12 12L4 7.5M12 12v9",
  graph: "M5 6h5v4H5zM14 14h5v4h-5zM14 6h5v4h-5zM10 8h4M16.5 10v4",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  alert: "M12 4l9 16H3l9-16zM12 10v4M12 17h.01",
  "chevron-down": "M6 9l6 6 6-6",
  "chevron-right": "M9 6l6 6-6 6",
  roof: "M3 11l9-7 9 7M6 9.5V20h12V9.5",
  dot: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.2M12 17h.01",
};

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  const filled = name === "play";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
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
