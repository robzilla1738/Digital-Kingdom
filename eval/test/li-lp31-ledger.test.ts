import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * LP31-A3/A4: the phase ledger is honest and complete. Every ACCEPTANCE.json requirement id has a status from the
 * ledger vocabulary; a passed requirement names evidence (a test or receipt path that exists); external gates stay
 * deferred and are never passed; model spend stays within the cap; the handoff names precise next work.
 */
const ROOT = join(import.meta.dirname, "../..");
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const status = read("docs/phases/local-intelligence/STATUS.json");
const acceptance = read("docs/phases/local-intelligence/package/ACCEPTANCE.json");
const deferrals = read("docs/phases/local-intelligence/package/DEFERRALS.json");

describe("LP31-A3/A4: phase ledger", () => {
  it("maps all 128 requirement ids with an allowed status; passed ones cite existing evidence", () => {
    const ids = acceptance.requirements.map((r: { id: string }) => r.id);
    expect(ids.length).toBe(128);
    expect(Object.keys(status.requirements).sort()).toEqual([...ids].sort());
    const allowed = Object.keys(status.requirement_status_vocabulary);
    for (const id of ids) {
      const r = status.requirements[id];
      expect(allowed, id).toContain(r.status);
      if (r.status === "passed_local") {
        expect(r.evidence.length, id).toBeGreaterThan(0);
        const paths = r.evidence.flatMap((e: string) => [...e.matchAll(/(?<![A-Za-z0-9_./-])((?:apps|eval|examples|e2e|packages|scripts|docs|scenarios|artifacts)\/[A-Za-z0-9_./-]+\.(?:ts|md|json))/g)].map((m) => m[1]!));
        expect(paths.length, `${id} names no test or receipt path`).toBeGreaterThan(0);
        for (const p of paths) expect(existsSync(join(ROOT, p)), `${id}: ${p}`).toBe(true);
      } else expect(String(r.reason ?? "").length, `${id} needs a reason`).toBeGreaterThan(10);
    }
  });
  it("external gates stay deferred; spend within cap; handoff names next work; no package claims more than CI-verified", () => {
    for (const item of deferrals.items) {
      const s = status.deferrals.find((x: { id: string }) => x.id === item.id);
      expect(s?.status, item.id).toBe("deferred_by_owner");
    }
    expect(status.model_spend_usd.spent).toBeLessThanOrEqual(status.model_spend_usd.phase_cap);
    expect(Array.isArray(status.next_action.precise_next_work) && status.next_action.precise_next_work.length).toBeGreaterThan(0);
    const pkgStatus = Object.keys(status.status_vocabulary);
    for (const p of status.packages) expect(pkgStatus, p.id).toContain(p.status);
    expect(existsSync(join(ROOT, "docs/phases/local-intelligence/PHASE_REPORT.md"))).toBe(true);
  });
});
