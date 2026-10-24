import type { FastifyInstance, FastifyRequest } from "fastify";
import { BLUEPRINTS, MISSION_LOCAL_NOTE, MISSION_SCOPE, MISSION_MODES, MISSION_STARTERS, SCENARIO_ACTIONS, composeMission, parseMissionProposal, type MissionBrief } from "@dk/local-world";
import { HttpError, type Store } from "./store.ts";
import type { Role } from "./security.ts";

/**
 * LP29 mission desk API. The server is the investigator side: it stores the mission BRIEF and the SHA-256 commitment
 * of the builder's private truth, never the truth itself (seed, schedule, labels, expectations). Preview and invalid
 * creates write nothing. Runs are executed by the local runner (`pnpm mission run`), which owns the supervisor and the
 * disposable world; this API only records the run lifecycle the runner reports and never claims a connected status it
 * did not receive. Opening builder truth is an explicit, audited act that taints the mission non-blinded.
 */
export const MISSIONS_MIGRATION = `CREATE TABLE local_missions (id TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL, blueprint TEXT NOT NULL, brief TEXT NOT NULL, truth_commitment TEXT NOT NULL, status TEXT NOT NULL, blinded INTEGER NOT NULL DEFAULT 1, taint TEXT NOT NULL DEFAULT '[]', created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE local_mission_runs (run_id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES local_missions(id), status TEXT NOT NULL, blinded INTEGER NOT NULL, project_id TEXT, world_revision TEXT, accounting TEXT, cleanup TEXT, started_by TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT);`;

export interface MissionDeps { store: Store; authed: (minRole?: Role) => (req: FastifyRequest) => Promise<void>; who: (req: FastifyRequest) => string }
type Row = { id: string; title: string; mode: string; blueprint: string; brief: string; truth_commitment: string; status: string; blinded: number; taint: string; created_by: string; created_at: string; updated_at: string };
type RunRow = { run_id: string; mission_id: string; status: string; blinded: number; project_id: string | null; world_revision: string | null; accounting: string | null; cleanup: string | null; started_by: string; started_at: string; ended_at: string | null };
const RUN_FINAL = ["complete", "partial", "failed", "cancelled"] as const;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,100}$/;

export function missionRecord(store: Store, id: string) {
  const r = store.db.prepare("SELECT * FROM local_missions WHERE id = ?").get(id) as Row | undefined;
  if (!r) return null;
  const runs = (store.db.prepare("SELECT * FROM local_mission_runs WHERE mission_id = ? ORDER BY started_at, run_id").all(id) as RunRow[]).map((x) => ({
    run_id: x.run_id, status: x.status, blinded: x.blinded === 1 && r.blinded === 1, project_id: x.project_id, world_revision: x.world_revision,
    accounting: x.accounting ? JSON.parse(x.accounting) : null, cleanup: x.cleanup ? JSON.parse(x.cleanup) : null, started_at: x.started_at, ended_at: x.ended_at,
  }));
  return {
    schema: "dk.local.mission_record.v1", id: r.id, title: r.title, mode: r.mode, blueprint: r.blueprint, status: r.status,
    blinded: r.blinded === 1, taint: JSON.parse(r.taint) as unknown[], brief: JSON.parse(r.brief) as MissionBrief, truth_commitment: r.truth_commitment,
    truth_stored_on_server: false, scope: MISSION_SCOPE, runtime: runs.some((x) => x.status === "running") ? "running_in_local_runner" : "not_running",
    runs, created_at: r.created_at, updated_at: r.updated_at, note: MISSION_LOCAL_NOTE,
    run_command: `pnpm mission run <mission-file.json> --mission ${r.id}`,
  };
}

export function registerMissions(app: FastifyInstance, d: MissionDeps) {
  const { store } = d;
  const now = () => new Date().toISOString();
  const get = (id: string) => { const m = missionRecord(store, id); if (!m) throw new HttpError(404, "unknown mission"); return m; };
  const composeOr422 = (body: unknown, proposal = false) => {
    const c = proposal ? parseMissionProposal(body) : composeMission(body);
    if (!c.ok) throw new HttpError(422, "mission draft rejected; the draft is unchanged and nothing was created", c.issues.slice(0, 50), { draft: c.draft, created: false, connected: false });
    return c;
  };

  // Builder starters: one minimal benign schedule per reviewed blueprint, WITHOUT a seed (the builder's browser draws
  // it). The server never reads or serves repository scenario documents.
  app.get("/api/local-missions/templates", { preHandler: d.authed("analyst") }, async () => ({
    schema: "dk.local.mission_templates.v1", scope: MISSION_SCOPE, view: "builder", modes: MISSION_MODES, actions: SCENARIO_ACTIONS,
    starters: BLUEPRINTS.filter((b) => MISSION_STARTERS[b.id]).map((b) => ({ blueprint: b.id, blueprint_version: b.version, title: b.title, steps: MISSION_STARTERS[b.id] })),
    note: "Starters carry no seed; the builder draws one locally. Drafts stay with the builder.",
  }));

  // Builder preview: pure. Returns the builder's own draft back with the world/budget preview; stores nothing.
  app.post("/api/local-missions/preview", { preHandler: d.authed(), bodyLimit: 600_000 }, async (req) => {
    const b = (req.body ?? {}) as { draft?: unknown; proposal?: unknown };
    const c = composeOr422(b.proposal !== undefined ? b.proposal : b.draft, b.proposal !== undefined);
    return { schema: "dk.local.mission_preview.v1", scope: MISSION_SCOPE, created: false, connected: false, brief: c.brief, world: c.preview, builder: { operations: c.operations, counts: c.builder_counts, truth_commitment: c.brief.truth_commitment }, draft: c.draft, note: MISSION_LOCAL_NOTE };
  });

  app.post("/api/local-missions", { preHandler: d.authed("analyst"), bodyLimit: 600_000 }, async (req, reply) => {
    const c = composeOr422((req.body as { draft?: unknown } | undefined)?.draft);
    if (store.db.prepare("SELECT 1 FROM local_missions WHERE id = ?").get(c.brief.mission_id)) throw new HttpError(409, "a mission with this id already exists; choose another id", [], { draft: c.draft, created: false });
    const t = now();
    store.db.prepare("INSERT INTO local_missions (id, title, mode, blueprint, brief, truth_commitment, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(c.brief.mission_id, c.brief.title, c.brief.mode, c.brief.blueprint, JSON.stringify(c.brief), c.brief.truth_commitment, "ready", d.who(req), t, t);
    store.audit(d.who(req), "mission.create", null, c.brief.mission_id, { mode: c.brief.mode, blueprint: c.brief.blueprint, truth_commitment: c.brief.truth_commitment });
    reply.code(201);
    return { ...get(c.brief.mission_id), created: true, connected: false };
  });

  app.get("/api/local-missions", { preHandler: d.authed() }, async () => {
    const ids = (store.db.prepare("SELECT id FROM local_missions ORDER BY created_at, id").all() as { id: string }[]).map((r) => r.id);
    return { schema: "dk.local.mission_list.v1", scope: MISSION_SCOPE, missions: ids.map((id) => get(id)), note: MISSION_LOCAL_NOTE };
  });
  app.get("/api/local-missions/:id", { preHandler: d.authed() }, async (req) => get((req.params as { id: string }).id));

  // Opening truth: the server never had it; this records that a person in this mission's investigation saw it.
  app.post("/api/local-missions/:id/open-truth", { preHandler: d.authed("analyst") }, async (req) => {
    const m = get((req.params as { id: string }).id);
    const reason = String((req.body as { reason?: unknown } | undefined)?.reason ?? "").slice(0, 300);
    if (!reason.trim()) throw new HttpError(400, "say why truth is being opened; it permanently marks this mission non-blinded");
    const taint = [...m.taint, { by: d.who(req), at: now(), reason }];
    store.db.prepare("UPDATE local_missions SET blinded = 0, taint = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(taint), now(), m.id);
    store.db.prepare("UPDATE local_mission_runs SET blinded = 0 WHERE mission_id = ?").run(m.id);
    store.audit(d.who(req), "mission.truth_opened", null, m.id, { reason });
    return { ...get(m.id), truth_location: "builder draft or mission file only (never stored on this server)" };
  });

  app.post("/api/local-missions/:id/cancel", { preHandler: d.authed("analyst") }, async (req) => {
    const m = get((req.params as { id: string }).id);
    if (m.runs.length) throw new HttpError(409, "this mission has runs; stop a running run from the local runner (Ctrl-C) instead");
    if (m.status === "cancelled") return m;
    store.db.prepare("UPDATE local_missions SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now(), m.id);
    store.audit(d.who(req), "mission.cancel", null, m.id, {});
    return get(m.id);
  });

  // Runner lifecycle. The runner must prove it holds the same truth (commitment) before a run is recorded.
  app.post("/api/local-missions/:id/runs", { preHandler: d.authed("admin") }, async (req, reply) => {
    const m = get((req.params as { id: string }).id);
    const b = (req.body ?? {}) as { run_id?: unknown; truth_commitment?: unknown; project_id?: unknown; world_revision?: unknown };
    if (m.status === "cancelled") throw new HttpError(409, "mission is cancelled");
    if (typeof b.run_id !== "string" || !RUN_ID.test(b.run_id)) throw new HttpError(400, "run_id must be a plain id");
    if (b.truth_commitment !== m.truth_commitment) throw new HttpError(409, "the mission file does not match this mission's truth commitment; nothing was started");
    if (b.world_revision !== m.brief.world_revision) throw new HttpError(409, "the runner compiled a different world revision");
    store.db.prepare("INSERT INTO local_mission_runs (run_id, mission_id, status, blinded, project_id, world_revision, started_by, started_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(b.run_id, m.id, "running", m.blinded ? 1 : 0, typeof b.project_id === "string" ? b.project_id : null, String(b.world_revision), d.who(req), now());
    store.db.prepare("UPDATE local_missions SET status = 'ran', updated_at = ? WHERE id = ?").run(now(), m.id);
    store.audit(d.who(req), "mission.run_start", null, m.id, { run_id: b.run_id });
    reply.code(201);
    return get(m.id);
  });
  app.post("/api/local-missions/:id/runs/:run/finish", { preHandler: d.authed("admin") }, async (req) => {
    const { id, run } = req.params as { id: string; run: string };
    const m = get(id);
    const r = m.runs.find((x) => x.run_id === run);
    if (!r) throw new HttpError(404, "unknown run");
    if (r.status !== "running") throw new HttpError(409, `run already ${r.status}`);
    const b = (req.body ?? {}) as { status?: unknown; accounting?: unknown; cleanup?: unknown };
    if (!RUN_FINAL.includes(b.status as (typeof RUN_FINAL)[number])) throw new HttpError(400, `status must be ${RUN_FINAL.join(", ")}`);
    const acc = (b.accounting ?? {}) as Record<string, unknown>;
    const accounting = Object.fromEntries(["executed", "refused", "failed", "not_run"].map((k) => [k, Array.isArray(acc[k]) ? (acc[k] as unknown[]).filter(Number.isInteger) : []]));
    const cl = (b.cleanup ?? {}) as { outcome?: unknown; failures?: unknown };
    const cleanup = { outcome: typeof cl.outcome === "string" ? cl.outcome.slice(0, 40) : "unknown", failures: Array.isArray(cl.failures) ? cl.failures.length : 0 };
    store.db.prepare("UPDATE local_mission_runs SET status = ?, accounting = ?, cleanup = ?, ended_at = ? WHERE run_id = ?").run(String(b.status), JSON.stringify(accounting), JSON.stringify(cleanup), now(), run);
    store.audit(d.who(req), "mission.run_finish", null, m.id, { run_id: run, status: b.status, cleanup: cleanup.outcome });
    return get(m.id);
  });
}
