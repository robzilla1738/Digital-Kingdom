import { HttpError, type Store } from "../store.ts";
import type { Cases } from "../cases.ts";
import { provenanceOf } from "../provenance.ts";
import type { InvestigationContracts } from "./contracts.ts";
import type { InvestigationJobs } from "./jobs.ts";
import type { EvidencePackets, CompactRecord } from "./packets.ts";
import { listConclusions } from "./claims.ts";

/**
 * LP12 investigation workbench (`dk.case_workbench.v1`).
 *
 * One read that assembles what a person reviewing a case needs, entirely from the existing M2 services: case
 * progress (contract readiness and obligation states), evidence/coverage questions, competing hypotheses, supporting
 * and counter records, failed or partial queries, uncertainty, the next bounded action, and agent proposals.
 *
 * Guarantees:
 * - It writes nothing: no contract revision, ledger entry, job, step, delivery, exposure record or case change. The
 *   packet is built with `record: false`, so a person viewing the workbench never makes a record "available" for an
 *   agent's claim check.
 * - Agent proposals (LP10 conclusion proposals) are listed separately from the case record with a per-case proposal
 *   version, their check status and the contract revision they were checked against. Nothing here adopts, accepts or
 *   applies a proposal; `affects_case_record` is always false.
 * - Every record and obligation carries shared anchors (`asset:<id>`, `event:<id>`, `finding:<id>`) with the same
 *   canonical ids the castle selection and the MCP tools use, so a castle selection can filter the evidence and an
 *   evidence row can select its castle object without a camera.
 */
export const WORKBENCH_SCHEMA = "dk.case_workbench.v1";
export const WORKBENCH_PACKET_BYTES = 200_000;

export interface WorkbenchDeps { store: Store; cases: Cases; contracts: InvestigationContracts; jobs: InvestigationJobs; packets: EvidencePackets }
type Anchor = { id: string; kind: "asset" | "event" | "finding"; ref: string; selection: { kind: "asset" | "event" | "finding"; id: string } };
type NextAction = { id: string; action: string; who: "person" | "analyst" | "analyst_or_agent"; why: string; route?: string };

const anchorOf = (kind: Anchor["kind"], ref: string): Anchor => ({ id: `${kind}:${ref}`, kind, ref, selection: { kind, id: ref } });
const ACTIVE_JOB = ["queued", "running", "budget_exhausted"];

export function buildWorkbench(d: WorkbenchDeps, projectId: string, caseId: string) {
  const c = d.cases.get(projectId, caseId);
  const prov = provenanceOf(d.store.getProject(projectId)!);
  const live = c.items.filter((i) => !("removed" in i)) as unknown as { item_id: string; kind: string; ref: string; text?: string; status?: string; answer?: string | null; added_by: string; added_at: string }[];
  const anchors = new Map<string, Anchor>();
  const anchor = (kind: Anchor["kind"], ref: string) => { const a = anchorOf(kind, ref); anchors.set(a.id, a); return a.id; };
  for (const a of c.scope.asset_ids) anchor("asset", a);
  for (const f of c.linked_findings) anchor("finding", f.finding_id);

  // Case questions and hypotheses are owned by people: telemetry, jobs and agents never settle them.
  const questions = live.filter((i) => i.kind === "question").map((q) => ({ item_id: q.item_id, text: q.text ?? "", status: q.status ?? "open", answer: q.answer ?? null, settled_by: "person" as const, added_by: q.added_by }));
  const hypotheses = live.filter((i) => i.kind === "hypothesis").map((h) => ({ item_id: h.item_id, text: h.text ?? "", status: h.status ?? "open", answer: h.answer ?? null, added_by: h.added_by }));
  const notes = live.filter((i) => i.kind === "note").map((n) => ({ item_id: n.item_id, text: n.text ?? "", added_by: n.added_by, added_at: n.added_at }));

  let view: ReturnType<InvestigationContracts["view"]> | null = null;
  try { view = d.contracts.view(projectId, caseId); }
  catch (e) { if (!(e instanceof HttpError) || e.status !== 404) throw e; }

  const base = {
    schema: WORKBENCH_SCHEMA, project_id: projectId,
    case: { id: c.id, title: c.title, version: c.version, status: c.status, question: c.scope.question, scope: c.scope, closure_criteria: c.closure_criteria },
    provenance: { local_run: prov.local_run, ...(prov.local_run ? { run_id: prov.run_id, label: prov.label, qualifiers: prov.qualifiers } : {}) },
    case_record: { questions, hypotheses, notes, linked_findings: c.linked_findings.map((f) => ({ ...f, anchor: `finding:${f.finding_id}` })) },
    competing_hypotheses: {
      items: hypotheses,
      decided: hypotheses.filter((h) => h.status === "supported" || h.status === "refuted").length,
      note: hypotheses.length > 1 ? "Hypotheses are shown side by side; none is preferred until a person records supported or refuted with a reason." : hypotheses.length === 1 ? "Only one hypothesis is recorded; consider the competing explanation before concluding." : "No hypothesis recorded yet.",
    },
    writes: "none" as const,
    repair_candidates: latestRepairs(d.store, projectId, caseId),
  };

  const proposals = (listConclusions(d.store, projectId, caseId) as unknown as { id: string; created_by: string; principal_type: string; created_at: string; contract_revision: number | string; status: string; body: unknown; check_result: unknown }[]).slice().reverse().map((p, i) => {
    const body = p.body as { claims?: { id: string; type: string; text: string }[]; requested_next_step?: string } | null;
    const check = p.check_result as unknown as { status?: string; claims?: { id: string; support?: string; issues?: string[] }[] };
    return {
      id: p.id, proposal_version: i + 1, author: p.created_by, author_kind: p.principal_type === "service" ? "agent" : "person",
      created_at: p.created_at, contract_revision: Number(p.contract_revision), check_status: check?.status ?? p.status,
      stale: view ? Number(p.contract_revision) !== view.contract.revision : true,
      claims: (body?.claims ?? []).slice(0, 20).map((cl) => ({ id: cl.id, type: cl.type, text: String(cl.text).slice(0, 600), support: check?.claims?.find((x) => x.id === cl.id)?.support ?? null })),
      requested_next_step: body?.requested_next_step ?? null,
      accepted: false as const, affects_case_record: false as const,
    };
  }).reverse();
  const proposalSection = { items: proposals, latest_version: proposals[0]?.proposal_version ?? 0, note: "Proposals are versioned drafts kept apart from the case record. They never answer a question, change a note, close the case or approve an action; a person records any of those in the case." };

  if (!view) {
    const next: NextAction[] = [{ id: "open_contract", action: "Open the investigation contract for this case", who: "analyst", why: "Without a contract there are no evidence obligations, so nothing about the case has been retrieved or checked yet.", route: `POST /api/projects/${projectId}/cases/${caseId}/contract` }];
    return { ...base, contract: null, progress: { readiness: "no_contract", reason: "No investigation contract has been opened.", obligations: { total: 0, by_status: {} }, closure_prerequisites: [] }, evidence_questions: [], evidence: { supporting: [], counter: [], other: [], complete: false, omitted_required: [], omitted_other: [] }, failed_queries: [], uncertainty: null, pending_jobs: [], next_actions: next, summary: summaryOf(null, questions, [], [], next), proposals: proposalSection, anchors: [...anchors.values()] };
  }

  const contract = view.contract;
  for (const o of contract.obligations) { if (o.target.asset_id) anchor("asset", o.target.asset_id); if (o.target.finding_id) anchor("finding", o.target.finding_id); }
  const byStatus: Record<string, number> = {};
  for (const o of contract.obligations) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  const packet = d.packets.build(projectId, caseId, { maxBytes: WORKBENCH_PACKET_BYTES, principal: "workbench", record: false });
  const withAnchors = (r: CompactRecord) => ({ ...r, anchors: [anchor("event", r.ref), ...r.asset_ids.map((a) => anchor("asset", a))] });
  const records = (packet.records as CompactRecord[]).map(withAnchors);
  const supporting = records.filter((r) => r.role === "supporting" || r.role === "follow_on" || r.role === "linked");
  const counter = records.filter((r) => r.role === "counter");
  const other = records.filter((r) => r.role !== "counter" && !supporting.includes(r));
  const u = packet.uncertainty;
  const failed = [
    ...contract.obligations.filter((o) => o.status === "failed" || o.status === "unavailable" || o.status === "partial").map((o) => ({ kind: "obligation" as const, id: o.id, status: o.status, reason: o.reason, question: o.question, anchors: o.target.asset_id ? [`asset:${o.target.asset_id}`] : [] })),
    ...u.query_status.filter((s) => s.status !== "pending" || s.error).map((s) => ({ kind: "query_step" as const, id: `${s.job_id}/${s.step_id}`, status: String(s.status), reason: s.error ?? (s.resumable ? "partial; resumable" : String(s.completeness ?? "")), question: String(s.obligation_id ?? s.kind), resumable: s.resumable, anchors: [] as string[] })),
  ];
  const evidenceQuestions = contract.obligations.map((o) => ({
    id: o.id, kind: o.kind, question: o.question, status: o.status, reason: o.reason, supports_negative_claims: o.supports_negative_claims,
    evidence_ref_count: o.evidence_ref_count ?? o.evidence_refs.length, query_refs: o.query_refs.slice(0, 10), decided_at_revision: o.decided_at_revision ?? null,
    anchors: [...(o.target.asset_id ? [`asset:${o.target.asset_id}`] : []), ...(o.target.finding_id ? [`finding:${o.target.finding_id}`] : [])],
  }));
  const jobs = d.jobs.list(projectId, caseId) as unknown as { id: string; status: string; contract_revision: number }[];
  const pending = jobs.filter((j) => ACTIVE_JOB.includes(String(j.status))).map((j) => ({ id: j.id, status: j.status, contract_revision: j.contract_revision }));

  const next: NextAction[] = [];
  const open = contract.obligations.filter((o) => o.status === "not_started" || o.status === "running" || (o.status === "partial" && u.query_status.some((s) => s.obligation_id === o.id && s.resumable)));
  if (view.stale) next.push({ id: "refresh_contract", action: "Refresh the contract", who: "analyst", why: "The case scope or the evidence changed since the stored revision; obligations shown are the effective view until refreshed.", route: `POST /api/projects/${projectId}/cases/${caseId}/contract` });
  if (open.length) next.push(pending.length
    ? { id: "advance_job", action: `Advance job ${pending[0]!.id} for ${open[0]!.id}`, who: "analyst_or_agent", why: `${open.length} obligation(s) still open; the job resumes where it stopped.`, route: `POST /api/projects/${projectId}/jobs/${pending[0]!.id}/advance` }
    : { id: "create_job", action: `Start a bounded job for ${open[0]!.id}`, who: "analyst_or_agent", why: `${open.length} obligation(s) have not been attempted under this revision.`, route: `POST /api/projects/${projectId}/cases/${caseId}/jobs` });
  for (const o of contract.obligations.filter((x) => x.status === "failed").slice(0, 3)) next.push({ id: `retry_or_inapplicable:${o.id}`, action: `Retry ${o.id} or document why it does not apply`, who: "analyst", why: o.reason || "the obligation failed", route: `POST /api/projects/${projectId}/cases/${caseId}/contract/obligations/${o.id}/inapplicable` });
  for (const q of questions.filter((x) => x.status === "open").slice(0, 3)) next.push({ id: `answer_question:${q.item_id}`, action: `Answer or accept as unresolved: “${q.text.slice(0, 120)}”`, who: "person", why: "Case questions are settled only by a person; no job or proposal answers them." });
  if (!open.length && (contract.readiness === "bounded_answer_ready" || contract.readiness === "unresolved_answer_ready")) next.push({ id: "review_conclusion", action: proposals.length ? `Review proposal v${proposals[0]!.proposal_version} against the evidence` : "Draft a conclusion (the unresolved draft is available)", who: "person", why: contract.readiness_reason });

  const uncertainty = { readiness: u.readiness, readiness_reason: u.readiness_reason, unmet_obligations: u.unmet_obligations, negative_claims: u.negative_claims, coverage_gaps: u.coverage_gaps.map((g) => ({ ...g, anchors: g.asset_id ? [anchor("asset", String(g.asset_id))] : [] })) };
  return {
    ...base,
    contract: { id: contract.id, revision: contract.revision, stale: view.stale, readiness: contract.readiness },
    progress: { readiness: contract.readiness, reason: contract.readiness_reason, obligations: { total: contract.obligations.length, by_status: byStatus }, closure_prerequisites: contract.closure_prerequisites },
    evidence_questions: evidenceQuestions,
    evidence: {
      supporting, counter, other, packet_id: packet.packet_id, records_total: packet.summary.records_total, complete: packet.complete, complete_for_required: packet.complete_for_required,
      omitted_required: packet.omissions.required, omitted_other: packet.omissions.other,
      note: "Counterevidence is listed first and is never cut. Omitted records are listed, never summarized away.",
    },
    failed_queries: failed,
    uncertainty,
    pending_jobs: pending,
    next_actions: next,
    summary: summaryOf(contract, questions, supporting, counter, next, uncertainty),
    proposals: proposalSection,
    anchors: [...anchors.values()],
  };
}

/** LP14: the latest reviewable repair candidate set for the case (read-only summary; plans stay plan-only). */
function latestRepairs(store: Store, projectId: string, caseId: string) {
  let row: { id: string; body: string; created_at: string } | undefined;
  try { row = store.db.prepare("SELECT id, body, created_at FROM repair_candidate_sets WHERE project_id = ? AND case_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(projectId, caseId) as typeof row; }
  catch { return null; } // table absent on a database that predates LP14 migrations
  if (!row) return null;
  const b = JSON.parse(row.body) as { status: string; reasons: string[]; baseline: { state_hash: string }; candidates: { candidate_id: string; rank: number; template: { id: string }; target: string; valid: boolean; breaks_permitted: boolean; tradeoffs: { objective_coverage: { blocked: number; of: number }; disruption: { permitted_broken: string[]; of: number; elements_changed: number }; unknowns: string[]; prerequisites: string[] }; plan: { plan_id: string; candidate_digest: string } }[]; ranking: { note: string } };
  return { set_id: row.id, created_at: row.created_at, status: b.status, reasons: b.reasons, baseline_state_hash: b.baseline.state_hash, ranking_note: b.ranking.note,
    candidates: b.candidates.map((c) => ({ candidate_id: c.candidate_id, rank: c.rank, template: c.template.id, target: c.target, valid: c.valid, breaks_permitted: c.breaks_permitted,
      blocked: c.tradeoffs.objective_coverage.blocked, of: c.tradeoffs.objective_coverage.of, permitted_broken: c.tradeoffs.disruption.permitted_broken.length, permitted_of: c.tradeoffs.disruption.of,
      elements_changed: c.tradeoffs.disruption.elements_changed, unknowns: c.tradeoffs.unknowns.length, prerequisites: c.tradeoffs.prerequisites.length, plan_id: c.plan.plan_id, authority: "plan_only" as const })) };
}

/** The five-part case summary (phase spec §11): never a single opaque score. */
function summaryOf(contract: { obligations: { id: string; status: string; question: string }[]; readiness: string } | null, questions: { status: string }[], supporting: { action: string; asset_ids: string[] }[], counter: { ref: string }[], next: NextAction[], u?: { negative_claims: { id: string; assessable: boolean; reason: string }[]; coverage_gaps: unknown[] }) {
  const observed = new Map<string, number>();
  for (const r of supporting) for (const a of r.asset_ids) observed.set(`${r.action} on ${a}`, (observed.get(`${r.action} on ${a}`) ?? 0) + 1);
  return {
    observed: [...observed].map(([k, n]) => `${n} ${k}`),
    supports: contract ? contract.obligations.filter((o) => o.status === "satisfied").map((o) => o.question) : [],
    does_not_support: [
      ...(u?.negative_claims.filter((n) => !n.assessable).map((n) => `No absence claim for ${n.id}: ${n.reason}`) ?? []),
      "Intent or authorization: telemetry alone cannot establish them.",
    ],
    could_change: [
      ...(counter.length ? [`${counter.length} counter record(s)`] : []),
      ...(u?.coverage_gaps.length ? [`${u.coverage_gaps.length} coverage gap(s)`] : []),
      ...(contract ? contract.obligations.filter((o) => o.status !== "satisfied" && o.status !== "inapplicable_with_reason").map((o) => `${o.id} is ${o.status}`) : ["no contract opened"]),
      ...(questions.some((q) => q.status === "open") ? [`${questions.filter((q) => q.status === "open").length} open case question(s)`] : []),
    ],
    next: next[0]?.action ?? "Nothing pending.",
  };
}
