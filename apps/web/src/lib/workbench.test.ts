import { describe, expect, it } from "vitest";
import { anchorForSelection, criticalStatus, recordsForAnchor, type Workbench, type WorkbenchRecord } from "./workbench.ts";
import { parseNavigation, serializeNavigation } from "./navigation.ts";

const rec = (ref: string, role: string, assets: string[]): WorkbenchRecord => ({ ref, role, required: true, occurred_at: "2026-10-20T13:00:00.000Z", action: "data_access", outcome: "success", asset_ids: assets, source_id: "s", digest: "d".repeat(64), obligation_ids: [], anchors: [`event:${ref}`, ...assets.map((a) => `asset:${a}`)], untrusted: {} });
const wb = (over: Partial<Workbench> = {}): Workbench => ({
  schema: "dk.case_workbench.v1", project_id: "p", case: { id: "c", title: "t", version: 1, status: "open", question: "q" }, provenance: { local_run: false },
  contract: { id: "ic", revision: 2, stale: true, readiness: "collecting" }, progress: { readiness: "collecting", reason: "", obligations: { total: 2, by_status: {} }, closure_prerequisites: [] },
  evidence_questions: [], case_record: { questions: [{ item_id: "q1", text: "who?", status: "open", answer: null }], hypotheses: [], notes: [] }, competing_hypotheses: { items: [], decided: 0, note: "" },
  evidence: { supporting: [rec("e1", "supporting", ["api"])], counter: [rec("e2", "counter", ["db"])], other: [], complete: false, omitted_required: [{ ref: "e9", role: "supporting", reason: "size_limit" }], omitted_other: [] },
  failed_queries: [{ kind: "query_step", id: "j/s", status: "partial_budget", reason: "", question: "", anchors: [] }],
  uncertainty: { readiness: "collecting", readiness_reason: "", negative_claims: [{ id: "n1", assessable: false, reason: "" }], coverage_gaps: [] },
  pending_jobs: [], next_actions: [], summary: { observed: [], supports: [], does_not_support: [], could_change: [], next: "" },
  proposals: { items: [], latest_version: 0, note: "" }, anchors: [], ...over,
});

describe("LP12 shared anchors and critical status", () => {
  it("a castle selection maps to the same canonical anchor the workbench uses, and the anchor survives a navigation round trip", () => {
    const nav = parseNavigation(`#${serializeNavigation({ ...parseNavigation(""), selection: { kind: "asset", id: "db" } })}`);
    expect(anchorForSelection(nav.selection)).toBe("asset:db");
    expect(anchorForSelection({ kind: "path", id: "x" })).toBeNull();
    expect(anchorForSelection(null)).toBeNull();
    const w = wb();
    expect(recordsForAnchor(w, "asset:db").map((r) => r.ref)).toEqual(["e2"]);
    expect(recordsForAnchor(w, "event:e1").map((r) => r.ref)).toEqual(["e1"]);
    expect(recordsForAnchor(w, null)).toEqual([]);
  });
  it("critical status names counterevidence, failed queries, uncertainty, open questions, omissions and unaccepted proposals", () => {
    const s = criticalStatus(wb());
    expect(s).toEqual(expect.arrayContaining(["Readiness: collecting", "Contract stale", "Counter records: 1", "Supporting records: 1", "Failed or partial queries: 1", "Coverage gaps: 0", "Absence claims assessable: 0 of 1", "Open case questions: 1", "Agent proposals: 0 (none accepted)", "Required records omitted: 1"]));
  });
});
