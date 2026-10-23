/**
 * Local Intelligence Phase (LP00): fingerprints of historical evaluation and receipt trees.
 *
 * Each frozen tree is hashed over its git-tracked files as they exist on disk: sha256 of the sorted lines
 * `<relative path>\0<sha256 of bytes>`. Untracked/ignored local outputs (server logs, budgets of local runs) are not
 * part of the frozen record. The recorded manifest is docs/phases/local-intelligence/FROZEN_DIGESTS.json.
 *
 *   tsx scripts/phase-frozen-digests.ts           # verify (exit 1 on any difference)
 *   tsx scripts/phase-frozen-digests.ts --write   # record (only at bootstrap or with an explicit ledger decision)
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");
export const MANIFEST = "docs/phases/local-intelligence/FROZEN_DIGESTS.json";
/** Historical records this phase must never rewrite. */
export const FROZEN_TREES = [
  "artifacts/completion",
  "artifacts/eval-v2",
  "artifacts/redesign",
  "eval/runs",
  "eval/grading",
  "eval/review",
  "eval/scenarios",
  "docs/roadmap",
  "docs/quality",
  "docs/AGENT_EVAL_RESULTS.md",
  "docs/PILOT_RESULTS.md",
  "docs/phases/local-intelligence/package",
] as const;

export interface TreeDigest { path: string; files: number; sha256: string }

export function trackedFiles(path: string, root = ROOT): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", path], { cwd: root, encoding: "utf8" });
  return out.split("\0").filter(Boolean).sort();
}

export function digestTree(path: string, root = ROOT): TreeDigest {
  const files = trackedFiles(path, root);
  const h = createHash("sha256");
  for (const f of files) h.update(`${f}\0${createHash("sha256").update(readFileSync(join(root, f))).digest("hex")}\n`);
  return { path, files: files.length, sha256: h.digest("hex") };
}

export function currentDigests(root = ROOT): TreeDigest[] { return FROZEN_TREES.map((p) => digestTree(p, root)); }

export function compare(recorded: TreeDigest[], current: TreeDigest[]): string[] {
  const problems: string[] = [];
  for (const r of recorded) {
    const c = current.find((x) => x.path === r.path);
    if (!c) problems.push(`${r.path}: no longer fingerprinted`);
    else if (c.sha256 !== r.sha256 || c.files !== r.files) problems.push(`${r.path}: changed (${r.files} files ${r.sha256.slice(0, 12)} -> ${c.files} files ${c.sha256.slice(0, 12)})`);
  }
  for (const c of current) if (!recorded.some((r) => r.path === c.path)) problems.push(`${c.path}: not in the recorded manifest`);
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const current = currentDigests();
  if (process.argv.includes("--write")) {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    writeFileSync(join(ROOT, MANIFEST), JSON.stringify({ schema: "dk.local_phase.frozen_digests.v1", recorded_at_head: head, method: "sha256 over sorted '<path>\\0<sha256(bytes)>' lines of git-tracked files", trees: current }, null, 1) + "\n");
    console.log(`recorded ${current.length} trees at ${head}`);
  } else {
    const recorded = (JSON.parse(readFileSync(join(ROOT, MANIFEST), "utf8")) as { trees: TreeDigest[] }).trees;
    const problems = compare(recorded, current);
    for (const t of current) console.log(`${problems.some((p) => p.startsWith(t.path + ":")) ? "CHANGED " : "same    "} ${t.path} (${t.files} files)`);
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  }
}
