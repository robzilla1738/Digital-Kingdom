import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateConclusion, validateInvestigationContract, type InvestigationContract } from "@dk/contracts";
import { world, at, AFTER, BEFORE } from "./phase-m2-world.ts";
import { parseSearchQuery, searchEvents } from "../src/investigate.ts";
import { coverageHistory } from "../src/coverage-history.ts";
import { checkAgainstContract, draftUnresolvedConclusion } from "../src/investigation/conclusions.ts";
import type { ObligationResult } from "../src/investigation/contracts.ts";

/** LP08: investigation contracts and obligations. */
type W = Awaited<ReturnType<typeof world>>;
const ids = (c: InvestigationContract) => c.obligations.map((o) => o.id).sort();
const status = (c: InvestigationContract, id: string) => c.obligations.find((o) => o.id === id)!.status;

/** A real complete retrieval of every stored event on one asset in the contract interval (what an LP09 step does). */
function retrieve(w: W, asset: string, revision: number, interval = { after: AFTER, before: BEFORE }): ObligationResult {
  const q = parseSearchQuery({ after: interval.after, before: interval.before, asset_id: asset, limit: "100" }).query;
  const refs: string[] = []; let cursor: string | undefined; let snap = 0; let matched = 0;
  for (;;) {
    const r = searchEvents(w.ctx.store, w.project, q, "test-secret", cursor);
    snap = r.snapshot_seq; matched = r.query_completeness.matching_in_snapshot; refs.push(...r.events.map((e) => e.id));
    if (r.query_completeness.complete) break;
    cursor = r.page.next_cursor!;
  }
  return { obligation_id: `activity:${asset}`, status: "satisfied", evidence_refs: refs, query_refs: [`test-retrieval:${asset}:${snap}`], reason: `complete: ${refs.length} record(s)`, validity: { snapshot_seq: snap, matched },
    scope: { project_id: w.project, contract_revision: revision, asset_id: asset, after: interval.after, before: interval.before } };
}
function coverage(w: W, asset: string, action: "data_access" | "authentication" | "request_received", revision: number): ObligationResult {
  const h = coverageHistory(w.ctx.store, w.project, { asset, action, after: AFTER, before: BEFORE });
  const configured = h.sources.length > 0 && h.spans.some((s) => s.sources.length > 0);
  const st = !configured || h.totals_ms.unknown > 0 ? "unavailable" : h.totals_ms.partial > 0 ? "partial" : "satisfied";
  const seq = Number((w.ctx.db.prepare("SELECT COALESCE(MAX(seq),0) AS m FROM events WHERE project_id = ?").get(w.project) as { m: number }).m);
  return { obligation_id: `coverage:${asset}:${action}`, status: st, evidence_refs: [], query_refs: [`test-coverage:${asset}:${action}`], reason: st === "satisfied" ? "covered for the whole interval" : configured ? `${Math.round(h.totals_ms.unknown / 60000)} minute(s) unknown` : "no source is configured to observe this asset and event class",
    validity: { snapshot_seq: seq, source_config_revisions: w.contracts.sourceRevisions(w.project) }, scope: { project_id: w.project, contract_revision: revision, asset_id: asset, action, after: AFTER, before: BEFORE } };
}

describe("LP08-A1 contracts derive from public case scope and supported recipes only", () => {
  it("obligations follow the case scope, declared asset kinds, linked finding and applicable recipes", async () => {
    const w = await world();
    const res = await w.ctx.app.inject({ method: "POST", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.analyst) });
    expect(res.statusCode).toBe(200);
    const c = res.json().contract as InvestigationContract;
    expect(validateInvestigationContract(c).ok).toBe(true);
    expect(c.private_truth_access).toBe(false);
    expect(c.derivation.inputs).toEqual(["case.scope", "case.linked_findings", "case.linked_events", "graph.asset_kinds", "recipes.applies_to", "obligation_catalog"]);
    expect(ids(c)).toEqual([`bundle:${w.finding.id}`, "activity:api", "activity:db", "coverage:api:authentication", "coverage:api:request_received", "coverage:db:data_access", `recipe:auth-burst-then-success:${w.finding.id}`].sort());
    expect(c.derivation.recipes).toEqual(["auth-burst-then-success@2"]);
    expect(c.negative_claim_requirements.map((n) => n.id).sort()).toEqual(["negative:api:authentication", "negative:api:request_received", "negative:db:data_access"]);
    expect(c.negative_claim_requirements.every((n) => !n.assessable)).toBe(true);
    expect(c.readiness).toBe("not_started");
    expect(c.scope).toEqual({ asset_ids: ["api", "db"], after: AFTER, before: BEFORE });
  });

  it("twin worlds with identical public evidence and different private truth get identical contracts; the canary never appears", async () => {
    // Private referee truth for each twin. It differs, and it is NEVER handed to the product.
    const truthA = { canary: "CANARY-7f3a9-private-oracle", world_truth: "a read of db happened during the observer outage" };
    const truthB = { canary: "CANARY-7f3a9-private-oracle", world_truth: "no read happened during the observer outage" };
    expect(truthA.world_truth).not.toBe(truthB.world_truth);
    const contractsOf = async () => {
      const w = await world({ dbOutage: [3300, 4500] });
      const r = await w.ctx.app.inject({ method: "POST", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.analyst) });
      const view = await w.ctx.app.inject({ method: "GET", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.viewer) });
      const dump = JSON.stringify(w.ctx.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => w.ctx.db.prepare(`SELECT * FROM "${(t as { name: string }).name}"`).all()));
      return { c: r.json().contract as InvestigationContract, text: r.body + view.body, dump };
    };
    const a = await contractsOf(), b = await contractsOf();
    const strip = (c: InvestigationContract) => ({ ...c, id: "x", case_id: "x", derivation: { ...c.derivation, inputs_digest: "x" } });
    expect(strip(a.c)).toEqual(strip(b.c));
    for (const x of [a, b]) { expect(x.text).not.toContain(truthA.canary); expect(x.dump).not.toContain(truthA.canary); expect(x.text).not.toMatch(/world_truth|oracle/); }
  });

  it("the investigation modules import nothing that could reach scenario truth (no filesystem, scenarios, eval or referee code)", () => {
    const dir = resolve(import.meta.dirname, "../src/investigation");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const imports = [...readFileSync(join(dir, f), "utf8").matchAll(/^import[^;]*from\s+"([^"]+)"/gm)].map((m) => m[1]!);
      for (const i of imports) expect(i, `${f} imports ${i}`).not.toMatch(/node:fs|node:child_process|scenario|oracle|referee|truth|eval\//i);
    }
  });

  it("proposal ids, private truth access and unbounded scope are rejected", async () => {
    const w = await world();
    const c = (await w.ctx.app.inject({ method: "POST", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.analyst) })).json().contract as InvestigationContract;
    expect(validateInvestigationContract({ ...c, schema: "dk.local.investigation_contract.proposed.v1" }).ok).toBe(false);
    expect(validateInvestigationContract({ ...c, private_truth_access: true }).ok).toBe(false);
    expect(validateInvestigationContract({ ...c, hidden_goal: "event-217" }).ok).toBe(false);
    expect(validateInvestigationContract({ ...c, scope: { ...c.scope, after: BEFORE, before: AFTER } }).errors.join()).toMatch(/ordered/);
    expect(validateInvestigationContract({ ...c, readiness: "bounded_answer_ready" }).errors.join()).toMatch(/inconsistent|bounded_answer_ready requires/);
    // a case without an interval cannot get a contract (unbounded work)
    const res = await w.ctx.app.inject({ method: "POST", url: `/api/projects/${w.project}/cases`, headers: w.ctx.h(w.ctx.analyst), payload: { title: "unbounded", closure_criteria: "x", scope: { question: "anything?", asset_ids: ["api"] } } });
    const open = await w.ctx.app.inject({ method: "POST", url: `/api/projects/${w.project}/cases/${res.json().id}/contract`, headers: w.ctx.h(w.ctx.analyst) });
    expect(open.statusCode).toBe(422);
    expect(open.json().error).toMatch(/bounded interval/);
  });
});

describe("LP08-A2 an obligation is satisfied only by required scoped evidence or a documented inapplicability reason", () => {
  it("results from another scope, project or revision are refused; the exact scope satisfies", async () => {
    const w = await world();
    const c = (await w.ctx.app.inject({ method: "POST", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.analyst) })).json().contract as InvestigationContract;
    const good = retrieve(w, "api", c.revision);
    const narrower = retrieve(w, "api", c.revision, { after: at(0), before: at(100) });
    const wrongAsset = { ...retrieve(w, "db", c.revision), obligation_id: "activity:api" };
    const otherProject = { ...good, scope: { ...good.scope, project_id: "demo-castle" } };
    const oldRevision = { ...good, scope: { ...good.scope, contract_revision: c.revision + 7 } };
    const noRefs = { ...good, query_refs: [] };
    const r = w.contracts.applyResults(w.project, w.caseId, [narrower, wrongAsset, otherProject, oldRevision, noRefs], "test", "test");
    expect(r.applied).toBe(0);
    expect(r.refused.map((x) => x.reason).join("\n")).toMatch(/obligation requires exactly/);
    expect(r.refused.map((x) => x.reason).join("\n")).toMatch(/asset db, obligation requires api/);
    expect(r.refused.map((x) => x.reason).join("\n")).toMatch(/project demo-castle/);
    expect(r.refused.map((x) => x.reason).join("\n")).toMatch(/contract revision/);
    expect(r.refused.map((x) => x.reason).join("\n")).toMatch(/must name the query/);
    expect(status(w.contracts.stored(w.project, w.caseId), "activity:api")).toBe("not_started");
    const ok = w.contracts.applyResults(w.project, w.caseId, [good], "test", "test");
    expect(ok.applied).toBe(1);
    const after = ok.view.contract;
    expect(status(after, "activity:api")).toBe("satisfied");
    expect(after.obligations.find((o) => o.id === "activity:api")!.evidence_refs.length).toBeGreaterThan(0);
    expect(after.revision).toBe(c.revision + 1);
  });

  it("there is no route that sets satisfied; inapplicability needs analyst role, the current revision and a documented reason", async () => {
    const w = await world();
    const { app, h, analyst, viewer } = w.ctx;
    const c = (await app.inject({ method: "POST", url: `${w.base}/contract`, headers: h(analyst) })).json().contract as InvestigationContract;
    expect((await app.inject({ method: "POST", url: `${w.base}/contract/obligations/coverage:api:request_received/satisfied`, headers: h(analyst), payload: {} })).statusCode).toBe(404);
    const url = `${w.base}/contract/obligations/coverage:api:request_received/inapplicable`;
    expect((await app.inject({ method: "POST", url, headers: h(viewer), payload: { reason: "the edge never forwards here", expected_revision: c.revision } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url, headers: h(analyst), payload: { reason: "n/a", expected_revision: c.revision } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, headers: h(analyst), payload: { reason: "the case question is about authentication only" } })).statusCode).toBe(428);
    expect((await app.inject({ method: "POST", url, headers: h(analyst), payload: { reason: "the case question is about authentication only", expected_revision: c.revision + 3 } })).statusCode).toBe(409);
    const ok = await app.inject({ method: "POST", url, headers: h(analyst), payload: { reason: "the case question is about authentication only", expected_revision: c.revision } });
    expect(ok.statusCode).toBe(200);
    const o = (ok.json().contract as InvestigationContract).obligations.find((x) => x.id === "coverage:api:request_received")!;
    expect(o).toMatchObject({ status: "inapplicable_with_reason", reason: "the case question is about authentication only" });
    const ledger = (await app.inject({ method: "GET", url: `${w.base}/contract/ledger?obligation=coverage:api:request_received`, headers: h(viewer) })).json().transitions;
    expect(ledger.at(-1)).toMatchObject({ from_status: "not_started", to_status: "inapplicable_with_reason", cause: "analyst_decision", actor: expect.stringContaining("analyst") });
  });

  it("the validator rejects satisfied without step references and inapplicable without a reason", async () => {
    const w = await world();
    const c = (await w.ctx.app.inject({ method: "POST", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.analyst) })).json().contract as InvestigationContract;
    const mut = (patch: Record<string, unknown>) => ({ ...c, readiness: "collecting", obligations: c.obligations.map((o, i) => (i === 0 ? { ...o, ...patch } : o)) });
    expect(validateInvestigationContract(mut({ status: "satisfied" })).errors.join()).toMatch(/satisfied requires the query/);
    expect(validateInvestigationContract(mut({ status: "inapplicable_with_reason", reason: "" })).errors.join()).toMatch(/documented reason/);
    expect(validateInvestigationContract(mut({ status: "unavailable", reason: "" })).errors.join()).toMatch(/requires a reason/);
  });
});

describe("LP08-A3 an incomplete investigation can honestly conclude unresolved", () => {
  it("no observer for db: every obligation attempted -> unresolved_answer_ready; the draft asserts no negative and no intent", async () => {
    const w = await world({ noDbSource: true });
    let c = (await w.ctx.app.inject({ method: "POST", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.analyst) })).json().contract as InvestigationContract;
    const r = w.contracts.applyResults(w.project, w.caseId, [retrieve(w, "api", c.revision), retrieve(w, "db", c.revision), coverage(w, "api", "authentication", c.revision), coverage(w, "api", "request_received", c.revision), coverage(w, "db", "data_access", c.revision)], "test", "test");
    expect(r.refused).toEqual([]);
    c = r.view.contract;
    expect(status(c, "coverage:db:data_access")).toBe("unavailable");
    // recipe and bundle not attempted yet: still collecting, never an unresolved escape hatch
    expect(c.readiness).toBe("collecting");
    const early = draftUnresolvedConclusion(c);
    expect(early.requested_next_step).toBe("retrieve_more");
    for (const id of [`bundle:${w.finding.id}`, `recipe:auth-burst-then-success:${w.finding.id}`]) {
      const o = c.obligations.find((x) => x.id === id)!;
      const res: ObligationResult = { obligation_id: id, status: id.startsWith("bundle") ? "satisfied" : "unavailable", evidence_refs: w.finding.event_ids, query_refs: [`test:${id}`], reason: id.startsWith("bundle") ? "every pinned record intact" : "stop condition: data-access observer not live",
        scope: { project_id: w.project, contract_revision: c.revision, finding_id: w.finding.id, finding_revision: o.target.finding_revision, bundle_id: o.target.bundle_id, recipe: o.target.recipe }, validity: { finding_revision: w.finding.revision } };
      c = w.contracts.applyResults(w.project, w.caseId, [res], "test", "test").view.contract;
    }
    expect(c.readiness).toBe("unresolved_answer_ready");
    expect(c.negative_claim_requirements.find((n) => n.id === "negative:db:data_access")!.assessable).toBe(false);
    const draft = (await w.ctx.app.inject({ method: "GET", url: `${w.base}/contract/unresolved-draft`, headers: w.ctx.h(w.ctx.viewer) })).json();
    expect(validateConclusion(draft.draft).ok).toBe(true);
    expect(draft.check.ok).toBe(true);
    expect(draft.draft.status).toBe("unresolved");
    expect(draft.draft.claims.every((x: { type: string }) => x.type === "unresolved")).toBe(true);
    expect(draft.draft.claims.map((x: { obligation_ids: string[] }) => x.obligation_ids[0])).toContain("coverage:db:data_access");
    expect(JSON.stringify(draft.draft)).not.toMatch(/malicious|attacker|intentional|did not|no access|never happened/i);
    // asserting the negative is refused however it is phrased
    const negative = { ...draft.draft, claims: [{ id: "neg", type: "not_observed_in_scope", text: "No data was read from db.", evidence_refs: [], coverage_refs: ["test-coverage:db:data_access"], obligation_ids: ["activity:db", "coverage:db:data_access"], uncertainty: "low", predicate: { kind: "action_not_observed", asset_id: "db", action: "data_access" } }] };
    expect(validateConclusion(negative).ok).toBe(true);
    const chk = checkAgainstContract(c, negative as never);
    expect(chk.ok).toBe(false);
    expect(chk.claims[0]!.problems.join()).toMatch(/negative claim not assessable/);
    // an unresolved claim cannot cite only satisfied work
    const dodge = { ...draft.draft, claims: [{ id: "u", type: "unresolved", text: "unclear", evidence_refs: [], coverage_refs: [], obligation_ids: ["activity:api"], uncertainty: "?" }] };
    expect(checkAgainstContract(c, dodge as never).claims[0]!.problems.join()).toMatch(/actually unmet/);
    // a bounded conclusion cannot be requested from an unresolved contract
    expect(checkAgainstContract(c, { ...draft.draft, requested_next_step: "bounded_conclusion" }).problems.join()).toMatch(/bounded conclusion is requested/);
  });

  it("the validator refuses unresolved_answer_ready while work was never attempted", async () => {
    const w = await world();
    const c = (await w.ctx.app.inject({ method: "POST", url: `${w.base}/contract`, headers: w.ctx.h(w.ctx.analyst) })).json().contract as InvestigationContract;
    const bad = { ...c, readiness: "unresolved_answer_ready", obligations: c.obligations.map((o, i) => (i === 0 ? { ...o, status: "unavailable", reason: "observer down" } : o)) };
    expect(validateInvestigationContract(bad).errors.join()).toMatch(/inconsistent/);
  });
});

describe("LP08-A4 scope or evidence changes invalidate affected obligations without overwriting decisions", () => {
  it("changing the interval resets interval-bound obligations only; earlier revisions are byte-identical and append-only", async () => {
    const w = await world();
    const { app, h, analyst, viewer } = w.ctx;
    let c = (await app.inject({ method: "POST", url: `${w.base}/contract`, headers: h(analyst) })).json().contract as InvestigationContract;
    const o = c.obligations.find((x) => x.id === `bundle:${w.finding.id}`)!;
    c = w.contracts.applyResults(w.project, w.caseId, [retrieve(w, "api", c.revision), coverage(w, "api", "authentication", c.revision),
      { obligation_id: o.id, status: "satisfied", evidence_refs: w.finding.event_ids, query_refs: ["test:bundle"], reason: "intact", scope: { project_id: w.project, contract_revision: c.revision, finding_id: w.finding.id, finding_revision: o.target.finding_revision, bundle_id: o.target.bundle_id } }], "test", "test").view.contract;
    const decidedRev = c.revision;
    const before = (await app.inject({ method: "GET", url: `${w.base}/contract/revisions/${decidedRev}`, headers: h(viewer) })).body;
    const kase = (await app.inject({ method: "GET", url: w.base, headers: h(viewer) })).json();
    const upd = await app.inject({ method: "POST", url: w.base, headers: h(analyst), payload: { expected_version: kase.version, scope: { ...kase.scope, after: at(-600) } } });
    expect(upd.statusCode).toBe(200);
    const view = (await app.inject({ method: "GET", url: `${w.base}/contract`, headers: h(viewer) })).json();
    expect(view.stale).toBe(false); // the case change already recorded a new revision
    c = view.contract;
    expect(c.revision).toBe(decidedRev + 1);
    expect(status(c, "activity:api")).toBe("not_started");
    expect(status(c, "coverage:api:authentication")).toBe("not_started");
    expect(status(c, o.id)).toBe("satisfied"); // finding-bound evidence is not interval-bound
    expect(c.obligations.find((x) => x.id === "activity:api")!.reason).toMatch(new RegExp(`invalidated \\(scope_changed\\).*kept at revision ${decidedRev}`));
    expect((await app.inject({ method: "GET", url: `${w.base}/contract/revisions/${decidedRev}`, headers: h(viewer) })).body).toBe(before);
    const ledger = (await app.inject({ method: "GET", url: `${w.base}/contract/ledger?obligation=activity:api`, headers: h(viewer) })).json().transitions;
    expect(ledger.map((t: { to_status: string }) => t.to_status)).toEqual(["not_started", "satisfied", "not_started"]);
    expect(ledger.at(-1).reason).toMatch(new RegExp(`previous decision kept at revision ${decidedRev}`));
    // a result planned under the earlier revision (old interval) can no longer satisfy the re-scoped obligation
    const late = w.contracts.applyResults(w.project, w.caseId, [retrieve(w, "api", decidedRev)], "test", "test");
    expect(late.applied).toBe(0);
    expect(late.refused[0]!.reason).toMatch(/scope for activity:api differs|obligation requires exactly/);
    expect(() => w.ctx.db.prepare("UPDATE investigation_contract_revisions SET body = '{}' WHERE revision = 1").run()).toThrow(/append-only/);
    expect(() => w.ctx.db.prepare("DELETE FROM investigation_transitions").run()).toThrow(/append-only/);
  });

  it("new evidence after a retrieval snapshot invalidates the retrieval in the effective view before anyone writes", async () => {
    const w = await world();
    const { app, h, analyst, viewer } = w.ctx;
    let c = (await app.inject({ method: "POST", url: `${w.base}/contract`, headers: h(analyst) })).json().contract as InvestigationContract;
    c = w.contracts.applyResults(w.project, w.caseId, [retrieve(w, "db", c.revision)], "test", "test").view.contract;
    const rev = c.revision;
    expect(status(c, "activity:db")).toBe("satisfied");
    w.send("dbaudit", 5000, { action: "data_access", outcome: "success", actor_ref: "late-arrival" });
    w.drain();
    const view = (await app.inject({ method: "GET", url: `${w.base}/contract`, headers: h(viewer) })).json();
    expect(view.stale).toBe(true);
    expect(view.stored_revision).toBe(rev);
    expect(view.pending_invalidations).toEqual([expect.objectContaining({ obligation_id: "activity:db", from_status: "satisfied", cause: "evidence_changed", reason: expect.stringMatching(/1 matching record\(s\) on db arrived after the retrieval snapshot/) })]);
    expect(status(view.contract, "activity:db")).toBe("not_started");
    // a viewer read wrote nothing
    expect(w.contracts.revisions(w.project, w.caseId).length).toBe(rev);
    const ref = await app.inject({ method: "POST", url: `${w.base}/contract`, headers: h(analyst), payload: { expected_revision: rev } });
    expect(ref.statusCode).toBe(200);
    expect(ref.json().stored_revision).toBe(rev + 1);
    expect(status(w.contracts.revision(w.project, w.caseId, rev), "activity:db")).toBe("satisfied");
  });

  it("adding an asset adds obligations; removing one withdraws its obligations with ledger entries", async () => {
    const w = await world({ assets: ["api"] });
    const { app, h, analyst, viewer } = w.ctx;
    const c = (await app.inject({ method: "POST", url: `${w.base}/contract`, headers: h(analyst) })).json().contract as InvestigationContract;
    expect(ids(c)).not.toContain("activity:db");
    let kase = (await app.inject({ method: "GET", url: w.base, headers: h(viewer) })).json();
    kase = (await app.inject({ method: "POST", url: w.base, headers: h(analyst), payload: { expected_version: kase.version, scope: { ...kase.scope, asset_ids: ["api", "db"] } } })).json();
    let v = (await app.inject({ method: "GET", url: `${w.base}/contract`, headers: h(viewer) })).json();
    expect(ids(v.contract)).toEqual(expect.arrayContaining(["activity:db", "coverage:db:data_access"]));
    await app.inject({ method: "POST", url: w.base, headers: h(analyst), payload: { expected_version: kase.version, scope: { ...kase.scope, asset_ids: ["db"] } } });
    v = (await app.inject({ method: "GET", url: `${w.base}/contract`, headers: h(viewer) })).json();
    expect(ids(v.contract)).not.toContain("activity:api");
    const ledger = (await app.inject({ method: "GET", url: `${w.base}/contract/ledger?obligation=activity:api`, headers: h(viewer) })).json().transitions;
    expect(ledger.at(-1)).toMatchObject({ to_status: "withdrawn", cause: "withdrawn" });
  });
});
