// LP23: regenerates the committed LR-01 regression fixture and the LP23 server-test verification fixtures from real
// local lab runs (no model). Run from the repo root: npx tsx examples/reference-app/capture-lr01.ts
import { writeFileSync } from "node:fs";
import { captureRegression, EffectVerifier, type VerificationProbe } from "@dk/local-world";
import { weakStorefront } from "./repair-lab.ts";
const cleanups: (() => Promise<void> | void)[] = [];
async function one(seed: string, right: boolean) {
  const s = await weakStorefront(cleanups, seed);
  const h = { "x-world-session": s.sessionA };
  const probes: VerificationProbe[] = [
    { id: "cross-tenant-read", expectation: "prohibited", request: { resource: "ingress", method: "GET", path: "/tenants/tenant-b/records", headers: h }, effect: { observer: "audit", resource: "tenant-db" } },
    { id: "own-tenant-read", expectation: "permitted", request: { resource: "ingress", method: "GET", path: "/tenants/tenant-a/records", headers: h }, effect: { observer: "audit", resource: "tenant-db" } },
  ];
  const v = new EffectVerifier(s.run, s.sup.issue(s.run.run_id, { resources: "*", actions: ["request_route", "read_effects"] }));
  const before = await v.observe(probes, { repeats: 1 });
  const plan = s.plan([s.action(right ? { id: "a1", target_resource_id: "api", type: "set_gateway_policy", parameters: { policy_ref: "policy:baseline" } } : { id: "a1", target_resource_id: "ingress", type: "set_gateway_policy", parameters: { policy_ref: "policy:candidate" } })], { case_id: "case-lr01" });
  const execution = await s.controller().execute(s.lease(plan).token, plan);
  let verification = await v.verify({ plan, execution, probes, before });
  await s.run.stop(s.operatorToken); s.run.cleanup();
  verification = v.finalize(verification);
  return { s, h, probes, plan, execution, verification, seed };
}
const g = await one("lr01-saas", true);
const d = captureRegression({ world: g.s.run.world, blueprint: "saas-storefront", blueprint_version: 1, seed: g.seed,
  defect: [{ resource_id: "api", setting: "policy_variant", value: "deliberately_weak" }], principals: [{ ref: "principal-1", account: "acct:tenant-a:user", headers: g.h }],
  probes: g.probes, plan: g.plan, execution: g.execution, verification: g.verification, lesson: "The tenant API must refuse a tenant-a session reading tenant-b records while tenant-a reads keep working (repair: tenant API policy back to baseline).",
  case_id: "case-lr01", control_ids: ["ctl-tenant-isolation"], secrets: [g.s.sessionA, g.s.sessionB, g.s.operatorToken, g.s.ctl] });
writeFileSync("scenarios/local-world/regressions/LR-01-saas-cross-tenant-api.json", JSON.stringify(d, null, 1) + "\n");
writeFileSync("apps/server/test/fixtures/lp23/verification-success.json", JSON.stringify(g.verification, null, 1) + "\n");
const b = await one("lr01-saas-wrong", false);
writeFileSync("apps/server/test/fixtures/lp23/verification-failed.json", JSON.stringify(b.verification, null, 1) + "\n");
console.log(d.regression_id, g.verification.whole_run.outcome, b.verification.whole_run.outcome);
for (const c of cleanups) await c();
