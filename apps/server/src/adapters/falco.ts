import type { IngestEvent, Severity } from "@dk/contracts";

/**
 * Falco http_output adapter. Falco posts one JSON alert per request:
 * { output, priority, rule, time, output_fields: {...}, source, tags, hostname }.
 * Container/k8s names map to assets by alias. The full output line is kept as redacted evidence.
 */
const PRIORITY: Record<string, Severity> = {
  emergency: "critical", alert: "critical", critical: "critical", error: "high", warning: "high", notice: "medium", informational: "low", info: "low", debug: "info",
};

export function falcoToIngest(alert: Record<string, unknown>, fallbackId: string): IngestEvent {
  const fields = (alert.output_fields ?? {}) as Record<string, unknown>;
  const candidates = [fields["k8s.deployment.name"], fields["k8s.pod.name"], fields["container.name"], alert.hostname]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .map((s) => s.replace(/-[a-z0-9]{5,10}(-[a-z0-9]{5})?$/, "")); // strip replica suffixes
  const raw = [fields["k8s.deployment.name"], fields["container.name"], alert.hostname].filter((x): x is string => typeof x === "string");
  const time = typeof alert.time === "string" ? alert.time : new Date().toISOString();
  const rule = String(alert.rule ?? "falco rule").slice(0, 200);
  return {
    source_event_id: String(fields["evt.num"] ?? alert.uuid ?? fallbackId).replace(/[^A-Za-z0-9_.:/-]/g, "-").slice(0, 160) || fallbackId,
    occurred_at: new Date(time).toISOString(),
    asset_ids: [...new Set([...candidates, ...raw])].slice(0, 8).map((s) => s.slice(0, 160)),
    action: "runtime_alert",
    outcome: "unknown",
    rule_ref: rule,
    severity: PRIORITY[String(alert.priority ?? "").toLowerCase()] ?? "medium",
    evidence: { output: String(alert.output ?? "").slice(0, 2000), priority: alert.priority, source: alert.source, tags: alert.tags },
  };
}
