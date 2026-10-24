import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { checkScenarioAgainstWorld, compileWorld, instantiateBlueprint, parseScenario, ScenarioError, SCENARIO_ACTIONS } from "@dk/local-world";
import { buildApp } from "../../apps/server/src/app.ts";
import { openDb } from "../../apps/server/src/db.ts";
import { Store } from "../../apps/server/src/store.ts";
import { createServer as createMcp, DkClient } from "../../apps/mcp/src/server.ts";
import { startLocalWorld } from "./src/world/session.ts";
import { intendedDigest, intendedState, investigatorView, leakCheck, runScenario } from "./src/world/scenario.ts";

/** LP07 — finite scenario and fault DSL, private truth separated from observable evidence and investigator views. */
const ROOT = join(import.meta.dirname, "../..");
const doc = (id: string) => JSON.parse(readFileSync(join(ROOT, `scenarios/local-world/dsl/${id}.scenario.json`), "utf8"));
const open: (() => Promise<void>)[] = [];
afterEach(async () => { for (const c of open.splice(0).reverse()) await c(); });

async function lab(scn: { blueprint: string; seed: string }, budget?: Record<string, number>) {
  const store = new Store(openDb(":memory:"));
  const adminToken = store.createToken("lab admin", "admin").token, viewer = store.createToken("investigator", "viewer").token;
  const app = await buildApp({ store, secret: "lp07", demoMode: false, webDist: "/nonexistent" });
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  const w = await startLocalWorld({ blueprint: scn.blueprint, seed: scn.seed, dk: { url, adminToken }, drain: () => { for (let i = 0; i < 100 && store.processBatch().processed; i++) { /* drain */ } }, ...(budget ? { budget } : {}) });
  open.push(async () => { await w.stop(); await app.close(); store.db.close(); });
  const search = async (q: Record<string, string>) => ((await (await fetch(`${url}/api/projects/${w.project}/events/search?${new URLSearchParams({ after: new Date(Date.now() - 600_000).toISOString(), before: new Date(Date.now() + 600_000).toISOString(), ...q })}`, { headers: { authorization: `Bearer ${viewer}` } })).json()) as { events: Record<string, any>[] }).events;
  return { store, url, viewer, adminToken, w, search };
}
const invalid = (d: unknown, re: RegExp) => { try { parseScenario(d); } catch (e) { expect(e).toBeInstanceOf(ScenarioError); expect((e as ScenarioError).issues.join(" | ")).toMatch(re); return; } throw new Error("expected rejection"); };

describe("LP07-A1: the DSL cannot execute scripts, shell, plugins or unrestricted network requests", () => {
  const base = () => doc("LW-01");
  it("only the finite action vocabulary is accepted; executable and network fields are rejected at every level", () => {
    expect(SCENARIO_ACTIONS).not.toContain("shell");
    for (const action of ["shell", "exec", "script", "plugin", "http_request", "fetch", "eval"]) invalid({ ...base(), steps: [{ at_ms: 0, action }] }, /not in the finite action vocabulary/);
    for (const field of ["command", "script", "plugin", "url", "host", "port", "headers", "env", "file", "code"]) invalid({ ...base(), steps: [{ ...base().steps[2], [field]: "x" }] }, new RegExp(`${field}: unknown field`));
    for (const top of ["hooks", "plugins", "setup_script", "before_all"]) invalid({ ...base(), [top]: ["sh -c id"] }, new RegExp(`/${top}: unknown field`));
    invalid({ ...base(), steps: [{ ...base().steps[2], resource: "http://169.254.169.254/latest" }] }, /resource must be a plain id/);
    invalid({ ...base(), steps: [{ ...base().steps[2], route: "GET http://evil.example/x" }] }, /route must be/);
    invalid({ ...base(), steps: [{ ...base().steps[2], route: "GET /tenants/../admin" }] }, /route must be/);
    invalid({ ...base(), steps: [{ ...base().steps[2], params: { tenant: "../tenant-b" } }] }, /single path segment/);
    invalid({ ...base(), steps: [{ ...base().steps[2], params: { tenant: "a/b" } }] }, /single path segment/);
    invalid({ ...base(), steps: [{ ...base().steps[2], fault: "drop" }] }, /fault: not a parameter of request_route/);
    invalid({ ...base(), steps: [base().steps[2], { ...base().steps[2], at_ms: 1, label: "x2" }] }, /must not go backwards/);
    invalid({ ...base(), steps: Array.from({ length: 201 }, (_, i) => ({ ...base().steps[0], as: `s${i}` })) }, /1 to 200 steps/);
    invalid({ ...base(), expect: [{ label: "nobody", effect: "observed" }] }, /must name a labelled step/);
    invalid({ ...base(), steps: [{ at_ms: 0, action: "set_policy", resource: "api", policy_variant: "permissive" }] }, /reviewed variant/);
  });

  it("every reference must resolve inside the compiled world", () => {
    const world = compileWorld(instantiateBlueprint("saas-storefront", { seed: "x" }));
    const check = (d: unknown, re: RegExp) => expect(() => checkScenarioAgainstWorld(parseScenario(d), world)).toThrow(re);
    check({ ...base(), steps: [{ ...base().steps[0] }, { ...base().steps[2], resource: "127.0.0.1:8787" }], expect: [] }, /127\.0\.0\.1:8787 is not a registered resource/);
    check({ ...base(), steps: [{ ...base().steps[0] }, { ...base().steps[2], resource: "audit" }], expect: [] }, /audit is not a registered resource/);
    check({ ...base(), steps: [{ ...base().steps[0] }, { ...base().steps[2], route: "GET /admin" }], expect: [] }, /GET \/admin is not a declared route of ingress/);
    check({ ...base(), steps: [{ at_ms: 0, action: "set_policy", resource: "queue", policy_variant: "baseline" }], expect: [] }, /queue has no reviewed policy variant/);
    check({ ...base(), steps: [{ at_ms: 0, action: "evidence", source: "someone-else", fault: "drop" }], expect: [] }, /not a declared source/);
    check({ ...base(), steps: [{ at_ms: 0, action: "observer", observer: "api-sdk", state: "stop" }], expect: [] }, /not an observer of this world/);
    check({ ...base(), steps: [{ ...base().steps[2] }], expect: [] }, /session sa is not defined by an earlier sign_in/);
    check({ ...base(), steps: [{ ...base().steps[0], actor: "root" }], expect: [] }, /root is not a synthetic account/);
    check({ ...base(), steps: [{ ...base().steps[0], at_ms: 500_000 }], expect: [] }, /beyond the world's 120s budget/);
    for (const id of ["LW-01", "LW-02", "LW-03"]) { const d = doc(id); expect(() => checkScenarioAgainstWorld(parseScenario(d), compileWorld(instantiateBlueprint(d.blueprint, { seed: d.seed })))).not.toThrow(); }
  });

  it("the engine and DSL modules have no process, eval or dynamic-code path", () => {
    for (const f of ["examples/reference-app/src/world/scenario.ts", "packages/local-world/src/scenario/dsl.ts", "examples/reference-app/src/world/services.ts", "packages/local-world/src/runtime/supervisor.ts"]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, f).not.toMatch(/child_process|node:vm|worker_threads|\beval\(|new Function|import\(\s*[a-z]/);
    }
  });
});

describe("LP07-A2: same seed and schedule reproduce the intended state; timing differences are recorded", () => {
  it("two fresh runs of LW-01 have identical intended state with different run ids, op ids and timings", async () => {
    const d = doc("LW-01");
    const a = await lab(d), b = await lab(d);
    const ra = await runScenario(a.w, d, { timeScale: 1 }), rb = await runScenario(b.w, d, { timeScale: 0 });
    expect(ra.result.status).toBe("complete");
    expect(ra.result.grades.filter((g) => !g.pass), JSON.stringify(ra.result.grades)).toEqual([]);
    expect(rb.result.grades.every((g) => g.pass)).toBe(true);
    expect(a.w.run.run_id).not.toBe(b.w.run.run_id);
    expect(ra.truth.steps.map((s) => s.op_id)).not.toEqual(rb.truth.steps.map((s) => s.op_id));
    expect(intendedDigest(intendedState(ra.truth, a.w))).toBe(intendedDigest(intendedState(rb.truth, b.w)));
    // timing is recorded, not hidden: scheduled offsets, actual monotonic offsets and scenario time per step
    expect(ra.result.timing).toMatchObject({ scheduled_span_ms: 120, time_scale: 1 });
    expect(ra.result.timing.actual_span_ms).toBeGreaterThanOrEqual(120);
    expect(rb.result.timing.time_scale).toBe(0);
    expect(ra.truth.steps[2]).toMatchObject({ scheduled_at_ms: 20, scenario_time: "2026-10-19T14:00:00.020Z" });
    expect(ra.truth.steps.every((s) => s.started_offset_ms !== null && s.ended_offset_ms! >= s.started_offset_ms!)).toBe(true);
  });

  it("a different seed (a different world) yields a different intended state; snapshot/reset restores state", async () => {
    const d = doc("LW-01"), d2 = { ...d, seed: "lw01-other-seed" };
    const a = await lab(d), c = await lab(d2);
    const ra = await runScenario(a.w, d), rc = await runScenario(c.w, d2);
    expect(intendedDigest(intendedState(ra.truth, a.w))).not.toBe(intendedDigest(intendedState(rc.truth, c.w)));
    await expect(runScenario(a.w, d2)).rejects.toThrow(/seed does not match/);
    const snap = a.w.run.snapshot(a.w.operatorToken);
    const write = await runScenario(a.w, { ...d, steps: [d.steps[0], { at_ms: 1, action: "request_route", resource: "ingress", route: "GET /tenants/{tenant}/records", params: { tenant: "tenant-a" }, session: "sa" }, { at_ms: 2, action: "set_policy", resource: "api", policy_variant: "baseline" }], expect: [] });
    expect(write.result.status).toBe("complete");
    expect(a.w.run.service(a.w.operatorToken, "api").revision()).toBe("api:policy-baseline-r3");
    a.w.run.reset(a.w.operatorToken, snap);
    expect(a.w.run.service(a.w.operatorToken, "api").revision()).toBe("api:policy-deliberately_weak-r2");
    expect(a.w.run.snapshot(a.w.operatorToken).services).toEqual(snap.services);
  });

  it("partial runs are accounted for: stopped schedules and budget refusals are never reported complete", async () => {
    const d = doc("LW-01");
    const a = await lab(d);
    const r = await runScenario(a.w, d, { stopAfter: 5 });
    expect(r.result.status).toBe("partial");
    expect(r.result.accounting).toMatchObject({ steps: 13, executed: 5, not_run: 8, not_run_steps: [5, 6, 7, 8, 9, 10, 11, 12] });
    expect(r.result.grades.find((g) => g.label === "lw01-cross-weak")!.pass).toBe(false);
    const tight = await lab(d, { max_requests: 6 });
    const t = await runScenario(tight.w, d);
    expect(t.result.status).toBe("partial");
    expect(t.result.accounting.refused).toBeGreaterThan(0);
    expect(t.truth.steps.find((s) => s.outcome === "refused")!.reason).toMatch(/request budget 6 reached/);
  });
});

describe("LP07-A3: missing, delayed and dropped evidence change observability, never private truth", () => {
  it("dropped observer evidence: the effect stays in truth and in the observer, but never reaches Digital Kingdom", async () => {
    const d = doc("LW-02");
    const faulted = await lab(d), clean = await lab(d);
    const noFaults = { ...d, steps: d.steps.filter((s: { action: string }) => s.action !== "evidence") };
    const rf = await runScenario(faulted.w, d), rc = await runScenario(clean.w, noFaults);
    expect(rf.result.grades.every((g) => g.pass) && rc.result.grades.every((g) => g.pass)).toBe(true);
    const byLabel = (t: typeof rf.truth) => Object.fromEntries(t.steps.filter((s) => s.label).map((s) => [s.label, { status: s.status, effects: t.effects.filter((e) => e.step === s.index).map((e) => [e.resource_id, e.action, e.detail.op]) }]));
    expect(byLabel(rf.truth)).toEqual(byLabel(rc.truth));
    await faulted.w.flush(); await clean.w.flush();
    const weakOp = (t: typeof rf.truth) => t.steps.find((s) => s.label === "lw02-blocked-weak")!.op_id!;
    expect((await clean.search({ request_id: weakOp(rc.truth) })).some((e) => e.source_id === "effects")).toBe(true);
    expect((await faulted.search({ request_id: weakOp(rf.truth) })).some((e) => e.source_id === "effects")).toBe(false);
    expect(faulted.w.hub.stats.dropped).toBe(1);
    // the gateway's own reports of the same run did arrive: the investigator sees an allowed delivery without its effect
    expect((await faulted.search({ run_id: "lw02-run-c" })).map((e) => `${e.source_id}:${e.outcome}`).sort()).toEqual(["tool-gateway-sdk:allowed", "tool-gateway-sdk:attempted", "tool-gateway-sdk:success"]);
  });

  it("delayed and missing evidence: held records arrive after release with a later receipt time; the outage effect is unknown", async () => {
    const d = doc("LW-01");
    const a = await lab(d);
    const r = await runScenario(a.w, d, { timeScale: 1 });
    await a.w.flush();
    const weak = r.truth.steps.find((s) => s.label === "lw01-cross-weak")!, unobs = r.truth.steps.find((s) => s.label === "lw01-cross-unobserved")!;
    expect(a.w.hub.stats.held).toBeGreaterThan(0);
    expect(a.w.hub.stats.released).toBe(a.w.hub.stats.held);
    const evs = await a.search({ request_id: weak.op_id! });
    const api = evs.filter((e) => e.source_id === "api-sdk"), ingress = evs.find((e) => e.source_id === "ingress-sdk")!;
    expect(api.length).toBe(2);
    // occurrence time is unchanged; the delay shows up as receipt lag relative to the undelayed ingress record
    expect(Math.max(...api.map((e) => Date.parse(e.occurred_at)))).toBeLessThanOrEqual(Date.parse(ingress.occurred_at)); // the API acted before the gateway answered
    const lag = (e: Record<string, any>) => Date.parse(e.received_at) - Date.parse(e.occurred_at);
    // Held from step 6 until the release at step 11. The margin is the gap this run actually had between the end of
    // the weak request's delivery (the next step starts only after every source flushed) and the release step, not a
    // fixed 25 ms that runner load could eat when step 7 fired late (D-M5-CI-2); 2 ms allows wall/monotonic rounding.
    const step = (i: number) => r.truth.steps[i]!;
    const heldGap = step(11).started_offset_ms! - step(8).started_offset_ms!;
    expect(heldGap).toBeGreaterThan(0);
    expect(Math.min(...api.map(lag)), JSON.stringify({ api: api.map(lag), ingress: lag(ingress), heldGap })).toBeGreaterThanOrEqual(lag(ingress) + heldGap - 2);
    // causal order, independent of timing: the held records were received after the undelayed record of a later step
    const laterIngress = (await a.search({ request_id: unobs.op_id! })).find((e) => e.source_id === "ingress-sdk")!;
    expect(Math.min(...api.map((e) => Date.parse(e.received_at)))).toBeGreaterThanOrEqual(Date.parse(laterIngress.received_at));
    expect(weak.scheduled_at_ms).toBe(70);
    expect(r.truth.effects.some((e) => e.op_id === unobs.op_id && e.resource_id === "tenant-db")).toBe(true); // it happened
    expect((await a.search({ request_id: unobs.op_id! })).some((e) => e.source_id === "audit")).toBe(false); // not observed
    expect(r.result.grades.find((g) => g.label === "lw01-cross-unobserved")).toMatchObject({ pass: true, actual: { effect: "unknown" } });
  });
});

describe("LP07-A4: investigator views contain no answer labels, hidden seeds, expected action ids or oracle credentials", () => {
  it("the viewer-token view of Digital Kingdom leaks nothing from private truth; the checker itself detects a leak", async () => {
    for (const id of ["LW-01", "LW-02", "LW-03"]) {
      const d = doc(id);
      const a = await lab(d);
      const { truth, result } = await runScenario(a.w, d);
      expect(result.grades.filter((g) => !g.pass), `${id} ${JSON.stringify(result.grades)}`).toEqual([]);
      await a.w.flush();
      const view = await investigatorView({ url: a.url, viewerToken: a.viewer }, a.w.project);
      const secrets = [a.w.operatorToken, a.adminToken, ...Object.values(a.w.sourceKeys), ...a.w.world.identities.map((i) => a.w.password(i.id)), JSON.stringify(truth.labels)];
      expect(leakCheck(view, truth, secrets), id).toEqual([]);
      expect((view.snapshot as { events: unknown[] }).events.length).toBeGreaterThan(0);
      // mutation check on the checker: injecting one label must be caught
      expect(leakCheck({ ...view, note: Object.keys(truth.labels)[0] }, truth, secrets)).toEqual([Object.keys(truth.labels)[0]]);
      // private truth lives only in the run's own 0600 file
      expect(statSync(result.truth_file).mode & 0o777).toBe(0o600);
      expect(result.truth_file.startsWith(a.w.run.dir)).toBe(true);
      expect(JSON.parse(readFileSync(result.truth_file, "utf8")).scenario.seed).toBe(d.seed);
    }
  });

  it("no investigator MCP tool or API route exposes scenario truth", async () => {
    const d = doc("LW-01");
    const a = await lab(d);
    await runScenario(a.w, d);
    const mcp = createMcp(new DkClient({ baseUrl: a.url, token: a.viewer, project: a.w.project }));
    const [x, y] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "lp07", version: "1" });
    await Promise.all([mcp.connect(x), client.connect(y)]);
    const tools = (await client.listTools()).tools.map((t) => `${t.name} ${t.description ?? ""}`).join("\n");
    expect(tools).not.toMatch(/truth|oracle|scenario|seed|grading|answer key/i);
    await client.close();
    for (const p of ["/api/local-world/truth", `/api/projects/${a.w.project}/local-world/truth`, `/api/projects/${a.w.project}/scenario`, `/api/projects/${a.w.project}/local-world/runs/${a.w.run.run_id}`]) {
      expect((await fetch(a.url + p, { headers: { authorization: `Bearer ${a.viewer}` } })).status, p).toBe(404);
    }
  });
});

describe("LP07-A4: repository-resident private truth can never be served by an investigator-facing surface", () => {
  // Known limitation: the DSL documents (seed, labels, expectations) live in this repository. Investigators that can
  // read the repo are not blinded; what we guarantee here is that Digital Kingdom's own API, MCP server and web viewer
  // have no code path that reads them, and that static serving cannot be walked out of the web bundle to reach them.
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "node_modules" || e.name === "dist" ? [] : walk(join(dir, e.name))) : /\.(ts|tsx|js|mjs)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);
  it("API, MCP and web sources never reference scenario DSL documents, private truth or the scenario engine", () => {
    const files = ["apps/server/src", "apps/mcp/src", "apps/web/src"].flatMap((d) => walk(join(ROOT, d)));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // the schema id and truth-file prefix, not the M2 contract's declarative `private_truth_access: false` flag
      expect(src, f).not.toMatch(/scenarios\/local-world|scenario\.json|dk\.local\.private_truth|private-truth-|PRIVATE_TRUTH_SCHEMA|runScenario|investigatorView|world\/scenario/);
    }
  });

  it("static web serving cannot traverse from the bundle to a DSL document placed beside it", async () => {
    const root = mkdtempSync(join(tmpdir(), "dk-lp07-static-"));
    try {
      const dist = join(root, "web", "dist"); mkdirSync(dist, { recursive: true }); writeFileSync(join(dist, "index.html"), "<!doctype html><title>viewer</title>");
      const d = doc("LW-01");
      mkdirSync(join(root, "scenarios/local-world/dsl"), { recursive: true });
      writeFileSync(join(root, "scenarios/local-world/dsl/LW-01.scenario.json"), JSON.stringify(d));
      const store = new Store(openDb(":memory:"));
      const viewer = store.createToken("investigator", "viewer").token;
      const app = await buildApp({ store, secret: "lp07-static", demoMode: false, webDist: dist });
      const url = await app.listen({ port: 0, host: "127.0.0.1" });
      try {
        const paths = ["/../../scenarios/local-world/dsl/LW-01.scenario.json", "/%2e%2e/%2e%2e/scenarios/local-world/dsl/LW-01.scenario.json", "/..%2f..%2fscenarios%2flocal-world%2fdsl%2fLW-01.scenario.json", "/%252e%252e/%252e%252e/scenarios/local-world/dsl/LW-01.scenario.json", "/scenarios/local-world/dsl/LW-01.scenario.json", "/..\\..\\scenarios\\local-world\\dsl\\LW-01.scenario.json"];
        for (const p of paths) {
          const { request } = await import("node:http");
          // raw request so the client does not normalise the dot segments away
          const body = await new Promise<string>((ok, ko) => { const u = new URL(url); const r = request({ host: u.hostname, port: u.port, path: p, headers: { authorization: `Bearer ${viewer}` } }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => ok(b)); }); r.on("error", ko); r.end(); });
          expect(body, p).not.toContain(d.seed);
          expect(body, p).not.toContain("expect");
        }
      } finally { await app.close(); store.db.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe("LP07 scenario manifests", () => {
  it("LW-01..03 manifests point at valid DSL documents and at tests that exist", async () => {
    const dir = join(ROOT, "scenarios/local-world");
    const ms = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
    expect(ms.map((m) => m.id)).toEqual(["LW-01", "LW-02", "LW-03"]);
    for (const m of ms) {
      expect(m).toMatchObject({ schema: "dk.scenario.v1", execution: "local", data_policy: "synthetic_only" });
      expect(parseScenario(JSON.parse(readFileSync(join(ROOT, m.dsl), "utf8"))).id).toBe(m.id);
      for (const t of m.tests) expect(readFileSync(join(ROOT, t.file), "utf8"), `${m.id}: ${t.name}`).toContain(t.name);
    }
  });
});
