import { describe, expect, it } from "vitest";
import { deriveConnection } from "./connection.ts";

describe("deriveConnection", () => {
  it("is live only with an open stream AND an applied snapshot", () => {
    expect(deriveConnection("open", "synced", true)).toBe("live");
    expect(deriveConnection("open", "syncing", true)).toBe("synchronizing");
    expect(deriveConnection("open", "failed", true)).toBe("sync-failed");
    expect(deriveConnection("down", "synced", true)).toBe("reconnecting");
    expect(deriveConnection("connecting", "synced", true)).toBe("reconnecting");
    expect(deriveConnection("down", "failed", false)).toBe("lost");
  });
});
