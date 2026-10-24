import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { Agent, createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import type { HttpMethod } from "@dk/contracts";
import { templateMatches } from "@dk/graph-core";
import { TEMPLATE_CATALOG, sha256, type WorldTemplate } from "../catalog.ts";
import { compileWorld, type CompiledWorld } from "../compile.ts";
import { refuseDestination, type RegisteredEndpoint } from "./address.ts";
import { EffectObserver, type Reporter, type TapEffect } from "./observer.ts";
import { preflight, type Preflight } from "./isolation.ts";
import { LeaseRegistry, type IssueLeaseRequest, type LeaseAudit } from "./lease.ts";
import type { LabLease, RepairPlan } from "@dk/contracts";
import { REPAIR_OPERATIONS, refOf, type Compensation, type OpHost, type Pre } from "./repair-ops.ts";

/**
 * LP05: the local run supervisor. It owns everything a run uses and is the only thing that can act on it.
 *
 * - A run owns a unique run id, a project id, a private directory, a token namespace, a listener registry with one
 *   nonce per endpoint, its observers and a cleanup manifest. The plan never names an endpoint: the supervisor binds
 *   127.0.0.1 with an OS-chosen port for each built-in service that has routes and records the listener it created.
 * - Targets are registered resource ids, never URLs. Every action re-verifies the receiver's nonce handshake, connects
 *   with a private agent (no ambient proxy), checks the effective peer address/port, never follows redirects and
 *   refuses every destination that is not exactly a registered endpoint of the same run.
 * - Tokens are run-scoped HMACs with an explicit resource/action scope. A token of run A cannot act on run B or on a
 *   project the supervisor did not create; environment variables, headers and project labels grant nothing.
 * - Enforcement deadlines use the monotonic clock only. The scenario clock may be frozen; wall-clock limits are not.
 * - Cleanup removes only manifest-owned paths, never follows symlinks, refuses hard links and leaves unowned files in
 *   place; a failed cleanup is recorded as a failure and keeps the run's overall outcome from being healthy.
 *
 * Trusted host-process mode only runs the built-in service factories the supervisor was constructed with. It is not
 * a sandbox for arbitrary code, and no generic shell, URL or process executor exists here.
 */
export const RUN_MANIFEST_SCHEMA = "dk.local.run_manifest.v1";
export const monoMs = (): number => Number(process.hrtime.bigint() / 1_000_000n);

export interface OpRequest { method: HttpMethod; path: string; headers?: Record<string, string>; body?: unknown }
export interface ServiceRequest extends OpRequest { op_id: string; from: string }
export interface ServiceResponse { status: number; body?: unknown; headers?: Record<string, string> }
export interface ServiceContext {
  run_id: string; project_id: string; resource_id: string; template: WorldTemplate; settings: CompiledWorld["plan"]["resources"][number]["settings"]; world: CompiledWorld;
  /** Call a DECLARED dependency through the supervisor (registry-resolved, handshake-verified). */
  call(target: string, req: OpRequest, op_id: string): Promise<ServiceResponse>;
  /** Report an effect at this resource to its attached observers (and to the private truth log). */
  tap(op_id: string, effect: TapEffect): void;
  /** This resource's own instrumentation (self-report source), or null when its audit is disabled. */
  report: Reporter | null;
}
export interface BuiltinService {
  handle(req: ServiceRequest): Promise<ServiceResponse>; snapshot(): unknown; restore(state: unknown): void; revision(): string;
  /** Typed configuration change (policy variant only); there is no generic config write. */
  reconfigure?(change: { policy_variant?: string }): void;
  /** Background processing (e.g. a worker draining its queue). Runs while the run is running OR paused. */
  tick?(): Promise<void>;
}
export type ServiceFactory = (ctx: ServiceContext) => BuiltinService;
export type ServiceRegistry = Partial<Record<WorldTemplate, ServiceFactory>>;

export type RunAction = "request_route" | "lifecycle" | "observer_control" | "fault" | "snapshot" | "read_effects" | "configure" | "repair_execute";
/** The launcher's run token gets these. `repair_execute` is NOT among them: a controller identity is minted only by the operator (LP20). */
export const ALL_ACTIONS: RunAction[] = ["request_route", "lifecycle", "observer_control", "fault", "snapshot", "read_effects", "configure"];
export interface TokenScope { resources: string[] | "*"; actions: RunAction[] }
export type RunState = "running" | "paused" | "stopped" | "aborted" | "cleaned" | "cleanup_failed";

export class RunRefusal extends Error {
  constructor(readonly code: "unauthorized" | "wrong_run" | "not_lab_project" | "unregistered" | "destination" | "handshake" | "redirect" | "state" | "deadline" | "budget" | "route" | "scope" | "dependency" | "preflight", message: string) { super(message); this.name = "RunRefusal"; }
}

export interface OpResult { op_id: string; resource: string; method: string; path: string; status: number; body: unknown; started_mono_ms: number; ended_mono_ms: number; started: string; ended: string; peer: { address: string; port: number } }
export interface CleanupRecord { outcome: "completed" | "failed" | "pending"; removed: string[]; failures: { path: string; reason: string }[]; at: string | null }
export interface Endpoint extends RegisteredEndpoint { nonce_digest: string; revision: string }
export interface RunManifest {
  schema: typeof RUN_MANIFEST_SCHEMA; run_id: string; project_id: string; world_revision: string; plan_id: string; runtime_mode: string;
  supervisor_pid: number; created_at: string; root: string; owned_paths: { path: string; kind: "dir" | "file" }[];
  listeners: Endpoint[]; in_process: string[]; observers: { id: string; attached: string[] }[]; token_ids: string[]; cloned_from: string | null;
}

interface TokenRecord { id: string; run_id: string; scope: TokenScope; revoked: boolean }
interface Listener { server: Server; endpoint: Endpoint; nonce: Buffer; sockets: Set<import("node:net").Socket> }

export interface SupervisorOptions {
  services: ServiceRegistry; root?: string; secret?: Buffer; maxConcurrentRuns?: number; maxRunDiskBytes?: number;
  /** LP20: local lab actions. Default `plan_only`: no lease can be issued and nothing is executed. */
  labActions?: "plan_only" | "leased";
}
export interface StartOptions { reporters?: (sourceId: string) => Reporter | null; scenarioClock?: ScenarioClock; clonedFrom?: { run: Run; state: Record<string, unknown> } }

/** Evidence/scenario clock. It can be frozen or moved; it is NEVER consulted for enforcement. */
export class ScenarioClock {
  private t: number; frozen = false;
  constructor(startIso: string) { this.t = Date.parse(startIso); if (!Number.isFinite(this.t)) throw new Error("invalid scenario clock start"); }
  now(): Date { return new Date(this.t); }
  advance(ms: number) { if (ms < 0 || !Number.isFinite(ms)) throw new Error("scenario time only moves forward"); this.t += ms; }
  freeze() { this.frozen = true; }
}

export class Supervisor {
  readonly root: string;
  private readonly secret: Buffer;
  private readonly runs = new Map<string, Run>();
  private readonly tokens = new Map<string, TokenRecord>();
  private labMode: "plan_only" | "leased";
  private operatorDigest: string | null = null;
  private operatorHanded = false;
  /** LP20 lease registry (issuance is operator-only, through the methods below). */
  readonly leases: LeaseRegistry;
  constructor(readonly opts: SupervisorOptions) {
    this.secret = opts.secret ?? randomBytes(32);
    this.labMode = opts.labActions ?? "plan_only";
    this.leases = new LeaseRegistry({ secret: this.secret, labActions: () => this.labMode, run: (id) => this.runs.get(id), controllerTokenId: (t, r) => this.controllerTokenId(t, r) });
    mkdirSync(opts.root ?? tmpdir(), { recursive: true });
    this.root = realpathSync(mkdtempSync(join(opts.root ?? tmpdir(), "dk-lab-")));
  }
  /** Lab projects are exactly the projects of runs this supervisor created. Labels, env vars and meta do not count. */
  isLabProject(projectId: string): boolean { return [...this.runs.values()].some((r) => r.project_id === projectId && r.state !== "cleaned"); }
  run(runId: string): Run | undefined { return this.runs.get(runId); }
  activeRuns(): Run[] { return [...this.runs.values()].filter((r) => r.state === "running" || r.state === "paused"); }

  async start(worldInput: CompiledWorld, o: StartOptions = {}): Promise<{ run: Run; operatorToken: string; preflight: Preflight }> {
    // Recompile from the plan: a hand-edited compiled world (extra listener, other template) is refused.
    // Only the plan is taken from the caller; everything else is recompiled by trusted code, so a hand-edited
    // compiled world (extra listener, other template, other source authority) has no effect.
    const world = compileWorld(worldInput.plan, { previousScene: null });
    if (world.revision !== worldInput.revision) throw new RunRefusal("preflight", "compiled world revision does not match its plan; recompile from a validated plan");
    const pf = preflight(world.plan, { activeRuns: this.activeRuns().length, maxConcurrentRuns: this.opts.maxConcurrentRuns ?? 4, services: this.opts.services });
    if (pf.status === "refused") throw new RunRefusal("preflight", `run refused before start: ${pf.reasons.join("; ")}`);
    const runId = `run-${randomBytes(6).toString("hex")}`;
    const run = new Run(this, runId, world, pf, o);
    this.runs.set(runId, run);
    await run.boot(o);
    const operatorToken = this.issue(runId, { resources: "*", actions: [...ALL_ACTIONS] });
    return { run, operatorToken, preflight: pf };
  }

  /** Run tokens for launchers, stimulus and verifiers. A controller (`repair_execute`) identity is never minted here. */
  issue(runId: string, scope: TokenScope): string {
    if (scope.actions.includes("repair_execute")) throw new RunRefusal("unauthorized", "a repair controller identity is minted only by the operator (issueControllerToken)");
    return this.mint(runId, scope);
  }
  private mint(runId: string, scope: TokenScope): string {
    const run = this.runs.get(runId);
    if (!run) throw new RunRefusal("wrong_run", "no such run");
    const id = randomBytes(9).toString("base64url");
    this.tokens.set(id, { id, run_id: runId, scope: { resources: scope.resources === "*" ? "*" : [...scope.resources], actions: [...scope.actions] }, revoked: false });
    run.manifest.token_ids.push(id);
    return `dkrun_v1.${runId}.${id}.${this.mac(runId, id)}`;
  }
  private mac(runId: string, id: string) { return createHmac("sha256", this.secret).update(`${runId}|${id}`).digest("base64url"); }
  revokeRun(runId: string, reason = "run halted") { for (const t of this.tokens.values()) if (t.run_id === runId) t.revoked = true; this.leases.revokeRun(runId, reason); }

  // ---- LP20: operator authority, controller identity and leases ---------------------------------------------
  /** Local lab action mode. `plan_only` (default) until constructed with `leased`; the kill switch makes it permanent. */
  get labActions(): "plan_only" | "leased" { return this.labMode; }
  /**
   * The one-time operator credential. It is handed out exactly once (to whoever constructed the supervisor, i.e. the
   * launcher/operator) and is the only thing that can issue leases, mint controller identities, revoke other
   * holders' leases or pull the kill switch. A second call throws, so code that later receives the supervisor
   * object cannot obtain it.
   */
  operatorCredential(): string {
    if (this.operatorHanded) throw new RunRefusal("unauthorized", "the operator credential was already handed out");
    this.operatorHanded = true;
    const id = randomBytes(12).toString("base64url");
    const cred = `dkop_v1.${id}.${createHmac("sha256", this.secret).update(`operator|${id}`).digest("base64url")}`;
    this.operatorDigest = createHmac("sha256", this.secret).update(cred).digest("hex");
    return cred;
  }
  private assertOperator(cred: unknown, what: string) {
    const ok = typeof cred === "string" && /^dkop_v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/.test(cred) && this.operatorDigest !== null
      && timingSafeEqual(Buffer.from(createHmac("sha256", this.secret).update(cred).digest("hex")), Buffer.from(this.operatorDigest));
    if (!ok) { const kind = typeof cred !== "string" ? "no credential" : cred.startsWith("dkrun_v1.") ? "a run token" : cred.startsWith("dklease_v1.") ? "a lease" : cred.startsWith("dk_") ? "a Digital Kingdom server token" : "an unknown credential"; this.leaseRefusal(`${what} requires the supervisor operator credential; ${kind} cannot ${what}`); }
  }
  private leaseRefusal(msg: string): never { throw new RunRefusal("unauthorized", msg); }
  /** A separate controller identity for one run: it can do nothing except leased typed repairs (no stimulus, no configure, no lifecycle). */
  issueControllerToken(operatorCredential: string, runId: string): string {
    this.assertOperator(operatorCredential, "mint a controller identity");
    return this.mint(runId, { resources: "*", actions: ["repair_execute"] });
  }
  /** @internal token id of a valid controller (repair_execute) token of the run */
  controllerTokenId(token: string, runId: string): string {
    const rec = this.authorize(token, { run_id: runId, action: "repair_execute" });
    if (rec.scope.actions.length !== 1) throw new RunRefusal("scope", "a controller identity carries repair_execute only");
    return rec.id;
  }
  issueLease(operatorCredential: string, req: IssueLeaseRequest): { token: string; lease: LabLease } {
    try { this.assertOperator(operatorCredential, "issue a lease"); }
    catch (e) { this.leases.noteRefusal(typeof req?.run_id === "string" ? req.run_id : null, (e as Error).message); throw e; }
    return this.leases.issue(req);
  }
  revokeLease(operatorCredential: string, leaseId: string, reason: string) { this.assertOperator(operatorCredential, "revoke a lease"); this.leases.revoke(leaseId, reason, "operator"); }
  /** Kill switch: every outstanding lease is revoked and the supervisor is plan-only from now on. */
  killSwitch(operatorCredential: string, reason: string) { this.assertOperator(operatorCredential, "use the kill switch"); this.labMode = "plan_only"; this.leases.kill(reason); }
  leaseAudit(): LeaseAudit[] { return this.leases.audit(); }

  /** Every action goes through here. The token's own run, not any label, decides what it can reach. */
  authorize(token: string, want: { run_id: string; action: RunAction; resource?: string; project_id?: string }): TokenRecord {
    const m = /^dkrun_v1\.(run-[0-9a-f]{12})\.([A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{43})$/.exec(typeof token === "string" ? token : "");
    if (!m) throw new RunRefusal("unauthorized", "not a run token");
    const [, runId, id, mac] = m as unknown as [string, string, string, string];
    const expect = Buffer.from(this.mac(runId, id)), got = Buffer.from(mac);
    if (expect.length !== got.length || !timingSafeEqual(expect, got)) throw new RunRefusal("unauthorized", "run token signature invalid");
    const rec = this.tokens.get(id);
    if (!rec || rec.run_id !== runId) throw new RunRefusal("unauthorized", "unknown run token");
    if (rec.revoked) throw new RunRefusal("unauthorized", "run token revoked");
    if (runId !== want.run_id) throw new RunRefusal("wrong_run", `token belongs to ${runId}, not ${want.run_id}`);
    const run = this.runs.get(runId)!;
    if (want.project_id !== undefined && (want.project_id !== run.project_id || !this.isLabProject(want.project_id))) throw new RunRefusal("not_lab_project", `project ${want.project_id.slice(0, 80)} is not this run's lab project`);
    if (!rec.scope.actions.includes(want.action)) throw new RunRefusal("scope", `token scope does not include ${want.action}`);
    if (want.resource !== undefined && rec.scope.resources !== "*" && !rec.scope.resources.includes(want.resource)) throw new RunRefusal("scope", `token scope does not include resource ${want.resource}`);
    return rec;
  }

  /** Verify a run token's signature and report its identity and scope (no action is authorized by this). */
  describeToken(token: string, runId: string): { id: string; actions: RunAction[]; resources: string[] | "*" } {
    const rec = this.authorize(token, { run_id: runId, action: "read_effects" });
    return { id: rec.id, actions: [...rec.scope.actions], resources: rec.scope.resources === "*" ? "*" : [...rec.scope.resources] };
  }

  /** Clone: a NEW run (new ids, nonces, tokens, directory) from the same plan and the source run's current state. */
  async clone(token: string, source: Run, o: Omit<StartOptions, "clonedFrom"> = {}) {
    this.authorize(token, { run_id: source.run_id, action: "lifecycle" });
    return this.start(source.world, { ...o, clonedFrom: { run: source, state: source.serviceState() } });
  }
  /** @internal */ newRunDir(runId: string): string { const d = join(this.root, runId); mkdirSync(d, { mode: 0o700 }); return d; }
  /** @internal */ get services() { return this.opts.services; }
  /** @internal */ get diskCap() { return this.opts.maxRunDiskBytes ?? 10_000_000; }
}

/** Callers may pass only x-world-* headers (synthetic actor/session context); host, auth and x-dk-* are supervisor-owned. */
export function worldHeaders(h: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(h ?? {}).filter(([k, v]) => /^x-world-[a-z0-9-]{1,40}$/i.test(k) && typeof v === "string").map(([k, v]) => [k.toLowerCase(), v.slice(0, 500)]));
}

export class Run {
  readonly project_id: string;
  readonly dir: string;
  readonly manifest: RunManifest;
  state: RunState = "running";
  readonly started_mono_ms = monoMs();
  readonly deadline_mono_ms: number;
  readonly observers = new Map<string, EffectObserver>();
  readonly truth: { kind: "effect" | "operation" | "lifecycle"; at_mono_ms: number; record: Record<string, unknown> }[] = [];
  cleanupRecord: CleanupRecord = { outcome: "pending", removed: [], failures: [], at: null };
  abortReason: string | null = null;
  readonly budgetUse = { requests: 0, bytes: 0, inflight: 0, disk: 0 };
  readonly scenarioClock: ScenarioClock | null;
  private readonly services = new Map<string, BuiltinService>();
  private readonly listeners = new Map<string, Listener>();
  private readonly agent = new Agent({ keepAlive: false, maxSockets: 16 });
  private watchdog: NodeJS.Timeout | null = null;
  private opSeq = 0;

  constructor(private readonly sup: Supervisor, readonly run_id: string, readonly world: CompiledWorld, readonly preflight: Preflight, o: StartOptions) {
    this.project_id = `lab-${run_id.slice(4)}`;
    this.dir = sup.newRunDir(run_id);
    this.deadline_mono_ms = this.started_mono_ms + world.plan.budget.max_seconds * 1000;
    this.scenarioClock = o.scenarioClock ?? null;
    this.manifest = { schema: RUN_MANIFEST_SCHEMA, run_id, project_id: this.project_id, world_revision: world.revision, plan_id: world.plan.plan_id, runtime_mode: world.plan.runtime_mode, supervisor_pid: process.pid, created_at: new Date().toISOString(), root: this.dir, owned_paths: [{ path: this.dir, kind: "dir" }], listeners: [], in_process: [], observers: [], token_ids: [], cloned_from: o.clonedFrom?.run.run_id ?? null };
  }

  /** @internal */
  async boot(o: StartOptions) {
    const plan = this.world.plan;
    const reporters = o.reporters ?? (() => null);
    for (const r of plan.resources.filter((x) => x.template === "observer")) {
      const src = this.world.sources.find((s) => s.id === r.id);
      if (!src) continue; // audit disabled: no observer exists, and the gap is in the compiled world
      const obs = new EffectObserver(r.id, this.run_id, src.asset_ids, reporters(r.id), monoMs);
      this.observers.set(r.id, obs);
      this.manifest.observers.push({ id: r.id, attached: [...src.asset_ids] });
    }
    for (const r of plan.resources.filter((x) => x.template !== "observer")) {
      const factory = this.sup.services[r.template as WorldTemplate];
      if (!factory) throw new RunRefusal("preflight", `no built-in implementation for template ${r.template}`);
      const self = this.world.sources.find((s) => s.role === "self_report" && s.attached_to === r.id);
      const ctx: ServiceContext = {
        run_id: this.run_id, project_id: this.project_id, resource_id: r.id, template: r.template as WorldTemplate, settings: { ...r.settings }, world: this.world,
        call: (target, req, op) => this.internalCall(r.id, target, req, op),
        tap: (op, effect) => this.dispatchTap(r.id, op, effect),
        report: self ? reporters(self.id) : null,
      };
      const svc = factory(ctx);
      this.services.set(r.id, svc);
      if (TEMPLATE_CATALOG[r.template as WorldTemplate].routes.length) await this.listen(r.id, svc);
      else this.manifest.in_process.push(r.id);
    }
    if (o.clonedFrom) for (const [id, s] of Object.entries(o.clonedFrom.state)) this.services.get(id)?.restore(structuredClone(s));
    for (const id of this.listeners.keys()) await this.verifyHandshake(id);
    this.writeManifest();
    this.lifecycle("started", { cloned_from: this.manifest.cloned_from });
    this.watchdog = setInterval(() => {
      if (monoMs() > this.deadline_mono_ms && (this.state === "running" || this.state === "paused")) { void this.abortInternal(`monotonic deadline of ${plan.budget.max_seconds}s reached`); return; }
      // collectors/background workers keep processing while stimulus is paused
      if (this.state === "running" || this.state === "paused") void this.tickOnce();
    }, 50);
    this.watchdog.unref();
  }

  private async listen(resourceId: string, svc: BuiltinService) {
    const nonce = randomBytes(32);
    const sockets = new Set<import("node:net").Socket>();
    const server = createServer((req, res) => void this.serve(resourceId, svc, nonce, req, res));
    server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
    const port = (server.address() as { port: number }).port;
    const endpoint: Endpoint = { resource_id: resourceId, host: "127.0.0.1", port, nonce_digest: sha256(nonce.toString("hex")).slice(0, 16), revision: svc.revision() };
    this.listeners.set(resourceId, { server, endpoint, nonce, sockets });
    this.manifest.listeners.push(endpoint);
  }

  private async serve(resourceId: string, svc: BuiltinService, nonce: Buffer, req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body ?? null)); };
    try {
      const url = new URL(req.url ?? "/", "http://owned.invalid");
      if (url.pathname === "/.well-known/dk-run-handshake") {
        const ch = String(req.headers["x-dk-challenge"] ?? "");
        if (!/^[0-9a-f]{32}$/.test(ch)) return send(400, { error: "challenge required" });
        return send(200, { run_id: this.run_id, resource_id: resourceId, proof: createHmac("sha256", nonce).update(`${this.run_id}|${resourceId}|${ch}`).digest("hex") });
      }
      // Only the supervisor reaches these listeners; it always sets an operation id and the run id.
      // Only the supervisor reaches these listeners: it signs each operation id with this endpoint's nonce, so a
      // local process that knows the port, the run id or the header names still cannot drive the service.
      const op = String(req.headers["x-dk-op"] ?? ""), run = String(req.headers["x-dk-run"] ?? ""), mac = String(req.headers["x-dk-op-mac"] ?? "");
      const want = createHmac("sha256", nonce).update(`${this.run_id}|${resourceId}|${op}`).digest("hex");
      if (run !== this.run_id || !/^op-[0-9a-f]{12}-\d{1,6}$/.test(op) || mac.length !== want.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return send(403, { error: "not a supervisor request for this run" });
      let body: unknown = undefined;
      if (req.method !== "GET" && req.method !== "HEAD") {
        const chunks: Buffer[] = []; let size = 0;
        for await (const c of req) { size += (c as Buffer).length; if (size > 64_000) return send(413, { error: "body too large" }); chunks.push(c as Buffer); }
        const text = Buffer.concat(chunks).toString("utf8");
        try { body = text ? JSON.parse(text) : undefined; } catch { return send(400, { error: "invalid json" }); }
      }
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && k.startsWith("x-world-")) headers[k] = v.slice(0, 500);
      const r = await svc.handle({ method: (req.method ?? "GET") as HttpMethod, path: url.pathname + url.search, headers, body, op_id: op, from: String(req.headers["x-dk-from"] ?? "stimulus") });
      send(r.status, r.body, r.headers);
    } catch (e) { send(500, { error: `service error: ${(e as Error).message.slice(0, 200)}` }); }
  }

  private ticking: Promise<void> = Promise.resolve();
  private tickOnce(): Promise<void> {
    this.ticking = this.ticking.then(async () => {
      for (const [id, svc] of this.services) {
        if (!svc.tick || (this.state !== "running" && this.state !== "paused")) continue;
        try { await svc.tick(); } catch (e) { this.lifecycle("tick_error", { resource: id, error: (e as Error).message.slice(0, 200) }); }
      }
    });
    return this.ticking;
  }
  /** Let background processing finish deterministically (bounded rounds), e.g. before reading effects. */
  async settle(token: string, rounds = 5) { this.sup.authorize(token, { run_id: this.run_id, action: "lifecycle" }); for (let i = 0; i < rounds; i++) await this.tickOnce(); }

  /** Typed configuration action: change a resource's reviewed policy variant. Recorded in private truth. */
  configure(token: string, resource: string, change: { policy_variant: "baseline" | "candidate" | "deliberately_weak" }) {
    this.sup.authorize(token, { run_id: this.run_id, action: "configure", resource });
    this.assertActive("configure");
    const r = this.world.plan.resources.find((x) => x.id === resource);
    if (!r) throw new RunRefusal("unregistered", `${String(resource).slice(0, 80)} is not a resource of this run`);
    if (!TEMPLATE_CATALOG[r.template as WorldTemplate].supported_settings.includes("policy_variant")) throw new RunRefusal("scope", `template ${r.template} has no policy variant`);
    if (!["baseline", "candidate", "deliberately_weak"].includes(change.policy_variant)) throw new RunRefusal("scope", "policy_variant must be baseline, candidate or deliberately_weak");
    const svc = this.services.get(resource)!;
    const from = svc.revision(); svc.reconfigure?.({ policy_variant: change.policy_variant });
    this.lifecycle("configured", { resource, policy_variant: change.policy_variant, from_revision: from, to_revision: svc.revision() });
    return { resource, from_revision: from, to_revision: svc.revision() };
  }

  private dispatchTap(resourceId: string, op: string, effect: TapEffect) {
    const revision = this.services.get(resourceId)?.revision() ?? "unknown";
    this.truth.push({ kind: "effect", at_mono_ms: monoMs(), record: { op_id: op, resource_id: resourceId, revision, action: effect.action, detail: { ...effect.detail } } });
    for (const o of this.observers.values()) o.record(resourceId, op, effect, revision);
  }

  private lifecycle(event: string, detail: Record<string, unknown> = {}) { this.truth.push({ kind: "lifecycle", at_mono_ms: monoMs(), record: { event, ...detail } }); }

  private assertActive(action: string) {
    if (monoMs() > this.deadline_mono_ms) { void this.abortInternal(`monotonic deadline of ${this.world.plan.budget.max_seconds}s reached`); throw new RunRefusal("deadline", `${action} refused: the run's monotonic deadline has passed (scenario time does not extend it)`); }
    if (this.state === "paused" && action === "stimulus") throw new RunRefusal("state", "stimulus is paused; collectors and wall time continue");
    if (this.state !== "running" && this.state !== "paused") throw new RunRefusal("state", `${action} refused: run is ${this.state}`);
  }

  /** The only way a stimulus reaches a service: a registered resource id and one of its template's declared routes. */
  async request(token: string, req: OpRequest & { resource: string }): Promise<OpResult> {
    this.sup.authorize(token, { run_id: this.run_id, action: "request_route", resource: req.resource });
    this.assertActive("stimulus");
    const res = this.world.plan.resources.find((r) => r.id === req.resource);
    if (!res || res.template === "observer") throw new RunRefusal("unregistered", `${String(req.resource).slice(0, 120)} is not a registered resource of this run`);
    this.assertRoute(res.template as WorldTemplate, req);
    return this.send(req.resource, req, this.nextOp(), "stimulus");
  }

  nextOp(): string { return `op-${this.run_id.slice(4)}-${++this.opSeq}`; }

  private assertRoute(template: WorldTemplate, req: OpRequest) {
    if (typeof req.path !== "string" || !req.path.startsWith("/") || req.path.startsWith("//") || /[\s\\#]|^\/[^/]*:|%2f|%5c|\.\./i.test(req.path) || req.path.length > 300) throw new RunRefusal("route", `path ${String(req.path).slice(0, 80)} is not a relative route path`);
    const path = req.path.split("?")[0]!;
    if (!TEMPLATE_CATALOG[template].routes.some((r) => r.method === req.method && templateMatches(r.path, path))) throw new RunRefusal("route", `${req.method} ${path} is not a declared route of template ${template}`);
  }

  private async internalCall(from: string, target: string, req: OpRequest, op: string): Promise<ServiceResponse> {
    this.assertActive("internal call");
    const caller = this.world.plan.resources.find((r) => r.id === from)!;
    if (!caller.depends_on.includes(target)) throw new RunRefusal("dependency", `${from} does not declare a dependency on ${target}`);
    const t = this.world.plan.resources.find((r) => r.id === target)!;
    if (this.listeners.has(target)) {
      this.assertRoute(t.template as WorldTemplate, req);
      const r = await this.send(target, req, op, from);
      return { status: r.status, body: r.body };
    }
    const svc = this.services.get(target);
    if (!svc) throw new RunRefusal("unregistered", `${target} has no running service`);
    return svc.handle({ ...req, op_id: op, from });
  }

  /** Registry-resolved, handshake-verified, proxy-free, redirect-refusing request to an owned listener. */
  private async send(resourceId: string, req: OpRequest, op: string, from: string): Promise<OpResult> {
    const l = this.listeners.get(resourceId);
    if (!l) throw new RunRefusal("unregistered", `${resourceId} has no registered listener`);
    const refusal = refuseDestination(l.endpoint, this.manifest.listeners);
    if (refusal) throw new RunRefusal("destination", refusal);
    const budget = this.world.plan.budget;
    if (this.budgetUse.requests >= budget.max_requests) throw new RunRefusal("budget", `request budget ${budget.max_requests} reached`);
    if (this.budgetUse.inflight >= budget.max_parallel_operations && from === "stimulus") throw new RunRefusal("budget", `parallel operation budget ${budget.max_parallel_operations} reached`);
    // reserve synchronously so concurrent callers cannot both pass the checks
    this.budgetUse.requests++; if (from === "stimulus") this.budgetUse.inflight++;
    try {
    await this.verifyHandshake(resourceId);
    const started_mono_ms = monoMs(), started = new Date().toISOString();
    if (from === "stimulus") this.truth.push({ kind: "operation", at_mono_ms: started_mono_ms, record: { op_id: op, resource: resourceId, method: req.method, path: req.path.split("?")[0], phase: "sent" } });
      const body = req.body === undefined ? undefined : JSON.stringify(req.body);
      const r = await this.raw(l, { method: req.method, path: req.path, headers: { ...worldHeaders(req.headers), "x-dk-op": op, "x-dk-run": this.run_id, "x-dk-from": from, "x-dk-op-mac": createHmac("sha256", l.nonce).update(`${this.run_id}|${resourceId}|${op}`).digest("hex") }, body });
      this.budgetUse.bytes += r.bytes;
      if (r.status >= 300 && r.status < 400) throw new RunRefusal("redirect", `${resourceId} answered ${r.status}${r.location ? ` (Location ${r.location.slice(0, 100)})` : ""}; redirects are never followed`);
      if (this.budgetUse.bytes > budget.max_evidence_bytes) throw new RunRefusal("budget", `byte budget ${budget.max_evidence_bytes} reached`);
      const out: OpResult = { op_id: op, resource: resourceId, method: req.method, path: req.path.split("?")[0]!, status: r.status, body: r.json, started_mono_ms, ended_mono_ms: monoMs(), started, ended: new Date().toISOString(), peer: r.peer };
      if (from === "stimulus") this.truth.push({ kind: "operation", at_mono_ms: out.ended_mono_ms, record: { op_id: op, resource: resourceId, status: r.status, phase: "completed" } });
      return out;
    } finally { if (from === "stimulus") this.budgetUse.inflight--; }
  }

  private raw(l: Listener, r: { method: string; path: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; json: unknown; bytes: number; location: string | null; peer: { address: string; port: number } }> {
    const remaining = this.deadline_mono_ms - monoMs();
    if (remaining <= 0) return Promise.reject(new RunRefusal("deadline", "the run's monotonic deadline has passed"));
    return new Promise((resolve, reject) => {
      const rq = httpRequest({ host: l.endpoint.host, port: l.endpoint.port, method: r.method, path: r.path, agent: this.agent, headers: { host: `${l.endpoint.host}:${l.endpoint.port}`, ...(r.body !== undefined ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(r.body)) } : {}), ...r.headers }, timeout: Math.min(remaining, 10_000) });
      let peer = { address: "", port: 0 };
      rq.on("socket", (s) => s.once("connect", () => {
        peer = { address: s.remoteAddress ?? "", port: s.remotePort ?? 0 };
        if (peer.address !== l.endpoint.host || peer.port !== l.endpoint.port) { rq.destroy(new RunRefusal("destination", `effective connection ${peer.address}:${peer.port} is not the registered endpoint`)); }
      }));
      rq.on("timeout", () => rq.destroy(new RunRefusal("deadline", "request exceeded the remaining monotonic budget")));
      rq.on("error", reject);
      rq.on("response", (res) => {
        const chunks: Buffer[] = []; let size = 0;
        res.on("data", (c: Buffer) => { size += c.length; if (size > 262_144) { res.destroy(); reject(new RunRefusal("budget", "response larger than 256 KB")); } else chunks.push(c); });
        res.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); let json: unknown = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; } resolve({ status: res.statusCode ?? 0, json, bytes: size, location: typeof res.headers.location === "string" ? res.headers.location : null, peer }); });
      });
      if (r.body !== undefined) rq.write(r.body);
      rq.end();
    });
  }

  /** Receiver handshake: only the listener the supervisor created (holding this endpoint's nonce) can answer. */
  async verifyHandshake(resourceId: string): Promise<void> {
    const l = this.listeners.get(resourceId);
    if (!l) throw new RunRefusal("unregistered", `${resourceId} has no registered listener`);
    const ch = randomBytes(16).toString("hex");
    let r: Awaited<ReturnType<Run["raw"]>>;
    try { r = await this.raw(l, { method: "GET", path: "/.well-known/dk-run-handshake", headers: { "x-dk-challenge": ch } }); }
    catch (e) { throw new RunRefusal("handshake", `handshake with ${resourceId} failed: ${(e as Error).message.slice(0, 120)}`); }
    const proof = createHmac("sha256", l.nonce).update(`${this.run_id}|${resourceId}|${ch}`).digest("hex");
    const got = (r.json as { proof?: unknown; run_id?: unknown } | null);
    if (r.status !== 200 || got?.run_id !== this.run_id || typeof got.proof !== "string" || got.proof.length !== proof.length || !timingSafeEqual(Buffer.from(got.proof), Buffer.from(proof))) throw new RunRefusal("handshake", `receiver at ${l.endpoint.host}:${l.endpoint.port} did not prove it is ${resourceId} of ${this.run_id}`);
  }

  // ---- lifecycle -------------------------------------------------------------------------------------------
  pause(token: string) { this.sup.authorize(token, { run_id: this.run_id, action: "lifecycle" }); this.assertActive("pause"); this.state = "paused"; this.lifecycle("paused", { note: "stimulus paused; services, collectors and the monotonic deadline keep running" }); }
  resume(token: string) { this.sup.authorize(token, { run_id: this.run_id, action: "lifecycle" }); if (this.state !== "paused") throw new RunRefusal("state", `resume refused: run is ${this.state}`); this.assertActive("resume"); this.state = "running"; this.lifecycle("resumed"); }
  snapshot(token: string) { this.sup.authorize(token, { run_id: this.run_id, action: "snapshot" }); return { run_id: this.run_id, world_revision: this.world.revision, at_mono_ms: monoMs(), services: this.serviceState(), observers: Object.fromEntries([...this.observers].map(([k, o]) => [k, o.snapshot()])) }; }
  /** Restore service state from one of THIS run's snapshots (or a snapshot of the same world revision). */
  reset(token: string, snap: { world_revision: string; services: Record<string, unknown> }) {
    this.sup.authorize(token, { run_id: this.run_id, action: "snapshot" });
    if (snap.world_revision !== this.world.revision) throw new RunRefusal("state", "snapshot belongs to a different world revision");
    for (const [id, s] of Object.entries(snap.services)) this.services.get(id)?.restore(structuredClone(s));
    this.lifecycle("reset");
  }
  /** @internal */ serviceState(): Record<string, unknown> { return Object.fromEntries([...this.services].map(([k, s]) => [k, structuredClone(s.snapshot())])); }
  service(token: string, id: string): BuiltinService { this.sup.authorize(token, { run_id: this.run_id, action: "configure", resource: id }); const s = this.services.get(id); if (!s) throw new RunRefusal("unregistered", `${id} is not a service of this run`); return s; }
  observer(token: string, id: string): EffectObserver { this.sup.authorize(token, { run_id: this.run_id, action: "observer_control", resource: id }); const o = this.observers.get(id); if (!o) throw new RunRefusal("unregistered", `${id} is not an observer of this run`); return o; }
  endpoint(id: string): Endpoint | undefined { return this.listeners.get(id)?.endpoint; }

  /** Current revision of a run resource: the service's own revision, or the observer's health state. */
  revisionOf(id: string): string {
    const svc = this.services.get(id); if (svc) return svc.revision();
    const o = this.observers.get(id); if (o) return `${id}:observer-${o.misconfigured ? "misconfigured" : o.up ? "up" : "down"}-h${o.health.length}${o.configChanges ? `-c${o.configChanges}` : ""}`;
    throw new RunRefusal("unregistered", `${String(id).slice(0, 80)} is not a resource of ${this.run_id}`);
  }
  /**
   * Declared configuration of this run's enforcement points (`dk.local.config_snapshot.v1`): every resource whose
   * template has a reviewed policy variant, with its current variant, tenant mode and the run's revision string.
   * Operator side only (the snapshot action); it carries no scenario truth, request or effect.
   */
  configuration(token: string) {
    this.sup.authorize(token, { run_id: this.run_id, action: "snapshot" });
    const resources = this.world.plan.resources.filter((r) => TEMPLATE_CATALOG[r.template as WorldTemplate].supported_settings.includes("policy_variant") && this.services.has(r.id)).map((r) => {
      const st = (this.services.get(r.id)!.snapshot() ?? {}) as { variant?: unknown; tenant_mode?: unknown };
      const tenant = st.tenant_mode ?? r.settings?.tenant_mode;
      return { resource_id: r.id, template: r.template, policy_variant: String(st.variant ?? r.settings?.policy_variant ?? "baseline"), ...(typeof tenant === "string" ? { tenant_mode: tenant } : {}), revision: this.revisionOf(r.id) };
    }).sort((a, b) => a.resource_id.localeCompare(b.resource_id));
    return { schema: "dk.local.config_snapshot.v1" as const, run_id: this.run_id, resources };
  }
  /**
   * next-B: observer capability state (`dk.local.observer_state.v1`) — for every observer resource of the plan, its
   * state (running / stopped / misconfigured, or absent when the compiled world has no live observer for it), what it
   * is declared to observe, what it observes now, since when, its run revision and its capability history. Operator
   * side only (the snapshot action), read from the supervisor's own observer objects; it carries no scenario truth,
   * request or effect.
   */
  observerCapabilities(token: string) {
    this.sup.authorize(token, { run_id: this.run_id, action: "snapshot" });
    const started = this.manifest.created_at;
    const observers = this.world.plan.resources.filter((r) => r.template === "observer").map((r) => {
      const o = this.observers.get(r.id);
      if (!o) return { observer_id: r.id, state: "absent" as const, declared: [...r.depends_on].sort(), observes: [] as string[], since: started, revision: null, reason: "no live observer in this run (disabled in the compiled world); nothing in the run can restart it", history: [] as { state: string; since: string; until: string | null; reason: string }[] };
      const cur = o.capability[o.capability.length - 1]!;
      return { observer_id: r.id, state: o.capabilityState, declared: [...o.declared].sort(), observes: o.up ? o.attached.sort() : [], since: cur.since, revision: this.revisionOf(r.id), reason: cur.reason, history: o.capability.map((h) => ({ ...h })) };
    }).sort((a, b) => a.observer_id.localeCompare(b.observer_id));
    return { schema: "dk.local.observer_state.v1" as const, run_id: this.run_id, observers };
  }
  revisions(): Record<string, string> { return Object.fromEntries([...this.services.keys(), ...this.observers.keys()].sort().map((id) => [id, this.revisionOf(id)])); }
  // ---- LP21: leased typed repairs (the supervisor side; the journalled state machine is the RepairController) ----
  private readonly repairPre = new Map<string, Pre>();
  private journalBytes = 0;
  private opHost(): OpHost {
    return {
      template: (id) => this.world.plan.resources.find((r) => r.id === id)?.template,
      state: (id) => { const svc = this.services.get(id); return svc ? structuredClone(svc.snapshot()) as Record<string, unknown> : null; },
      observerUp: (id) => this.observers.get(id)?.healthy, // up AND attached to everything it is declared to observe
      send: async (resource, path, body) => {
        const t = this.world.plan.resources.find((r) => r.id === resource);
        if (!t || !this.listeners.has(resource)) throw new RunRefusal("unregistered", `${resource} has no registered listener`);
        const req: OpRequest = { method: "POST", path, body };
        this.assertRoute(t.template as WorldTemplate, req);
        const op = this.nextOp();
        const r = await this.send(resource, req, op, "controller");
        return { status: r.status, op_id: op };
      },
      reconfigure: (id, variant) => { this.services.get(id)!.reconfigure?.({ policy_variant: variant }); },
      restartObserver: (id) => { this.observers.get(id)!.restart("restarted by a leased repair"); },
    };
  }
  private controllerId(token: string): string { return this.sup.authorize(token, { run_id: this.run_id, action: "repair_execute" }).id; }

  /**
   * Execute ONE leased typed action of a plan (supervisor side). Checks the controller identity and the lease
   * (expiry, revocation, run, controller, plan digest, action, revision, replay, budget), resolves the reference in
   * this run, records the use, applies the one fixed operation and confirms the new revision with the lease. The
   * caller (the controller) journals before and after; nothing here takes a command, URL or path from the plan.
   */
  async leasedOperation(controllerToken: string, leaseToken: string, plan: RepairPlan, actionId: string, o: { idempotency_key: string; reapply?: boolean }) {
    const ctl = this.controllerId(controllerToken);
    this.assertActive("leased repair");
    const { rec, action } = this.sup.leases.authorizeAction(leaseToken, { run: this, plan, action_id: actionId, controller_token_id: ctl, idempotency_key: o.idempotency_key, ...(o.reapply ? { reapply: true } : {}) });
    const op = REPAIR_OPERATIONS[action.type], host = this.opHost(), ref = refOf(action), target = action.target_resource_id;
    const why = op.resolve(host, ref, target);
    if (why) throw new RunRefusal("unregistered", `action ${action.id}: ${why}`);
    const from = this.revisionOf(target);
    const preKey = `${rec.lease.lease_id}|${action.id}`;
    if (!this.repairPre.has(preKey)) this.repairPre.set(preKey, op.capture(host, ref, target));
    this.sup.leases.consume(rec, action.id, o.idempotency_key);
    const res = await op.apply(host, ref, target);
    const to = this.revisionOf(target), desired = op.desired(host, ref, target);
    this.lifecycle("repair_operation", { lease_id: rec.lease.lease_id, action_id: action.id, type: action.type, target, op_id: res.op_id, status: res.status, from_revision: from, to_revision: to, desired });
    if (desired && to !== from) this.sup.leases.confirmApplied(rec, action, to);
    return { action_id: action.id, from_revision: from, to_revision: to, op_id: res.op_id, status: res.status, desired };
  }
  /** Read-only: is the action's effect present now, and at what revision is its target? (crash reconciliation) */
  repairObservation(controllerToken: string, action: { type: keyof typeof REPAIR_OPERATIONS; target_resource_id: string; parameters: Record<string, string | undefined> }) {
    this.controllerId(controllerToken);
    const op = REPAIR_OPERATIONS[action.type];
    const ref = refOf(action as never);
    return { desired: op.desired(this.opHost(), ref, action.target_resource_id), revision: this.revisionOf(action.target_resource_id) };
  }
  /** Compensate one applied action of a lease, from the pre-state the RUN captured (never one the controller supplies). */
  async compensateAction(controllerToken: string, leaseToken: string, plan: RepairPlan, actionId: string): Promise<Compensation> {
    const ctl = this.controllerId(controllerToken);
    const rec = this.sup.leases.authorizeCompensation(leaseToken, { run: this, action_id: actionId, controller_token_id: ctl });
    const action = plan.actions.find((a) => a.id === actionId);
    const pre = this.repairPre.get(`${rec.lease.lease_id}|${actionId}`);
    if (!action || !pre) return { outcome: "failed", reason: `no captured pre-state for ${String(actionId).slice(0, 80)}` };
    if (this.state !== "running" && this.state !== "paused") return { outcome: "failed", reason: `run is ${this.state}` };
    const c = await REPAIR_OPERATIONS[action.type].compensate(this.opHost(), refOf(action), action.target_resource_id, pre);
    this.lifecycle("repair_compensation", { lease_id: rec.lease.lease_id, action_id: actionId, outcome: c.outcome });
    return c;
  }
  /** The holder gives up its lease (cancellation). */
  relinquishLease(controllerToken: string, leaseToken: string, reason: string) { this.sup.leases.revokeToken(leaseToken, reason, this.controllerId(controllerToken)); }
  leaseOf(controllerToken: string, leaseToken: string) { this.controllerId(controllerToken); return this.sup.leases.view(leaseToken); }

  /** Run-owned append-only repair journal (bounded; removed by cleanup with the rest of the run). */
  appendJournal(controllerToken: string, entry: Record<string, unknown>) {
    this.controllerId(controllerToken);
    const p = join(this.dir, "repair-journal.jsonl");
    const line = JSON.stringify({ ...entry, at: new Date().toISOString(), at_mono_ms: monoMs() }) + "\n";
    if (this.journalBytes + Buffer.byteLength(line) > 1_000_000) throw new RunRefusal("budget", "repair journal budget (1 MB) reached");
    if (!this.manifest.owned_paths.some((x) => x.path === p)) { this.manifest.owned_paths.push({ path: p, kind: "file" }); this.writeManifest(); }
    appendFileSync(p, line, { mode: 0o600 });
    this.journalBytes += Buffer.byteLength(line);
  }
  readJournal(controllerToken: string): Record<string, unknown>[] {
    this.controllerId(controllerToken);
    const p = join(this.dir, "repair-journal.jsonl");
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  // ---- LP22: read-only access for an independent verifier ------------------------------------------------------
  /** An observer's per-operation answer (read_effects only; the verifier cannot stop, restart or feed an observer). */
  observerAnswer(token: string, observerId: string, op_id: string, interval: { from_mono_ms: number; to_mono_ms: number }, resource: string, settleMs: number) {
    this.sup.authorize(token, { run_id: this.run_id, action: "read_effects" });
    const r = this.world.plan.resources.find((x) => x.id === observerId);
    const o = this.observers.get(observerId);
    if (!r || r.template !== "observer" || !o) throw new RunRefusal("unregistered", `${String(observerId).slice(0, 80)} is not an independent observer of ${this.run_id}`);
    return o.answer(op_id, interval, resource, settleMs);
  }
  /** The verifier's identity and scope (requires read_effects; a controller identity has none). */
  describeVerifier(token: string) { return this.sup.describeToken(token, this.run_id); }
  /** Let background work (e.g. a worker draining jobs) make progress, for bounded settling (read_effects only). */
  async settleFor(token: string, rounds = 1) { this.sup.authorize(token, { run_id: this.run_id, action: "read_effects" }); for (let i = 0; i < Math.min(rounds, 10); i++) await this.tickOnce(); }

  /** @internal LP20 audit transitions are also part of the run's private truth. */
  recordLeaseTransition(e: LeaseAudit) { this.lifecycle(`lease_${e.transition}`, { lease_id: e.lease_id, by: e.by, detail: e.detail }); }

  /** Fault injection inside the run: the listener disappears (as if the process died). Its port may then be reused. */
  async loseListener(token: string, id: string) {
    this.sup.authorize(token, { run_id: this.run_id, action: "fault", resource: id });
    const l = this.listeners.get(id); if (!l) throw new RunRefusal("unregistered", `${id} has no listener`);
    for (const s of l.sockets) s.destroy();
    await new Promise<void>((r) => l.server.close(() => r()));
    this.lifecycle("listener_lost", { resource: id, port: l.endpoint.port });
  }

  /** Write a file owned by this run (recorded in the manifest, size-bounded). */
  ownFile(token: string, name: string, content: string): string {
    this.sup.authorize(token, { run_id: this.run_id, action: "snapshot" });
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/.test(name) || name.includes("..")) throw new RunRefusal("route", "owned file names are plain names inside the run directory");
    const bytes = Buffer.byteLength(content);
    if (this.budgetUse.disk + bytes > this.sup.diskCap) throw new RunRefusal("budget", `run disk budget ${this.sup.diskCap} bytes reached`);
    const p = join(this.dir, name);
    writeFileSync(p, content, { flag: "wx", mode: 0o600 });
    this.budgetUse.disk += bytes;
    this.manifest.owned_paths.push({ path: p, kind: "file" });
    this.writeManifest();
    return p;
  }

  private writeManifest() {
    const p = join(this.dir, "run-manifest.json");
    if (!this.manifest.owned_paths.some((x) => x.path === p)) this.manifest.owned_paths.push({ path: p, kind: "file" });
    writeFileSync(p, JSON.stringify(this.manifest, null, 1), { mode: 0o600 });
  }

  async stop(token: string) { this.sup.authorize(token, { run_id: this.run_id, action: "lifecycle" }); await this.halt("stopped", "stopped by operator"); }
  async abort(token: string, reason: string) { this.sup.authorize(token, { run_id: this.run_id, action: "lifecycle" }); await this.abortInternal(reason); }
  private async abortInternal(reason: string) { if (this.state === "aborted" || this.state === "stopped" || this.state === "cleaned" || this.state === "cleanup_failed") return; this.abortReason = reason.slice(0, 300); await this.halt("aborted", this.abortReason); }
  private async halt(to: "stopped" | "aborted", why: string) {
    if (this.state !== "running" && this.state !== "paused") return;
    this.state = to;
    this.sup.revokeRun(this.run_id, `run ${to}: ${why}`);
    if (this.watchdog) clearInterval(this.watchdog);
    for (const l of this.listeners.values()) { for (const s of l.sockets) s.destroy(); await new Promise<void>((r) => l.server.close(() => r())); }
    this.agent.destroy();
    for (const o of this.observers.values()) o.stop(`run ${to}`, false);
    this.lifecycle(to, { reason: why });
  }

  /**
   * Remove exactly the manifest-owned paths. Idempotent. Never follows a symlink, refuses hard links, never removes
   * an unowned entry, and records every failure. Requires a halted run. Callable by the supervisor after token
   * revocation, so it takes no token.
   */
  cleanup(): CleanupRecord {
    if (this.state === "running" || this.state === "paused") throw new RunRefusal("state", "stop or abort the run before cleanup");
    const removed: string[] = [], failures: { path: string; reason: string }[] = [];
    const inside = (p: string) => { try { const real = realpathSync(dirname(p)); return real === this.dir || real.startsWith(this.dir + sep) || p === this.dir; } catch { return false; } };
    const owned = new Set(this.manifest.owned_paths.map((x) => x.path));
    for (const entry of [...this.manifest.owned_paths].reverse()) {
      const p = entry.path;
      if (!(p === this.dir || p.startsWith(this.dir + sep))) { failures.push({ path: p, reason: "outside the run directory; not touched" }); continue; }
      let st: ReturnType<typeof lstatSync>;
      try { st = lstatSync(p); } catch { continue; } // already gone: idempotent
      if (!inside(p)) { failures.push({ path: p, reason: "canonical parent escapes the run directory; not touched" }); continue; }
      if (st.isSymbolicLink()) { failures.push({ path: p, reason: "is a symbolic link (replaced after creation); not followed or removed" }); continue; }
      if (entry.kind === "file") {
        if (!st.isFile()) { failures.push({ path: p, reason: "no longer a regular file; not removed" }); continue; }
        if (st.nlink > 1) { failures.push({ path: p, reason: `has ${st.nlink} hard links; not removed` }); continue; }
        try { unlinkSync(p); removed.push(p); } catch (e) { failures.push({ path: p, reason: `unlink failed: ${(e as Error).message.slice(0, 120)}` }); }
      } else {
        if (!st.isDirectory()) { failures.push({ path: p, reason: "no longer a directory; not removed" }); continue; }
        const left = readdirSync(p);
        const unowned = left.filter((n) => !owned.has(join(p, n)));
        if (unowned.length) { failures.push({ path: p, reason: `contains entries this run does not own (${unowned.slice(0, 5).map((n) => basename(n)).join(", ")}); left in place` }); continue; }
        if (left.length) { failures.push({ path: p, reason: "owned entries could not be removed; directory left in place" }); continue; }
        try { rmdirSync(p); removed.push(p); } catch (e) { failures.push({ path: p, reason: `rmdir failed: ${(e as Error).message.slice(0, 120)}` }); }
      }
    }
    const prior = this.cleanupRecord.removed;
    this.cleanupRecord = { outcome: failures.length ? "failed" : "completed", removed: [...prior, ...removed], failures, at: new Date().toISOString() };
    this.state = failures.length ? "cleanup_failed" : "cleaned";
    this.lifecycle(failures.length ? "cleanup_failed" : "cleaned", { failures: failures.length });
    return this.cleanupRecord;
  }

  /** Operational outcome is separate from any security assertion: failed cleanup is never a healthy run. */
  operationalOutcome(): { outcome: "healthy" | "aborted" | "cleanup_failed" | "cleanup_pending" | "active"; reasons: string[] } {
    if (this.state === "running" || this.state === "paused") return { outcome: "active", reasons: [] };
    if (this.state === "cleanup_failed") return { outcome: "cleanup_failed", reasons: this.cleanupRecord.failures.map((f) => `${f.path}: ${f.reason}`) };
    if (this.state !== "cleaned") return { outcome: "cleanup_pending", reasons: ["cleanup has not run"] };
    if (this.abortReason) return { outcome: "aborted", reasons: [this.abortReason] };
    return { outcome: "healthy", reasons: [] };
  }
}
