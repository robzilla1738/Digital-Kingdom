import { createGunzip } from "node:zlib";
import { Transform, type Readable } from "node:stream";
import type { IngestEvent } from "@dk/contracts";
import { HttpError } from "../store.ts";

/**
 * OTLP/HTTP JSON trace mapping (ExportTraceServiceRequest, JSON encoding only).
 * - Spans with http.route / url.path / dk.security become request_received context events keyed by
 *   service.name. Other spans are accepted and intentionally not stored (they are not rejections).
 * - Sampled traces are context, not a complete security ledger: every mapped event is marked sampled.
 * - Structurally invalid spans (no traceId/spanId, bad timestamps) are counted as rejected spans.
 * - Retries are idempotent: the event id derives from traceId + spanId.
 */
interface AnyValue { stringValue?: string; intValue?: string | number; boolValue?: boolean; doubleValue?: number }
interface KV { key: string; value?: AnyValue }
const val = (v: AnyValue | undefined) => v?.stringValue ?? (v?.intValue !== undefined ? Number(v.intValue) : v?.doubleValue ?? v?.boolValue);
const attrs = (kvs: unknown) => Object.fromEntries((Array.isArray(kvs) ? (kvs as KV[]) : []).slice(0, 64).filter((kv) => kv && typeof kv.key === "string").map((kv) => [kv.key, val(kv.value)]));
const HEX32 = /^[0-9a-f]{32}$/i, HEX16 = /^[0-9a-f]{16}$/i;

export function otlpToIngest(body: unknown, maxSpans = 2000): { events: IngestEvent[]; filtered: number; invalid: number } {
  const events: IngestEvent[] = [];
  let filtered = 0, invalid = 0;
  const rs = ((body as { resourceSpans?: unknown[] })?.resourceSpans ?? []) as { resource?: { attributes?: KV[] }; scopeSpans?: { spans?: Record<string, unknown>[] }[] }[];
  for (const r of rs) {
    const ra = attrs(r?.resource?.attributes);
    const service = typeof ra["service.name"] === "string" ? (ra["service.name"] as string) : undefined;
    for (const ss of Array.isArray(r?.scopeSpans) ? r.scopeSpans : []) for (const span of Array.isArray(ss?.spans) ? ss.spans : []) {
      if (events.length + invalid >= maxSpans) { invalid++; continue; }
      const traceId = String(span?.traceId ?? ""), spanId = String(span?.spanId ?? "");
      let startMs = NaN;
      try { startMs = Number(BigInt(String(span?.startTimeUnixNano ?? "x")) / 1_000_000n); } catch { /* invalid */ }
      if (!HEX32.test(traceId) || !HEX16.test(spanId) || !Number.isFinite(startMs) || startMs <= 0) { invalid++; continue; }
      const a = attrs(span.attributes);
      const route = (a["http.route"] ?? a["url.path"]) as string | undefined;
      if (!service || (!route && !a["dk.security"])) { filtered++; continue; }
      const status = Number(a["http.response.status_code"] ?? a["http.status_code"] ?? 0);
      const attributes: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries({ "http.method": a["http.request.method"] ?? a["http.method"], status: status || undefined, span_name: typeof span.name === "string" ? span.name.slice(0, 200) : undefined })) if (v !== undefined && v !== "") attributes[k] = v as string | number | boolean;
      events.push({
        source_event_id: `${traceId.toLowerCase()}-${spanId.toLowerCase()}`,
        occurred_at: new Date(startMs).toISOString(),
        asset_ids: [service.slice(0, 160)],
        action: "request_received",
        outcome: status >= 400 && status < 500 ? "denied" : status >= 500 ? "failure" : status ? "success" : "unknown",
        trace_id: traceId.toLowerCase(),
        ...(route ? { route: String(route).slice(0, 300) } : {}),
        sampled: true,
        ...(Object.keys(attributes).length ? { attributes } : {}),
        coverage_note: "Derived from a sampled trace span; unsampled requests are not represented.",
      });
    }
  }
  return { events, filtered, invalid };
}

/** gzip decoding with a hard cap on DECOMPRESSED bytes (decompression-bomb protection). */
export function gunzipCapped(input: Readable, maxBytes: number): Readable {
  let total = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) { cb(new HttpError(413, `decompressed body exceeds ${maxBytes} bytes`)); return; }
      cb(null, chunk);
    },
  });
  const gunzip = createGunzip();
  gunzip.on("error", (e) => cap.destroy(Object.assign(new HttpError(400, `invalid gzip body: ${e.message}`))));
  input.pipe(gunzip).pipe(cap);
  // fastify reads receivedEncodedLength for its limit accounting
  (cap as unknown as { receivedEncodedLength: number }).receivedEncodedLength = 0;
  input.on("data", (c: Buffer) => { (cap as unknown as { receivedEncodedLength: number }).receivedEncodedLength += c.length; });
  return cap;
}
