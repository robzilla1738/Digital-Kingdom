import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CoverageChip, EvidenceBadge, OutcomeBadge, SeverityBadge } from "./Status.tsx";
import { SegmentedControl, Tabs } from "./Tabs.tsx";
import { ASSET_COVERAGE_LABEL } from "../../lib/presentation.ts";
import { EVIDENCE_LEVEL_LABEL, OUTCOME_STYLE, SEVERITY_LABEL } from "../../lib/vocab.ts";

describe("independent, non-color-only visual states", () => {
  it("always renders every outcome as text", () => { for (const outcome of Object.keys(OUTCOME_STYLE) as (keyof typeof OUTCOME_STYLE)[]) expect(renderToStaticMarkup(createElement(OutcomeBadge, { outcome }))).toContain(OUTCOME_STYLE[outcome].label); });
  it("renders severity separately without implying an outcome", () => { for (const severity of Object.keys(SEVERITY_LABEL) as (keyof typeof SEVERITY_LABEL)[]) { const html = renderToStaticMarkup(createElement(SeverityBadge, { severity })); expect(html).toContain(SEVERITY_LABEL[severity]); expect(html).not.toContain("Blocked"); } });
  it("does not collapse missing evidence or partial/unobserved coverage into safe", () => { for (const level of Object.keys(EVIDENCE_LEVEL_LABEL) as (keyof typeof EVIDENCE_LEVEL_LABEL)[]) expect(renderToStaticMarkup(createElement(EvidenceBadge, { level }))).toContain(EVIDENCE_LEVEL_LABEL[level]); for (const state of Object.keys(ASSET_COVERAGE_LABEL) as (keyof typeof ASSET_COVERAGE_LABEL)[]) expect(renderToStaticMarkup(createElement(CoverageChip, { state }))).toContain(ASSET_COVERAGE_LABEL[state]); });
});
describe("keyboard control structure", () => {
  it("has one sequential tab stop and explicit selected state", () => { const html = renderToStaticMarkup(createElement(Tabs, { label: "Workspace tabs", value: "a", onChange: () => {}, panelId: "panel", options: [{ value: "a", label: "First" }, { value: "b", label: "Second" }] })); expect(html.match(/tabindex="0"/g)).toHaveLength(1); expect(html).toContain('role="tablist"'); expect(html).toContain('aria-selected="true"'); expect(html).toContain('aria-controls="panel"'); });
  it("exposes mutually exclusive graph choices as radios", () => { const html = renderToStaticMarkup(createElement(SegmentedControl, { label: "View", value: "castle", onChange: () => {}, options: [{ value: "castle", label: "Castle" }, { value: "graph", label: "Graph" }] })); expect(html).toContain('role="radiogroup"'); expect(html.match(/aria-checked="true"/g)).toHaveLength(1); expect(html.match(/tabindex="0"/g)).toHaveLength(1); });
});
