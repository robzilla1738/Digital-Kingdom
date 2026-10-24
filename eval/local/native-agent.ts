/**
 * LP24 — bring-your-agent kit for the owner's existing coding agent (Claude Code, Cursor, ...).
 *
 *   tsx eval/local/native-agent.ts --scenario LW-01 --dir <empty dir outside the repo>
 *
 * Starts a fresh local world + Digital Kingdom server, runs the scenario, opens the guided case, then writes
 *   TASK.md     the public task and answer shape (no scenario, seed, truth or answer hints)
 *   mcp.json    an mcpServers entry that launches the recording proxy -> investigation-read profile, with a
 *               project-scoped service viewer token (file mode 0600; the token dies with this process)
 * and waits for <dir>/answer.json. The run is labelled development_assisted: a coding agent may read the repository,
 * where dev scenario documents live, so it is never a blinded or held-out result. The trace (trace.jsonl) holds the
 * observable tool I/O captured by the proxy; the agent's own reasoning is not visible to, or recorded by, Digital Kingdom.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT } from "../src/instance.ts";
import { startLocalCase, type LocalCase } from "./controller.ts";
import { ANSWER_SHAPE, parseAnswer } from "./answer.ts";
import { declareMode } from "./modes.ts";
import { answerKey, gradeAnswer } from "./referee.ts";
import { exposure } from "./recorder.ts";

export function nativeAgentKit(c: LocalCase, dir: string) {
  const mode = declareMode("native_agent", {}, { mcp_profile: "investigation-read (via recording proxy)", credential: "project-scoped service viewer token" });
  const trace = join(dir, "trace.jsonl");
  const tsx = join(ROOT, "node_modules/.bin/tsx");
  const config = { mcpServers: { "digital-kingdom-local-investigation": { command: tsx, args: [join(ROOT, "eval/local/mcp-proxy.ts")], env: { DK_URL: c.public.url, DK_PROJECT: c.public.project, DK_MCP_PROFILE: "investigation-read", DK_TOKEN: c.public.token, DK_LI_TRACE: trace } } } };
  const task = `# Local investigation task (${mode.label})

${c.public.task}

Digital Kingdom project \`${c.public.project}\`, case \`${c.public.case_id}\`, interval ${c.public.interval.after} to ${c.public.interval.before}.
Use ONLY the \`digital-kingdom-local-investigation\` MCP server (read-only investigation profile). Start with dk_session, then dk_read_contract and dk_get_packet.

Write your answer to \`answer.json\` in this directory, exactly this shape:

\`\`\`json
${ANSWER_SHAPE}
\`\`\`

Label: this run is **${mode.label}** (your agent may have repository access), not a blinded or held-out evaluation.
`;
  return { mode, trace, config, task };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("native-agent.ts")) {
  const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
  const id = arg("scenario") ?? "LW-01", dir = resolve(arg("dir") ?? "");
  if (!arg("dir")) { console.error("--dir <empty directory outside the repository> is required"); process.exit(2); }
  if (dir.startsWith(ROOT)) { console.error("use a directory outside the repository"); process.exit(2); }
  mkdirSync(dir, { recursive: true });
  const doc = JSON.parse(readFileSync(join(ROOT, `scenarios/local-world/dsl/${id}.scenario.json`), "utf8"));
  const c = await startLocalCase(doc);
  const kit = nativeAgentKit(c, dir);
  writeFileSync(join(dir, "TASK.md"), kit.task, { flag: "wx" });
  writeFileSync(join(dir, "mcp.json"), JSON.stringify(kit.config, null, 2), { flag: "wx", mode: 0o600 });
  console.log(`wrote ${dir}/TASK.md and ${dir}/mcp.json; waiting up to 30 minutes for ${dir}/answer.json (Ctrl-C to stop)`);
  const deadline = Date.now() + 30 * 60_000;
  while (!existsSync(join(dir, "answer.json")) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 2000));
  const parsed = parseAnswer(existsSync(join(dir, "answer.json")) ? readFileSync(join(dir, "answer.json"), "utf8") : null);
  const key = answerKey(doc.blueprint, doc, c.private.truth, c.private.world.world);
  const responses = existsSync(kit.trace) ? readFileSync(kit.trace, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.kind === "tool_call").map((e) => e.response) : [];
  const ex = exposure(await c.storedEvents(), responses);
  writeFileSync(join(dir, "result.json"), JSON.stringify({ label: kit.mode.label, blinded: false, parse: parsed.ok ? "ok" : parsed.error, objective: parsed.ok ? gradeAnswer(key, parsed.answer) : null, exposed_records: ex.any.length }, null, 2));
  console.log(`graded -> ${dir}/result.json`);
  await c.stop();
}
