import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { canonicalJson, validateCapsuleManifest } from "@dk/contracts";
import { checkRegression, type RepairRegression } from "@dk/local-world";
import { hmac, sha256 } from "./security.ts";

/**
 * LP28 portable local case capsules (`dk.local.capsule.v1`): a gzip'd ustar archive of JSON entries plus a manifest.
 * No third-party storage, no executable content, nothing written to disk on import.
 *
 * - evidence_only: a case export's supported evidence (pinned bundles, independent events, the case record and its
 *   history), the scene revision it was viewed on, synthetic LP23 regression descriptors and LP22 verifications. It
 *   never contains oracle/private-truth data, tokens, secrets, provider credentials or font files: entries are scanned
 *   and the capsule is refused (categories only, never values).
 * - training: the same evidence plus ONE separately sealed oracle attachment (`sealed/oracle.dkseal`, AES-256-GCM under
 *   a scrypt-derived key) with a plaintext commitment. The evidence entries must not contain any oracle value. The
 *   seal is opened only by an explicit passphrase; an investigator importing the capsule sees only that it exists.
 *
 * Import parses and checks the whole archive in memory BEFORE anything is accepted (bounded gunzip, ratio limit,
 * ustar regular files only, no links/devices/directories, no absolute or parent paths, an allowlisted layout, size
 * limits, no executable mode or magic), then verifies the manifest schema, every entry digest, the optional origin
 * signature and the case export's own section digests independently, and re-derives the evidence references.
 *
 * Integrity wording (LP28-A4): digests and the HMAC signature check integrity and origin relative to the exporter.
 * They are not proof that the evidence is true or complete, and not an independent approval of anything.
 */
export const CAPSULE_SCHEMA = "dk.local.capsule.v1";
export const CAPSULE_INTEGRITY = "SHA-256 entry digests and the optional HMAC signature check integrity and origin relative to the exporting Digital Kingdom instance. They are not proof of truth, not proof of completeness and not an independent approval of anything in the capsule.";
export const CAPSULE_LIMITS = { max_entries: 512, max_entry_bytes: 8 * 1024 * 1024, max_total_bytes: 64 * 1024 * 1024, max_compressed_bytes: 32 * 1024 * 1024, max_ratio: 200 } as const;
export class CapsuleRefusal extends Error { constructor(readonly code: "archive" | "layout" | "integrity" | "content" | "schema" | "seal", message: string, readonly problems: string[] = []) { super(message); } }

type Role = "evidence" | "scene" | "regression" | "verification" | "sealed_oracle";
interface Entry { path: string; data: Buffer }

// ---------------------------------------------------------------- content scanning
const SECRET_SHAPES: [string, RegExp][] = [
  ["aws access key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/], ["aws secret key field", /aws_?secret_?access_?key/i], ["api secret", /\bsk_(live|test)_[A-Za-z0-9]{6,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY/], ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./], ["github token", /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ["slack token", /\bxox[abpr]-[A-Za-z0-9-]{10,}/], ["digital kingdom session or api token", /\bdk[a-z]*_[A-Za-z0-9_-]{32}\b/], ["bearer credential", /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/],
  ["local lab session", /\bses-[a-f0-9]{24}\b/], ["synthetic lab password", /\bsynthetic-[a-f0-9]{16}\b/], ["provider credential field", /"(password|secret|client_secret|api_key|access_token|refresh_token|private_key|credential_secret)"\s*:\s*"[^"]+"/i],
];
/** Oracle/private-truth fields, except an explicit declaration that none is included (`"private_truth": "not_included"`). */
const ORACLE_KEYS = /"(oracle|private_truth|truth_path|answer_key|canary|master_seed|labels|expected_answer|world_truth)"\s*:(?!\s*"not_included"|\s*null)/;
const FONT = (path: string, b: Buffer) => /\.(woff2?|ttf|otf|eot)$/i.test(path) || ["wOFF", "wOF2", "OTTO", "true", "ttcf"].includes(b.subarray(0, 4).toString("latin1")) || b.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0]));
const EXECUTABLE = (b: Buffer) => b.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || b.subarray(0, 2).toString("latin1") === "MZ" || b.subarray(0, 2).toString("latin1") === "#!" ||
  [[0xca, 0xfe, 0xba, 0xbe], [0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xcf, 0xfa, 0xed, 0xfe], [0x50, 0x4b, 0x03, 0x04], [0x00, 0x61, 0x73, 0x6d]].some((m) => b.subarray(0, 4).equals(Buffer.from(m)));

/** Categories of forbidden content in one evidence entry. Never returns the values. */
export function capsuleContentProblems(path: string, b: Buffer): string[] {
  const out: string[] = [];
  if (FONT(path, b)) out.push(`${path}: font file`);
  if (EXECUTABLE(b)) out.push(`${path}: executable or nested archive content`);
  const text = b.toString("utf8");
  for (const [name, re] of SECRET_SHAPES) if (re.test(text)) out.push(`${path}: ${name}`);
  if (ORACLE_KEYS.test(text)) out.push(`${path}: oracle / private-truth field`);
  return out;
}
const leafStrings = (v: unknown, out: string[] = []): string[] => { if (typeof v === "string") out.push(v); else if (Array.isArray(v)) v.forEach((x) => leafStrings(x, out)); else if (v && typeof v === "object") Object.values(v).forEach((x) => leafStrings(x, out)); return out; };

// ---------------------------------------------------------------- ustar
const PATH_RE = /^(manifest\.json|signature\.json|(evidence|scene|regressions|verifications|sealed)\/[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.(json|dkseal))$/;
function header(path: string, size: number, mode = 0o644, type = "0", link = "") {
  const h = Buffer.alloc(512);
  h.write(path, 0, 100, "utf8");
  h.write(mode.toString(8).padStart(7, "0") + "\0", 100, 8, "latin1");
  h.write("0000000\0", 108, 8, "latin1"); h.write("0000000\0", 116, 8, "latin1");
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "latin1");
  h.write("00000000000\0", 136, 12, "latin1");
  h.write("        ", 148, 8, "latin1");
  h.write(type, 156, 1, "latin1"); h.write(link, 157, 100, "utf8");
  h.write("ustar\0", 257, 6, "latin1"); h.write("00", 263, 2, "latin1");
  let sum = 0; for (const x of h) sum += x;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "latin1");
  return h;
}
/** Low-level writer (also used by tests to build hostile archives). */
export function packTar(entries: { path: string; data: Buffer; mode?: number; type?: string; link?: string }[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    parts.push(header(e.path, e.data.length, e.mode ?? 0o644, e.type ?? "0", e.link ?? ""), e.data);
    const pad = (512 - (e.data.length % 512)) % 512; if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
const str = (b: Buffer, o: number, n: number) => { const s = b.subarray(o, o + n); const z = s.indexOf(0); return (z >= 0 ? s.subarray(0, z) : s).toString("utf8"); };
const oct = (b: Buffer, o: number, n: number) => { const s = str(b, o, n).trim(); if (!/^[0-7]*$/.test(s)) throw new CapsuleRefusal("archive", "malformed tar header number"); return s ? parseInt(s, 8) : 0; };

/** Validate a path for the capsule layout. Returns the refusal reason or null. */
export function capsulePathProblem(p: string): string | null {
  if (!p) return "empty path";
  if (p.includes("\0")) return "NUL in path";
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.startsWith("\\\\")) return "absolute path";
  if (p.includes("\\")) return "backslash in path";
  if (p.split("/").some((s) => s === ".." || s === ".")) return "parent or current directory segment (zip-slip)";
  if (!PATH_RE.test(p)) return "path outside the capsule layout or with an unsupported extension";
  return null;
}

/** Bounded decompression and full in-memory inspection. Nothing is written anywhere. */
export function inspectArchive(gz: Buffer): Entry[] {
  if (!Buffer.isBuffer(gz) || gz.length < 20) throw new CapsuleRefusal("archive", "not a capsule archive");
  if (gz.length > CAPSULE_LIMITS.max_compressed_bytes) throw new CapsuleRefusal("archive", "archive is larger than the capsule limit");
  let tar: Buffer;
  try { tar = gunzipSync(gz, { maxOutputLength: CAPSULE_LIMITS.max_total_bytes }); }
  catch (e) { throw new CapsuleRefusal("archive", /maxOutputLength|buffer|range/i.test(String((e as Error).message)) ? "decompressed size exceeds the capsule limit (decompression bomb refused)" : "archive is not valid gzip"); }
  if (tar.length > 1024 * 1024 && tar.length / gz.length > CAPSULE_LIMITS.max_ratio) throw new CapsuleRefusal("archive", `compression ratio ${Math.round(tar.length / gz.length)}:1 exceeds ${CAPSULE_LIMITS.max_ratio}:1 (decompression bomb refused)`);
  const out: Entry[] = []; const seen = new Set<string>();
  let off = 0;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    let sum = 0; for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i]!;
    if (sum !== oct(h, 148, 8)) throw new CapsuleRefusal("archive", "tar header checksum mismatch");
    const prefix = str(h, 345, 155), name = str(h, 0, 100);
    const path = prefix ? `${prefix}/${name}` : name;
    const type = String.fromCharCode(h[156]!) === "\0" ? "0" : String.fromCharCode(h[156]!);
    const size = oct(h, 124, 12), mode = oct(h, 100, 8);
    if (type === "1" || type === "2") throw new CapsuleRefusal("layout", `${JSON.stringify(path.slice(0, 120))}: hard or symbolic link entries are refused`);
    if (type !== "0") throw new CapsuleRefusal("layout", `${JSON.stringify(path.slice(0, 120))}: only regular files are allowed (type ${JSON.stringify(type)})`);
    const pp = capsulePathProblem(path);
    if (pp) throw new CapsuleRefusal("layout", `${JSON.stringify(path.slice(0, 120))}: ${pp}`);
    if (mode & 0o7111) throw new CapsuleRefusal("content", `${path}: executable or setuid mode bits are refused`);
    if (size > CAPSULE_LIMITS.max_entry_bytes) throw new CapsuleRefusal("archive", `${path}: entry of ${size} bytes exceeds ${CAPSULE_LIMITS.max_entry_bytes}`);
    if (seen.has(path)) throw new CapsuleRefusal("layout", `${path}: duplicate entry`);
    if (out.length >= CAPSULE_LIMITS.max_entries) throw new CapsuleRefusal("archive", `more than ${CAPSULE_LIMITS.max_entries} entries`);
    const start = off + 512;
    if (start + size > tar.length) throw new CapsuleRefusal("archive", `${path}: truncated entry`);
    const data = Buffer.from(tar.subarray(start, start + size));
    if (EXECUTABLE(data)) throw new CapsuleRefusal("content", `${path}: executable or nested archive content is refused`);
    seen.add(path); out.push({ path, data });
    off = start + Math.ceil(size / 512) * 512;
  }
  return out;
}

// ---------------------------------------------------------------- seal
const KDF = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function sealOracle(oracle: unknown, passphrase: string) {
  if (typeof passphrase !== "string" || passphrase.length < 12) throw new CapsuleRefusal("seal", "a training capsule needs a seal passphrase of at least 12 characters");
  const salt = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32, KDF), iv);
  const body = Buffer.concat([c.update(canonicalJson(oracle), "utf8"), c.final()]);
  return Buffer.concat([Buffer.from("DKS1"), salt, iv, c.getAuthTag(), body]);
}
export function openSeal(sealed: Buffer, passphrase: string): unknown {
  if (sealed.subarray(0, 4).toString("latin1") !== "DKS1") throw new CapsuleRefusal("seal", "not a sealed oracle attachment");
  const salt = sealed.subarray(4, 20), iv = sealed.subarray(20, 32), tag = sealed.subarray(32, 48);
  try { const d = createDecipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32, KDF), iv); d.setAuthTag(tag); return JSON.parse(Buffer.concat([d.update(sealed.subarray(48)), d.final()]).toString("utf8")); }
  catch { throw new CapsuleRefusal("seal", "the seal could not be opened (wrong passphrase or modified attachment)"); }
}

// ---------------------------------------------------------------- evidence references
interface CaseExport { manifest: { case_id: string; case_version: number; project_id: string; provenance?: { data_origin?: string }; section_sha256: Record<string, string> }; signature: string; sections: { case: { items: { item_id: string; kind: string; ref: string; removed?: unknown; bundle_id?: string; bundle_digest?: string; event_digest?: string; revision?: number }[] }; bundles: { bundle_id: string; bundle_digest: string; events?: { id: string }[] }[]; independent_events: { id: string }[]; unavailable: { item: string; ref: string; reason: string }[] } & Record<string, unknown> }
/** Supported evidence references, derived from the case export's content (never from the manifest). */
export function evidenceRefs(x: CaseExport): string[] {
  const refs = new Set<string>();
  for (const i of x.sections.case.items) {
    if ("removed" in i && i.removed) continue;
    if (i.kind === "finding") refs.add(`finding:${i.ref}@${i.revision ?? "?"}#bundle:${i.bundle_id}:${i.bundle_digest}`);
    if (i.kind === "event") refs.add(`event:${i.ref}#${i.event_digest}`);
  }
  for (const b of x.sections.bundles) for (const e of b.events ?? []) refs.add(`bundle:${b.bundle_id}/event:${e.id}`);
  for (const e of x.sections.independent_events) refs.add(`independent_event:${e.id}`);
  return [...refs].sort();
}

// ---------------------------------------------------------------- build
export interface BuildCapsuleInput {
  kind: "evidence_only" | "training"; caseExport: CaseExport; scene?: { digest: string; layout_version?: number | string | null; graph_revision: string } | null;
  regressions?: unknown[]; verifications?: unknown[]; oracle?: unknown; sealPassphrase?: string; signingSecret?: string; now?: Date;
}
export function buildCapsule(i: BuildCapsuleInput): { archive: Buffer; manifest: Record<string, unknown>; signature: string | null } {
  if (i.kind === "evidence_only" && i.oracle !== undefined) throw new CapsuleRefusal("content", "an evidence-only capsule never carries oracle or private-truth data; build a training capsule with a sealed attachment instead");
  if (i.kind === "training" && i.oracle === undefined) throw new CapsuleRefusal("seal", "a training capsule needs the oracle to seal");
  const entries: { path: string; data: Buffer; role: Role }[] = [];
  const j = (v: unknown) => Buffer.from(JSON.stringify(v, null, 1) + "\n", "utf8");
  const { signature: _sig, ...caseExport } = i.caseExport; // the server's case-export signature is replaced by the capsule's own
  entries.push({ path: "evidence/case-export.json", data: j(caseExport), role: "evidence" });
  if (i.scene) entries.push({ path: "scene/scene-revision.json", data: j(i.scene), role: "scene" });
  const regIds: string[] = [];
  for (const r of i.regressions ?? []) {
    const c = checkRegression(r);
    if (!c.ok) throw new CapsuleRefusal("schema", `regression descriptor refused: ${c.errors.slice(0, 3).join("; ")}`);
    regIds.push(c.value.regression_id);
    entries.push({ path: `regressions/${c.value.regression_id}.json`, data: j(c.value), role: "regression" });
  }
  (i.verifications ?? []).forEach((v, n) => entries.push({ path: `verifications/verification-${n + 1}.json`, data: j(v), role: "verification" }));
  const problems = entries.flatMap((e) => capsuleContentProblems(e.path, e.data));
  if (i.kind === "training") {
    const markers = leafStrings(i.oracle).filter((s) => s.length >= 12);
    for (const e of entries) { const t = e.data.toString("utf8"); if (markers.some((m) => t.includes(m))) problems.push(`${e.path}: contains an oracle value outside the sealed attachment`); }
  }
  if (problems.length) throw new CapsuleRefusal("content", `the capsule would contain forbidden content (${[...new Set(problems)].join("; ")})`, problems);
  let sealed: Record<string, unknown> | null = null;
  if (i.kind === "training") {
    const s = sealOracle(i.oracle, i.sealPassphrase ?? "");
    entries.push({ path: "sealed/oracle.dkseal", data: s, role: "sealed_oracle" });
    sealed = { path: "sealed/oracle.dkseal", cipher: "aes-256-gcm", kdf: "scrypt-N32768-r8-p1", ciphertext_sha256: sha256Buf(s), plaintext_commitment: sha256(canonicalJson(i.oracle)), separated: true, use: "training_and_evaluation_only" };
  }
  const x = i.caseExport;
  const manifest = {
    schema: CAPSULE_SCHEMA, kind: i.kind,
    capsule_id: `cap-${sha256(`${x.manifest.project_id}|${x.manifest.case_id}|${x.manifest.case_version}|${entries.map((e) => sha256Buf(e.data)).join(",")}`).slice(0, 16)}`,
    created_at: (i.now ?? new Date()).toISOString(),
    source: { project_ref: `sha256:${sha256(`project|${x.manifest.project_id}`).slice(0, 16)}`, case_id: x.manifest.case_id, case_version: x.manifest.case_version, data_origin: normalizeOrigin(x.manifest.provenance?.data_origin) },
    entries: entries.map((e) => ({ path: e.path, sha256: sha256Buf(e.data), bytes: e.data.length, role: e.role })),
    evidence_refs: evidenceRefs(x), absent_records: x.sections.unavailable.map((u) => ({ item: u.item, ref: u.ref, reason: u.reason.slice(0, 400) })),
    scene_revision: i.scene ? { digest: i.scene.digest, layout_version: i.scene.layout_version ?? null, graph_revision: i.scene.graph_revision } : null,
    regressions: regIds, sealed,
    excluded: ["oracle and private-truth data (evidence-only)", "tokens, secrets and provider credentials", "font files", "the source server's export signature", "audit log, users and API tokens"],
    integrity: CAPSULE_INTEGRITY, scope: "local_only_no_third_party_storage",
  };
  const mv = validateCapsuleManifest(manifest);
  if (!mv.ok) throw new CapsuleRefusal("schema", `invalid capsule manifest: ${mv.errors.join("; ")}`);
  const mtext = canonicalJson(manifest);
  const signature = i.signingSecret ? hmac(i.signingSecret, mtext) : null;
  const tarEntries = [{ path: "manifest.json", data: j(manifest) }, ...(signature ? [{ path: "signature.json", data: j({ alg: "hmac-sha256", manifest_sha256: sha256(mtext), signature, meaning: CAPSULE_INTEGRITY }) }] : []), ...entries.map((e) => ({ path: e.path, data: e.data }))];
  return { archive: gzipSync(packTar(tarEntries)), manifest, signature };
}
const hashBuf = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const sha256Buf = hashBuf;
const normalizeOrigin = (o: string | undefined) => (["synthetic_local", "synthetic", "live", "demo", "mixed"].includes(o ?? "") ? o! : "unknown");

// ---------------------------------------------------------------- import
export interface ImportedCapsule {
  namespace: string; manifest: Record<string, unknown>; kind: "evidence_only" | "training"; case_export: Omit<CaseExport, "signature">;
  evidence_refs: string[]; absent_records: { item: string; ref: string; reason: string }[]; regressions: RepairRegression[]; verifications: unknown[];
  scene_revision: unknown; sealed: { present: boolean; opened: boolean; commitment_ok: boolean | null; oracle?: unknown };
  checks: { entry_digests: "ok"; manifest_schema: "ok"; case_sections: "ok"; evidence_refs_rederived: "ok"; signature: "valid" | "absent" | "not_checked" | "not_from_this_instance" };
  integrity: string;
}
export function importCapsule(gz: Buffer, o: { signingSecret?: string; requireSignature?: boolean; sealPassphrase?: string } = {}): ImportedCapsule {
  const entries = inspectArchive(gz);
  const by = new Map(entries.map((e) => [e.path, e.data]));
  const mbuf = by.get("manifest.json");
  if (!mbuf) throw new CapsuleRefusal("layout", "manifest.json is missing");
  let manifest: Record<string, unknown>;
  try { manifest = JSON.parse(mbuf.toString("utf8")); } catch { throw new CapsuleRefusal("schema", "manifest.json is not JSON"); }
  const mv = validateCapsuleManifest(manifest);
  if (!mv.ok) throw new CapsuleRefusal("schema", `invalid capsule manifest: ${mv.errors.slice(0, 5).join("; ")}`, mv.errors);
  const listed = manifest.entries as { path: string; sha256: string; bytes: number; role: Role }[];
  const allowedExtra = new Set(["manifest.json", "signature.json"]);
  const extra = entries.filter((e) => !allowedExtra.has(e.path) && !listed.some((l) => l.path === e.path)).map((e) => e.path);
  if (extra.length) throw new CapsuleRefusal("integrity", `entries not listed in the manifest: ${extra.join(", ")}`);
  for (const l of listed) {
    const d = by.get(l.path);
    if (!d) throw new CapsuleRefusal("integrity", `${l.path} is listed but missing`);
    if (d.length !== l.bytes || hashBuf(d) !== l.sha256) throw new CapsuleRefusal("integrity", `${l.path} does not match its manifest digest`);
  }
  let signature: ImportedCapsule["checks"]["signature"] = "absent";
  const sbuf = by.get("signature.json");
  if (sbuf) {
    if (!o.signingSecret) signature = "not_checked";
    else { let s: { signature?: string } = {}; try { s = JSON.parse(sbuf.toString("utf8")); } catch { /* treated as not matching */ } signature = s.signature === hmac(o.signingSecret, canonicalJson(manifest)) ? "valid" : "not_from_this_instance"; }
  }
  if (o.requireSignature && signature !== "valid") throw new CapsuleRefusal("integrity", "a valid origin signature is required");
  const kind = manifest.kind as "evidence_only" | "training";
  const problems = listed.filter((l) => l.role !== "sealed_oracle").flatMap((l) => capsuleContentProblems(l.path, by.get(l.path)!));
  if (problems.length) throw new CapsuleRefusal("content", `the capsule contains forbidden content (${[...new Set(problems)].join("; ")})`, problems);
  const ce = JSON.parse(by.get("evidence/case-export.json")?.toString("utf8") ?? "null") as Omit<CaseExport, "signature"> | null;
  if (!ce?.manifest?.section_sha256 || !ce.sections) throw new CapsuleRefusal("schema", "evidence/case-export.json is missing or not a case export");
  for (const [k, v] of Object.entries(ce.sections)) if (ce.manifest.section_sha256[k] !== sha256(canonicalJson(v))) throw new CapsuleRefusal("integrity", `case export section ${k} does not match the case export's own digest`);
  const refs = evidenceRefs(ce as CaseExport);
  if (canonicalJson(refs) !== canonicalJson(manifest.evidence_refs)) throw new CapsuleRefusal("integrity", "the manifest's evidence references differ from those re-derived from the evidence");
  const absent = (ce.sections.unavailable ?? []).map((u) => ({ item: u.item, ref: u.ref, reason: u.reason.slice(0, 400) }));
  if (canonicalJson(absent) !== canonicalJson(manifest.absent_records)) throw new CapsuleRefusal("integrity", "the manifest's absent-record list differs from the evidence");
  const regressions = listed.filter((l) => l.role === "regression").map((l) => { const c = checkRegression(JSON.parse(by.get(l.path)!.toString("utf8"))); if (!c.ok) throw new CapsuleRefusal("schema", `${l.path}: ${c.errors.slice(0, 3).join("; ")}`); return c.value; });
  const verifications = listed.filter((l) => l.role === "verification").map((l) => JSON.parse(by.get(l.path)!.toString("utf8")));
  const scene = by.get("scene/scene-revision.json"); 
  const sealedMeta = manifest.sealed as { ciphertext_sha256: string; plaintext_commitment: string } | null;
  const sealed: ImportedCapsule["sealed"] = { present: !!sealedMeta, opened: false, commitment_ok: null };
  if (sealedMeta && o.sealPassphrase) {
    const oracle = openSeal(by.get("sealed/oracle.dkseal")!, o.sealPassphrase);
    sealed.opened = true; sealed.commitment_ok = sha256(canonicalJson(oracle)) === sealedMeta.plaintext_commitment;
    if (!sealed.commitment_ok) throw new CapsuleRefusal("seal", "the opened oracle does not match its plaintext commitment");
    sealed.oracle = oracle;
  }
  return {
    namespace: `capsule:${String(manifest.capsule_id).slice(4)}`, manifest, kind, case_export: ce, evidence_refs: refs, absent_records: absent, regressions, verifications,
    scene_revision: scene ? JSON.parse(scene.toString("utf8")) : null, sealed,
    checks: { entry_digests: "ok", manifest_schema: "ok", case_sections: "ok", evidence_refs_rederived: "ok", signature }, integrity: CAPSULE_INTEGRITY,
  };
}

// ---------------------------------------------------------------- server storage of imported capsules (new namespace)
export const CAPSULE_MIGRATION = `CREATE TABLE capsule_imports (namespace TEXT PRIMARY KEY, capsule_id TEXT NOT NULL, kind TEXT NOT NULL, manifest TEXT NOT NULL, body TEXT NOT NULL, imported_by TEXT NOT NULL, imported_at TEXT NOT NULL);`;
