import { useId, useRef, type ReactNode } from "react";

export interface TabOption<T extends string> { value: T; label: ReactNode; disabled?: boolean }
/** Manual activation: arrows move focus; Enter/Space activate. No incidental fetch on arrow navigation. */
export function Tabs<T extends string>({ label, value, onChange, options, panelId, className = "tabs" }: { label: string; value: T; onChange: (value: T) => void; options: TabOption<T>[]; panelId?: string; className?: string }) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return <div className={className} role="tablist" aria-label={label}>
    {options.map((option, index) => <button key={option.value} ref={(node) => { refs.current[index] = node; }} id={`${id}-${option.value}`} type="button" role="tab" aria-selected={value === option.value} aria-controls={panelId} tabIndex={value === option.value ? 0 : -1} disabled={option.disabled} className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)} onKeyDown={(event) => {
      const enabled = options.map((entry, i) => entry.disabled ? -1 : i).filter((i) => i >= 0);
      let next: number | undefined;
      if (event.key === "ArrowRight") next = enabled[(enabled.indexOf(index) + 1) % enabled.length];
      if (event.key === "ArrowLeft") next = enabled[(enabled.indexOf(index) - 1 + enabled.length) % enabled.length];
      if (event.key === "Home") next = enabled[0];
      if (event.key === "End") next = enabled.at(-1);
      if (next !== undefined) { event.preventDefault(); refs.current[next]?.focus(); }
    }}>{option.label}</button>)}
  </div>;
}

export function SegmentedControl<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: TabOption<T>[]; onChange: (value: T) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return <div className="seg" role="radiogroup" aria-label={label}>{options.map((option, index) => <button type="button" key={option.value} ref={(node) => { refs.current[index] = node; }} role="radio" aria-checked={value === option.value} tabIndex={value === option.value ? 0 : -1} disabled={option.disabled} className={value === option.value ? "on" : ""} onClick={() => onChange(option.value)} onKeyDown={(event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); const enabled = options.map((o, i) => o.disabled ? -1 : i).filter((i) => i >= 0); const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
    const next = event.key === "Home" ? enabled[0] : event.key === "End" ? enabled.at(-1) : enabled[(enabled.indexOf(index) + direction + enabled.length) % enabled.length];
    if (next !== undefined) { onChange(options[next]!.value); refs.current[next]?.focus(); }
  }}>{option.label}</button>)}</div>;
}
