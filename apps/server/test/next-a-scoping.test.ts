import { describe, expect, it } from "vitest";
import { coveredWithin } from "../src/investigation/scoping.ts";
import { fmtDuration } from "../src/investigation/jobs.ts";

/** li-next A: pure interval helpers behind claim-local absence assessment. */
const T = (ms: number) => new Date(Date.UTC(2026, 9, 24, 9, 43, 40) + ms).toISOString();

describe("li-next-A coveredWithin", () => {
  it("returns the complement of the uncovered spans inside the interval (closed, millisecond granularity)", () => {
    expect(coveredWithin(T(0), T(145), [{ from: T(103), to: T(123) }])).toEqual([{ from: T(0), to: T(102) }, { from: T(124), to: T(145) }]);
  });
  it("a gap at either edge, overlapping gaps, and a gap covering everything", () => {
    expect(coveredWithin(T(0), T(100), [{ from: T(0), to: T(10) }, { from: T(90), to: T(100) }])).toEqual([{ from: T(11), to: T(89) }]);
    expect(coveredWithin(T(0), T(100), [{ from: T(20), to: T(50) }, { from: T(40), to: T(60) }])).toEqual([{ from: T(0), to: T(19) }, { from: T(61), to: T(100) }]);
    expect(coveredWithin(T(0), T(100), [{ from: T(-5), to: T(200) }])).toEqual([]);
  });
  it("no gaps: the whole interval", () => {
    expect(coveredWithin(T(0), T(100), [])).toEqual([{ from: T(0), to: T(100) }]);
  });
});

describe("li-next-A coverage durations keep short gaps visible", () => {
  it("never rounds a sub-minute gap to 0 minute(s)", () => {
    expect(fmtDuration(20)).toBe("20 ms");
    expect(fmtDuration(2_500)).toBe("2.50 s");
    expect(fmtDuration(45_000)).toBe("45.0 s");
    expect(fmtDuration(600_000)).toBe("10 minute(s)");
  });
});
