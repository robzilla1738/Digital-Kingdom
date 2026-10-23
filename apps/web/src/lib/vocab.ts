import type { CoverageState, FindingEvidenceLevel, OutcomeState, Severity, EventOutcome, AssetKind } from "@dk/contracts";

/** One visual vocabulary for 3D, 2D, lists and text. Colour is always paired with a shape and a word. */
export interface StateStyle { label: string; color: string; shape: "shield" | "diamond" | "ring" | "triangle" | "square" | "hatch" | "circle"; glyph: string; describe: string }

export const OUTCOME_STYLE: Record<OutcomeState, StateStyle> = {
  blocked: { label: "Blocked", color: "#92B9FF", shape: "shield", glyph: "▣", describe: "The source reported a block. Downstream effects and intent are not established by this record alone." },
  attempted: { label: "Attempted", color: "#E8BE78", shape: "diamond", glyph: "◆", describe: "An attempt was recorded; no effect is established." },
  allowed: { label: "Allowed", color: "#B2BBC8", shape: "circle", glyph: "●", describe: "The request was allowed; that is not proof of harm." },
  refused: { label: "Refused", color: "#A6B6FF", shape: "square", glyph: "□", describe: "A model declined; this is not enforcement." },
  needs_review: { label: "Needs review", color: "#F19A85", shape: "triangle", glyph: "▲", describe: "Evidence needs a human decision." },
  observed_effect: { label: "Observed effect", color: "#FF8F98", shape: "ring", glyph: "◎", describe: "An effect was recorded. Malicious intent or compromise is not established by this alone." },
  unknown: { label: "Unknown", color: "#B2BBC8", shape: "hatch", glyph: "▨", describe: "Not assessable from available evidence." },
};

export const EVIDENCE_LEVEL_LABEL: Record<FindingEvidenceLevel, string> = {
  source_reported: "Source-reported",
  corroborated: "Corroborated by an independent source",
  contradicted: "Sources disagree",
  analyst_confirmed: "Analyst-confirmed",
  not_assessed: "Not assessed (missing evidence)",
};

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export const COVERAGE_STYLE: Record<CoverageState, { label: string; color: string; describe: string }> = {
  healthy: { label: "Reporting", color: "#89C6AE", describe: "This source is currently reporting according to configured freshness checks; this does not establish complete detection." },
  degraded: { label: "Stale", color: "#E8BE78", describe: "Source has gone quiet longer than expected." },
  offline: { label: "Offline", color: "#FF8F98", describe: "Source is unavailable or administratively disabled; this is not the asset availability state." },
  not_assessed: { label: "No data yet", color: "#B2BBC8", describe: "Nothing received; unknown, not safe." },
};

export const EVENT_OUTCOME_COLOR: Record<EventOutcome, string> = {
  allowed: "#B2BBC8", success: "#B2BBC8", denied: "#92B9FF", blocked: "#92B9FF", failure: "#E8BE78", attempted: "#E8BE78", refused: "#A6B6FF", observed: "#FF8F98", unknown: "#B2BBC8",
};

export const KIND_LABEL: Record<AssetKind, string> = {
  edge: "Edge gateway", auth: "Authentication", service: "Service", worker: "Worker", database: "Database", storage: "Storage",
  agent: "AI agent", tool_server: "Agent tool server", pipeline: "Build pipeline", third_party: "Third-party service",
};

export const ACTION_LABEL: Record<string, string> = {
  request_received: "Request", authentication: "Sign-in", authorization_change: "Privilege change", decoy_used: "Decoy used",
  sensor_unavailable: "Sensor offline", sensor_restored: "Sensor restored", waf_match: "WAF match", data_access: "Data access",
  tool_invocation: "Tool call", side_effect_observed: "Effect observed", runtime_alert: "Runtime alert",
};

export const RELATIONSHIP_LAYER: Record<string, "runtime" | "identity" | "data" | "deployment" | "tools"> = {
  calls: "runtime", reads_from: "data", writes_to: "data", belongs_to: "runtime", protected_by: "runtime",
  runs_as: "identity", may_assume: "identity", deploys: "deployment", invokes_tool: "tools",
};
export const LAYER_STYLE = {
  runtime: { label: "Runtime calls", color: "#91A4BA" },
  identity: { label: "Identity & permissions", color: "#A6B6FF" },
  data: { label: "Data access", color: "#D3B37A" },
  deployment: { label: "Deployment", color: "#89C6AE" },
  tools: { label: "Agent tools", color: "#92B9FF" },
} as const;
export type Layer = keyof typeof LAYER_STYLE;

export const fmtTime = (iso: string) => new Date(iso).toISOString().slice(11, 19) + " UTC";
export const fmtDateTime = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";

export const SEVERITY_LABEL: Record<Severity, string> = { info: "Info", low: "Low", medium: "Medium", high: "High", critical: "Critical" };
/** Short relative duration like "3m 20s" for replay readouts. */
export const fmtSpan = (ms: number) => { const s = Math.round(ms / 1000); const m = Math.floor(s / 60); return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`; };

/** Severity colors never stand in for outcome, evidence confidence, or coverage. */
export const SEVERITY_COLOR: Record<Severity,string> = { info: "#92B9FF", low: "#B2BBC8", medium: "#E8BE78", high: "#F19A85", critical: "#FF8F98" };
