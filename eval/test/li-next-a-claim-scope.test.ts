import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startLocalCase, type Family, type LocalCase } from "../local/controller.ts";
import { answerKey, type AnswerKey } from "../local/referee.ts";

/**
 * li-next item A — claim-local uncertainty and affirmative evidence.
 *
 * Deterministic regression fixtures for the four guided-contract (C3) documents that failed in the fresh held-out
 * evaluation li-m7-7f4a12cd (artifacts/local-intelligence/m7-fresh-eval, slots 001, 021, 026, 031; 10 underclaims, all
 * "unknown" after unavailable-coverage information). The documents themselves were revealed at seal
 * (heldout-documents-revealed-at-seal.json), so these worlds are exact replays of the failing scenarios.
 *
 * Failure shapes reproduced (no model call anywhere; the "investigator" below is a scripted, guidance-literal stand-in):
 *  S1 time scope   (001, 021, 031): an independent observer stopped for ~20-30 ms. The packet said absence of
 *                  data_access on the effect resource "cannot be made" for the WHOLE interval, so requests that ran
 *                  while the observer was live (not_observed admissible) were answered unknown.
 *  S2 positive obs (026, 031): a recorded denial (api request_received, outcome denied, rule_ref) is a positive
 *                  observation; nothing about an unrelated coverage gap bears on it.
 *  Counterexamples: absence claims overlapping the gap stay refused (legitimate unknown); a gap on one resource does not
 *                  taint a sibling resource; a resource with no configured observer stays unassessable everywhere.
 *
 * The referee (private truth) is used here only to GRADE; the investigator never reads it.
 */
const ROOT = join(import.meta.dirname, "../..");
const SEALED = JSON.parse(readFileSync(join(ROOT, "artifacts/local-intelligence/m7-fresh-eval/heldout-documents-revealed-at-seal.json"), "utf8")).documents as { id: string; blueprint: Family; seed: string; steps: Record<string, unknown>[] }[];
const doc = (id: string) => SEALED.find((d) => d.id === id)!;
const FAILED = { "001": "lh-247dd4848d", "021": "lh-17757478f2", "026": "lh-b4ff82e8bf", "031": "lh-3f97f7cb12" } as const;

const EFFECT_ASSET: Partial<Record<Family, string>> = { "saas-storefront": "tenant-db", "delivery-identity": "deploy-data" };
type Rec = { ref: string; occurred_at: string; action: string; outcome: string; asset_ids: string[]; source_id: string; untrusted: Record<string, string> };
type Neg = { id: string; assessable: boolean; reason: string; assessable_within?: { from: string; to: string }[]; not_assessable_within?: { from: string; to: string }[] };
interface World { c: LocalCase; key: AnswerKey; contract: any; packet: any; events: Record<string, any>[]; effectAsset: string } // eslint-disable-line @typescript-eslint/no-explicit-any

async function open(id: string): Promise<World> {
  const d = doc(id);
  const c = await startLocalCase(d as never);
  const key = answerKey(d.blueprint, d as never, c.private.truth, c.private.world.world);
  const p = `/api/projects/${c.public.project}/cases/${c.public.case_id}`;
  const contract = (await c.adminApi("GET", `${p}/contract`)).json.contract;
  const pk = await c.adminApi("GET", `${p}/packet?max_bytes=400000`);
  expect(pk.status, JSON.stringify(pk.json)).toBe(200);
  const events = await c.storedEvents();
  const effectAsset = EFFECT_ASSET[d.blueprint]!; // the resource whose reads the task asks about (fixture knowledge, public in the task)
  return { c, key, contract, packet: pk.json, events, effectAsset };
}

/** When a request was first recorded (any source), from the delivered packet records. */
const opTime = (w: World, op: string) => Math.min(...(w.packet.records as Rec[]).filter((r) => r.untrusted.request_id === op).map((r) => Date.parse(r.occurred_at)));

/**
 * Guidance-literal investigator: reads ONLY what C3 delivers (packet records + uncertainty) and follows the server's
 * stated scoping to the letter. independent_effect = observed if an independent observer's data_access record for the
 * request was delivered; else not_observed when the packet says absence is assessable at the request's time; else unknown.
 */
function literalEffect(w: World, op: string): "observed" | "not_observed" | "unknown" {
  const recs = w.packet.records as Rec[];
  if (recs.some((r) => r.untrusted.request_id === op && r.action === "data_access" && r.untrusted["attributes.observer"])) return "observed";
  const neg = (w.packet.uncertainty.negative_claims as Neg[]).find((n) => n.id === `negative:${w.effectAsset}:data_access`);
  if (!neg) return "unknown";
  if (neg.assessable) return "not_observed";
  const t = opTime(w, op);
  return (neg.assessable_within ?? []).some((s) => Date.parse(s.from) <= t && t <= Date.parse(s.to)) ? "not_observed" : "unknown";
}

const P = (w: World) => `/api/projects/${w.c.public.project}/cases/${w.c.public.case_id}`;
const covRef = (w: World, asset: string, action: string) => (w.contract.obligations as { id: string; query_refs: string[] }[]).find((o) => o.id === `coverage:${asset}:${action}`)!.query_refs.find((q) => q.startsWith("cov:"))!;
const conclusion = (w: World, claims: unknown[]) => ({ schema: "dk.local.conclusion.v1", case_id: w.contract.case_id, run_id: w.contract.run_id, contract_revision: w.contract.revision, claims, status: "draft", semantic_review: "not_reviewed", scope_note: "li-next-a regression", requested_next_step: "retrieve_more" });
const absence = (w: World, asset: string, action: string, after?: number, before?: number) => ({
  id: `abs-${asset}-${action}`, type: "not_observed_in_scope", text: `No ${action} on ${asset} is recorded in the stated window.`, evidence_refs: [], coverage_refs: [covRef(w, asset, action)],
  obligation_ids: [`activity:${asset}`, `coverage:${asset}:${action}`], uncertainty: "absence in stored records within the stated window only",
  predicate: { kind: "action_not_observed", asset_id: asset, action, ...(after !== undefined ? { after: new Date(after).toISOString(), before: new Date(before!).toISOString() } : {}) },
});
async function check(w: World, claims: unknown[]) {
  const r = await w.c.adminApi("POST", `${P(w)}/conclusions/check`, conclusion(w, claims));
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json;
}

const worlds = new Map<string, World>();
beforeAll(async () => { for (const id of Object.values(FAILED)) worlds.set(id, await open(id)); }, 240_000);
afterAll(async () => { for (const w of worlds.values()) await w.c.stop(); });

describe("li-next-A S1: a coverage gap on one interval does not taint a different, covered interval", () => {
  for (const [slot, id] of Object.entries(FAILED)) {
    it(`${slot} (${id}): the guidance-literal investigator answers independent_effect exactly as admissible (no underclaim, no overclaim)`, () => {
      const w = worlds.get(id)!;
      const wrong = w.key.ops.map((o) => ({ op: o.op_id, answered: literalEffect(w, o.op_id), admissible: o.admissible.independent_effect })).filter((x) => !x.admissible.includes(x.answered));
      expect(wrong, JSON.stringify(w.packet.uncertainty.negative_claims.filter((n: Neg) => n.id.startsWith(`negative:${w.effectAsset}`)))).toEqual([]);
      // legitimate unknown stays: every op the referee admits only unknown for is still answered unknown
      for (const o of w.key.ops.filter((x) => x.admissible.independent_effect.join() === "unknown")) expect(literalEffect(w, o.op_id)).toBe("unknown");
    });
  }

  it("the packet scopes the effect resource's absence claims to covered sub-intervals and names the uncovered spans", () => {
    for (const id of [FAILED["001"], FAILED["021"], FAILED["031"]]) {
      const w = worlds.get(id)!;
      const neg = (w.packet.uncertainty.negative_claims as Neg[]).find((n) => n.id === `negative:${w.effectAsset}:data_access`)!;
      const gap = (w.packet.uncertainty.coverage_gaps as { asset_id: string; action: string; uncovered_spans: { from: string; to: string }[] }[]).find((g) => g.asset_id === w.effectAsset && g.action === "data_access")!;
      expect(neg.assessable).toBe(false); // the WHOLE interval is still not assessable
      expect(neg.not_assessable_within).toEqual(gap.uncovered_spans.map((s) => ({ from: s.from, to: s.to })));
      expect(neg.assessable_within!.length).toBeGreaterThan(0);
      for (const s of neg.assessable_within!) for (const g of gap.uncovered_spans) expect(Date.parse(s.to) < Date.parse(g.from) || Date.parse(s.from) > Date.parse(g.to)).toBe(true);
      expect(neg.reason).toMatch(/whole interval/);
      expect(neg.reason).not.toMatch(/0 minute\(s\)/);
    }
  });

  it("the claim checker agrees with the referee per request: absence inside a covered window is assessable, overlapping the gap is refused", async () => {
    for (const id of [FAILED["001"], FAILED["021"], FAILED["031"]]) {
      const w = worlds.get(id)!;
      for (const o of w.key.ops) {
        if (o.admissible.independent_effect.includes("observed")) continue;
        const t = opTime(w, o.op_id);
        const r = await check(w, [absence(w, w.effectAsset, "data_access", t, t + 1)]);
        const accepted = r.claims[0].support_level !== "failed";
        expect({ op: o.op_id, accepted, problems: r.claims[0].problems }).toMatchObject({ op: o.op_id, accepted: o.admissible.independent_effect.includes("not_observed") });
      }
    }
  }, 60_000);
});

describe("li-next-A S2: recorded positive observations stay valid whatever the coverage gaps", () => {
  it("an observed claim on the gap resource and on a recorded denial is predicate-checked and no unmet obligation bears on it", async () => {
    for (const id of [FAILED["026"], FAILED["031"]]) {
      const w = worlds.get(id)!;
      const recs = w.packet.records as Rec[];
      const audit = recs.find((r) => r.action === "data_access" && r.untrusted["attributes.observer"])!;
      const denial = recs.find((r) => r.action === "request_received" && r.outcome === "denied" && r.untrusted.rule_ref)!;
      const observed = (rid: string, r: Rec) => ({ id: rid, type: "observed", text: `A ${r.action} record (${r.outcome}) is stored on ${r.asset_ids[0]}.`, evidence_refs: [r.ref], coverage_refs: [], obligation_ids: [`activity:${r.asset_ids[0]}`], uncertainty: "what the cited record states, nothing more",
        predicate: { kind: "action_observed", asset_id: r.asset_ids[0], action: r.action, outcome: r.outcome } });
      const res = await check(w, [observed("audit", audit), observed("denial", denial)]);
      for (const cl of res.claims) {
        expect(cl.support_level, JSON.stringify(cl.problems)).toBe("predicate_checked");
        expect(cl.uncertainty_scope).toMatchObject({ bearing_unmet_obligations: [] });
      }
      // the contract is still honestly unresolved overall: the gap is not hidden
      expect(w.contract.readiness).toBe("unresolved_answer_ready");
      expect(w.packet.uncertainty.claim_scoping).toMatch(/positive observation/i);
      expect(w.packet.uncertainty.readiness_reason ?? w.contract.readiness_reason).not.toMatch(/Only an unresolved answer for those parts is honest\.$/);
    }
  }, 60_000);

  it("a not_observed claim contradicted by a recorded observation is refused even in a covered window", async () => {
    const w = worlds.get(FAILED["031"])!;
    const audit = (w.packet.records as Rec[]).find((r) => r.action === "data_access" && r.untrusted["attributes.observer"])!;
    const t = Date.parse(audit.occurred_at);
    const r = await check(w, [absence(w, w.effectAsset, "data_access", t, t + 1)]);
    expect(r.claims[0].support_level).toBe("failed");
    expect(r.claims[0].predicate.contradicting_refs).toContain(audit.ref);
  });
});

describe("li-next-A counterexamples: sibling resources and time scope, both ways", () => {
  it("a gap on the effect resource does not taint a covered sibling resource in the same window; the gap resource stays refused there", async () => {
    const w = worlds.get(FAILED["031"])!;
    const neg = (w.packet.uncertainty.negative_claims as Neg[]).find((n) => n.id === `negative:${w.effectAsset}:data_access`)!;
    const g = neg.not_assessable_within![0]!;
    const a = Date.parse(g.from), b = Date.parse(g.to);
    const sibling = await check(w, [{ ...absence(w, "api", "authentication", a, b), id: "sib" }]);
    expect(sibling.claims[0].support_level, JSON.stringify(sibling.claims[0].problems)).not.toBe("failed");
    const gapped = await check(w, [absence(w, w.effectAsset, "data_access", a, b)]);
    expect(gapped.claims[0].support_level).toBe("failed");
    expect(gapped.claims[0].problems.join()).toMatch(/not assessable/);
  });

  it("a window straddling the gap edge, and the whole interval, stay refused (legitimate unknown)", async () => {
    const w = worlds.get(FAILED["031"])!;
    const neg = (w.packet.uncertainty.negative_claims as Neg[]).find((n) => n.id === `negative:${w.effectAsset}:data_access`)!;
    const g = neg.not_assessable_within![0]!;
    const straddle = await check(w, [absence(w, w.effectAsset, "data_access", Date.parse(g.from) - 5, Date.parse(g.from) + 1)]);
    expect(straddle.claims[0].support_level).toBe("failed");
    const whole = await check(w, [absence(w, w.effectAsset, "data_access")]);
    expect(whole.claims[0].support_level).toBe("failed");
  });

  it("a sibling resource with no configured observer stays unassessable in every window, including ones where the effect resource is covered", async () => {
    const w = worlds.get(FAILED["031"])!;
    const queue = (w.packet.uncertainty.negative_claims as Neg[]).find((n) => n.id === "negative:queue:data_access")!;
    expect(queue.assessable).toBe(false);
    expect(queue.assessable_within ?? []).toEqual([]);
    const neg = (w.packet.uncertainty.negative_claims as Neg[]).find((n) => n.id === `negative:${w.effectAsset}:data_access`)!;
    const s = neg.assessable_within![0]!;
    const t = Date.parse(s.from);
    const r = await check(w, [absence(w, "queue", "data_access", t, t + 1)]);
    expect(r.claims[0].support_level).toBe("failed");
    expect(r.claims[0].problems.join()).toMatch(/not assessable/);
  });
});
