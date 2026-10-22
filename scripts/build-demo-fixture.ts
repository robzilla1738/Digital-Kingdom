/**
 * Generates fixtures/demo/* — the synthetic "Castle Gate" incident used by the offline demo, the server
 * seed, and tests. Everything here is SYNTHETIC. No real infrastructure, people, or credentials.
 * Run: pnpm tsx scripts/build-demo-fixture.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import type { Graph, IngestEvent } from "../packages/contracts/src/index.ts";

const OUT = new URL("../fixtures/demo/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const BASE = Date.parse("2026-10-20T14:00:00.000Z");
const at = (min: number, sec = 0) => new Date(BASE + min * 60_000 + sec * 1000).toISOString();
const inv = ["fixture:inventory-manifest"];

const A = (id: string, name: string, kind: Graph["assets"][number]["kind"], zone: Graph["assets"][number]["allowed_zone_ids"][number], extra: Partial<Graph["assets"][number]> = {}) =>
  ({ id, name, kind, environment: "demo", allowed_zone_ids: [zone], source_refs: inv, lifecycle: "active" as const, ...extra });

const graph: Graph = {
  schema_version: "0.2", dataset_kind: "synthetic", project_id: "demo-castle", graph_revision: "demo-r3", created_at: at(-600),
  assets: [
    A("edge", "public-edge", "edge", "public", { owner: "platform-team", secondary_label: "The Gatehouse", aliases: ["nginx-edge"] }),
    A("auth", "identity-service", "auth", "application", { owner: "identity-team", secondary_label: "Guardhouse", sensitivity: "confidential" }),
    A("web", "storefront-web", "service", "application", { owner: "web-team", instance_count: 6 }),
    A("api", "orders-api", "service", "application", { owner: "orders-team", instance_count: 12, deployment: "orders-api@2026.10.19-3" }),
    A("pay", "payments-api", "service", "application", { owner: "payments-team", sensitivity: "restricted", instance_count: 4 }),
    A("worker", "order-worker", "worker", "application", { owner: "orders-team", instance_count: 240, aliases: ["order-worker-consumer"] }),
    A("sched", "nightly-scheduler", "worker", "application", { owner: "platform-team" }),
    A("db", "orders-db", "database", "data", { owner: "data-team", sensitivity: "restricted", secondary_label: "The Vault" }),
    A("blob", "receipts-bucket", "storage", "data", { owner: "data-team", sensitivity: "confidential" }),
    A("agent", "support-agent", "agent", "automation", { owner: "support-eng", secondary_label: "Observatory" }),
    A("tools", "support-tools-mcp", "tool_server", "automation", { owner: "support-eng" }),
    A("ci", "release-pipeline", "pipeline", "delivery", { owner: "platform-team", secondary_label: "Forge" }),
    A("stripe", "payment-processor", "third_party", "external", { owner: "vendor (external)" }),
  ],
  relationships: [],
};
const R = (id: string, s: string, t: string, kind: Graph["relationships"][number]["kind"], level: Graph["relationships"][number]["evidence_level"] = "declared", assumptions?: string) =>
  graph.relationships.push({ id, source_id: s, target_id: t, kind, evidence_level: level, evidence_refs: inv, ...(assumptions ? { assumptions } : {}) });
R("rel-edge-web", "edge", "web", "calls"); R("rel-edge-api", "edge", "api", "calls"); R("rel-edge-auth", "edge", "auth", "calls");
R("rel-web-api", "web", "api", "calls", "observed"); R("rel-api-auth", "api", "auth", "calls", "observed"); R("rel-api-pay", "api", "pay", "calls");
R("rel-pay-stripe", "pay", "stripe", "calls"); R("rel-api-db", "api", "db", "reads_from"); R("rel-api-worker", "api", "worker", "calls");
R("rel-worker-db", "worker", "db", "writes_to"); R("rel-worker-blob", "worker", "blob", "writes_to"); R("rel-sched-worker", "sched", "worker", "calls");
R("rel-agent-tools", "agent", "tools", "invokes_tool", "observed"); R("rel-tools-api", "tools", "api", "calls");
R("rel-tools-db", "tools", "db", "reads_from", "inferred", "Inferred from a shared database role name in the manifest; not observed.");
R("rel-agent-db", "agent", "db", "may_assume", "hypothetical", "Hypothetical: if the agent's runtime role can assume the support-tools role, it could read orders-db.");
R("rel-ci-api", "ci", "api", "deploys"); R("rel-ci-web", "ci", "web", "deploys");

const sources = [
  { id: "src-edge", label: "Edge WAF", kind: "waf", asset_ids: ["edge"], trusts_request_ids: true, stale_after_seconds: 600 },
  { id: "src-auth", label: "Identity audit log", kind: "app_auth", asset_ids: ["auth"], trusts_request_ids: true, stale_after_seconds: 1800 },
  { id: "src-app", label: "Application security events", kind: "app_security", asset_ids: ["web", "api", "pay"], trusts_request_ids: true, stale_after_seconds: 1800 },
  { id: "src-db-audit", label: "Database audit", kind: "db_audit", asset_ids: ["db"], trusts_request_ids: false, stale_after_seconds: 1800 },
  { id: "src-decoy", label: "Decoy credential service", kind: "honeytoken", asset_ids: ["agent", "tools"], trusts_request_ids: false },
  { id: "src-agent", label: "Agent tool wrapper", kind: "agent_observer", asset_ids: ["agent", "tools"], trusts_request_ids: true, stale_after_seconds: 1800 },
  { id: "src-sink", label: "Egress observer (controlled sink)", kind: "effect_observer", asset_ids: ["blob", "tools"], trusts_request_ids: true },
  { id: "src-falco", label: "Runtime sensor (Falco)", kind: "falco", asset_ids: ["worker", "sched"], trusts_request_ids: false, stale_after_seconds: 1800 },
];

interface Delivery { source_id: string; received_at: string; payload: IngestEvent; note?: string }
const deliveries: Delivery[] = [];
let n = 0;
const D = (source_id: string, occMin: number, p: Omit<IngestEvent, "source_event_id" | "occurred_at">, opts: { delaySec?: number; occSec?: number; note?: string; id?: string } = {}) => {
  const occurred_at = at(occMin, opts.occSec ?? 0);
  const payload = { source_event_id: opts.id ?? `${source_id}-${String(++n).padStart(4, "0")}`, occurred_at, ...p } as IngestEvent;
  deliveries.push({ source_id, received_at: new Date(Date.parse(occurred_at) + (opts.delaySec ?? 2) * 1000).toISOString(), payload, ...(opts.note ? { note: opts.note } : {}) });
  return payload;
};

// 1. Normal request
D("src-edge", 0, { asset_ids: ["public-edge"], action: "request_received", outcome: "allowed", request_id: "req-1001", route: "/orders?page=2", client_ip: "192.0.2.10", evidence: { status: 200, method: "GET", upstream: "orders-api" } });
D("src-app", 0, { asset_ids: ["orders-api"], action: "request_received", outcome: "success", request_id: "req-1001", route: "/orders", evidence: { status: 200, handler: "listOrders" } }, { occSec: 1 });
D("src-auth", 0, { asset_ids: ["identity-service"], action: "authentication", outcome: "success", actor_ref: "acct-alice", session_ref: "sess-a1", evidence: { method: "password+totp" } }, { occSec: 30 });

// 2. Suspicious requests blocked at the edge (clustered)
for (let i = 0; i < 12; i++) D("src-edge", 1, { asset_ids: ["edge"], action: "waf_match", outcome: "blocked", rule_ref: "sqli-942100", severity: "medium", request_id: `req-11${String(i).padStart(2, "0")}`, route: `/orders/${4100 + i}?q=1'+OR+'1'='1`, client_ip: "203.0.113.7", evidence: { rule: "942100 SQL injection", action: "deny", status: 403, headers: { "user-agent": "sqlmap/1.8", authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U" } } }, { occSec: i * 4 });
// late-arriving block (occurred in the burst, delivered ~4.5 minutes later) — revises the cluster
D("src-edge", 1, { asset_ids: ["edge"], action: "waf_match", outcome: "blocked", rule_ref: "sqli-942100", severity: "medium", request_id: "req-1199", route: "/orders/4199", client_ip: "203.0.113.7", evidence: { rule: "942100 SQL injection", action: "deny", status: 403 } }, { occSec: 55, delaySec: 270, note: "late delivery" });

// 3. Repeated sign-in failures for one account, then unrelated success through a shared NAT, then a success for that account
for (let i = 0; i < 6; i++) D("src-auth", 2, { asset_ids: ["auth"], action: "authentication", outcome: "failure", actor_ref: "acct-ops", client_ip: "198.51.100.20", evidence: { reason: "bad_password", password: "hunter2-should-never-be-stored" } }, { occSec: i * 9 });
D("src-auth", 3, { asset_ids: ["auth"], action: "authentication", outcome: "success", actor_ref: "acct-dana", session_ref: "sess-d7", client_ip: "198.51.100.20", evidence: { method: "sso" }, coverage_note: "Shares a corporate NAT address with the failures above." }, { occSec: 30 });
D("src-auth", 5, { asset_ids: ["auth"], action: "authentication", outcome: "success", actor_ref: "acct-ops", session_ref: "sess-o2", request_id: "req-2001", client_ip: "198.51.100.20", evidence: { method: "password" } });

// 4. Sensitive privilege change linked by trusted session to that sign-in
D("src-app", 6, { asset_ids: ["orders-api"], action: "authorization_change", outcome: "success", actor_ref: "acct-ops", session_ref: "sess-o2", request_id: "req-2002", severity: "high", route: "/admin/roles", evidence: { change: "grant role billing-admin to acct-ops", ticket: null } });

// 5. A blocked request that an independent observer says had an effect anyway (contradiction)
D("src-edge", 7, { asset_ids: ["edge"], action: "waf_match", outcome: "blocked", rule_ref: "lfi-930100", severity: "high", request_id: "req-3001", route: "/api/export/../../receipts", client_ip: "203.0.113.7", evidence: { rule: "930100 path traversal", action: "deny" } });
D("src-sink", 7, { asset_ids: ["receipts-bucket"], action: "side_effect_observed", outcome: "observed", request_id: "req-3001", evidence: { observed: "object write receipts/export-0007.csv", bytes: 18211, via: "orders-api" } }, { occSec: 3 });

// 6. Decoy credential used
D("src-decoy", 8, { asset_ids: ["support-agent"], action: "decoy_used", outcome: "success", rule_ref: "canary-cloud-key-7", severity: "high", evidence: { token_id: "synthetic-canary-7", registered_placement: "support-agent env file", caller_ip: "198.18.0.44" }, coverage_note: "Decoy registration maps placement to the agent environment; the original entry point and human identity are unknown." }, { delaySec: 40 });

// 7. Agent run: model refusal, enforcement denial, allowed call with an independently observed effect
D("src-agent", 9, { asset_ids: ["support-agent"], action: "tool_invocation", outcome: "refused", run_id: "run-77", evidence: { tool: "db.delete_customer", decision: "model declined" } });
D("src-agent", 9, { asset_ids: ["support-tools-mcp"], action: "tool_invocation", outcome: "denied", run_id: "run-77", rule_ref: "policy-no-db-write", evidence: { tool: "db.write", decision: "policy denied", policy_version: "p-12" } }, { occSec: 10 });
D("src-agent", 9, { asset_ids: ["support-tools-mcp"], action: "tool_invocation", outcome: "success", run_id: "run-77", evidence: { tool: "email.send", destination: "sink.test.internal", policy_version: "p-12" } }, { occSec: 20 });
D("src-sink", 9, { asset_ids: ["support-tools-mcp"], action: "side_effect_observed", outcome: "observed", run_id: "run-77", evidence: { observed: "SMTP delivery to sink.test.internal", messages: 1 } }, { occSec: 22 });

// 8. Database audit goes dark
D("src-db-audit", 10, { asset_ids: ["orders-db"], action: "sensor_unavailable", outcome: "unknown", evidence: { sensor: "database-audit", status: "permission denied reading audit log" }, coverage_note: "Database audit permission was revoked. Data-access conclusions for orders-db are not assessable." });

// 9. HTTP 200 with no effect telemetry: must NOT become an exploit finding
D("src-edge", 10, { asset_ids: ["edge"], action: "request_received", outcome: "allowed", request_id: "req-4001", route: "/orders/search?q=%27", client_ip: "203.0.113.7", evidence: { status: 200 } }, { occSec: 30 });

// 10. Runtime sensor alert on the worker
D("src-falco", 11, { asset_ids: ["order-worker-consumer"], action: "runtime_alert", outcome: "unknown", rule_ref: "Terminal shell in container", severity: "high", evidence: { output: "A shell was spawned in a container (user=root container=order-worker-7f9 shell=sh)", priority: "Warning" } });

// Delivery faults the pipeline must handle honestly
const dup = deliveries.find((d) => d.payload.rule_ref === "lfi-930100")!;
deliveries.push({ ...dup, received_at: new Date(Date.parse(dup.received_at) + 5000).toISOString(), note: "duplicate delivery (retry)" });
deliveries.push({ source_id: "src-app", received_at: at(12), payload: { source_event_id: "src-app-forged", occurred_at: at(12), project_id: "someone-elses-project", asset_ids: ["api"], action: "request_received", outcome: "success" }, note: "asserts another project — must be rejected" });
deliveries.push({ source_id: "src-app", received_at: at(12, 5), payload: { source_event_id: "src-app-unmapped", occurred_at: at(12, 5), asset_ids: ["mystery-service"], action: "request_received", outcome: "success" }, note: "unknown asset — rejected and counted" });

deliveries.sort((a, b) => Date.parse(a.received_at) - Date.parse(b.received_at));

const meta = {
  title: "Castle Gate: synthetic incident",
  description: "A synthetic sequence: blocked SQL-injection probes, repeated sign-in failures and a privilege change, a blocked request contradicted by an observed effect, a decoy credential, an agent run with refusal/denial/observed effect, a lost database audit feed, and a runtime alert.",
  dataset_kind: "synthetic",
  start: at(-1), end: at(13),
};

const w = (name: string, v: unknown) => writeFileSync(new URL(name, OUT), JSON.stringify(v, null, 2) + "\n");
w("graph.json", graph); w("sources.json", sources); w("deliveries.json", deliveries); w("meta.json", meta);
console.log(`demo fixture: ${graph.assets.length} assets, ${graph.relationships.length} relationships, ${deliveries.length} deliveries`);
