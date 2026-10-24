import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BLUEPRINTS, composeMission, draftFromScenario, missionTruthMarkers, parseMissionProposal, MISSION_SCOPE, MISSION_STARTERS, type MissionDraft } from "../../packages/local-world/src/index.ts";
import { buildApp } from "../../apps/server/src/app.ts";
import { openDb } from "../../apps/server/src/db.ts";
import { Store } from "../../apps/server/src/store.ts";
import { runMission } from "./src/world/mission.ts";
import { createServer, DkClient } from "../../apps/mcp/src/server.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/** LP29 — local mission and scenario composer: compose (LP04 blueprint + LP07 DSL + compiled world), preview, create, run, reopen. */
const ROOT = join(import.meta.dirname, "../..");
const lw = (id: string) => JSON.parse(readFileSync(join(ROOT, `scenarios/local-world/dsl/${id}.scenario.json`), "utf8"));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const open: (() => Promise<void>)[] = [];
afterEach(async () => { for (const c of open.splice(0).reverse()) await c(); });

async function server() {
  const store = new Store(openDb(":memory:"));
  const admin = store.createToken("lp29 admin", "admin").token, analyst = store.createToken("lp29 analyst", "analyst").token, viewer = store.createToken("lp29 viewer", "viewer").token;
  const app = await buildApp({ store, secret: "lp29", demoMode: false, webDist: "/nonexistent" });
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  open.push(async () => { await app.close(); store.db.close(); });
  const req = async (token: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(`${url}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, json: await r.json() as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const counts = () => Object.fromEntries(["local_missions", "local_mission_runs", "projects", "sources", "audit_log"].map((t) => { try { return [t, (store.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]; } catch { return [t, -1]; } }));
  return { store, url, admin, analyst, viewer, req, counts, drain: () => { for (let i = 0; i < 200 && store.processBatch(200).processed; i++) { /* drain */ } } };
}

describe("LP29 composer library", () => {
  it("composes every reviewed LP07 document into a finite mission with disjoint builder truth and investigator brief", () => {
    for (const id of ["LW-01", "LW-02", "LW-03"]) {
      const c = composeMission(draftFromScenario(lw(id)));
      expect(c.ok, id).toBe(true);
      if (!c.ok) continue;
      expect(c.brief.scope).toBe(MISSION_SCOPE);
      expect(c.brief.budget.within_budget).toBe(true);
      expect(c.brief.budget.steps).toBe(lw(id).steps.length);
      expect(c.brief.world_revision).toBe(c.world.revision);
      expect(c.brief.unknowns).toEqual(c.world.gaps);
      const text = JSON.stringify(c.brief);
      for (const m of missionTruthMarkers(c.truth)) expect(text.includes(m), `${id} brief leaks ${m}`).toBe(false);
      expect(text).not.toMatch(/"(seed|expect|label|at_ms|faults|mutations|distractor)"/);
      expect(c.operations.length).toBe(lw(id).steps.length); // builder-only operation preview
    }
  });
  it("every blueprint has a seedless starter that composes once the builder draws a seed", () => {
    for (const b of BLUEPRINTS) {
      const steps = MISSION_STARTERS[b.id]!;
      expect(steps, b.id).toBeTruthy();
      const c = composeMission({ schema: "dk.local.mission.v1", id: `m-${b.id}`, title: b.title, mode: "investigate", scenario: { schema: "dk.local.scenario.v1", id: `m-${b.id}`, version: 1, blueprint: b.id, blueprint_version: b.version, seed: "drawn-by-builder-01", start: "2026-10-24T07:00:00.000Z", steps, expect: [] } });
      expect(c.ok, `${b.id} ${c.ok ? "" : c.issues.join("; ")}`).toBe(true);
    }
  });
  it("the templates API serves seedless starters only and reads no repository scenario document", async () => {
    const s = await server();
    expect((await s.req(s.viewer, "GET", "/api/local-missions/templates")).status).toBe(403);
    const t = await s.req(s.analyst, "GET", "/api/local-missions/templates");
    expect(t.status).toBe(200);
    expect(t.json.starters.map((x: { blueprint: string }) => x.blueprint).sort()).toEqual(BLUEPRINTS.map((b) => b.id).sort());
    expect(JSON.stringify(t.json)).not.toMatch(/"seed"|lw0[123]-/);
  });
  it("is deterministic and the truth commitment binds the whole schedule", () => {
    const d = draftFromScenario(lw("LW-01"));
    const a = composeMission(d), b = composeMission(clone(d));
    expect(a.ok && b.ok && a.brief.truth_commitment === b.brief.truth_commitment).toBe(true);
    const e = clone(d); e.scenario.steps[2]!.params = { tenant: "tenant-b" };
    const c = composeMission(e);
    expect(c.ok && a.ok && c.brief.truth_commitment !== a.brief.truth_commitment).toBe(true);
  });
  it("LP29-A3: invalid drafts are returned unchanged with every issue (executable fields, unknown routes, budget overruns, unreviewed blueprints)", () => {
    const base = draftFromScenario(lw("LW-01"));
    const bad: [string, (d: MissionDraft & Record<string, any>) => void, RegExp][] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
      ["command field", (d) => { (d.scenario.steps[0] as any).command = "rm -rf /"; }, /unknown field/], // eslint-disable-line @typescript-eslint/no-explicit-any
      ["shell action", (d) => { (d.scenario.steps[0] as any).action = "shell"; }, /finite action vocabulary/], // eslint-disable-line @typescript-eslint/no-explicit-any
      ["url top level", (d) => { d.url = "http://example.com"; }, /unknown field/],
      ["undeclared route", (d) => { d.scenario.steps[2]!.route = "GET /admin/{tenant}"; }, /not a declared route/],
      ["unknown resource", (d) => { d.scenario.steps[2]!.resource = "127.0.0.1:8787"; }, /plain id|not a registered resource/],
      ["budget loosened", (d) => { d.budget = { max_requests: 100000 }; }, /can only be tightened/],
      ["budget too tight", (d) => { d.budget = { max_seconds: 1, max_requests: 1 }; }, /exceed the world budget|beyond/],
      ["unknown mode", (d) => { (d as any).mode = "exploit"; }, /mode/], // eslint-disable-line @typescript-eslint/no-explicit-any
      ["unreviewed blueprint", (d) => { d.scenario.blueprint = "prod-cluster"; }, /not a reviewed blueprint/],
    ];
    for (const [name, mut, re] of bad) {
      const d = clone(base) as MissionDraft & Record<string, unknown>; mut(d);
      const snapshot = JSON.stringify(d);
      const c = composeMission(d);
      expect(c.ok, name).toBe(false);
      if (c.ok) continue;
      expect(c.issues.join(" "), name).toMatch(re);
      expect(c.created).toBe(false);
      expect(JSON.stringify(c.draft), name).toBe(snapshot);
    }
  });
  it("AI-assisted proposals are data only: prose, code fences and code are refused; a valid JSON proposal goes through the same composer", () => {
    const d = draftFromScenario(lw("LW-02"));
    expect(parseMissionProposal("Here is a mission: " + JSON.stringify(d)).ok).toBe(false);
    expect(parseMissionProposal("```json\n" + JSON.stringify(d) + "\n```").ok).toBe(false);
    expect(parseMissionProposal("{ steps: () => process.exit(1) }").ok).toBe(false);
    expect(parseMissionProposal(JSON.stringify(d)).ok).toBe(true);
    const evil = clone(d) as any; evil.scenario.steps[0].script = "fetch('http://x')"; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(parseMissionProposal(JSON.stringify(evil)).ok).toBe(false);
  });
  it("the composer module has no process, network, eval or file-writing calls", () => {
    const src = readFileSync(join(ROOT, "packages/local-world/src/mission.ts"), "utf8") + readFileSync(join(ROOT, "apps/server/src/missions.ts"), "utf8");
    expect(src).not.toMatch(/child_process|node:vm|worker_threads|\beval\(|new Function|import\(|writeFile|fetch\(/);
  });
});

describe("LP29 mission desk API, runner and MCP", () => {
  it("LP29-A1/A4: create, preview, run and reopen a local mission without editing source; local-only throughout; investigator surfaces never see truth", async () => {
    const s = await server();
    const draft = draftFromScenario(lw("LW-01"), "investigate");
    const c = composeMission(draft); if (!c.ok) throw new Error("compose");
    const before = s.counts();
    const pv = await s.req(s.viewer, "POST", "/api/local-missions/preview", { draft });
    expect(pv.status).toBe(200);
    expect(pv.json.created).toBe(false); expect(pv.json.connected).toBe(false);
    expect(pv.json.scope).toBe(MISSION_SCOPE);
    expect(pv.json.brief.truth_commitment).toBe(c.brief.truth_commitment);
    expect(s.counts()).toEqual(before); // preview is pure
    expect((await s.req(s.viewer, "POST", "/api/local-missions", { draft })).status).toBe(403);
    const cr = await s.req(s.analyst, "POST", "/api/local-missions", { draft });
    expect(cr.status).toBe(201);
    expect(cr.json).toMatchObject({ id: draft.id, status: "ready", blinded: true, truth_stored_on_server: false, scope: MISSION_SCOPE, runtime: "not_running", connected: false, runs: [] });
    expect((await s.req(s.analyst, "POST", "/api/local-missions", { draft })).status).toBe(409);
    // a mismatched mission file cannot register a run
    const wrong = clone(draft); wrong.scenario.steps[2]!.params = { tenant: "tenant-b" };
    await expect(runMission(wrong, { dk: { url: s.url, adminToken: s.admin }, missionId: draft.id, drain: s.drain })).rejects.toThrow(/truth commitment/);
    expect((await s.req(s.viewer, "GET", `/api/local-missions/${draft.id}`)).json.runs).toEqual([]);
    // run through the local runner (same entry point as `pnpm mission run`)
    const r = await runMission(draft, { dk: { url: s.url, adminToken: s.admin }, missionId: draft.id, drain: s.drain });
    expect(r.status).toBe("complete");
    expect(r.accounting.executed!.length + r.accounting.refused!.length).toBe(draft.scenario.steps.length);
    // reopen
    const re = await s.req(s.viewer, "GET", `/api/local-missions/${draft.id}`);
    expect(re.json.status).toBe("ran");
    expect(re.json.runs).toHaveLength(1);
    expect(re.json.runs[0]).toMatchObject({ run_id: r.run_id, status: "complete", blinded: true, project_id: r.project, world_revision: c.brief.world_revision });
    expect(re.json.runs[0].cleanup.outcome).toBe("completed");
    expect(re.json.runtime).toBe("not_running");
    // evidence went through ordinary ingestion into the run's lab project
    const ev = await s.req(s.admin, "GET", `/api/projects/${r.project}/events?limit=500`);
    expect(JSON.stringify(ev.json).length).toBeGreaterThan(100);
    // investigator surfaces (API list/detail, MCP) never carry builder truth
    const list = await s.req(s.viewer, "GET", "/api/local-missions");
    const mcp = createServer(new DkClient({ baseUrl: s.url, token: s.viewer, project: r.project }));
    const [a, b] = InMemoryTransport.createLinkedPair(); const client = new Client({ name: "lp29", version: "1" });
    await Promise.all([mcp.connect(a), client.connect(b)]);
    const tool = await client.callTool({ name: "dk_local_missions", arguments: { mission_id: draft.id } });
    const toolJson = JSON.parse((tool.content as { text: string }[])[0]!.text);
    expect(toolJson).toEqual(re.json);
    for (const surface of [re.json, list.json, toolJson]) {
      const text = JSON.stringify(surface);
      for (const m of missionTruthMarkers(c.truth)) expect(text.includes(m), `leaks ${m}`).toBe(false);
      expect(text).toContain("local_only_synthetic_no_remote_setup");
    }
    // the DB never held the truth either
    const dbText = JSON.stringify(s.store.db.prepare("SELECT * FROM local_missions").all()) + JSON.stringify(s.store.db.prepare("SELECT * FROM local_mission_runs").all());
    for (const m of missionTruthMarkers(c.truth)) expect(dbText.includes(m)).toBe(false);
  }, 60_000);

  it("LP29-A2: opening truth is explicit, audited and taints the mission and its runs as non-blinded", async () => {
    const s = await server();
    const draft = draftFromScenario(lw("LW-03"), "verify");
    expect((await s.req(s.analyst, "POST", "/api/local-missions", { draft })).status).toBe(201);
    const r = await runMission(draft, { dk: { url: s.url, adminToken: s.admin }, missionId: draft.id, drain: s.drain });
    expect((await s.req(s.viewer, "GET", `/api/local-missions/${draft.id}`)).json.runs[0].blinded).toBe(true);
    expect((await s.req(s.viewer, "POST", `/api/local-missions/${draft.id}/open-truth`, { reason: "x" })).status).toBe(403);
    expect((await s.req(s.analyst, "POST", `/api/local-missions/${draft.id}/open-truth`, {})).status).toBe(400);
    const t = await s.req(s.analyst, "POST", `/api/local-missions/${draft.id}/open-truth`, { reason: "builder review after grading" });
    expect(t.status).toBe(200);
    expect(t.json.blinded).toBe(false);
    expect(t.json.taint).toHaveLength(1);
    expect(t.json.runs.find((x: { run_id: string }) => x.run_id === r.run_id).blinded).toBe(false);
    expect(t.json.truth_location).toMatch(/never stored on this server/);
    const audit = s.store.db.prepare("SELECT action FROM audit_log WHERE action LIKE 'mission.%' ORDER BY rowid").all() as { action: string }[];
    expect(audit.map((x) => x.action)).toEqual(["mission.create", "mission.run_start", "mission.run_finish", "mission.truth_opened"]);
  }, 60_000);

  it("LP29-A3: an invalid plan keeps the draft, creates no rows, projects, sources or runs, and never reports connected", async () => {
    const s = await server();
    const draft = draftFromScenario(lw("LW-02")) as MissionDraft & Record<string, unknown>;
    (draft.scenario.steps[1] as unknown as Record<string, unknown>).url = "http://169.254.169.254/latest";
    const before = s.counts();
    const r = await s.req(s.analyst, "POST", "/api/local-missions", { draft });
    expect(r.status).toBe(422);
    expect(r.json).toMatchObject({ created: false, connected: false });
    expect(r.json.draft).toEqual(draft);
    expect(r.json.details.join(" ")).toMatch(/unknown field/);
    expect(s.counts()).toEqual(before);
    const pv = await s.req(s.viewer, "POST", "/api/local-missions/preview", { proposal: "Sure! ```" + JSON.stringify(draft) + "```" });
    expect(pv.status).toBe(422);
    expect(s.counts()).toEqual(before);
    // cancel before start; a cancelled mission cannot register a run
    const ok = draftFromScenario(lw("LW-02"));
    expect((await s.req(s.analyst, "POST", "/api/local-missions", { draft: ok })).status).toBe(201);
    expect((await s.req(s.analyst, "POST", `/api/local-missions/${ok.id}/cancel`)).json.status).toBe("cancelled");
    const c = composeMission(ok); if (!c.ok) throw new Error("compose");
    expect((await s.req(s.admin, "POST", `/api/local-missions/${ok.id}/runs`, { run_id: "r1", truth_commitment: c.brief.truth_commitment, world_revision: c.brief.world_revision })).status).toBe(409);
    expect(readdirSync(join(ROOT, "scenarios/local-world/dsl")).length).toBeGreaterThanOrEqual(3);
  });
});
