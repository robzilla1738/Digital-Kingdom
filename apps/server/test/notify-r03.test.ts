import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { buildApp } from "../src/app.ts";
import { seedDemo } from "../src/seed.ts";
import type { FetchLike } from "../src/notify.ts";

/** R03.5 notification outbox: durable, deduplicated, scoped, signed, retried, escalated, acknowledged. */
interface Sent { url: string; headers: Record<string, string>; body: string }
function receiver(statuses: (number | "throw")[] = [], only = "/oncall") {
  const sent: Sent[] = [];
  const fetch: FetchLike = async (url, init) => {
    sent.push({ url, headers: init.headers, body: init.body });
    const s = url.endsWith(only) && statuses.length ? statuses.shift()! : 200;
    if (s === "throw") throw new Error("connect ECONNREFUSED");
    return { status: s };
  };
  return { sent, fetch };
}

async function boot(dbPath: string, fetch: FetchLike, clock: { t: number }) {
  const store = new Store(openDb(dbPath), { now: () => new Date(clock.t) });
  seedDemo(store);
  const app = await buildApp({ store, secret: "s", demoMode: false, planner: null, webDist: "/nonexistent", notifyFetch: fetch, publicUrl: "https://dk.example.test", notifyAllowLoopback: true });
  return { store, app };
}

describe("R03.5 notification outbox", () => {
  it("routes only in-scope projects, signs minimal payloads, deduplicates, and survives restart without resending", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dk-notify-")), db = join(dir, "dk.db");
    const clock = { t: Date.parse("2026-10-23T12:00:00Z") };
    const rx = receiver();
    let { store, app } = await boot(db, rx.fetch, clock);
    const admin = store.createToken("admin", "admin").token, analyst = store.createToken("analyst", "analyst").token;
    const h = (t: string) => ({ authorization: `Bearer ${t}` });
    const bad = await app.inject({ method: "POST", url: "/api/notifications/destinations", headers: h(admin), payload: { name: "x", url: "http://hooks.example.test/x", project_ids: ["demo-castle"] } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/notifications/destinations", headers: h(analyst), payload: {} })).statusCode).toBe(403);
    const mine = (await app.inject({ method: "POST", url: "/api/notifications/destinations", headers: h(admin), payload: { name: "oncall", url: "https://hooks.example.test/oncall", project_ids: ["demo-castle"], min_severity: "medium" } })).json();
    const other = (await app.inject({ method: "POST", url: "/api/notifications/destinations", headers: h(admin), payload: { name: "shared-channel", url: "https://hooks.example.test/shared", project_ids: ["some-other-project"], min_severity: "low" } })).json();
    expect(mine.signing_secret).toMatch(/^[0-9a-f]{64}$/);
    const list = (await app.inject({ method: "GET", url: "/api/notifications/destinations", headers: h(admin) })).json();
    expect(JSON.stringify(list)).not.toContain(mine.signing_secret);

    const c = (await app.inject({ method: "POST", url: "/api/projects/demo-castle/cases", headers: h(analyst), payload: { title: "Exfil via api token sk_live_SECRET123", owner: "alice", closure_criteria: "explain the export", scope: { question: "who exported customers.csv", asset_ids: [] } } })).json();
    expect(c.id).toBeTruthy();
    await app.notifier.deliver();
    expect(rx.sent).toHaveLength(1);
    const msg = rx.sent[0]!;
    expect(msg.url).toBe("https://hooks.example.test/oncall");
    expect(msg.headers["x-dk-signature"]).toBe(`sha256=${createHmac("sha256", mine.signing_secret).update(msg.body).digest("hex")}`);
    const p = JSON.parse(msg.body);
    expect(p).toMatchObject({ kind: "case_assigned", project_id: "demo-castle", case_id: c.id, link: `https://dk.example.test/#/projects/demo-castle/cases/${c.id}` });
    expect(msg.body).not.toMatch(/SECRET123|Exfil|export/); // no titles or evidence leave the server
    expect(rx.sent.some((s) => s.url.endsWith("/shared"))).toBe(false); // other project's channel gets nothing

    // same matter again: no duplicate row, no duplicate send
    expect(app.notifier.enqueue({ projectId: "demo-castle", kind: "case_assigned", severity: "medium", dedupKey: `case:${c.id}:owner:alice`, owner: "alice", caseId: c.id })).toEqual([]);
    await app.notifier.deliver();
    expect(rx.sent).toHaveLength(1);

    // restart on the same database: delivered stays delivered, nothing is resent
    await app.close();
    ({ store, app } = await boot(db, rx.fetch, clock));
    await app.notifier.deliver();
    expect(rx.sent).toHaveLength(1);
    const st = (await app.inject({ method: "GET", url: "/api/projects/demo-castle/notifications/status", headers: h(admin) })).json();
    expect(st.counts.delivered).toBe(1);
    expect(st.recent[0].last_receipt.outcome).toBe("delivered");
    expect(other.id).toBeTruthy();
    await app.close();
  });

  it("retries with backoff, surfaces failures, honours quiet windows, escalates, and acknowledgement survives restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dk-notify-")), db = join(dir, "dk.db");
    const clock = { t: Date.parse("2026-10-23T03:00:00Z") };
    const rx = receiver([503, "throw"]);
    let { store, app } = await boot(db, rx.fetch, clock);
    const admin = store.createToken("admin", "admin").token, analyst = store.createToken("analyst", "analyst").token;
    const h = (t: string) => ({ authorization: `Bearer ${t}` });
    const boss = (await app.inject({ method: "POST", url: "/api/notifications/destinations", headers: h(admin), payload: { name: "lead", url: "https://hooks.example.test/lead", project_ids: ["demo-castle"], min_severity: "high" } })).json();
    const d = (await app.inject({ method: "POST", url: "/api/notifications/destinations", headers: h(admin), payload: { name: "oncall", url: "https://hooks.example.test/oncall", project_ids: ["demo-castle"], min_severity: "low", quiet_start_utc: 2, quiet_end_utc: 6, escalate_to: boss.id, escalate_after_seconds: 600, max_attempts: 3 } })).json();

    // quiet window: medium is deferred to 06:00, critical goes now
    app.notifier.enqueue({ projectId: "demo-castle", kind: "finding_raised", severity: "medium", dedupKey: "f:quiet" });
    app.notifier.enqueue({ projectId: "demo-castle", kind: "finding_raised", severity: "critical", dedupKey: "f:crit" });
    await app.notifier.deliver();
    expect(rx.sent.filter((s) => s.url.endsWith("/oncall")).map((s) => JSON.parse(s.body).severity)).toEqual(["critical"]); // first attempt answered 503
    expect(rx.sent.filter((s) => s.url.endsWith("/lead"))).toHaveLength(1); // lead routes high+ directly too
    let st = app.notifier.status("demo-castle");
    expect(st.failures.find((f) => f.destination_id === d.id)).toMatchObject({ state: "pending", last_error: "HTTP 503", attempts: 1 });

    clock.t += 31_000; await app.notifier.deliver();   // second attempt throws
    clock.t += 61_000; await app.notifier.deliver();   // third attempt (200) but medium still quiet
    const crit = rx.sent.filter((s) => s.url.endsWith("/oncall") && JSON.parse(s.body).severity === "critical");
    expect(crit).toHaveLength(3);
    expect(new Set(crit.map((s) => s.headers["x-dk-delivery-id"])).size).toBe(1); // stable idempotency key
    st = app.notifier.status("demo-castle");
    expect(st.counts.delivered).toBe(2);

    // escalation of the unacknowledged critical after 10 minutes, once
    clock.t += 600_000;
    expect(app.notifier.escalate().escalated).toBe(1);
    expect(app.notifier.escalate().escalated).toBe(0);
    await app.notifier.deliver();
    expect(rx.sent.filter((s) => s.url.endsWith("/lead")).map((s) => JSON.parse(s.body).kind)).toEqual(["finding_raised", "escalation"]);

    // ack the medium before quiet ends; restart; it never sends
    const medium = st.recent.find((r) => r.severity === "medium" && r.state === "pending")!;
    expect((await app.inject({ method: "POST", url: `/api/projects/demo-castle/notifications/${medium.id}/ack`, headers: h(analyst) })).json().acknowledged).toBe(1);
    await app.close();
    ({ store, app } = await boot(db, rx.fetch, clock));
    clock.t = Date.parse("2026-10-23T07:00:00Z");
    await app.notifier.deliver();
    expect(rx.sent.some((s) => JSON.parse(s.body).severity === "medium")).toBe(false);

    // permanent failure becomes visible as failed
    const rx2 = receiver(["throw", "throw", "throw"]);
    await app.close();
    ({ store, app } = await boot(db, rx2.fetch, clock));
    app.notifier.enqueue({ projectId: "demo-castle", kind: "finding_raised", severity: "low", dedupKey: "f:dead" });
    for (let i = 0; i < 3; i++) { await app.notifier.deliver(); clock.t += 3600_000; }
    st = app.notifier.status("demo-castle");
    expect(st.failures.find((f) => f.state === "failed")).toMatchObject({ attempts: 3, last_error: "connect ECONNREFUSED", destination_id: d.id });
    expect(st.note).toMatch(/not investigation outcomes/);
    await app.close();
  });
});
