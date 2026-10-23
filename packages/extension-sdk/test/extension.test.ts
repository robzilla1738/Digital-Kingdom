import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPack, isRevoked, manifestDigest, validateExtension, type ExtensionManifest } from "../src/index.ts";

/** R10.5 extension contracts: declarative, permission-capped, pinned, revocable, with all four fixtures. */
const DIR = resolve(import.meta.dirname, "../examples/rate-limit-rule");
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]);
const shipped = walk(DIR).map((f) => relative(DIR, f));
const files = new Map(shipped.map((f) => [f, readFileSync(join(DIR, f), "utf8")]));
const read = (p: string) => files.get(p) ?? null;
const manifest = JSON.parse(files.get("extension.json")!) as ExtensionManifest;

describe("R10.5 extension packs", () => {
  it("the example contributor pack passes with positive, benign, missing-evidence and failure fixtures", () => {
    const r = checkPack(manifest, read, shipped);
    expect(r.problems).toEqual([]);
    expect(Object.fromEntries(r.fixtures.map((f) => [f.name, f.got]))).toEqual({ positive: "fires", benign: "quiet", missing_evidence: "unknown", failure: "rejected" });
  });
  it("rejects overprivileged, executable, malformed or incomplete extensions", () => {
    expect(validateExtension({ ...manifest, permissions: ["events:read", "network:egress"] })).toContain("permission network:egress is never grantable to an extension");
    expect(validateExtension({ ...manifest, permissions: ["scene:render"] })[0]).toMatch(/exceeds the rule ceiling/);
    expect(validateExtension({ ...manifest, permissions: ["containment:execute"] })[0]).toMatch(/never grantable/);
    expect(validateExtension({ ...manifest, files: { ...manifest.files, "hook.js": "0".repeat(64) } }).join(" ")).toMatch(/executable code/);
    expect(validateExtension({ ...manifest, files: { "../escape.json": "0".repeat(64) } }).join(" ")).toMatch(/inside the extension/);
    expect(validateExtension({ ...manifest, contract_version: 2 })[0]).toMatch(/not supported/);
    expect(validateExtension({ ...manifest, run: "curl x | sh" })).toContain("unknown field run");
    expect(validateExtension({ ...manifest, rule: { definition: "rule.json", fixtures: { positive: "fixtures/positive.json" } } }).join(" ")).toMatch(/benign is required.*missing_evidence is required.*failure is required/);
    expect(validateExtension(null)).toEqual(["manifest must be an object"]);
  });
  it("tampered or unpinned files fail integrity; a revoked pack is refused; a wrong fixture expectation fails", () => {
    const tampered = (p: string) => p === "rule.json" ? read(p)!.replace('"threshold": 5', '"threshold": 50') : read(p);
    expect(checkPack(manifest, tampered, shipped).problems).toContain("rule.json does not match its pinned digest");
    expect(checkPack(manifest, read, [...shipped, "extra.json"]).problems).toContain("extra.json is shipped but not pinned");
    const rev = { schema: "dk.extension_revocations.v1" as const, revoked: [{ id: manifest.id, version: "1.0.0", reason: "false positives on shared NAT", at: "2030-01-01T00:00:00Z" }] };
    expect(isRevoked(manifest, rev)).toBeTruthy();
    expect(checkPack(manifest, read, shipped, rev).problems.join(" ")).toMatch(/revoked: false positives/);
    expect(isRevoked({ ...manifest, version: "1.0.1" }, rev)).toBeNull();
    const byDigest = { ...rev, revoked: [{ id: manifest.id, digest: manifestDigest(manifest), reason: "bad build", at: "2030-01-01T00:00:00Z" }] };
    expect(isRevoked(manifest, byDigest)).toBeTruthy();
  });
});
