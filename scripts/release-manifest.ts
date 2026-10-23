/** Record (default) or verify (--verify) the build identity of apps/web/dist. Output: artifacts/release/release-manifest.json. */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildManifest, verifyRelease, type ReleaseManifest } from "./release-lib.ts";
const ROOT = resolve(import.meta.dirname, "..");
const DIRS = { web: "apps/web/dist" };
const git = (...a: string[]) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
const out = join(ROOT, "artifacts/release/release-manifest.json");
if (process.argv.includes("--verify")) {
  const m = JSON.parse(readFileSync(out, "utf8")) as ReleaseManifest;
  const p = verifyRelease(m, ROOT, DIRS, git("rev-parse", "HEAD"));
  console.log(p.length ? `release verification FAILED:\n- ${p.join("\n- ")}` : `release matches recorded build ${m.commit} (${Object.keys(m.artifacts.web ?? {}).length} files)`);
  process.exit(p.length ? 1 : 0);
}
const version = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;
const ignored = /^(\?\?|.M| M|M ) (artifacts|packages\/contracts\/src\/generated)\//;
const dirty = git("status", "--porcelain").split("\n").filter((l) => l && !ignored.test(l));
const m = buildManifest(ROOT, DIRS, { version, commit: git("rev-parse", "HEAD"), tree_clean: dirty.length === 0, now: new Date().toISOString() });
mkdirSync(join(ROOT, "artifacts/release"), { recursive: true });
writeFileSync(out, JSON.stringify(m, null, 1) + "\n");
console.log(`recorded ${Object.keys(m.artifacts.web ?? {}).length} files for ${m.commit}${m.tree_clean ? "" : " (DIRTY TREE)"}`);
