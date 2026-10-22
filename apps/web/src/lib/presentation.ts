import type { CoverageRecord, Finding, OutcomeState, Severity } from '@dk/contracts';
import type { Dataset } from './data.ts';
import { SEVERITY_RANK } from './vocab.ts';

export type AssetCoverage = 'reporting' | 'partial' | 'gap' | 'unobserved' | 'unassessed';
export const ASSET_COVERAGE_LABEL: Record<AssetCoverage, string> = {
  reporting: 'Reporting sources available', partial: 'Partial visibility', gap: 'Coverage unavailable',
  unobserved: 'Unobserved', unassessed: 'Coverage not assessed',
};
export interface AssetStatus {
  /** Outcome and actual finding severity are deliberately separate dimensions. */
  worst: OutcomeState | null;
  severity: Severity | null;
  findingIds: string[];
  coverage: AssetCoverage;
  coverageNote?: string;
  configuredSources: number;
  reportingSources: number;
  recentEventIds: string[];
}
const OUTCOME_ORDER: OutcomeState[] = ['observed_effect', 'needs_review', 'attempted', 'unknown', 'blocked', 'refused', 'allowed'];
export const worstOutcome = (xs: OutcomeState[]): OutcomeState | null => OUTCOME_ORDER.find(o => xs.includes(o)) ?? null;
export const highestSeverity = (xs: Severity[]): Severity | null => [...xs].sort((a,b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])[0] ?? null;
export const sortFindings = (xs: Finding[]) => [...xs].sort((a,b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.last_received.localeCompare(a.last_received) || a.id.localeCompare(b.id));

/** Presentation-only summary of canonical CURRENT coverage. A reporting source never erases another gap. */
export function deriveAssetStatus(data: Dataset, findings: Finding[], coverage: CoverageRecord[]): Map<string, AssetStatus> {
  const result = new Map<string, AssetStatus>();
  for (const a of data.graph.assets) {
    const configured = data.sources.filter(s => s.asset_ids.includes(a.id));
    const records = coverage.filter(c => c.asset_ids.includes(a.id));
    const reporting = configured.filter(s => !s.disabled && records.some(c => c.source_id === s.id && c.state === 'healthy')).length;
    const assessmentMissing = configured.some(s => !records.some(c => c.source_id === s.id));
    const state: AssetCoverage = !configured.length ? 'unobserved' : assessmentMissing ? 'unassessed' : reporting === configured.length ? 'reporting' : reporting ? 'partial' : 'gap';
    const fs = findings.filter(f => f.lifecycle !== 'closed' && f.affected_asset_ids.includes(a.id));
    result.set(a.id, {
      worst: worstOutcome(fs.map(f => f.outcome_state)), severity: highestSeverity(fs.map(f => f.severity)),
      findingIds: [...new Set(fs.map(f => f.id))], coverage: state,
      configuredSources: configured.length, reportingSources: reporting,
      coverageNote: !configured.length ? 'No telemetry source is configured for this asset.' : `${reporting} of ${configured.length} configured sources reporting. ${state === 'unassessed' ? 'Some coverage records could not be assessed.' : records.filter(c => c.state !== 'healthy').map(c => c.note ?? c.label).join('; ')}`,
      recentEventIds: [],
    });
  }
  return result;
}
export function distinctSummary(findings: Finding[], status: Map<string, AssetStatus>, coverage: CoverageRecord[]) {
  const open = [...new Map(findings.filter(f => f.lifecycle !== 'closed').map(f => [f.id, f])).values()];
  return { openFindings: open.length, urgentFindings: open.filter(f => f.severity === 'critical' || f.severity === 'high').length,
    reviewFindings: open.filter(f => f.evidence_level === 'contradicted' || f.outcome_state === 'needs_review').length,
    sourcesUnavailable: new Set(coverage.filter(c => c.state !== 'healthy').map(c => c.source_id)).size,
    assetsWithGaps: [...status.values()].filter(s => s.coverage !== 'reporting').length };
}

/** A pinned investigation freezes evidence, not the independently timestamped current visibility snapshot. */
export function currentCoveragePresentation(pinned: Dataset, current: Dataset, findings: Finding[]) {
  return {
    coverage: current.coverage,
    unobserved: current.unobserved_asset_ids,
    coverageAsOf: current.coverage_as_of ?? current.window.end,
    assetStatus: deriveAssetStatus({ ...pinned, sources: current.sources }, findings, current.coverage),
  };
}
