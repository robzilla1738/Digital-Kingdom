import { describe, expect, it } from "vitest";
import { accessPaths, evaluate, type AuthSnapshot, type PolicyDoc } from "../src/access/aws-policy.ts";
import { setup } from "./helpers.ts";

/** R04.3 scoped AWS policy evaluation (S3 + sts:AssumeRole). Configured permission only. */
const A = "111122223333", B = "444455556666";
const bucket = "arn:aws:s3:::acme-exports";
const allowRead: PolicyDoc = { id: "pol-read", Statement: [{ Sid: "ReadExports", Effect: "Allow", Action: ["s3:GetObject", "s3:ListBucket"], Resource: [bucket, `${bucket}/*`] }] };
const snap = (over: Partial<AuthSnapshot> = {}): AuthSnapshot => ({
  snapshot_id: "s1", taken_at: "2026-10-20T16:00:00Z", organization: { scps: [{ id: "scp-full", Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }] }] },
  principals: [
    { arn: `arn:aws:iam::${A}:user/build-bot`, account: A, type: "user", policies: [allowRead, { id: "pol-assume", Statement: [{ Sid: "AssumeExporter", Effect: "Allow", Action: "sts:AssumeRole", Resource: `arn:aws:iam::${A}:role/exporter` }] }], access_keys: [{ id: "AKIAFIXTUREBUILD0002", status: "Active" }] },
    { arn: `arn:aws:iam::${A}:user/intern`, account: A, type: "user", policies: [{ id: "pol-star", Statement: [{ Sid: "S3All", Effect: "Allow", Action: "s3:*", Resource: "*" }, { Sid: "NoExports", Effect: "Deny", Action: "s3:*", Resource: [bucket, `${bucket}/*`] }] }] },
    { arn: `arn:aws:iam::${A}:role/exporter`, account: A, type: "role", policies: [{ id: "pol-exporter", Statement: [{ Sid: "WriteExports", Effect: "Allow", Action: "s3:PutObject", Resource: `${bucket}/*` }] }], trust: { id: "trust-exporter", Statement: [{ Effect: "Allow", Principal: { AWS: `arn:aws:iam::${A}:user/build-bot` }, Action: "sts:AssumeRole" }] } },
    { arn: `arn:aws:iam::${B}:user/partner`, account: B, type: "user", policies: [{ id: "pol-partner", Statement: [{ Effect: "Allow", Action: "s3:GetObject", Resource: `${bucket}/*` }] }] },
    { arn: `arn:aws:iam::${A}:user/ghost`, account: A, type: "user", policies: "unknown" },
  ],
  resources: [{ arn: bucket, account: A, policy: null }],
  ...over,
});

describe("R04.3 effective access", () => {
  it("an allow overridden by a known deny is not effective access", () => {
    const d = evaluate(snap(), `arn:aws:iam::${A}:user/intern`, "s3:GetObject", `${bucket}/customers.csv`);
    expect(d.result).toBe("blocked");
    expect(d.reasons[0]).toMatch(/explicit deny \(NoExports\)/);
    expect(evaluate(snap(), `arn:aws:iam::${A}:user/build-bot`, "s3:GetObject", `${bucket}/customers.csv`).result).toBe("feasible");
  });

  it("missing policy input makes the result unresolved, never feasible or blocked by default", () => {
    expect(evaluate(snap(), `arn:aws:iam::${A}:user/ghost`, "s3:GetObject", `${bucket}/x`)).toMatchObject({ result: "unresolved", reasons: [expect.stringMatching(/identity policies/)] });
    expect(evaluate(snap({ organization: { scps: "unknown" } }), `arn:aws:iam::${A}:user/build-bot`, "s3:GetObject", `${bucket}/x`).result).toBe("unresolved");
    expect(evaluate(snap({ resources: [{ arn: bucket, account: A, policy: "unknown" }] }), `arn:aws:iam::${A}:user/build-bot`, "s3:GetObject", `${bucket}/x`).result).toBe("unresolved");
  });

  it("cross-account access uses both the identity side and the resource side", () => {
    const partner = `arn:aws:iam::${B}:user/partner`;
    expect(evaluate(snap(), partner, "s3:GetObject", `${bucket}/x`)).toMatchObject({ result: "blocked", reasons: expect.arrayContaining([expect.stringMatching(/both the identity side and the resource/)]) });
    const withBucketPolicy = snap({ resources: [{ arn: bucket, account: A, policy: { id: "bucket-pol", Statement: [{ Sid: "Partner", Effect: "Allow", Principal: { AWS: partner }, Action: "s3:GetObject", Resource: `${bucket}/*` }] } }] });
    expect(evaluate(withBucketPolicy, partner, "s3:GetObject", `${bucket}/x`).result).toBe("feasible");
    const cond = snap({ resources: [{ arn: bucket, account: A, policy: { id: "bucket-pol", Statement: [{ Effect: "Allow", Principal: { AWS: partner }, Action: "s3:GetObject", Resource: `${bucket}/*`, Condition: { IpAddress: { "aws:SourceIp": "203.0.113.0/24" } } }] } }] });
    expect(evaluate(cond, partner, "s3:GetObject", `${bucket}/x`)).toMatchObject({ result: "conditional", condition_keys: ["aws:SourceIp"] });
  });

  it("paths through role assumption are found, and a boundary or SCP gap blocks them", () => {
    const paths = accessPaths(snap(), `arn:aws:iam::${A}:user/build-bot`, "s3:PutObject", `${bucket}/drop.csv`);
    expect(paths[0]).toMatchObject({ hops: [`arn:aws:iam::${A}:user/build-bot`, `arn:aws:iam::${A}:role/exporter`], decision: { result: "feasible" } });
    expect(paths.find((p) => p.hops.length === 1)!.decision.result).toBe("blocked"); // not directly
    const noScp = snap({ organization: { scps: [{ id: "scp-iam-only", Statement: [{ Effect: "Allow", Action: "iam:*", Resource: "*" }] }] } });
    expect(evaluate(noScp, `arn:aws:iam::${A}:user/build-bot`, "s3:GetObject", `${bucket}/x`).result).toBe("blocked");
  });

  it("configured permission is never labelled observed data access", async () => {
    const d = evaluate(snap(), `arn:aws:iam::${A}:user/build-bot`, "s3:GetObject", `${bucket}/x`);
    expect(d.kind).toBe("configured_permission");
    expect(d.not_claimed[0]).toMatch(/not observed access/);
    const ctx = await setup();
    expect((await ctx.app.inject({ url: `/api/projects/demo-castle/access/paths?from=x&action=s3:GetObject&resource=${bucket}`, headers: ctx.h(ctx.viewer) })).json()).toMatchObject({ result: "unresolved", snapshot: null });
    expect((await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/access/snapshot", headers: ctx.h(ctx.admin), payload: snap() })).statusCode).toBe(200);
    const r = (await ctx.app.inject({ url: `/api/projects/demo-castle/access/paths?from=${encodeURIComponent(`arn:aws:iam::${A}:user/build-bot`)}&action=s3:GetObject&resource=${encodeURIComponent(`${bucket}/x`)}`, headers: ctx.h(ctx.viewer) })).json();
    expect(r).toMatchObject({ schema: "dk.access_paths.v1", result: "feasible", snapshot: { id: "s1" } });
    expect(r.note).toMatch(/Configured permission only/);
  });
});
