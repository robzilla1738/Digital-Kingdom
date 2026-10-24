/**
 * li-next D follow-up: the `rehearsal` selector. It shortlists the top-k (k ≤ 3) predicted-safe visible options,
 * rehearses each in its OWN fresh disposable leased world (separate supervisor, lease, typed op, journal), reads only
 * the independent verifier's observed effects on the case's probes, discards options whose prediction is contradicted,
 * treats unknown as unknown (never as blocked), and abstains when nothing is confirmed. Rehearsal worlds are torn down
 * and their leases and tokens revoked.
 */
import { describe, expect, it } from "vitest";
import { ABSTAIN, classifyRehearsal, rehearsalSelector, type RehearsalResult, type SelectorView, type VisibleOption } from "../local/repair-bench/selectors.ts";
import { BENCH_CASES, prepareSelection, rehearseOption } from "../local/repair-bench/bench.ts";

const good = [
  { probe: "x", role: "prohibited" as const, before: "holds" as const, after: "does_not_hold" as const },
  { probe: "y", role: "permitted" as const, before: "holds" as const, after: "holds" as const },
];
const opt = (id: string, rank: number, impact = good): VisibleOption => ({
  option_id: id, rank, template: `t-${id}`, target: "api", explanation: "", actions: [], plan: {} as never, prerequisites: [], expected_impact: impact,
  predicted: { valid: true, blocked: 1, of: 1, still_possible: [], unknown: [], permitted_broken: [], unknowns: [], basis: "model_only" },
});
const view = (options: VisibleOption[]): SelectorView => ({ schema: "dk.bench.selector_view.v1", case: { case_ref: "c", question: "q", objective: { prohibited: [], permitted: [] } }, evidence: { analysis_state_hash: "h", observers: [], policies: [], generator_status: "candidates", observation_prerequisites: [] }, options, abstain_choice: ABSTAIN });
const result = (x: RehearsalResult["probes"][number]["observed"], y: RehearsalResult["probes"][number]["observed"], run = "run-1"): RehearsalResult => ({
  run_id: run, lease: `lease-${run}`, execution_state: "completed", wall_ms: 5,
  probes: [{ probe: "x", role: "prohibited", observed: x, detail: x }, { probe: "y", role: "permitted", observed: y, detail: y }],
  teardown: { run_state: "cleaned", lease_state: "revoked", tokens_revoked: true, journal_entries: 2 },
});

describe("rehearsal selector (unit, scripted rehearsal results)", () => {
  it("discards a rank-1 option whose prediction is contradicted in rehearsal and selects the confirmed one", async () => {
    const calls: string[] = [];
    const s = await rehearsalSelector.select(view([opt("o1", 1), opt("o2", 2)]), { rehearse: async (id) => { calls.push(id); return id === "o1" ? result("holds", "holds", "r1") : result("does_not_hold", "holds", "r2"); } });
    expect(s.choice).toBe("o2");
    expect(calls).toEqual(["o1", "o2"]);
    expect(s.rehearsal).toMatchObject({ k: 3, shortlisted: ["o1", "o2"], worlds_started: 2 });
    expect(s.rehearsal!.verdicts.map((v) => v.verdict)).toEqual(["contradicted", "confirmed"]);
    expect(s.rehearsal!.verdicts[0]!.contradicted[0]).toMatch(/x: predicted does_not_hold, rehearsal observed holds/);
  });
  it("rehearses at most k = 3 predicted-safe options, each with its own call", async () => {
    let n = 0;
    const s = await rehearsalSelector.select(view([1, 2, 3, 4, 5].map((i) => opt(`o${i}`, i))), { rehearse: async () => { n++; return result("holds", "holds", `r${n}`); } });
    expect(n).toBe(3);
    expect(s.choice).toBe(ABSTAIN);
    expect(s.rehearsal!.worlds_started).toBe(3);
  });
  it("UNKNOWN is not blocked: a stopped observer (unknown effects) leaves nothing confirmed, so it abstains", async () => {
    const s = await rehearsalSelector.select(view([opt("o1", 1), opt("o2", 2)]), { rehearse: async (id) => result("unknown", "unknown", id) });
    expect(s.choice).toBe(ABSTAIN);
    expect(s.rehearsal!.verdicts.every((v) => v.verdict === "unknown")).toBe(true);
    expect(classifyRehearsal(opt("o1", 1), result("unknown", "holds")).verdict).toBe("unknown");
    expect(classifyRehearsal(opt("o1", 1), result("does_not_hold", "holds")).verdict).toBe("confirmed");
    expect(classifyRehearsal(opt("o1", 1), { ...result("does_not_hold", "holds"), execution_state: "refused" }).verdict).toBe("unknown");
  });
  it("abstains without rehearsing when nothing is predicted safe, and abstains without a rehearsal capability", async () => {
    const unsafe = { ...opt("o1", 1), predicted: { ...opt("o1", 1).predicted, permitted_broken: ["y"] } };
    let n = 0;
    expect((await rehearsalSelector.select(view([unsafe]), { rehearse: async () => { n++; return result("does_not_hold", "holds"); } })).choice).toBe(ABSTAIN);
    expect(n).toBe(0);
    expect((await rehearsalSelector.select(view([opt("o1", 1)]))).choice).toBe(ABSTAIN);
  });
});

describe("rehearsal worlds (disposable leased LW-01 worlds, 127.0.0.1)", () => {
  const mis = BENCH_CASES.find((c) => c.id === "misleading-prediction")!;
  it("each rehearsal is its own world, lease and journal; torn down, lease revoked, tokens revoked; the misleading option is contradicted", async () => {
    const p = await prepareSelection(mis);
    const misKey = p.options.find((o) => o.class === "misleading")!.key;
    const goodKey = p.options.find((o) => o.class === "correct")!.key;
    await p.c.stop();
    const a = await rehearseOption(mis, misKey);
    const b = await rehearseOption(mis, goodKey);
    expect(a.run_id).not.toBe(b.run_id);
    expect(a.lease).not.toBe(b.lease);
    for (const r of [a, b]) {
      expect(r.execution_state).toBe("completed");
      expect(r.teardown).toMatchObject({ lease_state: "revoked", tokens_revoked: true });
      expect(["cleaned", "stopped"]).toContain(r.teardown.run_state);
      expect(r.teardown.journal_entries).toBeGreaterThan(0);
      expect(r.wall_ms).toBeGreaterThan(0);
      // operator-observable only: no class, key, truth or verdict fields leak into the rehearsal result
      expect(Object.keys(r).sort()).toEqual(["execution_state", "lease", "probes", "run_id", "teardown", "wall_ms"]);
    }
    const obs = (r: RehearsalResult, id: string) => r.probes.find((x) => x.probe === id)!.observed;
    expect(obs(a, "a-reads-b")).toBe("holds");
    expect(obs(a, "b-reads-a")).toBe("holds");
    expect(obs(b, "a-reads-b")).toBe("does_not_hold");
    expect(obs(b, "a-reads-own")).toBe("holds");
  }, 120_000);
  it("observer gap during rehearsal: with the audit observer stopped, cross-tenant effects are unknown, never does_not_hold", async () => {
    const p = await prepareSelection(mis);
    const goodKey = p.options.find((o) => o.class === "correct")!.key;
    await p.c.stop();
    const r = await rehearseOption(mis, goodKey, { stopObserver: "audit" });
    for (const x of r.probes) expect(x.observed).toBe("unknown");
    expect(r.teardown).toMatchObject({ lease_state: "revoked", tokens_revoked: true });
  }, 120_000);
});
