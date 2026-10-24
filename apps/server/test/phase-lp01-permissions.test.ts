import { describe, expect, it } from "vitest";
import { setup, liveGraph } from "./helpers.ts"; // first: db.ts and change-review.ts import each other
import { accessPaths, evaluate, EVALUATOR_VERSION, type AuthSnapshot, type PolicyDoc, type Statement } from "../src/access/aws-policy.ts";
import { reviewChange } from "../src/change-review.ts";
import { mcpHarness } from "../../mcp/test/phase-harness.ts";

/**
 * LP01: scoped permission semantics. Written first against dk-aws-eval as shipped at 9fec7ed, where the boundary,
 * session-policy and SCP conditional-deny fixtures returned `feasible`, a case-insensitive Resource glob granted
 * access to a differently-cased object key, and unsupported constructs were silently ignored.
 */
const A = "111122223333", B = "444455556666";
const bucket = "arn:aws:s3:::acme-exports";
const user = `arn:aws:iam::${A}:user/build-bot`;
const ALLOW_ALL: PolicyDoc = { id: "allow-all", Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }] };
const condDeny: Statement = { Sid: "DenyOutsideVpn", Effect: "Deny", Action: "s3:*", Resource: "*", Condition: { NotIpAddress: { "aws:SourceIp": "198.51.100.0/24" } } };
const withCondDeny = (id: string): PolicyDoc => ({ id, Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }, condDeny] });
const snap = (over: Partial<AuthSnapshot> = {}, principalOver: Record<string, unknown> = {}): AuthSnapshot => ({
  snapshot_id: "lp01", taken_at: "Fri 2026-10-23 6:00 PM CDT (UTC-05:00)",
  organization: { scps: [ALLOW_ALL] },
  principals: [
    { arn: user, account: A, type: "user", policies: [{ id: "pol-read", Statement: [{ Sid: "Read", Effect: "Allow", Action: ["s3:GetObject"], Resource: `${bucket}/*` }] }], access_keys: [{ id: "AKIAFIXTUREBUILD0002", status: "Active" }], ...principalOver },
  ],
  resources: [{ arn: bucket, account: A, policy: null }],
  ...over,
});
const OBJ = `${bucket}/customers.csv`;

describe("LP01-A1 conditional denies in every restrictive layer", () => {
  it("permission boundary conditional deny -> conditional (was feasible)", () => {
    const d = evaluate(snap({}, { boundary: withCondDeny("boundary") }), user, "s3:GetObject", OBJ);
    expect(d.result).toBe("conditional");
    expect(d.condition_keys).toContain("aws:SourceIp");
    expect(d.reasons.join(" ")).toMatch(/permission boundary.*conditional deny/);
    expect(d.evidence).toContain("boundary#DenyOutsideVpn");
  });
  it("session policy conditional deny -> conditional (was feasible)", () => {
    const d = evaluate(snap(), user, "s3:GetObject", OBJ, { sessionPolicy: withCondDeny("session") });
    expect(d.result).toBe("conditional");
    expect(d.reasons.join(" ")).toMatch(/session policy.*conditional deny/);
  });
  it("service control policy conditional deny -> conditional (was feasible)", () => {
    const d = evaluate(snap({ organization: { scps: [withCondDeny("scp")] } }), user, "s3:GetObject", OBJ);
    expect(d.result).toBe("conditional");
    expect(d.reasons.join(" ")).toMatch(/service control policy.*conditional deny/);
  });
  it("identity and resource conditional denies stay conditional", () => {
    expect(evaluate(snap({}, { policies: [withCondDeny("id")] }), user, "s3:GetObject", OBJ).result).toBe("conditional");
    expect(evaluate(snap({ resources: [{ arn: bucket, account: A, policy: { id: "bp", Statement: [{ ...condDeny, Principal: "*" }] } }] }), user, "s3:GetObject", OBJ).result).toBe("conditional");
  });
  it("a conditional deny on a role-assumption hop makes the path conditional", () => {
    const role = `arn:aws:iam::${A}:role/exporter`;
    const s = snap();
    s.principals[0]!.policies = [{ id: "p", Statement: [{ Effect: "Allow", Action: "sts:AssumeRole", Resource: role }] }];
    s.principals.push({ arn: role, account: A, type: "role", policies: [{ id: "role-pol", Statement: [{ Effect: "Allow", Action: "s3:GetObject", Resource: `${bucket}/*` }] }], trust: { id: "trust", Statement: [{ Effect: "Allow", Principal: { AWS: user }, Action: "sts:AssumeRole" }] } });
    s.organization = { scps: [{ id: "scp", Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }, { Sid: "AssumeOnlyMfa", Effect: "Deny", Action: "sts:AssumeRole", Resource: "*", Condition: { BoolIfExists: { "aws:MultiFactorAuthPresent": "false" } } }] }] };
    const via = accessPaths(s, user, "s3:GetObject", OBJ).find((p) => p.hops.length === 2)!;
    expect(via.decision.result).toBe("conditional");
    expect(via.decision.condition_keys).toContain("aws:MultiFactorAuthPresent");
  });
});

describe("LP01-A2 precedence: definite denies block, missing inputs never become feasible", () => {
  it("an unconditional applicable deny is blocked even alongside conditional denies and allows", () => {
    for (const layer of ["boundary", "session", "scp", "identity"] as const) {
      const deny: PolicyDoc = { id: `${layer}-deny`, Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }, condDeny, { Sid: "HardDeny", Effect: "Deny", Action: "s3:GetObject", Resource: `${bucket}/*` }] };
      const s = layer === "scp" ? snap({ organization: { scps: [deny] } }) : layer === "boundary" ? snap({}, { boundary: deny }) : layer === "identity" ? snap({}, { policies: [deny] }) : snap();
      const d = evaluate(s, user, "s3:GetObject", OBJ, layer === "session" ? { sessionPolicy: deny } : {});
      expect(d.result, layer).toBe("blocked");
      expect(d.reasons[0]).toMatch(/explicit deny \(HardDeny\)/);
    }
  });
  it("missing controlling inputs are unresolved, including an unstated resource policy", () => {
    expect(evaluate(snap({ resources: [{ arn: bucket, account: A }] }), user, "s3:GetObject", OBJ)).toMatchObject({ result: "unresolved", reasons: [expect.stringMatching(/resource policy of .*not stated in the snapshot/)] });
    expect(evaluate(snap({}, { boundary: "unknown" }), user, "s3:GetObject", OBJ).result).toBe("unresolved");
    expect(evaluate(snap(), user, "s3:GetObject", OBJ, { sessionPolicy: "unknown" }).result).toBe("unresolved");
    expect(evaluate(snap({ organization: { scps: "unknown" } }), user, "s3:GetObject", OBJ).result).toBe("unresolved");
    expect(evaluate(snap({ resources: [] }), user, "s3:GetObject", OBJ).result).toBe("unresolved");
  });
  it("conditional never outranks a missing input, and unresolved never becomes feasible across hops", () => {
    expect(evaluate(snap({ organization: { scps: "unknown" } }, { boundary: withCondDeny("b") }), user, "s3:GetObject", OBJ).result).toBe("unresolved");
    const s = snap({ organization: null });
    const role = `arn:aws:iam::${A}:role/opaque`;
    s.principals[0]!.policies = [{ id: "p", Statement: [{ Effect: "Allow", Action: "sts:AssumeRole", Resource: role }] }];
    s.principals.push({ arn: role, account: A, type: "role", policies: "unknown", trust: { id: "t", Statement: [{ Effect: "Allow", Principal: { AWS: user }, Action: "sts:AssumeRole" }] } });
    expect(accessPaths(s, user, "s3:GetObject", OBJ).find((p) => p.hops.length === 2)!.decision.result).toBe("unresolved");
  });
});

describe("LP01-A3 unsupported constructs and case-sensitive resource identifiers", () => {
  it("Resource matching is case-sensitive; action matching is not", () => {
    const s = snap({}, { policies: [{ id: "pub", Statement: [{ Effect: "Allow", Action: "S3:GETOBJECT", Resource: `${bucket}/public/*` }] }] });
    expect(evaluate(s, user, "s3:GetObject", `${bucket}/public/a.csv`).result).toBe("feasible");
    // was feasible: the old glob used the i flag on resources too
    expect(evaluate(s, user, "s3:GetObject", `${bucket}/PUBLIC/a.csv`).result).toBe("blocked");
    const deny = snap({}, { policies: [{ id: "p", Statement: [{ Effect: "Allow", Action: "s3:*", Resource: "*" }, { Sid: "NoSecret", Effect: "Deny", Action: "s3:*", Resource: `${bucket}/secret/*` }] }] });
    expect(evaluate(deny, user, "s3:GetObject", `${bucket}/Secret/x`).result).toBe("feasible");
    expect(evaluate(deny, user, "s3:GetObject", `${bucket}/secret/x`).result).toBe("blocked");
  });
  it("NotPrincipal, policy variables and unknown statement keys are unsupported and never produce feasible", () => {
    const np = snap({ resources: [{ arn: bucket, account: A, policy: { id: "bp", Statement: [{ Sid: "NotMe", Effect: "Deny", NotPrincipal: { AWS: `arn:aws:iam::${A}:role/admin` }, Action: "s3:*", Resource: `${bucket}/*` } as Statement] } }] });
    expect(evaluate(np, user, "s3:GetObject", OBJ)).toMatchObject({ result: "unresolved", unsupported: [expect.stringMatching(/bp#NotMe: NotPrincipal/)] });
    const vars = snap({}, { policies: [{ id: "p", Statement: [{ Effect: "Allow", Action: "s3:*", Resource: "*" }, { Sid: "Home", Effect: "Deny", Action: "s3:*", Resource: `${bucket}/\${aws:username}/*` }] }] });
    expect(evaluate(vars, user, "s3:GetObject", `${bucket}/build-bot/x`)).toMatchObject({ result: "unresolved", unsupported: [expect.stringMatching(/policy variable/)] });
    const unknownKey = snap({}, { policies: [{ id: "p", Statement: [{ Effect: "Allow", Action: "s3:GetObject", Resource: "*", Version: "x" } as unknown as Statement] }] });
    expect(evaluate(unknownKey, user, "s3:GetObject", OBJ).result).toBe("unresolved");
  });
  it("an unsupported allow cannot be dropped into a confident implicit-deny block", () => {
    const s = snap({}, { policies: [{ id: "p", Statement: [{ Sid: "VarAllow", Effect: "Allow", Action: "s3:GetObject", Resource: `${bucket}/\${aws:username}/*` }] }] });
    expect(evaluate(s, user, "s3:GetObject", `${bucket}/build-bot/x`).result).toBe("unresolved");
    // ...but a supported, definite deny still blocks
    s.principals[0]!.policies = [...(s.principals[0]!.policies as PolicyDoc[]), { id: "d", Statement: [{ Sid: "Hard", Effect: "Deny", Action: "s3:*", Resource: "*" }] }];
    expect(evaluate(s, user, "s3:GetObject", `${bucket}/build-bot/x`).result).toBe("blocked");
  });
  it("an unsupported statement that cannot match the action is irrelevant", () => {
    const s = snap({}, { policies: [{ id: "p", Statement: [{ Effect: "Allow", Action: "s3:GetObject", Resource: "*" }, { Sid: "Iam", Effect: "Deny", Action: "iam:*", Resource: "arn:aws:iam::*:user/${aws:username}" }] }] });
    expect(evaluate(s, user, "s3:GetObject", OBJ).result).toBe("feasible");
  });
  it("every decision names the evaluator version and its declared limits", () => {
    const d = evaluate(snap(), user, "s3:GetObject", OBJ);
    expect(d).toMatchObject({ result: "feasible", evaluator: EVALUATOR_VERSION, kind: "configured_permission" });
    expect(d.not_claimed.join(" ")).toMatch(/NotPrincipal/);
  });
});

describe("LP01-A4 one authoritative decision across API, change review, aftermath and MCP", () => {
  const bSnap = (): AuthSnapshot => snap({}, { boundary: withCondDeny("boundary") });
  it("paths API, change review and aftermath expose the same decision and evidence", async () => {
    const direct = evaluate(bSnap(), user, "s3:GetObject", `${bucket}/*`);
    expect(direct.result).toBe("conditional");
    const ctx = await setup();
    expect((await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/access/snapshot", headers: ctx.h(ctx.admin), payload: bSnap() })).statusCode).toBe(200);
    const api = (await ctx.app.inject({ url: `/api/projects/demo-castle/access/paths?from=${encodeURIComponent(user)}&action=s3:GetObject&resource=${encodeURIComponent(`${bucket}/*`)}&max_hops=0`, headers: ctx.h(ctx.viewer) })).json();
    expect(api).toMatchObject({ result: "conditional", evaluator: EVALUATOR_VERSION });
    expect(api.paths[0].decision).toEqual(direct);

    const graph = liveGraph("shop") as never;
    const side = (s: AuthSnapshot) => ({ commit: "c", graph, snapshot: s, sources: [], artifacts: {} });
    const review = reviewChange({ base: side(snap({}, { policies: [] })), candidate: side(bSnap()), probes: [{ principal: user, action: "s3:GetObject", resource: `${bucket}/*` }] });
    expect(review.access_decisions[0]).toMatchObject({ evaluator: EVALUATOR_VERSION, base: { result: "blocked" }, candidate: direct });
    expect(review.changes).toContainEqual(expect.objectContaining({ kind: "broader_grant", detail: expect.stringMatching(/blocked -> conditional/) }));

  });

  it("credential aftermath reports the same decision for a surviving descendant key", async () => {
    const ACCT = A, U = (n: string) => `arn:aws:iam::${ACCT}:user/${n}`;
    const EXPOSED = "AKIAEXPOSED000000001", BACKDOOR = "AKIABACKDOOR00000002";
    const clock = { t: Date.parse("2026-10-23T09:00:00Z") };
    const ctx = await setup({ store: { now: () => new Date(clock.t) } });
    const { app, admin, h } = ctx;
    await app.inject({ method: "POST", url: "/api/projects", headers: h(admin), payload: { id: "acct", name: "Account", dataset_kind: "live" } });
    await app.inject({ method: "POST", url: "/api/projects/acct/graph", headers: h(admin), payload: { schema_version: "0.2", dataset_kind: "live", project_id: "acct", graph_revision: "r1", relationships: [], assets: [
      { id: "iam", name: "IAM", kind: "auth", environment: "prod", allowed_zone_ids: ["application"], source_refs: ["m"], aliases: ["aws:iam", "aws:sts"] },
      { id: "exports", name: "acme-exports", kind: "storage", environment: "prod", allowed_zone_ids: ["data"], source_refs: ["m"], provider_ref: { scope: `aws:${ACCT}`, id: bucket } }] } });
    const key = (await app.inject({ method: "POST", url: "/api/projects/acct/sources", headers: h(admin), payload: { id: "ct", label: "CloudTrail", kind: "cloud_audit", connector_id: "dk.aws.cloudtrail", asset_ids: ["iam"], identity_namespace: `aws:${ACCT}`, stale_after_seconds: 7 * 86400 } })).json().key;
    await app.inject({ method: "POST", url: "/api/projects/acct/aws/scope", headers: h(admin), payload: { source_id: "ct", account_id: ACCT, regions: ["us-east-1"] } });
    const rec = { eventVersion: "1.09", eventID: "lp01-1", eventTime: "2026-10-23T09:10:00Z", eventSource: "iam.amazonaws.com", eventName: "CreateAccessKey", awsRegion: "us-east-1", recipientAccountId: ACCT, managementEvent: true, userIdentity: { type: "IAMUser", arn: U("ci-deployer"), accountId: ACCT, accessKeyId: EXPOSED }, requestParameters: { userName: "svc-backup" }, responseElements: { accessKey: { accessKeyId: BACKDOOR } } };
    clock.t = Date.parse("2026-10-23T09:20:00Z");
    expect((await app.inject({ method: "POST", url: "/ingest/aws/cloudtrail", headers: { authorization: `Bearer ${key}` }, payload: { Records: [rec] } })).json().accepted).toBe(1);
    while (ctx.store.processBatch().processed) { /* drain */ }
    const s: AuthSnapshot = { snapshot_id: "lp01-after", taken_at: "2026-10-23T10:00:00Z", organization: null, resources: [{ arn: bucket, account: ACCT, policy: null }], principals: [
      { arn: U("ci-deployer"), account: ACCT, type: "user", policies: [], access_keys: [{ id: EXPOSED, status: "Inactive" }] },
      { arn: U("svc-backup"), account: ACCT, type: "user", policies: [{ id: "exports-read", Statement: [{ Effect: "Allow", Action: "s3:GetObject", Resource: `${bucket}/*` }] }], boundary: withCondDeny("boundary"), access_keys: [{ id: BACKDOOR, status: "Active" }] }] };
    expect((await app.inject({ method: "POST", url: "/api/projects/acct/access/snapshot", headers: h(admin), payload: s })).statusCode).toBe(200);
    clock.t = Date.parse("2026-10-23T11:00:00Z");
    const r = (await app.inject({ url: `/api/projects/acct/aftermath/aws-key/${EXPOSED}`, headers: h(ctx.viewer) })).json();
    const d = r.descendants.find((x: { id: string }) => x.id === BACKDOOR);
    const expected = evaluate(s, U("svc-backup"), "s3:GetObject", `${bucket}/*`);
    expect(expected.result).toBe("conditional");
    expect(d.access_decision).toEqual(expected);
    expect(d.surviving_permission).toMatch(/s3:GetObject on arn:aws:s3:::acme-exports is conditional/);
  });

  it("MCP dk_access_paths returns the API decision unchanged", async () => {
    const t = await mcpHarness();
    try {
      await t.ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/access/snapshot", headers: t.ctx.h(t.ctx.admin), payload: bSnap() });
      const r = (await t.call(await t.connect(t.ctx.viewer), "dk_access_paths", { from: user, action: "s3:GetObject", resource: `${bucket}/*`, project: "demo-castle" })).json;
      expect(r).toMatchObject({ result: "conditional", evaluator: EVALUATOR_VERSION });
      expect(r.paths[0].decision).toEqual(evaluate(bSnap(), user, "s3:GetObject", `${bucket}/*`));
    } finally { await t.close(); }
  });
});
