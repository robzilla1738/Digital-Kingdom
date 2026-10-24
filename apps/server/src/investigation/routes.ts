import type { FastifyInstance, FastifyRequest } from "fastify";
import { HttpError, type Store } from "../store.ts";
import type { Role } from "../security.ts";
import type { Cases } from "../cases.ts";
import { InvestigationContracts } from "./contracts.ts";
import { checkAgainstContract, draftUnresolvedConclusion } from "./conclusions.ts";
import { InvestigationJobs, JOB_LIMITS, type JobsOptions } from "./jobs.ts";
import { EvidencePackets, PACKET_LIMITS } from "./packets.ts";
import { ClaimChecker, listConclusions, proposeConclusion } from "./claims.ts";
import { buildWorkbench } from "./workbench.ts";

/**
 * Local Intelligence Phase M2 HTTP surface (LP08+). Every route rechecks project authorization through
 * `store.require`; reads need viewer, anything that persists a contract revision, job, decision or proposal needs
 * analyst. MCP annotations are never the boundary.
 */
export interface InvestigationDeps {
  store: Store; secret: string; cases: Cases;
  authed: (minRole?: Role) => (req: FastifyRequest) => Promise<void>;
  who: (req: FastifyRequest) => string;
  jobs?: JobsOptions;
}

export function registerInvestigationRoutes(app: FastifyInstance, d: InvestigationDeps) {
  const { store, authed, who } = d;
  const contracts = new InvestigationContracts(store, (p, id) => d.cases.get(p, id) as never);
  const P = (req: FastifyRequest) => (req.params as { p: string }).p;
  const C = (req: FastifyRequest) => (req.params as { id: string }).id;
  const body = (req: FastifyRequest) => ((req.body && typeof req.body === "object" && !Array.isArray(req.body)) ? req.body : {}) as Record<string, unknown>;
  const base = "/api/projects/:p/cases/:id/contract";

  // ---- LP08 investigation contracts ----
  app.get(base, { preHandler: authed() }, async (req) => contracts.view(store.require(req.principal!, P(req), "viewer").id, C(req)));
  app.post(base, { preHandler: authed("analyst") }, async (req) => {
    const pid = store.require(req.principal!, P(req), "analyst").id;
    const b = body(req);
    if (b.expected_revision !== undefined && typeof b.expected_revision !== "number") throw new HttpError(400, "expected_revision must be a number");
    const exists = store.db.prepare("SELECT 1 FROM investigation_contracts WHERE project_id = ? AND case_id = ?").get(pid, C(req));
    d.cases.get(pid, C(req));
    return exists ? contracts.refresh(pid, C(req), who(req), "refresh", b.expected_revision as number | undefined) : contracts.open(pid, C(req), who(req));
  });
  app.get(`${base}/revisions`, { preHandler: authed() }, async (req) => ({ revisions: contracts.revisions(store.require(req.principal!, P(req), "viewer").id, C(req)) }));
  app.get(`${base}/revisions/:rev`, { preHandler: authed() }, async (req) => {
    const rev = Number((req.params as { rev: string }).rev);
    if (!Number.isInteger(rev) || rev < 1) throw new HttpError(400, "revision must be a positive integer");
    return contracts.revision(store.require(req.principal!, P(req), "viewer").id, C(req), rev);
  });
  app.get(`${base}/ledger`, { preHandler: authed() }, async (req) => {
    const q = req.query as { obligation?: string; limit?: string };
    return { transitions: contracts.ledger(store.require(req.principal!, P(req), "viewer").id, C(req), { obligation: q.obligation, limit: q.limit ? Number(q.limit) : undefined }), note: "Append-only: earlier decisions are never modified; an invalidation is a new entry naming the revision that held the old decision." };
  });
  app.post(`${base}/obligations/:oid/inapplicable`, { preHandler: authed("analyst") }, async (req) =>
    contracts.markInapplicable(store.require(req.principal!, P(req), "analyst").id, C(req), (req.params as { oid: string }).oid, body(req), who(req)));
  app.get(`${base}/unresolved-draft`, { preHandler: authed() }, async (req) => {
    const pid = store.require(req.principal!, P(req), "viewer").id;
    const view = contracts.view(pid, C(req));
    const draft = draftUnresolvedConclusion(view.contract);
    return { draft, check: checkAgainstContract(view.contract, draft), note: "Deterministic draft from the contract alone; nothing is stored. It asserts no negative and no intent." };
  });

  // ---- LP09 bounded investigation plan jobs ----
  const jobs = new InvestigationJobs(store, d.secret, contracts, d.jobs);
  const J = (req: FastifyRequest) => (req.params as { jid: string }).jid;
  const strict = (b: Record<string, unknown>, allowed: string[]) => { const bad = Object.keys(b).filter((k) => !allowed.includes(k)); if (bad.length) throw new HttpError(422, `unsupported field(s) ${bad.join(", ")}`, [`allowed: ${allowed.join(", ") || "(none)"}`]); return b; };
  app.get(`${base}/plan`, { preHandler: authed() }, async (req) => {
    const pid = store.require(req.principal!, P(req), "viewer").id;
    const view = contracts.view(pid, C(req));
    const open = view.contract.obligations.filter((o) => o.status !== "satisfied" && o.status !== "inapplicable_with_reason");
    const active = jobs.list(pid, C(req)).filter((j) => ["queued", "running", "budget_exhausted"].includes(String(j.status)));
    return { schema: "dk.investigation_plan_preview.v1", contract_id: view.contract.id, contract_revision: view.contract.revision, stale: view.stale, readiness: view.contract.readiness,
      steps: open.map((o) => ({ obligation_id: o.id, kind: o.kind, status: o.status, purpose: o.question, reason: o.reason })),
      next_step: open[0] ? { obligation_id: open[0].id, purpose: open[0].question, how: active.length ? `advance job ${active[0]!.id} (analyst)` : "create a job for this contract (analyst), then advance it" } : null,
      active_jobs: active.map((j) => j.id), limits: JOB_LIMITS, persisted: false, note: "Preview only: nothing was created or changed." };
  });
  app.post(`/api/projects/:p/cases/:id/jobs`, { preHandler: authed("analyst") }, async (req) => jobs.create(store.require(req.principal!, P(req), "analyst").id, C(req), body(req), req.principal!, who(req)));
  app.get(`/api/projects/:p/cases/:id/jobs`, { preHandler: authed() }, async (req) => ({ jobs: jobs.list(store.require(req.principal!, P(req), "viewer").id, C(req)) }));
  app.get(`/api/projects/:p/jobs/:jid`, { preHandler: authed() }, async (req) => jobs.get(store.require(req.principal!, P(req), "viewer").id, J(req)));
  app.get(`/api/projects/:p/jobs/:jid/events`, { preHandler: authed() }, async (req) => ({ events: jobs.events(store.require(req.principal!, P(req), "viewer").id, J(req)) }));
  app.get(`/api/projects/:p/jobs/:jid/deliveries`, { preHandler: authed() }, async (req) => {
    const q = req.query as { step?: string; after?: string; limit?: string };
    const after = q.after === undefined ? undefined : Number(q.after), limit = q.limit === undefined ? undefined : Number(q.limit);
    if ((after !== undefined && !Number.isInteger(after)) || (limit !== undefined && !Number.isInteger(limit))) throw new HttpError(400, "after and limit must be integers");
    return jobs.deliveries(store.require(req.principal!, P(req), "viewer").id, J(req), { step: q.step, after, limit });
  });
  app.post(`/api/projects/:p/jobs/:jid/advance`, { preHandler: authed("analyst") }, async (req) => { const b = strict(body(req), ["max_units"]); return jobs.advance(store.require(req.principal!, P(req), "analyst").id, J(req), b.max_units, req.principal!, who(req)); });
  app.post(`/api/projects/:p/jobs/:jid/steps`, { preHandler: authed("analyst") }, async (req) => jobs.addSteps(store.require(req.principal!, P(req), "analyst").id, J(req), body(req), who(req)));
  app.post(`/api/projects/:p/jobs/:jid/budget`, { preHandler: authed("analyst") }, async (req) => jobs.extendBudget(store.require(req.principal!, P(req), "analyst").id, J(req), strict(body(req), ["add_units"]), who(req)));
  app.post(`/api/projects/:p/jobs/:jid/cancel`, { preHandler: authed("analyst") }, async (req) => jobs.cancel(store.require(req.principal!, P(req), "analyst").id, J(req), strict(body(req), ["reason"]).reason, who(req)));

  // ---- LP10 compact evidence packets, inspection, claim checks and conclusion proposals ----
  const packets = new EvidencePackets(store, d.secret, contracts);
  const checker = new ClaimChecker(store, contracts);
  app.get(`/api/projects/:p/cases/:id/packet`, { preHandler: authed() }, async (req) => {
    const pid = store.require(req.principal!, P(req), "viewer").id;
    const q = req.query as { max_bytes?: string; cursor?: string };
    const unknown = Object.keys(q).filter((k) => k !== "max_bytes" && k !== "cursor");
    if (unknown.length) throw new HttpError(422, `unsupported parameter(s) ${unknown.join(", ")}`);
    return packets.build(pid, C(req), { maxBytes: q.max_bytes === undefined ? undefined : Number(q.max_bytes), cursor: q.cursor, principal: who(req) });
  });
  app.get(`/api/projects/:p/cases/:id/refs`, { preHandler: authed() }, async (req) => {
    const pid = store.require(req.principal!, P(req), "viewer").id;
    const ids = String((req.query as { ids?: string }).ids ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (ids.some((x) => x.length > 200)) throw new HttpError(422, "ids: each ref at most 200 characters");
    return packets.inspect(pid, C(req), ids, who(req));
  });
  app.post(`/api/projects/:p/cases/:id/packet/export`, { preHandler: authed("analyst") }, async (req) => {
    const pid = store.require(req.principal!, P(req), "analyst").id;
    const b = strict(body(req), ["max_bytes"]);
    return packets.export(pid, C(req), b.max_bytes === undefined ? undefined : Number(b.max_bytes), who(req));
  });
  app.post(`/api/verify-packet-export`, { preHandler: authed() }, async (req) => EvidencePackets.verifyExport(req.body, d.secret));
  app.post(`/api/projects/:p/cases/:id/conclusions/check`, { preHandler: authed() }, async (req) => checker.check(store.require(req.principal!, P(req), "viewer").id, C(req), req.body));
  app.post(`/api/projects/:p/cases/:id/conclusions`, { preHandler: authed("analyst") }, async (req) => {
    const pid = store.require(req.principal!, P(req), "analyst").id;
    return proposeConclusion(store, checker, pid, C(req), req.body, who(req), req.principal!.principalType, contracts.contractId(pid, C(req)));
  });
  app.get(`/api/projects/:p/cases/:id/conclusions`, { preHandler: authed() }, async (req) => ({ proposals: listConclusions(store, store.require(req.principal!, P(req), "viewer").id, C(req)) }));

  // ---- LP12 investigation workbench (read-only assembly of the above for a person reviewing the case) ----
  app.get(`/api/projects/:p/cases/:id/workbench`, { preHandler: authed() }, async (req) =>
    buildWorkbench({ store, cases: d.cases, contracts, jobs, packets }, store.require(req.principal!, P(req), "viewer").id, C(req)));

  return { contracts, jobs, packets, checker, limits: { jobs: JOB_LIMITS, packets: PACKET_LIMITS }, afterCaseChange: (projectId: string, caseId: string, actor: string) => {
    if (store.db.prepare("SELECT 1 FROM investigation_contracts WHERE project_id = ? AND case_id = ?").get(projectId, caseId)) {
      try { contracts.refresh(projectId, caseId, actor, "case changed"); } catch (e) { if (!(e instanceof HttpError)) throw e; /* e.g. scope now unbounded: the view reports it */ }
    }
  } };
}
