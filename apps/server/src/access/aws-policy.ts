/**
 * Scoped AWS IAM policy evaluator (roadmap R04.3). ONE provider, two action families: S3 object/bucket actions and
 * sts:AssumeRole. It answers whether a CONFIGURED permission path exists; it never claims data was accessed.
 *
 * Inputs are an authorization snapshot (identity policies, permission boundaries, session policies, resource
 * policies including role trust policies, service control policies, and access key status). Any input marked
 * unknown, or absent where AWS would require it, makes the answer `unresolved`. Condition blocks are not
 * evaluated: a statement that only applies under conditions makes the answer `conditional` and lists the keys.
 *
 * Documented limits: no NotPrincipal, no policy variables, no tag-based ABAC, no VPC endpoint policies, no KMS key
 * policies, no S3 ACLs or Block Public Access, no session tags, no service-linked behaviour.
 */
export type Effect = "Allow" | "Deny";
export interface Statement { Sid?: string; Effect: Effect; Action?: string | string[]; NotAction?: string | string[]; Resource?: string | string[]; NotResource?: string | string[]; Principal?: "*" | { AWS?: string | string[]; Service?: string | string[] }; Condition?: Record<string, Record<string, unknown>> }
export interface PolicyDoc { id: string; Statement: Statement[] }
export type Known<T> = T | "unknown";
export interface Principal { arn: string; account: string; type: "user" | "role"; policies: Known<PolicyDoc[]>; boundary?: Known<PolicyDoc | null>; trust?: Known<PolicyDoc>; access_keys?: { id: string; status: "Active" | "Inactive" }[] }
export interface Resource { arn: string; account: string; policy?: Known<PolicyDoc | null> }
export interface AuthSnapshot { snapshot_id: string; taken_at: string; organization: { scps: Known<PolicyDoc[]> } | null; principals: Principal[]; resources: Resource[] }
export type PathResult = "feasible" | "conditional" | "blocked" | "unresolved";
export interface Decision { result: PathResult; reasons: string[]; evidence: string[]; condition_keys: string[]; kind: "configured_permission"; not_claimed: string[] }

const arr = (x: string | string[] | undefined) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const glob = (pattern: string, value: string) => new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i").test(value);
const actionMatch = (s: Statement, action: string) => (s.Action ? arr(s.Action).some((p) => glob(p, action)) : s.NotAction ? !arr(s.NotAction).some((p) => glob(p, action)) : false);
const resourceMatch = (s: Statement, res: string) => (s.Resource ? arr(s.Resource).some((p) => p === "*" || glob(p, res)) : s.NotResource ? !arr(s.NotResource).some((p) => glob(p, res)) : true);
const principalMatch = (s: Statement, arn: string, account: string) => {
  if (!s.Principal) return false;
  if (s.Principal === "*") return true;
  return arr(s.Principal.AWS).some((p) => p === "*" || p === arn || p === account || p === `arn:aws:iam::${account}:root` || glob(p, arn));
};

interface Match { allow: Statement[]; deny: Statement[]; allowConditional: Statement[]; denyConditional: Statement[] }
function scan(docs: PolicyDoc[], action: string, res: string, principal?: { arn: string; account: string }): Match & { ids: string[] } {
  const m: Match & { ids: string[] } = { allow: [], deny: [], allowConditional: [], denyConditional: [], ids: [] };
  for (const d of docs) for (const [i, s] of d.Statement.entries()) {
    if (!actionMatch(s, action) || !resourceMatch(s, res)) continue;
    if (principal && !principalMatch(s, principal.arn, principal.account)) continue;
    const cond = !!s.Condition && Object.keys(s.Condition).length > 0;
    (s.Effect === "Deny" ? (cond ? m.denyConditional : m.deny) : (cond ? m.allowConditional : m.allow)).push(s);
    m.ids.push(`${d.id}#${s.Sid ?? i}`);
  }
  return m;
}
const condKeys = (ss: Statement[]) => [...new Set(ss.flatMap((s) => Object.values(s.Condition ?? {}).flatMap((v) => Object.keys(v))))];
const NOT_CLAIMED = ["This is configured permission, not observed access.", "Conditions, ABAC tags, VPC endpoint and KMS key policies, ACLs and Block Public Access are not evaluated."];

/** Evaluate one request: principal (optionally via a session policy) performing `action` on `resourceArn`. */
export function evaluate(snap: AuthSnapshot, principalArn: string, action: string, resourceArn: string, opts: { sessionPolicy?: Known<PolicyDoc> } = {}): Decision {
  const reasons: string[] = [], evidence: string[] = [];
  const p = snap.principals.find((x) => x.arn === principalArn);
  if (!p) return { result: "unresolved", reasons: [`principal ${principalArn} is not in the snapshot`], evidence, condition_keys: [], kind: "configured_permission", not_claimed: NOT_CLAIMED };
  const isAssume = action.toLowerCase() === "sts:assumerole";
  const target = isAssume ? snap.principals.find((x) => x.arn === resourceArn) : undefined;
  const r = isAssume ? (target ? { arn: target.arn, account: target.account, policy: target.trust ?? "unknown" } : undefined) : snap.resources.find((x) => x.arn === resourceArn || resourceArn.startsWith(x.arn + "/"));
  const unknownInputs: string[] = [];
  if (p.policies === "unknown") unknownInputs.push(`identity policies of ${p.arn}`);
  if (p.boundary === "unknown") unknownInputs.push(`permission boundary of ${p.arn}`);
  if (opts.sessionPolicy === "unknown") unknownInputs.push("session policy");
  if (!r) unknownInputs.push(`resource ${resourceArn} (not in snapshot)`);
  else if (r.policy === "unknown") unknownInputs.push(isAssume ? `trust policy of ${resourceArn}` : `resource policy of ${resourceArn}`);
  if (snap.organization === null) { /* account not in an organization: no SCP layer */ }
  else if (snap.organization.scps === "unknown") unknownInputs.push("service control policies");
  const crossAccount = !!r && r.account !== p.account;

  const identity = scan(p.policies === "unknown" ? [] : p.policies, action, resourceArn);
  const resource = scan(r && r.policy && r.policy !== "unknown" ? [r.policy] : [], action, resourceArn, { arn: p.arn, account: p.account });
  const boundary = p.boundary && p.boundary !== "unknown" ? scan([p.boundary], action, resourceArn) : null;
  const session = opts.sessionPolicy && opts.sessionPolicy !== "unknown" ? scan([opts.sessionPolicy], action, resourceArn) : null;
  const scps = snap.organization && snap.organization.scps !== "unknown" ? scan(snap.organization.scps, action, resourceArn) : null;
  evidence.push(...identity.ids, ...resource.ids, ...(boundary?.ids ?? []), ...(session?.ids ?? []), ...(scps?.ids ?? []));

  // 1. explicit deny anywhere wins
  const denies = [...identity.deny, ...resource.deny, ...(boundary?.deny ?? []), ...(session?.deny ?? []), ...(scps?.deny ?? [])];
  if (denies.length) return { result: "blocked", reasons: [`explicit deny (${denies.map((s) => s.Sid ?? "statement").join(", ")}) overrides any allow`], evidence, condition_keys: [], kind: "configured_permission", not_claimed: NOT_CLAIMED };
  if (unknownInputs.length) return { result: "unresolved", reasons: unknownInputs.map((u) => `missing input: ${u}`), evidence, condition_keys: [], kind: "configured_permission", not_claimed: NOT_CLAIMED };

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
  for (const m of [identity, resource, boundary, session, scps]) if (m) conditional.push(...m.allowConditional, ...m.denyConditional);
  if (identity.denyConditional.length || resource.denyConditional.length) reasons.push("a conditional deny may apply");

  if (scpL === "no") return { result: "blocked", reasons: ["no service control policy allows the action (implicit deny)"], evidence, condition_keys: [], kind: "configured_permission", not_claimed: NOT_CLAIMED };
  if (bL === "no") return { result: "blocked", reasons: ["the permission boundary does not allow the action"], evidence, condition_keys: [], kind: "configured_permission", not_claimed: NOT_CLAIMED };
  if (sL === "no") return { result: "blocked", reasons: ["the session policy does not allow the action"], evidence, condition_keys: [], kind: "configured_permission", not_claimed: NOT_CLAIMED };
  let grant: "yes" | "cond" | "no";
  if (crossAccount || isAssume) {
    // cross-account (and role assumption) needs BOTH sides; same-account AssumeRole still needs the trust policy
    const both = [idL, resL];
    if (isAssume && !crossAccount && resL !== "no" && idL === "no" && resource.allow.some((s) => s.Principal !== "*" && arr((s.Principal as { AWS?: string | string[] }).AWS).includes(p.arn))) grant = resL === "cond" ? "cond" : "yes"; // trust naming the principal directly
    else grant = both.includes("no") ? "no" : both.includes("cond") ? "cond" : "yes";
    if (grant === "no") reasons.push(crossAccount ? "cross-account access needs an allow on both the identity side and the resource/trust side" : "role assumption needs the trust policy and an identity allow");
  } else grant = idL === "yes" || resL === "yes" ? "yes" : idL === "cond" || resL === "cond" ? "cond" : "no";
  if (grant === "no") return { result: "blocked", reasons: [...reasons, "no applicable allow (implicit deny)"], evidence, condition_keys: [], kind: "configured_permission", not_claimed: NOT_CLAIMED };
  const anyCond = grant === "cond" || [scpL, bL, sL].includes("cond") || identity.denyConditional.length + resource.denyConditional.length > 0;
  return { result: anyCond ? "conditional" : "feasible", reasons: anyCond ? reasons : ["allowed by configured policy"], evidence, condition_keys: condKeys(conditional), kind: "configured_permission", not_claimed: NOT_CLAIMED };
}

/** Paths from a principal to an action on a resource, directly or through up to `maxHops` role assumptions. */
export function accessPaths(snap: AuthSnapshot, fromArn: string, action: string, resourceArn: string, maxHops = 2) {
  const out: { hops: string[]; decision: Decision }[] = [];
  const rank: Record<PathResult, number> = { feasible: 0, conditional: 1, unresolved: 2, blocked: 3 };
  const worse = (x: PathResult, y: PathResult): PathResult => (rank[x] >= rank[y] ? x : y);
  const walk = (arn: string, hops: string[], via: Decision[]) => {
    const d = evaluate(snap, arn, action, resourceArn);
    const result = via.reduce((acc, v) => worse(acc, v.result), d.result);
    out.push({ hops: [...hops, arn], decision: { ...d, result, reasons: [...via.map((v, i) => `hop ${i + 1}: ${v.result} (${v.reasons[0] ?? ""})`), ...d.reasons], evidence: [...via.flatMap((v) => v.evidence), ...d.evidence], condition_keys: [...new Set([...via.flatMap((v) => v.condition_keys), ...d.condition_keys])] } });
    if (hops.length >= maxHops) return;
    for (const role of snap.principals.filter((x) => x.type === "role" && x.arn !== arn && !hops.includes(x.arn))) {
      const a = evaluate(snap, arn, "sts:AssumeRole", role.arn);
      if (a.result !== "blocked") walk(role.arn, [...hops, arn], [...via, a]);
    }
  };
  walk(fromArn, [], []);
  return out.sort((a, b) => rank[a.decision.result] - rank[b.decision.result] || a.hops.length - b.hops.length);
}
