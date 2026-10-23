/**
 * pnpm quickstart            start the local pack (data in .dk-local/, 127.0.0.1 only)
 * pnpm quickstart --reset    delete .dk-local/ and stop
 *
 * Prints the URL, a pack-only admin token, the guided steps, and how to drive real traffic. Ctrl-C stops it.
 */
import { resolve } from "node:path";
import { resetPack, startPack } from "./pack.ts";

const dir = resolve(process.env.DK_PACK_DIR ?? ".dk-local");
if (process.argv.includes("--reset")) { resetPack(dir); console.log(`Removed ${dir}. Nothing else was installed.`); process.exit(0); }
const pack = await startPack({ dataDir: dir, port: Number(process.env.DK_PORT ?? 8787), appPort: Number(process.env.DK_APP_PORT ?? 3080) });
const worker = setInterval(() => { for (let i = 0; i < 20 && pack.store.processBatch().processed; i++) { /* drain */ } }, 250);
console.log(`\nDigital Kingdom local pack (live project "local", not synthetic)\n  UI:        ${pack.url}/?project=local\n  Token:     ${pack.adminToken}   (this pack only; stored in ${dir})\n  App:       ${pack.appUrl}  (instrumented checkout-api)\n`);
for (const s of pack.steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.step.padEnd(12)} ${s.detail}`);
console.log(`\nTry:\n  curl ${pack.appUrl}/orders -H 'x-demo-user: alice'\n  curl "${pack.appUrl}/orders?q=1'+OR+1=1"\n  for i in 1 2 3 4 5 6; do curl -s -X POST ${pack.appUrl}/login -d '{"user":"ops","password":"x"}'; done\nAn agent run with an independently observed effect is recorded now; stop the pack to see the sources go silent.\nReset: pnpm quickstart --reset\n`);
await pack.runAgentTask(`quickstart-${Date.now()}`);
const stop = async () => { clearInterval(worker); await pack.stop(); process.exit(0); };
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
