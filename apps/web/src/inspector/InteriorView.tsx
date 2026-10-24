import { useMemo } from "react";
import { buildInterior, type InteriorObject } from "@dk/scene-compiler";
import { useApp } from "../lib/state.tsx";
import { Section } from "./Shared.tsx";

/** Text glyphs: status is always written out, the glyph is a second cue, never colour alone (LP18-A2). */
const GLYPH_TEXT: Record<InteriorObject["status"]["glyph"], string> = { "dash-outline": "◌", solid: "●", ring: "○", hatch: "▨", check: "✓", cross: "✕", question: "?" };
const BASIS_TEXT: Record<InteriorObject["basis"], string> = { declared: "Declared", configured: "Configured", observed: "Observed", tested: "Tested", unknown: "Unknown", hypothetical: "Hypothetical" };

/**
 * LP18 evidence-linked interior (dk.asset_interior.v1), built by the same `buildInterior` the API and MCP use, from the
 * records this view has loaded. Each row opens the exact authoritative record through the ordinary inspector selection
 * (event, relationship, source) or shows the copied record body and provenance inline. This is the conventional
 * equivalent of the castle's interior markers.
 */
export function InteriorView({ assetId }: { assetId: string }) {
  const { vm, dispatch } = useApp();
  const interior = useMemo(() => buildInterior({ project_id: vm.data.project.id, graph: vm.data.graph, asset_id: assetId, events: vm.events,
    sources: vm.latestData.sources, coverage: vm.coverage, controls: null, grants: null }), [vm.data.project.id, vm.data.graph, assetId, vm.events, vm.latestData.sources, vm.coverage]);
  if (!interior) return null;
  const open = (o: InteriorObject) => {
    if (o.record.type === "event" && !o.object_id.startsWith("run:")) dispatch({ type: "select", selection: { kind: "event", id: o.record.id } });
    else if (o.record.type === "relationship") dispatch({ type: "select", selection: { kind: "path", id: o.record.id } });
    else if (o.record.type === "source") dispatch({ type: "select", selection: { kind: "source", id: o.record.id } });
  };
  const opensSelection = (o: InteriorObject) => (o.record.type === "event" && !o.object_id.startsWith("run:")) || o.record.type === "relationship" || o.record.type === "source";
  return <Section title="Evidence interior" count={interior.objects.length} id="evidence-interior">
    <div data-testid="evidence-interior" data-schema={interior.schema}>
      <p className="small faint">Objects copied from records ({interior.schema}). Positions inside the building are presentation only; declared and configured links are not observed transit.</p>
      {interior.unavailable.map((u) => <p key={u.what} className="small faint" data-testid="interior-unavailable">{u.what}: {u.reason}.</p>)}
      {interior.objects.length ? <ul className="mini-list">{interior.objects.map((o) => <li key={o.object_id} data-interior-object={o.object_id} data-kind={o.kind} data-basis={o.basis} data-transit={String(o.draw.transit)} data-record={`${o.record.type}:${o.record.id}`}>
        <div className="grow"><strong><span aria-hidden="true">{GLYPH_TEXT[o.status.glyph]} </span>{o.label}</strong>
          <small className="faint"> · {o.kind} · {BASIS_TEXT[o.basis]}{o.draw.transit ? " · observed transit" : ""}</small>
          <p className="small">{o.status.text}</p>
          <details><summary className="small">Record {o.record.type} · {o.record.id}</summary><pre className="small" data-testid="interior-record-body">{JSON.stringify(o.record.body, null, 1)}</pre><p className="small faint">Provenance: {o.provenance.join(", ")}</p></details>
        </div>
        {opensSelection(o) && <button className="btn sm" onClick={() => open(o)} aria-label={`Open ${o.record.type} record ${o.record.id}`}>Open record</button>}
      </li>)}</ul> : <p className="small faint">No interior records for this asset in the loaded data. That is not proof of absence.</p>}
      {interior.truncated && <p className="small faint">Showing the first objects only; the interior is truncated.</p>}
    </div>
  </Section>;
}
