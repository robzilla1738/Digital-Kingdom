import type { CoverageState, FindingEvidenceLevel, OutcomeState, Severity, EventOutcome, AssetKind } from "@dk/contracts";

/** One visual vocabulary for 3D, 2D, lists and text. Colour is always paired with a shape and a word. */
export interface StateStyle { label: string; color: string; shape: "shield" | "diamond" | "ring" | "triangle" | "square" | "hatch" | "circle"; glyph: string; describe: string }

export const OUTCOME_STYLE: Record<OutcomeState, StateStyle> = {
  blocked: { label: "Blocked", color: "#6aa3dc", shape: "shield", glyph: "▣", describe: "A control reported stopping it." },
  attempted: { label: "Attempted", color: "#e2b84f", shape: "diamond", glyph: "◆", describe: "An attempt was recorded; no effect is established." },
  allowed: { label: "Allowed", color: "#8fb39a", shape: "circle", glyph: "●", describe: "The request was allowed; that is not proof of harm." },
  refused: { label: "Refused", color: "#a99cf0", shape: "square", glyph: "□", describe: "A model declined; this is not enforcement." },
  needs_review: { label: "Needs review", color: "#f08c4a", shape: "triangle", glyph: "▲", describe: "Evidence needs a human decision." },
  observed_effect: { label: "Observed effect", color: "#f2626f", shape: "ring", glyph: "◎", describe: "An independent observer recorded an effect." },
  unknown: { label: "Unknown", color: "#9aa3af", shape: "hatch", glyph: "▨", describe: "Not assessable from available evidence." },
};

export const EVIDENCE_LEVEL_LABEL: Record<FindingEvidenceLevel, string> = {
  source_reported: "Source-reported",
  corroborated: "Corroborated by an independent source",
  contradicted: "Sources contradict each other",
  analyst_confirmed: "Analyst-confirmed",
  not_assessed: "Not assessed (missing evidence)",
};

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export const COVERAGE_STYLE: Record<CoverageState, { label: string; color: string; describe: string }> = {
  healthy: { label: "Reporting", color: "#4fbf8a", describe: "Source is sending events." },
  degraded: { label: "Stale", color: "#e2b84f", describe: "Source has gone quiet longer than expected." },
  offline: { label: "Offline", color: "#f2626f", describe: "Source reports itself unavailable." },
  not_assessed: { label: "No data yet", color: "#9aa3af", describe: "Nothing received; unknown, not safe." },
};

export const EVENT_OUTCOME_COLOR: Record<EventOutcome, string> = {
  allowed: "#8fb39a", success: "#8fb39a", denied: "#6aa3dc", blocked: "#6aa3dc", failure: "#e2b84f", attempted: "#e2b84f", refused: "#a99cf0", observed: "#f2626f", unknown: "#9aa3af",
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

export const RELATIONSHIP_LAYER: Record<string, "runtime" | "identity" | "deployment" | "tools"> = {
  calls: "runtime", reads_from: "runtime", writes_to: "runtime", belongs_to: "runtime", protected_by: "runtime",
  runs_as: "identity", may_assume: "identity", deploys: "deployment", invokes_tool: "tools",
};
export const LAYER_STYLE = {
  runtime: { label: "Runtime calls", color: "#9aa4b5" },
  identity: { label: "Identity & permissions", color: "#b48cf2" },
  deployment: { label: "Deployment", color: "#4fc2a3" },
  tools: { label: "Agent tools", color: "#5cb4ea" },
} as const;
export type Layer = keyof typeof LAYER_STYLE;

export const fmtTime = (iso: string) => new Date(iso).toISOString().slice(11, 19) + " UTC";
export const fmtDateTime = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";

export const SEVERITY_LABEL: Record<Severity, string> = { info: "Info", low: "Low", medium: "Medium", high: "High", critical: "Critical" };
/** Short relative duration like "3m 20s" for replay readouts. */
export const fmtSpan = (ms: number) => { const s = Math.round(ms / 1000); const m = Math.floor(s / 60); return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`; };
