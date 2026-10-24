import { Html } from "@react-three/drei";
import { useApp } from "../lib/state.tsx";
import { INTERIOR_BASIS, INTERIOR_GLYPH, interiorRecordSelection, useAssetInterior } from "../inspector/InteriorView.tsx";

const MAX_MARKERS = 9;
/**
 * LP18: with roofs off, the selected building shows its evidence-linked interior objects as markers on its floor. Each
 * marker is the same dk.asset_interior.v1 object the inspector lists; activating it opens the exact record through the
 * ordinary selection. Marker positions are presentation only (a fixed grid), never a claim about where anything runs.
 */
export function InteriorMarkers({ assetId }: { assetId: string }) {
  const { dispatch } = useApp();
  const interior = useAssetInterior(assetId);
  if (!interior?.objects.length) return null;
  const shown = interior.objects.slice(0, MAX_MARKERS);
  // One stacked list anchored on the floor centre: markers never overlap each other at any zoom (positions inside the
  // building are presentation only).
  return <group name={`interior:${assetId}`}>
    <Html position={[0, 0.45, 0]} center zIndexRange={[30, 25]}>
      <ul className="interior-markers" aria-label="Interior records" style={{ listStyle: "none", margin: 0, padding: 4, display: "flex", flexDirection: "column", gap: 3, background: "rgba(11,17,27,0.72)", borderRadius: 6 }}>
        {shown.map((o) => {
          const selection = interiorRecordSelection(o);
          return <li key={o.object_id}><button className="interior-marker" data-interior-marker={o.object_id} data-basis={o.basis} data-transit={String(o.draw.transit)} data-record={`${o.record.type}:${o.record.id}`}
            style={{ font: "inherit", fontSize: 11, lineHeight: 1.2, padding: "2px 6px", borderRadius: 4, border: `1px ${o.basis === "observed" || o.basis === "tested" ? "solid" : "dashed"} #EEF3FA`, background: "#121C29", color: "#EEF3FA", whiteSpace: "nowrap", cursor: "pointer", width: "100%", textAlign: "left" }}
            aria-label={`Interior ${o.kind}: ${o.label}. ${INTERIOR_BASIS[o.basis]}. ${o.status.text}${selection ? ` Opens ${o.record.type} ${o.record.id}.` : " Record shown in the inspector."}`}
            onClick={(e) => { e.stopPropagation(); dispatch({ type: "select", selection: selection ?? { kind: "asset", id: assetId } }); }}>
            <span aria-hidden="true">{INTERIOR_GLYPH[o.status.glyph]}</span> {o.kind} · {INTERIOR_BASIS[o.basis].toLowerCase()}
          </button></li>;
        })}
        {interior.objects.length > MAX_MARKERS && <li className="interior-more" style={{ fontSize: 11, color: "#EEF3FA" }}>+{interior.objects.length - MAX_MARKERS} more in the inspector</li>}
      </ul>
    </Html>
  </group>;
}
