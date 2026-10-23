import { describe, expect, it } from "vitest";
import type { AuthSnapshot } from "../src/access/aws-policy.ts";
import { setup } from "./helpers.ts";

/** R03.3 credential aftermath over AWS CloudTrail records (synthetic). */
const ACCT = "111122223333";
const U = (n: string) => `arn:aws:iam::${ACCT}:user/${n}`;
let n = 0;
const rec = (time: string, name: string, svc: string, key: string, user: string, extra: Record<string, unknown> = {}) => ({ eventVersion: "1.09", eventID: `af-${++n}`, eventTime: time, eventSource: `${svc}.amazonaws.com`, eventName: name, awsRegion: "us-east-1", recipientAccountId: ACCT, managementEvent: true, userIdentity: { type: "IAMUser", arn: U(user), accountId: ACCT, accessKeyId: key }, ...extra });
const EXPOSED = "AKIAEXPOSED000000001", BACKDOOR = "AKIABACKDOOR00000002", ROTATED = "AKIAROTATED000000003";

async function scenario(opts: { snapshot?: AuthSnapshot | null; gap?: boolean; records: unknown[] }) {
  const clock = { t: Date.parse("2026-10-20T09:00:00Z") };
  const ctx = await setup({ store: { now: () => new Date(clock.t) } });
  const { app, admin, h } = ctx;
  await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "acct", name: "Account", dataset_kind: "live" } });
  const gr = await app.inject({ method: "POST", url: "/api/projects/acct/graph", headers: h(admin), payload: { schema_version: "0.2", dataset_kind: "live", project_id: "acct", graph_revision: "r1", relationships: [], assets: [
    { id: "iam", name: "IAM", kind: "auth", environment: "prod", allowed_zone_ids: ["application"], source_refs: ["m"], aliases: ["aws:iam", "aws:sts"] },
    { id: "exports", name: "acme-exports", kind: "storage", environment: "prod", allowed_zone_ids: ["data"], source_refs: ["m"], provider_ref: { scope: `aws:${ACCT}`, id: "arn:aws:s3:::acme-exports" } }] } });
  expect(gr.statusCode, gr.body).toBe(200);
  const sr = await app.inject({ method: "POST", url: "/api/projects/acct/sources", headers: h(admin), payload: { id: "ct", label: "CloudTrail", kind: "cloud_audit", connector_id: "dk.aws.cloudtrail", asset_ids: ["iam"], identity_namespace: `aws:${ACCT}`, stale_after_seconds: 7 * 86400 } });
  expect(sr.statusCode, sr.body).toBe(200);
  const key = sr.json().key;
  await app.inject({ method: "POST", url: "/api/projects/acct/aws/scope", headers: h(admin), payload: { source_id: "ct", account_id: ACCT, regions: ["us-east-1"] } });
  clock.t = Date.parse("2026-10-20T09:05:00Z");
  ctx.store.receive("acct", "ct", { source_event_id: "hb0", occurred_at: "2026-10-20T09:05:00Z", asset_ids: ["iam"], action: "sensor_restored", outcome: "unknown" });
  clock.t = Date.parse("2026-10-20T09:45:00Z");
  const r = await app.inject({ method: "POST", url: "/ingest/aws/cloudtrail", headers: { authorization: `Bearer ${key}` }, payload: { Records: opts.records } });
  expect(r.json().accepted, r.body).toBe(opts.records.length);
  if (opts.gap) { clock.t = Date.parse("2026-10-20T10:30:00Z"); ctx.store.receive("acct", "ct", { source_event_id: "gap", occurred_at: "2026-10-20T10:30:00Z", asset_ids: ["iam"], action: "sensor_unavailable", outcome: "unknown", coverage_note: "trail stopped" }); }
  while (ctx.store.processBatch().processed) { /* drain */ }
  if (opts.snapshot) expect((await app.inject({ method: "POST", url: "/api/projects/acct/access/snapshot", headers: h(admin), payload: opts.snapshot })).statusCode).toBe(200);
  clock.t = Date.parse("2026-10-21T10:00:00Z");
  return (await app.inject({ url: `/api/projects/acct/aftermath/aws-key/${EXPOSED}`, headers: h(ctx.viewer) })).json();
}
const attackRecords = () => [
  rec("2026-10-20T09:10:00Z", "CreateUser", "iam", EXPOSED, "ci-deployer", { requestParameters: { userName: "svc-backup" } }),
  rec("2026-10-20T09:11:00Z", "CreateAccessKey", "iam", EXPOSED, "ci-deployer", { requestParameters: { userName: "svc-backup" }, responseElements: { accessKey: { accessKeyId: BACKDOOR } } }),
  rec("2026-10-20T09:12:00Z", "AttachUserPolicy", "iam", EXPOSED, "ci-deployer", { requestParameters: { userName: "svc-backup", policyArn: "arn:aws:iam::111122223333:policy/exports-read" } }),
  rec("2026-10-20T09:40:00Z", "AssumeRole", "sts", BACKDOOR, "svc-backup", { requestParameters: { roleArn: `arn:aws:iam::${ACCT}:role/exporter` }, responseElements: { credentials: { accessKeyId: "ASIASESSION000000004" } } }),
].filter((r) => r.eventName !== "CreateUser");
const snapshot = (over: { backdoor?: "Active" | "Inactive"; policyAttached?: boolean; exposed?: "Active" | "Inactive" } = {}): AuthSnapshot => ({
  snapshot_id: `snap-${Object.values(over).join("-") || "base"}`, taken_at: "2026-10-21T09:00:00Z", organization: null, resources: [{ arn: "arn:aws:s3:::acme-exports", account: ACCT, policy: null }],
  principals: [
    { arn: U("ci-deployer"), account: ACCT, type: "user", policies: [], access_keys: [{ id: EXPOSED, status: over.exposed ?? "Inactive" }, { id: ROTATED, status: "Active" }] },
    { arn: U("svc-backup"), account: ACCT, type: "user", policies: over.policyAttached === false ? [] : [{ id: "exports-read", Statement: [{ Effect: "Allow", Action: "s3:GetObject", Resource: "arn:aws:s3:::acme-exports/*" }] }], access_keys: [{ id: BACKDOOR, status: over.backdoor ?? "Active" }] },
  ],
});

describe("R03.3 credential aftermath", () => {
  it("original key inactive plus a surviving descendant key and grant stays unresolved and names the permission", async () => {
    const r = await scenario({ records: attackRecords(), snapshot: snapshot() });
    expect(r).toMatchObject({ original_state: "inactive", status: "unresolved", malicious_claimed: false });
    const key = r.residual.find((d: { kind: string }) => d.kind === "access_key");
    expect(key).toMatchObject({ id: BACKDOOR, current_state: "active" });
    expect(key.surviving_permission).toMatch(/svc-backup via active key AKIABACKDOOR00000002; s3:GetObject on arn:aws:s3:::acme-exports is feasible/);
    expect(r.residual.find((d: { kind: string }) => d.kind === "grant").surviving_permission).toMatch(/exports-read is still attached to arn:aws:iam::111122223333:user\/svc-backup/);
    expect(r.descendants.find((d: { kind: string }) => d.kind === "session")).toMatchObject({ created_by_key: BACKDOOR, current_state: "expired" });
  });

  it("when every descendant is gone and the original key is inactive, the aftermath resolves", async () => {
    const r = await scenario({ records: attackRecords(), snapshot: snapshot({ backdoor: "Inactive", policyAttached: false }) });
    expect(r.status).toBe("resolved");
    expect(r.residual).toEqual([]);
  });

  it("legitimate same-user rotation is flagged for confirmation, not called malicious", async () => {
    const records = [rec("2026-10-20T09:10:00Z", "CreateAccessKey", "iam", EXPOSED, "ci-deployer", { requestParameters: { userName: "ci-deployer" }, responseElements: { accessKey: { accessKeyId: ROTATED } } })];
    const r = await scenario({ records, snapshot: snapshot() });
    const d = r.descendants[0];
    expect(d).toMatchObject({ kind: "access_key", id: ROTATED, current_state: "active" });
    expect(d.pattern).toMatch(/routine rotation/);
    expect(r.malicious_claimed).toBe(false);
  });

  it("a missing snapshot or an audit interval gap keeps the answer unknown, never clean", async () => {
    expect((await scenario({ records: attackRecords(), snapshot: null })).status).toMatch(/unknown|unresolved/);
    const noSnap = await scenario({ records: attackRecords(), snapshot: null });
    expect(noSnap.reasons.join(" ")).toMatch(/no authorization snapshot/);
    const gap = await scenario({ records: attackRecords(), snapshot: snapshot({ backdoor: "Inactive", policyAttached: false }), gap: true });
    expect(gap.status).toBe("unknown");
    expect(gap.audit_gaps_ms).toBeGreaterThan(0);
  });
});
