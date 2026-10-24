import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { canonicalJson, captureRegression, checkRegression, compileWorld, descriptorDigest, EffectVerifier, instantiateBlueprint, RegressionRefusal, regressionValidity, type RepairRegression, type VerificationProbe } from "@dk/local-world";

import { weakStorefront } from "./repair-lab.ts";
import { replayRegression } from "./src/lab/regression-replay.ts";

/**
 * LP23 — capture an executed + independently verified local repair (LP21 + LP22) as a replayable regression and
 * replay it without any model. Negative cases first.
 */
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });
const FIXTURE = new URL("../../scenarios/local-world/regressions/LR-01-saas-cross-tenant-api.json", import.meta.url);

async function verifiedRepair(seed: string, right = true) {
  const s = await weakStorefront(cleanups, seed);
  const h = { "x-world-session": s.sessionA };
  const probes: VerificationProbe[] = [
    { id: "cross-tenant-read", expectation: "prohibited", request: { resource: "ingress", method: "GET", path: "/tenants/tenant-b/records", headers: h }, effect: { observer: "audit", resource: "tenant-db" } },
    { id: "own-tenant-read", expectation: "permitted", request: { resource: "ingress", method: "GET", path: "/tenants/tenant-a/records", headers: h }, effect: { observer: "audit", resource: "tenant-db" } },
  ];
  const v = new EffectVerifier(s.run, s.sup.issue(s.run.run_id, { resources: "*", actions: ["request_route", "read_effects"] }));
  const before = await v.observe(probes, { repeats: 1 });
  const plan = s.plan([s.action(right ? { id: "a1", target_resource_id: "api", type: "set_gateway_policy", parameters: { policy_ref: "policy:baseline" } } : { id: "a1", target_resource_id: "ingress", type: "set_gateway_policy", parameters: { policy_ref: "policy:candidate" } })]);
  const execution = await s.controller().execute(s.lease(plan).token, plan);
  let verification = await v.verify({ plan, execution, probes, before });
  await s.run.stop(s.operatorToken); s.run.cleanup();
  verification = v.finalize(verification);
  const input = {
    world: s.run.world, blueprint: "saas-storefront" as const, blueprint_version: 1, seed,
    defect: [{ resource_id: "api", setting: "policy_variant" as const, value: "deliberately_weak" as const }],
    principals: [{ ref: "principal-1", account: "acct:tenant-a:user", headers: h }],
    probes, plan, execution, verification, lesson: "The tenant API must refuse a tenant-a session reading tenant-b records while tenant-a reads keep working.",
    case_id: "case-m5", control_ids: ["ctl-tenant-isolation"], secrets: [s.sessionA, s.sessionB, s.operatorToken, s.ctl],
  };
  return { s, input, verification };
}

describe("LP23-A3/A4 (negative first): what can never become a regression", () => {
  it("a failed verification is refused; secrets, headers, oracle fields, commands, unrelated records and tampering are refused", async () => {
    const bad = await verifiedRepair("lp23-wrong", false);
    expect(bad.verification.whole_run.outcome).toBe("security_failed");
    expect(() => captureRegression(bad.input)).toThrow(RegressionRefusal);
    expect(() => captureRegression(bad.input)).toThrow(/only an executed and independently verified repair/);

    const { input } = await verifiedRepair("lp23-neg");
    // a run secret smuggled into the lesson is caught by the scan (categories only)
    try { captureRegression({ ...input, lesson: `see session ${input.principals[0]!.headers["x-world-session"]}` }); throw new Error("not refused"); }
    catch (e) { expect(e).toBeInstanceOf(RegressionRefusal); expect((e as RegressionRefusal).code).toBe("leak"); expect((e as Error).message).not.toContain(input.principals[0]!.headers["x-world-session"]!); }
    // arbitrary headers that are not a declared principal, request bodies and unrelated resources are refused
    expect(() => captureRegression({ ...input, probes: input.probes.map((p, i) => i ? p : { ...p, request: { ...p.request, headers: { authorization: "Bearer x" } } }) })).toThrow(/arbitrary headers/);
    expect(() => captureRegression({ ...input, probes: input.probes.map((p, i) => i ? p : { ...p, request: { ...p.request, body: { q: 1 } } }) })).toThrow(/bodies are not captured/);
    expect(() => captureRegression({ ...input, probes: input.probes.map((p, i) => i ? p : { ...p, effect: { observer: "billing-prod", resource: "tenant-db" } }) })).toThrow(/mismatch|not a resource/);
    // a verification of another plan is refused
    expect(() => captureRegression({ ...input, plan: { ...input.plan, plan_id: "other" } })).toThrow(/exact plan/);

    const d = captureRegression(input);
    const text = canonicalJson(d);
    for (const s of input.secrets) expect(text).not.toContain(s);
    expect(text).not.toContain(input.verification.run_id);
    expect(text).not.toMatch(/x-world-session|ses-[a-f0-9]{8}|synthetic-[a-f0-9]{16}|127\.0\.0\.1|operation_id|nonce/);
    expect(d.replay).toEqual({ llm: "not_used", executor: "typed_repair_controller_under_supervisor_lease", scope: "local_run_only", data_origin: "synthetic_local", private_truth: "not_included" });
    const reseal = (x: Record<string, unknown>) => ({ ...x, descriptor_digest: descriptorDigest(x as never) });
    const forged: [string, unknown][] = [
      ["headers", reseal({ ...d, probes: d.probes.map((p) => ({ ...p, request: { ...p.request, headers: { "x-world-session": "ses-0123456789ab" } } })) })],
      ["oracle", reseal({ ...d, oracle: { truth: "x" } })],
      ["command parameter", reseal({ ...d, repair: { actions: [{ ...d.repair.actions[0]!, parameters: { command: "rm -rf /" } }] } })],
      ["shell type", reseal({ ...d, repair: { actions: [{ ...d.repair.actions[0]!, type: "shell" }] } })],
      ["url path", reseal({ ...d, probes: d.probes.map((p) => ({ ...p, request: { ...p.request, path: "http://169.254.169.254/latest" } })) })],
      ["unrelated record", reseal({ ...d, events: [{ id: "ev-1" }] })],
      ["no positive control", reseal({ ...d, probes: d.probes.filter((p) => p.control === "negative"), expected: { ...d.expected, baseline: d.expected.baseline.filter((b) => b.probe_id === "cross-tenant-read") } })],
      ["baseline never failed", reseal({ ...d, expected: { ...d.expected, baseline: d.expected.baseline.map((b) => ({ ...b, actual_effect: "not_observed" })) } })],
      ["tampered", { ...d, lesson: "changed after sealing" }],
    ];
    for (const [name, f] of forged) expect(checkRegression(f).ok, name).toBe(false);
    expect(checkRegression(forged.at(-1)![1]).ok ? [] : (checkRegression(forged.at(-1)![1]) as { errors: string[] }).errors.join()).toMatch(/integrity check only/);
    await expect(replayRegression(forged[1]![1])).rejects.toThrow(/regression refused/);
  });
});

describe("LP23-A1: a regression reruns without an LLM and reproduces the supported boundary result", () => {
  it("captured from a verified repair, replayed in fresh runs: baseline fails, without repair still fails, with repair passes", async () => {
    const { input } = await verifiedRepair("lp23-saas");
    const d = captureRegression(input);
    expect(checkRegression(d).ok).toBe(true);
    expect(d.probes.map((p) => [p.id, p.control])).toEqual([["cross-tenant-read", "negative"], ["own-tenant-read", "positive"]]);
    expect(d.expected.baseline).toEqual([{ probe_id: "cross-tenant-read", actual_effect: "observed" }, { probe_id: "own-tenant-read", actual_effect: "observed" }]);
    expect(d.versions.policies.api).toMatchObject({ template: "api", revision_at_validation: input.plan.actions[0]!.expected_target_revision });
    expect(d.residual_uncertainty.join(" ")).toMatch(/not a validated defence/);
    const results = [await replayRegression(d), await replayRegression(d)];
    for (const r of results) {
      expect(r.reasons).toEqual([]);
      expect(r).toMatchObject({ llm: "not_used", reproduced: true, validity: { status: "valid" }, baseline: { matches: true }, without_repair: { prohibited_observed: true } });
      expect(r.after_repair).toMatchObject({ security_verdict: "pass", whole_run: "success", residual_access: [], disruption: [], revisions_match: true });
    }
    expect(canonicalJson(results[0])).toBe(canonicalJson(results[1])); // deterministic boundary result
  });

  it("the committed regression fixture validates and replays", async () => {
    const d = JSON.parse(readFileSync(FIXTURE, "utf8")) as RepairRegression;
    expect(checkRegression(d).ok).toBe(true);
    const r = await replayRegression(d);
    expect(r.reasons).toEqual([]);
    expect(r.reproduced).toBe(true);
  });
});

describe("LP23-A2: changing a relevant policy/tool/artifact version marks the old validation stale", () => {
  it("template, catalog, tool and artifact changes each make it stale; a stale descriptor is not replayed as current", async () => {
    const d = JSON.parse(readFileSync(FIXTURE, "utf8")) as RepairRegression;
    const world = compileWorld(instantiateBlueprint("saas-storefront", { seed: d.world.seed }));
    expect(regressionValidity(d, { world })).toEqual({ status: "valid", changed: [] });
    const bump = (id: string) => ({ ...world, templates: world.templates.map((t) => t.resource_id === id ? { ...t, version: "9.9.9", digest: "f".repeat(64) } : t) });
    expect(regressionValidity(d, { world: bump("api") })).toMatchObject({ status: "stale", changed: ["policy:api template_version 1.0.0 -> 9.9.9", "policy:api template_digest"] });
    expect(regressionValidity(d, { world: bump("queue") }).status).toBe("valid"); // an unrelated resource does not
    expect(regressionValidity(d, { world: { ...world, catalog: { ...world.catalog, digest: "0".repeat(64) } } }).changed).toEqual(["world.catalog"]);
    expect(regressionValidity(d, { world, tools: { effect_verifier: "dk-effect-verifier-2" } })).toMatchObject({ status: "stale", changed: ["tool:effect_verifier dk-effect-verifier-1 -> dk-effect-verifier-2"] });
    const withArt = { ...d, versions: { ...d.versions, artifacts: { "build-fixed": "a".repeat(64) } } };
    expect(regressionValidity(withArt, { world, artifacts: { "build-fixed": "b".repeat(64) } }).changed).toEqual(["artifact:build-fixed"]);
    const r = await replayRegression(d, { tools: { repair_controller: "dk-repair-controller-2" } });
    expect(r).toMatchObject({ reproduced: false, validity: { status: "stale" }, after_repair: null });
    expect(r.reasons.join()).toMatch(/does not apply to the current versions/);
  });
});
