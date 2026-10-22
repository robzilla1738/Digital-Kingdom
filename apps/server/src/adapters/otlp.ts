import type { IngestEvent } from "@dk/contracts";

/**
 * Minimal OTLP/HTTP JSON trace mapping (selected spans only). Spans become request_received context events
 * keyed by service.name. Sampled performance traces are context, NOT a complete security ledger, so every
 * mapped event is marked sampled=true. Only spans with http.route/url.path or a dk.security attribute are kept.
 */
interface AnyValue { stringValue?: string; intValue?: string | number; boolValue?: boolean }
interface KV { key: string; value: AnyValue }
const val = (v: AnyValue | undefined) => v?.stringValue ?? (v?.intValue !== undefined ? Number(v.intValue) : v?.boolValue);
const attrs = (kvs: KV[] | undefined) => Object.fromEntries((kvs ?? []).slice(0, 64).map((kv) => [kv.key, val(kv.value)]));

export function otlpToIngest(body: unknown, maxSpans = 500): { events: IngestEvent[]; skipped: number } {
  const events: IngestEvent[] = [];
  let skipped = 0;
  const rs = ((body as { resourceSpans?: unknown[] })?.resourceSpans ?? []) as { resource?: { attributes?: KV[] }; scopeSpans?: { spans?: Record<string, unknown>[] }[] }[];
  for (const r of rs) {
    const ra = attrs(r.resource?.attributes);
    const service = typeof ra["service.name"] === "string" ? (ra["service.name"] as string) : undefined;
    for (const ss of r.scopeSpans ?? []) for (const span of ss.spans ?? []) {
      if (events.length >= maxSpans) { skipped++; continue; }
      const a = attrs(span.attributes as KV[]);
      const route = (a["http.route"] ?? a["url.path"]) as string | undefined;
      if (!service || (!route && !a["dk.security"])) { skipped++; continue; }
      const status = Number(a["http.response.status_code"] ?? a["http.status_code"] ?? 0);
      const traceId = typeof span.traceId === "string" && /^[0-9a-f]{32}$/.test(span.traceId) ? span.traceId : undefined;
      const start = Number(BigInt(String(span.startTimeUnixNano ?? "0")) / 1_000_000n);
      events.push({
        source_event_id: `${String(span.traceId ?? "t")}-${String(span.spanId ?? events.length)}`.replace(/[^A-Za-z0-9_.:/-]/g, "").slice(0, 160),
        occurred_at: new Date(start || Date.now()).toISOString(),
        asset_ids: [service.slice(0, 160)],
        action: "request_received",
        outcome: status >= 400 && status < 500 ? "denied" : status >= 500 ? "failure" : status ? "success" : "unknown",
        ...(traceId ? { trace_id: traceId } : {}),
        ...(route ? { route: String(route).slice(0, 300) } : {}),
        sampled: true,
        attributes: Object.fromEntries(Object.entries({ "http.method": a["http.request.method"] ?? a["http.method"], status, span_name: span.name }).filter(([, v]) => v !== undefined && v !== "" ).map(([k, v]) => [k, typeof v === "object" ? String(v) : (v as string | number | boolean)])),
        coverage_note: "Derived from a sampled trace span; unsampled requests are not represented.",
      });
    }
  }
  return { events, skipped };
}
