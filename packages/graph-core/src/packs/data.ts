/**
 * R09.3 data, RAG, secrets and backup pack (fixture-validated; live databases and stores need authorized access).
 *
 * - No database audit for an interval means reads are UNKNOWN for that interval, never zero.
 * - Retrieval enforces tenant on every document; a synthetic cross-tenant probe must be denied and an own-tenant
 *   probe must work, or the boundary is reported broken.
 * - Recovery is proven by a restore test: configured backups with a failed (or no) restore are failed recovery.
 * - Baseline inventory accepts metadata only; raw rows, document bodies and secret values are refused.
 */
export function readsAnswer(interval: { from: string; to: string }, audit: { covered: { from: string; to: string }[]; reads: { at: string; principal: string; resource: string }[] }) {
  const f = Date.parse(interval.from), t = Date.parse(interval.to);
  const covered = audit.covered.map((c) => [Math.max(f, Date.parse(c.from)), Math.min(t, Date.parse(c.to))] as const).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let cur = f; const gaps: { from: string; to: string }[] = [];
  for (const [a, b] of covered) { if (a > cur) gaps.push({ from: new Date(cur).toISOString(), to: new Date(a).toISOString() }); cur = Math.max(cur, b); }
  if (cur < t) gaps.push({ from: new Date(cur).toISOString(), to: new Date(t).toISOString() });
  const reads = audit.reads.filter((r) => Date.parse(r.at) >= f && Date.parse(r.at) <= t);
  return { reads, audit_gaps: gaps, answer: gaps.length ? (reads.length ? "reads_observed_with_gaps" : "unknown") : reads.length ? "reads_observed" : "no_reads_in_audited_interval" };
}

export interface RagDoc { id: string; tenant: string; origin: string; acl?: string[] }
export function retrieve(docs: RagDoc[], q: { tenant: string; principal: string; ids: string[] }) {
  return q.ids.map((id) => { const d = docs.find((x) => x.id === id); if (!d) return { id, result: "not_found" as const }; if (d.tenant !== q.tenant) return { id, result: "denied" as const, reason: "cross-tenant" }; if (d.acl && !d.acl.includes(q.principal)) return { id, result: "denied" as const, reason: "acl" }; return { id, result: "returned" as const, origin: d.origin }; });
}
export function tenantBoundaryCheck(docs: RagDoc[], probe: { tenant: string; principal: string; own_doc: string; foreign_doc: string }) {
  const [own, foreign] = retrieve(docs, { tenant: probe.tenant, principal: probe.principal, ids: [probe.own_doc, probe.foreign_doc] });
  const ok = own!.result === "returned" && foreign!.result === "denied";
  return { own: own!.result, foreign: foreign!.result, boundary: ok ? "holds_for_probe" : foreign!.result === "returned" ? "broken" : "own_tenant_unusable", note: "one synthetic probe; not proof for every query path" };
}
export interface MemoryMutation { at: string; run_id: string; key: string; op: "write" | "delete"; source_doc?: string }
export function memoryLineage(muts: MemoryMutation[], key: string) { return muts.filter((m) => m.key === key).sort((a, b) => a.at.localeCompare(b.at)).map((m) => ({ at: m.at, run_id: m.run_id, op: m.op, source_doc: m.source_doc ?? "unknown" })); }

export function recoveryState(b: { configured: boolean; last_backup_ok?: boolean; restore_tests: { at: string; ok: boolean; rto_minutes?: number }[] }) {
  const last = [...b.restore_tests].sort((x, y) => y.at.localeCompare(x.at))[0];
  if (!b.configured) return { state: "no_backup", reason: "no backup configured" };
  if (!last) return { state: "unverified", reason: "backups configured but never restored: recovery is unproven" };
  if (!last.ok) return { state: "failed", reason: `last restore test ${last.at} failed; backup job success does not change that` };
  return { state: "restore_tested", reason: `restore test ${last.at} succeeded${last.rto_minutes ? ` in ${last.rto_minutes} min` : ""}` };
}

export interface SecretMeta { ref: string; kind: "api_key" | "signing_key" | "password" | "certificate"; created_at: string; last_rotated_at?: string; owner?: string; used_by: string[] }
const RAW = /^(rows?|content|body|text|value|secret|secret_value|plaintext|data|document)$/i;
/** Inventory accepts metadata only. Returns problems when raw content is supplied. */
export function checkInventoryMetadata(items: Record<string, unknown>[]) {
  const problems: string[] = [];
  items.forEach((it, i) => { for (const k of Object.keys(it)) if (RAW.test(k)) problems.push(`item ${i}: field "${k}" looks like raw content; inventory takes metadata only`); });
  return problems;
}
export function secretAges(secrets: SecretMeta[], now: Date, maxDays = 90) {
  return secrets.map((s) => { const age = Math.floor((now.getTime() - Date.parse(s.last_rotated_at ?? s.created_at)) / 86_400_000); return { ref: s.ref, kind: s.kind, days_since_rotation: age, overdue: age > maxDays, owner: s.owner ?? "unassigned", used_by: s.used_by }; });
}
