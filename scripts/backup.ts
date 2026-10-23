/**
 * pnpm backup  -> writes an encrypted backup of DK_DATA_DIR/digital-kingdom.db to DK_BACKUP_OUT (default ./dk-<time>.dkb)
 * pnpm restore -> DK_BACKUP_IN=file DK_RESTORE_TO=path verifies and writes a restored database (never over an existing file)
 * Both need DK_BACKUP_PASSPHRASE (>= 12 characters). The passphrase is never written anywhere.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDb } from "../apps/server/src/db.ts";
import { createBackup, restoreBackup } from "../apps/server/src/backup.ts";

const pass = process.env.DK_BACKUP_PASSPHRASE ?? "";
if (process.argv.includes("--restore")) {
  const r = restoreBackup(readFileSync(String(process.env.DK_BACKUP_IN)), pass, resolve(String(process.env.DK_RESTORE_TO)));
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
} else {
  const db = openDb(join(resolve(process.env.DK_DATA_DIR ?? ".data"), "digital-kingdom.db"));
  const t0 = Date.now();
  const { file, manifest } = createBackup(db, pass);
  const out = resolve(process.env.DK_BACKUP_OUT ?? `dk-${manifest.created_at.replace(/[:.]/g, "-")}.dkb`);
  writeFileSync(out, file, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ out, ms: Date.now() - t0, ...manifest }, null, 2));
}
