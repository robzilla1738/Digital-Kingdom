import type { SecurityEvent } from "@dk/contracts";
import type { Store } from "./store.ts";
import { coverageHistory } from "./coverage-history.ts";
import { evaluate, type AuthSnapshot } from "./access/aws-policy.ts";
import { keyFingerprint } from "./adapters/aws.ts";

/**
 * Credential aftermath (roadmap R03.3): rotating the exposed key is not enough to close a case while anything it
 * created or granted still works. From recorded provider events (never the secret itself) this walks the
 * lineage of one AWS access key: keys it created, sessions it obtained, grants it made, and what those descendants
 * did in turn. Current authority is rechecked against the latest authorization snapshot. Missing snapshots or
 * audit gaps make the answer unknown, not clean.
 */
export interface Descendant {
  kind: "access_key" | "session" | "grant";
  id: string; created_at: string; created_by_key: string; event_id: string; raw_source_ref: string | null;
  detail: string;
  current_state: "active" | "inactive" | "expired" | "removed" | "unknown";
  surviving_permission: string | null;
  pattern: string | null;
}
export interface AftermathReport {
  schema: "dk.credential_aftermath.v1"; key: string; malicious_claimed: false; original_state: "active" | "inactive" | "unknown";
  descendants: Descendant[]; residual: Descendant[]; audit_gaps_ms: number; status: "resolved" | "unresolved" | "unknown";
  reasons: string[]; snapshot: { id: string; taken_at: string } | null; limits: string[];
}

const SESSION_MAX_MS = 12 * 3600_000; // STS AssumeRole maximum session duration
const attr = (e: SecurityEvent, k: string) => { const v = (e.attributes as Record<string, unknown> | undefined)?.[k]; return typeof v === "string" ? v : undefined; };

export function credentialAftermath(store: Store, projectId: string, keyId: string, opts: { snapshot: AuthSnapshot | null; auditAsset?: string; now?: Date }): AftermathReport {
  const now = opts.now ?? store.now();
  const events = store.listEvents(projectId, { limit: 20_000 }).filter((e) => attr(e, "provider") === "aws").sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const descendants: Descendant[] = [];
  // fingerprint -> key id, from the snapshot and the query (ids never need to be stored in events)
  const idOf = new Map<string, string>([[keyFingerprint(keyId), keyId]]);
  for (const p of opts.snapshot?.principals ?? []) for (const k of p.access_keys ?? []) idOf.set(keyFingerprint(k.id), k.id);
  const label = (fp: string) => idOf.get(fp) ?? fp;
  const seen = new Set<string>([keyFingerprint(keyId)]);
  const queue = [keyFingerprint(keyId)];
  while (queue.length && descendants.length < 500) {
    const k = queue.shift()!;
    for (const e of events.filter((x) => attr(x, "used_key_fp") === k && x.outcome === "success")) {
      const api = attr(e, "api") ?? "";
      const base = { created_at: e.occurred_at, created_by_key: label(k), event_id: e.id, raw_source_ref: attr(e, "raw_source_ref") ?? null, current_state: "unknown" as const, surviving_permission: null, pattern: null };
      const created = attr(e, "created_key_fp"), session = attr(e, "session_key_fp");
      if (api === "iam:CreateAccessKey" && created && !seen.has(created)) { seen.add(created); queue.push(created); descendants.push({ ...base, kind: "access_key", id: label(created), detail: `access key created for ${attr(e, "target_user") ?? "a user"}` }); }
      else if (api === "sts:AssumeRole" && session && !seen.has(session)) { seen.add(session); queue.push(session); descendants.push({ ...base, kind: "session", id: label(session), detail: `session for ${attr(e, "target_role_arn") ?? "a role"}` }); }
      else if (e.action === "authorization_change" && api !== "iam:CreateAccessKey") descendants.push({ ...base, kind: "grant", id: `${api}:${attr(e, "target_user") ?? attr(e, "target_role") ?? attr(e, "target_group") ?? "?"}:${attr(e, "policy_arn") ?? attr(e, "policy_name") ?? "?"}`, detail: `${api} on ${attr(e, "target_user") ?? attr(e, "target_role") ?? attr(e, "target_group") ?? "unknown target"}${attr(e, "policy_arn") ? ` (${attr(e, "policy_arn")})` : ""}` });
    }
  }
  const snap = opts.snapshot;
  const keyState = (id: string): "active" | "inactive" | "unknown" => {
    if (!snap) return "unknown";
    for (const p of snap.principals) { const k = p.access_keys?.find((x) => x.id === id); if (k) return k.status === "Active" ? "active" : "inactive"; }
    return "unknown";
  };
  const original = keyState(keyId);
  for (const d of descendants) {
    if (d.kind === "access_key") {
      const st = keyState(d.id);
      d.current_state = st === "unknown" && snap ? "removed" : st;
      const owner = snap?.principals.find((p) => p.access_keys?.some((k) => k.id === d.id));
      if (d.current_state === "active" && owner) {
        const probe = snap!.resources[0] ? evaluate(snap!, owner.arn, "s3:GetObject", `${snap!.resources[0].arn}/*`) : null;
        d.surviving_permission = `${owner.arn} via active key ${d.id}${probe && probe.result !== "blocked" ? `; s3:GetObject on ${snap!.resources[0]!.arn} is ${probe.result}` : ""}`;
      }
      const creator = snap?.principals.find((p) => p.access_keys?.some((k) => k.id === d.created_by_key));
      if (creator && owner && creator.arn === owner.arn) d.pattern = "same-user key creation: consistent with routine rotation; confirm with the owner before treating it as malicious";
    } else if (d.kind === "session") {
      d.current_state = now.getTime() - Date.parse(d.created_at) > SESSION_MAX_MS ? "expired" : "active";
      if (d.current_state === "active") d.surviving_permission = `temporary session ${d.id} may still be valid until ${new Date(Date.parse(d.created_at) + SESSION_MAX_MS).toISOString()}; AWS cannot revoke one session, only all sessions of the role issued before a time`;
    } else {
      const ev = events.find((x) => x.id === d.event_id)!;
      const pol = attr(ev, "policy_arn") ?? attr(ev, "policy_name");
      const target = attr(ev, "target_user") ?? attr(ev, "target_role");
      if (!snap || !pol || !target) d.current_state = "unknown";
      else {
        const p = snap.principals.find((x) => x.arn.endsWith(`/${target}`));
        if (!p || p.policies === "unknown") d.current_state = "unknown";
        else d.current_state = p.policies.some((doc) => doc.id === pol || pol.endsWith(`/${doc.id}`)) ? "active" : "removed";
        if (d.current_state === "active") d.surviving_permission = `${pol} is still attached to ${p!.arn}`;
      }
    }
  }
  // audit coverage between first use of the key and now
  const first = events.find((e) => attr(e, "used_key_fp") === keyFingerprint(keyId) || e.session_ref === `aws-key:${keyId}`);
  let gaps = 0;
  if (first && opts.auditAsset) {
    try { gaps = coverageHistory(store, projectId, { asset: opts.auditAsset, action: "authorization_change", after: first.occurred_at, before: now.toISOString() }).totals_ms.unknown; }
    catch { gaps = now.getTime() - Date.parse(first.occurred_at); }
  }
  const residual = descendants.filter((d) => d.current_state === "active");
  const unknown = descendants.filter((d) => d.current_state === "unknown");
  const reasons: string[] = [];
  if (residual.length) reasons.push(`${residual.length} descendant credential(s) or grant(s) still work${original === "inactive" ? " although the original key is inactive" : ""}`);
  if (!snap) reasons.push("no authorization snapshot: current authority cannot be rechecked");
  if (unknown.length) reasons.push(`${unknown.length} descendant(s) have unknown current state`);
  if (gaps > 0) reasons.push(`audit coverage has ${Math.round(gaps / 60000)} minute(s) of unknown time since first use; actions in those gaps are not visible`);
  if (original !== "inactive") reasons.push(`the original key is ${original}`);
  const status = residual.length ? "unresolved" : (!snap || unknown.length || gaps > 0 || original === "unknown") ? "unknown" : original === "active" ? "unresolved" : "resolved";
  return {
    schema: "dk.credential_aftermath.v1", key: keyId, malicious_claimed: false, original_state: original, descendants, residual, audit_gaps_ms: gaps, status, reasons,
    snapshot: snap ? { id: snap.snapshot_id, taken_at: snap.taken_at } : null,
    limits: ["Only recorded provider events in the supported AWS scope are followed.", "Descendants created by other credentials are not attributed to this key.", "Key creation is not proof of malice; same-user rotation is flagged for confirmation."],
  };
}
