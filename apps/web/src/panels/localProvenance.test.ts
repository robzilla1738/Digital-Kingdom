import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** LP03-A2 (UI): a local-run project shows its synthetic-data / local-scope qualifier; other projects do not. */
const state = vi.hoisted(() => ({ provenance: undefined as unknown }));
vi.mock("../lib/state.tsx", () => ({ useApp: () => ({ ui: { reduceAutomaticAnnouncements: true }, dispatch: () => {}, vm: { findings: [], summary: { assetsWithGaps: 0, openFindings: 0 }, data: { projects: [{ id: "lab" }], project: { id: "lab", name: "Lab", dataset_kind: "live", ...(state.provenance ? { provenance: state.provenance } : {}) }, graph: { assets: [{ id: "api", name: "api", environment: "local" }] } } } }) }));
import { TopBar } from "./TopBar.tsx";
import { loadFromServer, type Api } from "../lib/data.ts";

describe("local laboratory qualifier in the console", () => {
  it("TopBar marks a local-run project and keeps the dataset pill unchanged", () => {
    state.provenance = { local_run: true, label: "Local laboratory — synthetic people and data", run_id: "run-1", execution_mode: "local_runtime", data_origin: "synthetic_local", scope: "local_run_only" };
    const html = renderToStaticMarkup(createElement(TopBar, { connection: null }));
    expect(html).toContain('data-testid="local-lab-pill"');
    expect(html).toContain("Local run run-1 · local_runtime · local scope only");
    expect(html).toContain("Telemetry"); // dataset_kind live is not relabelled
    state.provenance = { local_run: false };
    expect(renderToStaticMarkup(createElement(TopBar, { connection: null }))).not.toContain("local-lab-pill");
  });
  it("the server snapshot's provenance reaches the dataset", async () => {
    const prov = { local_run: true, label: "Local laboratory — synthetic people and data", run_id: "run-1", execution_mode: "local_runtime", data_origin: "synthetic_local", scope: "local_run_only" };
    const api = { get: async (p: string) => p === "/api/projects" ? [{ id: "lab", name: "Lab", dataset_kind: "live" }] : { project: { id: "lab", name: "Lab", dataset_kind: "live", provenance: prov }, graph: null, scene: null, sources: [], events: [], evidence: {}, findings: [], coverage: [], unobserved_asset_ids: [], cursor: 0, server_time: "2026-10-23T10:00:00Z", role: "viewer", planner_available: false } } as unknown as Api;
    expect((await loadFromServer(api, "lab")).project.provenance).toEqual(prov);
  });
});
