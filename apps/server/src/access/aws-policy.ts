/**
 * Scoped AWS IAM policy evaluator (roadmap R04.3). ONE provider, two action families: S3 object/bucket actions and
 * sts:AssumeRole. It answers whether a CONFIGURED permission path exists; it never claims data was accessed.
 *
 * Inputs are an authorization snapshot (identity policies, permission boundaries, session policies, resource
 * policies including role trust policies, service control policies, and access key status). Any input marked
 * unknown, or absent where AWS would require it (including a resource policy that is not stated; null means none),
 * makes the answer `unresolved`. Condition blocks are not evaluated: an allow OR a deny in ANY layer that only
 * applies under conditions makes the answer `conditional` and lists the keys (LP01: v1 omitted conditional denies in
 * permission boundaries, session policies and SCPs and could report `feasible`).
 *
 * Documented limits: no NotPrincipal, no policy variables, no tag-based ABAC, no VPC endpoint policies, no KMS key
 * policies, no S3 ACLs or Block Public Access, no session tags, no service-linked behaviour. Statements using an
 * unsupported construct are reported in `unsupported` and make a dependent answer `unresolved`, never ignored.
 */
export type Effect = "Allow" | "Deny";
export interface Statement { Sid?: string; Effect: Effect; Action?: string | string[]; NotAction?: string | string[]; Resource?: string | string[]; NotResource?: string | string[]; Principal?: "*" | { AWS?: string | string[]; Service?: string | string[] }; Condition?: Record<string, Record<string, unknown>> }
export interface PolicyDoc { id: string; Statement: Statement[] }
export type Known<T> = T | "unknown";
export interface Principal { arn: string; account: string; type: "user" | "role"; policies: Known<PolicyDoc[]>; boundary?: Known<PolicyDoc | null>; trust?: Known<PolicyDoc>; access_keys?: { id: string; status: "Active" | "Inactive" }[] }
export interface Resource { arn: string; account: string; policy?: Known<PolicyDoc | null> }
export interface AuthSnapshot { snapshot_id: string; taken_at: string; organization: { scps: Known<PolicyDoc[]> } | null; principals: Principal[]; resources: Resource[] }
export type PathResult = "feasible" | "conditional" | "blocked" | "unresolved";
/** Bumped when the meaning of a decision changes (v2: LP01 restrictive-layer conditional denies, case-sensitive resources, unsupported constructs). */
export const EVALUATOR_VERSION = "dk.aws_policy_eval.v2";
export interface Decision { result: PathResult; reasons: string[]; evidence: string[]; condition_keys: string[]; kind: "configured_permission"; evaluator: string; unsupported: string[]; not_claimed: string[] }

const arr = (x: string | string[] | undefined) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
/** IAM wildcards. Actions compare case-insensitively; Resource and principal ARNs compare case-sensitively. */
const glob = (pattern: string, value: string, caseInsensitive: boolean) => new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", caseInsensitive ? "i" : "").test(value);
const actionMatch = (s: Statement, action: string) => (s.Action ? arr(s.Action).some((p) => glob(p, action, true)) : s.NotAction ? !arr(s.NotAction).some((p) => glob(p, action, true)) : false);
const resourceMatch = (s: Statement, res: string) => (s.Resource ? arr(s.Resource).some((p) => p === "*" || glob(p, res, false)) : s.NotResource ? !arr(s.NotResource).some((p) => glob(p, res, false)) : true);
const principalMatch = (s: Statement, arn: string, account: string) => {
  if (!s.Principal) return false;
  if (s.Principal === "*") return true;
  return arr(s.Principal.AWS).some((p) => p === "*" || p === arn || p === account || p === `arn:aws:iam::${account}:root` || glob(p, arn, false));
};

/** Statement constructs inside the declared support. Anything else is reported, never silently ignored. */
const SUPPORTED_KEYS = new Set(["Sid", "Effect", "Action", "NotAction", "Resource", "NotResource", "Principal", "Condition"]);
const hasVariable = (x: unknown): boolean => typeof x === "string" ? x.includes("${") : Array.isArray(x) ? x.some(hasVariable) : !!x && typeof x === "object" && Object.values(x).some(hasVariable);
function unsupportedIn(s: Statement): string[] {
  const out: string[] = [];
  for (const k of Object.keys(s)) if (!SUPPORTED_KEYS.has(k)) out.push(k === "NotPrincipal" ? "NotPrincipal is not evaluated" : `statement key ${k} is not supported`);
  if (s.Effect !== "Allow" && s.Effect !== "Deny") out.push(`Effect ${String(s.Effect)} is not Allow or Deny`);
  if (!s.Action && !s.NotAction) out.push("statement has neither Action nor NotAction");
  if (hasVariable([s.Action, s.NotAction, s.Resource, s.NotResource, s.Principal])) out.push("policy variables (${...}) are not evaluated");
  if (s.Principal && s.Principal !== "*" && typeof s.Principal === "object") for (const k of Object.keys(s.Principal)) if (k !== "AWS" && k !== "Service") out.push(`principal type ${k} is not supported`);
  return out;
}
/** Could an unsupported statement apply to this action? Only an action list without variables can rule it out. */
const mayApply = (s: Statement, action: string) => (!s.Action && !s.NotAction) || hasVariable([s.Action, s.NotAction]) || actionMatch(s, action);

interface Unsupported { ref: string; effect: string; reasons: string[] }
interface Match { allow: Statement[]; deny: Statement[]; allowConditional: Statement[]; denyConditional: Statement[]; unsupported: Unsupported[]; ids: string[]; denyCondIds: string[] }
function scan(docs: PolicyDoc[], action: string, res: string, principal?: { arn: string; account: string }): Match {
  const m: Match = { allow: [], deny: [], allowConditional: [], denyConditional: [], unsupported: [], ids: [], denyCondIds: [] };
  for (const d of docs) for (const [i, s] of d.Statement.entries()) {
    const ref = `${d.id}#${s.Sid ?? i}`;
    const uns = unsupportedIn(s);
    if (uns.length) { if (mayApply(s, action)) { m.unsupported.push({ ref, effect: String(s.Effect), reasons: uns }); m.ids.push(ref); } continue; }
    if (!actionMatch(s, action) || !resourceMatch(s, res)) continue;
    if (principal && !principalMatch(s, principal.arn, principal.account)) continue;
    const cond = !!s.Condition && Object.keys(s.Condition).length > 0;
    (s.Effect === "Deny" ? (cond ? m.denyConditional : m.deny) : (cond ? m.allowConditional : m.allow)).push(s);
    m.ids.push(ref);
    if (s.Effect === "Deny" && cond) m.denyCondIds.push(ref);
  }
  return m;
}
const condKeys = (ss: Statement[]) => [...new Set(ss.flatMap((s) => Object.values(s.Condition ?? {}).flatMap((v) => Object.keys(v))))];
const NOT_CLAIMED = [
  "This is configured permission, not observed access.",
  "Conditions, ABAC tags, VPC endpoint and KMS key policies, ACLs and Block Public Access are not evaluated.",
  "Unsupported constructs (NotPrincipal, policy variables, unknown statement keys, non-AWS principal types) are never ignored: when they could apply, the answer is unresolved unless a supported explicit deny blocks it.",
  "Resource and principal ARNs match case-sensitively; action names case-insensitively.",
];

/**
 * Evaluate one request: principal (optionally via a session policy) performing `action` on `resourceArn`.
 * Precedence (v2): a supported unconditional applicable deny -> blocked; any missing input -> unresolved; an
 * unsupported statement that may apply as a deny, or may be the only allow -> unresolved; an implicit deny in a
 * required layer -> blocked; any conditional allow OR conditional deny in ANY layer (identity, resource/trust,
 * permission boundary, session policy, SCP) -> conditional; otherwise feasible.
 */
export function evaluate(snap: AuthSnapshot, principalArn: string, action: string, resourceArn: string, opts: { sessionPolicy?: Known<PolicyDoc> } = {}): Decision {
  const reasons: string[] = [], evidence: string[] = [], unsupported: string[] = [];
  const out = (result: PathResult, why: string[], keys: string[] = []): Decision => ({ result, reasons: why, evidence, condition_keys: keys, kind: "configured_permission", evaluator: EVALUATOR_VERSION, unsupported, not_claimed: NOT_CLAIMED });
  const p = snap.principals.find((x) => x.arn === principalArn);
  if (!p) return out("unresolved", [`principal ${principalArn} is not in the snapshot`]);
  const isAssume = action.toLowerCase() === "sts:assumerole";
  const target = isAssume ? snap.principals.find((x) => x.arn === resourceArn) : undefined;
  const r = isAssume ? (target ? { arn: target.arn, account: target.account, policy: target.trust ?? "unknown" } : undefined) : snap.resources.find((x) => x.arn === resourceArn || resourceArn.startsWith(x.arn + "/"));
  const unknownInputs: string[] = [];
  if (p.policies === "unknown") unknownInputs.push(`identity policies of ${p.arn}`);
  if (p.boundary === "unknown") unknownInputs.push(`permission boundary of ${p.arn}`);
  if (opts.sessionPolicy === "unknown") unknownInputs.push("session policy");
  if (!r) unknownInputs.push(`resource ${resourceArn} (not in snapshot)`);
  else if (r.policy === undefined) unknownInputs.push(`resource policy of ${r.arn} (not stated in the snapshot; use null for none)`);
  else if (r.policy === "unknown") unknownInputs.push(isAssume ? `trust policy of ${resourceArn}` : `resource policy of ${resourceArn}`);
  if (snap.organization === null) { /* account not in an organization: no SCP layer */ }
  else if (snap.organization.scps === "unknown") unknownInputs.push("service control policies");
  const crossAccount = !!r && r.account !== p.account;

  const identity = scan(p.policies === "unknown" ? [] : p.policies, action, resourceArn);
  const resource = scan(r && r.policy && r.policy !== "unknown" ? [r.policy] : [], action, resourceArn, { arn: p.arn, account: p.account });
  const boundary = p.boundary && p.boundary !== "unknown" ? scan([p.boundary], action, resourceArn) : null;
  const session = opts.sessionPolicy && opts.sessionPolicy !== "unknown" ? scan([opts.sessionPolicy], action, resourceArn) : null;
  const scps = snap.organization && snap.organization.scps !== "unknown" ? scan(snap.organization.scps, action, resourceArn) : null;
  const layers: [string, Match | null][] = [["identity policy", identity], [isAssume ? "trust policy" : "resource policy", resource], ["permission boundary", boundary], ["session policy", session], ["service control policy", scps]];
  for (const [, m] of layers) if (m) evidence.push(...m.ids);
  for (const [name, m] of layers) for (const u of m?.unsupported ?? []) unsupported.push(`${name} ${u.ref}: ${u.reasons.join("; ")}`);

  // 1. a supported, unconditional, applicable explicit deny anywhere wins
  const denies = layers.flatMap(([, m]) => m?.deny ?? []);
  if (denies.length) return out("blocked", [`explicit deny (${denies.map((s) => s.Sid ?? "statement").join(", ")}) overrides any allow`]);
  // 2. missing inputs
  if (unknownInputs.length) return out("unresolved", unknownInputs.map((u) => `missing input: ${u}`));
  // 3. an unsupported statement that may apply as a deny
  const unsupportedDeny = layers.flatMap(([name, m]) => (m?.unsupported ?? []).filter((u) => u.effect !== "Allow").map((u) => `${name} ${u.ref}`));
  if (unsupportedDeny.length) return out("unresolved", [`unsupported statement(s) that may deny this request: ${unsupportedDeny.join(", ")}`]);
  const unsupportedAllow = layers.some(([, m]) => m?.unsupported.some((u) => u.effect === "Allow"));
  const implicitDeny = (why: string[]): Decision => unsupportedAllow ? out("unresolved", [...why, "an unsupported allow statement may grant it; not evaluated"]) : out("blocked", why);

  const layer = (name: string, m: Match | null, required: boolean): "yes" | "cond" | "no" | "n/a" => {
    if (!m) return required ? "no" : "n/a";
    if (m.allow.length) return "yes";
    if (m.allowConditional.length) { reasons.push(`${name} allows only under conditions`); return "cond"; }
    return "no";
  };
  const conditional: Statement[] = [];
  const scpL = snap.organization ? layer("service control policy", scps, true) : "n/a";
  const bL = boundary ? layer("permission boundary", boundary, true) : "n/a";
  const sL = session ? layer("session policy", session, true) : "n/a";
  const idL = layer("identity policy", identity, false);
  const resL = layer(isAssume ? "trust policy" : "resource policy", resource, false);
  for (const [, m] of layers) if (m) conditional.push(...m.allowConditional, ...m.denyConditional);
  const condDenyLayers = layers.filter(([, m]) => m && m.denyConditional.length);
  for (const [name, m] of condDenyLayers) reasons.push(`${name} has a conditional deny that may apply (${m!.denyCondIds.join(", ")}; keys ${condKeys(m!.denyConditional).join(", ")})`);

  if (scpL === "no") return implicitDeny(["no service control policy allows the action (implicit deny)"]);
  if (bL === "no") return implicitDeny(["the permission boundary does not allow the action"]);
  if (sL === "no") return implicitDeny(["the session policy does not allow the action"]);
  let grant: "yes" | "cond" | "no";
  if (crossAccount || isAssume) {
    // cross-account (and role assumption) needs BOTH sides; same-account AssumeRole still needs the trust policy
    const both = [idL, resL];
    if (isAssume && !crossAccount && resL !== "no" && idL === "no" && resource.allow.some((s) => s.Principal !== "*" && arr((s.Principal as { AWS?: string | string[] }).AWS).includes(p.arn))) grant = resL === "cond" ? "cond" : "yes"; // trust naming the principal directly
    else grant = both.includes("no") ? "no" : both.includes("cond") ? "cond" : "yes";
    if (grant === "no") reasons.push(crossAccount ? "cross-account access needs an allow on both the identity side and the resource/trust side" : "role assumption needs the trust policy and an identity allow");
  } else grant = idL === "yes" || resL === "yes" ? "yes" : idL === "cond" || resL === "cond" ? "cond" : "no";
  if (grant === "no") return implicitDeny([...reasons, "no applicable allow (implicit deny)"]);
  const anyCond = grant === "cond" || [scpL, bL, sL].includes("cond") || condDenyLayers.length > 0;
  return out(anyCond ? "conditional" : "feasible", anyCond ? reasons : ["allowed by configured policy"], condKeys(conditional));
}

/** Paths from a principal to an action on a resource, directly or through up to `maxHops` role assumptions. */
export function accessPaths(snap: AuthSnapshot, fromArn: string, action: string, resourceArn: string, maxHops = 2) {
  const out: { hops: string[]; decision: Decision }[] = [];
  const rank: Record<PathResult, number> = { feasible: 0, conditional: 1, unresolved: 2, blocked: 3 };
  const worse = (x: PathResult, y: PathResult): PathResult => (rank[x] >= rank[y] ? x : y);
  const walk = (arn: string, hops: string[], via: Decision[]) => {
    const d = evaluate(snap, arn, action, resourceArn);
    const result = via.reduce((acc, v) => worse(acc, v.result), d.result);
    out.push({ hops: [...hops, arn], decision: { ...d, result, reasons: [...via.map((v, i) => `hop ${i + 1}: ${v.result} (${v.reasons[0] ?? ""})`), ...d.reasons], evidence: [...via.flatMap((v) => v.evidence), ...d.evidence], condition_keys: [...new Set([...via.flatMap((v) => v.condition_keys), ...d.condition_keys])], unsupported: [...via.flatMap((v) => v.unsupported), ...d.unsupported] } });
    if (hops.length >= maxHops) return;
    for (const role of snap.principals.filter((x) => x.type === "role" && x.arn !== arn && !hops.includes(x.arn))) {
      const a = evaluate(snap, arn, "sts:AssumeRole", role.arn);
      if (a.result !== "blocked") walk(role.arn, [...hops, arn], [...via, a]);
    }
  };
  walk(fromArn, [], []);
  return out.sort((a, b) => rank[a.decision.result] - rank[b.decision.result] || a.hops.length - b.hops.length);
}
