/**
 * Generates fixtures/legacy/v0.3-after-v0.3.1-startup.sqlite: the genuine v0.3 fixture after ONE startup
 * of the genuine v0.3.1 code (commit 609871b), i.e. the state an installation is left in by the v0.3.1
 * upgrade bug (pending rows with in-payload _dk_redaction tombstoned).
 *
 *   git worktree add /tmp/v031wt 609871b   (link node_modules as described in docs/UPGRADING.md)
 *   cp fixtures/legacy/v0.3-journal.sqlite /tmp/out.sqlite
 *   cd /tmp/v031wt && npx tsx <repo>/scripts/make-v031-startup-fixture.ts /tmp/out.sqlite
 *
 * Must run with cwd = the v0.3.1 worktree (it imports ./apps/server/src).
 */
import { join } from "node:path";
const root = process.cwd();
const { openDb } = await import(join(root, "apps/server/src/db.ts"));
const { Store } = await import(join(root, "apps/server/src/store.ts"));
const out = process.argv[2]!;
const s = new Store(openDb(out)); // v0.3.1 startup: migrations + its legacy minimization
console.log(s.db.prepare("SELECT seq, source_event_id, minimized FROM journal ORDER BY seq").all());
s.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); s.db.close();
