import { describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { openDb } from "../src/db.ts";
import { Store } from "../src/store.ts";
import { diagnose } from "../../../scripts/diagnose-legacy-tombstones.ts";

/**
 * fixtures/legacy/v0.3-after-v0.3.1-startup.sqlite = the genuine v0.3 fixture after one startup of the
 * genuine v0.3.1 code (scripts/make-v031-startup-fixture.ts). Its pending _dk_redaction rows are tombstones.
 * v0.3.2+ must not pretend to recover them.
 */
const FIXTURE = join(import.meta.dirname, "../../../fixtures/legacy/v0.3-after-v0.3.1-startup.sqlite");
const copy = () => { const d = mkdtempSync(join(tmpdir(), "dk-tomb-")); const p = join(d, "db.sqlite"); copyFileSync(FIXTURE, p); return p; };
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

describe("existing v0.3.1 tombstones", () => {
  it("the read-only diagnostic identifies them, does not modify the database, and reports nothing as recovered", () => {
    const p = copy(); const before = sha(p);
    const r = diagnose(p);
    expect(sha(p)).toBe(before);
    expect(r.tombstones).toBe(3);
    expect(r.rows.map((x) => [x.source_event_id, x.classification, x.pending_at_checkpoint, x.normalized_event_exists])).toEqual([
      ["v03-processed", "v0.3.1-reserved-redaction", false, true],
      ["v03-pending-evidence", "v0.3.1-reserved-redaction", true, false],
      ["v03-pending-note-only", "v0.3.1-reserved-redaction", true, false],
    ]);
    expect(r.rows.every((x) => x.recovered === false)).toBe(true);
    expect(r.limits.join(" ")).toMatch(/does not prove/);
  });

  it("starting v0.3.2+ on that database leaves the tombstones as tombstones and creates no events for them", () => {
    const p = copy();
    const s = new Store(openDb(p));
    expect(s.minimizeLegacyJournal()).toEqual({ rewritten: 0, tombstoned: 0 }); // converter only touches unminimized rows
    const tomb = s.db.prepare("SELECT source_event_id, payload FROM journal WHERE minimized = 2 ORDER BY seq").all() as { source_event_id: string; payload: string }[];
    expect(tomb.map((t) => t.source_event_id)).toEqual(["v03-processed", "v03-pending-evidence", "v03-pending-note-only"]);
    expect(tomb.every((t) => t.payload === JSON.stringify({ _tombstone: true }))).toBe(true);
    s.processBatch();
    const evs = s.listEvents("legacy").map((e) => e.source_event_id).sort();
    expect(evs).toEqual(["v03-pending-clean", "v03-processed"]); // the pending tombstoned rows produced nothing
    expect(evs).not.toContain("v03-pending-evidence");
    // and a later replay of the same source record is collapsed by the existing dedup entry
    const r = s.receive("legacy", "app", { source_event_id: "v03-pending-evidence", occurred_at: "2026-10-21T11:59:00Z", asset_ids: ["checkout-api"], action: "authentication", outcome: "failure" });
    expect(r.status).toBe("duplicate");
    s.db.close();
  });
});
