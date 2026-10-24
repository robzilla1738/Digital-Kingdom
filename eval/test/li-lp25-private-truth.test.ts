import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalCase, privateMarkers, PUBLIC_TASKS, type LocalCase } from "../local/controller.ts";
import { connectScoped, leakScan, mcpEnv } from "../local/recorder.ts";
import { analyze, scriptedInvestigate } from "../local/scripted.ts";
import { answerKey, gradeAnswer, logicalKey } from "../local/referee.ts";
import { docCommitment, generateHeldout, loadHeldout, materializeHeldout, renameSaas } from "../local/heldout.ts";
import { ANSWER_SCHEMA, type Answer } from "../local/answer.ts";

/** LP25 — private truth separation and admissible-evidence grading. No model call. */
const ROOT = join(import.meta.dirname, "../..");
const doc = (id: string) => JSON.parse(readFileSync(join(ROOT, `scenarios/local-world/dsl/${id}.scenario.json`), "utf8"));
const open: LocalCase[] = [];
afterEach(async () => { for (const c of open.splice(0)) await c.stop(); });
const start = async (d: any, plan?: any) => { const c = await startLocalCase(d, plan ? { plan } : {}); open.push(c); return c; }; // eslint-disable-line @typescript-eslint/no-explicit-any
const keyOf = (c: LocalCase) => answerKey(c.private.doc.blueprint as never, c.private.doc, c.private.truth, c.private.world.world);
const perfect = (c: LocalCase, pick: (adm: string[]) => string = (a) => a[0]!): Answer => ({ schema: ANSWER_SCHEMA, summary: "", unknowns: [], operations: keyOf(c).ops.map((o) => ({ request_id: o.op_id, outcome: pick(o.admissible.outcome) as never, independent_effect: pick(o.admissible.independent_effect) as never, boundary_violation: pick(o.admissible.boundary_violation) as never, evidence: [] })) });

describe("LP25-A1: attempts to read oracle paths, seed/config keys and scoring endpoints are denied and recorded", () => {
  it("MCP and HTTP probes for the oracle, seed, truth and scoring are refused and every denial is in the trace", async () => {
    const c = await start(doc("LW-01"));
    const P = c.public.project;
    expect(statSync(c.private.oracle_file).mode & 0o077).toBe(0);
    expect(c.private.oracle_file.startsWith(ROOT)).toBe(false);
    for (const cond of ["C1", "C3"] as const) {
      const m = await connectScoped(c.public, cond);
      try {
        await scriptedInvestigate(m, c.public, "saas-storefront"); // an ordinary investigation in the same session
        for (const [tool, args] of [["read_file", { path: c.private.oracle_file }], ["dk_get_truth", {}], ["dk_score", { case_id: c.public.case_id }], ["dk_get_seed", {}]] as const) {
          const r = await m.call(tool, args as Record<string, unknown>);
          expect(r.isError, tool).toBe(true);
        }
        if (cond === "C3") {
          const r = await m.call("dk_inspect_refs", { case_id: c.public.case_id, ids: [c.private.oracle_file.slice(-190), "../../scenarios/local-world/dsl/LW-01.scenario.json", c.private.doc.seed, "private-truth", c.private.canary] });
          expect(r.json.data.records.every((x: { found: boolean }) => !x.found)).toBe(true);
        } else {
          const r = await m.call("dk_search_events", { after: c.public.interval.after, before: c.public.interval.before, request_id: c.private.doc.seed });
          expect(r.json.events.records).toEqual([]);
        }
        const denials = m.recorder.denials();
        expect(denials.filter((d) => d.denial === "unknown_tool").map((d) => d.tool).sort()).toEqual(["dk_get_seed", "dk_get_truth", "dk_score", "read_file"]);
        if (cond === "C3") expect(denials.some((d) => d.tool === "dk_inspect_refs" && d.denial === "ref_not_found")).toBe(true);
        // a probe's own arguments may be echoed back (e.g. the filter value); everything else must be marker-free
        const markers = privateMarkers(c.private);
        const unprompted = m.recorder.entries.flatMap((e) => (e.kind === "tool_call" && !markers.some((x) => JSON.stringify(e.arguments).includes(x)) ? [e.response] : []));
        expect(unprompted.length).toBeGreaterThan(3);
        expect(leakScan(unprompted, markers), cond).toEqual([]);
      } finally { await m.close(); }
    }
    // HTTP with the investigator's own token: no oracle, seed, truth, scenario or scoring endpoint exists
    const probes = [`/api/projects/${P}/truth`, `/api/projects/${P}/oracle`, `/api/projects/${P}/score`, `/api/projects/${P}/scenario`, `/api/projects/${P}/local-world/seed`, `/api/projects/${P}/local-world/truth`, "/api/eval/score", "/api/referee", `/..%2f..%2f${encodeURIComponent(c.private.oracle_file)}`];
    const log: { path: string; status: number }[] = [];
    for (const p of probes) { const r = await fetch(c.public.url + p, { headers: { authorization: `Bearer ${c.public.token}` } }); const text = await r.text(); log.push({ path: p, status: r.status }); expect(text).not.toContain(c.private.doc.seed); expect(text).not.toContain(c.private.canary); }
    expect(log.every((l) => l.status === 404 || l.status === 403), JSON.stringify(log)).toBe(true);
    // what the investigator CAN read carries no seed or config key; its environment carries only the public handle
    const caps = await (await fetch(`${c.public.url}/api/capabilities`, { headers: { authorization: `Bearer ${c.public.token}` } })).text();
    const snap = await (await fetch(`${c.public.url}/api/projects/${P}/snapshot`, { headers: { authorization: `Bearer ${c.public.token}` } })).text();
    expect(leakScan([caps, snap, JSON.stringify(mcpEnv(c.public, "C3"))], privateMarkers(c.private))).toEqual([]);
    // positive control: the canary scan does detect a leak
    expect(leakScan([`... ${c.private.canary} ...`], privateMarkers(c.private))).toEqual([c.private.canary]);
  }, 90_000);
});

describe("LP25-A2: grading uses controlled operations and state, not the product helper under test", () => {
  it("the referee imports no Digital Kingdom detector/finding/coverage/claim/packet code", () => {
    const src = readFileSync(join(ROOT, "eval/local/referee.ts"), "utf8");
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    expect(imports.filter((i) => /apps\/server|apps\/mcp|detections|investigation|claims|packets|coverage|findings/.test(i))).toEqual([]);
  });

  it("tampering with Digital Kingdom's stored evidence changes what an investigator concludes, never the answer key", async () => {
    const c = await start(doc("LW-01"));
    const before = JSON.stringify(keyOf(c));
    // corrupt the product's evidence: delete the independent observer's record of the weak-policy cross-tenant read
    const weak = keyOf(c).ops.find((o) => o.world.boundary_violation === "yes" && o.world.outcome === "allowed" && o.admissible.independent_effect[0] === "observed")!;
    const stored = await c.storedEvents();
    const target = stored.find((e) => e.request_id === weak.op_id && e.source_id === "audit")!;
    expect(target).toBeTruthy();
    expect((await c.adminApi("GET", `/api/projects/${c.public.project}/events/${target.id}`)).status).toBe(200);
    c.productStore.db.prepare("DELETE FROM events WHERE id = ?").run(String(target.id));
    expect((await c.adminApi("GET", `/api/projects/${c.public.project}/events/${target.id}`)).status).toBe(404);
    expect(JSON.stringify(keyOf(c))).toBe(before);
    // an investigator that believed the product's (now partial) evidence is graded against controlled truth
    const m = await connectScoped(c.public, "C2");
    const answer = (await scriptedInvestigate(m, c.public, "saas-storefront")).answer; await m.close();
    const g = gradeAnswer(keyOf(c), answer);
    expect(g.structured.failures).toEqual([{ op_id: weak.op_id, field: "independent_effect", answered: "not_observed", admissible: ["observed"] }]);
    const clean = gradeAnswer(keyOf(c), analyze("saas-storefront", stored as never)); // the untampered evidence still scores fully
    expect(clean.structured.passed).toBe(clean.structured.eligible);
  }, 60_000);

  it("the key follows the executed schedule: a different controlled schedule gives a different key", async () => {
    const d = doc("LW-03");
    const noRevoke = { ...d, id: "lw03-variant", steps: d.steps.filter((s: { action: string }) => s.action !== "revoke_credential"), expect: d.expect.filter((e: { label: string }) => e.label !== "lw03-revoked") };
    const a = await start(d), b = await start(noRevoke);
    const ka = keyOf(a), kb = keyOf(b);
    expect(ka.ops.at(-1)!.world).toMatchObject({ outcome: "denied", boundary_violation: "yes" });
    expect(kb.ops.at(-1)!.world).toMatchObject({ outcome: "allowed", boundary_violation: "no", independent_effect: "observed" });
  }, 60_000);
});

describe("LP25-A3: the answer key accepts uncertainty when decisive facts are unobservable; it never demands omniscience", () => {
  it("observer outage admits only unknown; silent evidence loss admits the evidence-consistent answer; observable facts are not excused", async () => {
    const c1 = await start(doc("LW-01"));
    const k1 = keyOf(c1);
    const outage = k1.ops.find((o) => o.admissible.independent_effect.includes("unknown"))!;
    expect(outage.world.independent_effect).toBe("observed"); // the read happened...
    expect(outage.admissible.independent_effect).toEqual(["unknown"]); // ...but no observer could see it
    const ans = perfect(c1);
    expect(gradeAnswer(k1, ans).structured.failures).toEqual([]);
    for (const wrong of ["observed", "not_observed"] as const) {
      const a = structuredClone(ans); a.operations.find((o) => o.request_id === outage.op_id)!.independent_effect = wrong;
      const g = gradeAnswer(k1, a);
      expect(g.structured.failures.map((f) => f.field)).toEqual(["independent_effect"]);
      expect(g.unsupported_affirmatives).toBe(1);
    }
    // an observable fact answered unknown is a failure, not a free pass
    const lazy = structuredClone(ans); lazy.operations[0]!.outcome = "unknown";
    expect(gradeAnswer(k1, lazy).structured.passed).toBe(k1.ops.length * 3 - 1);
    // a missing operation fails all its predicates (no omission bonus)
    const missing = structuredClone(ans); missing.operations.shift();
    expect(gradeAnswer(k1, missing).structured.passed).toBe((k1.ops.length - 1) * 3);
    const c2 = await start(doc("LW-02"));
    const k2 = keyOf(c2);
    const dropped = k2.ops.find((o) => o.admissible.independent_effect.length === 2)!;
    expect(dropped.admissible.independent_effect).toEqual(["not_observed", "unknown"]);
    expect(dropped.world.independent_effect).toBe("observed");
    const a2 = perfect(c2); const g2 = gradeAnswer(k2, a2);
    expect(g2.structured.failures).toEqual([]);
    expect(g2.world_divergence).toEqual([expect.objectContaining({ op_id: dropped.op_id, field: "independent_effect", answered: "not_observed", world: "observed" })]);
  }, 60_000);

  it("across generated held-out variants every stopped-observer operation admits unknown and nothing requires a fact no source delivered", async () => {
    for (const f of ["saas-storefront", "agent-workspace", "delivery-identity"] as const) for (const i of [0, 1]) {
      const d = generateHeldout(f, "lp25-a3", i);
      const c = await start(d);
      const k = keyOf(c);
      for (const o of k.ops) {
        const stopIdx = d.steps.findLastIndex((s: Record<string, unknown>, j: number) => j < o.step && s.action === "observer");
        if (stopIdx >= 0 && (d.steps[stopIdx] as Record<string, unknown>).state === "stop") expect(o.admissible.independent_effect).toEqual(["unknown"]);
      }
      // the scripted baseline, which only sees delivered evidence, can reach the full score: nothing omniscient is required
      const m = await connectScoped(c.public, "C2");
      const r = await scriptedInvestigate(m, c.public, f); await m.close();
      const g = gradeAnswer(k, r.answer);
      expect(g.structured.passed, `${f}#${i} ${JSON.stringify(g.structured.failures)}`).toBe(g.structured.eligible);
      await c.stop(); open.splice(open.indexOf(c), 1);
    }
  }, 120_000);
});

describe("LP25-A4: renaming resources or nuisance fields neither leaks the answer nor changes the logical objective", () => {
  it("renamed resources, labels, project and timing give the same logical key, task and grading; renamed labels never reach the investigator", async () => {
    const d = doc("LW-01");
    const r = renameSaas(d, "z9");
    expect(JSON.stringify(r.doc)).not.toMatch(/"(tenant-db|ingress|api|audit|api-sdk)"/);
    const a = await start(d), b = await start(r.doc, r.plan);
    expect(b.private.world.world.plan.resources.map((x) => x.id)).toContain("tenant-store-z9");
    expect(logicalKey(keyOf(b))).toEqual(logicalKey(keyOf(a)));
    expect(b.public.task).toBe(a.public.task);
    for (const c of [a, b]) {
      const m = await connectScoped(c.public, "C3");
      const res = await scriptedInvestigate(m, c.public, "saas-storefront");
      const g = gradeAnswer(keyOf(c), res.answer);
      expect(g.structured.passed).toBe(g.structured.eligible);
      expect(leakScan(m.recorder.responses(), privateMarkers(c.private))).toEqual([]);
      await m.close();
    }
    // the public task is fixed per family and names no label, seed, expectation or step position
    for (const t of Object.values(PUBLIC_TASKS)) expect(t).not.toMatch(/lw0\d|seed|label|expect|step \d|unobserved|weak|outage|distractor/i);
  }, 90_000);

  it("held-out documents carry random ids and no answer, live outside the repository and are bound to their commitments", () => {
    const d1 = generateHeldout("saas-storefront", "m1", 0), d2 = generateHeldout("saas-storefront", "m2", 0);
    expect(d1.id).toMatch(/^lh-[0-9a-f]{10}$/);
    expect(d1.id).not.toBe(d2.id);
    expect(d1.expect).toEqual([]);
    expect(JSON.stringify(d1)).not.toMatch(/label|weak-read|outage|cross|unobserved|distractor/);
    expect(generateHeldout("saas-storefront", "m1", 0)).toEqual(d1); // deterministic from the private master seed
    const priv = mkdtempSync(join(tmpdir(), "dk-li-priv-test-"));
    process.env.DK_LI_PRIVATE_DIR = priv;
    try {
      const h = materializeHeldout("t-prereg", "master-xyz", ["saas-storefront", "agent-workspace"]);
      expect(h.dir.startsWith(ROOT)).toBe(false);
      expect(statSync(h.dir).mode & 0o077).toBe(0);
      expect(h.commitments).toHaveLength(2);
      const c0 = h.commitments[0]!;
      const loaded = loadHeldout("t-prereg", c0);
      expect(docCommitment(loaded)).toBe(c0.doc_sha256);
      expect(statSync(join(h.dir, `${c0.slot_doc}.json`)).mode & 0o077).toBe(0);
      // tampering with a held-out document after preregistration is detected
      writeFileSync(join(h.dir, `${c0.slot_doc}.json`), JSON.stringify({ ...loaded, steps: loaded.steps.slice(1) }));
      expect(() => loadHeldout("t-prereg", c0)).toThrow(/does not match its preregistered commitment/);
      expect(() => materializeHeldout("t-prereg", "again", ["saas-storefront"])).toThrow(/already exists/);
      expect(existsSync(join(h.dir, "master-seed"))).toBe(true);
    } finally { delete process.env.DK_LI_PRIVATE_DIR; }
  });
});
