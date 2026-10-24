import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileWorld, instantiateBlueprint, previewWorld } from "../../../../../packages/local-world/src/index.ts";

const state = vi.hoisted(() => ({ local: false }));
vi.mock("../../lib/state.tsx", () => ({ useApp: () => ({ vm: { latestData: { project: { id: "p", provenance: state.local ? { local_run: true } : { local_run: false } } } } }) }));
import { LocalWorldPanel, PreviewView, ReportingTable, type ReportingView, type WorldPreview } from "./LocalWorld.tsx";

/** LP04/LP06 console: the preview and reporting views render the server's records without inventing state. */
describe("local world setup view", () => {
  it("renders a real preview: resources, declared sources with their role and group, explicit gaps", () => {
    const p = previewWorld(compileWorld(instantiateBlueprint("saas-storefront", { seed: "ui" }))) as unknown as WorldPreview;
    const html = renderToStaticMarkup(createElement(PreviewView, { p }));
    expect(html).toContain("Local laboratory — synthetic people and data");
    expect(html).toContain("data-source-role=\"independent_observer\"");
    expect(html).toContain("group <code>observer:audit</code>");
    expect(html).toContain("queue: no independent observer is attached");
    expect(html).toContain("This console never launches processes");
  });
  it("reporting distinguishes reporting, silent and unavailable capabilities", () => {
    const view: ReportingView = {
      summary: { sources: 2, capabilities: 3, reporting: 1, silent: 1, unavailable: 1 },
      sources: [
        { source_id: "audit", label: "a", kind: "effect_observer", role: "independent_observer", independence_group: "observer:audit", coverage_state: "unknown", health: { state: "unavailable", since: "Fri 2026-10-23 6:00 PM CDT (UTC-05:00)" }, rejected: 0, capabilities: [{ asset_id: "tenant-db", action: "data_access", status: "unavailable", events: 2, last_event_at: null }] },
        { source_id: "api-sdk", label: "b", kind: "app_security", role: "self_report", independence_group: "self:api", coverage_state: "healthy", health: { state: "no_outage_reported" }, rejected: 0, capabilities: [{ asset_id: "api", action: "data_access", status: "reporting", events: 1, last_event_at: "x" }, { asset_id: "api", action: "authorization_change", status: "silent", events: 0, last_event_at: null }] },
      ],
      note: "Declared capabilities from registered source records; 'silent' means nothing has arrived, not that nothing happened.",
    };
    const html = renderToStaticMarkup(createElement(ReportingTable, { view }));
    expect(html.match(/data-capability-status="silent"/g)).toHaveLength(1);
    expect(html).toContain("audit reported itself unavailable since");
    expect(html).toContain("effects in that interval are unknown");
    expect(html).toContain("not that nothing happened");
  });
  it("without a server the panel says so; nothing can be started from the console", () => {
    expect(renderToStaticMarkup(createElement(LocalWorldPanel))).toContain("The offline demo has no server");
  });
});
