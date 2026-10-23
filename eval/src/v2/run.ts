import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { generateCases, generatePairs, preregisteredOrder, CONDITIONS, scoreAttempt, type V2Case, type Slot } from './harness.ts';
import { startV2Instance } from './instance.ts';
import { prepareCase } from './preflight.ts';
import { authorityProbes, ROOT } from '../instance.ts';
import { runAgent, DEFAULT_LIMITS, SYSTEM_DK, SYSTEM_BASELINE, redactAll, type AgentConfig } from '../agent.ts';
import { BudgetLedger } from '../budget.ts';
import { grade } from '../grade.ts';
import { SCENARIO_IDS, renderCase } from '../scenarios.ts';

const argument = (name: string, fallback: string) => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1]!; };
const out = argument('out', 'artifacts/eval-v2/completion');
const phase = argument('phase', 'prepare');
if (!['prepare', 'dev', 'full'].includes(phase)) throw new Error('phase must be prepare, dev or full');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const write = (name: string, value: unknown) => writeFileSync(join(out, name), JSON.stringify(value, null, 2), { flag: 'wx' });
mkdirSync(out, { recursive: true });
const preregistration = join(out, 'preregistration.json');
if (phase === 'prepare') {
  const seed = randomBytes(4).readUInt32LE();
  const generated = generateCases(seed), pairs = generatePairs(generated.cases, seed);
  const regressions: V2Case[] = SCENARIO_IDS.flatMap(id => (['a', 'b'] as const).map(variant => ({ ...renderCase(id, variant), seed_hash: 'existing-v1-regression' })));
  const cases = [...regressions, ...generated.cases, ...pairs.map(p => p.case)];
  const order: Slot[] = [...preregisteredOrder(regressions.map(c => c.spec.case_id), [], seed, 1), ...preregisteredOrder(generated.cases.filter(c => c.spec.split === 'heldout').map(c => c.spec.case_id), pairs, seed)];
  write('cases.json', cases);
  write('preregistration.json', { generated_at: new Date().toISOString(), ...generated.manifest, seed, order, case_digest: hash(JSON.stringify(cases)), review_sample_seed: hash(`review:${seed}`), model: 'meta/muse-spark-1.3-contributor', budget_usd: 5, stop_fraction: 0.8, approval: 'Owner approved completion plan with $5 total AI evaluation cap in this session.', plan_hash: hash(readFileSync('docs/AGENT_EVAL_V2_PLAN.md')), system_hashes: { dk: hash(SYSTEM_DK), baseline: hash(SYSTEM_BASELINE) }, scope: 'Synthetic data only; operator authored generator and tests. Independent human review pending; no claim of operator blinding.', objectives: 'For each normalized event: retrieve its full record. For each case: assess support, uncertainty and proportionate next steps against all retrieved evidence; semantic judgments remain pending.', limits: { ...DEFAULT_LIMITS, maxModelCalls: 8, maxToolCalls: 16, maxCompletionTokens: 4000, toolResultCharLimit: 200_000 } });
  console.log(JSON.stringify({ preregistration, full_attempts: order.length, dev_cases: generated.cases.filter(c => c.spec.split === 'dev').length }));
  process.exit(0);
}
if (!process.env.AI_GATEWAY_API_KEY || process.env.DK_EVAL_V2_APPROVED !== '1') throw new Error('approved credential required');
const registration = JSON.parse(readFileSync(preregistration, 'utf8'));
const cases: V2Case[] = JSON.parse(readFileSync(join(out, 'cases.json'), 'utf8'));
if (hash(JSON.stringify(cases)) !== registration.case_digest) throw new Error('preregistered cases changed');
const previous = existsSync(join(out, 'budget.json')) ? JSON.parse(readFileSync(join(out, 'budget.json'), 'utf8')) : { charged_upper_bound_usd: 0 };
const ledger = new BudgetLedger(5);
const priorCharge = (previous.charged_upper_bound_usd ?? 0) + (previous.outstanding_usd ?? 0);
if (priorCharge) { if (!ledger.reserve('previous', priorCharge)) throw new Error('previous charges exhausted the budget'); ledger.settle('previous', priorCharge); }
const catalog = await fetch('https://ai-gateway.vercel.sh/v1/models').then(r => r.json()) as { data: { id: string; pricing: { input: string; output: string } }[] };
const model = catalog.data.find(m => m.id === registration.model);
if (!model) throw new Error('requested model absent from live catalog');
const inputRate = Number(model.pricing.input), outputRate = Number(model.pricing.output);
if (!(inputRate > 0 && outputRate > 0 && Number.isFinite(inputRate + outputRate))) throw new Error('invalid live pricing');
const cfg: AgentConfig = { ...registration.limits, model: model.id, gatewayUrl: 'https://ai-gateway.vercel.sh/v1', apiKey: process.env.AI_GATEWAY_API_KEY, budget: { ledger, inputUsdPerToken: inputRate, outputUsdPerToken: outputRate } };
const order: Slot[] = phase === 'dev' ? cases.filter(c => c.spec.version === 'v2' && c.spec.split === 'dev').flatMap(c => CONDITIONS.map(condition => ({ case_id: c.spec.case_id, condition: condition.id, repetition: 1 }))) : registration.order;
const concurrency = Number(argument('concurrency', '1'));
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('concurrency must be an integer from 1 to 8');
const runId = `${phase}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const runDir = join(out, runId); mkdirSync(runDir);
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
write(`${runId}/manifest.json`, { revision, dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), lockfile_hash: hash(readFileSync('pnpm-lock.yaml')), preregistration_hash: hash(readFileSync(preregistration)), model, phase, order, concurrency, started_at: new Date().toISOString() });
let halted: string | null = null;
const summary: Record<string, unknown>[] = [];
async function attempt(index: number, slot: Slot) {
  if (halted) return;
  if (ledger.incurred >= 3.9) { halted = 'budget reserve threshold'; return; }
  const selected = cases.find(c => c.spec.case_id === slot.case_id)!;
  const attemptId = `${String(index + 1).padStart(4, '0')}-${slot.condition}`;
  let instance: Awaited<ReturnType<typeof startV2Instance>> | undefined;
  let record: Record<string, unknown> = { attempt_id: attemptId, ...slot };
  try {
    instance = await startV2Instance(selected.spec);
    const probes = await authorityProbes(instance);
    if (Object.values(probes).some(p => !p.ok)) throw new Error('authority probe failed; run halted');
    const prepared = await prepareCase(instance);
    record = { ...record, clock: instance.clock, probes, preflight: prepared.result, schemas: prepared.schemas, common_metadata: prepared.metadata };
    if (!prepared.result.valid) { record.status = 'invalid_case'; record.reasons = prepared.result.reasons; }
    else {
      const condition = CONDITIONS.find(c => c.id === slot.condition)!;
      const result = await runAgent({ mode: condition.delivery === 'mcp' ? 'dk' : 'baseline', cfg, task: selected.spec.task, dk: { url: instance.url, token: instance.agentToken, project: instance.projectId, mcpProfile: condition.tools.join(',') }, bundle: condition.id === 'C3' ? prepared.bundle : undefined, commonMetadata: prepared.metadata, secrets: [cfg.apiKey, instance.agentToken] });
      const automatic = grade(result, selected.key, instance.known, probes, instance.projectId, selected.spec.task);
      const exposed = condition.id === 'C3' ? [JSON.stringify(prepared.bundle)] : result.transcript.filter(e => e.type === 'tool_result').map(e => e.type === 'tool_result' ? e.text : '');
      const objectives = [...prepared.events.map(event => ({ id: `retrieve:${event.id}`, kind: 'retrieval' as const, evidence: [event.id] })), { id: 'supported-proportionate-conclusion', kind: 'reasoning' as const, evidence: prepared.events.map(e => e.id) }];
      const completed = ['completed', 'tool_budget_exhausted_then_completed'].includes(result.status);
      const scoring = scoreAttempt({ attempt_id: attemptId, case_id: slot.case_id, condition: slot.condition, tool_results: exposed, status: !completed ? result.status === 'timeout' ? 'timeout' : 'provider_error' : automatic.schema_ok ? 'completed' : 'schema_failure' }, objectives, prepared.result);
      record = { ...record, status: result.status, result, automatic, objectives, scoring, human_review: 'pending' };
      if (result.error?.includes('budget') || result.error?.includes('exceeded the reserved') || result.error?.includes('HTTP 401') || result.error?.includes('HTTP 403')) halted = result.error;
      const resolved = result.transcript.filter(e => e.type === 'model_call').map(e => e.type === 'model_call' ? e.resolved_model : undefined);
      if (resolved.some(id => id && id !== model.id && id !== model.id.split('/').at(-1))) halted = 'provider returned a different model';
    }
  } catch (error) { record.status = 'harness_failure'; record.error = redactAll(String(error), [cfg.apiKey]); halted = String(record.error); }
  finally { await instance?.stop(); }
  write(`${runId}/${attemptId}.json`, JSON.parse(redactAll(JSON.stringify(record), [cfg.apiKey])));
  writeFileSync(join(out, 'budget.json'), JSON.stringify({ charged_upper_bound_usd: ledger.incurred, outstanding_usd: ledger.outstanding, cap_usd: 5, updated_at: new Date().toISOString() }, null, 2));
  const progress = { attempt: attemptId, ...slot, status: record.status, charged_upper_bound_usd: ledger.incurred };
  summary.push(progress); appendFileSync(join(runDir, 'progress.jsonl'), JSON.stringify(progress) + '\n'); console.log(JSON.stringify(progress));
}
// Launch slots in the registered order; finish each batch before starting the next.
// Eight divides the 48-regression prefix, so held-out calls cannot precede its completion.
for (let index = 0; index < order.length && !halted; index += concurrency) {
  const count = phase === 'full' && index < 48 ? Math.min(concurrency, 48 - index) : concurrency;
  await Promise.all(order.slice(index, index + count).map((slot, offset) => attempt(index + offset, slot)));
  if (count !== concurrency) index += count - concurrency;
}
write(`${runId}/summary.json`, { started: summary.length, planned: order.length, halted, charged_upper_bound_usd: ledger.incurred, attempts: summary, human_review: 'pending' });
if (halted) process.exitCode = 1;
