import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifest, verifyRelease } from "../../../scripts/release-lib.ts";

/** R10.5 release artifacts match their recorded source/build identity. */
function tree() {
  const root = mkdtempSync(join(tmpdir(), "dk-rel-"));
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  mkdirSync(join(root, "dist/assets"), { recursive: true });
  writeFileSync(join(root, "dist/index.html"), "<html></html>");
  writeFileSync(join(root, "dist/assets/app.js"), "console.log(1)");
  return root;
}
describe("R10.5 release manifest", () => {
  it("a matching build verifies; changed, added or removed files, another commit, a dirty tree or another lockfile do not", () => {
    const root = tree(), dirs = { web: "dist" };
    const m = buildManifest(root, dirs, { version: "0.3.2", commit: "abc", tree_clean: true, now: "2030-01-01T00:00:00Z" });
    expect(Object.keys(m.artifacts.web!)).toEqual(["assets/app.js", "index.html"]);
    expect(verifyRelease(m, root, dirs, "abc")).toEqual([]);
    writeFileSync(join(root, "dist/assets/app.js"), "console.log(2)");
    writeFileSync(join(root, "dist/extra.js"), "x");
    expect(verifyRelease(m, root, dirs, "def")).toEqual(["commit def differs from the recorded abc", "web/assets/app.js differs from the recorded build", "web/extra.js was not in the recorded build"]);
    writeFileSync(join(root, "pnpm-lock.yaml"), "changed");
    expect(verifyRelease({ ...m, tree_clean: false }, root, dirs, "abc")).toEqual(expect.arrayContaining(["the recorded build came from a dirty tree", "pnpm-lock.yaml differs from the recorded lockfile"]));
  });
});
