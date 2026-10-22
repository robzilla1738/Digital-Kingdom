import { describe, expect, it } from "vitest";
import type { Finding, SecurityEvent } from "@dk/contracts";
import { loadOfflineDemo } from "./data.ts";
import { EVENT_FILTERS, eventMatches, eventSearchParams, evidenceSummary, filterGuidance, isAccessDenied, mergeEventPages, offlineEventDetail, safeReferenceUrl, searchOfflineEvents, validateEventQuery, type EventSearchInput, type FindingEvidenceResult } from "./investigation.ts";

const query = (filters: EventSearchInput["filters"] = {}): EventSearchInput => ({ after: "2026-10-01T00:00:00Z", before: "2026-10-02T00:00:00Z", filters });
const event = (id: string, patch: Partial<SecurityEvent> = {}): SecurityEvent => ({ id, project_id: "p", source_id: "s", source_event_id: id, schema_version: "0.2", dataset_kind: "synthetic", asset_ids: ["a"], action: "data_access", outcome: "success", occurred_at: "2026-10-01T12:00:00Z", received_at: "2026-10-01T12:00:01Z", evidence_refs: [], ...patch });
const finding = (patch: Partial<Finding> = {}): Finding => ({ id: "f", title: "Recorded claim", kind: "source_contradiction", claim: "Sources disagree", lifecycle: "open", disposition: "unreviewed", evidence_level: "contradicted", outcome_state: "needs_review", severity: "high", affected_asset_ids: ["a"], event_ids: ["first"], counterevidence_event_ids: ["second"], evidence_refs: [], coverage_gaps: [], not_claimed: [], next_steps: [], rule_id: "rule", rule_version: "1", first_seen: "2026-10-01T12:00:00Z", last_seen: "2026-10-01T12:00:00Z", last_received: "2026-10-01T12:00:01Z", event_count: 2, revision: 1, dataset_kind: "synthetic", ...patch });

describe("bounded exact event-query adapter", () => {
  it("mirrors fixed supported fields, bounds and page sizes, with explicit timezone", () => {
    expect(Object.keys(EVENT_FILTERS)).toEqual(["asset_id", "source_id", "action", "outcome", "actor_ref", "session_ref", "run_id", "request_id", "trace_id", "client_ip", "route", "rule_ref"]);
    expect(validateEventQuery(query())).toEqual([]);
    expect(validateEventQuery({ ...query(), before: "2026-11-01T00:00:00Z", limit: 100 })).toEqual([]);
    expect(validateEventQuery({ ...query(), before: "2026-11-01T00:00:01Z" }).join()).toContain("31 days");
    expect(validateEventQuery({ ...query(), before: query().after }).join()).toContain("later than start");
    expect(validateEventQuery({ ...query(), after: "2026-10-01T00:00:00" }).join()).toContain("timezone");
    expect(validateEventQuery({ ...query(), limit: 101 }).join()).toContain("1 to 100");
  });
  it("never offers or forwards arbitrary operators or unsupported fields", () => {
    expect(() => eventSearchParams(query({ regex: ".*" } as never))).toThrow("unsupported filter");
    expect(validateEventQuery(query({ action: "drop table events" })).join()).toContain("supported exact value");
    expect(validateEventQuery(query({ actor_ref: "a".repeat(201) })).join()).toContain("200 characters");
  });
  it("normalizes UTC while preserving exact filter text and opaque cursor bytes", () => {
    const input = { ...query({ actor_ref: " <img src=x> ", route: "/orders/:id" }), after: "2026-10-01T02:00:00+02:00", cursor: "signed.opaque=not-for-decoding/+" };
    const params = eventSearchParams(input);
    expect(params.get("after")).toBe("2026-10-01T00:00:00.000Z");
    expect(params.get("actor_ref")).toBe(" <img src=x> "); expect(params.get("cursor")).toBe(input.cursor); expect(params.get("limit")).toBe("50");
    expect(input.after).toBe("2026-10-01T02:00:00+02:00");
  });
  it("matches exact asset/source/action/outcome and never promotes a network locator to identity", () => {
    const e = event("e", { client_ip: "198.51.100.9", actor_ref: "alice", session_ref: "session-a" });
    expect(eventMatches(e, query({ asset_id: "a", source_id: "s", action: "data_access", outcome: "success" }))).toBe(true);
    expect(eventMatches(e, query({ actor_ref: "ali" }))).toBe(false);
    expect(eventMatches(e, query({ source_id: "other" }))).toBe(false);
    expect(eventMatches(e, query({ client_ip: "198.51.100.9", actor_ref: "bob" }))).toBe(false);
    expect(filterGuidance("client_ip")).toMatch(/not identity/); expect(filterGuidance("session_ref")).toMatch(/Source-local/);
  });
  it("deduplicates pages without reordering or changing already loaded records", () => {
    const first = event("1"), second = event("2");
    const result = mergeEventPages([first], [event("1", { outcome: "blocked" }), second, second]);
    expect(result.map((e) => e.id)).toEqual(["1", "2"]); expect(result[0]).toBe(first); expect(first.outcome).toBe("success");
  });
});

describe("finding evidence completeness is not source coverage", () => {
  it("deduplicates shared supporting/counter references and requires both evidence sides", () => {
    const f = finding({ event_ids: ["first", "second"], counterevidence_event_ids: ["second"] });
    const summary = evidenceSummary(f, [event("first"), event("second")], {}, null);
    expect(summary).toMatchObject({ expected: 2, loaded: 2, complete: true });
    expect(evidenceSummary(f, [event("first")], {}, null)).toMatchObject({ loaded: 1, complete: false, missingEvents: ["second"] });
  });
  it("preserves missing stored references but does not mistake source-native references for missing payloads", () => {
    const e = event("first", { evidence_refs: ["evidence:first", "native:123"] });
    const summary = evidenceSummary(finding({ counterevidence_event_ids: [] }), [e], {}, null);
    expect(summary.missingEvidence).toEqual(["evidence:first"]); expect(summary.complete).toBe(false);
    expect(evidenceSummary(finding({ counterevidence_event_ids: [] }), [e], { "evidence:first": { redacted: true } }, null).complete).toBe(true);
  });
  it("a page failure or revision change keeps loaded records but cannot be complete", () => {
    const full: FindingEvidenceResult = { events: [event("first")], evidence: {}, expected: 2, missingEvents: [], missingEvidence: [], complete: false, error: "Page 2 failed" };
    const summary = evidenceSummary(finding(), full.events, full.evidence, full);
    expect(summary).toMatchObject({ loaded: 1, expected: 2, complete: false }); expect(full.events).toHaveLength(1);
    expect(evidenceSummary(finding(), [event("first"), event("second")], {}, { ...full, complete: true, error: undefined, revisionChanged: true }).complete).toBe(false);
    expect(evidenceSummary(finding(), [event("first"), event("second")], {}, null, true).complete).toBe(false);
  });
  it("distinguishes authorization loss from ordinary retriable network failure", () => {
    expect(isAccessDenied({ status: 401 })).toBe(true); expect(isAccessDenied({ status: 403 })).toBe(true);
    expect(isAccessDenied({ status: 503 })).toBe(false); expect(isAccessDenied(new Error("offline"))).toBe(false);
  });
});

describe("explicit synthetic-only investigation", () => {
  it("cannot become a live-data fallback", () => {
    const demo = loadOfflineDemo();
    expect(() => searchOfflineEvents({ ...demo, mode: "server" }, query())).toThrow("only for the bundled synthetic demo");
    expect(offlineEventDetail({ ...demo, mode: "server" }, demo.events[0]!.id)).toBeNull();
  });
  it("provides exact local results, pagination and explicit current/historical coverage separation", () => {
    const demo = loadOfflineDemo(); const q = { after: demo.window.start, before: demo.window.end, filters: {}, limit: 2 };
    const first = searchOfflineEvents(demo, q), next = searchOfflineEvents(demo, q, 2);
    expect(first.events).toHaveLength(2); expect(next.events).toHaveLength(2); expect(first.events[0]?.id).not.toBe(next.events[0]?.id);
    expect(first.page.next_cursor).toBeNull(); // No fabricated server cursor in offline mode.
    expect(first.source_coverage.historical_coverage_assessed).toBe(false); expect(first.source_coverage.coverage_basis).toBe("current_state");
    expect(first.limits.join()).toContain("bundled in-memory");
    expect(first.query_completeness.matching_in_snapshot).toBe(demo.events.length);
  });
  it("can inspect an event with no finding and distinguishes normalized-only from missing evidence", () => {
    const demo = loadOfflineDemo(), e = event("unlinked", { project_id: demo.project.id });
    const data = { ...demo, events: [...demo.events, e] };
    const detail = offlineEventDetail(data, e.id)!;
    expect(detail.referenced_by_findings).toEqual([]); expect(detail.evidence_completeness).toMatchObject({ expected_records: 0, complete: true });
    e.evidence_refs = ["evidence:missing", "source:native"];
    expect(offlineEventDetail(data, e.id)?.evidence_completeness).toMatchObject({ complete: false, missing_evidence_refs: ["evidence:missing"], reference_only_refs: ["source:native"] });
  });
});

describe("reference privacy", () => {
  it("copies only allowlisted project/object/navigation fields, never the current sensitive URL", () => {
    const value = safeReferenceUrl("https://console.example.test/console?token=secret&actor_ref=alice#client_ip=198.51.100.9&cursor=signed-secret", "authorized-project", { workspace: "investigate", view: "graph", selection: { kind: "event", id: "event-1" }, playhead: null, basis: "occurred", investigateTab: "events" });
    const url = new URL(value); expect([...url.searchParams.keys()]).toEqual(["project"]);
    expect(url.hash).toContain("tab=events"); expect(value).not.toContain("secret"); expect(value).not.toContain("alice"); expect(value).not.toContain("198.51.100.9"); expect(value).not.toContain("cursor");
  });
});
