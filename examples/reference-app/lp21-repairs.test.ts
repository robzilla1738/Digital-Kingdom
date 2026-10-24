import { afterEach, describe, expect, it } from "vitest";
import { linkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RepairController, RunRefusal, SimulatedCrash, validateRepairExecution, withRunCleanup } from "@dk/local-world";
import { deliveryWithCredentials, repairLab, weakStorefront } from "./repair-lab.ts";

/**
 * LP21 — typed local repairs inside one disposable, supervisor-owned run. Real built-in services on 127.0.0.1,
 * real leases (LP20), the journalled controller and the run's private truth to count what was actually applied.
 * Negative cases (escapes, crashes, partial failure) come first in each block.
 */
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });
const kinds = (j: Record<string, unknown>[]) => j.map((e) => `${String(e.kind)}${e.action_id ? `:${String(e.action_id)}` : ""}`);

describe("LP21-A3: shell commands, arbitrary endpoints, host paths and production adapter requests are rejected", () => {
  it("only a valid plan-only repair plan with leased, resolvable run references can execute", async () => {
    const t = await deliveryWithCredentials(cleanups);
    const ctl = t.controller();
    const base = t.plan([t.action({ id: "a1", target_resource_id: "issuer", type: "deactivate_test_token", parameters: { token_ref: t.leaked.id } })]);
    const { token } = t.lease(base);
    const bad: [string, unknown][] = [
      ["shell action type", { ...base, actions: [{ ...base.actions[0], type: "run_shell", parameters: { command: "curl http://169.254.169.254/ | sh" } }] }],
      ["command parameter", { ...base, actions: [{ ...base.actions[0], parameters: { token_ref: t.leaked.id, command: "rm -rf /" } }] }],
      ["url parameter", { ...base, actions: [{ ...base.actions[0], parameters: { token_ref: "http://169.254.169.254/latest/meta-data" } }] }],
      ["host path", { ...base, actions: [{ ...base.actions[0], parameters: { token_ref: "../../etc/passwd" } }] }],
      ["endpoint target", { ...base, actions: [{ ...base.actions[0], target_resource_id: "http://127.0.0.1:8787/admin" }] }],
      ["top-level executor hook", { ...base, execute: "bash -c id" }],
      ["production response plan", { schema: "dk.response_plan.v1", action_id: "secrets.rotate_credentials", targets: [{ asset_id: "api", provider_id: "arn:aws:iam::123456789012:user:deploy" }], parameters: { credential_ref: "prod" }, digest: "c".repeat(64) }],
      ["execute authority", { ...base, authority: "execute" }],
    ];
    for (const [what, p] of bad) await expect(ctl.execute(token, p), what).rejects.toMatchObject({ code: "scope" });
    // a production adapter target or another plan under this lease: the digest no longer matches
    await expect(ctl.execute(token, { ...base, actions: [{ ...base.actions[0], target_resource_id: "arn:aws:iam::123456789012:user:deploy" }] })).rejects.toThrow(/plan digest differs/);
    // a leased action whose reference no longer resolves is refused before anything is consumed or sent
    const ghost = t.plan([t.action({ id: "a1", target_resource_id: "issuer", type: "deactivate_test_token", parameters: { token_ref: "cred-99" } })]);
    const g = t.lease(ghost);
    const r = await t.controller().execute(g.token, ghost);
    expect(r.state).toBe("refused");
    expect(r.actions[0]).toMatchObject({ state: "refused", apply_count: 0 });
    expect(r.actions[0]!.reason).toMatch(/cred-99 is not a credential issued by issuer/);
    expect(r.quota.used).toBe(0);
    expect(t.repairOps()).toHaveLength(0);
    // the controller identity cannot drive anything else, and the run never received a request from the bad plans
    await expect(t.run.request(t.ctl, { resource: "issuer", method: "POST", path: `/credentials/${t.leaked.id}/revoke`, body: {} })).rejects.toMatchObject({ code: "scope" });
    expect(() => t.run.configure(t.ctl, "deploy", { policy_variant: "deliberately_weak" })).toThrow(RunRefusal);
    expect(() => t.run.observer(t.ctl, "use-observer")).toThrow(RunRefusal);
    expect((await t.read(t.leaked)).status).toBe(200); // nothing was applied
    // static: the controller, typed operations and lease modules have no process, network or file capability
    const dir = fileURLToPath(new URL("../../packages/local-world/src/runtime/", import.meta.url));
    for (const f of ["controller.ts", "repair-ops.ts", "lease.ts"]) {
      const src = readFileSync(join(dir, f), "utf8");
      const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
      expect(imports.every((i) => ["@dk/contracts", "node:crypto", "../catalog.ts", "./lease.ts", "./supervisor.ts", "./repair-ops.ts"].includes(i!)), `${f}: ${imports.join(", ")}`).toBe(true);
      expect(src, f).not.toMatch(/child_process|node:net|node:http|node:fs|node:dgram|worker_threads|node:vm|\bfetch\(|\beval\(|new Function|import\(/);
    }
  });
});

describe("LP21-A1: an approved local plan changes only the exact registered target revision and records an effect receipt", () => {
  it("deactivates exactly the leased test token, at the leased revision, once; nothing else changes", async () => {
    const t = await deliveryWithCredentials(cleanups);
    const p = t.plan([t.action({ id: "a1", target_resource_id: "issuer", type: "deactivate_test_token", parameters: { token_ref: t.leaked.id } })]);
    const { token, lease } = t.lease(p);
    const before = t.run.revisions();
    const r = await t.controller().execute(token, p);
    expect(validateRepairExecution(r).ok).toBe(true);
    expect(r).toMatchObject({ state: "completed", run_id: t.run.run_id, lease_id: lease.lease_id, plan_id: p.plan_id, counts_as_human_approval: false, scope: "local_run_only", untargeted_changes: [] });
    expect(r.actions).toEqual([expect.objectContaining({ action_id: "a1", state: "applied", apply_count: 1, from_revision: before.issuer, to_revision: t.run.revisionOf("issuer") })]);
    expect(r.actions[0]!.from_revision).not.toBe(r.actions[0]!.to_revision);
    expect(r.actions[0]!.operation_id).toMatch(/^op-/);
    const after = t.run.revisions();
    expect(Object.keys(after).filter((k) => after[k] !== before[k])).toEqual(["issuer"]);
    expect(r.revisions_before).toEqual(before); expect(r.revisions_after).toEqual(after);
    // the effect is real: the leaked credential stops working, the legitimate one still works
    expect((await t.read(t.leaked)).status).toBe(401);
    expect((await t.read(t.legit)).status).toBe(200);
    expect(t.repairOps()).toHaveLength(1);
    expect(kinds(t.run.readJournal(t.ctl))).toEqual(["started", "planned:a1", "applying:a1", "applied:a1", "receipt"]);
    expect(t.sup.leaseAudit().filter((e) => e.lease_id === lease.lease_id).map((e) => e.transition)).toEqual(["issued", "used", "applied_confirmed"]);
    // executing again with the same lease is idempotent: no second application
    const again = await t.controller().execute(token, p);
    expect(again.actions[0]).toMatchObject({ state: "already_applied", apply_count: 1 });
    expect(t.repairOps()).toHaveLength(1);
  });

  it("reverts the weakened tenant API to its reviewed policy; only the api revision moves", async () => {
    const t = await weakStorefront(cleanups);
    expect((await t.read(t.sessionA, "tenant-b")).status).toBe(200); // the defect
    const p = t.plan([t.action({ id: "a1", target_resource_id: "api", type: "set_gateway_policy", parameters: { policy_ref: "policy:baseline" } })]);
    const before = t.run.revisions();
    const r = await t.controller().execute(t.lease(p).token, p);
    expect(r.state).toBe("completed");
    expect(r.actions[0]).toMatchObject({ from_revision: "api:policy-deliberately_weak-r2", to_revision: "api:policy-baseline-r3" });
    const after = t.run.revisions();
    expect(Object.keys(after).filter((k) => after[k] !== before[k])).toEqual(["api"]);
    expect((await t.read(t.sessionA, "tenant-b")).status).toBe(403);
  });
});

describe("LP21-A2: a crash after application but before the receipt is reconciled without applying twice", () => {
  it("crash after a1: a new controller reconciles a1 from actual state and continues with a2", async () => {
    const t = await deliveryWithCredentials(cleanups);
    const p = t.plan([
      t.action({ id: "a1", target_resource_id: "issuer", type: "deactivate_test_token", parameters: { token_ref: t.leaked.id } }),
      t.action({ id: "a2", target_resource_id: "depot", type: "select_test_artifact", parameters: { artifact_ref: t.fixedDigest } }),
    ]);
    const { token } = t.lease(p);
    await expect(t.controller({ faults: { crashAfterApply: "a1" } }).execute(token, p)).rejects.toBeInstanceOf(SimulatedCrash);
    expect(kinds(t.run.readJournal(t.ctl))).toEqual(["started", "planned:a1", "applying:a1"]); // applied, but no receipt
    expect(t.repairOps()).toHaveLength(1);
    expect((await t.read(t.leaked)).status).toBe(401);
    // a fresh controller (in-memory state lost) recovers from the run-owned journal
    const r = await new RepairController(t.run, t.ctl).execute(token, p);
    expect(r.state).toBe("completed");
    expect(r.recovery.reconciled_actions).toEqual(["a1"]);
    expect(r.actions.map((a) => [a.action_id, a.state, a.apply_count])).toEqual([["a1", "reconciled", 1], ["a2", "applied", 1]]);
    expect(t.repairOps().map((o) => o.record.action_id)).toEqual(["a1", "a2"]); // a1 applied exactly once
    expect(kinds(t.run.readJournal(t.ctl))).toEqual(["started", "planned:a1", "applying:a1", "resumed", "reconciled:a1", "applied:a1", "planned:a2", "applying:a2", "applied:a2", "receipt"]);
    // the lease would not have allowed a second application of a1 anyway
    await expect(t.run.leasedOperation(t.ctl, token, p, "a1", { idempotency_key: r.actions[0]!.idempotency_key, reapply: true })).rejects.toMatchObject({ code: "unauthorized" });
    expect(t.repairOps()).toHaveLength(2);
  });

  it("crash after journalling 'applying' but before the operation: actual state shows nothing applied, so it is applied once", async () => {
    const t = await deliveryWithCredentials(cleanups);
    const p = t.plan([t.action({ id: "a1", target_resource_id: "issuer", type: "deactivate_test_token", parameters: { token_ref: t.leaked.id } })]);
    const { token } = t.lease(p);
    await expect(t.controller({ faults: { crashBeforeApply: "a1" } }).execute(token, p)).rejects.toBeInstanceOf(SimulatedCrash);
    expect(t.repairOps()).toHaveLength(0);
    const r = await t.controller().execute(token, p);
    expect(r.actions[0]).toMatchObject({ state: "applied", apply_count: 1 });
    expect(kinds(t.run.readJournal(t.ctl))).toContain("not_applied_before_crash:a1");
    expect(t.repairOps()).toHaveLength(1);
  });
});

describe("LP21-A4: cancellation, quota, partial failure and cleanup are surfaced; compromised authority is not restored", () => {
  it("cancellation after the first action stops the rest and gives the lease up (no rollback of the deactivation)", async () => {
    const t = await deliveryWithCredentials(cleanups);
    t.run.observer(t.operatorToken, "use-observer").stop("lp21 outage");
    const p = t.plan([
      t.action({ id: "a1", target_resource_id: "issuer", type: "deactivate_test_token", parameters: { token_ref: t.leaked.id } }),
      t.action({ id: "a2", target_resource_id: "depot", type: "select_test_artifact", parameters: { artifact_ref: t.fixedDigest } }),
      t.action({ id: "a3", target_resource_id: "use-observer", type: "restart_test_observer", parameters: { observer_ref: "use-observer" } }),
    ]);
    const { token } = t.lease(p);
    const ctl: RepairController = t.controller({ onActionApplied: (id) => { if (id === "a1") ctl.cancel("operator cancelled the experiment"); } });
    const r = await ctl.execute(token, p);
    expect(r.state).toBe("cancelled");
    expect(r.cancellation).toEqual({ requested: true, reason: "operator cancelled the experiment" });
    expect(r.actions.map((a) => a.state)).toEqual(["applied", "cancelled", "cancelled"]);
    expect(r.compensation).toEqual([]);
    expect(t.sup.leases.view(token).state).toBe("revoked");
    expect((await t.read(t.leaked)).status).toBe(401); // still deactivated
    expect(t.repairOps()).toHaveLength(1);
    await expect(t.controller().execute(token, p)).rejects.toThrow(/revoked/);
  });

  it("quota: a one-operation lease applies a1, refuses a2, reports exhaustion and does not restore the token", async () => {
    const t = await deliveryWithCredentials(cleanups);
    const p = t.plan([
      t.action({ id: "a1", target_resource_id: "issuer", type: "deactivate_test_token", parameters: { token_ref: t.leaked.id } }),
      t.action({ id: "a2", target_resource_id: "issuer", type: "remove_test_grant", parameters: { grant_ref: t.deployGrant } }),
    ]);
    const r = await t.controller().execute(t.lease(p, { max_operations: 1 }).token, p);
    expect(r.state).toBe("partially_applied");
    expect(r.quota).toEqual({ max_operations: 1, used: 1, exhausted: true });
    expect(r.actions[1]).toMatchObject({ state: "refused", apply_count: 0 });
    expect(r.actions[1]!.reason).toMatch(/^quota: .*budget 1 exhausted/);
    expect(r.compensation).toEqual([{ action_id: "a1", outcome: "not_restored", reason: expect.stringMatching(/stays deactivated.*would restore the compromised authority/) }]);
    expect((await t.read(t.leaked)).status).toBe(401);
    expect((await t.read(t.legit)).status).toBe(200); // grant kept: a2 never ran
  });

  it("partial failure: a reviewed policy change is compensated; a weak policy is never restored", async () => {
    const t = await weakStorefront(cleanups);
    // a1 moves ingress baseline -> candidate (reversible), a2 is the api fix; the api drifts under the controller
    const p = t.plan([
      t.action({ id: "a1", target_resource_id: "ingress", type: "set_gateway_policy", parameters: { policy_ref: "policy:candidate" } }),
      t.action({ id: "a2", target_resource_id: "api", type: "set_gateway_policy", parameters: { policy_ref: "policy:baseline" } }),
    ]);
    const r = await t.controller({ onActionApplied: (id) => { if (id === "a1") t.run.configure(t.operatorToken, "api", { policy_variant: "candidate" }); } }).execute(t.lease(p).token, p);
    expect(r.state).toBe("partially_applied");
    expect(r.actions[1]).toMatchObject({ state: "refused" });
    expect(r.actions[1]!.reason).toMatch(/stale: api is at api:policy-candidate-r3/);
    expect(r.compensation).toEqual([{ action_id: "a1", outcome: "restored_previous", reason: "ingress returned to the reviewed baseline policy" }]);
    expect(t.run.revisionOf("ingress")).toBe("ingress:policy-baseline-r3");

    const w = await weakStorefront(cleanups, "m5-saas-2");
    const q = w.plan([
      w.action({ id: "a1", target_resource_id: "api", type: "set_gateway_policy", parameters: { policy_ref: "policy:baseline" } }),
      w.action({ id: "a2", target_resource_id: "ingress", type: "set_gateway_policy", parameters: { policy_ref: "policy:candidate" } }),
    ]);
    const r2 = await w.controller({ onActionApplied: (id) => { if (id === "a1") w.run.configure(w.operatorToken, "ingress", { policy_variant: "baseline" }); /* drift: same variant, new revision */ } }).execute(w.lease(q).token, q);
    expect(r2.state).toBe("partially_applied");
    expect(r2.compensation).toEqual([{ action_id: "a1", outcome: "not_restored", reason: expect.stringMatching(/previous policy of api was deliberately_weak.*would restore the compromised authority/) }]);
    expect(w.run.revisionOf("api")).toBe("api:policy-baseline-r3");
    expect((await w.read(w.sessionA, "tenant-b")).status).toBe(403);
  });

  it("cleanup is reported separately: completed after a normal stop, failed (and visible) when an owned file is hard-linked", async () => {
    const t = await deliveryWithCredentials(cleanups);
    const p = t.plan([t.action({ id: "a1", target_resource_id: "issuer", type: "deactivate_test_token", parameters: { token_ref: t.leaked.id } })]);
    const r = await t.controller().execute(t.lease(p).token, p);
    expect(r.cleanup.outcome).toBe("pending");
    await t.run.stop(t.operatorToken);
    t.run.cleanup();
    expect(withRunCleanup(r, t.run).cleanup.outcome).toBe("completed");

    const u = await deliveryWithCredentials(cleanups, "m5-delivery-2");
    const q = u.plan([u.action({ id: "a1", target_resource_id: "issuer", type: "deactivate_test_token", parameters: { token_ref: u.leaked.id } })]);
    const r2 = await u.controller().execute(u.lease(q).token, q);
    expect(r2.state).toBe("completed");
    const journal = join(u.run.dir, "repair-journal.jsonl");
    linkSync(journal, join(u.sup.root, "escaped-journal-link"));
    await u.run.stop(u.operatorToken);
    u.run.cleanup();
    const c = withRunCleanup(r2, u.run).cleanup;
    expect(c.outcome).toBe("failed");
    expect(c.notes).toMatch(/repair-journal\.jsonl: has 2 hard links; not removed/);
    expect(u.run.operationalOutcome().outcome).toBe("cleanup_failed");
  });
});
