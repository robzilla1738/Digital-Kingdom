import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Graph } from "@dk/contracts";
import { ImportValidationError, importCompose, importManifest } from "@dk/graph-core";
import { planScene, type ModelCall } from "@dk/scene-compiler";
import { HttpError, Store, type Principal } from "./store.ts";
import { eventDetail, parseSearchQuery, searchEvents } from "./investigate.ts";
import { checkShape, atLeast, type Role } from "./security.ts";
import { exportCase, verifyCase } from "./export.ts";
import { falcoToIngest } from "./adapters/falco.ts";
import { otlpToIngest, gunzipCapped } from "./adapters/otlp.ts";
import { assessChange, securityContext, summarize } from "./context.ts";
import { coverageHistory, parseCoverageQuestion } from "./coverage-history.ts";
import { bundleEvents, createBundle, findingRevision, getBundle, pinBundle } from "./bundles.ts";
import { Cases } from "./cases.ts";
import { buildHierarchy, footprintCollisions } from "@dk/scene-compiler";
import { RECIPES, runRecipe } from "./recipes.ts";
import { GithubDiscovery, type FetchLike } from "./github-discovery.ts";
import { CAPABILITY_LEVELS, CONNECTORS } from "./adapters/connectors.ts";

export interface AppConfig {
  store: Store;
  secret: string;
  /** Anonymous read-only access to synthetic projects only. Never grants access to live projects. */
  demoMode: boolean;
  planner?: ModelCall | null;
  webDist?: string;
  /** Mark cookies Secure (behind TLS). */
  secureCookies?: boolean;
  ssePollMs?: number;
  logger?: boolean;
  /** R02.3: fetch used for read-only GitHub discovery (tests inject fixtures). Defaults to global fetch. */
  githubFetch?: FetchLike;
  githubToken?: string;
}

declare module "fastify" {
  interface FastifyRequest { principal?: Principal; viaCookie?: boolean }
}

const COOKIE = "dk_session";
const MAX_BATCH = 500;

export async function buildApp(cfg: AppConfig): Promise<FastifyInstance> {
  const { store } = cfg;
  const app = Fastify({ logger: cfg.logger ?? false, bodyLimit: 1_048_576, onProtoPoisoning: "error", onConstructorPoisoning: "error", trustProxy: false });

  // ---- hardening ----
  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    reply.header("cross-origin-opener-policy", "same-origin");
    reply.header("content-security-policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const enc = String(req.headers["content-encoding"] ?? "identity").toLowerCase();
    // OTLP/HTTP exporters gzip by default; that route decompresses with a hard output cap (see otlp.ts).
    const otlpGzip = req.url.split("?")[0] === "/v1/traces" && enc === "gzip";
    if (enc !== "identity" && !otlpGzip) throw new HttpError(415, "compressed request bodies are not accepted");
  });
  app.addHook("preValidation", async (req) => {
    if (req.body !== undefined && typeof req.body === "object") {
      const problem = checkShape(req.body);
      if (problem) throw new HttpError(413, problem);
    }
  });
  app.addContentTypeParser(["text/plain", "application/yaml", "application/x-yaml", "text/yaml"], { parseAs: "string", bodyLimit: 524_288 }, (_req, body, done) => done(null, body));

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ ...(err.extra ?? {}), error: err.message, details: err.details });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.status(status).send({ error: status >= 500 ? "internal error" : err.message });
  });

  // ---- authentication ----
  const userPrincipal = (req: FastifyRequest): Principal | undefined => {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      const p = store.authenticateToken(auth.slice(7).trim());
      if (!p) throw new HttpError(401, "invalid token");
      return p;
    }
    const sid = parseCookie(req.headers.cookie)[COOKIE];
    if (sid) { const p = store.authenticateSession(sid); if (p) { req.viaCookie = true; return p; } }
    if (cfg.demoMode) return { kind: "anonymous-demo", id: "anonymous", name: "anonymous (demo)", role: "viewer", projects: [], principalType: "human" };
    return undefined;
  };
  const authed = (minRole: Role = "viewer") => async (req: FastifyRequest) => {
    const p = userPrincipal(req);
    if (!p) throw new HttpError(401, "authentication required");
    if (!atLeast(p.role, minRole)) throw new HttpError(403, `requires ${minRole} role`);
    // CSRF: cookie-authenticated writes must carry a custom header (forces a CORS preflight cross-site).
    if (req.viaCookie && req.method !== "GET" && req.headers["x-dk-request"] !== "1") throw new HttpError(403, "missing X-DK-Request header");
    req.principal = p;
  };
  const sourceAuth = async (req: FastifyRequest) => {
    const auth = req.headers.authorization;
    const key = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;
    const src = store.authenticateSource(key);
    if (!src) throw new HttpError(401, "invalid source key");
    (req as FastifyRequest & { source: typeof src }).source = src;
  };
  const who = (req: FastifyRequest) => req.principal!.kind === "anonymous-demo" ? "anonymous" : `${req.principal!.name} (${req.principal!.id})`;
  const P = (req: FastifyRequest) => (req.params as { p: string }).p;

  // ---- health ----
  app.get("/healthz", async () => {
    store.db.prepare("SELECT 1").get();
    return { status: "ok", backlog: store.backlog(), checkpoint: store.checkpoint(), time: store.now().toISOString() };
  });

  // ---- session ----
  app.post("/api/session", async (req, reply) => {
    const token = (req.body as { token?: string } | undefined)?.token;
    const p = store.authenticateToken(token);
    if (!p) throw new HttpError(401, "invalid token");
    const sid = store.createSession(p.id);
    store.audit(`${p.name} (${p.id})`, "session.create", null, null, {});
    reply.header("set-cookie", `${COOKIE}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${cfg.secureCookies ? "; Secure" : ""}`);
    return { name: p.name, role: p.role };
  });
  app.delete("/api/session", async (req, reply) => {
    const sid = parseCookie(req.headers.cookie)[COOKIE];
    if (sid) store.deleteSession(sid);
    reply.header("set-cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return { ok: true };
  });
  /**
   * Token delegation policy (scoped delegation, never escalation):
   *  - only HUMAN admin tokens may issue tokens (service identities can never mint identities);
   *  - requested projects must be a subset of the issuer's scope; omitted projects default to the
   *    issuer's own scope, never to "*";
   *  - only an installation admin (human, admin, projects "*") may issue "*"-scoped tokens;
   *  - a role can never exceed the issuer's role; service tokens are never admins.
   */
  app.post("/api/tokens", { preHandler: authed("admin") }, async (req) => {
    const issuer = req.principal!;
    const b = req.body as { name?: string; role?: Role; principal_type?: "human" | "service"; projects?: string[] | "*" };
    if (issuer.kind !== "token" || issuer.principalType !== "human") throw new HttpError(403, "only human admin tokens may issue tokens");
    if (!b?.name || !b.role || !["viewer", "analyst", "admin"].includes(b.role)) throw new HttpError(400, "name and role (viewer|analyst|admin) are required");
    if (!atLeast(issuer.role, b.role)) throw new HttpError(403, "cannot issue a role above your own");
    const type = b.principal_type ?? "human";
    if (!["human", "service"].includes(type)) throw new HttpError(400, "principal_type must be human or service");
    if (type === "service" && b.role === "admin") throw new HttpError(400, "service tokens cannot be admins");
    let scope: "*" | string[];
    if (b.projects === undefined) scope = issuer.projects;
    else if (b.projects === "*") scope = "*";
    else if (Array.isArray(b.projects) && b.projects.length) scope = [...new Set(b.projects.map(String))];
    else throw new HttpError(400, "projects must be \"*\" or a non-empty list of project ids");
    if (scope === "*" && issuer.projects !== "*") throw new HttpError(403, "only an installation admin may issue tokens for all projects");
    if (scope !== "*") {
      const outside = issuer.projects === "*" ? [] : scope.filter((p) => !(issuer.projects as string[]).includes(p));
      if (outside.length) throw new HttpError(403, `cannot delegate access to projects outside your scope: ${outside.join(", ")}`);
      const unknown = scope.filter((p) => !store.getProject(p));
      if (unknown.length) throw new HttpError(422, `unknown projects: ${unknown.join(", ")}`);
    }
    const t = store.createToken(b.name, b.role, scope, undefined, type);
    store.audit(who(req), "token.create", scope === "*" ? null : scope.length === 1 ? scope[0]! : null, t.id, { role: b.role, principal_type: type, projects: scope });
    return { id: t.id, token: t.token, role: b.role, principal_type: type, projects: scope, note: "Shown once; only its hash is stored." };
  });
  /**
   * Revocation (R00.4). A human admin may revoke a token whose scope lies inside their own; only an
   * installation admin may revoke "*"-scoped tokens. The last active installation admin cannot be revoked.
   */
  app.post("/api/tokens/:id/revoke", { preHandler: authed("admin") }, async (req) => {
    const issuer = req.principal!;
    if (issuer.kind !== "token" || issuer.principalType !== "human") throw new HttpError(403, "only human admin tokens may revoke tokens");
    const id = String((req.params as { id: string }).id).slice(0, 64);
    const t = store.getTokenMeta(id);
    if (!t) throw new HttpError(404, "unknown token");
    if (t.projects === "*" ? issuer.projects !== "*" : issuer.projects !== "*" && t.projects.some((p) => !(issuer.projects as string[]).includes(p))) throw new HttpError(403, "cannot revoke a token outside your scope");
    if (!t.revoked && t.role === "admin" && t.projects === "*" && t.principalType === "human") {
      const others = store.db.prepare("SELECT COUNT(*) AS n FROM api_tokens WHERE role = 'admin' AND project_ids = '*' AND principal_type = 'human' AND revoked = 0 AND id <> ?").get(id) as { n: number };
      if (!others.n) throw new HttpError(409, "cannot revoke the last active installation admin");
    }
    const changed = store.revokeToken(id, who(req));
    return { id, revoked: true, changed };
  });
  app.get("/api/me", { preHandler: authed() }, async (req) => ({ name: req.principal!.name, role: req.principal!.role, kind: req.principal!.kind, demo_mode: cfg.demoMode }));

  // ---- projects ----
  app.get("/api/projects", { preHandler: authed() }, async (req) => store.listProjects(req.principal!).map((p) => ({ id: p.id, name: p.name, dataset_kind: p.dataset_kind })));
  app.post("/api/projects", { preHandler: authed("admin") }, async (req) => {
    if (req.principal!.projects !== "*") throw new HttpError(403, "only an installation admin may create projects");
    const b = req.body as { id: string; name: string; dataset_kind?: "live" | "synthetic" };
    const proj = store.createProject(b.id, b.name ?? b.id, b.dataset_kind ?? "live");
    store.audit(who(req), "project.create", proj.id, null, { dataset_kind: proj.dataset_kind });
    return proj;
  });

  app.get("/api/projects/:p/snapshot", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const events = store.listEvents(proj.id, { limit: 5000 });
    const head = store.outboxHead();
    return {
      project: { id: proj.id, name: proj.name, dataset_kind: proj.dataset_kind, meta: proj.meta },
      graph: store.getGraph(proj.id) ?? null,
      scene: store.getScene(proj.id) ?? null,
      sources: store.listSources(proj.id).map(({ id, label, kind, asset_ids, disabled, independence_group, allowed_actions, identity_namespace, run_namespace, config_revision, connector_id }) => ({ id, label, kind, asset_ids, disabled, independence_group, allowed_actions, identity_namespace, run_namespace, config_revision, connector_id })),
      events,
      evidence: store.evidenceFor(proj.id, events.flatMap((e) => e.evidence_refs)),
      findings: store.listFindings(proj.id),
      ...store.evaluation(proj.id),
      cursor: head.max,
      server_time: store.now().toISOString(),
      role: req.principal!.role,
      planner_available: !!cfg.planner,
    };
  });

  app.get("/api/projects/:p/events", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const q = req.query as { asset?: string; after?: string; before?: string; limit?: string };
    return store.listEvents(proj.id, { ...q, limit: q.limit ? Number(q.limit) : 1000 });
  });
  // Event-level investigation: read-only, viewer role, project authorization re-checked on every page.
  // R01.5: searches run synchronously on the server's single event loop, so each request is bounded by work
  // budgets and each principal by a rate limit; one caller cannot starve ingestion with back-to-back searches.
  const searchCalls = new Map<string, number[]>();
  app.get("/api/projects/:p/events/search", { preHandler: authed() }, async (req, reply) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const key = req.principal!.id, now = Date.now();
    const recent = (searchCalls.get(key) ?? []).filter((t) => now - t < 10_000);
    if (recent.length >= 30) { reply.header("retry-after", "10"); throw new HttpError(429, "too many searches: at most 30 per 10 seconds per principal"); }
    recent.push(now); searchCalls.set(key, recent);
    const { query, cursor } = parseSearchQuery((req.query ?? {}) as Record<string, unknown>);
    return searchEvents(store, proj.id, query, cfg.secret, cursor);
  });
  app.get("/api/projects/:p/events/:id", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    return eventDetail(store, proj.id, (req.params as { id: string }).id);
  });
  app.get("/api/projects/:p/evidence/:ref", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const e = store.getEvidence(proj.id, (req.params as { ref: string }).ref);
    if (!e) throw new HttpError(404, "evidence not found");
    return { ref: (req.params as { ref: string }).ref, derivative: "redacted-at-ingestion", record: e };
  });
  app.get("/api/projects/:p/findings", { preHandler: authed() }, async (req) => store.listFindings(store.require(req.principal!, P(req), "viewer").id));
  app.get("/api/projects/:p/findings/:id", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const asOf = (req.query as { as_of?: string }).as_of;
    if (asOf !== undefined && (typeof asOf !== "string" || asOf.length > 40 || Number.isNaN(Date.parse(asOf)) || !/T.*(Z|[+-]\d{2}:?\d{2})$/.test(asOf))) throw new HttpError(400, "as_of must be an ISO 8601 timestamp with an offset");
    const d = store.getFinding(proj.id, (req.params as { id: string }).id, asOf ? { asOf } : {});
    if (!d) throw new HttpError(404, "finding not found");
    return d;
  });
  app.get("/api/projects/:p/quarantine", { preHandler: authed("admin") }, async (req) => {
    const proj = store.require(req.principal!, P(req), "admin");
    return { records: store.listQuarantine(proj.id) };
  });
  app.get("/api/projects/:p/findings/:id/evidence", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const q = req.query as { offset?: string; limit?: string };
    return store.findingEvidence(proj.id, (req.params as { id: string }).id, Math.max(0, Number(q.offset ?? 0) || 0), Number(q.limit ?? 200) || 200);
  });
  app.post("/api/projects/:p/findings/:id/disposition", { preHandler: authed("analyst") }, async (req) => {
    const proj = store.require(req.principal!, P(req), "analyst");
    const b = (req.body ?? {}) as { lifecycle?: "open" | "acknowledged" | "closed"; disposition?: "unreviewed" | "benign" | "expected_test" | "true_positive" | "false_positive"; note?: string; expected_state_version?: unknown };
    if (b.lifecycle && !["open", "acknowledged", "closed"].includes(b.lifecycle)) throw new HttpError(400, "invalid lifecycle");
    if (b.disposition && !["unreviewed", "benign", "expected_test", "true_positive", "false_positive"].includes(b.disposition)) throw new HttpError(400, "invalid disposition");
    if (b.note !== undefined && typeof b.note !== "string") throw new HttpError(400, "note must be a string");
    const ev = b.expected_state_version;
    if (ev !== undefined && (typeof ev !== "number" || !Number.isInteger(ev) || ev < 0)) throw new HttpError(400, "expected_state_version must be a non-negative integer");
    return store.setDisposition(proj.id, (req.params as { id: string }).id, who(req), { ...(b.lifecycle ? { lifecycle: b.lifecycle } : {}), ...(b.disposition ? { disposition: b.disposition } : {}), ...(b.note ? { note: b.note } : {}), ...(ev !== undefined ? { expected_state_version: ev as number } : {}) });
  });
  app.get("/api/projects/:p/health", { preHandler: authed() }, async (req) => store.health(store.require(req.principal!, P(req), "viewer").id));

  // ---- graph & scene ----
  app.post("/api/projects/:p/graph", { preHandler: authed("admin") }, async (req) => {
    const proj = store.require(req.principal!, P(req), "admin");
    const q = req.query as { format?: "json" | "compose" | "manifest"; revision?: string; environment?: string };
    let graph: Graph; let unresolved: string[] = [];
    if (q.format === "compose" || q.format === "manifest") {
      if (typeof req.body !== "string") throw new HttpError(400, "send the file as text/plain or application/yaml");
      const revision = q.revision ?? `r-${Date.now()}`;
      let r: ReturnType<typeof importManifest>;
      try { r = q.format === "compose" ? importCompose(req.body, { projectId: proj.id, environment: q.environment ?? "default", revision }) : importManifest(req.body, { revision }); }
      catch (e) { if (e instanceof ImportValidationError) throw new HttpError(422, e.message, e.issues); throw e; }
      graph = { ...r.graph, project_id: proj.id, dataset_kind: proj.dataset_kind };
      unresolved = r.unresolved;
    } else graph = req.body as Graph;
    const { scene, warnings } = store.putGraph(proj.id, graph, who(req));
    return { graph_revision: graph.graph_revision, scene_digest: scene.digest, reflow_zones: scene.reflow_zones, warnings, unresolved };
  });
  app.get("/api/projects/:p/scene", { preHandler: authed() }, async (req) => store.getScene(store.require(req.principal!, P(req), "viewer").id) ?? null);
  app.post("/api/projects/:p/scene", { preHandler: authed("analyst") }, async (req) => {
    const proj = store.require(req.principal!, P(req), "analyst");
    // Layout is presentation, not security truth, so the precondition is optional: send If-Match with the scene
    // digest you edited to get 409 instead of overwriting a newer layout (R01.4).
    const ifMatch = req.headers["if-match"];
    if (typeof ifMatch === "string" && ifMatch.trim()) {
      const cur = store.getScene(proj.id)?.digest;
      if (cur && ifMatch.replace(/^W\//, "").replace(/"/g, "").trim() !== cur) throw new HttpError(409, "the scene changed since you loaded it", [], { current: { scene_digest: cur } });
    }
    return store.applyProposal(proj.id, req.body, "user", who(req));
  });
  // R06.1: semantic hierarchy (presentation only), searchable index, layout version and legacy collision report.
  app.get("/api/projects/:p/scene/hierarchy", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const scene = store.getScene(proj.id), graph = store.getGraph(proj.id);
    if (!scene || !graph) throw new HttpError(404, "project has no scene");
    return { ...buildHierarchy(graph, scene), layout_version: scene.layout_version ?? null, collisions: footprintCollisions(scene), scene_digest: scene.digest };
  });
  app.get("/api/projects/:p/scene/locate/:asset", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const scene = store.getScene(proj.id);
    if (!scene) throw new HttpError(404, "project has no scene");
    const id = (req.params as { asset: string }).asset;
    const live = scene.rooms.find((r) => r.asset_id === id);
    if (live) return { asset_id: id, state: "current", room: live };
    const hist = scene.historical_rooms?.find((r) => r.asset_id === id);
    if (hist) return { asset_id: id, state: "historical", room: hist, note: `Last position before it left the graph in revision ${hist.retired_in_revision}; not a live structure.` };
    throw new HttpError(404, "asset has no current or historical position");
  });
  app.post("/api/projects/:p/scene/reflow", { preHandler: authed("admin") }, async (req) => {
    const proj = store.require(req.principal!, P(req), "admin");
    const scene = store.getScene(proj.id);
    const row = store.db.prepare("SELECT proposal FROM scenes WHERE project_id = ? AND graph_revision = ?").get(proj.id, scene?.graph_revision ?? "") as { proposal: string } | undefined;
    if (!row) throw new HttpError(404, "no scene");
    return store.applyProposal(proj.id, JSON.parse(row.proposal), scene!.proposal_source, who(req), true);
  });
  app.post("/api/projects/:p/scene/plan", { preHandler: authed("analyst") }, async (req) => {
    const proj = store.require(req.principal!, P(req), "analyst");
    const graph = store.getGraph(proj.id);
    if (!graph) throw new HttpError(404, "no graph");
    const r = await planScene(graph, cfg.planner ?? null, { maxAttempts: 3 });
    const apply = (req.query as { apply?: string }).apply === "1";
    const scene = apply ? store.applyProposal(proj.id, r.proposal, r.source === "planner" ? "planner" : "default", who(req)) : null;
    return { source: r.source, attempts: r.attempts, errors: r.errors, proposal: r.proposal, applied: !!scene, scene };
  });

  // ---- sources ----
  app.get("/api/projects/:p/sources", { preHandler: authed() }, async (req) => store.listSources(store.require(req.principal!, P(req), "viewer").id));
  app.post("/api/projects/:p/sources", { preHandler: authed("admin") }, async (req) => {
    const proj = store.require(req.principal!, P(req), "admin");
    const b = req.body as { id: string; label: string; kind?: string; asset_ids?: string[]; trusts_request_ids?: boolean; stale_after_seconds?: number; dataset_kind?: "live" | "synthetic"; allowed_actions?: string[]; independence_group?: string; identity_namespace?: string; run_namespace?: string; expected_revision?: unknown; sampling_ratio?: unknown; retention_days?: unknown; outcomes_reported?: unknown; connector_id?: unknown; granted_scopes?: unknown };
    if (b?.expected_revision !== undefined && (typeof b.expected_revision !== "number" || !Number.isInteger(b.expected_revision) || b.expected_revision < 0)) throw new HttpError(400, "expected_revision must be a non-negative integer");
    if (!b?.id || !b.label) throw new HttpError(400, "id and label are required");
    const r = store.upsertSource(proj.id, {
      id: b.id, label: b.label, kind: b.kind ?? "generic", asset_ids: Array.isArray(b.asset_ids) ? b.asset_ids.map(String).slice(0, 200) : [], trusts_request_ids: !!b.trusts_request_ids,
      ...(b.stale_after_seconds ? { stale_after_seconds: Number(b.stale_after_seconds) } : {}), ...(b.dataset_kind ? { dataset_kind: b.dataset_kind } : {}),
      ...(Array.isArray(b.allowed_actions) ? { allowed_actions: b.allowed_actions.map(String) as never } : {}),
      ...(b.independence_group ? { independence_group: String(b.independence_group).slice(0, 64) } : {}),
      ...(b.identity_namespace !== undefined && b.identity_namespace !== "" ? { identity_namespace: b.identity_namespace as string } : {}),
      ...(b.run_namespace !== undefined && b.run_namespace !== "" ? { run_namespace: b.run_namespace as string } : {}),
      ...(b.sampling_ratio !== undefined ? { sampling_ratio: b.sampling_ratio as number } : {}),
      ...(b.retention_days !== undefined ? { retention_days: b.retention_days as number } : {}),
      ...(b.outcomes_reported !== undefined ? { outcomes_reported: b.outcomes_reported as string[] } : {}),
      ...(typeof b.connector_id === "string" ? { connector_id: b.connector_id } : {}),
      ...(Array.isArray(b.granted_scopes) && b.granted_scopes.every((x) => typeof x === "string" && x.length <= 200) ? { granted_scopes: b.granted_scopes as string[] } : {}),
    }, who(req), { requirePrecondition: true, ...(b.expected_revision !== undefined ? { expectedRevision: b.expected_revision as number } : {}) });
    return { ...r, note: "Store this key now; it is shown once and only its hash is kept." };
  });

  app.get("/api/projects/:p/sources/:id/history", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const id = (req.params as { id: string }).id;
    if (!store.listSources(proj.id).some((x) => x.id === id)) throw new HttpError(404, "source not found");
    return { source_id: id, revisions: store.sourceHistory(proj.id, id), note: "Revisions recorded since configuration history began (migration 5). Earlier history is unknown, not absent." };
  });
  app.post("/api/projects/:p/sources/:id/state", { preHandler: authed("admin") }, async (req) => {
    const proj = store.require(req.principal!, P(req), "admin");
    const b = (req.body ?? {}) as { disabled?: unknown; expected_revision?: unknown; reason?: unknown; effective_at?: unknown };
    if (typeof b.disabled !== "boolean") throw new HttpError(400, "disabled must be true or false");
    if (typeof b.expected_revision !== "number" || !Number.isInteger(b.expected_revision)) throw new HttpError(428, "expected_revision is required");
    if (typeof b.reason !== "string" || !b.reason.trim()) throw new HttpError(400, "reason is required");
    if (b.effective_at !== undefined && (typeof b.effective_at !== "string" || Number.isNaN(Date.parse(b.effective_at)) || !/T.*(Z|[+-]\d{2}:?\d{2})$/.test(b.effective_at))) throw new HttpError(400, "effective_at must be an ISO 8601 timestamp with an offset");
    return store.setSourceState(proj.id, (req.params as { id: string }).id, b.disabled, who(req), { expectedRevision: b.expected_revision, reason: b.reason, ...(b.effective_at ? { effectiveAt: b.effective_at as string } : {}) });
  });

  // ---- immutable investigation bundles and historical revisions (R01.3) ----
  const intParam = (v: unknown, k: string, min: number) => {
    if (v === undefined || v === "") return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min) throw new HttpError(400, `${k} must be an integer >= ${min}`);
    return n;
  };
  app.get("/api/projects/:p/findings/:id/revisions/:rev", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const prm = req.params as { id: string; rev: string };
    return findingRevision(store, proj.id, prm.id, intParam(prm.rev, "revision", 1)!);
  });
  app.post("/api/projects/:p/findings/:id/bundles", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const b = (req.body ?? {}) as { revision?: unknown };
    const revision = intParam(b.revision, "revision", 1);
    return createBundle(store, proj.id, (req.params as { id: string }).id, who(req), revision !== undefined ? { revision } : {});
  });
  app.get("/api/projects/:p/bundles/:bid", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    return getBundle(store, proj.id, (req.params as { bid: string }).bid);
  });
  app.get("/api/projects/:p/bundles/:bid/events", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const q = req.query as Record<string, unknown>;
    return bundleEvents(store, proj.id, (req.params as { bid: string }).bid, intParam(q.offset, "offset", 0) ?? 0, intParam(q.limit, "limit", 1) ?? 200);
  });
  app.post("/api/projects/:p/bundles/:bid/pin", { preHandler: authed("analyst") }, async (req) => {
    const proj = store.require(req.principal!, P(req), "analyst");
    const reason = (req.body as { reason?: unknown } | undefined)?.reason;
    if (typeof reason !== "string" || !reason.trim()) throw new HttpError(400, "reason is required");
    return pinBundle(store, proj.id, (req.params as { bid: string }).bid, who(req), reason);
  });

  // ---- historical, question-specific coverage (R01.2) ----
  app.get("/api/projects/:p/coverage/history", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    return coverageHistory(store, proj.id, parseCoverageQuestion(req.query as Record<string, unknown>));
  });

  // ---- versioned facts (R01.1) ----
  const isoParam = (v: unknown, k: string) => {
    if (v === undefined || v === "") return undefined;
    if (typeof v !== "string" || v.length > 40 || Number.isNaN(Date.parse(v)) || !/T.*(Z|[+-]\d{2}:?\d{2})$/.test(v)) throw new HttpError(400, `${k} must be an ISO 8601 timestamp with an offset`);
    return v;
  };
  app.get("/api/projects/:p/facts", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const q = req.query as Record<string, unknown>;
    const validAt = isoParam(q.valid_at, "valid_at"), knownAt = isoParam(q.known_at, "known_at");
    return store.facts.view(proj.id, { ...(validAt ? { validAt } : {}), ...(knownAt ? { knownAt } : {}), ...(typeof q.entity === "string" ? { entityRef: q.entity.slice(0, 300) } : {}), includeRetired: q.include_retired === "true" });
  });
  app.get("/api/projects/:p/facts/conflicts", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const q = req.query as Record<string, unknown>;
    const validAt = isoParam(q.valid_at, "valid_at"), knownAt = isoParam(q.known_at, "known_at");
    return store.facts.conflicts(proj.id, { ...(validAt ? { validAt } : {}), ...(knownAt ? { knownAt } : {}) });
  });
  app.get("/api/projects/:p/facts/entities/:ref", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    return store.facts.history(proj.id, String((req.params as { ref: string }).ref).slice(0, 300));
  });
  app.post("/api/projects/:p/facts/assertions", { preHandler: authed("admin") }, async (req) => {
    const proj = store.require(req.principal!, P(req), "admin");
    const r = store.facts.recordAssertion(proj.id, (req.body ?? {}) as Record<string, unknown>, who(req));
    store.audit(who(req), "facts.assertion", proj.id, r.entity_ref, { id: r.id, attribute: r.attribute, source_ref: r.source_ref, type: r.assertion_type });
    return r;
  });
  app.post("/api/projects/:p/facts/reconciliations", { preHandler: authed("analyst") }, async (req) => {
    const proj = store.require(req.principal!, P(req), "analyst");
    const r = store.facts.reconcile(proj.id, (req.body ?? {}) as Record<string, unknown>, who(req));
    store.audit(who(req), "facts.reconcile", proj.id, r.entity_ref, r);
    return r;
  });

  // ---- containment (proposals only) ----
  app.get("/api/projects/:p/containment", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    return { catalog: store.containmentCatalog(proj.id), requests: store.listContainment(proj.id) };
  });
  app.post("/api/projects/:p/containment", { preHandler: authed("analyst") }, async (req) => {
    const proj = store.require(req.principal!, P(req), "analyst");
    const b = req.body as { finding_id: string; action_id: string; rationale?: string };
    return store.requestContainment(proj.id, String(b.finding_id), String(b.action_id), String(b.rationale ?? ""), who(req), req.principal!.principalType);
  });
  app.post("/api/projects/:p/containment/:id/decision", { preHandler: authed("admin") }, async (req) => {
    const proj = store.require(req.principal!, P(req), "admin");
    const d = (req.body as { decision?: string }).decision;
    if (d !== "approved" && d !== "rejected") throw new HttpError(400, "decision must be approved or rejected");
    return store.decideContainment(proj.id, (req.params as { id: string }).id, d, who(req), req.principal!.id, req.principal!.principalType);
  });

  // ---- agent context (shared with the MCP server) ----
  app.get("/api/projects/:p/context", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const q = req.query as { asset?: string; route?: string; environment?: string };
    return securityContext(store, proj.id, { ...(q.asset ? { asset: String(q.asset) } : {}), ...(q.route ? { route: String(q.route) } : {}), ...(q.environment ? { environment: String(q.environment).slice(0, 160) } : {}) });
  });
  app.post("/api/projects/:p/assess-change", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const b = (req.body ?? {}) as Record<string, unknown>;
    const strList = (v: unknown, k: string) => { if (v === undefined) return undefined; if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.length > 300)) throw new HttpError(400, `${k} must be a list of strings (at most 300 characters each)`); return v as string[]; };
    if (b.environment !== undefined && (typeof b.environment !== "string" || b.environment.length > 160)) throw new HttpError(400, "environment must be a string of at most 160 characters");
    const asset_ids = strList(b.asset_ids, "asset_ids"), routes = strList(b.routes, "routes");
    return assessChange(store, proj.id, { ...(asset_ids ? { asset_ids } : {}), ...(routes ? { routes } : {}), ...(b.environment ? { environment: b.environment as string } : {}), ...(typeof b.summary === "string" ? { summary: b.summary } : {}) });
  });
  app.get("/api/projects/:p/overview", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const graph = store.getGraph(proj.id);
    const findings = store.listFindings(proj.id).filter((f) => f.lifecycle !== "closed");
    const ev = store.evaluation(proj.id);
    return {
      project: { id: proj.id, name: proj.name, dataset_kind: proj.dataset_kind },
      assets: graph?.assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, owner: a.owner, sensitivity: a.sensitivity })) ?? [],
      open_findings: findings.map(summarize),
      coverage: ev.coverage, unobserved_asset_ids: ev.unobserved_asset_ids,
    };
  });

  // ---- export ----
  app.post("/api/projects/:p/cases/:id/export", { preHandler: authed("analyst") }, async (req) => {
    const proj = store.require(req.principal!, P(req), "analyst");
    const id = (req.params as { id: string }).id;
    // Durable cases (R03.1) have case_ ids; any other id is the finding-scoped export kept for compatibility.
    return id.startsWith("case_") ? cases.export(proj.id, id, who(req), cfg.secret) : exportCase(store, proj.id, id, who(req), cfg.secret);
  });

  // ---- connector manifests (R02.1) ----
  app.get("/api/connectors", { preHandler: authed() }, async () => ({ connectors: CONNECTORS, capability_levels: CAPABILITY_LEVELS,
    note: "Levels: declared < discovered < instrumented < analyzed < lab_verified < live_verified. Connectors collect only; response authority is never granted to a connector." }));

  // ---- read-only repository discovery (R02.3) ----
  const discovery = new GithubDiscovery(store, cfg.githubFetch ?? (globalThis.fetch as unknown as FetchLike), cfg.githubToken ?? process.env.DK_GITHUB_TOKEN);
  app.post("/api/projects/:p/discovery/github/preview", { preHandler: authed("admin") }, async (req) => discovery.preview(store.require(req.principal!, P(req), "admin").id, (req.body ?? {}) as Record<string, unknown>));
  app.post("/api/projects/:p/discovery/github/apply", { preHandler: authed("admin") }, async (req) => discovery.apply(store.require(req.principal!, P(req), "admin").id, (req.body ?? {}) as Record<string, unknown>, who(req)));

  // ---- investigation recipes (R03.2) ----
  app.get("/api/recipes", { preHandler: authed() }, async () => ({ recipes: RECIPES.map(({ id, version, title, applies_to, alternates }) => ({ id, version, title, applies_to, alternates })) }));
  app.post("/api/projects/:p/recipes/:rid/run", { preHandler: authed() }, async (req) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const b = (req.body ?? {}) as { finding_id?: unknown; max_queries?: unknown; case_id?: unknown; expected_version?: unknown };
    if (typeof b.finding_id !== "string") throw new HttpError(400, "finding_id is required");
    const result = runRecipe(store, proj.id, (req.params as { rid: string }).rid, b.finding_id, cfg.secret, typeof b.max_queries === "number" ? b.max_queries : 6);
    if (typeof b.case_id !== "string") return result;
    // Attaching to a case is an explicit analyst write: open hypotheses become case hypotheses.
    store.require(req.principal!, proj.id, "analyst");
    let version = typeof b.expected_version === "number" ? b.expected_version : -1;
    let c: ReturnType<Cases["get"]> | undefined;
    for (const h of result.hypotheses) { c = cases.addItem(proj.id, b.case_id, { kind: "hypothesis", text: `[${result.recipe.id}@${result.recipe.version}] ${h.statement} Needs: ${h.needs}`.slice(0, 1000), expected_version: version }, who(req)); version = c.version; }
    const stops = result.stop_conditions.filter((s) => s.triggered).map((s) => s.reason);
    c = cases.addItem(proj.id, b.case_id, { kind: "note", text: `Recipe ${result.recipe.id}@${result.recipe.version} on ${b.finding_id}: ${result.conclusion_allowed ? "no stop condition triggered" : `conclusion blocked: ${stops.join(" ")}`} ${result.unlinked_follow_on_event_ids.length} unlinked follow-on event(s).`.slice(0, 4000), expected_version: version }, who(req));
    return { ...result, case: { id: c.id, version: c.version } };
  });

  // ---- durable cases (R03.1) ----
  const cases = new Cases(store);
  const body = (req: FastifyRequest) => ((req.body && typeof req.body === "object" && !Array.isArray(req.body)) ? req.body : {}) as Record<string, unknown>;
  const CP = (req: FastifyRequest) => (req.params as { id: string }).id;
  app.get("/api/projects/:p/cases", { preHandler: authed() }, async (req) => ({ cases: cases.list(store.require(req.principal!, P(req), "viewer").id) }));
  app.post("/api/projects/:p/cases", { preHandler: authed("analyst") }, async (req) => cases.create(store.require(req.principal!, P(req), "analyst").id, body(req), who(req)));
  app.get("/api/projects/:p/cases/:id", { preHandler: authed() }, async (req) => cases.get(store.require(req.principal!, P(req), "viewer").id, CP(req)));
  app.post("/api/projects/:p/cases/:id", { preHandler: authed("analyst") }, async (req) => cases.update(store.require(req.principal!, P(req), "analyst").id, CP(req), body(req), who(req)));
  app.post("/api/projects/:p/cases/:id/items", { preHandler: authed("analyst") }, async (req) => cases.addItem(store.require(req.principal!, P(req), "analyst").id, CP(req), body(req), who(req)));
  app.post("/api/projects/:p/cases/:id/items/:item/question", { preHandler: authed("analyst") }, async (req) => cases.setQuestion(store.require(req.principal!, P(req), "analyst").id, CP(req), (req.params as { item: string }).item, body(req), who(req)));
  app.post("/api/projects/:p/cases/:id/items/:item/remove", { preHandler: authed("analyst") }, async (req) => cases.removeItem(store.require(req.principal!, P(req), "analyst").id, CP(req), (req.params as { item: string }).item, body(req), who(req)));
  app.post("/api/projects/:p/cases/:id/status", { preHandler: authed("analyst") }, async (req) => cases.setStatus(store.require(req.principal!, P(req), "analyst").id, CP(req), body(req), who(req), req.principal!.role));
  app.post("/api/verify-export", { preHandler: authed("viewer") }, async (req) => verifyCase(req.body, cfg.secret));
  // Installation admins see the whole audit log; project admins only their projects' entries.
  app.get("/api/audit", { preHandler: authed("admin") }, async (req) => {
    const p = req.principal!;
    const project = (req.query as { project?: string }).project;
    if (project) { store.require(p, project, "admin"); return store.listAudit(project); }
    if (p.projects === "*") return store.listAudit();
    return p.projects.flatMap((id) => store.listAudit(id) as { id: number }[]).sort((a, b) => b.id - a.id).slice(0, 200);
  });

  // ---- live updates (SSE, resumable) ----
  app.get("/api/projects/:p/stream", { preHandler: authed() }, async (req, reply) => {
    const proj = store.require(req.principal!, P(req), "viewer");
    const q = req.query as { cursor?: string };
    let cursor = Number(req.headers["last-event-id"] ?? q.cursor ?? store.outboxHead().max);
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    const send = (type: string, id: number | null, data: unknown) => res.write(`${id !== null ? `id: ${id}\n` : ""}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    const { min } = store.outboxHead();
    if (cursor && min && cursor < min - 1) send("resync", null, { reason: "cursor older than retained updates; refetch snapshot" });
    send("hello", cursor, { cursor });
    let beat = 0;
    const tick = () => {
      try {
        const rows = store.outboxSince(proj.id, cursor, 101);
        if (rows.length > 100) {
          // a slow client gets an aggregate instruction, never an unbounded backlog
          cursor = store.outboxHead().max;
          send("resync", cursor, { reason: "too many updates; refetch snapshot" });
          return;
        }
        for (const r of rows) { cursor = r.seq; send(r.type, r.seq, r.payload); }
        if (!rows.length) { const head = store.outboxHead().max; if (head > cursor) cursor = head; }
        if (++beat % Math.max(1, Math.round(15000 / (cfg.ssePollMs ?? 500))) === 0) res.write(": heartbeat\n\n");
      } catch { cleanup(); }
    };
    const timer = setInterval(tick, cfg.ssePollMs ?? 500);
    const cleanup = () => { clearInterval(timer); try { res.end(); } catch { /* closed */ } };
    req.raw.on("close", cleanup);
  });

  // ---- ingestion (source-key authenticated) ----
  type SrcReq = FastifyRequest & { source: { projectId: string; sourceId: string } };
  const ingestOne = (req: SrcReq, payload: unknown) => store.receive(req.source.projectId, req.source.sourceId, payload);
  const respond = (reply: FastifyReply, results: ReturnType<typeof ingestOne>[]) => {
    const accepted = results.filter((r) => r.status === "accepted").length;
    const duplicate = results.filter((r) => r.status === "duplicate").length;
    const rejected = results.filter((r) => r.status === "rejected");
    reply.status(rejected.length === results.length ? 422 : 202);
    return { accepted, duplicate, rejected: rejected.length, errors: rejected.slice(0, 20).map((r) => r.status === "rejected" && { reason: r.reason, detail: r.detail }), durable: true };
  };
  app.post("/ingest/events", { preHandler: sourceAuth, bodyLimit: 1_048_576 }, async (req, reply) => {
    const b = req.body as { events?: unknown[] } | unknown;
    const list = b && typeof b === "object" && Array.isArray((b as { events?: unknown[] }).events) ? (b as { events: unknown[] }).events : [b];
    if (list.length > MAX_BATCH) throw new HttpError(413, `batch limit is ${MAX_BATCH}`);
    return respond(reply, list.map((e) => ingestOne(req as SrcReq, e)));
  });
  // R02.1: a collector's account of one collection window (complete, partial, denied, throttled, revoked, error).
  app.post("/ingest/collection-report", { preHandler: sourceAuth, bodyLimit: 16_384 }, async (req) => {
    const src = (req as SrcReq).source;
    return store.recordCollectionReport(src.projectId, src.sourceId, ((req.body && typeof req.body === "object") ? req.body : {}) as Record<string, unknown>);
  });
  app.post("/ingest/falco", { preHandler: sourceAuth, bodyLimit: 262_144 }, async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    return respond(reply, [ingestOne(req as SrcReq, falcoToIngest(body, `falco-${Date.now()}`))]);
  });
  // OTLP/HTTP (JSON encoding). Success: HTTP 200 + ExportTraceServiceResponse; partial: partialSuccess.
  // Errors: google.rpc.Status-shaped JSON. Protobuf encoding is not supported (415).
  const otlpStatus = (reply: FastifyReply, http: number, code: number, message: string) => reply.status(http).type("application/json").send({ code, message });
  app.post("/v1/traces", {
    bodyLimit: 4_194_304,
    preHandler: sourceAuth,
    preParsing: async (req, _reply, payload) => (String(req.headers["content-encoding"] ?? "").toLowerCase() === "gzip" ? gunzipCapped(payload, 16 * 1_048_576) : payload),
    errorHandler: (err, _req, reply) => {
      const status = err instanceof HttpError ? err.status : (err as { statusCode?: number }).statusCode ?? 500;
      return otlpStatus(reply, status, status === 401 ? 16 : status >= 500 ? 13 : 3, err.message);
    },
  }, async (req, reply) => {
    const ct = String(req.headers["content-type"] ?? "");
    if (!ct.includes("application/json")) return otlpStatus(reply, 415, 3, "only OTLP/HTTP JSON (application/json) is supported; protobuf is not");
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return otlpStatus(reply, 400, 3, "request body must be an ExportTraceServiceRequest object");
    const rs = (req.body as { resourceSpans?: unknown }).resourceSpans;
    if (rs !== undefined && !Array.isArray(rs)) return otlpStatus(reply, 400, 3, "resourceSpans must be an array");
    const { events, invalid } = otlpToIngest(req.body);
    const results = events.map((e) => ingestOne(req as SrcReq, e));
    const rejected = invalid + results.filter((r) => r.status === "rejected").length;
    reply.status(200).type("application/json");
    if (!rejected) return {};
    const reasons = [...new Set(results.filter((r) => r.status === "rejected").map((r) => (r as { reason: string }).reason))];
    return { partialSuccess: { rejectedSpans: String(rejected), errorMessage: `${rejected} span(s) rejected${reasons.length ? `: ${reasons.join(", ")}` : " (invalid span structure)"}` } };
  });

  // ---- static web app ----
  const dist = cfg.webDist ?? resolve(import.meta.dirname, "../../web/dist");
  if (existsSync(dist)) {
    const fastifyStatic = (await import("@fastify/static")).default;
    await app.register(fastifyStatic, { root: dist, prefix: "/", index: ["index.html"], wildcard: true });
    app.setNotFoundHandler((req, reply) => (req.method === "GET" && !req.url.startsWith("/api") ? reply.sendFile("index.html") : reply.status(404).send({ error: "not found" })));
  }

  return app;
}

function parseCookie(h: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (h ?? "").split(";")) { const i = part.indexOf("="); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
