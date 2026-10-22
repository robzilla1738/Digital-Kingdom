import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { setup, liveGraph } from "./helpers.ts";

/**
 * Fix 5: OTLP/HTTP protocol behaviour, exercised with the official OpenTelemetry JS exporter
 * (@opentelemetry/exporter-trace-otlp-http, JSON encoding) plus hand-built edge cases.
 */
async function otelProject() {
  const ctx = await setup();
  await ctx.app.inject({ method: "POST", url: "/api/projects", headers: ctx.h(ctx.admin), payload: { id: "shop", name: "Shop", dataset_kind: "live" } });
  await ctx.app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: ctx.h(ctx.admin), payload: liveGraph() });
  const key = (await ctx.app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: ctx.h(ctx.admin), payload: { id: "otel", label: "OTel", kind: "otel", asset_ids: ["api"] } })).json().key as string;
  const base = await ctx.app.listen({ port: 0, host: "127.0.0.1" });
  return { ctx, key, base };
}

async function exportWith(base: string, key: string, compression: "gzip" | "none", spans: { route?: string; status?: number }[]) {
  const exporter = new OTLPTraceExporter({ url: `${base}/v1/traces`, headers: { authorization: `Bearer ${key}` }, compression: compression as never });
  const results: { code: number; error?: Error }[] = [];
  const wrapped = { export: (s: never, cb: (r: { code: number; error?: Error }) => void) => exporter.export(s, (r) => { results.push(r); cb(r); }), shutdown: () => exporter.shutdown(), forceFlush: () => exporter.forceFlush() };
  const provider = new BasicTracerProvider({ resource: resourceFromAttributes({ "service.name": "checkout-api" }), spanProcessors: [new SimpleSpanProcessor(wrapped as never)] });
  const tracer = provider.getTracer("test");
  for (const s of spans) {
    const span = tracer.startSpan("GET " + (s.route ?? "internal"));
    if (s.route) span.setAttribute("http.route", s.route);
    if (s.status) span.setAttribute("http.response.status_code", s.status);
    span.end();
  }
  await provider.forceFlush(); await provider.shutdown();
  return results;
}

describe("fix 5: OTLP/HTTP compatibility", () => {
  it("official exporter (uncompressed) succeeds: HTTP 200, spans become events", async () => {
    const { ctx, key, base } = await otelProject();
    const results = await exportWith(base, key, "none", [{ route: "/cart/:id", status: 200 }, { route: "/admin", status: 403 }, {}]);
    expect(results.every((r) => r.code === 0)).toBe(true); // ExportResultCode.SUCCESS
    ctx.store.processBatch();
    const evs = ctx.store.listEvents("shop");
    expect(evs.map((e) => e.outcome).sort()).toEqual(["denied", "success"]); // the route-less span is accepted but not stored
    expect(evs.every((e) => e.sampled && e.asset_ids[0] === "api")).toBe(true);
    await ctx.app.close();
  });
  it("official exporter with gzip compression succeeds", async () => {
    const { ctx, key, base } = await otelProject();
    const results = await exportWith(base, key, "gzip", [{ route: "/checkout", status: 500 }]);
    expect(results.every((r) => r.code === 0)).toBe(true);
    ctx.store.processBatch();
    expect(ctx.store.listEvents("shop")[0]!.outcome).toBe("failure");
    await ctx.app.close();
  });
  it("retries are idempotent (same span delivered twice is stored once)", async () => {
    const { ctx, key, base } = await otelProject();
    const body = { resourceSpans: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "checkout-api" } }] }, scopeSpans: [{ spans: [{ traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", name: "x", startTimeUnixNano: "1761040800000000000", attributes: [{ key: "http.route", value: { stringValue: "/a" } }] }] }] }] };
    for (let i = 0; i < 2; i++) expect((await fetch(`${base}/v1/traces`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body) })).status).toBe(200);
    ctx.store.processBatch();
    expect(ctx.store.listEvents("shop")).toHaveLength(1);
    await ctx.app.close();
  });
  it("partial rejection returns 200 with partialSuccess.rejectedSpans", async () => {
    const { ctx, key } = await otelProject();
    const span = (id: string, extra: Record<string, unknown> = {}) => ({ traceId: "1af7651916cd43dd8448eb211c80319c", spanId: id, name: "s", startTimeUnixNano: "1761040800000000000", attributes: [{ key: "http.route", value: { stringValue: "/r" } }], ...extra });
    const body = { resourceSpans: [
      { resource: { attributes: [{ key: "service.name", value: { stringValue: "checkout-api" } }] }, scopeSpans: [{ spans: [span("a7ad6b7169203331"), span("not-hex"), span("c7ad6b7169203331", { startTimeUnixNano: "garbage" })] }] },
      { resource: { attributes: [{ key: "service.name", value: { stringValue: "bad service name!" } }] }, scopeSpans: [{ spans: [span("d7ad6b7169203331")] }] },
    ] };
    const r = await ctx.app.inject({ method: "POST", url: "/v1/traces", headers: { authorization: `Bearer ${key}` }, payload: body });
    expect(r.statusCode).toBe(200);
    expect(r.json().partialSuccess.rejectedSpans).toBe("3");
    expect(r.json().partialSuccess.errorMessage).toMatch(/rejected/);
  });
  it("empty request -> 200 {}", async () => {
    const { ctx, key } = await otelProject();
    for (const payload of [{}, { resourceSpans: [] }]) {
      const r = await ctx.app.inject({ method: "POST", url: "/v1/traces", headers: { authorization: `Bearer ${key}` }, payload });
      expect([r.statusCode, r.json()]).toEqual([200, {}]);
    }
  });
  it("invalid input, wrong encoding, bad gzip and missing auth return Status-shaped errors", async () => {
    const { ctx, key } = await otelProject();
    const auth = { authorization: `Bearer ${key}` };
    const bad = await ctx.app.inject({ method: "POST", url: "/v1/traces", headers: { ...auth, "content-type": "application/json" }, payload: "{not json" });
    expect(bad.statusCode).toBe(400); expect(bad.json()).toHaveProperty("code"); expect(bad.json()).toHaveProperty("message");
    expect((await ctx.app.inject({ method: "POST", url: "/v1/traces", headers: auth, payload: { resourceSpans: "nope" } })).statusCode).toBe(400);
    const proto = await ctx.app.inject({ method: "POST", url: "/v1/traces", headers: { ...auth, "content-type": "application/x-protobuf" }, payload: Buffer.from([1, 2, 3]) });
    expect(proto.statusCode).toBe(415); expect(proto.json().message).toMatch(/protobuf|JSON|Unsupported/i);
    const gz = await ctx.app.inject({ method: "POST", url: "/v1/traces", headers: { ...auth, "content-type": "application/json", "content-encoding": "gzip" }, payload: Buffer.from("not gzip") });
    expect(gz.statusCode).toBe(400);
    const okGz = await ctx.app.inject({ method: "POST", url: "/v1/traces", headers: { ...auth, "content-type": "application/json", "content-encoding": "gzip" }, payload: gzipSync(JSON.stringify({ resourceSpans: [] })) });
    expect(okGz.statusCode).toBe(200);
    const noAuth = await ctx.app.inject({ method: "POST", url: "/v1/traces", payload: {} });
    expect(noAuth.statusCode).toBe(401); expect(noAuth.json().code).toBe(16);
  });
  it("gzip bombs are cut off at the decompressed-size cap", async () => {
    const { ctx, key } = await otelProject();
    const bomb = gzipSync(Buffer.concat([Buffer.from('{"resourceSpans":[],"pad":"'), Buffer.alloc(20 * 1024 * 1024, 97), Buffer.from('"}')]));
    expect(bomb.length).toBeLessThan(4 * 1024 * 1024);
    const r = await ctx.app.inject({ method: "POST", url: "/v1/traces", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "content-encoding": "gzip" }, payload: bomb });
    expect(r.statusCode).toBe(413);
  });
});
