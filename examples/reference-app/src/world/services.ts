import { createHash, randomBytes } from "node:crypto";
import { templateMatches, type BuiltinService, type ServiceContext, type ServiceRegistry, type ServiceRequest, type ServiceResponse } from "@dk/local-world";

/**
 * LP06: the built-in instrumented services of the local world (trusted host-process mode).
 *
 * Every service is a small, deliberately boring implementation of one catalog template with controlled synthetic
 * data. Requests arrive only through the run supervisor (signed operation ids); services reach other resources only
 * through ctx.call to a DECLARED dependency. Each service reports what it did through its own self-report source
 * (ctx.report); effects at data/delivery points go through ctx.tap to the independent observer, which reports under
 * a different source key. No service runs code from a request, fetches a URL or touches the host filesystem.
 */
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const json = (status: number, body: unknown): ServiceResponse => ({ status, body });
const route = (req: ServiceRequest, method: string, template: string) => req.method === method && templateMatches(template, req.path.split("?")[0]!);
const seg = (req: ServiceRequest, i: number) => decodeURIComponent(req.path.split("?")[0]!.split("/")[i] ?? "");
const depOf = (ctx: ServiceContext, ...templates: string[]) => ctx.world.plan.resources.find((r) => ctx.world.plan.resources.find((x) => x.id === ctx.resource_id)!.depends_on.includes(r.id) && templates.includes(r.template))?.id ?? null;
const policy = (ctx: ServiceContext, current: { variant: string }) => current.variant;

/** Deterministic synthetic password for a synthetic account (labelled synthetic; meaningless outside the run). */
export function syntheticPassword(world: ServiceContext["world"], accountId: string): string { return `synthetic-${sha(`${world.plan.seed_commitment}:${accountId}`).slice(0, 16)}`; }

function stateful<T>(initial: T, revisionOf: (s: T) => string) {
  let state = structuredClone(initial);
  return { get: () => state, set: (s: T) => { state = s; }, snapshot: () => structuredClone(state), restore: (s: unknown) => { state = structuredClone(s as T); }, revision: () => revisionOf(state) };
}

// ---------------------------------------------------------------- auth: synthetic sign-in and sessions
const auth = (ctx: ServiceContext): BuiltinService => {
  const st = stateful({ sessions: {} as Record<string, { account: string; tenant: string | null; role: string }>, failures: {} as Record<string, number> }, () => `${ctx.resource_id}:1`);
  return {
    ...st,
    async handle(req) {
      if (route(req, "POST", "/login")) {
        const b = (req.body ?? {}) as { account?: unknown; password?: unknown };
        const account = typeof b.account === "string" ? b.account.slice(0, 80) : "";
        const id = ctx.world.identities.find((i) => i.id === account);
        const s = st.get();
        if ((s.failures[account] ?? 0) >= 5) { ctx.report?.emit({ asset: ctx.resource_id, action: "authentication", outcome: "denied", actor: account, requestId: req.op_id, rule: "login-rate-limit" }); return json(429, { error: "too many attempts" }); }
        const ok = !!id && b.password === syntheticPassword(ctx.world, account);
        if (!ok) { s.failures[account] = (s.failures[account] ?? 0) + 1; ctx.report?.emit({ asset: ctx.resource_id, action: "authentication", outcome: "failure", actor: account || "unknown", requestId: req.op_id }); return json(401, { error: "invalid credentials" }); }
        delete s.failures[account];
        const session = `ses-${randomBytes(12).toString("hex")}`;
        s.sessions[session] = { account, tenant: id!.tenant, role: id!.role };
        ctx.report?.emit({ asset: ctx.resource_id, action: "authentication", outcome: "success", actor: account, session, requestId: req.op_id });
        return json(200, { session });
      }
      if (route(req, "POST", "/sessions/verify")) {
        const sess = st.get().sessions[String((req.body as { session?: unknown } | undefined)?.session ?? "")];
        return sess ? json(200, sess) : json(401, { error: "unknown session" });
      }
      return json(404, { error: "not found" });
    },
  };
};

// ---------------------------------------------------------------- local issuer: short-lived synthetic credentials and grants
const issuer = (ctx: ServiceContext): BuiltinService => {
  const st = stateful({ creds: {} as Record<string, { subject: string; secret_digest: string; active: boolean; scope: string[] }>, grants: {} as Record<string, string[]>, seq: 0 }, (s) => `${ctx.resource_id}:grants-${sha(JSON.stringify(s.grants)).slice(0, 8)}`);
  return {
    ...st,
    async handle(req) {
      const s = st.get(); const b = (req.body ?? {}) as Record<string, unknown>;
      if (route(req, "POST", "/credentials")) {
        const subject = String(b.subject ?? "").slice(0, 80);
        if (!ctx.world.identities.some((i) => i.id === subject)) return json(400, { error: "unknown synthetic subject" });
        const id = `cred-${++s.seq}`, secret = `synthetic-${randomBytes(9).toString("hex")}`;
        s.creds[id] = { subject, secret_digest: sha(secret), active: true, scope: Array.isArray(b.scope) ? b.scope.map(String).slice(0, 8) : ["read"] };
        ctx.report?.emit({ asset: ctx.resource_id, action: "authorization_change", outcome: "success", actor: subject, requestId: req.op_id, details: { change: "credential_issued", credential: id } });
        return json(201, { id, secret, synthetic: true });
      }
      if (route(req, "POST", "/credentials/verify")) {
        const c = s.creds[String(b.id ?? "")];
        const ok = !!c && c.active && c.secret_digest === sha(String(b.secret ?? ""));
        ctx.report?.emit({ asset: ctx.resource_id, action: "authentication", outcome: ok ? "success" : "failure", actor: c?.subject ?? "unknown", requestId: req.op_id, details: { credential: String(b.id ?? "").slice(0, 40) } });
        return ok ? json(200, { account: c!.subject, tenant: null, role: "service", grants: s.grants[c!.subject] ?? [] }) : json(401, { error: "credential not valid" });
      }
      if (route(req, "POST", "/credentials/{id}/revoke")) {
        const c = s.creds[seg(req, 2)]; if (!c) return json(404, { error: "no such credential" });
        c.active = false;
        ctx.report?.emit({ asset: ctx.resource_id, action: "authorization_change", outcome: "success", actor: c.subject, requestId: req.op_id, details: { change: "credential_deactivated", credential: seg(req, 2) } });
        return json(200, { id: seg(req, 2), active: false });
      }
      if (route(req, "POST", "/grants")) {
        const subject = String(b.subject ?? "").slice(0, 80), grant = String(b.grant ?? "").slice(0, 80), op = b.op === "remove" ? "remove" : "add";
        if (!ctx.world.identities.some((i) => i.id === subject) || !/^[a-z]+:[a-z0-9-]+$/.test(grant)) return json(400, { error: "grants name a synthetic subject and a grant like read:deploy-data" });
        const cur = new Set(s.grants[subject] ?? []); if (op === "add") cur.add(grant); else cur.delete(grant); s.grants[subject] = [...cur].sort();
        ctx.report?.emit({ asset: ctx.resource_id, action: "authorization_change", outcome: "success", actor: subject, requestId: req.op_id, details: { change: `grant_${op}`, grant } });
        return json(200, { subject, grants: s.grants[subject] });
      }
      return json(404, { error: "not found" });
    },
  };
};

// ---------------------------------------------------------------- tenant store (in-process; effect tap at every read/write)
const tenantStore = (ctx: ServiceContext): BuiltinService => {
  const seed = (t: string) => Array.from({ length: 3 }, (_, i) => ({ id: `${t}-rec-${i + 1}`, tenant: t, value: `synthetic-${sha(`${ctx.world.plan.seed_commitment}:${t}:${i}`).slice(0, 8)}` }));
  const tenants = ctx.world.identities.map((i) => i.tenant).filter((t): t is string => !!t);
  const st = stateful({ records: Object.fromEntries([...new Set(tenants)].map((t) => [t, seed(t)])) as Record<string, { id: string; tenant: string; value: string }[]>, writes: 0 }, (s) => `${ctx.resource_id}:w${s.writes}`);
  return {
    ...st,
    async handle(req) {
      const b = (req.body ?? {}) as { op?: string; tenant?: string; value?: string; actor?: string };
      const tenant = String(b.tenant ?? ""), s = st.get();
      if (b.op === "read") {
        const rows = s.records[tenant] ?? [];
        ctx.tap(req.op_id, { action: "data_access", detail: { op: "read", tenant, rows: rows.length, by: req.from } });
        return json(200, { records: rows });
      }
      if (b.op === "write") {
        const rec = { id: `${tenant}-rec-${(s.records[tenant]?.length ?? 0) + 1}`, tenant, value: String(b.value ?? "").slice(0, 200) };
        (s.records[tenant] ??= []).push(rec); s.writes++;
        ctx.tap(req.op_id, { action: "data_access", detail: { op: "write", tenant, rows: 1, by: req.from } });
        return json(201, { record: rec });
      }
      return json(400, { error: "unsupported store operation" });
    },
  };
};

// ---------------------------------------------------------------- queue (in-process, bounded)
const queue = (ctx: ServiceContext): BuiltinService => {
  const st = stateful({ messages: [] as { op_id: string; tenant: string; kind: string }[], accepted: 0 }, (s) => `${ctx.resource_id}:${s.accepted}`);
  return {
    ...st,
    async handle(req) {
      const b = (req.body ?? {}) as { op?: string; tenant?: string; kind?: string }; const s = st.get();
      if (b.op === "enqueue") { if (s.messages.length >= 100) return json(503, { error: "queue full" }); s.messages.push({ op_id: req.op_id, tenant: String(b.tenant ?? ""), kind: b.kind === "report" ? "report" : "noop" }); s.accepted++; ctx.tap(req.op_id, { action: "side_effect_observed", detail: { op: "enqueue", kind: String(b.kind ?? "noop") } }); return json(202, { queued: s.messages.length }); }
      if (b.op === "dequeue") { const m = s.messages.shift(); return json(200, { message: m ?? null }); }
      return json(400, { error: "unsupported queue operation" });
    },
  };
};

// ---------------------------------------------------------------- artifact depot (content addressed, selectable deployed digest)
const depot = (ctx: ServiceContext): BuiltinService => {
  const st = stateful({ artifacts: {} as Record<string, { name: string; bytes: number; by: string }>, deployed: null as string | null }, (s) => `${ctx.resource_id}:${s.deployed ?? "none"}`);
  return {
    ...st,
    async handle(req) {
      const s = st.get(); const b = (req.body ?? {}) as { name?: unknown; content?: unknown; digest?: unknown };
      if (route(req, "POST", "/artifacts")) {
        const content = String(b.content ?? "").slice(0, 10_000), digest = sha(content);
        s.artifacts[digest] = { name: String(b.name ?? "artifact").slice(0, 80), bytes: Buffer.byteLength(content), by: req.headers?.["x-world-actor"] ?? req.from };
        ctx.tap(req.op_id, { action: "side_effect_observed", detail: { op: "publish", digest: digest.slice(0, 16), bytes: s.artifacts[digest]!.bytes } });
        return json(201, { digest });
      }
      if (route(req, "GET", "/artifacts/{digest}")) { const a = s.artifacts[seg(req, 2)]; return a ? json(200, { digest: seg(req, 2), ...a }) : json(404, { error: "no such artifact" }); }
      if (route(req, "GET", "/deployed")) return json(200, { digest: s.deployed });
      if (route(req, "POST", "/deployed")) {
        const d = String(b.digest ?? ""); if (!s.artifacts[d]) return json(404, { error: "only an existing artifact can be selected" });
        s.deployed = d; ctx.tap(req.op_id, { action: "side_effect_observed", detail: { op: "select_deployed", digest: d.slice(0, 16) } });
        return json(200, { deployed: d });
      }
      return json(404, { error: "not found" });
    },
  };
};

// ---------------------------------------------------------------- tenant API
const api = (ctx: ServiceContext): BuiltinService => {
  const st = stateful({ variant: (ctx.settings.policy_variant ?? "baseline") as string, tenant_mode: ctx.settings.tenant_mode ?? "isolated", revision: 1 }, (s) => `${ctx.resource_id}:policy-${s.variant}-r${s.revision}`);
  const authDep = depOf(ctx, "auth", "local_issuer"), store = depOf(ctx, "tenant_store"), q = depOf(ctx, "queue");
  const principal = async (req: ServiceRequest) => {
    if (!authDep) return null;
    const isIssuer = ctx.world.plan.resources.find((r) => r.id === authDep)!.template === "local_issuer";
    const h = req.headers ?? {};
    const r = isIssuer
      ? await ctx.call(authDep, { method: "POST", path: "/credentials/verify", body: { id: h["x-world-credential-id"], secret: h["x-world-credential"] } }, req.op_id)
      : await ctx.call(authDep, { method: "POST", path: "/sessions/verify", body: { session: h["x-world-session"] } }, req.op_id);
    return r.status === 200 ? (r.body as { account: string; tenant: string | null; role: string; grants?: string[] }) : null;
  };
  return {
    ...st,
    reconfigure(change) { if (change.policy_variant) { const s = st.get(); s.variant = change.policy_variant; s.revision++; } },
    async handle(req) {
      const s = st.get();
      const tmpl = route(req, "GET", "/tenants/{tenant}/records") ? "GET /tenants/{tenant}/records" : route(req, "POST", "/tenants/{tenant}/records") ? "POST /tenants/{tenant}/records" : route(req, "POST", "/tenants/{tenant}/jobs") ? "POST /tenants/{tenant}/jobs" : null;
      if (!tmpl) return json(404, { error: "not found" });
      const tenant = seg(req, 2), routeTpl = tmpl.split(" ")[1]!;
      const who = await principal(req);
      if (!who) { ctx.report?.emit({ asset: ctx.resource_id, action: "request_received", outcome: "denied", route: routeTpl, requestId: req.op_id, rule: "authentication-required" }); return json(401, { error: "authentication required" }); }
      // Tenant isolation is the reviewed policy; the deliberately weak variant skips it (a lab defect to find).
      const isolated = s.tenant_mode === "isolated" && policy(ctx, s) !== "deliberately_weak";
      const crossTenant = who.role !== "admin" && who.role !== "service" && who.tenant !== tenant;
      const grantOk = who.role !== "service" || (who.grants ?? []).includes(`read:${store ?? "data"}`) || (who.grants ?? []).includes(`write:${store ?? "data"}`);
      if ((isolated && crossTenant) || !grantOk) {
        ctx.report?.emit({ asset: ctx.resource_id, action: "request_received", outcome: "denied", route: routeTpl, actor: who.account, requestId: req.op_id, rule: grantOk ? "tenant-isolation" : "missing-grant", details: { policy_revision: st.revision() } });
        return json(403, { error: "forbidden" });
      }
      ctx.report?.emit({ asset: ctx.resource_id, action: "request_received", outcome: "success", route: routeTpl, actor: who.account, requestId: req.op_id, details: { policy_revision: st.revision() } });
      if (tmpl === "POST /tenants/{tenant}/jobs") {
        if (!q) return json(501, { error: "no queue in this world" });
        const r = await ctx.call(q, { method: "POST", path: "/enqueue", body: { op: "enqueue", tenant, kind: "report" } }, req.op_id);
        return json(r.status, r.body);
      }
      if (!store) return json(501, { error: "no store in this world" });
      const op = req.method === "GET" ? "read" : "write";
      const r = await ctx.call(store, { method: "POST", path: `/${op}`, body: { op, tenant, value: (req.body as { value?: string } | undefined)?.value } }, req.op_id);
      if (r.status < 300) ctx.report?.emit({ asset: ctx.resource_id, action: "data_access", outcome: "success", actor: who.account, route: routeTpl, requestId: req.op_id, details: { op, tenant } });
      return json(r.status, r.body);
    },
  };
};

// ---------------------------------------------------------------- ingress gateway
const gateway = (ctx: ServiceContext): BuiltinService => {
  const st = stateful({ variant: (ctx.settings.policy_variant ?? "baseline") as string, revision: 1 }, (s) => `${ctx.resource_id}:policy-${s.variant}-r${s.revision}`);
  const authDep = depOf(ctx, "auth"), apiDep = depOf(ctx, "api");
  return {
    ...st,
    reconfigure(change) { if (change.policy_variant) { const s = st.get(); s.variant = change.policy_variant; s.revision++; } },
    async handle(req) {
      const s = st.get();
      const fwd = route(req, "POST", "/login") ? authDep : (route(req, "GET", "/tenants/{tenant}/records") || route(req, "POST", "/tenants/{tenant}/jobs")) ? apiDep : null;
      const tpl = route(req, "POST", "/login") ? "/login" : route(req, "GET", "/tenants/{tenant}/records") ? "/tenants/{tenant}/records" : "/tenants/{tenant}/jobs";
      if (!fwd) return json(404, { error: "not found" });
      if (s.variant === "candidate" && fwd === apiDep && !req.headers?.["x-world-session"]) { ctx.report?.emit({ asset: ctx.resource_id, action: "request_received", outcome: "denied", route: tpl, requestId: req.op_id, rule: "edge-session-required" }); return json(401, { error: "session required at the edge" }); }
      const r = await ctx.call(fwd, { method: req.method, path: req.path, headers: req.headers ?? {}, body: req.body }, req.op_id);
      ctx.report?.emit({ asset: ctx.resource_id, action: "request_received", outcome: r.status < 400 ? "success" : "denied", route: tpl, requestId: req.op_id, details: { upstream: fwd, status: r.status, policy_revision: st.revision() } });
      return json(r.status, r.body);
    },
  };
};

// ---------------------------------------------------------------- worker (consumes queued jobs on the supervisor's tick)
const worker = (ctx: ServiceContext): BuiltinService & { tick(): Promise<void> } => {
  const st = stateful({ done: 0 }, (s) => `${ctx.resource_id}:${s.done}`);
  const q = depOf(ctx, "queue"), store = depOf(ctx, "tenant_store"), out = depOf(ctx, "artifact_depot");
  return {
    ...st,
    async handle() { return json(404, { error: "the worker has no request interface" }); },
    async tick() {
      if (!q) return;
      const m = (await ctx.call(q, { method: "POST", path: "/dequeue", body: { op: "dequeue" } }, `op-${ctx.run_id.slice(4)}-0`)).body as { message: { op_id: string; tenant: string; kind: string } | null };
      if (!m?.message) return;
      const op = m.message.op_id; // effects of the job stay attributed to the operation that queued it
      if (store) await ctx.call(store, { method: "POST", path: "/read", body: { op: "read", tenant: m.message.tenant } }, op);
      if (out) await ctx.call(out, { method: "POST", path: "/artifacts", headers: { "x-world-actor": "svc:report-worker" }, body: { name: `report-${m.message.tenant}`, content: `synthetic report for ${m.message.tenant}` } }, op);
      st.get().done++;
      ctx.report?.emit({ asset: ctx.resource_id, action: "data_access", outcome: "success", actor: "svc:report-worker", requestId: op, details: { job: m.message.kind, tenant: m.message.tenant } });
    },
  };
};

// ---------------------------------------------------------------- receiver (controlled destination)
const receiver = (ctx: ServiceContext): BuiltinService => {
  const st = stateful({ received: 0 }, (s) => `${ctx.resource_id}:${s.received}`);
  return {
    ...st,
    async handle(req) {
      if (!route(req, "POST", "/deliver")) return json(404, { error: "not found" });
      const b = (req.body ?? {}) as { body?: unknown; agent_run?: unknown };
      st.get().received++;
      ctx.tap(req.op_id, { action: "side_effect_observed", detail: { op: "deliver", destination: ctx.resource_id, bytes: Buffer.byteLength(String(b.body ?? "")), ...(typeof b.agent_run === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(b.agent_run) ? { agent_run: b.agent_run } : {}) } });
      return json(202, { accepted: true });
    },
  };
};

// ---------------------------------------------------------------- agent tool gateway
const agentGateway = (ctx: ServiceContext): BuiltinService => {
  const st = stateful({ variant: (ctx.settings.policy_variant ?? "baseline") as string, revision: 1, step: 0 }, (s) => `${ctx.resource_id}:policy-${s.variant}-r${s.revision}`);
  const receivers = ctx.world.plan.resources.filter((r) => r.template === "receiver" && ctx.world.plan.resources.find((x) => x.id === ctx.resource_id)!.depends_on.includes(r.id)).map((r) => r.id);
  const allowed = (to: string, variant: string) => variant === "deliberately_weak" ? receivers.includes(to) : to === receivers.find((r) => r.startsWith("allowed")) ;
  const store = depOf(ctx, "tenant_store");
  return {
    ...st,
    reconfigure(change) { if (change.policy_variant) { const s = st.get(); s.variant = change.policy_variant; s.revision++; } },
    async handle(req) {
      const s = st.get();
      const run = String(req.headers?.["x-world-agent-run"] ?? "");
      if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(run)) return json(400, { error: "x-world-agent-run required" });
      const base = { runtime: "local-agent-workspace", initiating_principal: "agent:support-assistant", tool_version: "1.0.0", policy_revision: st.revision() };
      const step = (asset: string, phase: "intent" | "decision" | "execution", outcome: string, tool: string, extra: Record<string, string | number | boolean> = {}) =>
        ctx.report?.emit({ asset, action: "tool_invocation", outcome, runId: run, requestId: req.op_id, agent: { phase, origin: phase === "decision" ? "policy_enforcer" : "tool_wrapper", tool, step: ++s.step, ...base }, details: extra });
      if (route(req, "POST", "/tools/send_message")) {
        const to = String((req.body as { to?: unknown } | undefined)?.to ?? "");
        step(ctx.resource_id, "intent", "attempted", "message.send", { destination: to.slice(0, 80) });
        if (!allowed(to, s.variant)) { step(ctx.resource_id, "decision", "denied", "message.send", { destination: to.slice(0, 80) }); return json(403, { error: `denied by policy ${st.revision()}` }); }
        step(ctx.resource_id, "decision", "allowed", "message.send", { destination: to });
        const r = await ctx.call(to, { method: "POST", path: "/deliver", body: { body: String((req.body as { body?: unknown }).body ?? "").slice(0, 2000), agent_run: run } }, req.op_id);
        step(ctx.resource_id, "execution", r.status < 300 ? "success" : "failure", "message.send", { destination: to, status: r.status });
        return json(r.status, r.body);
      }
      if (route(req, "POST", "/tools/search_docs")) {
        step(ctx.resource_id, "intent", "attempted", "docs.search");
        step(ctx.resource_id, "decision", "allowed", "docs.search");
        const r = store ? await ctx.call(store, { method: "POST", path: "/read", body: { op: "read", tenant: "workspace" } }, req.op_id) : json(501, {});
        step(ctx.resource_id, "execution", r.status < 300 ? "success" : "failure", "docs.search");
        return json(r.status, r.body);
      }
      return json(404, { error: "not found" });
    },
  };
};

export const BUILTIN_SERVICES: ServiceRegistry = { auth, local_issuer: issuer, tenant_store: tenantStore, queue, artifact_depot: depot, api, gateway, worker, receiver, agent_gateway: agentGateway };
