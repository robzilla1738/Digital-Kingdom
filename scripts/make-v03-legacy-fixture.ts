/**
 * Generates fixtures/legacy/v0.3-journal.sqlite with the GENUINE v0.3 code (commit 83df9bb), so the
 * upgrade test exercises the real v0.3 storage format rather than a reconstruction.
 *
 *   git worktree add /tmp/v03wt 83df9bb
 *   (link node_modules into the worktree; see docs/UPGRADING.md)
 *   cd /tmp/v03wt && npx tsx <this repo>/scripts/make-v03-legacy-fixture.ts <out.sqlite>
 *
 * Must be run with cwd = the v0.3 worktree: it imports the server from ./apps/server/src.
 */
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
const root = process.cwd();
const out = resolve(process.argv[2] ?? "v0.3-journal.sqlite");
for (const s of ["", "-wal", "-shm"]) rmSync(out + s, { force: true });
const { openDb } = await import(join(root, "apps/server/src/db.ts"));
const { Store } = await import(join(root, "apps/server/src/store.ts"));
const { buildApp } = await import(join(root, "apps/server/src/app.ts"));
const store = new Store(openDb(out), { now: () => new Date("2026-10-21T12:00:00Z") });
const admin = store.createToken("fixture admin", "admin").token;
const app = await buildApp({ store, secret: "fixture", demoMode: false, planner: null, webDist: "/nonexistent" });
const H = { authorization: `Bearer ${admin}` };
const must = async (r: Promise<{ statusCode: number; body: string; json(): any }>, code = 200) => { const x = await r; if (x.statusCode !== code) throw new Error(`${x.statusCode} ${x.body}`); return x.json(); };
await must(app.inject({ method: "POST", url: "/api/projects", headers: H, payload: { id: "legacy", name: "v0.3 legacy", dataset_kind: "live" } }));
await must(app.inject({ method: "POST", url: "/api/projects/legacy/graph?format=manifest&revision=r1", headers: { ...H, "content-type": "application/yaml" },
  payload: "project: legacy\nenvironment: staging\nassets:\n  - {id: edge, name: edge-proxy, kind: edge}\n  - {id: api, name: checkout-api, kind: service}\nrelationships:\n  - {from: edge, to: api}\n" }));
const key = (await must(app.inject({ method: "POST", url: "/api/projects/legacy/sources", headers: H, payload: { id: "app", label: "checkout events", kind: "app_security", asset_ids: ["api"] } }))).key;
const ingest = (payload: unknown) => must(app.inject({ method: "POST", url: "/ingest/events", headers: { authorization: `Bearer ${key}` }, payload }), 202);
const base = { occurred_at: "2026-10-21T11:59:00Z", asset_ids: ["checkout-api"], action: "authentication", outcome: "failure", actor_ref: "a1" };
// processed before the upgrade: redaction happened, so v0.3 added evidence._dk_redaction
await ingest({ ...base, source_event_id: "v03-processed", evidence: { password: "hunter2-fixture", note: "ok" } });
while (store.processBatch().processed) { /* drain */ }
// pending at upgrade time
await ingest({ ...base, source_event_id: "v03-pending-evidence", evidence: { password: "hunter2-fixture", note: "kept" } });
await ingest({ ...base, source_event_id: "v03-pending-note-only", coverage_note: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123" }); // v0.3 created evidence only to carry the metadata
await ingest({ ...base, source_event_id: "v03-pending-clean" });
await app.close();
store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
store.db.close();
console.log("wrote", out);
