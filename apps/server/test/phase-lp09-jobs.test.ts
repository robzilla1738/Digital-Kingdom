import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { world, at, AFTER, BEFORE } from "./phase-m2-world.ts";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";

/** LP09: bounded investigation plan jobs. */
type W = Awaited<ReturnType<typeof world>>;
const J = (w: W) => `/api/projects/${w.project}/jobs`;
const snapshotIds = (w: W, store: Store, asset: string, seq: number) => (store.db.prepare("SELECT id FROM events WHERE project_id = ? AND occurred_at >= ? AND occurred_at <= ? AND seq <= ? AND EXISTS (SELECT 1 FROM json_each(events.asset_ids) WHERE value = ?) ORDER BY occurred_at, id").all(w.project, AFTER, BEFORE, seq, asset) as { id: string }[]).map((r) => r.id);
const deliveredOf = (store: Store, jobId: string, stepId: string) => (store.db.prepare("SELECT ref FROM investigation_deliveries WHERE channel = 'job' AND channel_id = ? AND step_id = ? AND kind = 'event' ORDER BY id").all(jobId, stepId) as { ref: string }[]).map((r) => r.ref);
async function openContract(w: W) {
  const r = await w.ctx.app.inject({ method: "POST", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.analyst) });
  expect(r.statusCode).toBe(200);
  return r.json().contract;
}
async function createJob(w: W, payload: Record<string, unknown> = {}, token = w.ctx.analyst) {
  const r = await w.ctx.app.inject({ method: "POST", url: `${w.base}/jobs`, headers: w.ctx.h(token), payload });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}
const advance = (w: W, id: string, max_units: number, token = w.ctx.analyst) => w.ctx.app.inject({ method: "POST", url: `${J(w)}/${id}/advance`, headers: w.ctx.h(token), payload: { max_units } });
const stepFor = (job: { steps: { step_id: string; obligation_id: string | null }[] }, ob: string) => job.steps.find((s) => s.obligation_id === ob)!.step_id;

describe("LP09-A1 a key event beyond page one is fetched under a stable snapshot without duplicate/skip at tied timestamps", () => {
  it("40 records at one timestamp, page size 5, late arrivals between pages: exactly the snapshot, key event included", async () => {
    const w = await world({ ties: 40 });
    await openContract(w);
    const job = await createJob(w, { budget: { max_units: 200, page_limit: 5 } });
    const dbStep = stepFor(job, "activity:db");
    const key = (w.ctx.store.listEvents(w.project, { limit: 5000 }).find((e) => e.actor_ref === "mallory-key"))!;
    let progressed = false; let late = 0;
    for (let i = 0; i < 80; i++) {
      const r = await advance(w, job.id, 1);
      expect(r.statusCode, r.body).toBe(200);
      const st = r.json().job.steps.find((s: { step_id: string }) => s.step_id === dbStep);
      if (st.status === "running" && st.counters.pages >= 1 && late < 6) {
        // late arrivals at the very same timestamp while the search is open (must never enter the snapshot)
        w.send("dbaudit", 3600, { action: "data_access", outcome: "success", actor_ref: `late-${late++}` }); w.drain(); progressed = true;
      }
      if (r.json().job.status.startsWith("completed")) break;
    }
    expect(progressed).toBe(true);
    const final = (await w.ctx.app.inject({ method: "GET", url: `${J(w)}/${job.id}`, headers: w.ctx.h(w.ctx.viewer) })).json();
    const st = final.steps.find((s: { step_id: string }) => s.step_id === dbStep);
    expect(st.status).toBe("complete");
    expect(st.counters.pages).toBeGreaterThan(5);
    const expected = snapshotIds(w, w.ctx.store, "db", st.counters.snapshot_seq);
    const got = deliveredOf(w.ctx.store, job.id, dbStep);
    expect(got.length).toBe(new Set(got).size);
    expect([...got].sort()).toEqual([...expected].sort());
    expect(expected.indexOf(key.id)).toBeGreaterThanOrEqual(5); // genuinely beyond page one
    expect(got).toContain(key.id);
    const lateIds = w.ctx.store.listEvents(w.project, { limit: 5000 }).filter((e) => e.actor_ref?.startsWith("late-")).map((e) => e.id);
    expect(lateIds.length).toBe(6);
    for (const id of lateIds) expect(got).not.toContain(id);
    expect(final.steps.find((s: { step_id: string }) => s.step_id === dbStep).counters.matched_in_snapshot).toBe(expected.length);
    // the satisfied retrieval is then invalidated by the late arrivals (LP08 evidence change), recorded by the next write
    const view = (await w.ctx.app.inject({ method: "GET", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.viewer) })).json();
    expect(view.contract.obligations.find((o: { id: string }) => o.id === "activity:db").status).toBe("not_started");
    const ledger = (await w.ctx.app.inject({ method: "GET", url: `${w.base}/contract/ledger?obligation=activity:db`, headers: w.ctx.h(w.ctx.viewer) })).json().transitions;
    expect(ledger.map((t: { to_status: string }) => t.to_status)).toEqual(["not_started", "satisfied", "not_started"]);
    expect(ledger[2]).toMatchObject({ cause: "evidence_changed", reason: expect.stringMatching(/6 matching record\(s\) on db arrived after the retrieval snapshot/) });
  });
});

describe("LP09-A2 no tool accepts raw SQL, arbitrary paths, unrestricted graph queries or source credentials", () => {
  it("job plans take only typed fields; forbidden and unknown fields are refused", async () => {
    const w = await world();
    await openContract(w);
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ sql: "SELECT * FROM api_tokens" }, /not accepted.*raw SQL/],
      [{ steps: [{ kind: "raw_query", value: "x" }] }, /unsupported field|kind must be "pivot"/],
      [{ steps: [{ kind: "pivot", pivot_type: "sql", value: "1=1", from_ref: "x" }] }, /pivot_type must be one of/],
      [{ steps: [{ kind: "pivot", pivot_type: "actor_ref", value: "alice", from_ref: "x", path: "/etc/passwd" }] }, /not accepted/],
      [{ steps: [{ kind: "pivot", pivot_type: "actor_ref", value: "alice", from_ref: "x", graph_query: "MATCH (n) RETURN n" }] }, /not accepted/],
      [{ budget: { max_units: 5, credential: "AKIA..." } }, /unsupported field/],
      [{ api_key: "dk_live_x" }, /not accepted/],
      [{ budget: { max_units: 100000 } }, /max_units must be an integer from 1 to 200/],
      [{ target_project: "demo-castle" }, /unsupported field/],
    ];
    for (const [payload, msg] of bad) {
      const r = await w.ctx.app.inject({ method: "POST", url: `${w.base}/jobs`, headers: w.ctx.h(w.ctx.analyst), payload });
      expect(r.statusCode, JSON.stringify(payload)).toBe(422);
      expect(r.json().error + (r.json().details ?? []).join(" "), JSON.stringify(payload)).toMatch(msg);
    }
    const job = await createJob(w, { budget: { max_units: 3 } });
    expect((await w.ctx.app.inject({ method: "POST", url: `${J(w)}/${job.id}/advance`, headers: w.ctx.h(w.ctx.analyst), payload: { max_units: 1, query: "DROP TABLE events" } })).statusCode).toBe(422);
    expect((await w.ctx.app.inject({ method: "GET", url: `/api/projects/${w.project}/events/search?after=${encodeURIComponent(AFTER)}&before=${encodeURIComponent(BEFORE)}&sql=1`, headers: w.ctx.h(w.ctx.viewer) })).statusCode).toBe(422);
  });

  it("pivots are scope-safe: only declared values from delivered records, inside the contract scope", async () => {
    const w = await world();
    await openContract(w);
    const job = await createJob(w, { budget: { max_units: 50 } });
    const ev = w.ctx.store.listEvents(w.project, { limit: 5000 }).find((e) => e.actor_ref === "alice" && e.asset_ids.includes("db"))!;
    const pivot = (p: Record<string, unknown>) => w.ctx.app.inject({ method: "POST", url: `${J(w)}/${job.id}/steps`, headers: w.ctx.h(w.ctx.analyst), payload: { steps: [{ kind: "pivot", ...p }] } });
    expect((await pivot({ pivot_type: "actor_ref", value: "alice", from_ref: ev.id })).json().error).toMatch(/not delivered under this contract/);
    // deliver the db activity first (run that step first, one unit at a time)
    w.ctx.db.prepare("UPDATE investigation_job_steps SET ord = 0 WHERE job_id = ? AND obligation_id = 'activity:db'").run(job.id);
    for (let i = 0; i < 20; i++) { const r = (await advance(w, job.id, 1)).json(); if (r.job.steps.find((s: { obligation_id: string }) => s.obligation_id === "activity:db").status === "complete") break; }
    expect((await pivot({ pivot_type: "actor_ref", value: "mallory", from_ref: ev.id })).json().error).toMatch(/does not carry actor_ref/);
    expect((await pivot({ pivot_type: "asset_id", value: "edge", from_ref: ev.id })).json().error).toMatch(/does not carry asset_id|outside the contract scope/);
    expect((await pivot({ pivot_type: "actor_ref", value: "alice", from_ref: ev.id, after: at(-90000), before: BEFORE })).json().error).toMatch(/inside the contract interval/);
    const ok = await pivot({ pivot_type: "actor_ref", value: "alice", from_ref: ev.id });
    expect(ok.statusCode, ok.body).toBe(200);
    const step = ok.json().steps.find((s: { kind: string }) => s.kind === "pivot");
    expect(step.params).toMatchObject({ pivot_type: "actor_ref", value: "alice", namespace: "idp:corp", after: AFTER, before: BEFORE });
    for (let i = 0; i < 30; i++) { const r = (await advance(w, job.id, 10)).json(); if (r.job.status.startsWith("completed") || r.job.status === "budget_exhausted") break; }
    const pivoted = deliveredOf(w.ctx.store, job.id, step.step_id);
    const alice = w.ctx.store.listEvents(w.project, { limit: 5000 }).filter((e) => e.actor_ref === "alice").map((e) => e.id);
    expect(pivoted.length).toBeGreaterThan(0);
    for (const id of pivoted) expect(alice).toContain(id);
  });

});

describe("LP09-A3 restart resumes from committed job state; cancellation and revocation stop further authorized work", () => {
  it("a crash before commit loses only that unit; a new process resumes the same snapshot with no duplicate or skip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dk-lp09-"));
    const path = join(dir, "db.sqlite");
    const w = await world({ ties: 23, dbPath: path });
    await openContract(w);
    const principal = w.ctx.store.authenticateToken(w.ctx.analyst)!;
    let units = 0;
    const crashing = w.services(w.ctx.store, { faultHook: (_s, info) => { if (info.kind === "search_activity" && ++units === 4) throw new Error("simulated crash before commit"); } });
    const job = crashing.jobs.create(w.project, w.caseId, { budget: { max_units: 200, page_limit: 4 } }, principal, "analyst-test");
    const dbStep = stepFor(job, "activity:db");
    // run the db step first so the crash lands mid-pagination
    w.ctx.db.prepare("UPDATE investigation_job_steps SET ord = 0 WHERE job_id = ? AND step_id = ?").run(job.id, dbStep);
    expect(() => crashing.jobs.advance(w.project, job.id, 10, principal, "analyst-test")).toThrow(/simulated crash/);
    const committed = crashing.jobs.get(w.project, job.id).steps.find((s) => s.step_id === dbStep)!;
    expect(committed.counters.pages).toBe(3);
    const before = deliveredOf(w.ctx.store, job.id, dbStep);
    expect(before.length).toBe(12);
    await w.ctx.app.close(); w.ctx.db.close();
    // new process: reopen the same file with no fault
    const store2 = new Store(openDb(path), { now: () => new Date(w.clock.t) });
    const fresh = w.services(store2);
    const p2 = store2.authenticateToken(w.ctx.analyst)!;
    for (let i = 0; i < 50; i++) { const r = fresh.jobs.advance(w.project, job.id, 10, p2, "analyst-test"); if (r.job.status.startsWith("completed")) break; }
    const done = fresh.jobs.get(w.project, job.id);
    const st = done.steps.find((s) => s.step_id === dbStep)!;
    expect(st.status).toBe("complete");
    expect(st.counters.snapshot_seq).toBe(committed.counters.snapshot_seq);
    const got = deliveredOf(store2, job.id, dbStep);
    expect(got.length).toBe(new Set(got).size);
    expect([...got].sort()).toEqual([...snapshotIds(w, store2, "db", st.counters.snapshot_seq!)].sort());
    expect(got.slice(0, 12)).toEqual(before);
    expect(fresh.jobs.events(w.project, job.id).some((e) => e.kind === "duplicate_suppressed")).toBe(false);
    store2.db.close();
  });

  it("resuming after the cursor expired restarts the step under a new snapshot, recorded, with no duplicates", async () => {
    const w = await world({ padding: 30 });
    await openContract(w);
    const job = await createJob(w, { budget: { max_units: 100, page_limit: 5 } });
    const apiStep = stepFor(job, "activity:api");
    w.ctx.db.prepare("UPDATE investigation_job_steps SET ord = 0 WHERE job_id = ? AND step_id = ?").run(job.id, apiStep);
    await advance(w, job.id, 2);
    w.clock.t += 2 * 3600_000; // the client disconnected for two hours
    for (let i = 0; i < 30; i++) { const x = (await advance(w, job.id, 5)).json(); if (x.job.steps.find((s: { step_id: string }) => s.step_id === apiStep).status !== "running") break; }
    const j = (await w.ctx.app.inject({ method: "GET", url: `${J(w)}/${job.id}`, headers: w.ctx.h(w.ctx.viewer) })).json();
    const st = j.steps.find((s: { step_id: string }) => s.step_id === apiStep);
    expect(st.status).toBe("complete");
    expect(st.counters.restarts).toBe(1);
    const ev = (await w.ctx.app.inject({ method: "GET", url: `${J(w)}/${job.id}/events`, headers: w.ctx.h(w.ctx.viewer) })).json().events;
    expect(ev.some((e: { kind: string }) => e.kind === "cursor_restart")).toBe(true);
    const got = deliveredOf(w.ctx.store, job.id, apiStep);
    expect(got.length).toBe(new Set(got).size);
    expect([...got].sort()).toEqual([...snapshotIds(w, w.ctx.store, "api", st.counters.snapshot_seq)].sort());
  });

  it("cancellation stops all further units and leaves obligations unsatisfied", async () => {
    const w = await world({ padding: 30 });
    await openContract(w);
    const job = await createJob(w, { budget: { max_units: 100, page_limit: 5 } });
    expect((await advance(w, job.id, 2)).statusCode).toBe(200);
    const deliveredBefore = Number((w.ctx.db.prepare("SELECT COUNT(*) AS n FROM investigation_deliveries WHERE channel_id = ?").get(job.id) as { n: number }).n);
    expect((await w.ctx.app.inject({ method: "POST", url: `${J(w)}/${job.id}/cancel`, headers: w.ctx.h(w.ctx.viewer), payload: { reason: "x" } })).statusCode).toBe(403);
    const c = await w.ctx.app.inject({ method: "POST", url: `${J(w)}/${job.id}/cancel`, headers: w.ctx.h(w.ctx.analyst), payload: { reason: "wrong case" } });
    expect(c.json().status).toBe("cancelled");
    const r = await advance(w, job.id, 5);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/cancelled; no further work/);
    expect(Number((w.ctx.db.prepare("SELECT COUNT(*) AS n FROM investigation_deliveries WHERE channel_id = ?").get(job.id) as { n: number }).n)).toBe(deliveredBefore);
    const view = (await w.ctx.app.inject({ method: "GET", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.viewer) })).json();
    expect(view.contract.obligations.find((o: { id: string }) => o.id === "activity:api").status).not.toBe("satisfied");
    expect(view.contract.readiness).not.toMatch(/answer_ready/);
  });

  it("revoking the creating token stops the job even when another analyst advances it", async () => {
    const w = await world({ padding: 30 });
    await openContract(w);
    const svc = w.ctx.store.createToken("agent analyst", "analyst", [w.project], undefined, "service");
    const job = await createJob(w, { budget: { max_units: 100, page_limit: 5 } }, svc.token);
    expect(job.principal_type).toBe("service");
    expect((await advance(w, job.id, 1, svc.token)).statusCode).toBe(200);
    const n0 = Number((w.ctx.db.prepare("SELECT COUNT(*) AS n FROM investigation_deliveries WHERE channel_id = ?").get(job.id) as { n: number }).n);
    w.ctx.store.revokeToken(svc.id, "admin");
    expect((await advance(w, job.id, 1, svc.token)).statusCode).toBe(401);
    const r = await advance(w, job.id, 3, w.ctx.analyst);
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toMatch(/revoked/);
    const j = (await w.ctx.app.inject({ method: "GET", url: `${J(w)}/${job.id}`, headers: w.ctx.h(w.ctx.viewer) })).json();
    expect(j.status).toBe("revoked");
    expect(Number((w.ctx.db.prepare("SELECT COUNT(*) AS n FROM investigation_deliveries WHERE channel_id = ?").get(job.id) as { n: number }).n)).toBe(n0);
    // the viewer can read the job but never advance it
    expect((await advance(w, job.id, 1, w.ctx.viewer)).statusCode).toBe(403);
  });
});

describe("LP09-A4 budget, truncation and error states stay explicit and never satisfy obligations", () => {
  it("budget exhaustion: partial (resumable), contract collecting; extending resumes without duplicates", async () => {
    const w = await world({ padding: 40 });
    await openContract(w);
    const job = await createJob(w, { budget: { max_units: 3, page_limit: 5 } });
    const apiStep = stepFor(job, "activity:api");
    w.ctx.db.prepare("UPDATE investigation_job_steps SET ord = 0 WHERE job_id = ? AND step_id = ?").run(job.id, apiStep);
    const r = (await advance(w, job.id, 10)).json();
    expect(r.units_executed).toBe(3);
    expect(r.job.status).toBe("budget_exhausted");
    expect(r.job.budget).toMatchObject({ used_units: 3, max_units: 3, exhausted: true, remaining_units: 0 });
    const st = r.job.steps.find((s: { step_id: string }) => s.step_id === apiStep);
    expect(st).toMatchObject({ status: "partial_budget", resumable: true });
    expect(st.completeness).toMatch(/budget exhausted/);
    let view = (await w.ctx.app.inject({ method: "GET", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.viewer) })).json();
    const ob = view.contract.obligations.find((o: { id: string }) => o.id === "activity:api");
    expect(ob.status).toBe("partial");
    expect(ob.reason).toMatch(/budget exhausted.*resumable/);
    expect(view.contract.readiness).toBe("collecting");
    expect(view.contract.negative_claim_requirements.find((n: { id: string }) => n.id === "negative:api:authentication").assessable).toBe(false);
    expect((await advance(w, job.id, 1)).json().units_executed).toBe(0);
    expect((await w.ctx.app.inject({ method: "POST", url: `${J(w)}/${job.id}/budget`, headers: w.ctx.h(w.ctx.analyst), payload: { add_units: 150 } })).statusCode).toBe(200);
    for (let i = 0; i < 20; i++) { const x = (await advance(w, job.id, 20)).json(); if (x.job.status.startsWith("completed")) break; }
    const got = deliveredOf(w.ctx.store, job.id, apiStep);
    expect(got.length).toBe(new Set(got).size);
    view = (await w.ctx.app.inject({ method: "GET", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.viewer) })).json();
    expect(view.contract.obligations.find((o: { id: string }) => o.id === "activity:api").status).toBe("satisfied");
    expect(got.length).toBe(view.contract.obligations.find((o: { id: string }) => o.id === "activity:api").evidence_ref_count);
  });

  it("records removed mid-pagination: the step is partial and not resumable, never satisfied", async () => {
    const w = await world({ padding: 20 });
    await openContract(w);
    const job = await createJob(w, { budget: { max_units: 100, page_limit: 5 } });
    const apiStep = stepFor(job, "activity:api");
    w.ctx.db.prepare("UPDATE investigation_job_steps SET ord = 0 WHERE job_id = ? AND step_id = ?").run(job.id, apiStep);
    await advance(w, job.id, 1);
    const delivered = deliveredOf(w.ctx.store, job.id, apiStep);
    const victim = (w.ctx.db.prepare("SELECT id FROM events WHERE project_id = ? AND EXISTS (SELECT 1 FROM json_each(events.asset_ids) WHERE value = 'api') ORDER BY occurred_at DESC LIMIT 1").get(w.project) as { id: string }).id;
    expect(delivered).not.toContain(victim);
    w.ctx.db.prepare("DELETE FROM events WHERE id = ?").run(victim); // an operator purge between pages
    for (let i = 0; i < 20; i++) { const x = (await advance(w, job.id, 5)).json(); if (x.job.steps.find((s: { step_id: string }) => s.step_id === apiStep).status !== "running") break; }
    const j = (await w.ctx.app.inject({ method: "GET", url: `${J(w)}/${job.id}`, headers: w.ctx.h(w.ctx.viewer) })).json();
    const st = j.steps.find((s: { step_id: string }) => s.step_id === apiStep);
    expect(st.status).toBe("partial");
    expect(st.completeness).toMatch(/removed from storage after the first page/);
    const ob = (await w.ctx.app.inject({ method: "GET", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.viewer) })).json().contract.obligations.find((o: { id: string }) => o.id === "activity:api");
    expect(ob.status).not.toBe("satisfied");
  });

  it("a failed page (cursor no longer verifiable after a secret rotation) is failed: contract blocked, job completed_with_errors", async () => {
    const w = await world({ padding: 20 });
    await openContract(w);
    const principal = w.ctx.store.authenticateToken(w.ctx.analyst)!;
    const s1 = w.services();
    const job = s1.jobs.create(w.project, w.caseId, { budget: { max_units: 100, page_limit: 5 } }, principal, "analyst-test");
    const apiStep = stepFor(job, "activity:api");
    w.ctx.db.prepare("UPDATE investigation_job_steps SET ord = 0 WHERE job_id = ? AND step_id = ?").run(job.id, apiStep);
    s1.jobs.advance(w.project, job.id, 1, principal, "analyst-test");
    const s2 = w.services(w.ctx.store, {}, "rotated-secret");
    for (let i = 0; i < 20; i++) { const r = s2.jobs.advance(w.project, job.id, 10, principal, "analyst-test"); if (r.job.status.startsWith("completed")) break; }
    const j = s2.jobs.get(w.project, job.id);
    const st = j.steps.find((s) => s.step_id === apiStep)!;
    expect(st.status).toBe("failed");
    expect(st.error).toMatch(/invalid cursor: signature mismatch/);
    expect(j.status).toBe("completed_with_errors");
    const view = s2.contracts.view(w.project, w.caseId);
    const ob = view.contract.obligations.find((o) => o.id === "activity:api")!;
    expect(ob.status).toBe("failed");
    expect(view.contract.readiness).toBe("blocked");
    expect(view.contract.negative_claim_requirements.find((n) => n.id === "negative:api:authentication")!.assessable).toBe(false);
  });

  it("per-step purpose, counters, errors and the read-only plan preview are explicit; a viewer cannot create jobs", async () => {
    const w = await world();
    await openContract(w);
    const preview = (await w.ctx.app.inject({ method: "GET", url: `${w.base}/contract/plan`, headers: w.ctx.h(w.ctx.viewer) })).json();
    expect(preview).toMatchObject({ persisted: false, next_step: { obligation_id: expect.any(String) } });
    expect((await w.ctx.app.inject({ method: "POST", url: `${w.base}/jobs`, headers: w.ctx.h(w.ctx.viewer), payload: {} })).statusCode).toBe(403);
    expect(Number((w.ctx.db.prepare("SELECT COUNT(*) AS n FROM investigation_jobs").get() as { n: number }).n)).toBe(0);
    const job = await createJob(w);
    for (let i = 0; i < 20; i++) { const r = (await advance(w, job.id, 20)).json(); if (r.job.status.startsWith("completed")) break; }
    const j = (await w.ctx.app.inject({ method: "GET", url: `${J(w)}/${job.id}`, headers: w.ctx.h(w.ctx.viewer) })).json();
    expect(j.model_calls).toBe(0);
    for (const s of j.steps) { expect(s.purpose.length).toBeGreaterThan(10); expect(s.counters).toHaveProperty("units"); expect(s.completeness).toBeTruthy(); }
    const recipe = j.steps.find((s: { kind: string }) => s.kind === "recipe");
    expect(recipe.counters.units).toBeGreaterThan(1);
    expect(j.budget.used_units).toBe(j.steps.reduce((n: number, s: { counters: { units: number } }) => n + s.counters.units, 0));
    const dl = (await w.ctx.app.inject({ method: "GET", url: `${J(w)}/${job.id}/deliveries?limit=5`, headers: w.ctx.h(w.ctx.viewer) })).json();
    expect(dl.deliveries.length).toBe(5);
    expect(dl.next_after).toBeTypeOf("number");
  });

  it("quota: at most three active jobs per case", async () => {
    const w = await world();
    await openContract(w);
    for (let i = 0; i < 3; i++) await createJob(w, { budget: { max_units: 5 } });
    const r = await w.ctx.app.inject({ method: "POST", url: `${w.base}/jobs`, headers: w.ctx.h(w.ctx.analyst), payload: {} });
    expect(r.statusCode).toBe(429);
    expect(r.json().error).toMatch(/at most 3 active jobs per case/);
  });
});
