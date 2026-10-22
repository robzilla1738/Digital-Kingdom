import { EVENT_ACTIONS, type EventAction } from "@dk/contracts";

/**
 * Server-controlled source capabilities. A registered producer may only assert events
 *  - about the assets it is assigned (resolved stable ids), and
 *  - in the event categories its kind (or an explicit admin grant) permits.
 * Categories that carry independent-observation authority (observed side effects, decoy use) are never
 * granted by default to generic or application producers.
 */
const HEALTH: EventAction[] = ["sensor_unavailable", "sensor_restored"];
export const DEFAULT_ACTIONS_BY_KIND: Record<string, EventAction[]> = {
  waf: ["request_received", "waf_match", ...HEALTH],
  edge: ["request_received", "waf_match", ...HEALTH],
  app_security: ["request_received", "authentication", "authorization_change", "data_access", ...HEALTH],
  app_auth: ["authentication", "authorization_change", ...HEALTH],
  db_audit: ["data_access", ...HEALTH],
  honeytoken: ["decoy_used", ...HEALTH],
  agent_observer: ["tool_invocation", ...HEALTH],
  effect_observer: ["side_effect_observed", "data_access", ...HEALTH],
  falco: ["runtime_alert", ...HEALTH],
  otel: ["request_received", ...HEALTH],
  generic: EVENT_ACTIONS.filter((a) => a !== "side_effect_observed" && a !== "decoy_used"),
};
export const SOURCE_KINDS = Object.keys(DEFAULT_ACTIONS_BY_KIND);

export interface CapabilitySubject {
  id: string;
  kind?: string;
  asset_ids: string[];
  allowed_actions?: EventAction[];
  independence_group?: string;
}

export interface SourceCapabilities { assetIds: Set<string>; actions: Set<EventAction>; independenceGroup: string }

export function sourceCapabilities(src: CapabilitySubject): SourceCapabilities {
  const actions = src.allowed_actions?.length ? src.allowed_actions : DEFAULT_ACTIONS_BY_KIND[src.kind ?? "generic"] ?? DEFAULT_ACTIONS_BY_KIND.generic!;
  return { assetIds: new Set(src.asset_ids), actions: new Set(actions), independenceGroup: src.independence_group || src.id };
}

export type CapabilityViolation = { reason: "asset_not_permitted" | "action_not_permitted"; detail: string };

export function checkCapability(cap: SourceCapabilities, sourceId: string, action: EventAction, resolvedAssetIds: string[]): CapabilityViolation | null {
  if (!cap.actions.has(action)) return { reason: "action_not_permitted", detail: `source ${sourceId} may not report "${action}" (allowed: ${[...cap.actions].join(", ")})` };
  const outside = resolvedAssetIds.filter((a) => !cap.assetIds.has(a));
  if (outside.length) return { reason: "asset_not_permitted", detail: `source ${sourceId} is not assigned to: ${outside.slice(0, 5).join(", ")}` };
  return null;
}

/** Map source id -> independence group. Two collectors relaying the same underlying report share a group. */
export function independenceGroups(sources: CapabilitySubject[] | undefined): (sourceId: string) => string {
  const m = new Map((sources ?? []).map((s) => [s.id, s.independence_group || s.id]));
  return (id) => m.get(id) ?? id;
}
