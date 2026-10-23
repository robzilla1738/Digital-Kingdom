import { canonicalJson, type Finding, type SecurityEvent } from "@dk/contracts";
import { sha256 } from "./security.ts";
import { HttpError, type Store } from "./store.ts";

/**
 * Immutable investigation bundles (roadmap R01.3).
 *
 * A bundle binds one finding revision to the exact event references it cited, the digest of each record as it
 * was stored when the bundle was made, the graph revision, every source's configuration revision and the
 * ruleset. Its id is derived from that content, so the same pin is the same bundle and any change is a new one.
 * Pages are served from the bundle's own reference list: new evidence arriving later can never change an
 * already pinned comparison. A record that is later missing or no longer matches its digest is reported as
 * such, never silently dropped into an "empty but complete" answer.
 *
 * Bundles expire after `bundleTtlDays` (default 30) unless pinned to a case. An expired bundle returns 410 with
 * its metadata. Every read rechecks project authorization; a bundle is not a capability token.
 */

export interface BundleBody {
  format: "dk.bundle.v1";
  project_id: string;
  finding_id: string;
  finding_revision: number;
  finding_digest: string;
  graph_revision: string | null;
  ruleset: string;
  source_config_revisions: Record<string, number>;
  references: { event_id: string; role: "supporting" | "counter"; digest: string | null }[];
  evidence_digests: Record<string, string>;
  omissions: string[];
}

const eventDigest = (e: SecurityEvent) => sha256(canonicalJson(e));

function revisionBody(store: Store, projectId: string, findingId: string, revision?: number): Finding {
  const row = (revision === undefined
    ? store.db.prepare("SELECT body FROM finding_revisions WHERE project_id = ? AND finding_id = ? ORDER BY revision DESC LIMIT 1").get(projectId, findingId)
    : store.db.prepare("SELECT body FROM finding_revisions WHERE project_id = ? AND finding_id = ? AND revision = ?").get(projectId, findingId, revision)) as { body: string } | undefined;
  if (!row) throw new HttpError(404, revision === undefined ? "finding not found" : `finding revision ${revision} not found`);
  return JSON.parse(row.body) as Finding;
}

/** Any stored revision of a finding, exactly as recorded (R01.3: the backend serves historical revisions). */
export function findingRevision(store: Store, projectId: string, findingId: string, revision: number) {
  return { finding_id: findingId, revision, finding: revisionBody(store, projectId, findingId, revision), current_revision: revisionBody(store, projectId, findingId).revision };
}

export function createBundle(store: Store, projectId: string, findingId: string, actor: string, opts: { revision?: number; ttlDays?: number } = {}) {
  const f = revisionBody(store, projectId, findingId, opts.revision);
  const ids = [...new Set([...f.event_ids, ...f.counterevidence_event_ids])];
  const counter = new Set(f.counterevidence_event_ids);
  const events = new Map(store.eventsByIds(projectId, ids).map((e) => [e.id, e]));
  const refs = [...new Set([...events.values()].flatMap((e) => e.evidence_refs))].filter((r) => r.startsWith("evidence:"));
  const evidence = store.evidenceFor(projectId, refs);
  const omissions: string[] = [];
  const missing = ids.filter((i) => !events.has(i));
  if (missing.length) omissions.push(`${missing.length} referenced event(s) were not stored when this bundle was made: ${missing.slice(0, 10).join(", ")}`);
  const missingEv = refs.filter((r) => !evidence[r]);
  if (missingEv.length) omissions.push(`${missingEv.length} evidence record(s) were not stored when this bundle was made.`);
  const body: BundleBody = {
    format: "dk.bundle.v1", project_id: projectId, finding_id: findingId, finding_revision: f.revision, finding_digest: sha256(canonicalJson(f)),
    graph_revision: store.getGraph(projectId)?.graph_revision ?? null, ruleset: f.rule_version,
    source_config_revisions: Object.fromEntries(store.listSources(projectId).map((s) => [s.id, s.config_revision])),
    references: ids.map((id) => ({ event_id: id, role: counter.has(id) ? "counter" as const : "supporting" as const, digest: events.has(id) ? eventDigest(events.get(id)!) : null })),
    evidence_digests: Object.fromEntries(Object.entries(evidence).map(([k, v]) => [k, sha256(canonicalJson(v))])),
    omissions,
  };
  const digest = sha256(canonicalJson(body));
  const id = "bnd_" + digest.slice(0, 24);
  const existing = store.db.prepare("SELECT id FROM bundles WHERE project_id = ? AND id = ?").get(projectId, id);
  if (!existing) {
    const ttl = opts.ttlDays ?? 30;
    store.db.prepare("INSERT INTO bundles (id, project_id, digest, finding_id, finding_revision, body, created_at, created_by, expires_at, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)")
      .run(id, projectId, digest, findingId, f.revision, canonicalJson(body), store.now().toISOString(), actor, new Date(store.now().getTime() + ttl * 86_400_000).toISOString());
    store.audit(actor, "bundle.create", projectId, id, { finding_id: findingId, revision: f.revision });
  } else {
    // same content: extend an unpinned bundle's lifetime rather than minting a duplicate
    store.db.prepare("UPDATE bundles SET expires_at = ? WHERE project_id = ? AND id = ? AND pinned = 0 AND expires_at < ?").run(new Date(store.now().getTime() + (opts.ttlDays ?? 30) * 86_400_000).toISOString(), projectId, id, new Date(store.now().getTime() + (opts.ttlDays ?? 30) * 86_400_000).toISOString());
  }
  return getBundle(store, projectId, id);
}

type Row = { id: string; digest: string; finding_id: string; finding_revision: number; body: string; created_at: string; created_by: string; expires_at: string | null; pinned: number };

function row(store: Store, projectId: string, id: string): Row {
  const r = store.db.prepare("SELECT * FROM bundles WHERE project_id = ? AND id = ?").get(projectId, id) as Row | undefined;
  if (!r) throw new HttpError(404, "bundle not found");
  return r;
}

function meta(store: Store, r: Row) {
  const body = JSON.parse(r.body) as BundleBody;
  const expired = !r.pinned && !!r.expires_at && Date.parse(r.expires_at) <= store.now().getTime();
  return {
    bundle_id: r.id, bundle_digest: r.digest, finding_id: r.finding_id, finding_revision: r.finding_revision,
    graph_revision: body.graph_revision, ruleset: body.ruleset, source_config_revisions: body.source_config_revisions,
    reference_count: body.references.length, omissions: body.omissions,
    created_at: r.created_at, created_by: r.created_by, pinned: r.pinned === 1, expires_at: r.pinned ? null : r.expires_at, expired,
    limits: { page_max: 500, ttl: r.pinned ? "retained while pinned to a case" : "expires at expires_at unless pinned" },
  };
}

export function getBundle(store: Store, projectId: string, id: string) {
  const m = meta(store, row(store, projectId, id));
  if (m.expired) throw new HttpError(410, "bundle expired", ["create a new bundle; it may differ if evidence changed"], { bundle: m });
  return m;
}

export function pinBundle(store: Store, projectId: string, id: string, actor: string, reason: string) {
  const r = row(store, projectId, id);
  if (meta(store, r).expired) throw new HttpError(410, "bundle expired", [], { bundle: meta(store, r) });
  store.db.prepare("UPDATE bundles SET pinned = 1 WHERE project_id = ? AND id = ?").run(projectId, id);
  store.audit(actor, "bundle.pin", projectId, id, { reason: reason.slice(0, 300) });
  return getBundle(store, projectId, id);
}

/** One page of the bundle's own references, with each record checked against the digest pinned in the bundle. */
export function bundleEvents(store: Store, projectId: string, id: string, offset: number, limit: number) {
  const m = getBundle(store, projectId, id);
  const body = JSON.parse(row(store, projectId, id).body) as BundleBody;
  const lim = Math.min(Math.max(Math.trunc(limit) || 200, 1), 500), off = Math.max(Math.trunc(offset) || 0, 0);
  const page = body.references.slice(off, off + lim);
  const stored = new Map(store.eventsByIds(projectId, page.map((p) => p.event_id)).map((e) => [e.id, e]));
  const events: (SecurityEvent & { role: string })[] = [];
  const missing: { event_id: string; reason: string }[] = [];
  const changed: string[] = [];
  for (const ref of page) {
    const e = stored.get(ref.event_id);
    if (!ref.digest) { missing.push({ event_id: ref.event_id, reason: "not stored when the bundle was made" }); continue; }
    if (!e) { missing.push({ event_id: ref.event_id, reason: "deleted or purged since the bundle was made" }); continue; }
    if (eventDigest(e) !== ref.digest) { changed.push(ref.event_id); continue; }
    events.push({ ...e, role: ref.role });
  }
  const refs = [...new Set(events.flatMap((e) => e.evidence_refs))].filter((r) => r.startsWith("evidence:"));
  const ev = store.evidenceFor(projectId, refs);
  const evidence: Record<string, unknown> = {};
  const missingEvidence: string[] = [];
  for (const r of refs) {
    if (!ev[r] || !body.evidence_digests[r]) { missingEvidence.push(r); continue; }
    if (sha256(canonicalJson(ev[r])) !== body.evidence_digests[r]) { missingEvidence.push(r); continue; }
    evidence[r] = ev[r];
  }
  return {
    bundle_id: m.bundle_id, bundle_digest: m.bundle_digest, finding_id: m.finding_id, finding_revision: m.finding_revision,
    page: { offset: off, limit: lim, returned: events.length, total_references: body.references.length, has_more: off + lim < body.references.length },
    events, evidence,
    missing_events: missing, changed_event_ids: changed, missing_evidence_refs: missingEvidence,
    complete_page: !missing.length && !changed.length && !missingEvidence.length,
    note: "Records are served from the bundle's own references and checked against the digests pinned at creation. Later evidence is never added to this bundle.",
  };
}
