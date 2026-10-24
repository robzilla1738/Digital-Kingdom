import { describe, expect, it } from "vitest";
import { world } from "./phase-m2-world.ts";

/** LP12: the investigation workbench read model and the person-only settlement of case questions and notes. */
type W = Awaited<ReturnType<typeof world>>;
const J = (w: W) => `/api/projects/${w.project}/jobs`;
async function contract(w: W) { const r = await w.ctx.app.inject({ method: "POST", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.analyst) }); expect(r.statusCode, r.body).toBe(200); return r.json().contract; }
async function runJob(w: W, token: string, budget: Record<string, unknown> = { max_units: 200 }, rounds = 40) {
  const job = await w.ctx.app.inject({ method: "POST", url: `${w.base}/jobs`, headers: w.ctx.h(token), payload: { budget } });
  expect(job.statusCode, job.body).toBe(200);
  let j = job.json();
  for (let i = 0; i < rounds; i++) { const r = (await w.ctx.app.inject({ method: "POST", url: `${J(w)}/${j.id}/advance`, headers: w.ctx.h(token), payload: { max_units: 50 } })).json(); j = r.job; if (!["queued", "running"].includes(j.status)) break; }
  return j;
}
const workbench = async (w: W, token = w.ctx.viewer) => { const r = await w.ctx.app.inject({ method: "GET", url: `${w.base}/workbench`, headers: w.ctx.h(token) }); expect(r.statusCode, r.body).toBe(200); return r.json(); };
const getCase = async (w: W) => (await w.ctx.app.inject({ method: "GET", url: w.base, headers: w.ctx.h(w.ctx.viewer) })).json();
const tables = ["investigation_contracts", "investigation_contract_revisions", "investigation_transitions", "investigation_jobs", "investigation_job_steps", "investigation_deliveries", "investigation_conclusions", "case_items", "cases", "state_changes"];
const counts = (w: W) => Object.fromEntries(tables.map((t) => [t, (w.ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]));
const addItem = async (w: W, token: string, payload: Record<string, unknown>) => {
  const c = await getCase(w);
  return w.ctx.app.inject({ method: "POST", url: `${w.base}/items`, headers: w.ctx.h(token), payload: { ...payload, expected_version: c.version } });
};
const conclusion = (c: { case_id: string; run_id: string | null; revision: number }, text: string) => ({ schema: "dk.local.conclusion.v1", case_id: c.case_id, run_id: c.run_id, contract_revision: c.revision, status: "draft", semantic_review: "not_reviewed", scope_note: "agent proposal", requested_next_step: "bounded_conclusion",
  claims: [{ id: "c1", type: "unresolved", text, evidence_refs: [], coverage_refs: [], obligation_ids: [], uncertainty: "not established" }] });

describe("LP12 workbench read model", () => {
  it("LP12-A2: supporting and counter records, failed/partial queries and uncertainty are reachable as lists with shared anchors, and the read writes nothing", async () => {
    const w = await world({ contradiction: true, padding: 40 });
    const empty = await workbench(w);
    expect(empty.schema).toBe("dk.case_workbench.v1");
    expect(empty.contract).toBeNull();
    expect(empty.next_actions[0]).toMatchObject({ id: "open_contract", who: "analyst" });
    const c = await contract(w);
    const job = await runJob(w, w.ctx.analyst, { max_units: 4, page_limit: 5 });
    expect(job.status).toBe("budget_exhausted");
    const before = counts(w);
    const wb = await workbench(w);
    expect(counts(w)).toEqual(before); // no contract revision, ledger entry, job, step, delivery/exposure or case row
    expect(wb.writes).toBe("none");
    const stored = (await w.ctx.app.inject({ method: "GET", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.viewer) })).json().contract;
    expect(wb.contract).toMatchObject({ id: c.id, revision: stored.revision });
    // counterevidence is listed and never cut
    expect(wb.evidence.counter.length).toBeGreaterThan(0);
    for (const r of wb.evidence.counter) expect(r.role).toBe("counter");
    expect(wb.evidence.supporting.length).toBeGreaterThan(0);
    // failed or partial queries name the job step and the obligation, with resumability
    expect(wb.failed_queries.length).toBeGreaterThan(0);
    expect(wb.failed_queries.some((f: { kind: string; resumable?: boolean }) => f.kind === "query_step" && f.resumable === true)).toBe(true);
    // uncertainty: negative-claim assessability and coverage gaps stay explicit
    expect(wb.uncertainty.negative_claims.length).toBeGreaterThan(0);
    expect(wb.summary.does_not_support.some((s: string) => /intent or authorization/i.test(s))).toBe(true);
    expect(wb.summary.could_change.some((s: string) => /counter record/.test(s))).toBe(true);
    // next bounded action: the budget-exhausted job is resumed, not restarted
    expect(wb.next_actions.some((a: { id: string; route?: string }) => a.id === "advance_job" && a.route?.includes(job.id))).toBe(true);
    // shared anchors: canonical selection ids the castle and MCP use; every record anchor resolves in the index
    const index = new Map(wb.anchors.map((a: { id: string }) => [a.id, a]));
    for (const r of [...wb.evidence.supporting, ...wb.evidence.counter]) {
      expect(r.anchors).toContain(`event:${r.ref}`);
      for (const id of r.anchors) { expect(index.has(id)).toBe(true); expect(id).toMatch(/^(asset|event|finding):.{1,500}$/); }
    }
    const db = wb.anchors.find((a: { id: string }) => a.id === "asset:db");
    expect(db).toMatchObject({ kind: "asset", ref: "db", selection: { kind: "asset", id: "db" } });
    const forDb = [...wb.evidence.supporting, ...wb.evidence.counter].filter((r: { anchors: string[] }) => r.anchors.includes("asset:db"));
    expect(forDb.length).toBeGreaterThan(0);
    for (const r of forDb) expect(r.asset_ids).toContain("db");
    // untrusted text stays in its own field
    for (const r of wb.evidence.counter) expect(typeof r.untrusted).toBe("object");
  });

  it("LP12-A2: an observer outage is a coverage gap anchored to its asset, never a silent absence", async () => {
    const w = await world({ dbOutage: [1200, 2400] });
    await contract(w);
    await runJob(w, w.ctx.analyst);
    const wb = await workbench(w);
    expect(wb.uncertainty.coverage_gaps.length).toBeGreaterThan(0);
    const gap = wb.uncertainty.coverage_gaps.find((g: { asset_id: string }) => g.asset_id === "db");
    expect(gap).toBeTruthy();
    expect(gap.anchors).toContain("asset:db");
    expect(gap.uncovered_spans.length).toBeGreaterThan(0);
    expect(wb.summary.could_change.some((s: string) => /coverage gap/.test(s))).toBe(true);
  });

  it("is scoped: a viewer scoped to another project cannot read it, and a missing case is 404", async () => {
    const w = await world();
    await contract(w);
    const outsider = w.ctx.store.createToken("outsider", "viewer", ["demo-castle"]).token;
    const denied = await w.ctx.app.inject({ method: "GET", url: `${w.base}/workbench`, headers: w.ctx.h(outsider) });
    expect(denied.statusCode).toBe(404); // the project's existence is not revealed
    expect(denied.body).not.toContain("Burst then data access");
    expect((await w.ctx.app.inject({ method: "GET", url: `/api/projects/${w.project}/cases/case_missing/workbench`, headers: w.ctx.h(w.ctx.viewer) })).statusCode).toBe(404);
  });
});

describe("LP12-A3 agent completion never settles a case question or erases a person's note", () => {
  it("an agent's completed job and proposals leave the question open and the note intact; agent attempts to answer, remove or close are refused", async () => {
    const w = await world();
    const agent = w.ctx.store.createToken("agent-runner", "analyst", "*", undefined, "service").token;
    expect((await addItem(w, w.ctx.analyst, { kind: "question", text: "Which identity issued the database reads?" })).statusCode).toBe(200);
    expect((await addItem(w, w.ctx.analyst, { kind: "note", text: "Person's note: the ETL account is expected at night." })).statusCode).toBe(200);
    let kase = await getCase(w);
    const question = kase.items.find((i: { kind: string }) => i.kind === "question");
    const note = kase.items.find((i: { kind: string; text?: string }) => i.kind === "note" && /Person's note/.test(String(i.text)));
    const c = await contract(w);
    const job = await runJob(w, agent);
    expect(["complete", "completed", "succeeded"].some((s) => job.status === s) || job.status === "budget_exhausted").toBe(true);
    // two agent proposals: versioned, kept apart from the case record
    const current = (await w.ctx.app.inject({ method: "GET", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.viewer) })).json().contract;
    for (const text of ["The reads were by the ETL account; question answered.", "Second draft: identity unresolved."]) {
      const p = await w.ctx.app.inject({ method: "POST", url: `${w.base}/conclusions`, headers: w.ctx.h(agent), payload: conclusion({ case_id: w.caseId, run_id: c.run_id, revision: current.revision }, text) });
      expect(p.statusCode, p.body).toBe(200);
    }
    kase = await getCase(w);
    expect(kase.items.find((i: { item_id: string }) => i.item_id === question.item_id)).toMatchObject({ status: "open", answer: null });
    expect(kase.items.find((i: { item_id: string }) => i.item_id === note.item_id)).toMatchObject({ text: note.text });
    expect(kase.items.find((i: { item_id: string }) => i.item_id === note.item_id).removed).toBeUndefined();
    expect(kase.status).toBe("open");
    // direct agent attempts are refused by the server (the boundary is the principal type, not the UI)
    const ans = await w.ctx.app.inject({ method: "POST", url: `${w.base}/items/${question.item_id}/question`, headers: w.ctx.h(agent), payload: { status: "answered", answer: "ETL", expected_version: kase.version } });
    expect(ans.statusCode).toBe(403);
    expect(ans.json().error).toMatch(/agents cannot answer/);
    const accept = await w.ctx.app.inject({ method: "POST", url: `${w.base}/items/${question.item_id}/question`, headers: w.ctx.h(agent), payload: { status: "accepted_unresolved", answer: "unknown", expected_version: kase.version } });
    expect(accept.statusCode).toBe(403);
    const rm = await w.ctx.app.inject({ method: "POST", url: `${w.base}/items/${note.item_id}/remove`, headers: w.ctx.h(agent), payload: { reason: "superseded by agent draft", expected_version: kase.version } });
    expect(rm.statusCode).toBe(403);
    const close = await w.ctx.app.inject({ method: "POST", url: `${w.base}/status`, headers: w.ctx.h(agent), payload: { status: "resolved", statement: "agent done", expected_version: kase.version } });
    expect(close.statusCode).toBe(403);
    expect((await getCase(w)).version).toBe(kase.version);
    // an agent may still withdraw its own note
    expect((await addItem(w, agent, { kind: "note", text: "agent scratch note" })).statusCode).toBe(200);
    kase = await getCase(w);
    const mine = kase.items.find((i: { text?: string }) => i.text === "agent scratch note");
    expect((await w.ctx.app.inject({ method: "POST", url: `${w.base}/items/${mine.item_id}/remove`, headers: w.ctx.h(agent), payload: { reason: "own scratch", expected_version: kase.version } })).statusCode).toBe(200);
    // the workbench shows the proposals as versioned, unaccepted drafts and the question as still open
    const wb = await workbench(w);
    expect(wb.proposals.items.map((p: { proposal_version: number }) => p.proposal_version)).toEqual([2, 1]);
    for (const p of wb.proposals.items) expect(p).toMatchObject({ author_kind: "agent", accepted: false, affects_case_record: false });
    expect(wb.case_record.questions.find((q: { item_id: string }) => q.item_id === question.item_id)).toMatchObject({ status: "open", settled_by: "person" });
    expect(wb.case_record.notes.some((n: { item_id: string }) => n.item_id === note.item_id)).toBe(true);
    expect(wb.next_actions.some((a: { id: string; who: string }) => a.id === `answer_question:${question.item_id}` && a.who === "person")).toBe(true);
    // a person still answers normally
    kase = await getCase(w);
    expect((await w.ctx.app.inject({ method: "POST", url: `${w.base}/items/${question.item_id}/question`, headers: w.ctx.h(w.ctx.analyst), payload: { status: "accepted_unresolved", answer: "No identity telemetry on the database.", expected_version: kase.version } })).statusCode).toBe(200);
  });
});
