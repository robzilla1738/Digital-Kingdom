import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

it('keeps failed attempts in denominators and leaves sampled semantic review pending', () => {
  const root = mkdtempSync(join(tmpdir(), 'dk-v2-report-')), run = join(root, 'full-test'); mkdirSync(run);
  const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
  try {
    write(join(root, 'preregistration.json'), { review_sample_seed: 'fixed' });
    write(join(root, 'cases.json'), [{ spec: { case_id: 'held', version: 'v2', scenario_id: 'family', task: 'Question' } }]);
    write(join(run, 'manifest.json'), { phase: 'full', model: { id: 'synthetic' }, concurrency: 1 });
    write(join(run, 'summary.json'), { planned: 2, halted: null, charged_upper_bound_usd: 0 });
    const base = { case_id: 'held', condition: 'C1', repetition: 1, preflight: { valid: true }, objectives: [{ kind: 'retrieval' }], automatic: { schema_ok: true, refs_ok: true, authority: { probes_ok: true }, flags: {} } };
    write(join(run, '0001-C1.json'), { ...base, attempt_id: '0001-C1', status: 'completed', exposed_event_ids: ['event'], scoring: { status: 'pending_review', reasoning_when_judged: { pending_review: 1 } } });
    write(join(run, '0002-C1.json'), { ...base, attempt_id: '0002-C1', status: 'timeout', exposed_event_ids: [], scoring: { status: 'unsuccessful' } });
    execFileSync(process.execPath, ['--import', 'tsx', 'eval/src/v2/report.ts', run]);
    const report = JSON.parse(readFileSync(join(run, 'report.json'), 'utf8'));
    expect(report.by_track_and_condition['heldout/C1']).toMatchObject({ started: 2, retrieval: { passed: 1, denominator: 2 }, end_to_end: { successful: 0, denominator: 2, pending: 1, unsuccessful: 1 } });
    expect(report.review_packet.required_attempt_ids).toEqual(['0001-C1', '0002-C1']);
    expect(report.review_packet.reviewed_attempt_ids).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
