import { describe, expect, it } from "vitest";
import { evaluate, normalizeIngest, normalizeRoute, processDeliveries, redactValue, stateAt, type SourceConfig } from "../src/index.ts";
import { GraphIndex } from "@dk/graph-core";
import type { Graph, IngestEvent, SecurityEvent } from "@dk/contracts";
import { demoDeliveries, demoGraph, demoSources } from "../../../fixtures/testing/load.ts";

const T0 = Date.parse("2026-10-20T14:00:00Z");
const t = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const SRC: SourceConfig[] = [
  { id: "edge-src", label: "Edge", asset_ids: ["edge"], trusts_request_ids: true },
  { id: "auth-src", label: "Auth", asset_ids: ["auth"], trusts_request_ids: true },
  { id: "app-src", label: "App", asset_ids: ["api"], trusts_request_ids: false },
  { id: "observer", label: "Observer", asset_ids: ["blob", "tools"], trusts_request_ids: true },
  { id: "agent-src", label: "Agent wrapper", asset_ids: ["agent", "tools"], trusts_request_ids: true },
  { id: "db-audit", label: "DB audit", asset_ids: ["db"] },
];
let seq = 0;
const ev = (source_id: string, sec: number, p: Partial<IngestEvent>, recvDelaySec = 1) => ({
  source_id, received_at: t(sec + recvDelaySec),
  payload: { source_event_id: p.source_event_id ?? `n-${++seq}`, occurred_at: t(sec), asset_ids: ["edge"], action: "request_received", outcome: "allowed", ...p },
});
const run = (deliveries: ReturnType<typeof ev>[], g: Graph = demoGraph()) => {
  const p = processDeliveries(g, SRC, deliveries);
  return { ...p, ...evaluate(g, p.events, { sources: SRC }) };
};
const kinds = (r: { findings: { kind: string }[] }) => r.findings.map((f) => f.kind).sort();

describe("evidence and correlation acceptance (A)", () => {
  it("E01: the same event delivered three times is one record and one finding", () => {
    const d = ev("edge-src", 0, { source_event_id: "w-1", action: "waf_match", outcome: "blocked", rule_ref: "r1" });
    const r = run([d, { ...d, received_at: t(5) }, { ...d, received_at: t(9) }]);
    expect(r.stats.accepted).toBe(1);
    expect(r.stats.duplicates).toBe(2);
    expect(r.findings.filter((f) => f.kind === "blocked_request_reported")).toHaveLength(1);
    expect(r.findings[0]!.event_count).toBe(1);
  });
  it("E02: identical coarse fields with distinct source ids stay distinct", () => {
    const r = run([ev("edge-src", 0, { source_event_id: "a" }), ev("edge-src", 0, { source_event_id: "b" })]);
    expect(r.events).toHaveLength(2);
  });
  it("E03: failures then an unrelated success from a shared NAT are not linked by IP", () => {
    const fails = Array.from({ length: 5 }, (_, i) => ev("auth-src", i * 10, { asset_ids: ["auth"], action: "authentication", outcome: "failure", actor_ref: "acct-x", client_ip: "198.51.100.1" }));
    const other = ev("auth-src", 70, { asset_ids: ["auth"], action: "authentication", outcome: "success", actor_ref: "acct-y", client_ip: "198.51.100.1" });
    const r = run([...fails, other]);
    const f = r.findings.find((x) => x.kind === "repeated_auth_failure")!;
    const otherId = r.events.find((e) => e.actor_ref === "acct-y")!.id;
    expect(f.event_ids).not.toContain(otherId);
    expect(f.outcome_state).toBe("attempted");
    expect(f.not_claimed.join(" ")).toMatch(/weak association/);
  });
  it("E03b: failures keyed only by IP never produce a correlated finding", () => {
    const fails = Array.from({ length: 8 }, (_, i) => ev("auth-src", i * 5, { asset_ids: ["auth"], action: "authentication", outcome: "failure", client_ip: "198.51.100.1" }));
    expect(kinds(run(fails))).not.toContain("repeated_auth_failure");
  });
  it("E04: a request id from an untrusting source is untrusted and never used to link sources", () => {
    const forged = ev("app-src", 0, { asset_ids: ["api"], action: "request_received", outcome: "blocked", request_id: "req-forged" });
    const effect = ev("observer", 2, { asset_ids: ["blob"], action: "side_effect_observed", outcome: "observed", request_id: "req-forged" });
    const r = run([forged, effect]);
    expect(r.events.find((e) => e.source_id === "app-src")!.request_id_trust).toBe("untrusted");
    expect(kinds(r)).not.toContain("source_contradiction");
  });
  it("E05: a WAF block is labeled a blocked attempt, not compromise", () => {
    const r = run([ev("edge-src", 0, { action: "waf_match", outcome: "blocked", rule_ref: "942100" })]);
    const f = r.findings[0]!;
    expect(f.outcome_state).toBe("blocked");
    expect(f.evidence_level).toBe("source_reported");
    expect(f.not_claimed.join(" ")).toMatch(/not a compromise/);
  });
  it("E06: a successful HTTP response with no effect telemetry produces no exploit claim", () => {
    const r = run([ev("edge-src", 0, { action: "request_received", outcome: "allowed", route: "/search?q=%27%20OR%201=1" })]);
    expect(r.findings).toEqual([]);
  });
  it("E07: a missing audit permission is an explicit not-assessed gap", () => {
    const r = run([ev("db-audit", 0, { asset_ids: ["db"], action: "sensor_unavailable", outcome: "unknown", coverage_note: "permission denied" })]);
    const f = r.findings.find((x) => x.kind === "coverage_loss")!;
    expect(f.evidence_level).toBe("not_assessed");
    expect(r.coverage.find((c) => c.source_id === "db-audit")!.state).toBe("offline");
  });
  it("E07b: assets with no declared telemetry are unobserved, not safe", () => {
    const r = run([]);
    expect(r.unobserved_asset_ids).toEqual(expect.arrayContaining(["ci", "stripe", "web"]));
    expect(r.coverage.every((c) => c.state === "not_assessed")).toBe(true);
  });
  it("E08: blocked at the edge but an independent observer saw the effect -> contradiction with both references", () => {
    const r = run([
      ev("edge-src", 0, { action: "waf_match", outcome: "blocked", request_id: "req-9", rule_ref: "930100" }),
      ev("observer", 1, { asset_ids: ["blob"], action: "side_effect_observed", outcome: "observed", request_id: "req-9" }),
    ]);
    const c = r.findings.find((f) => f.kind === "source_contradiction")!;
    expect(c.evidence_level).toBe("contradicted");
    expect(c.event_ids).toHaveLength(1);
    expect(c.counterevidence_event_ids).toHaveLength(1);
    const b = r.findings.find((f) => f.kind === "blocked_request_reported")!;
    expect(b.evidence_level).toBe("contradicted");
    expect(b.outcome_state).toBe("needs_review");
  });
  it("E09: a delayed event revises a finding and its receive time is preserved", () => {
    const early = ev("edge-src", 0, { action: "waf_match", outcome: "blocked", rule_ref: "r" });
    const late = ev("edge-src", 5, { action: "waf_match", outcome: "blocked", rule_ref: "r" }, 600);
    const before = run([early]).findings[0]!;
    const after = run([early, late]);
    expect(after.findings[0]!.id).toBe(before.id);
    expect(after.findings[0]!.event_count).toBe(2);
    expect(after.findings[0]!.last_received).toBe(t(605));
    const known = stateAt(demoGraph(), after.events, t(30), "known", { sources: SRC });
    expect(known.findings[0]!.event_count).toBe(1); // as known at the time
    const occurred = stateAt(demoGraph(), after.events, t(30), "occurred", { sources: SRC });
    expect(occurred.findings[0]!.event_count).toBe(2);
    expect(occurred.late_event_ids).toHaveLength(1);
  });
  it("E12: a decoy use confirms the token event without identity or entry-point claims", () => {
    const r = run([ev("agent-src", 0, { asset_ids: ["agent"], action: "decoy_used", outcome: "success", rule_ref: "canary-1" })]);
    const f = r.findings.find((x) => x.kind === "decoy_credential_used")!;
    expect(f.not_claimed.join(" ")).toMatch(/not identified/);
    expect(f.coverage_gaps.join(" ")).toMatch(/entry point/);
  });
  it("findings are deterministic and idempotent across re-evaluation", () => {
    const p = processDeliveries(demoGraph(), demoSources(), demoDeliveries());
    const a = evaluate(demoGraph(), p.events, { sources: demoSources() });
    const b = evaluate(demoGraph(), [...p.events].reverse(), { sources: demoSources() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("agent evidence (TK-031)", () => {
  it("separates model refusal, enforcement denial, and observed effect", () => {
    const r = run([
      ev("agent-src", 0, { asset_ids: ["agent"], action: "tool_invocation", outcome: "refused", run_id: "r1" }),
      ev("agent-src", 1, { asset_ids: ["tools"], action: "tool_invocation", outcome: "denied", run_id: "r1" }),
      ev("agent-src", 2, { asset_ids: ["tools"], action: "tool_invocation", outcome: "success", run_id: "r1" }),
      ev("observer", 3, { asset_ids: ["tools"], action: "side_effect_observed", outcome: "observed", run_id: "r1" }),
    ]);
    const denied = r.findings.find((f) => f.kind === "agent_action_denied")!;
    expect(denied.outcome_state).toBe("blocked");
    expect(denied.claim).toMatch(/refusal, not enforcement/);
    const eff = r.findings.find((f) => f.kind === "agent_effect_observed")!;
    expect(eff.evidence_level).toBe("corroborated");
  });
  it("a refusal alone is not an enforcement finding", () => {
    const r = run([ev("agent-src", 0, { asset_ids: ["agent"], action: "tool_invocation", outcome: "refused", run_id: "r2" })]);
    expect(r.findings).toEqual([]);
  });
  it("an effect with no reported tool call flags a possible bypass", () => {
    const r = run([ev("observer", 0, { asset_ids: ["tools"], action: "side_effect_observed", outcome: "observed", run_id: "r3" })]);
    expect(r.findings[0]!.coverage_gaps.join(" ")).toMatch(/bypass/);
  });
});

describe("ingestion safety", () => {
  const ctx = { projectId: "demo-castle", sourceId: "s", datasetKind: "synthetic" as const, receivedAt: t(0), trustsRequestIds: true, index: new GraphIndex(demoGraph()) };
  const base = { source_event_id: "x", occurred_at: t(0), asset_ids: ["api"], action: "request_received", outcome: "success" };
  it("S03: a source asserting another project is rejected", () => {
    const r = normalizeIngest({ ...base, project_id: "other" }, ctx);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("project_mismatch");
  });
  it("S08: bearer tokens, passwords and cookies are not stored", () => {
    const r = normalizeIngest({ ...base, evidence: { headers: { Authorization: "Bearer abcdefghijklmnop", Cookie: "sid=1" }, password: "p", note: "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlc2ln here" }, attributes: { api_key: "k", ok: "yes" } }, ctx);
    expect(r.ok).toBe(true);
    const s = JSON.stringify(r);
    expect(s).not.toMatch(/abcdefghijklmnop|sid=1|"p"|eyJhbGci/);
    expect(s).toContain("[redacted]");
  });
  it("S04: hostile labels are kept as inert text (rendered escaped by the UI)", () => {
    const r = normalizeIngest({ ...base, coverage_note: "<script>alert(1)</script>" }, ctx);
    expect(r.ok && r.event.coverage_note).toBe("<script>alert(1)</script>");
  });
  it("S07: deep nesting and oversized collections are truncated", () => {
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 30; i++) deep = { d: deep };
    const out = JSON.stringify(redactValue({ deep, arr: Array(500).fill(1) }));
    expect(out).toContain("nesting limit");
    expect(out.length).toBeLessThan(2000);
  });
  it("routes are normalized and query strings dropped", () => {
    expect(normalizeRoute("https://x.test/orders/123/items/9f8e7d6c-1234-4abc-8def-0123456789ab?token=abc")).toBe("/orders/:id/items/:id");
  });
  it("unknown assets are rejected and counted, not guessed", () => {
    const r = normalizeIngest({ ...base, asset_ids: ["ghost"] }, ctx);
    expect(!r.ok && r.reason).toBe("unmapped_asset");
  });
});

describe("demo corpus expected outcomes (TK-005)", () => {
  const p = processDeliveries(demoGraph(), demoSources(), demoDeliveries());
  const r = evaluate(demoGraph(), p.events, { sources: demoSources() });
  it("pipeline counts duplicates and rejections separately", () => {
    expect(p.stats.duplicates).toBe(1);
    expect(p.stats.rejected).toEqual({ project_mismatch: 1, unmapped_asset: 1 });
  });
  it("produces the expected finding set", () => {
    expect(kinds(r)).toEqual([
      "agent_action_denied", "agent_effect_observed", "blocked_request_reported", "blocked_request_reported", "coverage_loss",
      "decoy_credential_used", "repeated_auth_failure", "runtime_alert_reported", "sensitive_privilege_change", "source_contradiction",
    ]);
  });
  it("every finding resolves to recorded events", () => {
    const ids = new Set(p.events.map((e: SecurityEvent) => e.id));
    for (const f of r.findings) { expect(f.event_ids.length).toBeGreaterThan(0); for (const id of [...f.event_ids, ...f.counterevidence_event_ids]) expect(ids.has(id)).toBe(true); }
  });
});
