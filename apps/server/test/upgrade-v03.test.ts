import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { stableId } from "@dk/contracts";

/**
 * fixtures/legacy/v0.3-journal.sqlite was written by the genuine v0.3 code (commit 83df9bb) via
 * scripts/make-v03-legacy-fixture.ts: one processed row and three rows acknowledged but still pending,
 * two of which carry v0.3's in-payload evidence._dk_redaction report.
 */
const FIXTURE = join(import.meta.dirname, "../../../fixtures/legacy/v0.3-journal.sqlite");
function copy() { const dir = mkdtempSync(join(tmpdir(), "dk-v03-")); const p = join(dir, "db.sqlite"); copyFileSync(FIXTURE, p); return p; }
const rows = (s: Store) => s.db.prepare("SELECT seq, source_event_id, payload, meta, minimized FROM journal ORDER BY seq").all() as { seq: number; source_event_id: string; payload: string; meta: string | null; minimized: number }[];

describe("upgrading a genuine v0.3 database", () => {
  it("the fixture really is v0.3 with pending rows carrying in-payload _dk_redaction", () => {
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const raw = new DatabaseSync(copy());
    expect(raw.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()).toEqual({ v: 2 });
    expect(raw.prepare("SELECT last_seq FROM checkpoints WHERE name = 'normalizer'").get()).toEqual({ last_seq: 1 });
    const payloads = raw.prepare("SELECT payload FROM journal WHERE seq > 1").all().map((r) => String((r as { payload: string }).payload));
    expect(payloads.filter((p) => p.includes('"_dk_redaction"'))).toHaveLength(2);
    raw.close();
  });

  it("pending v0.3 rows are converted, not tombstoned, and process exactly once", () => {
    const path = copy();
    const s = new Store(openDb(path));
    const after = rows(s);
    expect(after.map((r) => r.minimized)).toEqual([1, 1, 1, 1]);
    expect(after.some((r) => r.payload.includes("_dk_"))).toBe(false);
    const meta = JSON.parse(after.find((r) => r.source_event_id === "v03-pending-evidence")!.meta!);
    expect(meta).toMatchObject({ legacy: true, legacy_format: "v0.3-evidence-redaction", redaction: { removed_keys: ["password"], masked_values: 0 } });
    expect(JSON.parse(after.find((r) => r.source_event_id === "v03-pending-clean")!.meta!).legacy_format).toBeUndefined();

    expect(s.processBatch()).toMatchObject({ processed: 3, quarantined: 0 });
    const events = s.listEvents("legacy");
    expect(events.map((e) => e.source_event_id).sort()).toEqual(["v03-pending-clean", "v03-pending-evidence", "v03-pending-note-only", "v03-processed"]);
    const ev = events.find((e) => e.source_event_id === "v03-pending-evidence")!;
    expect(ev.coverage_note).toMatch(/Redacted at ingestion: 1 field\(s\) removed/);
    const evidence = s.getEvidence("legacy", `evidence:${ev.id}`)!;
    expect(evidence).toMatchObject({ note: "kept", redacted: true });
    expect(JSON.stringify(evidence)).not.toMatch(/_dk_|hunter2/);
    expect(events.find((e) => e.source_event_id === "v03-pending-note-only")!.coverage_note).toMatch(/1 value\(s\) masked/);
    // the v0.3-processed event and the new ones share the same id scheme
    for (const e of events) expect(e.id).toBe(stableId("ev", "legacy", "app", e.source_event_id));

    // dedup keys survive; producers still cannot send _dk_ fields
    const base = { occurred_at: "2026-10-21T11:59:00Z", asset_ids: ["checkout-api"], action: "authentication", outcome: "failure" };
    for (const id of ["v03-processed", "v03-pending-evidence", "v03-pending-clean"]) expect(s.receive("legacy", "app", { ...base, source_event_id: id }).status).toBe("duplicate");
    expect(s.receive("legacy", "app", { ...base, source_event_id: "new", evidence: { _dk_redaction: { removed_keys: [], masked_values: 0 } } }).status).toBe("rejected");
    s.db.close();

    const again = new Store(openDb(path));
    expect(again.processBatch().processed).toBe(0);
    expect(again.listEvents("legacy")).toHaveLength(4);
    again.db.close();
  });

  it("malformed legacy metadata is sanitized; other reserved keys still tombstone", () => {
    const path = copy();
    const s = new Store(openDb(path));
    s.processBatch();
    const ins = (id: string, evidence: unknown) => s.db.prepare("INSERT INTO journal (project_id, source_id, source_event_id, payload, received_at, minimized) VALUES ('legacy','app',?,?,?,0)")
      .run(id, JSON.stringify({ source_event_id: id, occurred_at: "2026-10-21T11:59:00Z", asset_ids: ["checkout-api"], action: "authentication", outcome: "failure", evidence }), "2026-10-21T12:00:00Z");
    ins("bad-string", { a: 1, _dk_redaction: "garbage" });
    ins("bad-number", { _dk_redaction: 5 });
    ins("bad-shape", { _dk_redaction: { removed_keys: 5, masked_values: "many" } });
    ins("bad-array", { _dk_redaction: [{ x: 1 }] });
    ins("nested-reserved", { inner: { _dk_other: true } });
    expect(s.minimizeLegacyJournal()).toEqual({ rewritten: 4, tombstoned: 1 });
    const r = s.processBatch();
    expect(r.quarantined).toBe(0);
    const got = s.listEvents("legacy").map((e) => e.source_event_id);
    expect(got).toEqual(expect.arrayContaining(["bad-string", "bad-number", "bad-shape", "bad-array"]));
    expect(got).not.toContain("nested-reserved");
    for (const id of ["bad-number", "bad-shape", "bad-array"]) expect(s.listEvents("legacy").find((e) => e.source_event_id === id)!.coverage_note ?? "").not.toMatch(/Redacted/);
    s.db.close();
  });
});
