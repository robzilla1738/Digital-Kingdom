import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts"; // first: db.ts and change-review.ts import each other
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { buildCapsule, CAPSULE_LIMITS, CapsuleRefusal, importCapsule, inspectArchive, packTar } from "../src/capsule.ts";

/** LP28 evidence-only and training capsules. Negative cases first. No model calls. */
type Ctx = Awaited<ReturnType<typeof setup>>;
const P = "/api/projects/demo-castle";
const fx = (n: string) => JSON.parse(readFileSync(new URL(n, import.meta.url), "utf8"));
const OK = fx("./fixtures/lp23/verification-success.json");
const REG = fx("../../../scenarios/local-world/regressions/LR-01-saas-cross-tenant-api.json");
const req = (ctx: Ctx, method: "GET" | "POST", url: string, payload?: unknown, token = ctx.analyst) => ctx.app.inject({ method, url, headers: ctx.h(token), ...(payload !== undefined ? { payload: payload as object } : {}) });
const j = (v: unknown) => Buffer.from(JSON.stringify(v));

async function caseWithEvidence(ctx: Ctx) {
  const f = ctx.store.listFindings("demo-castle")[0]!;
  const events = ctx.store.listEvents("demo-castle", { limit: 50 });
  let c = (await req(ctx, "POST", `${P}/cases`, { title: "Capsule case", scope: { question: "What happened?", asset_ids: ["api"] }, closure_criteria: "explained" })).json();
  c = (await req(ctx, "POST", `${P}/cases/${c.id}/items`, { kind: "finding", ref: f.id, expected_version: c.version })).json();
  const ev = events.find((e) => !f.event_ids.includes(e.id))!, ev2 = events.find((e) => e.id !== ev.id && !f.event_ids.includes(e.id))!;
  c = (await req(ctx, "POST", `${P}/cases/${c.id}/items`, { kind: "event", ref: ev.id, why: "independent", expected_version: c.version })).json();
  c = (await req(ctx, "POST", `${P}/cases/${c.id}/items`, { kind: "event", ref: ev2.id, why: "will be purged", expected_version: c.version })).json();
  expect((await req(ctx, "POST", `${P}/cases/${c.id}/local-repairs`, { verification: OK, regression: REG })).statusCode).toBe(200);
  return { c, purged: ev2.id };
}

describe("LP28-A2 (negative first): hostile archives are rejected before anything is extracted", () => {
  const ok = (extra: { path: string; data: Buffer; mode?: number; type?: string; link?: string }[]) => gzipSync(packTar([{ path: "manifest.json", data: j({}) }, ...extra]));
  it("zip-slip, absolute paths, links, oversized entries, bombs, executables and odd types", () => {
    const cases: [string, Buffer, RegExp][] = [
      ["zip-slip", ok([{ path: "evidence/../../etc/x.json", data: j(1) }]), /parent or current directory|outside the capsule layout/],
      ["dot-dot only", ok([{ path: "../x.json", data: j(1) }]), /zip-slip|outside/],
      ["absolute", ok([{ path: "/etc/passwd.json", data: j(1) }]), /absolute path/],
      ["windows absolute", ok([{ path: "C:/x/evidence.json", data: j(1) }]), /absolute path/],
      ["backslash", ok([{ path: "evidence\\..\\x.json", data: j(1) }]), /backslash/],
      ["symlink", ok([{ path: "evidence/link.json", data: Buffer.alloc(0), type: "2", link: "/etc/passwd" }]), /link entries are refused/],
      ["hard link", ok([{ path: "evidence/hl.json", data: Buffer.alloc(0), type: "1", link: "manifest.json" }]), /link entries are refused/],
      ["directory", ok([{ path: "evidence/d.json", data: Buffer.alloc(0), type: "5" }]), /only regular files/],
      ["device", ok([{ path: "evidence/dev.json", data: Buffer.alloc(0), type: "3" }]), /only regular files/],
      ["executable mode", ok([{ path: "evidence/run.json", data: j(1), mode: 0o755 }]), /executable or setuid/],
      ["ELF content", ok([{ path: "evidence/a.json", data: Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(60)]) }]), /executable or nested archive/],
      ["shebang", ok([{ path: "evidence/s.json", data: Buffer.from("#!/bin/sh\nrm -rf /\n") }]), /executable/],
      ["nested zip", ok([{ path: "evidence/z.json", data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]) }]), /nested archive/],
      ["unsupported extension", ok([{ path: "evidence/tool.sh", data: Buffer.from("echo") }]), /unsupported extension/],
      ["font", ok([{ path: "evidence/brand.woff2", data: Buffer.from("wOF2xxxx") }]), /unsupported extension/],
      ["oversized entry", ok([{ path: "evidence/big.json", data: Buffer.alloc(CAPSULE_LIMITS.max_entry_bytes + 1, 32) }]), /exceeds/],
      ["decompression bomb", gzipSync(Buffer.alloc(CAPSULE_LIMITS.max_total_bytes + 1024 * 1024, 0)), /decompression bomb/],
      ["ratio bomb", gzipSync(packTar([{ path: "evidence/zeros.json", data: Buffer.alloc(6 * 1024 * 1024, 48) }])), /ratio .* exceeds|decompression bomb/],
      ["duplicate", ok([{ path: "evidence/a.json", data: j(1) }, { path: "evidence/a.json", data: j(2) }]), /duplicate/],
      ["not gzip", Buffer.from("PK\u0003\u0004 definitely not gzip at all"), /not valid gzip/],
    ];
    for (const [name, gz, re] of cases) {
      let err: unknown; try { inspectArchive(gz); } catch (e) { err = e; }
      expect(err, name).toBeInstanceOf(CapsuleRefusal);
      expect((err as Error).message, name).toMatch(re);
    }
    // inspection is purely in memory: no API writes files (static check)
    const src = readFileSync(new URL("../src/capsule.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/writeFile|mkdir|createWriteStream|child_process|\bexec\(|spawn\(|fetch\(/);
  });
});

describe("LP28-A3: evidence-only capsules exclude oracle data, tokens, secrets, credentials and fonts", () => {
  it("refuses an oracle in an evidence-only capsule and secret-bearing evidence; the real export carries none", async () => {
    const ctx = await setup();
    const { c } = await caseWithEvidence(ctx);
    const exp = ctx.app ? (await req(ctx, "POST", `${P}/cases/${c.id}/export`)).json() : null;
    expect(() => buildCapsule({ kind: "evidence_only", caseExport: exp, oracle: { answer_key: [] } })).toThrow(/never carries oracle/);
    const poisoned = (patch: (x: typeof exp) => void) => { const x = structuredClone(exp); patch(x); return x; };
    const bad: [string, unknown, RegExp][] = [
      ["aws key", poisoned((x) => { x.sections.history.push({ note: "AKIAABCDEFGHIJKLMNOP" }); }), /aws access key/],
      ["jwt", poisoned((x) => { x.sections.history.push({ note: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc" }); }), /jwt/],
      ["dk token", poisoned((x) => { x.sections.history.push({ note: "dksess_" + "A".repeat(32) }); }), /session or api token/],
      ["provider credential", poisoned((x) => { x.sections.history.push({ client_secret: "s3cr3t-value" }); }), /provider credential field/],
      ["oracle field", poisoned((x) => { x.sections.history.push({ world_truth: { violation: true } }); }), /oracle/],
      ["lab session", poisoned((x) => { x.sections.history.push({ note: "ses-" + "ab".repeat(12) }); }), /local lab session/],
    ];
    for (const [name, ce, re] of bad) {
      let err: unknown; try { buildCapsule({ kind: "evidence_only", caseExport: ce as never }); } catch (e) { err = e; }
      expect(err, name).toBeInstanceOf(CapsuleRefusal);
      expect((err as Error).message, name).toMatch(re);
      expect((err as Error).message).not.toMatch(/AKIAABCDEFGHIJKLMNOP|s3cr3t-value/);
    }
    const r = await req(ctx, "POST", `${P}/cases/${c.id}/capsule`);
    expect(r.statusCode, r.body).toBe(200);
    const { manifest, archive_base64 } = r.json();
    expect(manifest).toMatchObject({ schema: "dk.local.capsule.v1", kind: "evidence_only", sealed: null, scope: "local_only_no_third_party_storage" });
    expect(manifest.entries.map((e: { path: string }) => e.path).sort()).toEqual(["evidence/case-export.json", `regressions/${REG.regression_id}.json`, "scene/scene-revision.json", "verifications/verification-1.json"]);
    const entries = inspectArchive(Buffer.from(archive_base64, "base64"));
    expect(entries.some((e) => e.path.startsWith("sealed/"))).toBe(false);
    const all = entries.map((e) => e.data.toString("utf8")).join("\n");
    expect(all).not.toMatch(/dksess_|"signature":"[a-f0-9]{64}","sections"|api_tokens|password_hash|\.woff|oracle"|answer_key/);
    expect(all).not.toContain(ctx.analyst);
  });
});

describe("LP28-A1/A4: round trip into a fresh instance, separate namespace, absent records reported, integrity wording", () => {
  it("evidence-only capsule from instance A imports into a fresh instance B and reproduces the case", async () => {
    const a = await setup();
    const { c, purged } = await caseWithEvidence(a);
    a.db.prepare("DELETE FROM events WHERE id = ?").run(purged);
    const src = (await req(a, "POST", `${P}/cases/${c.id}/export`)).json();
    const r = (await req(a, "POST", `${P}/cases/${c.id}/capsule`)).json();
    expect(r.manifest.absent_records).toEqual([expect.objectContaining({ ref: purged, reason: expect.stringMatching(/deleted or purged/) })]);
    expect(r.manifest.integrity).toMatch(/not proof of truth, not proof of completeness and not an independent approval/);
    const b = await setup();
    expect((await req(b, "POST", "/api/capsules/import", { archive_base64: r.archive_base64 }, b.analyst)).statusCode).toBe(403);
    const imp = await req(b, "POST", "/api/capsules/import", { archive_base64: r.archive_base64 }, b.admin);
    expect(imp.statusCode, imp.body).toBe(200);
    const v = imp.json();
    expect(v.namespace).toBe(`capsule:${r.manifest.capsule_id.slice(4)}`);
    expect(v.checks).toEqual({ entry_digests: "ok", manifest_schema: "ok", case_sections: "ok", evidence_refs_rederived: "ok", signature: "valid" }); // both test instances share the test signing secret
    expect(v.integrity).toMatch(/integrity and origin .* not proof of truth/);
    expect(v.evidence_refs).toEqual(r.manifest.evidence_refs);
    expect(v.evidence_refs.some((x: string) => x.startsWith("finding:"))).toBe(true);
    expect(v.evidence_refs.some((x: string) => x.startsWith("bundle:"))).toBe(true);
    expect(v.absent_records).toEqual(r.manifest.absent_records);
    // exact supported references: the case record and its items as exported by A
    expect(v.case_export.sections.case.items.map((i: { kind: string; ref: string }) => [i.kind, i.ref])).toEqual(src.sections.case.items.map((i: { kind: string; ref: string }) => [i.kind, i.ref]));
    expect(v.case_export.sections.bundles.map((x: { bundle_digest: string }) => x.bundle_digest)).toEqual(src.sections.bundles.map((x: { bundle_digest: string }) => x.bundle_digest));
    expect(v.regressions[0].regression_id).toBe(REG.regression_id);
    // new namespace only: B's own project data is untouched
    expect(b.store.listFindings("demo-castle").length).toBe(a.store.listFindings("demo-castle").length);
    expect((await req(b, "GET", `/api/capsules/${encodeURIComponent(v.namespace)}`, undefined, b.viewer)).json().evidence_refs).toEqual(v.evidence_refs);
    expect((await req(b, "POST", "/api/capsules/import", { archive_base64: r.archive_base64 }, b.admin)).statusCode).toBe(409);
    // a different signing secret (another instance) cannot confirm origin
    const back = importCapsule(Buffer.from(r.archive_base64, "base64"), { signingSecret: "test-secret-not-it" });
    expect(back.checks.signature).toBe("not_from_this_instance");
    // tampering with an entry or the manifest is caught (integrity only)
    const ents = inspectArchive(Buffer.from(r.archive_base64, "base64"));
    const swap = (path: string, f: (b: Buffer) => Buffer) => gzipSync(packTar(ents.map((e) => (e.path === path ? { path: e.path, data: f(e.data) } : e))));
    expect(() => importCapsule(swap("evidence/case-export.json", (d) => Buffer.from(d.toString().replace("Capsule case", "Capsule kase"))))).toThrow(/does not match its manifest digest/);
    const m = JSON.parse(ents[0]!.data.toString());
    expect(() => importCapsule(swap("manifest.json", () => j({ ...m, evidence_refs: m.evidence_refs.slice(1) })))).toThrow(/differ from those re-derived/);
    expect(() => importCapsule(swap("manifest.json", () => j({ ...m, absent_records: [] })))).toThrow(/absent-record list differs/);
    expect(() => importCapsule(gzipSync(packTar([...ents, { path: "evidence/extra.json", data: j({}) }])))).toThrow(/not listed in the manifest/);
    expect(() => importCapsule(swap("manifest.json", () => j({ ...m, kind: "training" })))).toThrow(/invalid capsule manifest/);
  });

  it("training capsule: oracle sealed and separated, opened only with the passphrase, commitment checked; leak tests", async () => {
    const a = await setup();
    const { c } = await caseWithEvidence(a);
    const exp = (await req(a, "POST", `${P}/cases/${c.id}/export`)).json();
    const oracle = { canary: "canary-7f3a9c1e5b2d4086", world_truth: [{ op: 1, boundary_violation: true, effect: "observed" }], answer_key: "admissible:unknown|observed" };
    expect(() => buildCapsule({ kind: "training", caseExport: exp, oracle, sealPassphrase: "short" })).toThrow(/at least 12/);
    // an oracle value leaking into the evidence part is refused
    const leaky = structuredClone(exp); leaky.sections.history.push({ note: "canary-7f3a9c1e5b2d4086" });
    expect(() => buildCapsule({ kind: "training", caseExport: leaky, oracle, sealPassphrase: "long enough passphrase" })).toThrow(/oracle value outside the sealed attachment/);
    const t = buildCapsule({ kind: "training", caseExport: exp, regressions: [REG], oracle, sealPassphrase: "long enough passphrase" });
    expect(t.manifest.sealed).toMatchObject({ path: "sealed/oracle.dkseal", cipher: "aes-256-gcm", separated: true, use: "training_and_evaluation_only" });
    const ents = inspectArchive(t.archive);
    const plain = ents.filter((e) => e.path !== "sealed/oracle.dkseal").map((e) => e.data.toString("utf8")).join("\n");
    const sealedBytes = ents.find((e) => e.path === "sealed/oracle.dkseal")!.data.toString("latin1");
    for (const s of ["canary-7f3a9c1e5b2d4086", "boundary_violation", "admissible:unknown"]) { expect(plain).not.toContain(s); expect(sealedBytes).not.toContain(s); }
    const closed = importCapsule(t.archive);
    expect(closed.sealed).toEqual({ present: true, opened: false, commitment_ok: null });
    expect(JSON.stringify(closed)).not.toContain("canary-7f3a9c1e5b2d4086");
    expect(() => importCapsule(t.archive, { sealPassphrase: "the wrong passphrase" })).toThrow(/could not be opened/);
    const opened = importCapsule(t.archive, { sealPassphrase: "long enough passphrase" });
    expect(opened.sealed).toMatchObject({ present: true, opened: true, commitment_ok: true, oracle });
    // the server import never opens a seal and does not store the oracle
    const b = await setup();
    const si = await req(b, "POST", "/api/capsules/import", { archive_base64: t.archive.toString("base64") }, b.admin);
    expect(si.statusCode, si.body).toBe(200);
    expect(si.json().sealed).toMatchObject({ present: true, opened: false });
    expect(JSON.stringify(b.db.prepare("SELECT * FROM capsule_imports").all())).not.toContain("canary-7f3a9c1e5b2d4086");
    // an evidence-only manifest cannot smuggle a sealed entry
    const m = JSON.parse(ents[0]!.data.toString());
    const forged = gzipSync(packTar(ents.map((e) => (e.path === "manifest.json" ? { path: e.path, data: j({ ...m, kind: "evidence_only", sealed: null }) } : e))));
    expect(() => importCapsule(forged)).toThrow(/evidence-only capsule carries no oracle/);
  });
});
