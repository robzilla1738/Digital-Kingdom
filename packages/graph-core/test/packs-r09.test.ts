import { describe, expect, it } from "vitest";
import { frontendAssessment, hostnameInventory, planOriginValidation, routesFromOpenApi, webhookAssessment } from "../src/packs/edge.ts";
import { lifetimes, nodeCoverage, queueRelations, workloadSlots } from "../src/packs/workload.ts";
import { checkInventoryMetadata, readsAnswer, recoveryState, tenantBoundaryCheck } from "../src/packs/data.ts";
import { attributeActor, coverageEffects, delegationTimeline, providerLimits } from "../src/packs/saas.ts";

/** R09.1-R09.4 sample-data provider packs, against each roadmap acceptance check. Fixture data only. */
describe("R09.1 edge/API/webhook pack", () => {
  it("a certificate hostname is not assumed owned", () => {
    const inv = hostnameInventory([{ serial: "01", sans: ["shop.example.com", "partner.example.net"], issuer: "R3", not_after: "2031-01-01T00:00:00Z" }],
      [{ hostname: "shop.example.com", method: "dns_txt", expected_token: "dk-verify=abc", observed_txt: ["dk-verify=abc"] }, { hostname: "partner.example.net", method: "dns_txt", expected_token: "dk-verify=x", observed_txt: ["other"] }]);
    expect(inv.find((h) => h.hostname === "shop.example.com")!.state).toBe("verified_owned");
    expect(inv.find((h) => h.hostname === "partner.example.net")).toMatchObject({ state: "discovered_lead", note: expect.stringMatching(/not assumed owned/) });
  });
  it("alternate origin validation only runs against authorized targets", () => {
    const now = new Date("2030-01-01T00:00:00Z");
    const p = planOriginValidation([{ hostname: "shop.example.com", candidate_origin: "198.51.100.7" }, { hostname: "shop.example.com", candidate_origin: "198.51.100.99" }], { origins: ["198.51.100.7"], authorized_by: "owner", expires_at: "2030-01-02T00:00:00Z" }, now);
    expect(p.map((x) => x.decision)).toEqual(["planned", "refused"]);
    expect(planOriginValidation([{ hostname: "a", candidate_origin: "198.51.100.7" }], { origins: ["198.51.100.7"], authorized_by: "o", expires_at: "2029-01-01T00:00:00Z" }, now)[0]!.decision).toBe("refused");
  });
  it("a route is scoped by method/service/environment", () => {
    const doc = { openapi: "3.1.0", paths: { "/orders/{id}": { get: { operationId: "getOrder", security: [{ bearer: [] }] }, delete: { security: [] } } } };
    const prod = routesFromOpenApi(doc, "orders-api", "prod"), stg = routesFromOpenApi(doc, "orders-api", "staging");
    expect(prod.map((r) => r.key)).toEqual(["prod/orders-api/DELETE /orders/{id}", "prod/orders-api/GET /orders/{id}"]);
    expect(stg[0]!.key).not.toBe(prod[0]!.key);
    expect(prod.find((r) => r.method === "DELETE")!.auth_declared).toBe(false);
    expect(() => routesFromOpenApi({ ...doc, openapi: "2.0" }, "s", "e")).toThrow(/not supported/);
  });
  it("frontend and webhook observations disclose blind spots", () => {
    const f = frontendAssessment({ page: "/checkout", scripts: [{ src: "https://cdn.example.org/a.js" }, { src: "/app.js" }], csp: null });
    expect(f.unpinned_third_party).toEqual(["https://cdn.example.org/a.js"]);
    expect(f.blind_spots.join(" ")).toMatch(/actually ran.*no content security policy/);
    const w = webhookAssessment({ endpoint: "/hooks/pay", provider: "payments", signature: null });
    expect(w.gaps.length).toBe(3);
    expect(w.blind_spots.join(" ")).toMatch(/handler enforces/);
  });
});

describe("R09.2 workload/queue/runtime pack", () => {
  it("pod/process-id reuse does not join different lifetimes", () => {
    const l = lifetimes([{ node: "n1", pid: 42, process_start: "2030-01-01T00:00:00Z", workload: "api", event: "exec", at: "2030-01-01T00:00:01Z" }, { node: "n1", pid: 42, process_start: "2030-01-01T05:00:00Z", workload: "worker", event: "connect", at: "2030-01-01T05:00:02Z" }]);
    expect(l).toHaveLength(2);
    expect(l.map((x) => x.workload)).toEqual(["api", "worker"]);
  });
  it("queue adjacency alone does not prove message lineage", () => {
    const r = queueRelations([{ queue: "orders", workload: "api", role: "producer", message_ids: ["m1"] }, { queue: "orders", workload: "billing", role: "consumer", message_ids: ["m9"] }, { queue: "orders", workload: "mailer", role: "consumer", message_ids: ["m1"] }]);
    expect(r.find((x) => x.consumer === "billing")!.relation).toBe("adjacent");
    expect(r.find((x) => x.consumer === "mailer")!.relation).toBe("lineage_observed");
  });
  it("missing node coverage is surfaced", () => { expect(nodeCoverage(["n1", "n2", "n3"], ["n1"]).missing).toEqual(["n2", "n3"]); });
  it("scale-up does not rearrange logical service locations", () => {
    const a = workloadSlots({}, [{ name: "api", replicas: 2 }, { name: "worker", replicas: 1 }]);
    const b = workloadSlots(a.slots, [{ name: "worker", replicas: 40 }, { name: "api", replicas: 9 }, { name: "cron", replicas: 1 }]);
    expect(b.slots).toEqual({ api: 0, worker: 1, cron: 2 });
  });
});

describe("R09.3 data/RAG/backup pack", () => {
  it("database audit absent is not no reads", () => {
    expect(readsAnswer({ from: "2030-01-01T00:00:00Z", to: "2030-01-02T00:00:00Z" }, { covered: [], reads: [] }).answer).toBe("unknown");
    const part = readsAnswer({ from: "2030-01-01T00:00:00Z", to: "2030-01-02T00:00:00Z" }, { covered: [{ from: "2030-01-01T00:00:00Z", to: "2030-01-01T12:00:00Z" }], reads: [] });
    expect(part).toMatchObject({ answer: "unknown", audit_gaps: [{ from: "2030-01-01T12:00:00.000Z", to: "2030-01-02T00:00:00.000Z" }] });
    expect(readsAnswer({ from: "2030-01-01T00:00:00Z", to: "2030-01-01T01:00:00Z" }, { covered: [{ from: "2030-01-01T00:00:00Z", to: "2030-01-01T02:00:00Z" }], reads: [] }).answer).toBe("no_reads_in_audited_interval");
  });
  it("cross-tenant synthetic retrieval is denied while own-tenant retrieval works", () => {
    const docs = [{ id: "d1", tenant: "t1", origin: "upload" }, { id: "d2", tenant: "t2", origin: "upload" }];
    expect(tenantBoundaryCheck(docs, { tenant: "t1", principal: "p", own_doc: "d1", foreign_doc: "d2" }).boundary).toBe("holds_for_probe");
    expect(tenantBoundaryCheck([{ ...docs[0]! }, { ...docs[1]!, tenant: "t1" }], { tenant: "t1", principal: "p", own_doc: "d1", foreign_doc: "d2" }).boundary).toBe("broken");
  });
  it("backup configuration success plus failed restore remains failed recovery", () => {
    expect(recoveryState({ configured: true, last_backup_ok: true, restore_tests: [{ at: "2030-01-01", ok: true }, { at: "2030-02-01", ok: false }] }).state).toBe("failed");
    expect(recoveryState({ configured: true, last_backup_ok: true, restore_tests: [] }).state).toBe("unverified");
  });
  it("no raw document, secret or customer row is required (or accepted) for baseline inventory", () => {
    expect(checkInventoryMetadata([{ ref: "db.customers", columns: 12, classification: "pii" }])).toEqual([]);
    expect(checkInventoryMetadata([{ ref: "kv/stripe", secret_value: "x" }, { ref: "t", rows: [] }])).toHaveLength(2);
  });
});

describe("R09.4 SaaS/endpoint pack", () => {
  it("a shared service account does not establish a particular human actor", () => {
    expect(attributeActor({ id: "ops@", kind: "shared", holders: ["a", "b"] })).toMatchObject({ human: null, confidence: expect.stringMatching(/no particular human/) });
  });
  it("provider permissions and licensing limitations are visible", () => {
    const l = providerLimits({ provider: "idp", plan: "basic", audit_retention_days: 7, data_access_logs: false, scopes_granted: ["audit.read"], scopes_needed: ["audit.read", "grants.read"] });
    expect(l.limits).toEqual(["audit history limited to 7 days on this plan", "this plan does not log data access: reads are invisible", "scope grants.read not granted: related events are not collected"]);
  });
  it("changing a delegated grant is separated from actual data access", () => {
    const t = delegationTimeline([{ at: "1", type: "grant_added", app: "crm-sync", scope: "mail.read", account: "a" }, { at: "2", type: "data_read", app: "crm-sync", account: "a", target: "mailbox:b" }], "crm-sync");
    expect(t.grant_changes).toHaveLength(1);
    expect(t.data_access).toEqual([{ at: "2", account: "a", target: "mailbox:b" }]);
  });
  it("feed installation and removal have coverage effects", () => {
    const e = coverageEffects([{ feed: "edr", at: "2030-01-01", op: "installed", asset_ids: ["laptop-1"] }, { feed: "edr", at: "2030-02-01", op: "removed", asset_ids: ["laptop-1"] }]);
    expect(e.map((x) => x.affected[0]!.covered_after)).toEqual([true, false]);
  });
});
