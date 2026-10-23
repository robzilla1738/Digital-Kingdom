import { createHash } from "node:crypto";

/**
 * AWS CloudTrail identity/audit pack (roadmap R02.4) — FIXTURE-CONFORMANT, not live-verified.
 *
 * One AWS account scope. Input is CloudTrail's own record format (an S3 export file `{ "Records": [...] }` or the
 * same records from an authorized collector). Management events and data events are separate capabilities and
 * separate sources: data events (for example s3:GetObject) exist only when the trail is configured to log them,
 * so without a data-event source Digital Kingdom reports reads as UNKNOWN, never as "no reads".
 * Records from any other account are refused at the authorization boundary. Provider ids (access key ids, ARNs,
 * CloudTrail eventID) are kept as raw source references. No AWS API is called by this module.
 */
export interface AwsScope { account_id: string; regions: string[]; data_event_names: string[] }
export interface CloudTrailRecord {
  eventVersion?: string; eventID?: string; eventTime?: string; eventSource?: string; eventName?: string; awsRegion?: string;
  recipientAccountId?: string; errorCode?: string; readOnly?: boolean; managementEvent?: boolean; eventCategory?: string;
  sourceIPAddress?: string;
  userIdentity?: { type?: string; arn?: string; accountId?: string; accessKeyId?: string; principalId?: string; sessionContext?: unknown };
  requestParameters?: Record<string, unknown> | null; responseElements?: Record<string, unknown> | null;
  resources?: { ARN?: string; accountId?: string; type?: string }[];
}

const AUTH = new Set(["ConsoleLogin", "AssumeRole", "AssumeRoleWithSAML", "AssumeRoleWithWebIdentity", "GetSessionToken", "GetFederationToken"]);
const GRANT = new Set(["CreateAccessKey", "UpdateAccessKey", "DeleteAccessKey", "AttachUserPolicy", "AttachRolePolicy", "PutUserPolicy", "PutRolePolicy", "AddUserToGroup", "CreateLoginProfile", "UpdateAssumeRolePolicy", "CreatePolicyVersion", "PutBucketPolicy"]);
const KEY_RE = /^(AKIA|ASIA)[A-Z0-9]{12,20}$/;
const ACCT_RE = /^\d{12}$/;

/** Stable, non-reversible reference to an AWS access key id (the same id always gives the same fingerprint). */
export const keyFingerprint = (id: string) => `kfp_${createHash("sha256").update(`dk-aws-key:${id}`).digest("hex").slice(0, 24)}`;

export type MapResult = { ok: true; capability: "management" | "data"; event: Record<string, unknown> } | { ok: false; reason: "outside_authorization_boundary" | "region_not_in_scope" | "unsupported_event" | "data_event_not_configured" | "malformed"; detail: string };

/** Asset resolution by ARN: the caller passes a map from resource ARN (or account root) to asset id. */
export function mapCloudTrail(rec: CloudTrailRecord, scope: AwsScope, assetFor: (arn: string | undefined, service: string) => string | undefined, exportRef?: string): MapResult {
  if (!rec || typeof rec !== "object" || !rec.eventID || !rec.eventTime || !rec.eventName || !rec.eventSource) return { ok: false, reason: "malformed", detail: "missing eventID, eventTime, eventName or eventSource" };
  if (!ACCT_RE.test(scope.account_id)) return { ok: false, reason: "malformed", detail: "scope account_id must be 12 digits" };
  const acct = rec.recipientAccountId ?? rec.userIdentity?.accountId;
  if (acct !== scope.account_id) return { ok: false, reason: "outside_authorization_boundary", detail: `record for account ${String(acct).slice(0, 12)} is outside the authorized account` };
  if (rec.awsRegion && scope.regions.length && !scope.regions.includes(rec.awsRegion) && rec.awsRegion !== "us-east-1" /* global IAM/STS */) return { ok: false, reason: "region_not_in_scope", detail: `region ${rec.awsRegion} not in scope` };
  const name = rec.eventName, svc = rec.eventSource.replace(/\.amazonaws\.com$/, "");
  const isData = rec.managementEvent === false || rec.eventCategory === "Data";
  if (isData && !scope.data_event_names.includes(`${svc}:${name}`)) return { ok: false, reason: "data_event_not_configured", detail: `${svc}:${name} is not a configured data event for this pack` };
  const denied = rec.errorCode === "AccessDenied" || rec.errorCode === "Client.UnauthorizedOperation" || rec.errorCode === "UnauthorizedOperation";
  let action: string, outcome: string;
  if (isData) { action = "data_access"; outcome = denied ? "denied" : rec.errorCode ? "failure" : "success"; }
  else if (AUTH.has(name)) { action = "authentication"; const loginFail = name === "ConsoleLogin" && (rec.responseElements as { ConsoleLogin?: string } | null)?.ConsoleLogin === "Failure"; outcome = denied ? "denied" : rec.errorCode || loginFail ? "failure" : "success"; }
  else if (GRANT.has(name)) { action = "authorization_change"; outcome = denied ? "denied" : rec.errorCode ? "failure" : "success"; }
  else return { ok: false, reason: "unsupported_event", detail: `${svc}:${name} is not mapped by this pack` };
  const resourceArn = rec.resources?.[0]?.ARN ?? (typeof rec.requestParameters?.bucketName === "string" ? `arn:aws:s3:::${rec.requestParameters.bucketName}` : undefined);
  const asset = assetFor(resourceArn, svc) ?? assetFor(undefined, svc);
  if (!asset) return { ok: false, reason: "unsupported_event", detail: `no asset declared for ${svc}${resourceArn ? ` ${resourceArn}` : ""}` };
  // Provider identities. A key created by CreateAccessKey and the key used later share one session_ref.
  const usedKey = rec.userIdentity?.accessKeyId && KEY_RE.test(rec.userIdentity.accessKeyId) ? rec.userIdentity.accessKeyId : undefined;
  const createdKey = (rec.responseElements as { accessKey?: { accessKeyId?: string } } | null)?.accessKey?.accessKeyId;
  const keyRef = createdKey && KEY_RE.test(createdKey) ? createdKey : usedKey;
  const sk = (rec.responseElements as { credentials?: { accessKeyId?: string } } | null)?.credentials?.accessKeyId;
  const sessionKey = sk && KEY_RE.test(sk) ? sk : undefined;
  const rp = (rec.requestParameters ?? {}) as Record<string, unknown>;
  const principal = rec.userIdentity?.arn ? String(rec.userIdentity.arn).slice(0, 300) : rec.userIdentity?.principalId ? `principal:${String(rec.userIdentity.principalId).slice(0, 120)}` : undefined;
  const event: Record<string, unknown> = {
    source_event_id: `ct-${createHash("sha256").update(rec.eventID).digest("hex").slice(0, 32)}`,
    occurred_at: new Date(rec.eventTime).toISOString(),
    asset_ids: [asset], action, outcome,
    ...(principal ? { actor_ref: principal } : {}),
    ...(keyRef ? { session_ref: `aws-key:${keyRef}` } : {}),
    ...(rec.sourceIPAddress && /^[0-9a-fA-F:.]{3,45}$/.test(rec.sourceIPAddress) ? { client_ip: rec.sourceIPAddress } : {}),
    ...(rec.errorCode ? { rule_ref: `aws-error:${String(rec.errorCode).slice(0, 60)}` } : {}),
    attributes: {
      provider: "aws", api: `${svc}:${name}`, region: String(rec.awsRegion ?? ""), cloudtrail_event_id: String(rec.eventID).slice(0, 80),
      ...(resourceArn ? { resource_arn: resourceArn.slice(0, 300) } : {}),
      // Access key ids are identifiers, but secret scanners flag them; store keyed fingerprints in attributes.
      ...(createdKey ? { created_key_fp: keyFingerprint(createdKey) } : {}), ...(usedKey ? { used_key_fp: keyFingerprint(usedKey) } : {}),
      ...(sessionKey ? { session_key_fp: keyFingerprint(sessionKey) } : {}),
      // grant metadata only (names and ARNs), never policy documents or secrets
      ...(typeof rp.userName === "string" ? { target_user: rp.userName.slice(0, 128) } : {}), ...(typeof rp.roleName === "string" ? { target_role: rp.roleName.slice(0, 128) } : {}),
      ...(typeof rp.roleArn === "string" ? { target_role_arn: rp.roleArn.slice(0, 300) } : {}), ...(typeof rp.groupName === "string" ? { target_group: rp.groupName.slice(0, 128) } : {}),
      ...(typeof rp.policyArn === "string" ? { policy_arn: rp.policyArn.slice(0, 300) } : {}), ...(typeof rp.policyName === "string" ? { policy_name: rp.policyName.slice(0, 128) } : {}),
      ...(exportRef ? { raw_source_ref: `${exportRef.slice(0, 200)}#${String(rec.eventID).slice(0, 80)}` } : {}),
    },
  };
  return { ok: true, capability: isData ? "data" : "management", event };
}

/** Collection-window accounting for one export file: which regions were present and what was refused. */
export function summarizeExport(results: MapResult[], scope: AwsScope) {
  const refused: Record<string, number> = {};
  for (const r of results) if (!r.ok) refused[r.reason] = (refused[r.reason] ?? 0) + 1;
  return { accepted: results.filter((r) => r.ok).length, refused, scope: { account_id: scope.account_id, regions: scope.regions, data_events: scope.data_event_names.length ? scope.data_event_names : "none configured: reads are unknown, not absent" } };
}
