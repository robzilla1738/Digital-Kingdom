import { useState } from "react";
import type { OutcomeState } from "@dk/contracts";
import { OUTCOME_STYLE, LAYER_STYLE } from "../lib/vocab.ts";
import { GapIcon, Icon, StateIcon } from "../lib/icons.tsx";

const KEY = "dk.legend";

export function Legend() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } });
  const toggle = () => { setOpen(!open); try { localStorage.setItem(KEY, open ? "0" : "1"); } catch { /* storage unavailable */ } };
  return (
    <div className={`legend${open ? " open" : ""}`}>
      <button className="legend-toggle" onClick={toggle} aria-expanded={open} aria-controls="legend-body">
        <Icon name="info" size={14} />Legend<Icon name="chevron-down" size={14} className="chev" />
      </button>
      {open && (
        <div className="legend-body" id="legend-body">
          <div>
            <h5>Outcome</h5>
            <ul>
              {(Object.keys(OUTCOME_STYLE) as OutcomeState[]).filter((k) => k !== "allowed").map((k) => <li key={k}><StateIcon state={k} /> {OUTCOME_STYLE[k].label}</li>)}
              <li><GapIcon /> Coverage gap</li>
            </ul>
          </div>
          <div>
            <h5>Relationships</h5>
            <ul>
              {Object.values(LAYER_STYLE).map((l) => <li key={l.label}><span className="line-swatch" style={{ background: l.color }} aria-hidden /> {l.label}</li>)}
              <li><span className="line-swatch dashed" aria-hidden /> Inferred or hypothetical</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
