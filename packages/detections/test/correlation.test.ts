import { describe, expect, it } from "vitest";
import { evaluate, processDeliveries, RULESET_VERSION, validateNamespace, type SourceConfig } from "../src/index.ts";
import { stableId, type Finding, type Graph, type IngestEvent } from "@dk/contracts";
import { demoDeliveries, demoGraph, demoSources } from "../../../fixtures/testing/load.ts";

/**
 * R00.2 typed, namespaced correlation. Every negative case below linked (or corroborated) under
 * dk-rules-1.0.1; see docs/roadmap/R00-RECEIPT.md for the failing pre-fix run.
 */
const T0 = Date.parse("2026-10-20T14:00:00.000Z");
const t = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const SRC: SourceConfig[] = [
  { id: "idp-a", label: "Corporate IdP", kind: "app_auth", asset_ids: ["auth"], identity_namespace: "idp:corp" },
  { id: "idp-a2", label: "Corporate IdP (second region)", kind: "app_auth", asset_ids: ["auth"], identity_namespace: "idp:corp" },
  { id: "idp-b", label: "Legacy local accounts", kind: "app_auth", asset_ids: ["auth"] },
  { id: "idp-multi", label: "Corporate IdP, both apps", kind: "app_auth", asset_ids: ["auth", "api"], identity_namespace: "idp:corp" },
  { id: "app-ns", label: "App accepting IdP sessions", kind: "app_security", asset_ids: ["api"], identity_namespace: "idp:corp" },
  { id: "app-plain", label: "App with its own sessions", kind: "app_security", asset_ids: ["api"] },
  { id: "agent-a", label: "Runtime A wrapper", kind: "agent_observer", asset_ids: ["agent", "tools"], run_namespace: "runtime:a" },
  { id: "agent-b", label: "Unrelated runtime B wrapper", kind: "agent_observer", asset_ids: ["agent", "tools"] },
  { id: "obs-a", label: "Observer receiving runtime A run ids", kind: "effect_observer", asset_ids: ["tools", "blob"], run_namespace: "runtime:a" },
];
let seq = 0;
const ev = (source_id: string, sec: number, p: Partial<IngestEvent>) => ({
  source_id, received_at: t(sec + 1),
  payload: { source_event_id: `c-${++seq}`, occurred_at: t(sec), asset_ids: ["auth"], action: "authentication", outcome: "failure", ...p },
});
const run = (deliveries: ReturnType<typeof ev>[], g: Graph = demoGraph()) => {
  const p = processDeliveries(g, SRC, deliveries);
  expect(p.stats.rejections).toEqual([]);
  return { ...p, ...evaluate(g, p.events, { sources: SRC }) };
};
const fails = (source: string, ref: Partial<IngestEvent>, n = 5, asset = "auth") =>
  Array.from({ length: n }, (_, i) => ev(source, i * 10, { asset_ids: [asset], ...ref }));
const authFinding = (r: { findings: Finding[] }) => r.findings.filter((f) => f.kind === "repeated_auth_failure");
const idOf = (r: { events: { id: string; source_id: string; outcome: string }[] }, source: string, outcome = "success") => r.events.find((e) => e.source_id === source && e.outcome === outcome)!.id;

describe("R00.2 authentication correlation is typed and namespaced", () => {
  it("two sources using actor_ref=admin do not link without an explicit common issuer", () => {
    const r = run([...fails("idp-b", { actor_ref: "admin" }), ev("idp-a", 80, { outcome: "success", actor_ref: "admin" })]);
    const [f] = authFinding(r);
    expect(f!.event_ids).not.toContain(idOf(r, "idp-a"));
    expect(f!.outcome_state).toBe("attempted");
    expect(f!.severity).toBe("low");
    expect(f!.not_claimed.join(" ")).toMatch(/different identity namespace/);
  });
  it("actor_ref X does not match session_ref X", () => {
    const r = run([...fails("idp-a", { actor_ref: "X-1" }), ev("idp-a", 80, { outcome: "success", actor_ref: "someone-else", session_ref: "X-1" })]);
    const [f] = authFinding(r);
    expect(f!.event_ids).not.toContain(idOf(r, "idp-a"));
    expect(f!.outcome_state).toBe("attempted");
  });
  it("a success on a different asset is not linked to failures at this asset", () => {
    const r = run([...fails("idp-multi", { actor_ref: "acct-1" }), ev("idp-multi", 80, { asset_ids: ["api"], outcome: "success", actor_ref: "acct-1" })]);
    const [f] = authFinding(r);
    expect(f!.event_ids).not.toContain(idOf(r, "idp-multi"));
    expect(f!.outcome_state).toBe("attempted");
  });
  it("failures from two authorities with the same text are separate groups, not one principal", () => {
    // 3 + 3 failures: neither authority reaches the threshold of 5, so no merged finding appears.
    const r = run([...fails("idp-a", { actor_ref: "admin" }, 3), ...fails("idp-b", { actor_ref: "admin" }, 3)]);
    expect(authFinding(r)).toHaveLength(0);
  });
  it("positive control: same source, same identifier, same asset still links", () => {
    const r = run([...fails("idp-a", { actor_ref: "acct-ops" }), ev("idp-a", 80, { outcome: "success", actor_ref: "acct-ops" })]);
    const [f] = authFinding(r);
    expect(f!.event_ids).toContain(idOf(r, "idp-a"));
    expect(f!.outcome_state).toBe("needs_review");
  });
  it("positive control: two sources that declare the same issuer still link", () => {
    const r = run([...fails("idp-a", { actor_ref: "acct-ops" }), ev("idp-a2", 80, { outcome: "success", actor_ref: "acct-ops" })]);
    const [f] = authFinding(r);
    expect(f!.event_ids).toContain(idOf(r, "idp-a2"));
    expect(f!.outcome_state).toBe("needs_review");
  });
  it("a single-authority finding keeps its dk-rules-1.0.x id; a colliding authority gets its own id", () => {
    const legacy = stableId("f", "auth.repeated_failure", "authfail:auth|actor:admin");
    expect(authFinding(run(fails("idp-b", { actor_ref: "admin" }))).map((f) => f.id)).toEqual([legacy]);
    const r = run([...fails("idp-a", { actor_ref: "admin" }), ...fails("idp-b", { actor_ref: "admin" })]);
    const ids = authFinding(r).map((f) => f.id).sort();
    expect(ids).toHaveLength(2);
    // deterministic: the lexicographically first namespace keeps the legacy id
    expect(ids).toContain(legacy);
    expect(ids).toContain(stableId("f", "auth.repeated_failure", "authfail:auth|actor:admin|ns:source:idp-b"));
    for (const f of authFinding(r)) expect(f.rule_version).toBe(`${RULESET_VERSION}/2`);
  });
});

describe("R00.2 privilege-change linkage", () => {
  it("a session string from an application with its own sessions does not link to an IdP sign-in", () => {
    const r = run([ev("idp-a", 0, { outcome: "success", actor_ref: "acct-1", session_ref: "sess-1" }),
      ev("app-plain", 30, { asset_ids: ["api"], action: "authorization_change", outcome: "success", actor_ref: "acct-1", session_ref: "sess-1" })]);
    const f = r.findings.find((x) => x.kind === "sensitive_privilege_change")!;
    expect(f.event_ids).toHaveLength(1);
    expect(f.coverage_gaps.join(" ")).toMatch(/No trusted identifier/);
    expect(f.not_claimed.join(" ")).toMatch(/not linked/);
  });
  it("a sign-in whose actor_ref equals the change's session_ref is not linked", () => {
    const r = run([ev("idp-a", 0, { outcome: "success", actor_ref: "sess-9" }),
      ev("app-ns", 30, { asset_ids: ["api"], action: "authorization_change", outcome: "success", session_ref: "sess-9" })]);
    expect(r.findings.find((x) => x.kind === "sensitive_privilege_change")!.event_ids).toHaveLength(1);
  });
  it("positive control: an application that declares the IdP's namespace links across sources and assets", () => {
    const r = run([ev("idp-a", 0, { outcome: "success", actor_ref: "acct-1", session_ref: "sess-1" }),
      ev("app-ns", 30, { asset_ids: ["api"], action: "authorization_change", outcome: "success", actor_ref: "acct-1", session_ref: "sess-1" })]);
    const f = r.findings.find((x) => x.kind === "sensitive_privilege_change")!;
    expect(f.event_ids).toContain(idOf(r, "idp-a"));
    expect(f.coverage_gaps).toEqual([]);
  });
});

describe("R00.2 agent run correlation", () => {
  const call = (src: string) => ev(src, 0, { asset_ids: ["tools"], action: "tool_invocation", outcome: "success", run_id: "run-1" });
  const effect = ev("obs-a", 5, { asset_ids: ["tools"], action: "side_effect_observed", outcome: "observed", run_id: "run-1" });
  it("equal run_id strings from unrelated runtimes do not corroborate an effect", () => {
    const r = run([call("agent-b"), effect]);
    const f = r.findings.find((x) => x.kind === "agent_effect_observed")!;
    expect(f.evidence_level).toBe("source_reported");
    expect(f.event_ids).toEqual([idOf(r, "obs-a", "observed")]);
    // and the mismatch is not escalated into a claimed wrapper bypass either
    expect(f.severity).toBe("medium");
    expect(f.coverage_gaps.join(" ")).toMatch(/no common run namespace/);
  });
  it("positive control: an independent observer in the runtime's declared namespace corroborates", () => {
    const r = run([call("agent-a"), effect]);
    const f = r.findings.find((x) => x.kind === "agent_effect_observed")!;
    expect(f.evidence_level).toBe("corroborated");
    expect(f.severity).toBe("low");
    expect(f.id).toBe(stableId("f", "agent.effect_observed", "agenteffect:run-1"));
  });
  it("an effect with no tool call anywhere is still flagged as a possible wrapper bypass", () => {
    const r = run([effect]);
    const f = r.findings.find((x) => x.kind === "agent_effect_observed")!;
    expect(f.severity).toBe("high");
  });
});

describe("R00.2 demo and namespace declarations", () => {
  it("the synthetic demo keeps its declared same-authority links", () => {
    const g = demoGraph(); const sources = demoSources();
    const p = processDeliveries(g, sources, demoDeliveries());
    const r = evaluate(g, p.events, { sources });
    const priv = r.findings.find((f) => f.kind === "sensitive_privilege_change")!;
    expect(priv.event_ids).toHaveLength(2);
    const auth = r.findings.find((f) => f.kind === "repeated_auth_failure")!;
    expect(auth.outcome_state).toBe("needs_review");
    expect(r.findings.find((f) => f.kind === "agent_effect_observed")!.evidence_level).toBe("corroborated");
  });
  it("the same demo with namespaces removed links nothing across sources", () => {
    const g = demoGraph(); const sources = demoSources().map(({ identity_namespace: _i, run_namespace: _r, ...s }) => s);
    const p = processDeliveries(g, sources, demoDeliveries());
    const r = evaluate(g, p.events, { sources });
    expect(r.findings.find((f) => f.kind === "sensitive_privilege_change")!.event_ids).toHaveLength(1);
    expect(r.findings.find((f) => f.kind === "agent_effect_observed")!.evidence_level).toBe("source_reported");
  });
  it("validates administrator namespaces and reserves the per-source prefix", () => {
    expect(validateNamespace(undefined)).toBeNull();
    expect(validateNamespace("idp:okta-prod")).toBeNull();
    expect(validateNamespace("source:idp-a")).toMatch(/reserved/);
    expect(validateNamespace("bad namespace")).toMatch(/namespace must/);
    expect(validateNamespace("x".repeat(97))).toMatch(/namespace must/);
    expect(validateNamespace(42)).toMatch(/namespace must/);
  });
});
