import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../../lib/state.tsx", () => ({ useApp: () => ({ ui: { selection: null }, dispatch: () => {}, vm: { findings: [], isLatest: true, data: { findings: [], graph: { assets: [] } } } }), sortFindings: (findings: unknown[]) => findings }));
import { FindingsWorkspace } from "./FindingsWorkspace.tsx";
describe("honest finding-source capability boundary", () => {
  it("does not fabricate exhaustive source membership from loaded events", () => {
    const html = renderToStaticMarkup(createElement(FindingsWorkspace));
    expect(html).toContain("Finding records do not expose exhaustive source IDs.");
    expect(html).toContain("Source-scoped queries are available in Events.");
    expect(html).toContain("Search events by source");
    expect(html).not.toContain('aria-label="Finding source"');
  });
});
