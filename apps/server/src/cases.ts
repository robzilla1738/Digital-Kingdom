import { provenanceOf } from "./provenance.ts";
import { canonicalJson } from "@dk/contracts";
import { hmac, sha256 } from "./security.ts";
import { HttpError, type Store } from "./store.ts";
import { bundleEvents, createBundle, getBundle, pinBundle } from "./bundles.ts";

/**
 * Durable cases (roadmap R03.1).
 *
 * A case is the analyst's investigation, separate from detector findings: its own identity, scope, owner,
 * questions, closure criteria and a timeline of linked findings, independent events, pinned bundles and notes.
 *
 * - A case may hold an event no rule ever turned into a finding.
 * - Linking a finding pins an immutable evidence bundle for the revision linked; later revisions do not alter it.
 * - Findings closing never closes a case. Closing a case needs every question answered or explicitly accepted
 *   as unresolved, the closure criteria addressed, and the current case version.
 * - Every change to title, scope, owner, status or a question is versioned (precondition `expected_version`) and
 *   recorded with actor, before and after. Items are append-only; removal is a recorded tombstone.
 */
const STATUSES = ["open", "resolved", "closed"] as const;
type Status = (typeof STATUSES)[number];
interface CaseRow { id: string; project_id: string; title: string; scope: string; owner: string; status: Status; closure_criteria: string; closure: string | null; version: number; created_at: string; created_by: string; updated_at: string }
interface Scope { question: string; asset_ids: string[]; after?: string; before?: string }

const isoOk = (v: unknown) => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) && /T.*(Z|[+-]\d{2}:?\d{2})$/.test(v);
const str = (v: unknown, k: string, max: number, required = true) => {
  if (v === undefined && !required) return undefined;
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new HttpError(400, `${k} must be a non-empty string of at most ${max} characters`);
  return v.trim();
};

export class Cases {
  constructor(private readonly store: Store) {}
  private get db() { return this.store.db; }
  private now() { return this.store.now().toISOString(); }

  private parseScope(projectId: string, v: unknown): Scope {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "scope must be an object with question and asset_ids");
    const s = v as Record<string, unknown>;
    const question = str(s.question, "scope.question", 1000)!;
    const ids = s.asset_ids ?? [];
    if (!Array.isArray(ids) || ids.length > 200 || ids.some((x) => typeof x !== "string")) throw new HttpError(400, "scope.asset_ids must be a list of asset ids");
    const graph = this.store.getGraph(projectId);
    const unknown = (ids as string[]).filter((id) => !graph?.assets.some((a) => a.id === id));
    if (unknown.length) throw new HttpError(422, `unknown asset ids: ${unknown.join(", ")}`);
    if (s.after !== undefined && !isoOk(s.after)) throw new HttpError(400, "scope.after must be ISO 8601 with an offset");
    if (s.before !== undefined && !isoOk(s.before)) throw new HttpError(400, "scope.before must be ISO 8601 with an offset");
    if (s.after && s.before && Date.parse(s.before as string) <= Date.parse(s.after as string)) throw new HttpError(400, "scope.before must be later than scope.after");
    return { question, asset_ids: ids as string[], ...(s.after ? { after: new Date(Date.parse(s.after as string)).toISOString() } : {}), ...(s.before ? { before: new Date(Date.parse(s.before as string)).toISOString() } : {}) };
  }

  create(projectId: string, body: Record<string, unknown>, actor: string) {
    const title = str(body.title, "title", 200)!;
    const scope = this.parseScope(projectId, body.scope);
    const criteria = str(body.closure_criteria, "closure_criteria", 2000)!;
    const owner = str(body.owner, "owner", 200, false) ?? actor;
    const id = "case_" + sha256(`${projectId}:${title}:${this.now()}:${Math.random()}`).slice(0, 16);
    const at = this.now();
    this.db.prepare("INSERT INTO cases (id, project_id, title, scope, owner, status, closure_criteria, closure, version, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, NULL, 1, ?, ?, ?)")
      .run(id, projectId, title, canonicalJson(scope), owner, criteria, at, actor, at);
    this.recordChange(projectId, id, 1, actor, null, { title, scope, owner, status: "open", closure_criteria: criteria }, "created");
    this.store.audit(actor, "case.create", projectId, id, { title });
    this.store.emit(projectId, "case", { id, version: 1 });
    return this.get(projectId, id);
  }

  list(projectId: string) {
    return (this.db.prepare("SELECT * FROM cases WHERE project_id = ? ORDER BY updated_at DESC LIMIT 500").all(projectId) as unknown as CaseRow[]).map((r) => ({
      id: r.id, title: r.title, owner: r.owner, status: r.status, version: r.version, updated_at: r.updated_at,
      open_questions: (this.db.prepare("SELECT COUNT(*) AS n FROM case_items WHERE case_id = ? AND kind = 'question' AND removed_at IS NULL AND json_extract(body, '$.status') = 'open'").get(r.id) as { n: number }).n,
    }));
  }

  private row(projectId: string, id: string): CaseRow {
    const r = this.db.prepare("SELECT * FROM cases WHERE project_id = ? AND id = ?").get(projectId, id) as unknown as CaseRow | undefined;
    if (!r) throw new HttpError(404, "case not found");
    return r;
  }

  /** R05.3 incremental delivery: cases changed strictly after (updated_at, id), oldest first. */
  changes(projectId: string, since: { at: string; id: string } | null, limit = 50) {
    const rows = (since
      ? this.db.prepare("SELECT * FROM cases WHERE project_id = ? AND (updated_at > ? OR (updated_at = ? AND id > ?)) ORDER BY updated_at, id LIMIT ?").all(projectId, since.at, since.at, since.id, limit + 1)
      : this.db.prepare("SELECT * FROM cases WHERE project_id = ? ORDER BY updated_at, id LIMIT ?").all(projectId, limit + 1)) as unknown as CaseRow[];
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return { changes: page.map((r) => ({ id: r.id, title: r.title, status: r.status, version: r.version, updated_at: r.updated_at })), more: rows.length > limit, next_since: last ? Buffer.from(JSON.stringify({ at: last.updated_at, id: last.id })).toString("base64url") : (since ? Buffer.from(JSON.stringify(since)).toString("base64url") : null) };
  }

  get(projectId: string, id: string) {
    const r = this.row(projectId, id);
    const items = (this.db.prepare("SELECT * FROM case_items WHERE case_id = ? ORDER BY seq").all(id) as { seq: number; item_id: string; kind: string; ref: string; body: string; added_by: string; added_at: string; removed_at: string | null; removed_by: string | null; removal_reason: string | null }[])
      .map((i): { item_id: string; kind: string; ref: string; [k: string]: unknown } => ({ ...JSON.parse(i.body) as Record<string, unknown>, item_id: i.item_id, kind: i.kind, ref: i.ref, added_by: i.added_by, added_at: i.added_at, ...(i.removed_at ? { removed: { at: i.removed_at, by: i.removed_by, reason: i.removal_reason } } : {}) }));
    const live = items.filter((i) => !("removed" in i));
    // Linked findings show their CURRENT detector state beside the case, never driving it.
    const findings = live.filter((i) => i.kind === "finding").map((i) => {
      const f = this.store.listFindings(projectId).find((x) => x.id === i.ref);
      return { finding_id: i.ref, linked_revision: i.revision, current_revision: f?.revision ?? null, current_lifecycle: f?.lifecycle ?? "missing", bundle_id: i.bundle_id };
    });
    return {
      id: r.id, project_id: r.project_id, title: r.title, scope: JSON.parse(r.scope) as Scope, owner: r.owner, status: r.status,
      closure_criteria: r.closure_criteria, closure: r.closure ? JSON.parse(r.closure) : null, version: r.version,
      created_at: r.created_at, created_by: r.created_by, updated_at: r.updated_at,
      items, linked_findings: findings,
      history: this.store.stateChanges(projectId, "case", id),
      notes: ["A case's status is independent of its findings: a closed finding does not close the case."],
    };
  }

  private recordChange(projectId: string, id: string, version: number, actor: string, before: unknown, after: unknown, reason: string) {
    this.db.prepare("INSERT INTO state_changes (project_id, subject_type, subject_id, version, actor, before, after, reason, at) VALUES (?, 'case', ?, ?, ?, ?, ?, ?, ?)")
      .run(projectId, id, version, actor, canonicalJson(before), canonicalJson(after), reason.slice(0, 300), this.now());
  }

  private checkVersion(r: CaseRow, expected: unknown) {
    if (typeof expected !== "number" || !Number.isInteger(expected)) throw new HttpError(428, "expected_version is required", [`current version is ${r.version}`], { current: { version: r.version, status: r.status } });
    if (expected !== r.version) throw new HttpError(409, "the case changed since you loaded it", ["review the changes since your version, then resubmit"], { current: { version: r.version, status: r.status }, changes_since: this.store.stateChanges(r.project_id, "case", r.id).filter((c) => c.version > expected) });
  }

  private bump(r: CaseRow, actor: string, before: unknown, after: unknown, reason: string) {
    const v = r.version + 1;
    this.db.prepare("UPDATE cases SET version = ?, updated_at = ? WHERE id = ?").run(v, this.now(), r.id);
    this.recordChange(r.project_id, r.id, v, actor, before, after, reason);
    this.store.emit(r.project_id, "case", { id: r.id, version: v });
    return v;
  }

  /** Change title, scope, owner or closure criteria. Closed cases must be reopened first. */
  update(projectId: string, id: string, body: Record<string, unknown>, actor: string) {
    return this.store.transaction(() => {
      const r = this.row(projectId, id);
      this.checkVersion(r, body.expected_version);
      if (r.status === "closed") throw new HttpError(409, "the case is closed; reopen it before editing");
      const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
      if (body.title !== undefined) { before.title = r.title; after.title = str(body.title, "title", 200); this.db.prepare("UPDATE cases SET title = ? WHERE id = ?").run(after.title as string, id); }
      if (body.scope !== undefined) { before.scope = JSON.parse(r.scope); after.scope = this.parseScope(projectId, body.scope); this.db.prepare("UPDATE cases SET scope = ? WHERE id = ?").run(canonicalJson(after.scope), id); }
      if (body.owner !== undefined) { before.owner = r.owner; after.owner = str(body.owner, "owner", 200); this.db.prepare("UPDATE cases SET owner = ? WHERE id = ?").run(after.owner as string, id); }
      if (body.closure_criteria !== undefined) { before.closure_criteria = r.closure_criteria; after.closure_criteria = str(body.closure_criteria, "closure_criteria", 2000); this.db.prepare("UPDATE cases SET closure_criteria = ? WHERE id = ?").run(after.closure_criteria as string, id); }
      if (!Object.keys(after).length) throw new HttpError(400, "nothing to change");
      this.bump(r, actor, before, after, typeof body.reason === "string" ? body.reason : "updated");
      this.store.audit(actor, "case.update", projectId, id, { fields: Object.keys(after) });
      return this.get(projectId, id);
    });
  }

  /** Append a finding (pins a bundle), an event (with or without any finding), a question, a hypothesis or a note. */
  addItem(projectId: string, id: string, body: Record<string, unknown>, actor: string) {
    return this.store.transaction(() => {
      const r = this.row(projectId, id);
      this.checkVersion(r, body.expected_version);
      if (r.status === "closed") throw new HttpError(409, "the case is closed; reopen it before adding items");
      const kind = body.kind;
      let ref: string; let payload: Record<string, unknown>;
      if (kind === "finding") {
        ref = str(body.ref, "ref", 200)!;
        const revision = body.revision === undefined ? undefined : Number(body.revision);
        if (revision !== undefined && (!Number.isInteger(revision) || revision < 1)) throw new HttpError(400, "revision must be a positive integer");
        const b = createBundle(this.store, projectId, ref, actor, revision !== undefined ? { revision } : {});
        pinBundle(this.store, projectId, b.bundle_id, actor, `linked to ${id}`);
        payload = { revision: b.finding_revision, bundle_id: b.bundle_id, bundle_digest: b.bundle_digest };
      } else if (kind === "event") {
        ref = str(body.ref, "ref", 200)!;
        const [e] = this.store.eventsByIds(projectId, [ref]);
        if (!e) throw new HttpError(404, "event not found in this project");
        payload = { event_digest: sha256(canonicalJson(e)), occurred_at: e.occurred_at, action: e.action, outcome: e.outcome, produced_finding: this.store.listFindings(projectId).some((f) => f.event_ids.includes(ref) || f.counterevidence_event_ids.includes(ref)), why: str(body.why, "why", 1000, false) ?? null };
      } else if (kind === "question" || kind === "hypothesis") {
        ref = "q_" + sha256(`${id}:${Math.random()}:${this.now()}`).slice(0, 10);
        payload = { text: str(body.text, "text", 1000), status: "open", answer: null };
      } else if (kind === "note") {
        ref = "n_" + sha256(`${id}:${Math.random()}:${this.now()}`).slice(0, 10);
        payload = { text: str(body.text, "text", 4000) };
      } else throw new HttpError(400, "kind must be finding, event, question, hypothesis or note");
      if ((kind === "finding" || kind === "event") && this.db.prepare("SELECT 1 FROM case_items WHERE case_id = ? AND kind = ? AND ref = ? AND removed_at IS NULL").get(id, kind, ref)) throw new HttpError(409, `${kind} ${ref} is already linked`);
      const itemId = "ci_" + sha256(`${id}:${kind}:${ref}:${this.now()}:${Math.random()}`).slice(0, 12);
      this.db.prepare("INSERT INTO case_items (case_id, project_id, item_id, kind, ref, body, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, projectId, itemId, kind, ref, canonicalJson(payload), actor, this.now());
      this.bump(r, actor, null, { added: { item_id: itemId, kind, ref } }, `added ${kind}`);
      this.store.audit(actor, "case.item_added", projectId, id, { kind, ref });
      return this.get(projectId, id);
    });
  }

  /** Answer, reopen or accept-as-unresolved a question or hypothesis. */
  setQuestion(projectId: string, id: string, itemId: string, body: Record<string, unknown>, actor: string, principalType: "human" | "service" = "human") {
    return this.store.transaction(() => {
      // LP12: an agent (service principal) may propose, never settle. A question or hypothesis is resolved only by a person.
      if (principalType === "service" && body.status !== "open") throw new HttpError(403, "agents cannot answer or settle a case question; store a conclusion proposal instead and let a person record the answer");
      const r = this.row(projectId, id);
      this.checkVersion(r, body.expected_version);
      if (r.status === "closed") throw new HttpError(409, "the case is closed; reopen it first");
      const it = this.db.prepare("SELECT body, kind FROM case_items WHERE case_id = ? AND item_id = ? AND removed_at IS NULL").get(id, itemId) as { body: string; kind: string } | undefined;
      if (!it || (it.kind !== "question" && it.kind !== "hypothesis")) throw new HttpError(404, "question not found");
      const status = body.status;
      if (!["open", "answered", "accepted_unresolved", "supported", "refuted"].includes(status as string)) throw new HttpError(400, "status must be open, answered, accepted_unresolved (or supported/refuted for a hypothesis)");
      if ((status === "supported" || status === "refuted") && it.kind !== "hypothesis") throw new HttpError(400, "supported/refuted apply to hypotheses");
      const answer = status === "open" ? null : str(body.answer, "answer", 2000);
      const before = JSON.parse(it.body) as Record<string, unknown>;
      const after = { ...before, status, answer };
      this.db.prepare("UPDATE case_items SET body = ? WHERE case_id = ? AND item_id = ?").run(canonicalJson(after), id, itemId);
      this.bump(r, actor, { item_id: itemId, status: before.status, answer: before.answer }, { item_id: itemId, status, answer }, `question ${status}`);
      return this.get(projectId, id);
    });
  }

  removeItem(projectId: string, id: string, itemId: string, body: Record<string, unknown>, actor: string, principalType: "human" | "service" = "human") {
    return this.store.transaction(() => {
      const r = this.row(projectId, id);
      this.checkVersion(r, body.expected_version);
      if (r.status === "closed") throw new HttpError(409, "the case is closed; reopen it first");
      if (principalType === "service") {
        // LP12: an agent may withdraw only what it added itself; it can never remove a person's note, question or link.
        const owner = this.db.prepare("SELECT added_by FROM case_items WHERE case_id = ? AND item_id = ? AND removed_at IS NULL").get(id, itemId) as { added_by: string } | undefined;
        if (owner && owner.added_by !== actor) throw new HttpError(403, "agents cannot remove an item someone else added");
      }
      const reason = str(body.reason, "reason", 500)!;
      const res = this.db.prepare("UPDATE case_items SET removed_at = ?, removed_by = ?, removal_reason = ? WHERE case_id = ? AND item_id = ? AND removed_at IS NULL").run(this.now(), actor, reason, id, itemId);
      if (!Number(res.changes)) throw new HttpError(404, "item not found");
      this.bump(r, actor, { item_id: itemId }, { removed: itemId }, reason);
      return this.get(projectId, id);
    });
  }

  /** open -> resolved -> closed, or back to open. Closing checks questions and needs a closure statement. */
  setStatus(projectId: string, id: string, body: Record<string, unknown>, actor: string, role: string, principalType: "human" | "service" = "human") {
    return this.store.transaction(() => {
      if (principalType === "service" && (body.status === "closed" || body.status === "resolved")) throw new HttpError(403, "agents cannot resolve or close a case; a person decides closure");
      const r = this.row(projectId, id);
      this.checkVersion(r, body.expected_version);
      const status = body.status as Status;
      if (!STATUSES.includes(status)) throw new HttpError(400, "status must be open, resolved or closed");
      if (status === r.status) throw new HttpError(409, `the case is already ${status}`);
      let closure: Record<string, unknown> | null = null;
      if (status === "closed" || status === "resolved") {
        if (status === "closed" && r.owner !== actor && role !== "admin") throw new HttpError(403, "only the case owner or an administrator can close a case");
        const open = (this.db.prepare("SELECT item_id, body FROM case_items WHERE case_id = ? AND kind IN ('question','hypothesis') AND removed_at IS NULL").all(id) as { item_id: string; body: string }[]).filter((q) => (JSON.parse(q.body) as { status: string }).status === "open");
        if (open.length) throw new HttpError(409, `${open.length} question(s) are still open; answer them or accept them as unresolved with a reason`, open.map((q) => q.item_id));
        closure = { statement: str(body.statement, "statement (how the closure criteria were met)", 4000), criteria: r.closure_criteria, by: actor, at: this.now() };
      }
      this.db.prepare("UPDATE cases SET status = ?, closure = ? WHERE id = ?").run(status, closure ? canonicalJson(closure) : null, id);
      this.bump(r, actor, { status: r.status }, { status, ...(closure ? { closure } : {}) }, `status ${status}`);
      this.store.audit(actor, `case.${status}`, projectId, id, {});
      return this.get(projectId, id);
    });
  }

  /**
   * Signed case export (same envelope as finding exports, verifiable with POST /api/verify-export). Every linked
   * finding is exported through its pinned bundle; records that are no longer available are listed, not dropped.
   */
  export(projectId: string, id: string, actor: string, secret: string) {
    const c = this.get(projectId, id);
    const bundles: Record<string, unknown>[] = [];
    const unavailable: { item: string; ref: string; reason: string }[] = [];
    for (const f of c.items.filter((i) => i.kind === "finding" && !("removed" in i))) {
      const bid = (f as { bundle_id?: string }).bundle_id!;
      try {
        const meta = getBundle(this.store, projectId, bid);
        const events: unknown[] = []; const missing: unknown[] = []; const changed: string[] = [];
        for (let off = 0; ; off += 500) {
          const p = bundleEvents(this.store, projectId, bid, off, 500);
          events.push(...p.events); missing.push(...p.missing_events); changed.push(...p.changed_event_ids);
          if (!p.page.has_more) break;
        }
        bundles.push({ ...meta, events, missing_events: missing, changed_event_ids: changed });
        for (const m of missing as { event_id: string; reason: string }[]) unavailable.push({ item: f.item_id, ref: m.event_id, reason: m.reason });
        for (const ch of changed) unavailable.push({ item: f.item_id, ref: ch, reason: "record no longer matches the digest pinned in the bundle" });
      } catch (e) { unavailable.push({ item: f.item_id, ref: bid, reason: (e as Error).message }); }
    }
    const indep = c.items.filter((i) => i.kind === "event" && !("removed" in i));
    const stored = new Map(this.store.eventsByIds(projectId, indep.map((i) => i.ref)).map((e) => [e.id, e]));
    const events = indep.flatMap((i) => {
      const e = stored.get(i.ref);
      if (!e) { unavailable.push({ item: i.item_id, ref: i.ref, reason: "event deleted or purged since it was linked" }); return []; }
      if (sha256(canonicalJson(e)) !== (i as { event_digest?: string }).event_digest) { unavailable.push({ item: i.item_id, ref: i.ref, reason: "event no longer matches the digest recorded when it was linked" }); return []; }
      return [e];
    });
    const sections = { case: { ...c, history: undefined }, history: c.history, bundles, independent_events: events, unavailable };
    const manifest = {
      format: "digital-kingdom-case/2", kind: "case", project_id: projectId, provenance: provenanceOf(this.store.getProject(projectId)!), case_id: id, case_version: c.version,
      exported_at: this.now(), exported_by: actor, complete: unavailable.length === 0,
      bundle_digests: Object.fromEntries(bundles.map((b) => [b.bundle_id as string, b.bundle_digest as string])),
      section_sha256: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, sha256(canonicalJson(v))])),
      guarantee: "Tamper detection relative to this server's export record. Not proof of completeness, source truth, or admissibility. Unavailable records are listed in sections.unavailable.",
    };
    this.store.audit(actor, "case.export", projectId, id, { bundles: bundles.length, unavailable: unavailable.length });
    return { manifest, signature: hmac(secret, canonicalJson(manifest)), sections };
  }
}

