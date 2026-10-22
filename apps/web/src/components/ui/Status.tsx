import type { Finding, Severity } from "@dk/contracts";
import { EVIDENCE_LEVEL_LABEL, OUTCOME_STYLE, SEVERITY_LABEL } from "../../lib/vocab.ts";
import { StateIcon, GapIcon } from "../../lib/icons.tsx";
import { ASSET_COVERAGE_LABEL } from "../../lib/presentation.ts";
export function SeverityBadge({ severity }: { severity: Severity }) { return <span className={`sev sev-${severity}`}>{SEVERITY_LABEL[severity]}</span>; }
export function OutcomeBadge({ outcome }: { outcome: Finding["outcome_state"] }) { return <span className="status-chip"><StateIcon state={outcome} />{OUTCOME_STYLE[outcome].label}</span>; }
export function EvidenceBadge({ level }: { level: Finding["evidence_level"] }) { return <span className={`status-chip ${level === "contradicted" || level === "not_assessed" ? "warning" : ""}`}>{EVIDENCE_LEVEL_LABEL[level]}</span>; }
export function CoverageChip({ state }: { state: keyof typeof ASSET_COVERAGE_LABEL }) { return <span className={`status-chip coverage-${state}`}>{state !== "reporting" && <GapIcon />}{ASSET_COVERAGE_LABEL[state]}</span>; }
