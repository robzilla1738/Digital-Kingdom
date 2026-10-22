import type { CoverageState, FindingEvidenceLevel, OutcomeState, Severity, EventOutcome, AssetKind } from "@dk/contracts";

/** One visual vocabulary for 3D, 2D, lists and text. Colour is always paired with a shape and a word. */
export interface StateStyle { label: string; color: string; shape: "shield" | "diamond" | "ring" | "triangle" | "square" | "hatch" | "circle"; glyph: string; describe: string }

export const OUTCOME_STYLE: Record<OutcomeState, StateStyle> = {
  blocked: { label: "Blocked", color: "#7fa7d6", shape: "shield", glyph: "▣", describe: "A control reported stopping it." },
  attempted: { label: "Attempted", color: "#e3b55b", shape: "diamond", glyph: "◆", describe: "An attempt was recorded; no effect is established." },
  allowed: { label: "Allowed", color: "#9fb7a0", shape: "circle", glyph: "●", describe: "The request was allowed; that is not proof of harm." },
  refused: { label: "Refused", color: "#a9a1d8", shape: "square", glyph: "□", describe: "A model declined; this is not enforcement." },
  needs_review: { label: "Needs review", color: "#f08a4b", shape: "triangle", glyph: "▲", describe: "Evidence needs a human decision." },
  observed_effect: { label: "Observed effect", color: "#ef5d6c", shape: "ring", glyph: "◎", describe: "An independent observer recorded an effect." },
  unknown: { label: "Unknown", color: "#a7adb8", shape: "hatch", glyph: "▨", describe: "Not assessable from available evidence." },
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
  healthy: { label: "Reporting", color: "#7cc29a", describe: "Source is sending events." },
  degraded: { label: "Stale", color: "#e3b55b", describe: "Source has gone quiet longer than expected." },
  offline: { label: "Offline", color: "#ef5d6c", describe: "Source reports itself unavailable." },
  not_assessed: { label: "No data yet", color: "#a7adb8", describe: "Nothing received; unknown, not safe." },
};

export const EVENT_OUTCOME_COLOR: Record<EventOutcome, string> = {
  allowed: "#8fa79a", success: "#8fa79a", denied: "#7fa7d6", blocked: "#7fa7d6", failure: "#e3b55b", attempted: "#e3b55b", refused: "#a9a1d8", observed: "#ef5d6c", unknown: "#a7adb8",
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
  runtime: { label: "Runtime calls", color: "#d8c9a3" },
  identity: { label: "Identity & permissions", color: "#b59cf0" },
  deployment: { label: "Deployment", color: "#6cc3b8" },
  tools: { label: "Agent tools", color: "#68b7ec" },
} as const;
export type Layer = keyof typeof LAYER_STYLE;

export const fmtTime = (iso: string) => new Date(iso).toISOString().slice(11, 19) + " UTC";
export const fmtDateTime = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
