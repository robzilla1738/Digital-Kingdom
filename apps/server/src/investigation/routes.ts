import type { FastifyInstance, FastifyRequest } from "fastify";
import { HttpError, type Store } from "../store.ts";
import type { Role } from "../security.ts";
import type { Cases } from "../cases.ts";
import { InvestigationContracts } from "./contracts.ts";
import { checkAgainstContract, draftUnresolvedConclusion } from "./conclusions.ts";

/**
 * Local Intelligence Phase M2 HTTP surface (LP08+). Every route rechecks project authorization through
 * `store.require`; reads need viewer, anything that persists a contract revision, job, decision or proposal needs
 * analyst. MCP annotations are never the boundary.
 */
export interface InvestigationDeps {
  store: Store; secret: string; cases: Cases;
  authed: (minRole?: Role) => (req: FastifyRequest) => Promise<void>;
  who: (req: FastifyRequest) => string;
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

  return { contracts, afterCaseChange: (projectId: string, caseId: string, actor: string) => {
    if (store.db.prepare("SELECT 1 FROM investigation_contracts WHERE project_id = ? AND case_id = ?").get(projectId, caseId)) {
      try { contracts.refresh(projectId, caseId, actor, "case changed"); } catch (e) { if (!(e instanceof HttpError)) throw e; /* e.g. scope now unbounded: the view reports it */ }
    }
  } };
}
