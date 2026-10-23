import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Release build identity (roadmap R10.5). A release manifest records the exact source (commit, clean tree,
 * lockfile digest, toolchain) and the sha256 of every built artifact file. `verifyRelease` recomputes the
 * artifact digests and compares; any added, removed or changed file, or a different commit, is a mismatch.
 * This is integrity against the recorded build, not a signature: signing and provenance attestation need the
 * owner's release settings (gate owner_release_settings).
 */
export interface ReleaseManifest {
  schema: "dk.release_manifest.v1"; version: string; commit: string; tree_clean: boolean;
  lockfile_sha256: string; node: string; built_at: string;
  artifacts: Record<string, Record<string, string>>;
}
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]);
export function digestTree(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {};
  return Object.fromEntries(walk(dir).map((f) => [relative(dir, f).split("\\").join("/"), sha(readFileSync(f))]).sort((x, y) => x[0]!.localeCompare(y[0]!)));
}
export function buildManifest(root: string, artifactDirs: Record<string, string>, src: { version: string; commit: string; tree_clean: boolean; now: string }): ReleaseManifest {
  return {
    schema: "dk.release_manifest.v1", version: src.version, commit: src.commit, tree_clean: src.tree_clean,
    lockfile_sha256: sha(readFileSync(join(root, "pnpm-lock.yaml"))), node: process.version, built_at: src.now,
    artifacts: Object.fromEntries(Object.entries(artifactDirs).map(([name, d]) => [name, digestTree(join(root, d))])),
  };
}
export function verifyRelease(m: ReleaseManifest, root: string, artifactDirs: Record<string, string>, commit: string | null) {
  const problems: string[] = [];
  if (commit && commit !== m.commit) problems.push(`commit ${commit} differs from the recorded ${m.commit}`);
  if (!m.tree_clean) problems.push("the recorded build came from a dirty tree");
  if (sha(readFileSync(join(root, "pnpm-lock.yaml"))) !== m.lockfile_sha256) problems.push("pnpm-lock.yaml differs from the recorded lockfile");
  for (const [name, d] of Object.entries(artifactDirs)) {
    const want = m.artifacts[name] ?? {}, got = digestTree(join(root, d));
    if (!Object.keys(want).length) problems.push(`${name}: no recorded artifacts`);
    for (const f of Object.keys(want)) if (!(f in got)) problems.push(`${name}/${f} is missing`); else if (got[f] !== want[f]) problems.push(`${name}/${f} differs from the recorded build`);
    for (const f of Object.keys(got)) if (!(f in want)) problems.push(`${name}/${f} was not in the recorded build`);
  }
  return problems;
}
