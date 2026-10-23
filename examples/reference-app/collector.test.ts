import { describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { gzipSync } from "node:zlib";
import { setup, liveGraph } from "../../apps/server/test/helpers.ts";

/**
 * R02.2 real OpenTelemetry Collector conformance. Runs only when OTELCOL_BIN points at an otelcol (core) binary;
 * CI downloads a pinned release. The collector receives OTLP/HTTP JSON and exports with the otlphttp exporter
 * (JSON encoding, gzip) to Digital Kingdom, exactly as a user would configure it.
 */
const BIN = process.env.OTELCOL_BIN;
const freePort = () => new Promise<number>((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined | Promise<T | undefined>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error("timed out"); await sleep(200); }
}
const span = (trace: string, route: string) => ({ resourceSpans: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "checkout-api" } }] }, scopeSpans: [{ spans: [{ traceId: trace, spanId: trace.slice(16), name: "GET", kind: 2, startTimeUnixNano: String(BigInt(Date.now() - 50) * 1_000_000n), endTimeUnixNano: String(BigInt(Date.now()) * 1_000_000n), attributes: [{ key: "http.route", value: { stringValue: route } }, { key: "http.response.status_code", value: { intValue: 200 } }] }] }] }] });
const hex = (n: number) => n.toString(16).padStart(32, "0");

describe.skipIf(!BIN)("R02.2 OpenTelemetry Collector binary conformance", () => {
  it("exports through a real collector, retries while Digital Kingdom is down, survives a collector restart, and stays bounded on decompression", async () => {
    const ctx = await setup();
    await ctx.app.inject({ method: "POST", url: "/api/projects", headers: ctx.h(ctx.admin), payload: { id: "shop", name: "Shop", dataset_kind: "live" } });
    await ctx.app.inject({ method: "POST", url: "/api/projects/shop/graph", headers: ctx.h(ctx.admin), payload: liveGraph() });
    const key = (await ctx.app.inject({ method: "POST", url: "/api/projects/shop/sources", headers: ctx.h(ctx.admin), payload: { id: "otel", label: "collector", kind: "otel", asset_ids: ["api"], connector_id: "dk.otlp.traces" } })).json().key as string;
    const dkPort = await freePort(), rxPort = await freePort();
    let base = await ctx.app.listen({ port: dkPort, host: "127.0.0.1" });
    const dir = mkdtempSync(join(tmpdir(), "otelcol-"));
    const cfg = join(dir, "config.yaml");
    writeFileSync(cfg, `receivers:
  otlp:
    protocols:
      http: { endpoint: "127.0.0.1:${rxPort}" }
exporters:
  otlphttp:
    traces_endpoint: "http://127.0.0.1:${dkPort}/v1/traces"
    encoding: json
    compression: gzip
    headers: { authorization: "Bearer ${key}" }
    retry_on_failure: { enabled: true, initial_interval: 200ms, max_interval: 1s, max_elapsed_time: 60s }
    sending_queue: { enabled: true }
processors:
  batch: { timeout: 100ms }
service:
  telemetry: { logs: { level: warn }, metrics: { level: none } }
  pipelines:
    traces: { receivers: [otlp], processors: [batch], exporters: [otlphttp] }
`);
    const start = () => { const p = spawn(BIN!, ["--config", cfg], { stdio: ["ignore", "ignore", "pipe"] }); p.stderr?.on("data", (d) => { if (process.env.OTELCOL_DEBUG) console.log("OTELCOL", String(d)); }); return p; };
    let col: ChildProcess = start();
    const send = async (trace: string, route: string) => until(async () => { try { const r = await fetch(`http://127.0.0.1:${rxPort}/v1/traces`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(span(trace, route)) }); return r.ok ? r : undefined; } catch { return undefined; } }, 15_000);
    const seen = (route: string) => { while (ctx.store.processBatch().processed) { /* drain */ } return ctx.store.listEvents("shop", { limit: 100 }).find((e) => e.route === route); };
    try {
      await send(hex(1), "/conformance/one");
      const e1 = await until(() => seen("/conformance/one"));
      expect(e1).toMatchObject({ source_id: "otel", asset_ids: ["api"], sampled: true });

      // Digital Kingdom down: the collector queues and retries; nothing is lost once it is back
      await ctx.app.close();
      await send(hex(2), "/conformance/during-outage");
      await sleep(1500);
      const { buildApp } = await import("../../apps/server/src/app.ts");
      const app2 = await buildApp({ store: ctx.store, secret: "test-secret", demoMode: false, webDist: "/nonexistent" });
      base = await app2.listen({ port: dkPort, host: "127.0.0.1" });
      expect(await until(() => seen("/conformance/during-outage"))).toBeTruthy();

      // collector restart: new process, same config, delivery continues
      col.kill("SIGTERM"); await new Promise((r) => col.once("exit", r));
      col = start();
      await send(hex(3), "/conformance/after-restart");
      expect(await until(() => seen("/conformance/after-restart"))).toBeTruthy();

      // decompressed-size bound: a gzip body inflating past the cap is refused, never buffered whole
      const bomb = gzipSync(Buffer.alloc(40 * 1_048_576, 0x20));
      const r = await fetch(`${base}/v1/traces`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "content-encoding": "gzip" }, body: bomb });
      expect(r.status).toBe(413);
      await app2.close();
    } finally { col.kill("SIGKILL"); }
  }, 90_000);
});
