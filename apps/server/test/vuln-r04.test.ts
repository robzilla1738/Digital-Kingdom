import { describe, expect, it } from "vitest";
import { assess, type FeedSnapshot, type Sbom } from "../src/vuln.ts";

/** R04.2 contextual vulnerability applicability with a cached OSV-format feed (synthetic records). */
const NOW = new Date("2026-10-22T12:00:00Z");
const RUN = `sha256:${"1".repeat(64)}`;
const feed = (over: Partial<FeedSnapshot> = {}): FeedSnapshot => ({
  osv_fetched_at: "2026-10-21T00:00:00Z",
  osv: [
    { id: "GHSA-test-0001", aliases: ["CVE-2099-0001"], modified: "2026-10-01T00:00:00Z", affected: [{ package: { ecosystem: "npm", name: "left-parser" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "2.4.1" }] }] }] },
    { id: "GHSA-test-0002", aliases: ["CVE-2099-0002"], modified: "2026-10-01T00:00:00Z", affected: [{ package: { ecosystem: "npm", name: "dev-only-tool" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "9.0.0" }] }] }] },
    { id: "DEBIAN-CVE-2099-0003", aliases: ["CVE-2099-0003"], modified: "2026-10-01T00:00:00Z", affected: [{ package: { ecosystem: "Debian", name: "libfoo" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "1.2-3+deb12u1" }] }] }] },
  ],
  kev: [{ cve: "CVE-2099-0001", date_added: "2026-09-01" }], kev_fetched_at: "2026-10-21T00:00:00Z", epss: { "CVE-2099-0001": 0.42 }, ...over,
});
const runtime = (comps: Sbom["components"]): Sbom => ({ artifact_digest: RUN, components: comps, generated_at: "2026-10-20T00:00:00Z", tool: "syft 1.x" });
const source: Sbom = { artifact_digest: "source", generated_at: "2026-10-20T00:00:00Z", tool: "npm ls", components: [{ purl: "pkg:npm/left-parser@2.3.0" }, { purl: "pkg:npm/dev-only-tool@1.0.0" }] };

describe("R04.2 vulnerability applicability", () => {
  it("a dependency only in source is not reported as confirmed runtime exposure", () => {
    const r = assess({ deployed: [{ asset_id: "api", running_digest: RUN, exposure: "public" }], sboms: [runtime([{ purl: "pkg:npm/left-parser@2.3.0" }])], sourceSbom: source, feed: feed(), now: NOW });
    expect(r.findings.find((f) => f.component === "dev-only-tool")).toMatchObject({ applicability: "source_only", priority: "informational" });
    expect(r.findings.find((f) => f.component === "left-parser")).toMatchObject({ applicability: "affected_in_runtime", priority: "high", remediation: "unverified" });
  });
  it("backports, missing versions and stale feeds produce qualified results", () => {
    const r = assess({ deployed: [{ asset_id: "api", running_digest: RUN, exposure: "internal" }], sboms: [runtime([{ purl: "pkg:deb/debian/libfoo@1.2-3" }, { purl: "pkg:npm/left-parser" }])], feed: feed({ osv_fetched_at: "2026-09-01T00:00:00Z" }), now: NOW });
    const deb = r.findings.find((f) => f.component === "debian/libfoo" || f.component === "libfoo");
    expect(deb?.applicability ?? "unknown").toBe("unknown");
    const lp = r.findings.find((f) => f.component === "left-parser")!;
    expect(lp.applicability).toBe("unknown");
    expect(lp.qualifications.join(" ")).toMatch(/missing or not comparable.*days old/);
    expect(r.feed.stale).toBe(true);
  });
  it("a KEV match does not label this installation compromised; a fixed runtime is verified remediation", () => {
    const r = assess({ deployed: [{ asset_id: "api", running_digest: RUN, exposure: "public" }], sboms: [runtime([{ purl: "pkg:npm/left-parser@2.4.1" }])], sourceSbom: source, feed: feed(), now: NOW });
    const f = r.findings.find((x) => x.component === "left-parser")!;
    expect(f).toMatchObject({ applicability: "fixed_in_runtime", remediation: "verified_in_runtime", observed_exploitation: "not_assessed", exploitation_context: { kev: true } });
    expect(f.exploitation_context.note).toMatch(/do not mean this installation is compromised/);
    expect(JSON.stringify(r)).not.toMatch(/compromised"|breach/);
  });
  it("each priority explanation cites the resource, digest and assumptions; only reviewed signed VEX downgrades", () => {
    const base = { deployed: [{ asset_id: "checkout-api", running_digest: RUN, exposure: "public" as const, authority: "reads customers table" }], sboms: [runtime([{ purl: "pkg:npm/left-parser@2.3.0" }])], feed: feed(), now: NOW };
    const f = assess(base).findings[0]!;
    expect(f.explanation).toMatch(/left-parser@2.3.0 on checkout-api \(public exposure, reads customers table\) running sha256:1111111111/);
    expect(f.assumptions.join(" ")).toMatch(/syft 1.x .*OSV snapshot 2026-10-21/);
    expect(assess({ ...base, vex: [{ vulnerability: "CVE-2099-0001", product_digest: RUN, status: "not_affected", justification: "vulnerable_code_not_in_execute_path", author: "vendor", signed: false }] }).findings[0]!.applicability).toBe("affected_in_runtime");
    expect(assess({ ...base, vex: [{ vulnerability: "CVE-2099-0001", product_digest: RUN, status: "not_affected", justification: "vulnerable_code_not_in_execute_path", author: "vendor", signed: true, reviewed_by: "appsec@corp" }] }).findings[0]!.applicability).toBe("not_affected");
  });
});
