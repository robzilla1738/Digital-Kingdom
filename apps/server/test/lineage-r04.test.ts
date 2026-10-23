import { describe, expect, it } from "vitest";
import { createSign, generateKeyPairSync } from "node:crypto";
import { digestOf, evaluateLineage, type DsseEnvelope, type LineageInput, type ProvenancePolicy } from "../src/lineage.ts";
import { setup } from "./helpers.ts";

/** R04.1 source-to-running-artifact lineage. */
const COMMIT = "628f1e00b3666587d16ad971dfd860c6e10e5721";
const ART = digestOf("image-v1"), OTHER = digestOf("image-v2");
const BUILDER = "https://github.com/actions/runner/github-hosted";
const trusted = generateKeyPairSync("ec", { namedCurve: "P-256" }), rogue = generateKeyPairSync("ec", { namedCurve: "P-256" });
const policy: ProvenancePolicy = { signers: [{ keyid: "release-key-1", publicKeyPem: trusted.publicKey.export({ type: "spki", format: "pem" }).toString() }], builders: [BUILDER], repositories: ["github.com/robzilla1738/Digital-Kingdom"] };
function envelope(opts: { key?: typeof trusted.privateKey; keyid?: string; builder?: string; digest?: string; commit?: string } = {}): DsseEnvelope {
  const st = { _type: "https://in-toto.io/Statement/v1", subject: [{ name: "ghcr.io/acme/checkout", digest: { sha256: (opts.digest ?? ART).slice(7) } }], predicateType: "https://slsa.dev/provenance/v1",
    predicate: { buildDefinition: { buildType: "https://actions.github.io/buildtypes/workflow/v1", resolvedDependencies: [{ uri: "git+https://github.com/robzilla1738/Digital-Kingdom@refs/heads/main", digest: { gitCommit: opts.commit ?? COMMIT } }] }, runDetails: { builder: { id: opts.builder ?? BUILDER } } } };
  const payload = Buffer.from(JSON.stringify(st));
  const type = "application/vnd.in-toto+json";
  const s = createSign("SHA256"); s.update(Buffer.concat([Buffer.from(`DSSEv1 ${type.length} ${type} ${payload.length} `), payload]));
  return { payloadType: type, payload: payload.toString("base64"), signatures: [{ keyid: opts.keyid ?? "release-key-1", sig: s.sign(opts.key ?? trusted.privateKey).toString("base64") }] };
}
const base = (over: Partial<LineageInput> = {}): LineageInput => ({ repository: "github.com/robzilla1738/Digital-Kingdom", commit: COMMIT, workflow: ".github/workflows/release.yml", registry: { reference: "ghcr.io/acme/checkout", tag: "latest", digest_at_build: ART, digest_now: ART }, provenance: envelope(), deployment: { environment: "prod", reference: "ghcr.io/acme/checkout:latest", at: "2026-10-20T12:00:00Z" }, runtime: { digest: ART, observed_at: "2026-10-20T12:05:00Z", source: "falco-node-1" }, ...over });

describe("R04.1 lineage", () => {
  it("a verified chain links commit to the running digest and makes no malware claim", () => {
    const r = evaluateLineage(base(), policy);
    expect(r).toMatchObject({ provenance: "verified", drift: [], running_matches_commit: true });
    expect(r.not_claimed[0]).toMatch(/not mean the artifact is free of malware/);
    expect(JSON.stringify(r)).not.toMatch(/malware-free|safe artifact|clean/i);
  });
  it("a mutable tag resolving to a different digest is detected as drift", () => {
    const r = evaluateLineage(base({ registry: { reference: "ghcr.io/acme/checkout", tag: "latest", digest_at_build: ART, digest_now: OTHER }, runtime: { digest: OTHER, observed_at: "2026-10-21T00:00:00Z", source: "falco-node-1" } }), policy);
    expect(r.drift.join(" ")).toMatch(/mutable tag latest now resolves to sha256:/);
    expect(r.running_matches_commit).toBe(false);
    expect(r.links.filter((l) => l.state === "mismatch")).toHaveLength(2);
  });
  it("valid provenance from an unexpected signer or builder does not satisfy policy", () => {
    expect(evaluateLineage(base({ provenance: envelope({ key: rogue.privateKey, keyid: "someone-else" }) }), policy)).toMatchObject({ provenance: "unverified", reasons: [expect.stringMatching(/unexpected signer/)] });
    expect(evaluateLineage(base({ provenance: envelope({ builder: "https://evil.example/builder" }) }), policy)).toMatchObject({ provenance: "unverified", reasons: [expect.stringMatching(/not an expected issuer/)] });
    expect(evaluateLineage(base({ provenance: envelope({ key: rogue.privateKey }) }), policy).reasons[0]).toMatch(/does not verify/); // right keyid, wrong key
    expect(evaluateLineage(base({ provenance: envelope({ commit: "0".repeat(40) }) }), policy).provenance).toBe("unverified");
    expect(evaluateLineage(base({ provenance: null }), policy).provenance).toBe("undeclared");
    expect(evaluateLineage(base({ provenance: { ...envelope(), signatures: [] } }), policy).provenance).toBe("unsigned");
  });
  it("a deployed fix is checked at the runtime digest, not the merged commit", async () => {
    const merged = evaluateLineage(base({ runtime: null }), policy);
    expect(merged).toMatchObject({ provenance: "verified", running_matches_commit: "unknown" });
    expect(merged.reasons.join(" ")).toMatch(/merged fix is not proof it is deployed/);
    const ctx = await setup();
    const r = await ctx.app.inject({ method: "POST", url: "/api/projects/demo-castle/lineage/evaluate", headers: ctx.h(ctx.viewer), payload: { input: base(), policy } });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().provenance).toBe("verified");
  });
});
