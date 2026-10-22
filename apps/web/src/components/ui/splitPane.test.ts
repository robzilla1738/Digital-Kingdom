import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { clampInspectorSize, inspectorSizeBounds, SplitPane } from "./SplitPane.tsx";

describe("bounded desktop inspector resize", () => {
  it("permits 360–520px only when a useful 560px primary pane remains", () => { expect(inspectorSizeBounds(1368)).toEqual({ min: 360, max: 520 }); expect(inspectorSizeBounds(952)).toEqual({ min: 360, max: 392 }); });
  it("disables split resizing rather than violate the minimum pane widths", () => expect(inspectorSizeBounds(900)).toBeNull());
  it("clamps keyboard or drag requests to both endpoints", () => { const b = { min: 360, max: 520 }; expect(clampInspectorSize(150,b)).toBe(360); expect(clampInspectorSize(600,b)).toBe(520); expect(clampInspectorSize(400,b)).toBe(400); });
  it("does not make an inspector modal or trap focus", () => { const html = renderToStaticMarkup(createElement(SplitPane, { open: true, resizable: false, onSizeChange: () => {}, onContainerWidth: () => {}, children: createElement('aside', { 'aria-label': 'Evidence detail' }, 'Record remains mounted') })); expect(html).toContain('role="separator"'); expect(html).toContain('aria-orientation="vertical"'); expect(html).toContain('aria-controls="shared-inspector"'); expect(html).toContain('Record remains mounted'); expect(html).not.toContain('aria-modal'); expect(html).not.toContain('role="dialog"'); });
});
