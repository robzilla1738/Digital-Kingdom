/**
 * R09.4 SaaS, endpoint and correspondence pack (fixture-validated; live providers need authorized access).
 *
 * - A shared service account establishes the account, never a particular human.
 * - The provider's permission and licensing limits are part of every answer (e.g. audit retention by plan).
 * - Changing a delegated grant and using it to read data are separate events.
 * - Installing or removing a feed changes coverage for the assets it covers, with the time it changed.
 */
export interface SaasAccount { id: string; kind: "human" | "service" | "shared"; holders?: string[] }
export function attributeActor(acct: SaasAccount) {
  if (acct.kind === "human") return { actor: acct.id, human: acct.id, confidence: "account_is_personal" };
  return { actor: acct.id, human: null, confidence: acct.kind === "shared" ? `shared by ${acct.holders?.length ?? "an unknown number of"} people: no particular human is established` : "service account: no human is established" };
}

export interface ProviderPlan { provider: string; plan: string; audit_retention_days: number | null; data_access_logs: boolean; scopes_granted: string[]; scopes_needed: string[] }
export function providerLimits(p: ProviderPlan) {
  const missing = p.scopes_needed.filter((s) => !p.scopes_granted.includes(s));
  return { provider: p.provider, plan: p.plan, limits: [
    p.audit_retention_days === null ? "audit retention unknown for this plan" : `audit history limited to ${p.audit_retention_days} days on this plan`,
    ...(p.data_access_logs ? [] : ["this plan does not log data access: reads are invisible"]),
    ...missing.map((s) => `scope ${s} not granted: related events are not collected`),
  ] };
}

export interface SaasEvent { at: string; type: "grant_added" | "grant_removed" | "data_read" | "forwarding_rule_changed" | "config_changed"; app?: string; scope?: string; account: string; target?: string }
export function delegationTimeline(events: SaasEvent[], app: string) {
  const mine = events.filter((e) => e.app === app).sort((a, b) => a.at.localeCompare(b.at));
  return {
    grant_changes: mine.filter((e) => e.type === "grant_added" || e.type === "grant_removed").map((e) => ({ at: e.at, type: e.type, scope: e.scope })),
    data_access: mine.filter((e) => e.type === "data_read").map((e) => ({ at: e.at, account: e.account, target: e.target })),
    note: "a grant shows what the app may do; only data_read events show what it did",
  };
}

export interface FeedChange { feed: string; at: string; op: "installed" | "removed"; asset_ids: string[] }
export function coverageEffects(changes: FeedChange[]) {
  const active = new Map<string, Set<string>>();
  return [...changes].sort((a, b) => a.at.localeCompare(b.at)).map((c) => {
    if (c.op === "installed") active.set(c.feed, new Set(c.asset_ids)); else active.delete(c.feed);
    const covered = new Set([...active.values()].flatMap((s) => [...s]));
    return { at: c.at, feed: c.feed, op: c.op, affected: c.asset_ids.map((a) => ({ asset_id: a, covered_after: covered.has(a) })) };
  });
}

export interface EndpointRecord { device: string; owner?: string; managed: boolean; agent_last_seen?: string; repos_cloned?: string[] }
export function developerDevices(devs: EndpointRecord[], now: Date, staleHours = 24) {
  return devs.map((d) => ({ device: d.device, owner: d.owner ?? "unknown", managed: d.managed, agent: !d.agent_last_seen ? "no agent" : now.getTime() - Date.parse(d.agent_last_seen) > staleHours * 3600_000 ? "stale" : "reporting", repos: d.repos_cloned ?? [], note: d.managed ? "agent telemetry only; activity outside it is not seen" : "unmanaged device: nothing on it is observed" }));
}
