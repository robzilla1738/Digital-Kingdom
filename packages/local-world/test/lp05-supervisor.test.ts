import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyHost, compileWorld, containerProfile, instantiateBlueprint, preflight, refuseDestination, RunRefusal, ScenarioClock, Supervisor, WORLD_TEMPLATES, type ServiceRegistry } from "../src/index.ts";

/**
 * LP05 — own and isolate the local runtime. The services here are minimal trusted stubs registered by the test (the
 * real built-in services are LP06); what is under test is the supervisor: ownership, authority, lifecycle, cleanup
 * and enforcement.
 */
const hits: { resource: string; path: string }[] = [];
const stub: ServiceRegistry = Object.fromEntries(WORLD_TEMPLATES.filter((t) => t !== "observer").map((t) => [t, (ctx) => {
  let n = 0;
  return {
    async handle(req) {
      hits.push({ resource: ctx.resource_id, path: req.path });
      if (ctx.template === "receiver" && (req.body as { redirect?: string } | undefined)?.redirect) return { status: 302, headers: { location: (req.body as { redirect: string }).redirect }, body: {} };
      if (ctx.template === "gateway" && req.path.startsWith("/tenants/")) { const r = await ctx.call("api", { method: req.method, path: req.path }, req.op_id); return { status: r.status, body: { via: "ingress", api: r.body } }; }
      n++; return { status: 200, body: { resource: ctx.resource_id, op: req.op_id, n } };
    },
    snapshot: () => ({ n }), restore: (s: unknown) => { n = (s as { n: number }).n; }, revision: () => `${ctx.resource_id}@1`,
  };
}]));

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); vi.useRealTimers(); hits.length = 0; });
async function start(seed = "s", budget: Record<string, number> = {}, sup?: Supervisor) {
  const supervisor = sup ?? new Supervisor({ services: stub });
  const world = compileWorld(instantiateBlueprint("saas-storefront", { seed, budget }));
  const s = await supervisor.start(world);
  cleanups.push(async () => { if (s.run.state === "running" || s.run.state === "paused") await s.run.stop(s.operatorToken); if (s.run.state === "stopped" || s.run.state === "aborted") s.run.cleanup(); });
  return { supervisor, world, ...s };
}
const refusal = async (p: Promise<unknown> | (() => unknown), code: string) => {
  try { await (typeof p === "function" ? p() : p); } catch (e) { expect(e).toBeInstanceOf(RunRefusal); expect((e as RunRefusal).code, (e as Error).message).toBe(code); return (e as Error).message; }
  throw new Error(`expected a ${code} refusal`);
};
const listen = (h: (path: string) => void): Promise<{ server: Server; port: number }> => new Promise((r) => { const server = createServer((req, res) => { h(req.url ?? ""); res.writeHead(200).end("{}"); }); server.listen(0, "127.0.0.1", () => r({ server, port: (server.address() as { port: number }).port })); });

describe("LP05-A1: only registered, handshake-verified run endpoints can be targeted", () => {
  it("a registered resource on a declared route works and the effective peer is the registered endpoint", async () => {
    const { run, operatorToken } = await start();
    const r = await run.request(operatorToken, { resource: "auth", method: "POST", path: "/login", body: {} });
    expect(r.status).toBe(200);
    expect(r.peer).toEqual({ address: "127.0.0.1", port: run.endpoint("auth")!.port });
    expect(r.op_id).toMatch(/^op-[0-9a-f]{12}-\d+$/);
    // the gateway's call to its declared dependency also goes through the registry
    expect((await run.request(operatorToken, { resource: "ingress", method: "GET", path: "/tenants/tenant-a/records" })).body).toMatchObject({ via: "ingress", api: { resource: "api" } });
  });

  it("URLs, metadata/LAN/public addresses, unregistered ids, observers and undeclared routes are refused before any request", async () => {
    const { run, operatorToken } = await start();
    const before = hits.length;
    for (const resource of ["http://169.254.169.254/latest/meta-data", "169.254.169.254", "10.0.0.5", "localhost:8787", "ghost", "audit", "tenant-db/../auth"]) await refusal(run.request(operatorToken, { resource, method: "GET", path: "/" }), resource === "tenant-db/../auth" ? "unregistered" : "unregistered");
    for (const path of ["//169.254.169.254/x", "http://evil.example/x", "/tenants/../admin", "/tenants/a%2f..%2fadmin/records", "/admin", "/login\\x"]) await refusal(run.request(operatorToken, { resource: "auth", method: "POST", path }), "route");
    await refusal(run.request(operatorToken, { resource: "auth", method: "DELETE", path: "/login" }), "route");
    expect(hits.length).toBe(before);
  });

  it("destination policy: only an exact registered loopback endpoint passes; names and numeric spellings never resolve", () => {
    const reg = [{ resource_id: "auth", host: "127.0.0.1" as const, port: 41000 }];
    expect(refuseDestination({ host: "127.0.0.1", port: 41000 }, reg)).toBeNull();
    const cases: [string, number, RegExp][] = [
      ["127.0.0.1", 41001, /not an endpoint registered to this run/], ["127.0.0.2", 41000, /not an endpoint registered/], ["::1", 41000, /not an endpoint registered/],
      ["169.254.169.254", 80, /metadata/], ["fd00:ec2::254", 80, /metadata/], ["169.254.10.1", 80, /link local/], ["10.0.0.5", 80, /private/], ["192.168.1.10", 80, /private/], ["172.16.4.4", 80, /private/],
      ["100.64.0.1", 80, /cgnat/], ["8.8.8.8", 53, /public/], ["2606:4700::1111", 443, /public/], ["0.0.0.0", 41000, /unspecified/], ["::ffff:169.254.169.254", 80, /metadata/],
      ["localhost", 41000, /never resolved/], ["metadata.google.internal", 80, /never resolved/], ["2130706433", 41000, /ambiguous numeric/], ["0x7f000001", 41000, /ambiguous numeric/], ["0177.0.0.1", 41000, /ambiguous numeric/], ["127.1", 41000, /ambiguous numeric/],
    ];
    for (const [host, port, re] of cases) expect(refuseDestination({ host, port }, reg), host).toMatch(re);
    expect(classifyHost("::ffff:127.0.0.1")).toBe("loopback");
  });

  it("redirects are refused and never followed", async () => {
    const { run, operatorToken } = await start();
    let other = 0; const o = await listen(() => { other++; });
    cleanups.push(() => new Promise<void>((r) => o.server.close(() => r())));
    const agentWorld = compileWorld(instantiateBlueprint("agent-workspace", { seed: "r" }));
    const a = await new Supervisor({ services: stub }).start(agentWorld);
    cleanups.push(async () => { await a.run.stop(a.operatorToken); a.run.cleanup(); });
    for (const target of [`http://127.0.0.1:${o.port}/`, "http://169.254.169.254/latest/meta-data/iam/"]) {
      const msg = await refusal(a.run.request(a.operatorToken, { resource: "allowed-receiver", method: "POST", path: "/deliver", body: { redirect: target } }), "redirect");
      expect(msg).toMatch(/redirects are never followed/);
    }
    expect(other).toBe(0);
    void run; void operatorToken;
  });

  it("a different localhost service on the run's own port (listener lost, port rebound) fails the handshake before any action", async () => {
    const { run, operatorToken } = await start();
    const port = run.endpoint("auth")!.port;
    await run.loseListener(operatorToken, "auth");
    const seen: string[] = [];
    const impostor = createServer((req, res) => { seen.push(req.url ?? ""); res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ run_id: run.run_id, resource_id: "auth", proof: "0".repeat(64) })); });
    await new Promise<void>((r) => impostor.listen(port, "127.0.0.1", () => r()));
    cleanups.push(() => new Promise<void>((r) => impostor.close(() => r())));
    await refusal(run.request(operatorToken, { resource: "auth", method: "POST", path: "/login", body: { user: "x" } }), "handshake");
    expect(seen).toEqual(["/.well-known/dk-run-handshake"]); // only the challenge reached it; the action did not
  });

  it("ambient proxy settings are not used: the request goes directly to the owned endpoint", async () => {
    let proxied = 0; const proxy = await listen(() => { proxied++; });
    cleanups.push(() => new Promise<void>((r) => proxy.server.close(() => r())));
    const saved = { HTTP_PROXY: process.env.HTTP_PROXY, http_proxy: process.env.http_proxy, NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.no_proxy };
    process.env.HTTP_PROXY = process.env.http_proxy = `http://127.0.0.1:${proxy.port}`; process.env.NO_PROXY = process.env.no_proxy = "";
    try {
      const { run, operatorToken } = await start();
      const r = await run.request(operatorToken, { resource: "auth", method: "POST", path: "/login", body: {} });
      expect(r.peer.port).toBe(run.endpoint("auth")!.port);
      expect(proxied).toBe(0);
    } finally { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  it("the listener itself rejects requests that were not signed by the supervisor for this endpoint", async () => {
    const { run } = await start();
    const port = run.endpoint("auth")!.port;
    const status = await new Promise<number>((resolve, reject) => {
      const rq = httpRequest({ host: "127.0.0.1", port, method: "POST", path: "/login", headers: { "x-dk-run": run.run_id, "x-dk-op": `op-${run.run_id.slice(4)}-1`, "x-dk-op-mac": "f".repeat(64), "content-type": "application/json" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      rq.on("error", reject); rq.end("{}");
    });
    expect(status).toBe(403);
    expect(hits.filter((h) => h.resource === "auth")).toEqual([]);
  });
});

describe("LP05-A2: run tokens are bound to their run and lab project", () => {
  it("a token of one run cannot act on another run; forged tokens and labels grant nothing", async () => {
    const sup = new Supervisor({ services: stub });
    const a = await start("a", {}, sup), b = await start("b", {}, sup);
    expect(a.run.run_id).not.toBe(b.run.run_id);
    expect(a.run.project_id).not.toBe(b.run.project_id);
    await refusal(b.run.request(a.operatorToken, { resource: "auth", method: "POST", path: "/login" }), "wrong_run");
    await refusal(() => b.run.pause(a.operatorToken), "wrong_run");
    await refusal(b.run.stop(a.operatorToken), "wrong_run");
    // swap the run id inside A's token: signature no longer verifies
    const forged = a.operatorToken.replace(a.run.run_id, b.run.run_id);
    await refusal(b.run.request(forged, { resource: "auth", method: "POST", path: "/login" }), "unauthorized");
    // environment labels and caller headers do not grant authority
    process.env.DK_LAB = "1"; process.env.DK_LAB_RUN = b.run.run_id; process.env.DK_RUN_TOKEN = a.operatorToken;
    try {
      await refusal(b.run.request(a.operatorToken, { resource: "auth", method: "POST", path: "/login", headers: { "x-dk-run": b.run.run_id, "x-world-actor": "x" } }), "wrong_run");
      await refusal(b.run.request("dkrun_v1.lab", { resource: "auth", method: "POST", path: "/login" }), "unauthorized");
    } finally { delete process.env.DK_LAB; delete process.env.DK_LAB_RUN; delete process.env.DK_RUN_TOKEN; }
    // header spoofing through a legitimate token does not change which run handles the request
    const r = await a.run.request(a.operatorToken, { resource: "auth", method: "POST", path: "/login", headers: { "x-dk-run": b.run.run_id, "x-dk-op": "op-000000000000-1", host: "169.254.169.254" } });
    expect(r.peer.port).toBe(a.run.endpoint("auth")!.port);
  });

  it("a run token cannot reach a non-lab project; a forged local_run label does not make a project a lab project", async () => {
    const a = await start();
    expect(() => a.supervisor.authorize(a.operatorToken, { run_id: a.run.run_id, action: "read_effects", project_id: "shop" })).toThrow(/not this run's lab project/);
    expect(a.supervisor.isLabProject("lab-deadbeef0000")).toBe(false); // e.g. a project created with local_run provenance claiming a run id
    expect(a.supervisor.isLabProject(a.run.project_id)).toBe(true);
    expect(() => a.supervisor.authorize(a.operatorToken, { run_id: a.run.run_id, action: "read_effects", project_id: a.run.project_id })).not.toThrow();
  });

  it("least authority: a scoped token reaches only its resources and actions", async () => {
    const a = await start();
    const t = a.supervisor.issue(a.run.run_id, { resources: ["ingress"], actions: ["request_route"] });
    expect((await a.run.request(t, { resource: "ingress", method: "POST", path: "/login" })).status).toBe(200);
    await refusal(a.run.request(t, { resource: "auth", method: "POST", path: "/login" }), "scope");
    await refusal(() => a.run.pause(t), "scope");
    await refusal(a.run.stop(t), "scope");
    await refusal(() => a.run.observer(t, "audit"), "scope");
  });

  it("clone creates a new run with its own ids, endpoints, nonces and tokens from the source state", async () => {
    const a = await start();
    await a.run.request(a.operatorToken, { resource: "auth", method: "POST", path: "/login" });
    const c = await a.supervisor.clone(a.operatorToken, a.run);
    cleanups.push(async () => { await c.run.stop(c.operatorToken); c.run.cleanup(); });
    expect(c.run.run_id).not.toBe(a.run.run_id);
    expect(c.run.manifest.cloned_from).toBe(a.run.run_id);
    expect(c.run.endpoint("auth")!.port).not.toBe(a.run.endpoint("auth")!.port);
    expect(c.run.endpoint("auth")!.nonce_digest).not.toBe(a.run.endpoint("auth")!.nonce_digest);
    expect((await c.run.request(c.operatorToken, { resource: "auth", method: "POST", path: "/login" })).body).toMatchObject({ n: 2 }); // state carried over
    await refusal(c.run.request(a.operatorToken, { resource: "auth", method: "POST", path: "/login" }), "wrong_run");
  });
});

describe("LP05-A3: cleanup touches only manifest-owned resources", () => {
  it("stop + cleanup removes the run directory and listeners, is idempotent and records the manifest", async () => {
    const a = await start();
    const f = a.run.ownFile(a.operatorToken, "notes.json", "{}");
    const m = JSON.parse(readFileSync(join(a.run.dir, "run-manifest.json"), "utf8"));
    expect(m).toMatchObject({ schema: "dk.local.run_manifest.v1", run_id: a.run.run_id, supervisor_pid: process.pid, world_revision: a.world.revision });
    expect(m.listeners.map((l: { resource_id: string }) => l.resource_id).sort()).toEqual(["artifacts", "auth", "ingress", "api"].sort());
    expect(JSON.stringify(m)).not.toMatch(/"nonce"/);
    const port = a.run.endpoint("auth")!.port;
    await a.run.stop(a.operatorToken);
    await refusal(a.run.request(a.operatorToken, { resource: "auth", method: "POST", path: "/login" }), "unauthorized"); // tokens revoked
    const c1 = a.run.cleanup();
    expect(c1.outcome).toBe("completed");
    expect(c1.removed).toContain(f);
    expect(existsSync(a.run.dir)).toBe(false);
    expect(a.run.cleanup()).toMatchObject({ outcome: "completed", failures: [] });
    expect(a.run.operationalOutcome()).toEqual({ outcome: "healthy", reasons: [] });
    await expect(new Promise((resolve, reject) => { const rq = httpRequest({ host: "127.0.0.1", port, path: "/" }, resolve); rq.on("error", reject); rq.end(); })).rejects.toThrow(/ECONNREFUSED/);
  });

  it("user files, symlink swaps and hard links survive; the failure is recorded and the run is not healthy", async () => {
    const userDir = join(tmpdir(), `dk-user-${process.pid}-${Date.now()}`);
    mkdirSync(userDir, { recursive: true });
    cleanups.push(() => rmSync(userDir, { recursive: true, force: true }));
    const precious = join(userDir, "precious.txt"); writeFileSync(precious, "keep me");
    const a = await start();
    const owned1 = a.run.ownFile(a.operatorToken, "swap.json", "{}");
    const owned2 = a.run.ownFile(a.operatorToken, "linked.json", "{}");
    unlinkSync(owned1); symlinkSync(precious, owned1);                  // owned path replaced by a symlink to a user file
    linkSync(owned2, join(userDir, "user-hardlink.json"));              // user keeps a hard link to an owned file
    writeFileSync(join(a.run.dir, "dropped-by-user.txt"), "mine");    // unowned file in the run directory
    // a user directory that merely has the run's name elsewhere is never considered
    const sameName = join(userDir, a.run.run_id); mkdirSync(sameName); writeFileSync(join(sameName, "x"), "x");
    await a.run.abort(a.operatorToken, "operator abort");
    const c = a.run.cleanup();
    expect(c.outcome).toBe("failed");
    const reasons = c.failures.map((x) => x.reason).join(" | ");
    expect(reasons).toMatch(/symbolic link .* not followed or removed/);
    expect(reasons).toMatch(/2 hard links; not removed/);
    expect(reasons).toMatch(/entries this run does not own \(.*dropped-by-user\.txt/);
    expect(readFileSync(precious, "utf8")).toBe("keep me");
    expect(readFileSync(join(userDir, "user-hardlink.json"), "utf8")).toBe("{}");
    expect(readFileSync(join(a.run.dir, "dropped-by-user.txt"), "utf8")).toBe("mine");
    expect(existsSync(join(sameName, "x"))).toBe(true);
    expect(a.run.operationalOutcome().outcome).toBe("cleanup_failed");
    expect(a.run.state).toBe("cleanup_failed");
    // tidy the sandbox ourselves (the test, not the supervisor)
    rmSync(a.run.dir, { recursive: true, force: true });
  });

  it("cleanup is refused while the run is active", async () => {
    const a = await start();
    await refusal(() => a.run.cleanup(), "state");
  });
});

describe("LP05-A4: wall-clock limits, resource and network controls", () => {
  it("a frozen scenario clock and a frozen Date cannot suspend the monotonic deadline", async () => {
    const clock = new ScenarioClock("2026-10-19T14:00:00Z"); clock.freeze();
    const sup = new Supervisor({ services: stub });
    const world = compileWorld(instantiateBlueprint("saas-storefront", { seed: "d", budget: { max_seconds: 1 } }));
    const { run, operatorToken } = await sup.start(world, { scenarioClock: clock });
    cleanups.push(() => { if (run.state === "aborted") run.cleanup(); });
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-19T14:00:00Z"));
    run.pause(operatorToken); // pausing stimulus does not pause enforcement either
    await new Promise((r) => setTimeout(r, 1300));
    expect(new Date().toISOString()).toBe("2026-10-19T14:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-10-19T14:00:00.000Z");
    expect(run.state).toBe("aborted");
    expect(run.abortReason).toMatch(/monotonic deadline of 1s/);
    await refusal(run.request(operatorToken, { resource: "auth", method: "POST", path: "/login" }), "unauthorized");
  });

  it("paused stimulus is refused while the run keeps its services", async () => {
    const a = await start();
    a.run.pause(a.operatorToken);
    await refusal(a.run.request(a.operatorToken, { resource: "auth", method: "POST", path: "/login" }), "state");
    a.run.resume(a.operatorToken);
    expect((await a.run.request(a.operatorToken, { resource: "auth", method: "POST", path: "/login" })).status).toBe(200);
  });

  it("request, parallelism and concurrent-run budgets are enforced", async () => {
    const a = await start("b", { max_requests: 3, max_parallel_operations: 1 });
    // handshakes do not count; the gateway's internal call to the API does
    await a.run.request(a.operatorToken, { resource: "ingress", method: "GET", path: "/tenants/t/records" });
    await a.run.request(a.operatorToken, { resource: "auth", method: "POST", path: "/login" });
    await refusal(a.run.request(a.operatorToken, { resource: "auth", method: "POST", path: "/login" }), "budget");
    const p = await start("p", { max_parallel_operations: 1 });
    const results = await Promise.allSettled([p.run.request(p.operatorToken, { resource: "auth", method: "POST", path: "/login" }), p.run.request(p.operatorToken, { resource: "auth", method: "POST", path: "/login" })]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const limited = new Supervisor({ services: stub, maxConcurrentRuns: 1 });
    await start("c1", {}, limited);
    await expect(limited.start(compileWorld(instantiateBlueprint("saas-storefront", { seed: "c2" })))).rejects.toThrow(/concurrent run limit 1 reached/);
  });

  it("preflight reports each control honestly; container mode and missing implementations are refused", async () => {
    const plan = instantiateBlueprint("saas-storefront", { seed: "x" });
    const pf = preflight(plan, { activeRuns: 0, maxConcurrentRuns: 4, services: stub });
    expect(pf).toMatchObject({ status: "restricted", arbitrary_execution: "disabled", reasons: [] });
    const states = Object.fromEntries(pf.controls.map((c) => [c.control, c.state]));
    expect(states).toMatchObject({ request_count: "enforced", parallel_operations: "enforced", elapsed_time: "enforced", concurrent_runs: "enforced", run_disk: "enforced", memory: "checked", cpu: "not_enforced", network_egress: "not_enforced", isolation_boundary: "not_enforced", container_runtime: "not_applicable" });
    expect(preflight(plan, { activeRuns: 0, maxConcurrentRuns: 4, services: stub, rssBytes: 4e9 }).reasons.join()).toMatch(/exceeds the 1536 MB ceiling/);
    const containers = instantiateBlueprint("saas-storefront", { seed: "x", runtime_mode: "operator_isolated_containers" });
    await expect(new Supervisor({ services: stub }).start(compileWorld(containers))).rejects.toThrow(/never launches containers or uses a Docker socket/);
    const { api: _api, ...noApi } = stub;
    await expect(new Supervisor({ services: noApi }).start(compileWorld(plan))).rejects.toThrow(/no built-in implementation for template\(s\) api/);
    const profile = containerProfile(containers);
    expect(profile.digital_kingdom_launches).toBe(false);
    expect(Object.values(profile.networks)[0]).toEqual({ internal: true, driver: "bridge" });
    for (const svc of Object.values(profile.services)) {
      expect(svc).toMatchObject({ read_only: true, privileged: false, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"], pids_limit: 64 });
      expect(Object.keys(svc)).not.toEqual(expect.arrayContaining(["ports"]));
      for (const k of ["ports", "volumes", "network_mode", "env_file", "command", "entrypoint"]) expect(svc[k], k).toBeUndefined();
    }
    expect(JSON.stringify(profile.services)).not.toMatch(/docker\.sock|\/var\/run/);
    expect(profile.excluded).toContain("docker.sock");
  });

  it("a hand-edited compiled world cannot add authority: only its plan is used", async () => {
    const sup = new Supervisor({ services: stub });
    const world = compileWorld(instantiateBlueprint("saas-storefront", { seed: "h" }));
    const tampered = { ...world, sources: [...world.sources, { id: "evil", label: "x", kind: "effect_observer", asset_ids: ["api"], independence_group: "observer:evil", role: "independent_observer" as const, attached_to: "api" }] };
    const { run, operatorToken } = await sup.start(tampered);
    cleanups.push(async () => { await run.stop(operatorToken); run.cleanup(); });
    expect(run.world.sources.find((s) => s.id === "evil")).toBeUndefined();
    await expect(sup.start({ ...world, revision: "lw-0000000000000000" })).rejects.toThrow(/does not match its plan/);
  });
});
