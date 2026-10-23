/** Pin every file of a declarative extension by sha256 in its extension.json (run after editing the pack). */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { sha256, validateExtension } from "../packages/extension-sdk/src/index.ts";
const dir = resolve(process.argv[2] ?? "");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]);
const m = JSON.parse(readFileSync(join(dir, "extension.json"), "utf8"));
m.files = Object.fromEntries(walk(dir).map((f) => relative(dir, f)).filter((f) => f !== "extension.json").sort().map((f) => [f, sha256(readFileSync(join(dir, f)))]));
writeFileSync(join(dir, "extension.json"), JSON.stringify(m, null, 1) + "\n");
const p = validateExtension(m);
console.log(p.length ? `problems:\n- ${p.join("\n- ")}` : `pinned ${Object.keys(m.files).length} files`);
if (p.length) process.exit(1);
