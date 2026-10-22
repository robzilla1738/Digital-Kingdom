import { useEffect, useRef, useState, type ReactNode } from "react";

export function inspectorSizeBounds(available: number, min = 360, max = 520, minimumPrimary = 560) {
  const upper = Math.min(max, available - minimumPrimary);
  return upper < min ? null : { min, max: upper };
}
export function clampInspectorSize(value: number, bounds: { min: number; max: number }) { return Math.max(bounds.min, Math.min(bounds.max, value)); }

/** Non-modal complementary pane. Resizing never owns or replaces the selected record. */
export function SplitPane({ children, open, resizable, onSizeChange, onContainerWidth }: { children: ReactNode; open: boolean; resizable: boolean; onSizeChange: (size: number) => void; onContainerWidth: (size: number) => void }) {
  const pane = useRef<HTMLDivElement>(null); const drag = useRef<{ x: number; size: number } | null>(null);
  const [available, setAvailable] = useState(0); const [requested, setRequested] = useState(384);
  const bounds = inspectorSizeBounds(available); const enabled = resizable && !!bounds;
  const size = bounds ? clampInspectorSize(requested, bounds) : 384;
  useEffect(() => { const parent = pane.current?.parentElement; if (!parent) return; const measure = () => { const width = parent.getBoundingClientRect().width; setAvailable(width); onContainerWidth(width); }; measure(); const observer = new ResizeObserver(measure); observer.observe(parent); return () => observer.disconnect(); }, [onContainerWidth]);
  useEffect(() => onSizeChange(size), [size, onSizeChange]);
  return <div ref={pane} className="inspector-slot split-pane" hidden={!open} style={enabled ? { width: size } : undefined}>
    <div className="split-handle" role="separator" aria-label="Resize inspector" aria-orientation="vertical" aria-valuemin={bounds?.min ?? 360} aria-valuemax={bounds?.max ?? 520} aria-valuenow={size} aria-valuetext={`${Math.round(size)} pixels wide`} aria-controls="shared-inspector" aria-describedby="inspector-resize-help" tabIndex={enabled && open ? 0 : -1} hidden={!enabled || !open}
      onPointerDown={(event) => { if (event.button !== 0 || !enabled) return; event.preventDefault(); drag.current = { x: event.clientX, size }; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus(); }}
      onPointerMove={(event) => { if (drag.current && bounds) setRequested(clampInspectorSize(drag.current.size + drag.current.x - event.clientX, bounds)); }}
      onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={(event) => { if (!bounds) return; const step = event.shiftKey ? 64 : 16; const next = event.key === "ArrowLeft" ? size + step : event.key === "ArrowRight" ? size - step : event.key === "Home" ? bounds.min : event.key === "End" ? bounds.max : null; if (next !== null) { event.preventDefault(); setRequested(clampInspectorSize(next, bounds)); } }}><span aria-hidden /></div>
    <span id="inspector-resize-help" className="sr-only">Drag to resize. Left arrow widens; right arrow narrows. Home selects minimum width; End selects maximum. The inspector is not a modal dialog.</span>
    <div id="shared-inspector" className="split-pane-content">{children}</div>
  </div>;
}
