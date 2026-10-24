/**
 * LP24 — execution modes for local-intelligence investigations (04_AI_LOOP_AND_EVALUATION.md §3, §6).
 *
 * Four modes are declared; none is ever chosen implicitly:
 *  - scripted: a deterministic client, no model. Label `scripted`.
 *  - native_agent: the owner's existing coding agent connected to the scoped MCP profile. A coding agent has (or may
 *    have) repository, filesystem and shell access, and may have seen the implementation and fixtures, so its runs are
 *    ALWAYS `development_assisted`, never held-out blinded, whatever the caller claims.
 *  - local_model: an already running loopback model endpoint, only when one is explicitly configured.
 *  - approved_provider: a remote paid route, only with an explicit route id, model id, positive cap and approval flag
 *    for THIS phase (never the historical $5 v2 approval) and a credential present.
 * A missing or partial configuration resolves to `not_exercised` with the reason; it never falls back to another route.
 */
export const EXECUTION_MODES = ["scripted", "native_agent", "local_model", "approved_provider"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];
export type RunLabel = "scripted" | "development_assisted" | "restricted_model";

export interface Capabilities {
  mcp_profile: string; credential: string;
  repository_access: boolean; filesystem: boolean; shell: boolean; network: boolean;
  /** Whether the agent may already have seen implementation, fixtures or scenario documents. */
  prior_exposure_to_fixtures: boolean;
}

export interface ModelRoute { kind: "ai_gateway" | "local_loopback"; base_url: string; model: string; cap_usd: number; approval: string }

export interface ModeDeclaration {
  mode: ExecutionMode; label: RunLabel; status: "ready" | "not_exercised";
  reason: string; capabilities: Capabilities; route: ModelRoute | null;
  /** AI-specific acceptance checks (model behaviour) are exercised only with a ready model route. */
  ai_checks: "exercised" | "not_exercised";
  blinded: boolean;
}

const RESTRICTED: Omit<Capabilities, "mcp_profile" | "credential"> = { repository_access: false, filesystem: false, shell: false, network: false, prior_exposure_to_fixtures: false };

/** The label follows from capabilities, never from what the caller asserts. */
export function labelFor(mode: ExecutionMode, c: Capabilities): RunLabel {
  if (mode === "scripted") return "scripted";
  if (mode === "native_agent" || c.repository_access || c.filesystem || c.shell || c.network || c.prior_exposure_to_fixtures) return "development_assisted";
  return "restricted_model";
}

export class ModeError extends Error {}

/**
 * Resolve a requested mode against an explicit environment. Nothing is read from defaults: the caller passes the
 * environment it intends to use, and a mode whose route is incomplete is `not_exercised`.
 */
export function declareMode(requested: string | undefined, env: Record<string, string | undefined>, c: { mcp_profile: string; credential: string } & Partial<Capabilities>, claim?: { blinded?: boolean }): ModeDeclaration {
  if (!requested || !(EXECUTION_MODES as readonly string[]).includes(requested)) throw new ModeError(`mode must be stated explicitly as one of ${EXECUTION_MODES.join(", ")}; no mode is selected by default`);
  const mode = requested as ExecutionMode;
  const caps: Capabilities = { ...RESTRICTED, ...c, ...(mode === "native_agent" ? { repository_access: c.repository_access ?? true, filesystem: c.filesystem ?? true, shell: c.shell ?? true, prior_exposure_to_fixtures: c.prior_exposure_to_fixtures ?? true } : {}) };
  const label = labelFor(mode, caps);
  if (claim?.blinded && label !== "restricted_model") throw new ModeError(`a ${mode} run with ${label} capabilities cannot be declared blinded or held-out`);
  const base = { mode, label, capabilities: caps, blinded: label === "restricted_model" };
  if (mode === "scripted") return { ...base, status: "ready", reason: "deterministic client; no model", route: null, ai_checks: "not_exercised" };
  if (mode === "native_agent") return { ...base, status: "ready", reason: "owner's coding agent via the scoped MCP profile; repository/oracle access possible, so development_assisted", route: null, ai_checks: "not_exercised" };
  if (mode === "local_model") {
    const url = env.DK_LI_LOCAL_MODEL_URL, model = env.DK_LI_LOCAL_MODEL;
    if (!url || !model) return { ...base, status: "not_exercised", reason: "no local model endpoint configured (DK_LI_LOCAL_MODEL_URL and DK_LI_LOCAL_MODEL unset); no other route substituted", route: null, ai_checks: "not_exercised" };
    let host = "";
    try { host = new URL(url).hostname; } catch { throw new ModeError("DK_LI_LOCAL_MODEL_URL is not a URL"); }
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) throw new ModeError("local_model must be a loopback endpoint; a remote URL needs approved_provider");
    return { ...base, status: "ready", reason: "configured loopback model", route: { kind: "local_loopback", base_url: url, model, cap_usd: 0, approval: "local endpoint, no spend" }, ai_checks: "exercised" };
  }
  // approved_provider
  const route = env.DK_LI_ROUTE, model = env.DK_LI_MODEL, cap = Number(env.DK_LI_CAP_USD), approved = env.DK_LI_APPROVED, key = env.AI_GATEWAY_API_KEY;
  const missing = [!route && "DK_LI_ROUTE", !model && "DK_LI_MODEL", !(cap > 0 && Number.isFinite(cap)) && "DK_LI_CAP_USD (> 0)", approved !== "local-intelligence-phase" && "DK_LI_APPROVED=local-intelligence-phase", !key && "AI_GATEWAY_API_KEY"].filter(Boolean) as string[];
  if (env.DK_EVAL_V2_APPROVED && missing.length) missing.push("(DK_EVAL_V2_APPROVED is the historical v2 approval and is not accepted here)");
  if (missing.length) return { ...base, status: "not_exercised", reason: `approved provider route incomplete: ${missing.join(", ")}; no route selected`, route: null, ai_checks: "not_exercised" };
  if (route !== "ai-gateway") throw new ModeError(`unknown provider route ${route}; only the explicitly approved ai-gateway route exists`);
  return { ...base, status: "ready", reason: "explicit approved route with a phase cap", route: { kind: "ai_gateway", base_url: "https://ai-gateway.vercel.sh/v1", model: model!, cap_usd: cap, approval: "owner brief 2026-10-23: local-intelligence phase cap $3.00 total" }, ai_checks: "exercised" };
}
