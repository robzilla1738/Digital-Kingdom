import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const context = vi.hoisted(() => ({ value: {} as any }));
vi.mock("../../lib/state.tsx", () => ({ useApp: () => context.value }));
import { CoverageWorkspace } from "./CoverageWorkspace.tsx";
import { IntegrationsWorkspace } from "../integrations/IntegrationsWorkspace.tsx";

beforeEach(() => {
  const oldSources = [{ id: "old", label: "Pinned old source", asset_ids: [], kind: "otel", disabled: false }];
  const currentSources = [{ id: "current", label: "Current source record", asset_ids: [], kind: "otel", disabled: true }, { id: "new", label: "New source record", asset_ids: [], kind: "falco", disabled: false }];
  context.value = { ui: { playhead: "2026-10-20T14:00:00Z" }, dispatch: vi.fn(), vm: {
    data: { mode: "offline-demo", role: "none", sources: oldSources, project: { id: "synthetic", name: "Synthetic test", dataset_kind: "synthetic" }, graph: { assets: [], graph_revision: "pinned-r1" } },
    latestData: { mode: "offline-demo", graph: { assets: [], graph_revision: "current-r2" }, sources: currentSources, coverage: [] }, coverage: [{ source_id: "current", state: "healthy" }, { source_id: "new", state: "healthy" }], assetStatus: new Map(), coverageAsOf: "2026-10-22T18:00:00Z",
  } };
});
describe("current source metadata while unrelated evidence is pinned", () => {
  it("uses current source administration, not the pinned source array", () => {
    const html = renderToStaticMarkup(createElement(CoverageWorkspace));
    expect(html).toContain("Current source record"); expect(html).toContain("New source record"); expect(html).not.toContain("Pinned old source");
    expect(html).toContain("Administratively disabled"); expect(html).toContain("2026-10-22 18:00:00 UTC");
    expect(html).toContain("Historical coverage is not assessed"); expect(html).toContain("sources without confirmed reporting");
  });
  it("shows the current configured-source count in Integrations", () => {
    const html = renderToStaticMarkup(createElement(IntegrationsWorkspace));
    expect(html).toContain("2 configured source records in this project."); expect(html).not.toContain("1 configured source records");
  });
});
