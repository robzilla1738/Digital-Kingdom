import type { FastifyInstance, FastifyRequest } from "fastify";
import { sha256, type Role } from "./security.ts";
import { HttpError, type Store } from "./store.ts";
import type { Exploration } from "./exploration.ts";

/**
 * LP15 local attention queue (`dk.attention_queue.v1`).
 *
 * Keeps important case changes visible inside the console without any external notification dependency. It reads
 * the server's own project-scoped change stream (the `outbox` table: events, findings, sources, repair candidate sets)
 * from a durable per-project cursor, plus a bounded state scan for staleness, and keeps one queue item per matter:
 *
 * - kinds: `new_evidence` (records stored after an open case was opened, on its assets and in its time window), `contradiction` (a finding with counterevidence),
 *   `incomplete_repair` (repair candidates that are plan-only and not verified), `observer_gap` (a sensor reported
 *   unavailable or an observer was disabled) and `stale_check` (a source past its freshness expectation, or a repair
 *   candidate set whose baseline has moved).
 * - deduplication: an item is unique per (project, dedup_key). A distinct underlying record adds an OCCURRENCE (kept
 *   in the append-only `attention_log`, never discarded); the same record seen again (a retried delivery, a replayed
 *   stream) only increments `repeats`. So a retry storm makes at most one item and no log growth.
 * - acknowledgement: marks the item acknowledged and nothing else. It never closes, resolves or edits a case, a
 *   finding or any other record. A later DISTINCT occurrence reopens the item ("new since acknowledged").
 * - replay: every change to the queue (raised, occurrence, reopened, acknowledged) is a numbered row in
 *   `attention_log`; a console or test sink resumes from the last sequence it saw. The outbox cursor is durable, so a
 *   restart neither loses nor duplicates items; re-reading the stream from zero is idempotent.
 * - bounded urgency: each kind has an urgency ceiling (`low` | `medium` | `high`; `critical` is never assigned by a
 *   local signal), repeats never raise urgency, and at most `URGENT_PER_HOUR` items per project become `high` in any
 *   hour; beyond that they are recorded as `medium` with the reason.
 * - scope and minimization: everything is keyed by project and read through project authorization. Items carry
 *   kinds, ids, counts and fixed template text only: no titles, questions, notes, event attributes or evidence text.
 * - no remote destination: this module never calls the notifier or the network. An optional loopback-only test sink
 *   (`AppConfig.attentionTestSink`) can receive the same minimized items for local testing; it is off by default.
 */
export const ATTENTION_QUEUE = "dk.attention_queue.v1";
export const ATTENTION_ITEM = "dk.attention_item.v1";
export const ATTENTION_KINDS = ["new_evidence", "contradiction", "incomplete_repair", "observer_gap", "stale_check"] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];
const URGENCY = ["low", "medium", "high"] as const;
type Urgency = (typeof URGENCY)[number];
export const URGENCY_CEILING: Record<AttentionKind, Urgency> = { new_evidence: "medium", contradiction: "high", incomplete_repair: "medium", observer_gap: "high", stale_check: "medium" };
export const ATTENTION_LIMITS = { urgent_per_hour: 5, batch: 500, max_batches: 20, refs_shown: 5, log_page: 500 } as const;

export const ATTENTION_MIGRATION = `
CREATE TABLE attention_cursor (project_id TEXT PRIMARY KEY, outbox_seq INTEGER NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE attention_items (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, dedup_key TEXT NOT NULL, kind TEXT NOT NULL, urgency TEXT NOT NULL, urgency_note TEXT, case_id TEXT, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, facts TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('open','acknowledged')), occurrences INTEGER NOT NULL, repeats INTEGER NOT NULL DEFAULT 0, first_at TEXT NOT NULL, last_at TEXT NOT NULL, acknowledged_at TEXT, acknowledged_by TEXT, acknowledged_occurrences INTEGER, last_seq INTEGER NOT NULL, UNIQUE (project_id, dedup_key));
CREATE INDEX attention_items_project ON attention_items (project_id, state, last_seq);
CREATE TABLE attention_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, item_id TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('raised','occurrence','reopened','acknowledged')), source_ref TEXT, urgency TEXT, actor TEXT, at TEXT NOT NULL);
CREATE INDEX attention_log_project ON attention_log (project_id, seq);
CREATE INDEX attention_log_item_ref ON attention_log (item_id, source_ref);
CREATE TRIGGER attention_log_append_only_u BEFORE UPDATE ON attention_log BEGIN SELECT RAISE(ABORT, 'the attention log is append-only'); END;
CREATE TRIGGER attention_log_append_only_d BEFORE DELETE ON attention_log BEGIN SELECT RAISE(ABORT, 'the attention log is append-only'); END;`;

export type SinkFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number }>;
export interface AttentionSinkConfig { url: string; fetch?: SinkFetch }

interface Signal { kind: AttentionKind; dedupKey: string; caseId: string | null; subject: { type: string; id: string }; sourceRef: string; urgency: Urgency; facts: Record<string, string | number | string[]> }
interface ItemRow { id: string; project_id: string; dedup_key: string; kind: AttentionKind; urgency: Urgency; urgency_note: string | null; case_id: string | null; subject_type: string; subject_id: string; facts: string; state: "open" | "acknowledged"; occurrences: number; repeats: number; first_at: string; last_at: string; acknowledged_at: string | null; acknowledged_by: string | null; acknowledged_occurrences: number | null; last_seq: number }
interface CaseScope { id: string; created_at: string; asset_ids: string[]; after?: string; before?: string }

/** Validate the optional test sink: loopback http(s) only, no credentials in the URL. */
export function checkSinkUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("attention test sink: url must be absolute"); }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("attention test sink: http(s) only");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) throw new Error("attention test sink: loopback only (it exists for local testing, never as a remote destination)");
  if (u.username || u.password) throw new Error("attention test sink: credentials do not belong in the url");
  return u;
}

export class Attention {
  private readonly sinkUrl: string | null;
  constructor(private readonly store: Store, private readonly exploration: Exploration | null, private readonly sink: AttentionSinkConfig | null = null) {
    this.sinkUrl = sink ? checkSinkUrl(sink.url).toString() : null;
  }
  private get db() { return this.store.db; }
  private iso() { return this.store.now().toISOString(); }

  // ------------------------------------------------------------------ signals
  private openCases(projectId: string): CaseScope[] {
    return (this.db.prepare("SELECT id, scope, created_at FROM cases WHERE project_id = ? AND status = 'open' ORDER BY created_at, id").all(projectId) as { id: string; scope: string; created_at: string }[])
      .map((r) => ({ id: r.id, created_at: r.created_at, ...(JSON.parse(r.scope) as Omit<CaseScope, "id" | "created_at">) }));
  }
  private casesForAssets(cases: CaseScope[], assets: string[], at?: string) {
    return cases.filter((c) => c.asset_ids.some((a) => assets.includes(a)) && (!at || ((!c.after || at >= c.after) && (!c.before || at <= c.before))));
  }
  private sourceAssets(projectId: string, sourceId: string): string[] {
    const r = this.db.prepare("SELECT asset_ids FROM sources WHERE project_id = ? AND id = ?").get(projectId, sourceId) as { asset_ids: string } | undefined;
    return r ? JSON.parse(r.asset_ids) as string[] : [];
  }
  private linkedOpenCase(projectId: string, findingId: string): string | null {
    const r = this.db.prepare("SELECT ci.case_id AS id FROM case_items ci JOIN cases c ON c.id = ci.case_id WHERE ci.project_id = ? AND ci.kind = 'finding' AND ci.ref = ? AND ci.removed_at IS NULL AND c.status = 'open' ORDER BY ci.seq LIMIT 1").get(projectId, findingId) as { id: string } | undefined;
    return r?.id ?? null;
  }

  /** Signals derived from one change-stream record. */
  private fromOutbox(projectId: string, type: string, p: Record<string, unknown>, cases: CaseScope[], recordedAt: string): Signal[] {
    if (type === "event") {
      const id = String(p.id), assets = (p.asset_ids as string[] | undefined) ?? [], src = String(p.source_id ?? "");
      if (p.action === "sensor_unavailable" && src) {
        const affected = this.casesForAssets(cases, this.sourceAssets(projectId, src));
        return [{ kind: "observer_gap", dedupKey: `observer_gap:source:${src}`, caseId: affected[0]?.id ?? null, subject: { type: "source", id: src }, sourceRef: `event:${id}`, urgency: affected.length ? "high" : "medium", facts: { reason: "sensor reported unavailable", open_cases_affected: affected.map((c) => c.id) } }];
      }
      if (p.action === "sensor_restored") return [];
      // "new" evidence: records stored after the case was opened (older records were there when it was scoped)
      return this.casesForAssets(cases, assets, typeof p.occurred_at === "string" ? p.occurred_at : undefined).filter((c) => recordedAt >= c.created_at).map((c) => ({
        kind: "new_evidence" as const, dedupKey: `new_evidence:case:${c.id}`, caseId: c.id, subject: { type: "case", id: c.id }, sourceRef: `event:${id}`, urgency: "low" as const, facts: {} }));
    }
    if (type === "finding") {
      const id = String(p.id);
      const row = this.db.prepare("SELECT body FROM findings WHERE project_id = ? AND id = ?").get(projectId, id) as { body: string } | undefined;
      if (!row) return [];
      const f = JSON.parse(row.body) as { counterevidence_event_ids?: string[]; revision?: number };
      const counter = [...(f.counterevidence_event_ids ?? [])].sort();
      if (!counter.length) return [];
      const caseId = this.linkedOpenCase(projectId, id);
      return [{ kind: "contradiction", dedupKey: `contradiction:finding:${id}`, caseId, subject: { type: "finding", id }, sourceRef: `finding:${id}:counter:${sha256(counter.join(",")).slice(0, 16)}`, urgency: caseId ? "high" : "medium", facts: { counter_records: counter.length } }];
    }
    if (type === "source" && p.disabled === true) {
      const src = String(p.id), affected = this.casesForAssets(cases, this.sourceAssets(projectId, src));
      return [{ kind: "observer_gap", dedupKey: `observer_gap:source:${src}`, caseId: affected[0]?.id ?? null, subject: { type: "source", id: src }, sourceRef: `source:${src}:disabled:${String(p.config_revision)}`, urgency: affected.length ? "high" : "medium", facts: { reason: "observer disabled", open_cases_affected: affected.map((c) => c.id) } }];
    }
    if (type === "repair_candidates") {
      const caseId = String(p.case_id), status = String(p.status);
      return [{ kind: "incomplete_repair", dedupKey: `incomplete_repair:case:${caseId}`, caseId, subject: { type: "repair_set", id: String(p.id) }, sourceRef: `repair_set:${String(p.id)}`, urgency: status === "no_supported_repair" ? "medium" : "low",
        facts: { status, valid_candidates: Number(p.valid_candidates ?? 0), reason: status === "no_repair_needed" ? "nothing to repair in the model; confirm with an executed check" : "plan only: no candidate is verified by an executed local check (LP16) and none is approved" } }];
    }
    return [];
  }

  /** Bounded state scan: sources past their freshness expectation; repair sets whose baseline moved. */
  private scan(projectId: string, cases: CaseScope[]): Signal[] {
    const out: Signal[] = [];
    const now = this.store.now().getTime();
    const state = this.store.sourceState(projectId);
    for (const s of this.db.prepare("SELECT id, asset_ids, stale_after_seconds FROM sources WHERE project_id = ? AND disabled = 0 AND stale_after_seconds IS NOT NULL ORDER BY id LIMIT 500").all(projectId) as { id: string; asset_ids: string; stale_after_seconds: number }[]) {
      const last = state[s.id]?.last_received_at;
      if (!last || now - Date.parse(last) <= s.stale_after_seconds * 1000) continue;
      const affected = this.casesForAssets(cases, JSON.parse(s.asset_ids) as string[]);
      out.push({ kind: "stale_check", dedupKey: `stale_check:source:${s.id}`, caseId: affected[0]?.id ?? null, subject: { type: "source", id: s.id }, sourceRef: `source:${s.id}:last:${last}`, urgency: affected.length ? "medium" : "low",
        facts: { reason: "no record received within the declared freshness expectation", stale_after_seconds: s.stale_after_seconds, open_cases_affected: affected.map((c) => c.id) } });
    }
    if (this.exploration && cases.length) {
      let current: string | null = null;
      for (const c of cases) {
        const r = this.db.prepare("SELECT id, base_state_hash FROM repair_candidate_sets WHERE project_id = ? AND case_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(projectId, c.id) as { id: string; base_state_hash: string } | undefined;
        if (!r) continue;
        current ??= this.exploration.baseline(projectId).state_hash;
        if (r.base_state_hash === current) continue;
        out.push({ kind: "stale_check", dedupKey: `stale_check:repair:${c.id}`, caseId: c.id, subject: { type: "repair_set", id: r.id }, sourceRef: `repair_set:${r.id}:base:${current.slice(0, 16)}`, urgency: "medium",
          facts: { reason: "the baseline changed since these repair candidates were generated; their plans no longer bind" } });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ queue writes
  private log(projectId: string, itemId: string, type: "raised" | "occurrence" | "reopened" | "acknowledged", sourceRef: string | null, urgency: string | null, actor: string | null) {
    const r = this.db.prepare("INSERT INTO attention_log (project_id, item_id, type, source_ref, urgency, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(projectId, itemId, type, sourceRef, urgency, actor, this.iso());
    return Number(r.lastInsertRowid);
  }
  private item(projectId: string, id: string) { return this.db.prepare("SELECT * FROM attention_items WHERE project_id = ? AND id = ?").get(projectId, id) as unknown as ItemRow | undefined; }

  private boundedUrgency(projectId: string, s: Signal): { urgency: Urgency; note: string | null } {
    const ceiling = URGENCY_CEILING[s.kind];
    let u: Urgency = URGENCY.indexOf(s.urgency) > URGENCY.indexOf(ceiling) ? ceiling : s.urgency;
    let note: string | null = s.urgency !== u ? `capped at ${ceiling}, the ceiling for ${s.kind}` : null;
    if (u === "high") {
      const since = new Date(this.store.now().getTime() - 3600_000).toISOString();
      const n = (this.db.prepare("SELECT COUNT(*) AS n FROM attention_log WHERE project_id = ? AND type IN ('raised','reopened') AND urgency = 'high' AND at > ?").get(projectId, since) as { n: number }).n;
      if (n >= ATTENTION_LIMITS.urgent_per_hour) { u = "medium"; note = `recorded as medium: at most ${ATTENTION_LIMITS.urgent_per_hour} items per project become high in an hour`; }
    }
    return { urgency: u, note };
  }

  /** Apply one signal. Returns what happened, for counting and the optional sink. */
  private raise(projectId: string, s: Signal): "raised" | "occurrence" | "reopened" | "repeat" {
    const at = this.iso();
    const existing = this.db.prepare("SELECT * FROM attention_items WHERE project_id = ? AND dedup_key = ?").get(projectId, s.dedupKey) as unknown as ItemRow | undefined;
    if (!existing) {
      const id = `att_${sha256(`${projectId}:${s.dedupKey}`).slice(0, 16)}`;
      const { urgency, note } = this.boundedUrgency(projectId, s);
      this.db.prepare("INSERT INTO attention_items (id, project_id, dedup_key, kind, urgency, urgency_note, case_id, subject_type, subject_id, facts, state, occurrences, repeats, first_at, last_at, last_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 1, 0, ?, ?, 0)")
        .run(id, projectId, s.dedupKey, s.kind, urgency, note, s.caseId, s.subject.type, s.subject.id, JSON.stringify(s.facts), at, at);
      const seq = this.log(projectId, id, "raised", s.sourceRef, urgency, null);
      this.db.prepare("UPDATE attention_items SET last_seq = ? WHERE id = ?").run(seq, id);
      return "raised";
    }
    const seen = this.db.prepare("SELECT 1 FROM attention_log WHERE item_id = ? AND source_ref = ? LIMIT 1").get(existing.id, s.sourceRef);
    if (seen) { this.db.prepare("UPDATE attention_items SET repeats = repeats + 1 WHERE id = ?").run(existing.id); return "repeat"; }
    const reopen = existing.state === "acknowledged";
    // a reopened item is re-bounded (it can be high again only within the hourly budget); repeats never raise urgency
    const { urgency, note } = reopen ? this.boundedUrgency(projectId, { ...s, urgency: URGENCY.indexOf(s.urgency) > URGENCY.indexOf(existing.urgency) ? existing.urgency : s.urgency }) : { urgency: existing.urgency, note: existing.urgency_note };
    const seq = this.log(projectId, existing.id, reopen ? "reopened" : "occurrence", s.sourceRef, reopen ? urgency : null, null);
    this.db.prepare("UPDATE attention_items SET occurrences = occurrences + 1, last_at = ?, last_seq = ?, state = 'open', urgency = ?, urgency_note = ?, facts = ?, case_id = COALESCE(case_id, ?) WHERE id = ?")
      .run(at, seq, urgency, note, JSON.stringify(s.facts), s.caseId, existing.id);
    return reopen ? "reopened" : "occurrence";
  }

  /**
   * Bring the queue up to date: read the change stream from the durable cursor (bounded), then the state scan.
   * Idempotent; safe to call on every queue read.
   */
  async sync(projectId: string) {
    const counts = { consumed: 0, raised: 0, occurrence: 0, reopened: 0, repeat: 0 };
    const touched = new Set<string>();
    let behind = false;
    this.store.transaction(() => {
      const cases = this.openCases(projectId);
      let cursor = (this.db.prepare("SELECT outbox_seq FROM attention_cursor WHERE project_id = ?").get(projectId) as { outbox_seq: number } | undefined)?.outbox_seq ?? 0;
      for (let b = 0; b < ATTENTION_LIMITS.max_batches; b++) {
        const rows = (this.db.prepare("SELECT seq, type, payload, created_at FROM outbox WHERE project_id = ? AND seq > ? ORDER BY seq LIMIT ?").all(projectId, cursor, ATTENTION_LIMITS.batch) as { seq: number; type: string; payload: string; created_at: string }[])
          .map((r) => ({ seq: Number(r.seq), type: r.type, payload: JSON.parse(r.payload) as unknown, created_at: r.created_at }));
        for (const r of rows) {
          counts.consumed++;
          for (const s of this.fromOutbox(projectId, r.type, (r.payload ?? {}) as Record<string, unknown>, cases, r.created_at)) { const o = this.raise(projectId, s); counts[o]++; if (o !== "repeat") touched.add(s.dedupKey); }
          cursor = r.seq;
        }
        if (rows.length < ATTENTION_LIMITS.batch) break;
        if (b === ATTENTION_LIMITS.max_batches - 1) behind = true;
      }
      this.db.prepare("INSERT INTO attention_cursor (project_id, outbox_seq, updated_at) VALUES (?, ?, ?) ON CONFLICT (project_id) DO UPDATE SET outbox_seq = excluded.outbox_seq, updated_at = excluded.updated_at").run(projectId, cursor, this.iso());
      for (const s of this.scan(projectId, cases)) { const o = this.raise(projectId, s); counts[o]++; if (o !== "repeat") touched.add(s.dedupKey); }
    });
    const sink = await this.toSink(projectId, touched);
    return { ...counts, behind, ...(sink ? { test_sink: sink } : {}) };
  }

  private async toSink(projectId: string, keys: Set<string>) {
    if (!this.sinkUrl || !keys.size) return null;
    const fetchImpl = this.sink?.fetch ?? ((u: string, i: Parameters<SinkFetch>[1]) => fetch(u, i));
    let sent = 0, failed = 0;
    for (const k of keys) {
      const row = this.db.prepare("SELECT * FROM attention_items WHERE project_id = ? AND dedup_key = ?").get(projectId, k) as unknown as ItemRow | undefined;
      if (!row || row.state !== "open") continue;
      try {
        const r = await fetchImpl(this.sinkUrl, { method: "POST", headers: { "content-type": "application/json", "x-dk-test-sink": "local-only" }, body: JSON.stringify(this.view(row)), signal: AbortSignal.timeout(2000) });
        if (r.status >= 200 && r.status < 300) sent++; else failed++;
      } catch { failed++; }
    }
    return { sent, failed, note: "local loopback test sink only; not a notification destination" };
  }

  // ------------------------------------------------------------------ reads
  /** The minimized view: kinds, ids, counts and fixed template text only. */
  view(r: ItemRow) {
    const facts = JSON.parse(r.facts) as Record<string, unknown>;
    const refs = (this.db.prepare("SELECT source_ref FROM attention_log WHERE item_id = ? AND source_ref IS NOT NULL ORDER BY seq DESC LIMIT ?").all(r.id, ATTENTION_LIMITS.refs_shown) as { source_ref: string }[]).map((x) => x.source_ref);
    const newSince = r.state === "open" && r.acknowledged_occurrences !== null ? r.occurrences - r.acknowledged_occurrences : null;
    const n = r.occurrences;
    const summary: Record<AttentionKind, string> = {
      new_evidence: `${n} new record${n === 1 ? "" : "s"} on assets in case ${r.case_id}'s scope.`,
      contradiction: `Finding ${r.subject_id} has ${String(facts.counter_records ?? "")} counter record(s)${r.case_id ? `; it is linked to case ${r.case_id}` : ""}.`,
      incomplete_repair: `Repair candidates ${r.subject_id} for case ${r.case_id}: ${String(facts.status ?? "").replace(/_/g, " ")}; ${String(facts.reason ?? "")}.`,
      observer_gap: `Observer ${r.subject_id}: ${String(facts.reason ?? "")}${Array.isArray(facts.open_cases_affected) && facts.open_cases_affected.length ? `; covers assets in ${facts.open_cases_affected.length} open case(s)` : ""}.`,
      stale_check: r.subject_type === "repair_set" ? `Repair candidates ${r.subject_id} for case ${r.case_id}: ${String(facts.reason ?? "")}.` : `Source ${r.subject_id}: ${String(facts.reason ?? "")} (${String(facts.stale_after_seconds ?? "")} s).`,
    };
    return {
      schema: ATTENTION_ITEM, id: r.id, project_id: r.project_id, kind: r.kind, urgency: r.urgency, urgency_note: r.urgency_note, state: r.state,
      case_id: r.case_id, subject: { type: r.subject_type, id: r.subject_id }, summary: summary[r.kind],
      occurrences: r.occurrences, new_since_acknowledged: newSince, repeats: r.repeats, first_at: r.first_at, last_at: r.last_at,
      acknowledged_at: r.acknowledged_at, acknowledged_by: r.acknowledged_by, last_seq: r.last_seq, recent_refs: refs,
    };
  }

  async queue(projectId: string, q: { state?: string } = {}) {
    const synced = await this.sync(projectId);
    const state = q.state === "all" ? null : q.state === "acknowledged" ? "acknowledged" : "open";
    const rows = (this.db.prepare(`SELECT * FROM attention_items WHERE project_id = ? ${state ? "AND state = ?" : ""} ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, last_seq DESC LIMIT 200`).all(...(state ? [projectId, state] : [projectId])) as unknown as ItemRow[]);
    const counts = Object.fromEntries((this.db.prepare("SELECT state, COUNT(*) AS n FROM attention_items WHERE project_id = ? GROUP BY state").all(projectId) as { state: string; n: number }[]).map((r) => [r.state, r.n]));
    const head = (this.db.prepare("SELECT MAX(seq) AS s FROM attention_log WHERE project_id = ?").get(projectId) as { s: number | null }).s ?? 0;
    return {
      schema: ATTENTION_QUEUE, project_id: projectId, items: rows.map((r) => this.view(r)), counts: { open: counts.open ?? 0, acknowledged: counts.acknowledged ?? 0 }, head_seq: head,
      sync: synced, remote_delivery: "none: the attention queue never sends notifications; remote destinations are separate (R03.5) and not used here",
      rules: { kinds: ATTENTION_KINDS, urgency_ceiling: URGENCY_CEILING, urgent_per_hour: ATTENTION_LIMITS.urgent_per_hour, acknowledgement: "Acknowledging an item never closes or changes a case or a finding; a new distinct record reopens it." },
    };
  }

  /** Replay: every queue change after `after` (exclusive), oldest first. */
  replay(projectId: string, after: number, limit: number) {
    const rows = this.db.prepare("SELECT l.seq, l.item_id, l.type, l.source_ref, l.urgency, l.at, i.kind, i.case_id FROM attention_log l JOIN attention_items i ON i.id = l.item_id WHERE l.project_id = ? AND l.seq > ? ORDER BY l.seq LIMIT ?").all(projectId, after, limit) as Record<string, unknown>[];
    const head = (this.db.prepare("SELECT MAX(seq) AS s FROM attention_log WHERE project_id = ?").get(projectId) as { s: number | null }).s ?? 0;
    return { schema: "dk.attention_replay.v1", project_id: projectId, after, changes: rows, next: rows.length ? Number(rows.at(-1)!.seq) : after, head_seq: head };
  }

  acknowledge(projectId: string, id: string, body: Record<string, unknown>, actor: string) {
    const extra = Object.keys(body).filter((k) => k !== "expected_seq");
    if (extra.length) throw new HttpError(422, `acknowledgement takes no ${extra.join(", ")}: it only marks the item seen and never closes or changes a case or finding`);
    const r = this.item(projectId, id);
    if (!r) throw new HttpError(404, "attention item not found");
    if (body.expected_seq !== undefined && body.expected_seq !== r.last_seq) throw new HttpError(409, "the item changed since you read it", [`current last_seq ${r.last_seq}`], { current: { last_seq: r.last_seq } });
    if (r.state === "acknowledged") return { item: this.view(r), changed: false, closes: "nothing" as const };
    this.store.transaction(() => {
      const seq = this.log(projectId, id, "acknowledged", null, null, actor);
      this.db.prepare("UPDATE attention_items SET state = 'acknowledged', acknowledged_at = ?, acknowledged_by = ?, acknowledged_occurrences = occurrences, last_seq = ? WHERE id = ?").run(this.iso(), actor, seq, id);
    });
    this.store.audit(actor, "attention.acknowledge", projectId, id, { kind: r.kind });
    return { item: this.view(this.item(projectId, id)!), changed: true, closes: "nothing" as const };
  }
}

export function registerAttentionRoutes(app: FastifyInstance, d: { store: Store; exploration: Exploration | null; sink?: AttentionSinkConfig | null; authed: (minRole?: Role) => (req: FastifyRequest) => Promise<void>; who: (req: FastifyRequest) => string }) {
  const a = new Attention(d.store, d.exploration, d.sink ?? null);
  const P = (req: FastifyRequest) => (req.params as { p: string }).p;
  const body = (req: FastifyRequest) => ((req.body && typeof req.body === "object" && !Array.isArray(req.body)) ? req.body : {}) as Record<string, unknown>;
  app.get("/api/projects/:p/attention", { preHandler: d.authed() }, async (req) => a.queue(d.store.require(req.principal!, P(req), "viewer").id, req.query as { state?: string }));
  app.post("/api/projects/:p/attention/sync", { preHandler: d.authed() }, async (req) => a.sync(d.store.require(req.principal!, P(req), "viewer").id));
  app.get("/api/projects/:p/attention/replay", { preHandler: d.authed() }, async (req) => {
    const q = req.query as { after?: string; limit?: string };
    const after = Number(q.after ?? 0), limit = Math.min(ATTENTION_LIMITS.log_page, Math.max(1, Number(q.limit ?? 100) || 100));
    if (!Number.isInteger(after) || after < 0) throw new HttpError(400, "after must be a non-negative integer sequence");
    return a.replay(d.store.require(req.principal!, P(req), "viewer").id, after, limit);
  });
  app.post("/api/projects/:p/attention/:id/ack", { preHandler: d.authed("analyst") }, async (req) => a.acknowledge(d.store.require(req.principal!, P(req), "analyst").id, (req.params as { id: string }).id, body(req), d.who(req)));
  return a;
}
