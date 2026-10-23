import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "./db.ts";

/**
 * Encrypted backup and verified restore (roadmap R10.2).
 *
 * Backup: a consistent SQLite snapshot (`VACUUM INTO`, safe while the server runs), encrypted with AES-256-GCM
 * under a key derived (scrypt) from DK_BACKUP_PASSPHRASE. The file is `DKB1 | salt | iv | tag | ciphertext`; the
 * manifest (plaintext sha256, table counts, schema version, checkpoint) is inside the encrypted payload's header.
 * Restore: authenticate and decrypt, check the plaintext digest, run `PRAGMA integrity_check` and
 * `foreign_key_check`, and verify references (every finding's events exist, every checkpoint is within the
 * journal). Nothing is deleted from the source database by either operation.
 */
const MAGIC = Buffer.from("DKB1");
const key = (pass: string, salt: Buffer) => { if (pass.length < 12) throw new Error("backup passphrase must be at least 12 characters"); return scryptSync(pass, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); };

export interface BackupManifest { format: "dk-backup/1"; created_at: string; schema_version: number; checkpoint: number; counts: Record<string, number>; sha256: string; bytes: number }
const COUNTED = ["journal", "events", "findings", "projects", "sources", "cases", "evidence_bundles", "audit_log"];

function counts(db: DatabaseSync) {
  const out: Record<string, number> = {};
  for (const t of COUNTED) { try { out[t] = Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n); } catch { /* table absent in this version */ } }
  return out;
}

export function createBackup(db: DatabaseSync, passphrase: string, now = new Date()): { file: Buffer; manifest: BackupManifest } {
  const dir = mkdtempSync(join(tmpdir(), "dk-bak-"));
  try {
    const snap = join(dir, "snap.db");
    db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
    const plain = readFileSync(snap);
    const s = openDb(snap);
    const manifest: BackupManifest = { format: "dk-backup/1", created_at: now.toISOString(), schema_version: Number((s.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get() as { v: number }).v), checkpoint: Number((s.prepare("SELECT COALESCE(MAX(last_seq), 0) AS c FROM checkpoints WHERE name = 'normalizer'").get() as { c: number }).c), counts: counts(s), sha256: createHash("sha256").update(plain).digest("hex"), bytes: plain.length };
    s.close();
    const head = Buffer.from(JSON.stringify(manifest));
    const payload = Buffer.concat([Buffer.alloc(4), head, plain]); payload.writeUInt32BE(head.length, 0);
    const salt = randomBytes(16), iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", key(passphrase, salt), iv);
    c.setAAD(MAGIC);
    const ct = Buffer.concat([c.update(payload), c.final()]);
    return { file: Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), ct]), manifest };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export interface RestoreReport { manifest: BackupManifest; integrity: string; foreign_key_violations: number; dangling_finding_events: number; checkpoint_within_journal: boolean; counts_match: boolean; ok: boolean }

/** Decrypt, verify and write the restored database to `targetPath` (which must not be the live database). */
export function restoreBackup(file: Buffer, passphrase: string, targetPath: string): RestoreReport {
  if (file.subarray(0, 4).toString() !== "DKB1") throw new Error("not a Digital Kingdom backup");
  const salt = file.subarray(4, 20), iv = file.subarray(20, 32), tag = file.subarray(32, 48), ct = file.subarray(48);
  const d = createDecipheriv("aes-256-gcm", key(passphrase, salt), iv);
  d.setAAD(MAGIC); d.setAuthTag(tag);
  let payload: Buffer;
  try { payload = Buffer.concat([d.update(ct), d.final()]); } catch { throw new Error("backup authentication failed: wrong passphrase or modified file"); }
  const hl = payload.readUInt32BE(0);
  const manifest = JSON.parse(payload.subarray(4, 4 + hl).toString()) as BackupManifest;
  const plain = payload.subarray(4 + hl);
  if (createHash("sha256").update(plain).digest("hex") !== manifest.sha256) throw new Error("backup digest mismatch");
  writeFileSync(targetPath, plain, { flag: "wx" });
  const db = openDb(targetPath);
  try {
    const integrity = String((db.prepare("PRAGMA integrity_check").get() as Record<string, string>).integrity_check);
    const fk = (db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length;
    let dangling = 0;
    for (const f of db.prepare("SELECT body FROM findings").all() as { body: string }[]) {
      const b = JSON.parse(f.body) as { event_ids?: string[]; counterevidence_event_ids?: string[] };
      for (const id of [...(b.event_ids ?? []), ...(b.counterevidence_event_ids ?? [])]) if (!db.prepare("SELECT 1 FROM events WHERE id = ?").get(id)) dangling++;
    }
    const cp = Number((db.prepare("SELECT COALESCE(MAX(last_seq), 0) AS c FROM checkpoints WHERE name = 'normalizer'").get() as { c: number }).c);
    const maxSeq = Number((db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM journal").get() as { m: number }).m);
    const c = counts(db);
    const countsMatch = Object.entries(manifest.counts).every(([k, v]) => c[k] === v);
    const report = { manifest, integrity, foreign_key_violations: fk, dangling_finding_events: dangling, checkpoint_within_journal: cp <= maxSeq, counts_match: countsMatch, ok: false };
    report.ok = integrity === "ok" && fk === 0 && dangling === 0 && report.checkpoint_within_journal && countsMatch;
    return report;
  } finally { db.close(); }
}
