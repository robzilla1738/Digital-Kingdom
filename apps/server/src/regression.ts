import { createHash, randomBytes } from "node:crypto";
import type { Graph, SecurityEvent } from "@dk/contracts";
import { canonicalJson } from "@dk/contracts";
import { evaluate, RULESET_VERSION, type SourceConfig } from "@dk/detections";
import { HttpError, type Store } from "./store.ts";

/**
 * Regression proposals from resolved cases (roadmap R07.4). A closed case's linked events become a MINIMIZED
 * SYNTHETIC fixture: only the fields detection rules read survive, every identifier is replaced by a placeholder,
 * times become offsets from a fixed synthetic epoch, and free text, attributes, evidence and payloads are dropped.
 * The fixture is refused if any original identifier or a secret-shaped value survives.
 *
 * Each proposal pins a versioned expected outcome (rule id, fires or not, ruleset version) and is verified twice:
 * the current rules must meet the expectation (the corrected condition), and the same check with the rule removed
 * must NOT (the broken condition), which shows the regression would catch the rule regressing. At least one benign
 * counterexample is required and must not fire. A human who is not the author approves; service principals (agents)
 * can never approve. Export yields PR-ready files only; nothing is published automatically.
 */
export const REGRESSION_MIGRATION = `CREATE TABLE regression_proposals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, case_id TEXT NOT NULL, case_version INTEGER NOT NULL, fixture TEXT NOT NULL, fixture_digest TEXT NOT NULL, verification TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, decided_by TEXT, decided_at TEXT, decision_note TEXT);`;

const EPOCH = Date.parse("2030-01-01T00:00:00.000Z");
const SECRET = [/AKIA[0-9A-Z]{16}/, /\bsk_(live|test)_[A-Za-z0-9]{6,}/, /-----BEGIN [A-Z ]*PRIVATE KEY/, /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bxox[abpr]-[A-Za-z0-9-]{10,}/, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, /\b(?:\d{1,3}\.){3}\d{1,3}\b(?<!\b192\.0\.2\.\d{1,3})/];
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
interface Expected { rule_id: string; fires: boolean }
interface Row { id: string; project_id: string; case_id: string; case_version: number; fixture: string; fixture_digest: string; verification: string; status: string; created_by: string; created_at: string; decided_by: string | null; decided_at: string | null; decision_note: string | null }

class Pseudonymizer {
  private maps = new Map<string, Map<string, string>>();
  readonly originals = new Set<string>();
  get(kind: string, v: string | undefined | null): string | undefined {
    if (v === undefined || v === null || v === "") return undefined;
    this.originals.add(v);
    let m = this.maps.get(kind); if (!m) { m = new Map(); this.maps.set(kind, m); }
    if (!m.has(v)) m.set(v, kind === "ip" ? `192.0.2.${m.size + 1}` : kind === "route" ? `/route-${m.size + 1}` : `${kind}-${m.size + 1}`);
    return m.get(v)!;
  }
}

/** Build the synthetic fixture for a set of events. Pure; exported for tests. */
export function synthesize(graph: Graph, sources: SourceConfig[], positive: SecurityEvent[], benign: SecurityEvent[]) {
  const ps = new Pseudonymizer();
  const all = [...positive, ...benign];
  const t0 = Math.min(...all.map((e) => Date.parse(e.occurred_at)));
  const assetIds = [...new Set(all.flatMap((e) => e.asset_ids))];
  for (const a of graph.assets) if (assetIds.includes(a.id)) { ps.originals.add(a.name); for (const al of (a as { aliases?: string[] }).aliases ?? []) ps.originals.add(al); }
  const assets = graph.assets.filter((a) => assetIds.includes(a.id)).map((a) => ({ id: ps.get("asset", a.id)!, name: ps.get("asset", a.id)!, kind: a.kind, environment: "lab", allowed_zone_ids: a.allowed_zone_ids, source_refs: ["synthetic"] }));
  const relationships = graph.relationships.filter((r) => assetIds.includes(r.source_id) && assetIds.includes(r.target_id)).map((r, i) => ({ id: `rel-${i + 1}`, source_id: ps.get("asset", r.source_id)!, target_id: ps.get("asset", r.target_id)!, kind: r.kind, evidence_level: r.evidence_level, evidence_refs: ["synthetic"] }));
  const srcIds = [...new Set(all.map((e) => e.source_id))];
  const fxSources = sources.filter((s) => srcIds.includes(s.id)).map((s) => ({ id: ps.get("source", s.id)!, label: ps.get("source", s.id)!, kind: s.kind, asset_ids: s.asset_ids.filter((a) => assetIds.includes(a)).map((a) => ps.get("asset", a)!), ...(s.independence_group ? { independence_group: ps.get("group", s.independence_group) } : {}), ...(s.identity_namespace ? { identity_namespace: ps.get("ns", s.identity_namespace) } : {}), ...(s.run_namespace ? { run_namespace: ps.get("ns", s.run_namespace) } : {}), ...(s.trusts_request_ids !== undefined ? { trusts_request_ids: s.trusts_request_ids } : {}) }));
  let n = 0;
  const ev = (e: SecurityEvent): SecurityEvent => {
    const at = new Date(EPOCH + Date.parse(e.occurred_at) - t0).toISOString();
    ps.originals.add(e.id); ps.originals.add(e.source_event_id);
    const out: Record<string, unknown> = {
      schema_version: "0.2", dataset_kind: "synthetic", project_id: "regression-fixture", id: `ev-${++n}`, source_event_id: `sev-${n}`, source_id: ps.get("source", e.source_id),
      occurred_at: at, received_at: at, asset_ids: e.asset_ids.map((a) => ps.get("asset", a)!), action: e.action, outcome: e.outcome, evidence_refs: ["synthetic"],
      request_id: ps.get("request", e.request_id), request_id_trust: e.request_id_trust, trace_id: ps.get("trace", e.trace_id), session_ref: ps.get("session", e.session_ref), run_id: ps.get("run", e.run_id),
      actor_ref: ps.get("actor", e.actor_ref), rule_ref: ps.get("ruleref", e.rule_ref), route: ps.get("route", e.route), severity: e.severity, sampled: e.sampled, client_ip: ps.get("ip", e.client_ip),
      ...(e.agent ? { agent: { phase: e.agent.phase, origin: e.agent.origin, ...(e.agent.tool ? { tool: ps.get("tool", e.agent.tool) } : {}), ...(e.agent.parent_run_id ? { parent_run_id: ps.get("run", e.agent.parent_run_id) } : {}), ...(e.agent.step !== undefined ? { step: e.agent.step } : {}) } } : {}),
    };
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out as unknown as SecurityEvent;
  };
  const fixture = { graph: { schema_version: "0.2", dataset_kind: "synthetic", project_id: "regression-fixture", graph_revision: "fixture-1", assets, relationships } as unknown as Graph, sources: fxSources, positive: positive.map(ev), benign: benign.map(ev) };
  // Controlled vocabulary kept in the fixture (asset/relationship/source kinds, zones) is public schema, not an
  // identifier, even when an id happens to equal it (an asset with id "auth" of kind "auth").
  const vocab = new Set<string>([...assets.flatMap((a) => [a.kind, ...a.allowed_zone_ids]), ...relationships.map((r) => r.kind), ...fxSources.map((s) => s.kind ?? "")]);
  for (const v of vocab) ps.originals.delete(v);
  return { fixture, originals: ps.originals };
}

/**
 * Any original identifier or a secret-shaped value surviving in `text`. Returns categories only, never values.
 * Identifiers of 4+ characters must not appear as a whole token; those of 8+ must not appear anywhere (embedded).
 * Short common ids ("auth") are therefore not confused with vocabulary such as "auth.repeated_failure".
 */
export function leaks(text: string, originals: Iterable<string>) {
  const problems: string[] = [];
  const tokens = new Set(text.split(/[\s"'`,;:()[\]{}<>=|\\]+/).flatMap((t) => [t, t.replace(/[.!?]+$/, "")]));
  let ids = 0; for (const o of originals) if ((o.length >= 4 && tokens.has(o)) || (o.length >= 8 && text.includes(o))) ids++;
  if (ids) problems.push(`${ids} original identifier(s) present`);
  SECRET.forEach((re, i) => { if (re.test(text)) problems.push(["aws access key", "api secret", "private key", "jwt", "github token", "slack token", "email address", "non-documentation ip address"][i]!); });
  return problems;
}

/** Run the expectation against the fixture with the current rules (corrected) and with the rule removed (broken). */
export function verifyFixture(fx: { graph: Graph; sources: SourceConfig[]; positive: SecurityEvent[]; benign: SecurityEvent[] }, expected: Expected) {
  const fired = (events: SecurityEvent[], drop: boolean) => evaluate(fx.graph, events, { sources: fx.sources }).findings.filter((f) => !(drop && f.rule_id === expected.rule_id)).some((f) => f.rule_id === expected.rule_id);
  const corrected = fired(fx.positive, false) === expected.fires;
  const broken = fired(fx.positive, true) === expected.fires;
  const benign = fx.benign.length ? !fired(fx.benign, false) : false;
  return {
    ruleset_version: RULESET_VERSION,
    corrected_condition: corrected ? "passes" : "fails",
    broken_condition: broken ? "passes (regression is not sensitive to the rule)" : "fails, as it should",
    benign_counterexamples: fx.benign.length ? (benign ? "do not fire" : "FIRE") : "none supplied",
    ok: corrected && !broken && benign,
  };
}

export class Regressions {
  constructor(private readonly store: Store) {}
  private get db() { return this.store.db; }
  private iso() { return this.store.now().toISOString(); }
  private events(projectId: string, ids: string[]) {
    return ids.map((id) => {
      const r = this.db.prepare("SELECT body FROM events WHERE project_id = ? AND id = ?").get(projectId, id) as { body: string } | undefined;
      if (!r) throw new HttpError(422, `event ${id} is not in this project`);
      return JSON.parse(r.body) as SecurityEvent;
    });
  }

  propose(projectId: string, caseId: string, b: Record<string, unknown>, actor: string, c: { status: string; version: number; items: { kind: string; ref: string; removed?: unknown }[] }) {
    if (c.status !== "closed") throw new HttpError(409, "only a closed case can become a regression proposal");
    const lesson = typeof b.lesson === "string" ? b.lesson.trim().slice(0, 2000) : "";
    if (!lesson) throw new HttpError(400, "lesson is required: what the regression should keep true");
    const exp = b.expected as Partial<Expected> | undefined;
    if (!exp || typeof exp.rule_id !== "string" || typeof exp.fires !== "boolean") throw new HttpError(400, "expected must be { rule_id, fires }");
    const linked = c.items.filter((i) => i.kind === "event" && !i.removed).map((i) => i.ref);
    const positiveIds = Array.isArray(b.event_ids) ? (b.event_ids as unknown[]).filter((x): x is string => typeof x === "string") : linked;
    if (!positiveIds.length) throw new HttpError(422, "the case links no events to minimize");
    const stray = positiveIds.filter((id) => !linked.includes(id));
    if (stray.length) throw new HttpError(422, "event_ids must be events linked to the case");
    const benignIds = Array.isArray(b.benign_event_ids) ? (b.benign_event_ids as unknown[]).filter((x): x is string => typeof x === "string") : [];
    if (!benignIds.length) throw new HttpError(400, "benign_event_ids must name at least one benign counterexample the rule must not fire on");
    const graph = this.store.getGraph(projectId);
    if (!graph) throw new HttpError(409, "project has no graph");
    const { fixture, originals } = synthesize(graph, this.store.listSources(projectId), this.events(projectId, positiveIds), this.events(projectId, benignIds));
    originals.add(projectId); originals.add(caseId);
    const doc = { schema: "dk.regression_fixture.v1", lesson, expected_outcome: { version: 1, ...exp, ruleset_version: RULESET_VERSION }, ...fixture };
    const text = canonicalJson(doc);
    const problems = leaks(text, originals);
    if (problems.length) throw new HttpError(422, `the fixture still contains sensitive data (${problems.join("; ")}); edit the lesson or choose other events`, problems);
    const verification = verifyFixture(fixture, exp as Expected);
    const id = `rg_${randomBytes(8).toString("hex")}`;
    const provenance = { case_ref: `sha256:${sha(`${projectId}/${caseId}`).slice(0, 16)}`, case_version: c.version, source_event_count: positiveIds.length, benign_event_count: benignIds.length, generator: "dk-regression-1" };
    const full = { ...doc, provenance };
    const ftext = canonicalJson(full);
    this.db.prepare("INSERT INTO regression_proposals (id, project_id, case_id, case_version, fixture, fixture_digest, verification, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, projectId, caseId, c.version, ftext, `sha256:${sha(ftext)}`, JSON.stringify(verification), verification.ok ? "proposed" : "verification_failed", actor, this.iso());
    this.store.audit(actor, "regression.proposed", projectId, id, { case_id: caseId, ok: verification.ok });
    return this.get(projectId, id);
  }

  private row(projectId: string, id: string) {
    const r = this.db.prepare("SELECT * FROM regression_proposals WHERE id = ? AND project_id = ?").get(id, projectId) as unknown as Row | undefined;
    if (!r) throw new HttpError(404, "no such regression proposal");
    return r;
  }
  get(projectId: string, id: string) {
    const r = this.row(projectId, id);
    return { id: r.id, case_id: r.case_id, case_version: r.case_version, status: r.status, fixture_digest: r.fixture_digest, fixture: JSON.parse(r.fixture), verification: JSON.parse(r.verification), created_by: r.created_by, created_at: r.created_at, decided_by: r.decided_by, decided_at: r.decided_at, decision_note: r.decision_note, publication: "never automatic; export the PR files and open a pull request yourself" };
  }
  list(projectId: string) { return (this.db.prepare("SELECT id FROM regression_proposals WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as { id: string }[]).map((r) => { const g = this.get(projectId, r.id); return { id: g.id, case_id: g.case_id, status: g.status, fixture_digest: g.fixture_digest, verification_ok: g.verification.ok }; }); }

  decide(projectId: string, id: string, b: Record<string, unknown>, actor: string, principalType: string) {
    const r = this.row(projectId, id);
    if (principalType !== "human") throw new HttpError(403, "service principals (agents) cannot approve publication of a regression");
    if (r.created_by === actor) throw new HttpError(403, "the author cannot approve their own regression proposal");
    if (b.fixture_digest !== r.fixture_digest) throw new HttpError(409, "fixture_digest must match the reviewed fixture");
    const decision = b.decision === "approve" ? "approved" : b.decision === "reject" ? "rejected" : null;
    if (!decision) throw new HttpError(400, "decision must be approve or reject");
    if (r.status !== "proposed") throw new HttpError(409, `a ${r.status} proposal cannot be decided`);
    this.db.prepare("UPDATE regression_proposals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?").run(decision, actor, this.iso(), typeof b.note === "string" ? b.note.slice(0, 1000) : null, id);
    this.store.audit(actor, `regression.${decision}`, projectId, id, {});
    return this.get(projectId, id);
  }

  /** PR-ready files for an approved proposal. Returned to the caller only; nothing is pushed or published. */
  exportPr(projectId: string, id: string) {
    const g = this.get(projectId, id);
    if (g.status !== "approved") throw new HttpError(409, "only an approved proposal can be exported");
    const name = `${g.fixture.expected_outcome.rule_id.replace(/[^a-z0-9.]+/gi, "-")}-${g.id.slice(3, 11)}`;
    return {
      files: [{ path: `scenarios/regressions/${name}.json`, content: JSON.stringify(g.fixture, null, 1) + "\n" }],
      pull_request: {
        title: `regression: ${g.fixture.expected_outcome.rule_id} ${g.fixture.expected_outcome.fires ? "fires" : "stays quiet"} (${name})`,
        body: [`Lesson: ${g.fixture.lesson}`, "", `Expected: ${g.fixture.expected_outcome.rule_id} fires=${g.fixture.expected_outcome.fires} (ruleset ${g.fixture.expected_outcome.ruleset_version}).`, `Verification at proposal: corrected ${g.verification.corrected_condition}; broken ${g.verification.broken_condition}; benign ${g.verification.benign_counterexamples}.`, `Fixture ${g.fixture_digest}, approved by a human reviewer who is not the author.`, "", "Synthetic, minimized fixture. A passing regression is not a validated defence."].join("\n"),
      },
      publication: "not published: open the pull request yourself after your own review",
    };
  }
}
