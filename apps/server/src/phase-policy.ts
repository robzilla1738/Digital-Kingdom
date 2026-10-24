import type { DatabaseSync } from "node:sqlite";

/**
 * Local Intelligence Phase runtime policy (LP00).
 *
 * This phase is local-only: no third-party account, no remote notification, no production action and no new model
 * provider call happens unless an operator explicitly configures that path. The report below is computed from the
 * server's ACTUAL configuration, not from a declaration, so a configured outbound path is reported as configured
 * (and `defaults_hold` becomes false) instead of being hidden. It authorizes nothing: it only states what is on.
 */
export const RUNTIME_POLICY_SCHEMA = "dk.local_phase.runtime_policy.v1";

export interface RuntimePolicyInputs {
  planner?: unknown;
  assistant?: unknown;
  githubToken?: string | undefined;
  db: DatabaseSync;
}

export interface OutboundPath { id: string; purpose: string; configured: boolean; detail: string }

export function runtimePolicy(i: RuntimePolicyInputs) {
  const destinations = Number((i.db.prepare("SELECT COUNT(*) AS n FROM notify_destinations WHERE disabled_at IS NULL").get() as { n: number }).n);
  const outbound: OutboundPath[] = [
    { id: "layout_planner_model", purpose: "optional scene layout proposals", configured: !!i.planner, detail: i.planner ? "an operator configured DK_PLANNER_URL" : "not configured (DK_PLANNER_URL unset)" },
    { id: "case_assistant_model", purpose: "optional case drafting", configured: !!i.assistant, detail: i.assistant ? "an assistant model was supplied" : "not configured" },
    { id: "notification_delivery", purpose: "remote notification webhooks", configured: destinations > 0, detail: `${destinations} enabled destination(s)` },
    { id: "github_discovery", purpose: "read-only repository discovery", configured: !!i.githubToken, detail: i.githubToken ? "a GitHub token is configured; discovery runs only when an admin requests it" : "no token; discovery of private repositories is unavailable and nothing is fetched unless an admin requests a preview" },
  ];
  const models = outbound.filter((o) => o.id.endsWith("_model") && o.configured).map((o) => o.id);
  return {
    schema: RUNTIME_POLICY_SCHEMA,
    phase: "local-intelligence",
    external_network: { default: "none", outbound_paths: outbound, configured_outbound: outbound.filter((o) => o.configured).map((o) => o.id) },
    model_calls: { configured_routes: models, new_provider_calls: models.length ? "only through the configured route(s) listed" : "none", inherited_budget_usd: 0, note: "No evaluation budget is inherited; a model run needs its own approved route, cap and receipt." },
    local_actions: { mode: "plan_only" as const, executor: "not_available" as const, lease_required: true, note: "No local or production executor exists; response plans stay proposals." },
    defaults_hold: outbound.every((o) => !o.configured),
    deferrals: "docs/phases/local-intelligence/package/DEFERRALS.json",
  };
}
