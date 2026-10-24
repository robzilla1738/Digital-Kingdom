import { Html } from "@react-three/drei";
import type { WorldComparisonView } from "../inspector/actions.tsx";
import { OP_GLYPH, OP_TEXT } from "./ComparisonPanel.tsx";
export { ComparisonPanel, NarrowComparison, useNarrowLayout, useWorldComparison } from "./ComparisonPanel.tsx";

/** Ghost badges on the SAME baseline rooms (common layout/camera): text + glyph, never colour only. */
export function ComparisonBadges({ view }: { view: WorldComparisonView }) {
  return <group name="comparison-badges">{view.rooms.filter((r) => r.baseline_position).map((r) =>
    <Html key={r.asset_id} position={[r.baseline_position!.x, 0.6, r.baseline_position!.z]} center zIndexRange={[28, 22]}>
      <span data-comparison-room={r.asset_id} data-change={r.change} style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, border: "1px dashed #EEF3FA", background: "rgba(18,28,41,0.9)", color: "#EEF3FA", whiteSpace: "nowrap" }}
        title={r.refs.join("\n")}>{OP_GLYPH[r.change]} {r.asset_id} · {OP_TEXT[r.change].toLowerCase()} · model only</span>
    </Html>)}</group>;
}
