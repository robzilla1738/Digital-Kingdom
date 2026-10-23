/**
 * Access recovery (roadmap R10.1): `pnpm admin:recover` with DK_DATA_DIR pointing at the server's data directory.
 * Requires filesystem access to the database (the operator's host), never an API credential, so no monitored
 * agent or service token can use it. It mints one HUMAN installation-admin token that expires in 24 hours and
 * records the recovery in the audit log. Service tokens cannot be created this way.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDb } from "../apps/server/src/db.ts";
import { Store } from "../apps/server/src/store.ts";

export function recoverAdmin(dataDir: string, reason: string, now = () => new Date()) {
  const file = join(resolve(dataDir), "digital-kingdom.db");
  if (!existsSync(file)) throw new Error(`no Digital Kingdom database at ${file}`);
  if (!reason.trim()) throw new Error("a reason is required (DK_RECOVERY_REASON)");
  const store = new Store(openDb(file), { now });
  const expiresAt = new Date(now().getTime() + 24 * 3600_000).toISOString();
  const t = store.createToken("recovery admin", "admin", "*", undefined, "human", { expiresAt });
  store.audit("local-recovery (filesystem access)", "admin.recovery", null, t.id, { reason: reason.slice(0, 300), expires_at: expiresAt });
  store.db.close();
  return t;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const t = recoverAdmin(process.env.DK_DATA_DIR ?? ".data", process.env.DK_RECOVERY_REASON ?? "");
  console.log(`Recovery admin token (expires ${t.expires_at}, shown once):\n${t.token}\nRevoke it after you restore normal access.`);
}
