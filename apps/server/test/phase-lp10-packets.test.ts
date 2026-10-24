import { describe, expect, it } from "vitest";
import { world, at } from "./phase-m2-world.ts";

/** LP10: compact evidence packets and the structured claim checker. */
type W = Awaited<ReturnType<typeof world>>;
const J = (w: W) => `/api/projects/${w.project}/jobs`;
async function contract(w: W) { const r = await w.ctx.app.inject({ method: "POST", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.analyst) }); expect(r.statusCode, r.body).toBe(200); return r.json().contract; }
async function runJob(w: W, budget: Record<string, unknown> = { max_units: 200 }, rounds = 40) {
  const job = await w.ctx.app.inject({ method: "POST", url: `${w.base}/jobs`, headers: w.ctx.h(w.ctx.analyst), payload: { budget } });
  expect(job.statusCode, job.body).toBe(200);
  let j = job.json();
  for (let i = 0; i < rounds; i++) { const r = (await w.ctx.app.inject({ method: "POST", url: `${J(w)}/${j.id}/advance`, headers: w.ctx.h(w.ctx.analyst), payload: { max_units: 50 } })).json(); j = r.job; if (!["queued", "running"].includes(j.status)) break; }
  return j;
}
const packet = async (w: W, q = "", token = w.ctx.viewer) => { const r = await w.ctx.app.inject({ method: "GET", url: `${w.base}/packet${q}`, headers: w.ctx.h(token) }); expect(r.statusCode, r.body).toBe(200); return r.json(); };
const check = async (w: W, conclusion: unknown) => { const r = await w.ctx.app.inject({ method: "POST", url: `${w.base}/conclusions/check`, headers: w.ctx.h(w.ctx.viewer), payload: conclusion as Record<string, unknown> }); expect(r.statusCode, r.body).toBe(200); return r.json(); };
const conclusion = (c: { case_id: string; run_id: string | null; revision: number }, claims: unknown[], extra: Record<string, unknown> = {}) => ({ schema: "dk.local.conclusion.v1", case_id: c.case_id, run_id: c.run_id, contract_revision: c.revision, claims, status: "draft", semantic_review: "not_reviewed", scope_note: "test conclusion", requested_next_step: "retrieve_more", ...extra });
const current = async (w: W) => (await w.ctx.app.inject({ method: "GET", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.viewer) })).json().contract;
const aliceRead = (w: W) => w.ctx.store.listEvents(w.project, { limit: 5000 }).find((e) => e.action === "data_access" && e.actor_ref === "alice")!;

describe("LP10-A1 a summary never substitutes for a missing required record; omissions are machine-readable", () => {
  it("size-limited pages list omitted records individually (required) or by role, and expansion delivers every record exactly once", async () => {
    const w = await world({ padding: 60 });
    await contract(w);
    await runJob(w);
    const first = await packet(w, "?max_bytes=9000");
    expect(first.schema).toBe("dk.evidence_packet.v1");
    expect(first.summary.substitutes_for_records).toBe(false);
    expect(first.summary.records_total).toBeGreaterThan(60);
    expect(first.records.length).toBeLessThan(first.summary.records_total);
    expect(first.page.next_cursor).toBeTruthy();
    expect(first.omissions.machine_readable).toBe(true);
    expect(first.omissions.other.length).toBeGreaterThan(0);
    for (const g of first.omissions.other) expect(g).toMatchObject({ role: expect.any(String), required: false, count: expect.any(Number), reason: "size_limit", expand_cursor: first.page.next_cursor });
    // required records come first: everything a linked finding cites is in the first page or listed individually
    const required = first.records.filter((r: { required: boolean }) => r.required).map((r: { ref: string }) => r.ref);
    expect(required.length + first.omissions.required.length).toBe(first.summary.required_total);
    for (const o of first.omissions.required) expect(o).toMatchObject({ required: true, reason: "size_limit", expand_cursor: expect.any(String) });
    expect(first.complete_for_required).toBe(first.omissions.required.length === 0);
    // expansion is non-destructive: same packet id, every record once
    const seen: string[] = first.records.map((r: { ref: string }) => r.ref);
    let cur = first;
    for (let i = 0; i < 50 && cur.page.next_cursor; i++) { cur = await packet(w, `?max_bytes=9000&cursor=${encodeURIComponent(cur.page.next_cursor)}`); expect(cur.packet_id).toBe(first.packet_id); seen.push(...cur.records.map((r: { ref: string }) => r.ref)); }
    expect(cur.page.next_cursor).toBeNull();
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(first.summary.records_total);
    // re-reading page one returns the same records (earlier pages stay valid)
    expect((await packet(w, "?max_bytes=9000")).records.map((r: { ref: string }) => r.ref)).toEqual(first.records.map((r: { ref: string }) => r.ref));
    // a summary-only packet is impossible: the uncertainty and summary sections are never cut, records are bounded
    expect((await w.ctx.app.inject({ method: "GET", url: `${w.base}/packet?max_bytes=100`, headers: w.ctx.h(w.ctx.viewer) })).statusCode).toBe(422);
    expect((await w.ctx.app.inject({ method: "GET", url: `${w.base}/packet?summary_only=1`, headers: w.ctx.h(w.ctx.viewer) })).statusCode).toBe(422);
  });

  it("a required record that is no longer stored is an individual required omission, never replaced by counts", async () => {
    const w = await world();
    await contract(w);
    await runJob(w);
    const victim = w.finding.event_ids[0]!;
    w.ctx.db.prepare("DELETE FROM events WHERE id = ?").run(victim);
    const p = await packet(w, "?max_bytes=400000");
    expect(p.summary.required_not_stored).toBe(1);
    expect(p.omissions.required).toEqual(expect.arrayContaining([expect.objectContaining({ ref: victim, required: true, reason: "not_stored" })]));
    expect(p.complete_for_required).toBe(false);
    expect(p.complete).toBe(false);
    expect(p.records.map((r: { ref: string }) => r.ref)).not.toContain(victim);
  });
});

describe("LP10-A2 existing-but-not-retrieved refs fail availability; cross-run/revision refs fail scope", () => {
  it("availability, existence and project scope are separate checks", async () => {
    const w = await world();
    const c = await contract(w);
    const read = aliceRead(w);
    const claim = (refs: string[]) => [{ id: "c1", type: "observed", text: "A data_access record exists for alice on db.", evidence_refs: refs, coverage_refs: [], obligation_ids: ["activity:db"], uncertainty: "bounded to the interval" }];
    let r = await check(w, conclusion({ case_id: w.caseId, run_id: c.run_id, revision: c.revision }, claim([read.id])));
    expect(r.status).toBe("rejected");
    expect(r.claims[0].references[0]).toMatchObject({ exists: true, available: false });
    expect(r.claims[0].problems.join()).toMatch(/availability: .* exists but was never delivered/);
    const other = w.ctx.store.listEvents("demo-castle", { limit: 1 })[0]!;
    r = await check(w, conclusion({ case_id: w.caseId, run_id: c.run_id, revision: c.revision }, claim([other.id])));
    expect(r.claims[0].problems.join()).toMatch(/scope: .* belongs to another project\/run/);
    r = await check(w, conclusion({ case_id: w.caseId, run_id: c.run_id, revision: c.revision }, claim(["ev-does-not-exist"])));
    expect(r.claims[0].problems.join()).toMatch(/existence: no stored record/);
    await runJob(w);
    const now = await current(w);
    r = await check(w, conclusion({ case_id: w.caseId, run_id: now.run_id, revision: now.revision }, claim([read.id])));
    expect(r.claims[0].references[0]).toMatchObject({ exists: true, in_scope: true, available: true, problems: [] });
    expect(r.claims[0].support_level).toBe("references_checked_narrative_unverified");
  });

  it("a record retrieved under a revision with a different scope fails the scope check; a stale contract revision is refused", async () => {
    const w = await world();
    await contract(w);
    await runJob(w);
    const read = aliceRead(w);
    const before = await current(w);
    const kase = (await w.ctx.app.inject({ method: "GET", url: w.base, headers: w.ctx.h(w.ctx.viewer) })).json();
    expect((await w.ctx.app.inject({ method: "POST", url: w.base, headers: w.ctx.h(w.ctx.analyst), payload: { expected_version: kase.version, scope: { ...kase.scope, before: at(7200) } } })).statusCode).toBe(200);
    const after = await current(w);
    expect(after.revision).toBeGreaterThan(before.revision);
    const claims = [{ id: "c1", type: "observed", text: "A data_access record exists for alice on db.", evidence_refs: [read.id], coverage_refs: [], obligation_ids: ["activity:db"], uncertainty: "bounded" }];
    let r = await check(w, conclusion({ case_id: w.caseId, run_id: after.run_id, revision: after.revision }, claims));
    expect(r.claims[0].references[0]).toMatchObject({ exists: true, in_scope: false, available: false });
    expect(r.claims[0].problems.join()).toMatch(/retrieved under contract revision .* whose scope differs/);
    r = await check(w, conclusion({ case_id: w.caseId, run_id: before.run_id, revision: before.revision }, claims));
    expect(r.problems.join()).toMatch(/cites contract revision .* current revision is/);
    // inspecting the ref under the new scope makes it available again (an explicit, logged delivery)
    const ins = (await w.ctx.app.inject({ method: "GET", url: `${w.base}/refs?ids=${read.id}`, headers: w.ctx.h(w.ctx.viewer) })).json();
    expect(ins.records[0]).toMatchObject({ found: true, in_contract_scope: true });
    r = await check(w, conclusion({ case_id: w.caseId, run_id: after.run_id, revision: after.revision }, claims));
    expect(r.claims[0].references[0]).toMatchObject({ in_scope: true, available: true });
  });
});

describe("LP10-A3 natural-language support is never labelled machine-proved because IDs exist", () => {
  it("valid IDs + intent narrative: references checked, narrative flagged, conclusion stays a draft; nothing is machine_proved", async () => {
    const w = await world();
    await contract(w);
    await runJob(w);
    const c = await current(w);
    const read = aliceRead(w);
    const r = await check(w, conclusion({ case_id: w.caseId, run_id: c.run_id, revision: c.revision }, [
      { id: "c1", type: "observed", text: "The attacker maliciously exfiltrated the customer table; this proves the account was compromised.", evidence_refs: [read.id], coverage_refs: [], obligation_ids: ["activity:db"], uncertainty: "none" },
    ]));
    expect(r.claims[0].references[0]).toMatchObject({ exists: true, in_scope: true, available: true });
    expect(r.claims[0].support_level).toBe("references_checked_narrative_unverified");
    expect(r.claims[0].narrative.machine_checked).toBe(false);
    expect(r.claims[0].narrative.flags.map((f: { id: string }) => f.id)).toEqual(expect.arrayContaining(["intent_or_attribution", "absolute_or_proof"]));
    expect(r.status).toBe("draft");
    expect(r.semantic_review).toBe("not_reviewed");
    expect(r.labels).toEqual({ machine_proved: false, semantic_entailment_checked: false });
    expect(JSON.stringify(r)).not.toMatch(/"machine_proved":true/);
  });

  it("a structured predicate is checked against the cited delivered records, and only the predicate earns predicate_checked", async () => {
    const w = await world();
    await contract(w);
    await runJob(w);
    const c = await current(w);
    const read = aliceRead(w);
    const mk = (pred: Record<string, unknown>, text = "A successful data_access on db by alice is recorded.") => conclusion({ case_id: w.caseId, run_id: c.run_id, revision: c.revision }, [{ id: "c1", type: "observed", text, evidence_refs: [read.id], coverage_refs: [], obligation_ids: ["activity:db"], uncertainty: "bounded to stored records", predicate: pred }]);
    let r = await check(w, mk({ kind: "action_observed", asset_id: "db", action: "data_access", outcome: "success", actor_ref: "alice" }));
    expect(r.claims[0].support_level).toBe("predicate_checked");
    expect(r.claims[0].predicate).toMatchObject({ present: true, holds: true, matching_refs: [read.id] });
    expect(r.claims[0].machine_proved).toBe(false);
    // the claim is structurally checked; the conclusion as a whole stays unresolved while the contract is
    expect(r.status).toBe(c.readiness === "bounded_answer_ready" ? "machine_checked_structured" : "unresolved");
    r = await check(w, mk({ kind: "action_observed", asset_id: "db", action: "data_access", actor_ref: "mallory" }));
    expect(r.claims[0].support_level).toBe("failed");
    expect(r.claims[0].problems.join()).toMatch(/predicate does not hold/);
    r = await check(w, mk({ kind: "action_observed", asset_id: "db", action: "data_access", actor_ref: "alice" }, "alice read db and the owner approved it"));
    expect(r.claims[0].support_level).toBe("predicate_checked");
    expect(r.claims[0].narrative.flags.map((f: { id: string }) => f.id)).toContain("authorization_judgement");
    expect(r.status).toBe("draft");
  });

  it("absence claims: assessable only with complete retrieval + continuous coverage, and contradicted by a retrieved record", async () => {
    const w = await world({ assets: ["db"] });
    const kase = (await w.ctx.app.inject({ method: "GET", url: w.base, headers: w.ctx.h(w.ctx.viewer) })).json();
    expect((await w.ctx.app.inject({ method: "POST", url: w.base, headers: w.ctx.h(w.ctx.analyst), payload: { expected_version: kase.version, scope: { ...kase.scope, after: at(60), before: at(7000) } } })).statusCode).toBe(200);
    await contract(w);
    await runJob(w);
    const c = await current(w);
    expect(c.negative_claim_requirements.find((n: { id: string }) => n.id === "negative:db:data_access").assessable).toBe(true);
    const cov = c.obligations.find((o: { id: string }) => o.id === "coverage:db:data_access").query_refs.find((q: string) => q.startsWith("cov:"));
    const neg = (actor: string) => conclusion({ case_id: w.caseId, run_id: c.run_id, revision: c.revision }, [{ id: "n1", type: "not_observed_in_scope", text: `No stored data_access record on db shows ${actor} in the interval.`, evidence_refs: [], coverage_refs: [cov], obligation_ids: ["activity:db", "coverage:db:data_access"], uncertainty: "absence in stored records only", predicate: { kind: "action_not_observed", asset_id: "db", action: "data_access", actor_ref: actor } }]);
    let r = await check(w, neg("mallory"));
    expect(r.claims[0]).toMatchObject({ support_level: "predicate_checked", predicate: { holds: true } });
    expect(r.claims[0].coverage_refs[0]).toMatchObject({ kind: "coverage", available: true });
    r = await check(w, neg("alice"));
    expect(r.claims[0].support_level).toBe("failed");
    expect(r.claims[0].predicate.contradicting_refs).toContain(aliceRead(w).id);
  });
});

describe("LP10-A4 counterevidence, source uncertainty and partial query status survive size limits and exports", () => {
  it("at the minimum budget the first record is counterevidence and the uncertainty section is complete", async () => {
    const w = await world({ contradiction: true, padding: 40 });
    await contract(w);
    const job = await runJob(w, { max_units: 4, page_limit: 5 });
    expect(job.status).toBe("budget_exhausted");
    const big = await packet(w, "?max_bytes=400000");
    const counters = big.records.filter((r: { role: string }) => r.role === "counter");
    expect(counters.length).toBeGreaterThan(0);
    // a budget too small for the uncertainty section is refused, never trimmed
    const refused = await w.ctx.app.inject({ method: "GET", url: `${w.base}/packet?max_bytes=4000`, headers: w.ctx.h(w.ctx.viewer) });
    expect(refused.statusCode).toBe(413);
    expect(refused.json().error).toMatch(/never cut/);
    const small = await packet(w, "?max_bytes=9000");
    expect(small.records.length).toBeLessThan(big.records.length);
    expect(small.records[0].role).toBe("counter");
    expect(small.uncertainty).toEqual(big.uncertainty);
    expect(small.uncertainty.query_status.some((s: { status: string; resumable: boolean }) => s.status === "partial_budget" && s.resumable)).toBe(true);
    expect(small.uncertainty.unmet_obligations.some((o: { status: string }) => o.status === "partial")).toBe(true);
    expect(small.uncertainty.negative_claims.every((n: { assessable: boolean }) => !n.assessable)).toBe(true);
    expect(small.records[0].untrusted).toMatchObject({}); // untrusted text kept apart from structured fields
  });

  it("the signed export carries every counter record, the uncertainty and the omissions; tampering is detected", async () => {
    const w = await world({ contradiction: true, padding: 40 });
    await contract(w);
    await runJob(w);
    expect((await w.ctx.app.inject({ method: "POST", url: `${w.base}/packet/export`, headers: w.ctx.h(w.ctx.viewer), payload: {} })).statusCode).toBe(403);
    const ex = (await w.ctx.app.inject({ method: "POST", url: `${w.base}/packet/export`, headers: w.ctx.h(w.ctx.analyst), payload: { max_bytes: 9000 } })).json();
    expect(ex.manifest).toMatchObject({ format: "dk.evidence_packet_export/1", counterevidence_count: expect.any(Number) });
    expect(ex.manifest.counterevidence_count).toBeGreaterThan(0);
    expect(ex.sections.counterevidence.every((r: { role: string }) => r.role === "counter")).toBe(true);
    expect(ex.sections.uncertainty.coverage_gaps.length).toBeGreaterThan(0);
    expect(ex.sections.omissions.machine_readable).toBe(true);
    const verify = async (b: unknown) => (await w.ctx.app.inject({ method: "POST", url: "/api/verify-packet-export", headers: w.ctx.h(w.ctx.viewer), payload: b as Record<string, unknown> })).json();
    expect(await verify(ex)).toMatchObject({ valid: true, packet_id: ex.manifest.packet_id });
    expect(await verify({ ...ex, sections: { ...ex.sections, counterevidence: [] } })).toMatchObject({ valid: false, reason: "section counterevidence was modified" });
    expect(await verify({ ...ex, sections: { ...ex.sections, uncertainty: { ...ex.sections.uncertainty, coverage_gaps: [] } } })).toMatchObject({ valid: false, reason: "section uncertainty was modified" });
    expect(await verify({ ...ex, manifest: { ...ex.manifest, complete: true, counterevidence_count: 0 } })).toMatchObject({ valid: false, reason: "manifest signature mismatch" });
  });

  it("packet reads log exposures but change no contract, job or conclusion; proposals are analyst writes and append-only", async () => {
    const w = await world();
    await contract(w);
    await runJob(w);
    const count = (t: string) => Number((w.ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n);
    const snap = () => ({ revs: count("investigation_contract_revisions"), ledger: count("investigation_transitions"), jobs: count("investigation_jobs"), steps: count("investigation_job_steps"), concl: count("investigation_conclusions") });
    const s0 = snap();
    const p = await packet(w);
    expect(p.exposure.recorded).toBe(p.records.length);
    const c = await current(w);
    const draft = (await w.ctx.app.inject({ method: "GET", url: `${w.base}/contract/unresolved-draft`, headers: w.ctx.h(w.ctx.viewer) })).json().draft;
    await check(w, draft);
    expect(snap()).toEqual(s0);
    expect((await w.ctx.app.inject({ method: "POST", url: `${w.base}/conclusions`, headers: w.ctx.h(w.ctx.viewer), payload: draft })).statusCode).toBe(403);
    const prop = await w.ctx.app.inject({ method: "POST", url: `${w.base}/conclusions`, headers: w.ctx.h(w.ctx.analyst), payload: draft });
    expect(prop.statusCode).toBe(200);
    expect(prop.json().status).toMatch(/unresolved|machine_checked_structured/);
    expect(count("investigation_conclusions")).toBe(1);
    expect(() => w.ctx.db.prepare("UPDATE investigation_conclusions SET status = 'machine_checked_structured'").run()).toThrow(/append-only/);
    const kase = (await w.ctx.app.inject({ method: "GET", url: w.base, headers: w.ctx.h(w.ctx.viewer) })).json();
    expect(kase.status).toBe("open");
    expect(c.revision).toBe((await current(w)).revision);
  });
});
