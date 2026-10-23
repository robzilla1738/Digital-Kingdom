import { createHmac, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { HttpError } from "./store.ts";

/**
 * Notification outbox (roadmap R03.5). Attention is delivered to an owner who is not watching the castle.
 *
 * - Durable: every notification is a row in `notify_outbox` before any delivery is attempted, so a restart loses
 *   nothing. Delivery is at-least-once; each attempt carries the same `x-dk-delivery-id` so a receiver can drop
 *   repeats. A (destination, dedup_key) pair is unique, so re-raising the same matter never sends a second message.
 * - Routed: a destination names the projects it is AUTHORIZED to receive and, optionally, the owners it serves.
 *   A destination never receives a project outside its scope, whoever asks. Payloads are minimal: kind, severity,
 *   project id, case id and an authenticated deep link. No titles, events, evidence or free text leave the server.
 * - Signed: the body is HMAC-SHA256 signed with the destination's own secret (`x-dk-signature: sha256=<hex>`).
 * - Quiet windows defer non-critical deliveries; critical ones go through. Unacknowledged critical/high matters
 *   escalate once to the destination's escalation target after `escalate_after_seconds`.
 * - Failures are retried with exponential backoff (30 s doubling, max 1 h) and after `max_attempts` become `failed`,
 *   visible through GET /notifications/status and the receipts table. Nothing here claims a real destination works:
 *   only an operator-authorized destination with a successful test receipt does (gate: authorized_notification_destination).
 */
export const NOTIFY_MIGRATION = `CREATE TABLE notify_destinations (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, secret TEXT NOT NULL, project_ids TEXT NOT NULL, owners TEXT, min_severity TEXT NOT NULL, quiet_start_utc INTEGER, quiet_end_utc INTEGER, escalate_to TEXT, escalate_after_seconds INTEGER NOT NULL, max_attempts INTEGER NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL, disabled_at TEXT);
   CREATE TABLE notify_outbox (id TEXT PRIMARY KEY, dedup_key TEXT NOT NULL, project_id TEXT NOT NULL, destination_id TEXT NOT NULL, kind TEXT NOT NULL, severity TEXT NOT NULL, subject_ref TEXT, payload TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, created_at TEXT NOT NULL, delivered_at TEXT, last_error TEXT, acknowledged_at TEXT, acknowledged_by TEXT, escalated_from TEXT, UNIQUE (destination_id, dedup_key));
   CREATE INDEX notify_outbox_due ON notify_outbox (state, next_attempt_at);
   CREATE TABLE notify_receipts (id TEXT PRIMARY KEY, outbox_id TEXT NOT NULL, attempt INTEGER NOT NULL, at TEXT NOT NULL, status INTEGER, outcome TEXT NOT NULL, detail TEXT);`;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number }>;
const SEV = ["low", "medium", "high", "critical"] as const;
type Sev = (typeof SEV)[number];
const KINDS = ["case_assigned", "case_reopened", "finding_raised", "test", "escalation"] as const;
interface Dest { id: string; name: string; url: string; secret: string; project_ids: string; owners: string | null; min_severity: string; quiet_start_utc: number | null; quiet_end_utc: number | null; escalate_to: string | null; escalate_after_seconds: number; max_attempts: number; disabled_at: string | null }
interface Row { id: string; dedup_key: string; project_id: string; destination_id: string; kind: string; severity: string; subject_ref: string | null; payload: string; state: string; attempts: number; next_attempt_at: string; created_at: string; delivered_at: string | null; last_error: string | null; acknowledged_at: string | null; escalated_from: string | null }

export interface Notice { projectId: string; kind: (typeof KINDS)[number]; severity: Sev; dedupKey: string; owner?: string | null; caseId?: string | null }

export class Notifier {
  constructor(private readonly db: DatabaseSync, private readonly now: () => Date, private readonly fetchImpl: FetchLike, private readonly publicUrl: string | null, private readonly allowLoopback = false) {}
  private iso(d = this.now()) { return d.toISOString(); }

  addDestination(b: Record<string, unknown>, actor: string) {
    const name = typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 120) : null;
    if (!name) throw new HttpError(400, "name is required");
    let url: URL;
    try { url = new URL(String(b.url)); } catch { throw new HttpError(400, "url must be an absolute URL"); }
    const loop = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(this.allowLoopback && loop && url.protocol === "http:")) throw new HttpError(400, "destinations must use https");
    if (url.username || url.password) throw new HttpError(400, "credentials do not belong in the destination url");
    const projects = Array.isArray(b.project_ids) ? b.project_ids.filter((x): x is string => typeof x === "string") : [];
    if (!projects.length) throw new HttpError(400, "project_ids must list the projects this destination is authorized to receive");
    const owners = Array.isArray(b.owners) ? b.owners.filter((x): x is string => typeof x === "string") : null;
    const min = String(b.min_severity ?? "medium");
    if (!SEV.includes(min as Sev)) throw new HttpError(400, `min_severity must be one of ${SEV.join(", ")}`);
    const hour = (v: unknown, f: string) => { if (v === undefined || v === null) return null; if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 23) throw new HttpError(400, `${f} must be an hour 0-23 (UTC)`); return v as number; };
    const qs = hour(b.quiet_start_utc, "quiet_start_utc"), qe = hour(b.quiet_end_utc, "quiet_end_utc");
    if ((qs === null) !== (qe === null)) throw new HttpError(400, "quiet_start_utc and quiet_end_utc go together");
    const esc = typeof b.escalate_to === "string" ? b.escalate_to : null;
    if (esc && !this.dest(esc)) throw new HttpError(400, "escalate_to must name an existing destination");
    const after = Number.isInteger(b.escalate_after_seconds) ? Math.max(60, b.escalate_after_seconds as number) : 900;
    const attempts = Number.isInteger(b.max_attempts) ? Math.min(20, Math.max(1, b.max_attempts as number)) : 8;
    const id = `nd_${randomBytes(8).toString("hex")}`, secret = randomBytes(32).toString("hex");
    this.db.prepare("INSERT INTO notify_destinations (id, name, url, secret, project_ids, owners, min_severity, quiet_start_utc, quiet_end_utc, escalate_to, escalate_after_seconds, max_attempts, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, name, url.toString(), secret, JSON.stringify(projects), owners ? JSON.stringify(owners) : null, min, qs, qe, esc, after, attempts, this.iso(), actor);
    // The signing secret is shown once, to configure the receiver.
    return { ...this.view(this.dest(id)!), signing_secret: secret };
  }
  disableDestination(id: string) { if (!this.dest(id)) throw new HttpError(404, "no such destination"); this.db.prepare("UPDATE notify_destinations SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL").run(this.iso(), id); return this.view(this.dest(id)!); }
  listDestinations() { return (this.db.prepare("SELECT * FROM notify_destinations ORDER BY created_at").all() as unknown as Dest[]).map((d) => this.view(d)); }
  private dest(id: string) { return this.db.prepare("SELECT * FROM notify_destinations WHERE id = ?").get(id) as unknown as Dest | undefined; }
  private view(d: Dest) {
    const u = new URL(d.url);
    return { id: d.id, name: d.name, url_host: u.host, project_ids: JSON.parse(d.project_ids) as string[], owners: d.owners ? JSON.parse(d.owners) as string[] : null, min_severity: d.min_severity, quiet_window_utc: d.quiet_start_utc === null ? null : [d.quiet_start_utc, d.quiet_end_utc], escalate_to: d.escalate_to, escalate_after_seconds: d.escalate_after_seconds, max_attempts: d.max_attempts, disabled: !!d.disabled_at };
  }

  private link(n: Notice) {
    if (!this.publicUrl) return null;
    // The link opens the console, which requires sign-in; it carries identifiers only, never a token.
    return `${this.publicUrl.replace(/\/$/, "")}/#/projects/${encodeURIComponent(n.projectId)}${n.caseId ? `/cases/${encodeURIComponent(n.caseId)}` : ""}`;
  }
  private quiet(d: Dest, at: Date) {
    if (d.quiet_start_utc === null || d.quiet_end_utc === null) return false;
    const h = at.getUTCHours(), s = d.quiet_start_utc, e = d.quiet_end_utc;
    return s <= e ? h >= s && h < e : h >= s || h < e;
  }
  private quietEnd(d: Dest, at: Date) { const t = new Date(at); t.setUTCMinutes(0, 0, 0); while (this.quiet(d, t)) t.setUTCHours(t.getUTCHours() + 1); return t; }

  /** Route a notice to every authorized destination in scope. Returns the outbox rows created (duplicates are not). */
  enqueue(n: Notice, onlyDest?: string): string[] {
    const made: string[] = [];
    const at = this.now();
    const payload = { schema: "dk.notification.v1", kind: n.kind, severity: n.severity, project_id: n.projectId, case_id: n.caseId ?? null, link: this.link(n), raised_at: this.iso(at) };
    for (const d of this.db.prepare("SELECT * FROM notify_destinations WHERE disabled_at IS NULL").all() as unknown as Dest[]) {
      if (onlyDest && d.id !== onlyDest) continue;
      if (!(JSON.parse(d.project_ids) as string[]).includes(n.projectId)) continue;
      if (n.kind !== "test" && SEV.indexOf(n.severity) < SEV.indexOf(d.min_severity as Sev)) continue;
      const owners = d.owners ? JSON.parse(d.owners) as string[] : null;
      if (owners && n.kind !== "test" && !(n.owner && owners.includes(n.owner))) continue;
      const due = n.severity !== "critical" && n.kind !== "test" && this.quiet(d, at) ? this.quietEnd(d, at) : at;
      const id = `no_${randomBytes(8).toString("hex")}`;
      const r = this.db.prepare("INSERT OR IGNORE INTO notify_outbox (id, dedup_key, project_id, destination_id, kind, severity, subject_ref, payload, state, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)")
        .run(id, n.dedupKey, n.projectId, d.id, n.kind, n.severity, n.caseId ?? null, JSON.stringify({ ...payload, delivery_id: id }), this.iso(due), this.iso(at));
      if (r.changes) made.push(id);
    }
    return made;
  }

  test(destId: string) {
    const d = this.dest(destId);
    if (!d) throw new HttpError(404, "no such destination");
    const projects = JSON.parse(d.project_ids) as string[];
    const ids = this.enqueue({ projectId: projects[0]!, kind: "test", severity: "low", dedupKey: `test:${randomBytes(6).toString("hex")}` }, destId);
    return { queued: ids };
  }

  /** Attempt every due delivery once. Safe to call repeatedly; a row is claimed before it is sent. */
  async deliver(limit = 50) {
    const at = this.iso();
    const due = this.db.prepare("SELECT * FROM notify_outbox WHERE state = 'pending' AND next_attempt_at <= ? AND acknowledged_at IS NULL ORDER BY next_attempt_at LIMIT ?").all(at, limit) as unknown as Row[];
    let sent = 0, failed = 0;
    for (const o of due) {
      const d = this.dest(o.destination_id);
      if (!d || d.disabled_at) { this.db.prepare("UPDATE notify_outbox SET state = 'failed', last_error = ? WHERE id = ?").run("destination disabled or removed", o.id); failed++; continue; }
      const attempt = o.attempts + 1;
      // claim: push next_attempt_at out so an overlapping run does not double-send
      this.db.prepare("UPDATE notify_outbox SET attempts = ?, next_attempt_at = ? WHERE id = ? AND attempts = ?").run(attempt, this.iso(new Date(this.now().getTime() + 120_000)), o.id, o.attempts);
      const body = o.payload;
      const sig = createHmac("sha256", d.secret).update(body).digest("hex");
      let status: number | null = null, outcome = "error", detail: string | null = null;
      try {
        const res = await this.fetchImpl(d.url, { method: "POST", headers: { "content-type": "application/json", "x-dk-delivery-id": o.id, "x-dk-signature": `sha256=${sig}`, "x-dk-attempt": String(attempt) }, body, signal: AbortSignal.timeout(10_000) });
        status = res.status;
        outcome = res.status >= 200 && res.status < 300 ? "delivered" : "rejected";
      } catch (e) { detail = String((e as Error)?.message ?? e).slice(0, 200); }
      this.db.prepare("INSERT INTO notify_receipts (id, outbox_id, attempt, at, status, outcome, detail) VALUES (?, ?, ?, ?, ?, ?, ?)").run(`nr_${randomBytes(8).toString("hex")}`, o.id, attempt, this.iso(), status, outcome, detail);
      if (outcome === "delivered") { this.db.prepare("UPDATE notify_outbox SET state = 'delivered', delivered_at = ?, last_error = NULL WHERE id = ?").run(this.iso(), o.id); sent++; continue; }
      const err = detail ?? `HTTP ${status}`;
      if (attempt >= d.max_attempts) { this.db.prepare("UPDATE notify_outbox SET state = 'failed', last_error = ? WHERE id = ?").run(err, o.id); failed++; }
      else this.db.prepare("UPDATE notify_outbox SET last_error = ?, next_attempt_at = ? WHERE id = ?").run(err, this.iso(new Date(this.now().getTime() + Math.min(3600_000, 30_000 * 2 ** (attempt - 1)))), o.id);
    }
    return { attempted: due.length, delivered: sent, failed };
  }

  /** Escalate unacknowledged high/critical matters once, to the destination's escalation target. */
  escalate() {
    const rows = this.db.prepare("SELECT o.*, d.escalate_to AS esc, d.escalate_after_seconds AS after FROM notify_outbox o JOIN notify_destinations d ON d.id = o.destination_id WHERE o.acknowledged_at IS NULL AND o.escalated_from IS NULL AND o.kind NOT IN ('test','escalation') AND o.severity IN ('high','critical') AND d.escalate_to IS NOT NULL").all() as unknown as (Row & { esc: string; after: number })[];
    let n = 0;
    for (const o of rows) {
      if (this.now().getTime() - Date.parse(o.created_at) < o.after * 1000) continue;
      const target = this.dest(o.esc);
      if (!target || target.disabled_at || !(JSON.parse(target.project_ids) as string[]).includes(o.project_id)) continue; // escalation never widens project scope
      const id = `no_${randomBytes(8).toString("hex")}`;
      const p = { ...(JSON.parse(o.payload) as Record<string, unknown>), kind: "escalation", escalates: o.id, delivery_id: id };
      const r = this.db.prepare("INSERT OR IGNORE INTO notify_outbox (id, dedup_key, project_id, destination_id, kind, severity, subject_ref, payload, state, next_attempt_at, created_at, escalated_from) VALUES (?, ?, ?, ?, 'escalation', ?, ?, ?, 'pending', ?, ?, ?)")
        .run(id, `esc:${o.id}`, o.project_id, target.id, o.severity, o.subject_ref, JSON.stringify(p), this.iso(), this.iso(), o.id);
      n += Number(r.changes);
    }
    return { escalated: n };
  }

  /** Acknowledge a matter: every outbox row for that dedup key in the project stops retrying and escalating. */
  acknowledge(projectId: string, outboxId: string, actor: string) {
    const o = this.db.prepare("SELECT * FROM notify_outbox WHERE id = ? AND project_id = ?").get(outboxId, projectId) as unknown as Row | undefined;
    if (!o) throw new HttpError(404, "no such notification in this project");
    const key = o.escalated_from ? (this.db.prepare("SELECT dedup_key FROM notify_outbox WHERE id = ?").get(o.escalated_from) as { dedup_key: string } | undefined)?.dedup_key ?? o.dedup_key : o.dedup_key;
    const at = this.iso();
    const ids = (this.db.prepare("SELECT id FROM notify_outbox WHERE project_id = ? AND (dedup_key = ? OR escalated_from IN (SELECT id FROM notify_outbox WHERE project_id = ? AND dedup_key = ?))").all(projectId, key, projectId, key) as { id: string }[]).map((r) => r.id);
    for (const id of ids) this.db.prepare("UPDATE notify_outbox SET acknowledged_at = COALESCE(acknowledged_at, ?), acknowledged_by = COALESCE(acknowledged_by, ?), state = CASE WHEN state = 'pending' THEN 'acknowledged' ELSE state END WHERE id = ?").run(at, actor, id);
    return { acknowledged: ids.length, dedup_key: key };
  }

  /** Project view of attention delivery: failures are visible here, not only in logs. */
  status(projectId: string) {
    const rows = this.db.prepare("SELECT * FROM notify_outbox WHERE project_id = ? ORDER BY created_at DESC LIMIT 200").all(projectId) as unknown as Row[];
    const count = (s: string) => rows.filter((r) => r.state === s).length;
    const lastReceipt = (id: string) => this.db.prepare("SELECT attempt, at, status, outcome, detail FROM notify_receipts WHERE outbox_id = ? ORDER BY attempt DESC LIMIT 1").get(id) ?? null;
    return {
      schema: "dk.notification_status.v1",
      counts: { pending: count("pending"), delivered: count("delivered"), failed: count("failed"), acknowledged: count("acknowledged") },
      failures: rows.filter((r) => r.state === "failed" || (r.state === "pending" && r.last_error)).map((r) => ({ id: r.id, destination_id: r.destination_id, kind: r.kind, state: r.state, attempts: r.attempts, last_error: r.last_error, next_attempt_at: r.state === "pending" ? r.next_attempt_at : null })),
      recent: rows.slice(0, 50).map((r) => ({ id: r.id, kind: r.kind, severity: r.severity, destination_id: r.destination_id, state: r.state, attempts: r.attempts, case_id: r.subject_ref, created_at: r.created_at, delivered_at: r.delivered_at, acknowledged_at: r.acknowledged_at, last_receipt: lastReceipt(r.id) })),
      note: "Delivery counts describe the outbox, not investigation outcomes. A delivered notification is not a resolved matter.",
    };
  }
}
