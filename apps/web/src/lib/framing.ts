import type { WorldHierarchy } from "@dk/scene-compiler";
import type { AssetStatus } from "./presentation.ts";

/**
 * next-C active-environment framing. In a mixed world the castle and graph open on ONE environment (the "active" one)
 * instead of the whole realm, so populated regions are readable; the realm overview is an explicit control. The
 * implicit default is presentation only: it never hides an asset, changes evidence, or writes the URL. An explicit
 * world focus (navigator, Realm overview, Active environment button) always wins.
 */
export interface EnvironmentRank { id: string; label: string; assetCount: number; urgent: number; findings: number }
export function environmentRanking(h: WorldHierarchy, statuses: ReadonlyMap<string, AssetStatus>): EnvironmentRank[] {
  const envs = h.realm.children.filter((n) => n.kind === "environment");
  return envs.map((n) => {
    const findings = new Set<string>(); let urgent = 0;
    for (const id of n.asset_ids) { const s = statuses.get(id); if (!s) continue; s.findingIds.forEach((f) => findings.add(f)); if (s.severity === "critical" || s.severity === "high") urgent++; }
    return { id: n.id, label: n.label, assetCount: n.asset_ids.length, urgent, findings: findings.size };
  }).sort((a, b) => b.urgent - a.urgent || b.findings - a.findings || b.assetCount - a.assetCount || a.id.localeCompare(b.id));
}
/** The environment framed by default, or null when the world has fewer than two populated environments. */
export function activeEnvironment(h: WorldHierarchy, statuses: ReadonlyMap<string, AssetStatus>): string | null {
  const r = environmentRanking(h, statuses).filter((e) => e.assetCount > 0);
  return r.length > 1 ? r[0]!.id : null;
}
const known = (h: WorldHierarchy, id: string): boolean => {
  const walk = (n: WorldHierarchy["realm"]): boolean => n.id === id || n.children.some(walk);
  return walk(h.realm);
};
export function effectiveWorldFocus(h: WorldHierarchy, focus: string | null | undefined, statuses: ReadonlyMap<string, AssetStatus>): { id: string | null; implicit: boolean; environments: number } {
  const environments = h.realm.children.filter((n) => n.kind === "environment" && n.asset_ids.length).length;
  if (focus && known(h, focus)) return { id: focus, implicit: false, environments };
  const active = activeEnvironment(h, statuses);
  return active ? { id: active, implicit: true, environments } : { id: null, implicit: false, environments };
}
