import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setup } from "./helpers.ts";

/** R02.4 AWS CloudTrail pack: FIXTURE conformance (sanitized records), not a real-account check. */
const FX = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../fixtures/aws/cloudtrail-sanitized.json"), "utf8")) as { Records: Record<string, unknown>[] };
const ACCT = "111122223333";

async function pack(opts: { dataEvents?: boolean } = {}) {
  const clock = { t: Date.parse("2026-10-20T13:00:00Z") };
  const ctx = await setup({ store: { now: () => new Date(clock.t) } });
  const { app, admin, h } = ctx;
  await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "aws", name: "AWS account", dataset_kind: "live" } });
  await app.inject({ method: "POST", url: "/api/projects/aws/graph", headers: h(admin), payload: { schema_version: "0.2", dataset_kind: "live", project_id: "aws", graph_revision: "r1", relationships: [], assets: [
    { id: "iam", name: "IAM and STS", kind: "auth", environment: "prod", allowed_zone_ids: ["application"], source_refs: ["m"], provider_ref: { scope: `aws:${ACCT}`, id: "aws:iam" }, aliases: ["aws:sts", "aws:signin"] },
    { id: "exports", name: "acme-exports", kind: "storage", environment: "prod", allowed_zone_ids: ["data"], source_refs: ["m"], provider_ref: { scope: `aws:${ACCT}`, id: "arn:aws:s3:::acme-exports" } },
  ] } });
  const reg = async (b: Record<string, unknown>) => { const r = await app.inject({ method: "POST", url: "/api/projects/aws/sources", headers: h(admin), payload: b }); expect(r.statusCode, r.body).toBe(200); return r.json().key as string; };
  const mgmtKey = await reg({ id: "ct-mgmt", label: "CloudTrail management events", kind: "cloud_audit", asset_ids: ["iam"], connector_id: "dk.aws.cloudtrail", identity_namespace: `aws:${ACCT}`, stale_after_seconds: 86400 });
  if (opts.dataEvents) await reg({ id: "ct-data", label: "CloudTrail S3 data events", kind: "cloud_data_audit", asset_ids: ["exports"], connector_id: "dk.aws.cloudtrail", identity_namespace: `aws:${ACCT}`, stale_after_seconds: 86400 });
  const scope = await app.inject({ method: "POST", url: "/api/projects/aws/aws/scope", headers: h(admin), payload: { source_id: "ct-mgmt", account_id: ACCT, regions: ["us-east-1", "us-east-2"], ...(opts.dataEvents ? { data_event_names: ["s3:GetObject"], data_source_id: "ct-data" } : {}) } });
  expect(scope.statusCode, scope.body).toBe(200);
  clock.t = Date.parse("2026-10-20T16:00:00Z");
  const ingest = await app.inject({ method: "POST", url: "/ingest/aws/cloudtrail", headers: { authorization: `Bearer ${mgmtKey}` }, payload: { Records: FX.Records, export_ref: "s3://trail-bucket/AWSLogs/111122223333/CloudTrail/us-east-1/2026/10/20/fixture.json.gz" } });
  while (ctx.store.processBatch().processed) { /* drain */ }
  return { ctx, scope: scope.json(), ingest };
}

describe("R02.4 AWS identity/audit pack (fixture conformance)", () => {
  it("a key creation, its grant and its later use are linked through the provider key id with raw source references", async () => {
    const { ctx, ingest } = await pack();
    expect(ingest.statusCode, ingest.body).toBe(202);
    const r = (await ctx.app.inject({ url: `/api/projects/aws/events/search?after=2026-10-20T13:00:00Z&before=2026-10-20T16:00:00Z&session_ref=${encodeURIComponent("aws-key:AKIAFIXTUREBUILD0002")}`, headers: ctx.h(ctx.viewer) })).json();
    const apis = r.events.map((e: { action: string; attributes: { api: string } }) => `${e.action}:${e.attributes.api}`).sort();
    expect(apis).toEqual(["authentication:sts:AssumeRole", "authorization_change:iam:CreateAccessKey"]);
    for (const e of r.events) expect(e.attributes.raw_source_ref).toMatch(/^s3:\/\/trail-bucket\/.+#fx-000[13]$/);
    const grant = ctx.store.listEvents("aws", { limit: 50 }).find((e) => e.attributes?.api === "iam:AttachUserPolicy")!;
    expect(grant).toMatchObject({ action: "authorization_change", actor_ref: "arn:aws:iam::111122223333:user/ops-admin" });
    expect(JSON.stringify(ctx.store.listEvents("aws", { limit: 50 }))).not.toMatch(/customers\.csv|SecretAccessKey/);
  });

  it("without configured data events, the object read is refused as not configured and reads stay unknown", async () => {
    const { ctx, ingest } = await pack();
    expect(ingest.json().summary.refused).toMatchObject({ data_event_not_configured: 1 });
    expect(ctx.store.listEvents("aws", { limit: 50 }).some((e) => e.action === "data_access")).toBe(false);
    const hist = (await ctx.app.inject({ url: "/api/projects/aws/coverage/history?asset=exports&action=data_access&after=2026-10-20T15:00:00Z&before=2026-10-20T16:00:00Z", headers: ctx.h(ctx.viewer) })).json();
    expect(hist.totals_ms.covered).toBe(0);
    expect(hist.totals_ms.unknown).toBe(3600_000);
  });

  it("with data events configured, the read lands on the bucket through the separate data source", async () => {
    const { ctx } = await pack({ dataEvents: true });
    const read = ctx.store.listEvents("aws", { limit: 50 }).find((e) => e.action === "data_access")!;
    expect(read).toMatchObject({ source_id: "ct-data", asset_ids: ["exports"], session_ref: "aws-key:ASIAFIXTURESESSION03" });
  });

  it("cross-account records stop at the authorization boundary", async () => {
    const { ctx, ingest } = await pack();
    expect(ingest.json().summary.refused).toMatchObject({ outside_authorization_boundary: 1 });
    expect(JSON.stringify(ctx.store.listEvents("aws", { limit: 50 }))).not.toMatch(/999988887777|AKIAOTHERACCOUNT/);
    const rej = (await ctx.app.inject({ url: "/api/projects/aws/health", headers: ctx.h(ctx.viewer) })).json().recent_rejections;
    expect(JSON.stringify(rej)).toMatch(/outside_authorization_boundary/);
  });

  it("fixture conformance is labelled separately from a real-account check", async () => {
    const { ctx, scope } = await pack();
    expect(scope.verification).toBe("fixture");
    const cat = (await ctx.app.inject({ url: "/api/connectors", headers: ctx.h(ctx.viewer) })).json();
    const aws = (cat.connectors ?? cat).find((c: { id: string }) => c.id === "dk.aws.cloudtrail");
    expect(aws.capabilities.every((c: { level: string; evidence: string }) => c.level !== "live_verified" && /NOT live-verified|fixture only/.test(c.evidence))).toBe(true);
  });
});
