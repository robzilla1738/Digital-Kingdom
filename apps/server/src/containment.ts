import type { AssetKind } from "@dk/contracts";

/**
 * Permitted containment steps. Digital Kingdom NEVER executes these: version 1 has no production-write
 * path. An agent (via MCP) or an analyst may *propose* one against a finding; a different human must
 * approve it; execution happens outside Digital Kingdom through the team's normal change process.
 */
export interface ContainmentAction {
  id: string;
  title: string;
  description: string;
  applies_to_kinds: AssetKind[];
  reversible: boolean;
  blast_radius: "narrow" | "moderate" | "broad";
  runbook: string[];
}

export const CONTAINMENT_CATALOG: ContainmentAction[] = [
  { id: "edge.tighten_rate_limit", title: "Tighten rate limit on the affected route", description: "Lower the request rate for the targeted route at the edge.", applies_to_kinds: ["edge", "service"], reversible: true, blast_radius: "narrow", runbook: ["Identify the route template from the finding.", "Apply a temporary limit in the edge config via normal change review.", "Watch blocked/allowed counts for 30 minutes."] },
  { id: "edge.block_source_range", title: "Temporarily block a source address range", description: "Deny a network range at the edge. Shared NAT ranges can block legitimate users.", applies_to_kinds: ["edge"], reversible: true, blast_radius: "moderate", runbook: ["Confirm the range is not a shared corporate/NAT range.", "Add a time-boxed deny rule.", "Record expiry and owner."] },
  { id: "auth.force_reauth", title: "Force re-authentication for an account", description: "Revoke sessions for the affected account and require sign-in again.", applies_to_kinds: ["auth"], reversible: true, blast_radius: "narrow", runbook: ["Confirm the account identifier with its owner.", "Revoke active sessions in the identity provider.", "Require MFA on next sign-in."] },
  { id: "auth.revert_privilege_change", title: "Revert a privilege change", description: "Roll back an unexpected role grant pending owner confirmation.", applies_to_kinds: ["auth", "service"], reversible: true, blast_radius: "narrow", runbook: ["Find the change ticket or owner.", "Revert the grant if unexplained.", "Review actions taken with the elevated role."] },
  { id: "secrets.rotate_credentials", title: "Rotate credentials near a used decoy", description: "Rotate real credentials stored alongside a triggered decoy.", applies_to_kinds: ["agent", "tool_server", "service", "worker", "pipeline"], reversible: false, blast_radius: "moderate", runbook: ["List real credentials co-located with the decoy.", "Rotate each and redeploy consumers.", "Keep the decoy in place to detect reuse."] },
  { id: "agent.suspend_tool", title: "Suspend an agent tool", description: "Disable a specific tool for the agent until reviewed.", applies_to_kinds: ["agent", "tool_server"], reversible: true, blast_radius: "narrow", runbook: ["Identify the tool and policy version.", "Remove the tool from the agent's allowlist.", "Review recent runs that used it."] },
  { id: "deploy.pause_rollout", title: "Pause deployments to the affected service", description: "Hold new releases while a finding on the service is investigated.", applies_to_kinds: ["service", "pipeline", "auth", "edge"], reversible: true, blast_radius: "moderate", runbook: ["Pause the pipeline stage for the service.", "Communicate the hold to the owning team.", "Resume once the finding is resolved."] },
  { id: "data.restrict_access", title: "Restrict access to a data store", description: "Temporarily narrow which identities can read the store.", applies_to_kinds: ["database", "storage"], reversible: true, blast_radius: "broad", runbook: ["Restore audit coverage first if it is offline.", "Narrow the role bindings for the store.", "Confirm application health after the change."] },
];
