import { useState } from "react";
import type { OutcomeState } from "@dk/contracts";
import { OUTCOME_STYLE } from "../lib/vocab.ts";
import { GapIcon, Icon, StateIcon } from "../lib/icons.tsx";
export function Legend() {
  const [open, setOpen] = useState(false);
  return <div className={`legend${open ? " open" : ""}`}><button className="legend-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="legend-body"><Icon name="info" size={16} />Map key<Icon name="chevron-down" size={14} /></button>{open && <div className="legend-body" id="legend-body"><div><h5>Recorded outcomes, not urgency</h5><ul>{(Object.keys(OUTCOME_STYLE) as OutcomeState[]).map((key) => <li key={key}><StateIcon state={key} />{OUTCOME_STYLE[key].label}</li>)}<li><GapIcon />Coverage warning, independent of findings</li></ul></div><div><h5>Relationship evidence</h5><ul><li><span className="line-swatch" aria-hidden />Observed</li><li><span className="line-swatch dashed" aria-hidden />Declared</li><li><span className="line-swatch" style={{ background: "none", borderTop: "2px dashed var(--text-3)" }} aria-hidden />Inferred (dash-dot in map)</li><li><span className="line-swatch" style={{ background: "none", borderTop: "2px dotted var(--text-3)" }} aria-hidden />Hypothetical · off by default</li></ul><p className="legend-note">Stone, paths, and zone terraces are presentation geometry, not security controls. Finding urgency uses recorded severity. Shared addresses are not identity.</p></div></div>}</div>;
}
