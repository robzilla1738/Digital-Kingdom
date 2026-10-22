import { useState } from "react";
import { OUTCOME_STYLE, LAYER_STYLE } from "../lib/vocab.ts";

export function Legend() {
  const [open, setOpen] = useState(true);
  return (
    <div className={`legend${open ? "" : " collapsed"}`}>
      <button className="legend-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>Legend</button>
      {open && (
        <div className="legend-body">
          <ul>
            {Object.entries(OUTCOME_STYLE).filter(([k]) => k !== "allowed").map(([k, s]) => <li key={k}><span style={{ color: s.color }} aria-hidden>{s.glyph}</span> {s.label}</li>)}
            <li><span className="hatch-swatch" aria-hidden /> Coverage gap / unobserved</li>
          </ul>
          <ul>
            {Object.values(LAYER_STYLE).map((l) => <li key={l.label}><span className="line-swatch" style={{ background: l.color }} aria-hidden /> {l.label}</li>)}
            <li><span className="line-swatch dashed" aria-hidden /> Inferred / hypothetical</li>
          </ul>
        </div>
      )}
    </div>
  );
}
