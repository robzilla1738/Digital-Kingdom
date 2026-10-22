import { describe, expect, it } from "vitest";
import { syncReplayInterval } from "./replayRange.ts";
const first = { start: "2026-10-20T14:00:00Z", end: "2026-10-20T14:10:00Z" };
const extended = { start: "2026-10-20T14:00:00Z", end: "2026-10-20T14:20:00Z" };
describe("replay range follows accepted snapshots only at latest", () => {
  it("extends the latest rail when the accepted snapshot ends later", () => expect(syncReplayInterval(first, extended, true, false)).toBe(extended));
  it("leaves historical replay fixed when a newer snapshot is available", () => expect(syncReplayInterval(first, extended, false, false)).toBe(first));
  it("leaves a custom interval fixed", () => expect(syncReplayInterval(first, extended, true, true)).toBe(first));
  it("updates after explicit return-to-latest clears the custom interval", () => { expect(syncReplayInterval(first, extended, false, true)).toBe(first); expect(syncReplayInterval(first, extended, true, false)).toBe(extended); });
  it("retains identity for an unchanged snapshot", () => expect(syncReplayInterval(first, { ...first }, true, false)).toBe(first));
});
