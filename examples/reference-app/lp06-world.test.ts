import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { corroboration, probeOf, verificationReceipt } from "@dk/local-world";
import { DigitalKingdom } from "@dk/sdk-node";
import { buildApp } from "../../apps/server/src/app.ts";
import { openDb } from "../../apps/server/src/db.ts";
import { Store } from "../../apps/server/src/store.ts";
import { createServer as createMcp, DkClient } from "../../apps/mcp/src/server.ts";
import { loadFromServer, type Api } from "../../apps/web/src/lib/data.ts";
import { startLocalWorld, type LocalWorld } from "./src/world/session.ts";

/**
 * LP06 — instrumented services and independent observers. A real Digital Kingdom server on 127.0.0.1, the run
 * supervisor with the built-in services, real loopback requests, and ordinary authenticated ingestion per source.
 */
const open: (() => Promise<void>)[] = [];
afterEach(async () => { for (const c of open.splice(0).reverse()) await c(); });

async function lab(blueprint = "saas-storefront", seed = "lp06") {
  const store = new Store(openDb(":memory:"));
  const adminToken = store.createToken("lab admin", "admin").token;
  const viewer = store.createToken("lab viewer", "viewer").token;
  const app = await buildApp({ store, secret: "lp06-secret", demoMode: false, webDist: "/nonexistent" });
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  const drain = () => { for (let i = 0; i < 100 && store.processBatch().processed; i++) { /* drain */ } };
  const w = await startLocalWorld({ blueprint, seed, dk: { url, adminToken }, drain });
  open.push(async () => { await w.stop(); await app.close(); store.db.close(); });
  const get = async (path: string) => { const r = await fetch(url + path, { headers: { authorization: `Bearer ${viewer}` } }); expect(r.status, `${path}: ${r.status}`).toBe(200); return r.json() as Promise<Record<string, any>>; };
  const window = () => ({ after: new Date(Date.now() - 600_000).toISOString(), before: new Date(Date.now() + 600_000).toISOString() });
  const search = async (q: Record<string, string>) => (await get(`/api/projects/${w.project}/events/search?${new URLSearchParams({ ...window(), ...q })}`)).events as Record<string, any>[];
  return { store, url, adminToken, viewer, w, get, search, window };
}
const shape = (e: Record<string, any>) => ({ id: e.id, source_id: e.source_id, action: e.action, outcome: e.outcome, asset_ids: e.asset_ids, request_id: e.request_id, occurred_at: e.occurred_at, route: e.route ?? null });
const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
const tenantRead = (w: LocalWorld, session: string, tenant: string) => w.run.request(w.operatorToken, { resource: "ingress", method: "GET", path: `/tenants/${tenant}/records`, headers: { "x-world-session": session } });

describe("LP06-A1: a real local request is the same evidence in API, browser and MCP", () => {
  it("ingress -> api -> tenant-db, reported by three independent sources, identical across every surface", async () => {
    const t = await lab();
    const session = await t.w.login("acct:tenant-a:user");
    const r = await tenantRead(t.w, session, "tenant-a");
    expect(r.status).toBe(200);
    expect((r.body as { records: unknown[] }).records).toHaveLength(3);
    await t.w.flush();
    // the request actually reached the expected services (private truth, not shown to an investigator)
    expect(t.w.run.truth.filter((x) => x.record.op_id === r.op_id && x.kind === "effect").map((x) => x.record.resource_id)).toEqual(["tenant-db"]);
    const api = (await t.search({ request_id: r.op_id })).map(shape).sort(byId);
    expect(api.map((e) => `${e.source_id}:${e.action}:${e.outcome}`).sort()).toEqual(["api-sdk:data_access:success", "api-sdk:request_received:success", "audit:data_access:success", "ingress-sdk:request_received:success"]);
    expect(api.find((e) => e.source_id === "audit")!.asset_ids).toEqual(["tenant-db"]);
    // event detail via API
    const detail = await t.get(`/api/projects/${t.w.project}/events/${api[0]!.id}`);
    expect(detail.provenance).toMatchObject({ local_run: true, run_id: t.w.run.run_id });
    // MCP: the same records through the read-only tools
    const mcp = createMcp(new DkClient({ baseUrl: t.url, token: t.viewer, project: t.w.project }));
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "lp06", version: "1" });
    await Promise.all([mcp.connect(a), client.connect(b)]);
    const res = await client.callTool({ name: "dk_search_events", arguments: { ...t.window(), request_id: r.op_id } });
    const body = JSON.parse((res.content as { text: string }[])[0]!.text);
    expect(body.provenance).toMatchObject({ local_run: true, run_id: t.w.run.run_id });
    expect((body.events.records as Record<string, any>[]).map(shape).sort(byId)).toEqual(api);
    const one = JSON.parse(((await client.callTool({ name: "dk_get_event", arguments: { id: api[0]!.id } })).content as { text: string }[])[0]!.text);
    expect(shape(one.event)).toEqual(api[0]);
    await client.close();
    // Browser: the console's own data loader over the same server
    const browserApi = { get: async (p: string) => t.get(p) } as unknown as Api;
    const ds = await loadFromServer(browserApi, t.w.project);
    expect(ds.project.provenance).toMatchObject({ local_run: true, run_id: t.w.run.run_id });
    expect(ds.events.filter((e) => (e as { request_id?: string }).request_id === r.op_id).map((e) => shape(e as never)).sort(byId)).toEqual(api);
    expect(ds.graph.assets.map((x) => x.id).sort()).toEqual(t.w.world.graph.assets.map((x) => x.id).sort());
  });
});

describe("LP06-A2: permitted and prohibited operations have independently observed outcomes under the current policy", () => {
  it("baseline isolation: own-tenant read observed, cross-tenant read denied and not observed; weak policy: the effect is observed", async () => {
    const t = await lab();
    const session = await t.w.login("acct:tenant-a:user");
    const audit = t.w.run.observer(t.w.operatorToken, "audit");
    const permitted = await tenantRead(t.w, session, "tenant-a");
    const prohibited = await tenantRead(t.w, session, "tenant-b");
    expect([permitted.status, prohibited.status]).toEqual([200, 403]);
    const iv = (o: { started_mono_ms: number; ended_mono_ms: number }) => ({ from_mono_ms: o.started_mono_ms, to_mono_ms: o.ended_mono_ms });
    const aP = audit.answer(permitted.op_id, iv(permitted), "tenant-db", 50), aX = audit.answer(prohibited.op_id, iv(prohibited), "tenant-db", 50);
    expect(aP.status).toBe("observed");
    expect(aP.effects[0]).toMatchObject({ op_id: permitted.op_id, run_id: t.w.run.run_id, resource_id: "tenant-db", action: "data_access", detail: { tenant: "tenant-a", op: "read" } });
    expect(aX.status).toBe("not_observed");
    await t.w.flush();
    const evP = await t.search({ request_id: permitted.op_id }), evX = await t.search({ request_id: prohibited.op_id });
    expect(evP.some((e) => e.source_id === "audit")).toBe(true);
    expect(evX.some((e) => e.source_id === "audit")).toBe(false);
    expect(evX.find((e) => e.source_id === "api-sdk" && e.outcome === "denied")?.rule_ref).toBe("tenant-isolation");
    const policyRev = t.w.run.service(t.w.operatorToken, "api").revision();
    expect(policyRev).toBe("api:policy-baseline-r1");
    const receipt = verificationReceipt({
      run_id: t.w.run.run_id, plan_id: t.w.world.plan.plan_id, tested_target_revision: policyRev, cleanup: { outcome: "not_needed", notes: "no state created by the probes beyond reads" },
      probes: [
        probeOf({ operation_id: permitted.op_id, expectation: "permitted", answer: aP, status: permitted.status, evidence_refs: evP.filter((e) => e.source_id === "audit").map((e) => e.id) }),
        probeOf({ operation_id: prohibited.op_id, expectation: "prohibited", answer: aX, status: prohibited.status, evidence_refs: evX.map((e) => e.id) }),
      ],
    });
    expect(receipt).toMatchObject({ security_verdict: "pass", overall_outcome: "pass", scope: "local_run_only" });

    // the SAME prohibited operation under a deliberately weak policy revision: the observer sees the effect
    expect(t.w.run.configure(t.w.operatorToken, "api", { policy_variant: "deliberately_weak" })).toMatchObject({ to_revision: "api:policy-deliberately_weak-r2" });
    const leak = await tenantRead(t.w, session, "tenant-b");
    expect(leak.status).toBe(200);
    const aL = audit.answer(leak.op_id, iv(leak), "tenant-db", 50);
    expect(aL.status).toBe("observed");
    const weak = verificationReceipt({ run_id: t.w.run.run_id, plan_id: t.w.world.plan.plan_id, tested_target_revision: t.w.run.service(t.w.operatorToken, "api").revision(), cleanup: { outcome: "not_needed", notes: "" },
      probes: [probeOf({ operation_id: permitted.op_id, expectation: "permitted", answer: aP, status: 200, evidence_refs: ["e1"] }), probeOf({ operation_id: leak.op_id, expectation: "prohibited", answer: aL, status: leak.status, evidence_refs: ["e2"] })] });
    expect(weak.security_verdict).toBe("fail");
  });

  it("concurrent unrelated operations are never attributed to the probe", async () => {
    const t = await lab();
    const sa = await t.w.login("acct:tenant-a:user"), sb = await t.w.login("acct:tenant-b:user");
    const audit = t.w.run.observer(t.w.operatorToken, "audit");
    const [mine, other] = await Promise.all([tenantRead(t.w, sa, "tenant-b"), tenantRead(t.w, sb, "tenant-b")]);
    expect([mine.status, other.status]).toEqual([403, 200]);
    expect(audit.answer(other.op_id, { from_mono_ms: other.started_mono_ms, to_mono_ms: other.ended_mono_ms }, "tenant-db").status).toBe("observed");
    expect(audit.answer(mine.op_id, { from_mono_ms: mine.started_mono_ms, to_mono_ms: mine.ended_mono_ms }, "tenant-db").status).toBe("not_observed");
  });
});

describe("LP06-A3: an observer outage makes the affected interval unknown", () => {
  it("effects during a deliberate outage are unknown (never 'no effect'), the receipt is inconclusive and Digital Kingdom shows the gap", async () => {
    const t = await lab();
    const session = await t.w.login("acct:tenant-a:user");
    t.w.run.configure(t.w.operatorToken, "api", { policy_variant: "deliberately_weak" });
    const audit = t.w.run.observer(t.w.operatorToken, "audit");
    const before = await tenantRead(t.w, session, "tenant-a");
    await t.w.flush();
    audit.stop("deliberate outage for LP06-A3");
    const during = await tenantRead(t.w, session, "tenant-b"); // the effect really happens
    await new Promise((r) => setTimeout(r, 20));
    audit.restart();
    const after = await tenantRead(t.w, session, "tenant-a");
    await t.w.flush();
    expect(during.status).toBe(200);
    expect(t.w.run.truth.some((x) => x.kind === "effect" && x.record.op_id === during.op_id)).toBe(true);
    const ans = audit.answer(during.op_id, { from_mono_ms: during.started_mono_ms, to_mono_ms: during.ended_mono_ms }, "tenant-db");
    expect(ans.status).toBe("unknown");
    expect(ans.reason).toMatch(/down for part of the operation interval.*not evidence of no effect/);
    expect(audit.lost).toBe(1);
    expect(audit.answer(before.op_id, { from_mono_ms: before.started_mono_ms, to_mono_ms: before.ended_mono_ms }, "tenant-db").status).toBe("observed");
    expect(audit.answer(after.op_id, { from_mono_ms: after.started_mono_ms, to_mono_ms: after.ended_mono_ms }, "tenant-db").status).toBe("observed");
    const receipt = verificationReceipt({ run_id: t.w.run.run_id, plan_id: t.w.world.plan.plan_id, tested_target_revision: "api:policy-deliberately_weak-r2", cleanup: { outcome: "not_needed", notes: "" },
      probes: [probeOf({ operation_id: before.op_id, expectation: "permitted", answer: audit.answer(before.op_id, { from_mono_ms: before.started_mono_ms, to_mono_ms: before.ended_mono_ms }, "tenant-db"), status: 200, evidence_refs: ["x"] }), probeOf({ operation_id: during.op_id, expectation: "prohibited", answer: ans, status: during.status, evidence_refs: [] })] });
    expect(receipt.probes[1]).toMatchObject({ actual_effect: "unknown", observer_scope: "unavailable", result: "inconclusive" });
    expect(receipt.security_verdict).toBe("inconclusive");
    // Digital Kingdom: no observer record for the outage operation, an explicit sensor_unavailable, and the
    // historical coverage of tenant-db data_access is not "covered" across that interval
    expect((await t.search({ request_id: during.op_id })).some((e) => e.source_id === "audit")).toBe(false);
    const health = await t.search({ source_id: "audit", action: "sensor_unavailable", asset_id: "tenant-db" });
    expect(health).toHaveLength(1);
    expect(health[0]!.coverage_note).toMatch(/observer audit stopped: deliberate outage/);
    const restored = await t.search({ source_id: "audit", action: "sensor_restored", asset_id: "tenant-db" });
    expect(restored).toHaveLength(1);
    const cov = await t.get(`/api/projects/${t.w.project}/coverage/history?${new URLSearchParams({ asset: "tenant-db", action: "data_access", after: health[0]!.occurred_at, before: restored[0]!.occurred_at })}`);
    expect(cov.totals_ms.covered).toBe(0);
    expect(cov.spans.every((sp: { state: string }) => sp.state === "unknown")).toBe(true);
    expect(cov.spans[0].sources).toContainEqual({ source_id: "audit", state: "unknown", reason: "source reported itself unavailable" });
    const rep = await t.get(`/api/projects/${t.w.project}/local-world/reporting`);
    expect(rep.sources.find((s: { source_id: string }) => s.source_id === "audit").health.state).toBe("restored");
  });
});

describe("LP06-A4: independent declared authority; self-reports cannot corroborate themselves", () => {
  it("every world source is registered with its own kind, scope and independence group", async () => {
    const t = await lab();
    const snap = await t.get(`/api/projects/${t.w.project}/snapshot`);
    const reg = (snap.sources as { id: string; kind: string; asset_ids: string[]; independence_group: string }[]).map((s) => [s.id, s.kind, s.asset_ids.join("+"), s.independence_group]).sort();
    expect(reg).toEqual(t.w.world.sources.map((s) => [s.id, s.kind, s.asset_ids.join("+"), s.independence_group]).sort());
    expect(new Set(reg.map((r) => r[3])).size).toBe(reg.length);
  });

  it("relayed and same-group records do not corroborate; only the declared independent observer does", async () => {
    const t = await lab();
    const session = await t.w.login("acct:tenant-a:user");
    const op = await tenantRead(t.w, session, "tenant-a");
    // (1) the API's own key tries to relay an "observer" effect for the same operation
    const relay = new DigitalKingdom({ url: t.url, sourceKey: t.w.sourceKeys["api-sdk"]!, sessionSalt: "x", flushIntervalMs: 60_000 });
    relay.emit({ asset: "tenant-db", action: "side_effect_observed", outcome: "observed", requestId: op.op_id, agent: { phase: "effect", origin: "independent_observer" } });
    await relay.close();
    // (2) a second "observer" an operator registered in the API's own independence group
    const admin = { authorization: `Bearer ${t.adminToken}`, "content-type": "application/json" };
    const reg = await (await fetch(`${t.url}/api/projects/${t.w.project}/sources`, { method: "POST", headers: admin, body: JSON.stringify({ id: "api-sidecar", label: "sidecar relaying the API's view", kind: "effect_observer", asset_ids: ["tenant-db"], independence_group: "self:api", trusts_request_ids: true }) })).json() as { key: string };
    const sidecar = new DigitalKingdom({ url: t.url, sourceKey: reg.key, sessionSalt: "x", flushIntervalMs: 60_000 });
    sidecar.emit({ asset: "tenant-db", action: "data_access", outcome: "success", requestId: op.op_id });
    await sidecar.close();
    // (3) the tool-gateway kind cannot report an effect at all, whatever origin its payload claims (agent world below)
    await t.w.flush();
    const events = await t.search({ request_id: op.op_id });
    expect(events.some((e) => e.source_id === "api-sdk" && e.action === "side_effect_observed")).toBe(false); // rejected at ingestion
    const rej = (t.store.db.prepare("SELECT reason FROM rejections WHERE project_id = ? AND source_id = 'api-sdk'").all(t.w.project) as { reason: string }[]).map((r) => r.reason);
    expect(rej).toContain("action_not_permitted");
    const snap = await t.get(`/api/projects/${t.w.project}/snapshot`);
    const c = corroboration(events.map((e) => ({ id: e.id, source_id: e.source_id, action: e.action })), snap.sources);
    expect(c.independent_sources).toEqual(["audit"]);
    expect(c.not_independent).toEqual([{ source_id: "api-sidecar", reason: "shares independence group self:api with a self-reporting source" }]);
    expect(c.corroborated).toBe(true);
    const withoutAudit = corroboration(events.filter((e) => e.source_id !== "audit").map((e) => ({ id: e.id, source_id: e.source_id, action: e.action })), snap.sources);
    expect(withoutAudit.corroborated).toBe(false);
  });

  it("agent world: the gateway's reports are corroborated only by the receiver observer; a runtime's claim of independence is rejected", async () => {
    const t = await lab("agent-workspace", "lp06-agent");
    const send = (to: string, run: string) => t.w.run.request(t.w.operatorToken, { resource: "tool-gateway", method: "POST", path: "/tools/send_message", headers: { "x-world-agent-run": run }, body: { to, body: "synthetic note" } });
    const ok = await send("allowed-receiver", "agent-run-1"), blocked = await send("blocked-receiver", "agent-run-2");
    expect([ok.status, blocked.status]).toEqual([202, 403]);
    const fx = t.w.run.observer(t.w.operatorToken, "effects");
    expect(fx.answer(ok.op_id, { from_mono_ms: ok.started_mono_ms, to_mono_ms: ok.ended_mono_ms }, "allowed-receiver").status).toBe("observed");
    expect(fx.answer(blocked.op_id, { from_mono_ms: blocked.started_mono_ms, to_mono_ms: blocked.ended_mono_ms }, "blocked-receiver").status).toBe("not_observed");
    const forged = new DigitalKingdom({ url: t.url, sourceKey: t.w.sourceKeys["tool-gateway-sdk"]!, sessionSalt: "x", flushIntervalMs: 60_000 });
    forged.toolStep("blocked-receiver", "agent-run-2", "observed", { phase: "effect", origin: "independent_observer" });
    await forged.close();
    await t.w.flush();
    const runEvents = await t.search({ run_id: "agent-run-1" });
    expect((t.store.db.prepare("SELECT reason FROM rejections WHERE project_id = ? AND source_id = 'tool-gateway-sdk'").all(t.w.project) as { reason: string }[]).map((r) => r.reason)).toEqual(["action_not_permitted"]);
    expect(runEvents.map((e) => `${e.source_id}:${e.action}:${e.outcome}`).sort()).toEqual(["effects:side_effect_observed:observed", "tool-gateway-sdk:tool_invocation:allowed", "tool-gateway-sdk:tool_invocation:attempted", "tool-gateway-sdk:tool_invocation:success"]);
    expect((await t.search({ run_id: "agent-run-2" })).some((e) => e.action === "side_effect_observed")).toBe(false);
    const findings = await t.get(`/api/projects/${t.w.project}/findings`) as unknown as { kind: string; evidence_level: string; claim: string }[];
    const effect = findings.find((f) => f.kind === "agent_effect_observed" && f.claim.includes("agent-run-1"));
    expect(effect?.evidence_level).toBe("corroborated");
    expect(findings.some((f) => f.kind === "agent_action_denied" && f.claim.includes("agent-run-2"))).toBe(true);
  });
});

describe("LP06 setup view: exactly which local capabilities are reporting", () => {
  it("reporting lists every declared (source, asset, action) and its actual state", async () => {
    const t = await lab();
    const session = await t.w.login("acct:tenant-a:user");
    await tenantRead(t.w, session, "tenant-a");
    await t.w.flush();
    const rep = await t.get(`/api/projects/${t.w.project}/local-world/reporting`);
    expect(rep.schema).toBe("dk.local.reporting.v1");
    expect(rep.provenance.local_run).toBe(true);
    const cap = (src: string, asset: string, action: string) => rep.sources.find((s: { source_id: string }) => s.source_id === src).capabilities.find((c: { asset_id: string; action: string }) => c.asset_id === asset && c.action === action);
    expect(cap("audit", "tenant-db", "data_access").status).toBe("reporting");
    expect(cap("audit", "artifacts", "side_effect_observed").status).toBe("silent");
    expect(cap("api-sdk", "api", "data_access").status).toBe("reporting");
    expect(cap("worker-sdk", "worker", "data_access").status).toBe("silent");
    expect(rep.sources.find((s: { source_id: string }) => s.source_id === "audit")).toMatchObject({ role: "independent_observer", independence_group: "observer:audit" });
    expect(rep.summary.reporting).toBeGreaterThan(0);
    expect(rep.summary.silent).toBeGreaterThan(0);
  });

  it("a queued job is processed by the worker in the background and its effects stay attributed to the submitting operation", async () => {
    const t = await lab();
    const session = await t.w.login("acct:tenant-a:user");
    const job = await t.w.run.request(t.w.operatorToken, { resource: "ingress", method: "POST", path: "/tenants/tenant-a/jobs", headers: { "x-world-session": session } });
    expect(job.status).toBe(202);
    await t.w.flush();
    const audit = t.w.run.observer(t.w.operatorToken, "audit");
    const fx = audit.effects().filter((e) => e.op_id === job.op_id).map((e) => `${e.resource_id}:${e.detail.op}`);
    expect(fx).toEqual(["tenant-db:read", "artifacts:publish"]);
  });
});

describe("LP06 delivery/identity services: short-lived credentials, grants, artifacts and observed use", () => {
  it("a credential works only with its grant, stops working when deactivated, and every data use is independently observed", async () => {
    const t = await lab("delivery-identity", "lp06-delivery");
    const req = (resource: string, method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}) => t.w.run.request(t.w.operatorToken, { resource, method, path, headers, ...(body !== undefined ? { body } : {}) });
    const pub = await req("depot", "POST", "/artifacts", { name: "build-1", content: "synthetic build output" }, { "x-world-actor": "svc:builder" });
    expect(pub.status).toBe(201);
    const digest = (pub.body as { digest: string }).digest;
    expect((await req("depot", "POST", "/deployed", { digest: "0".repeat(64) })).status).toBe(404); // only existing artifacts
    expect((await req("depot", "POST", "/deployed", { digest })).status).toBe(200);
    const cred = (await req("issuer", "POST", "/credentials", { subject: "svc:deployer", scope: ["read"] })).body as { id: string; secret: string; synthetic: boolean };
    expect(cred.synthetic).toBe(true);
    const h = { "x-world-credential-id": cred.id, "x-world-credential": cred.secret };
    const noGrant = await req("deploy", "GET", "/tenants/release/records", undefined, h);
    expect(noGrant.status).toBe(403);
    expect((await req("issuer", "POST", "/grants", { subject: "svc:deployer", grant: "read:deploy-data", op: "add" })).status).toBe(200);
    const use = await req("deploy", "GET", "/tenants/release/records", undefined, h);
    expect(use.status).toBe(200);
    const obs = t.w.run.observer(t.w.operatorToken, "use-observer");
    expect(obs.answer(use.op_id, { from_mono_ms: use.started_mono_ms, to_mono_ms: use.ended_mono_ms }, "deploy-data").status).toBe("observed");
    expect(obs.answer(noGrant.op_id, { from_mono_ms: noGrant.started_mono_ms, to_mono_ms: noGrant.ended_mono_ms }, "deploy-data").status).toBe("not_observed");
    expect((await req("issuer", "POST", `/credentials/${cred.id}/revoke`, {})).status).toBe(200);
    expect((await req("deploy", "GET", "/tenants/release/records", undefined, h)).status).toBe(401);
    expect(obs.effects().map((e) => `${e.resource_id}:${e.detail.op}`)).toEqual(["depot:publish", "depot:select_deployed", "deploy-data:read"]);
    await t.w.flush();
    const changes = await t.search({ source_id: "issuer-sdk", action: "authorization_change" });
    expect(changes.length).toBe(3); // issued, grant_add, deactivated
  });
});

describe("LP06 CLI: pnpm world prints exactly which capabilities report", () => {
  it("starts, drives one benign operation, prints reporting rows and cleans up", async () => {
    const { runCli } = await import("./src/world/cli.ts");
    const lines: string[] = [];
    const { w, stop } = await runCli(["--blueprint", "saas-storefront", "--seed", "cli-test"], (s) => lines.push(s));
    await stop();
    const out = lines.join("\n");
    expect(out).toContain("Local laboratory — synthetic people and data");
    expect(out).toMatch(/control network_egress\s+not_enforced/);
    expect(out).toMatch(/✓ tenant-db\s+data_access\s+reporting \(1\)/);
    expect(out).toMatch(/· artifacts\s+side_effect_observed\s+silent/);
    expect(out).toContain("Stopped; cleanup completed.");
    expect(w.run.operationalOutcome().outcome).toBe("healthy");
  });
});
