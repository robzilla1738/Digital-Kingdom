import type { WorldPlan } from "@dk/contracts";
import type { WorldTemplate } from "./catalog.ts";

/**
 * LP04: the three reviewed blueprints. A blueprint is a reviewed starting composition; instantiating it with a seed
 * produces a `dk.local.world_plan.v1` that is validated and compiled deterministically. Synthetic people, tenants and
 * credentials are part of the blueprint review, never supplied by untrusted text or a model.
 */
export interface BlueprintResource { id: string; template: WorldTemplate; name: string; depends_on: string[]; settings: WorldPlan["resources"][number]["settings"] }
export interface SyntheticAccount { id: string; tenant: string | null; role: "user" | "admin" | "service" | "agent"; display_pool: string[] }
export interface Blueprint {
  id: "saas-storefront" | "agent-workspace" | "delivery-identity";
  version: number;
  title: string;
  summary: string;
  resources: BlueprintResource[];
  tenants: string[];
  accounts: SyntheticAccount[];
  budget: WorldPlan["budget"];
  /** Reviewed limitations shown in every preview. */
  limitations: string[];
}

const BUDGET = { max_requests: 400, max_seconds: 120, max_parallel_operations: 2, max_evidence_bytes: 5_000_000 };

export const BLUEPRINTS: Blueprint[] = [
  {
    id: "saas-storefront", version: 1, title: "SaaS storefront",
    summary: "Ingress, sign-in, tenant API, tenant database, background worker, queue, artifact store and an independent audit observer.",
    resources: [
      { id: "ingress", template: "gateway", name: "storefront-ingress", depends_on: ["auth", "api"], settings: { policy_variant: "baseline" } },
      { id: "auth", template: "auth", name: "storefront-auth", depends_on: [], settings: { audit_enabled: true } },
      { id: "api", template: "api", name: "tenant-api", depends_on: ["auth", "tenant-db", "queue"], settings: { policy_variant: "baseline", tenant_mode: "isolated" } },
      { id: "tenant-db", template: "tenant_store", name: "tenant-db", depends_on: [], settings: { tenant_mode: "isolated" } },
      { id: "queue", template: "queue", name: "job-queue", depends_on: [], settings: {} },
      { id: "worker", template: "worker", name: "report-worker", depends_on: ["queue", "artifacts", "tenant-db"], settings: {} },
      { id: "artifacts", template: "artifact_depot", name: "report-artifacts", depends_on: [], settings: {} },
      { id: "audit", template: "observer", name: "data-audit-observer", depends_on: ["tenant-db", "artifacts"], settings: { audit_enabled: true } },
    ],
    tenants: ["tenant-a", "tenant-b"],
    accounts: [
      { id: "acct:tenant-a:user", tenant: "tenant-a", role: "user", display_pool: ["Avery", "Blair", "Casey"] },
      { id: "acct:tenant-b:user", tenant: "tenant-b", role: "user", display_pool: ["Drew", "Emery", "Finley"] },
      { id: "acct:ops:admin", tenant: null, role: "admin", display_pool: ["Ops Gray", "Ops Reed"] },
      { id: "svc:report-worker", tenant: null, role: "service", display_pool: ["report-worker"] },
    ],
    budget: BUDGET,
    limitations: [
      "The queue has no independent observer: message delivery is known only from the worker's own reports.",
      "Ingress and the API share request ids only inside this run; they are self-reports, not independent observations.",
    ],
  },
  {
    id: "agent-workspace", version: 1, title: "Agent workspace",
    summary: "A bounded agent workspace behind a tool gateway, a retrieval store, an allowed and a blocked receiver, runtime reports and an independent effect observer.",
    resources: [
      { id: "workspace", template: "worker", name: "agent-workspace", depends_on: ["tool-gateway"], settings: {} },
      { id: "tool-gateway", template: "agent_gateway", name: "tool-gateway", depends_on: ["retrieval", "allowed-receiver", "blocked-receiver"], settings: { policy_variant: "baseline" } },
      { id: "retrieval", template: "tenant_store", name: "retrieval-store", depends_on: [], settings: { tenant_mode: "single" } },
      { id: "allowed-receiver", template: "receiver", name: "approved-inbox", depends_on: [], settings: {} },
      { id: "blocked-receiver", template: "receiver", name: "unapproved-inbox", depends_on: [], settings: {} },
      { id: "effects", template: "observer", name: "receiver-effect-observer", depends_on: ["allowed-receiver", "blocked-receiver"], settings: { audit_enabled: true } },
    ],
    tenants: ["workspace"],
    accounts: [
      { id: "agent:support-assistant", tenant: "workspace", role: "agent", display_pool: ["support-assistant"] },
      { id: "acct:workspace:requester", tenant: "workspace", role: "user", display_pool: ["Harper", "Indigo"] },
    ],
    budget: BUDGET,
    limitations: [
      "Retrieval reads are reported by the gateway only; the retrieval store has no independent observer in this blueprint.",
      "A path that bypasses the tool gateway is visible only if it reaches an observed receiver.",
    ],
  },
  {
    id: "delivery-identity", version: 1, title: "Delivery and identity",
    summary: "A local source manifest built into an artifact depot, a deployed digest, short-lived local credentials and grants, and observed credential use.",
    resources: [
      { id: "builder", template: "worker", name: "local-builder", depends_on: ["depot"], settings: {} },
      { id: "depot", template: "artifact_depot", name: "artifact-depot", depends_on: [], settings: { audit_enabled: true } },
      { id: "deploy", template: "api", name: "deployed-service", depends_on: ["depot", "issuer", "deploy-data"], settings: { policy_variant: "baseline", tenant_mode: "single" } },
      { id: "deploy-data", template: "tenant_store", name: "deployed-service-data", depends_on: [], settings: { tenant_mode: "single" } },
      { id: "issuer", template: "local_issuer", name: "local-credential-issuer", depends_on: [], settings: { audit_enabled: true } },
      { id: "use-observer", template: "observer", name: "credential-use-observer", depends_on: ["deploy-data", "depot"], settings: { audit_enabled: true } },
    ],
    tenants: ["release"],
    accounts: [
      { id: "svc:builder", tenant: null, role: "service", display_pool: ["builder"] },
      { id: "svc:deployer", tenant: null, role: "service", display_pool: ["deployer"] },
      { id: "acct:release:operator", tenant: "release", role: "admin", display_pool: ["Jordan", "Kai"] },
    ],
    budget: BUDGET,
    limitations: [
      "Credential issuance is a self-report of the local issuer; only use against the deployed service's data is independently observed.",
      "Deployment here means selecting a depot digest for the local service; it is not a model of any provider's deployment semantics.",
    ],
  },
];

export function getBlueprint(id: string, version?: number): Blueprint | null {
  return BLUEPRINTS.find((b) => b.id === id && (version === undefined || b.version === version)) ?? null;
}
