import { createHmac, randomUUID } from "node:crypto";

/**
 * Digital Kingdom application adapter. Sends dedicated, UNSAMPLED security events (sign-ins, privilege
 * changes, denied requests) — performance traces are context, not a security ledger.
 *
 * Privacy defaults: session identifiers are keyed-hashed (never sent raw); no headers, cookies, bodies or
 * passwords are collected; routes should be templates ("/orders/:id"), not raw URLs.
 * Delivery: bounded in-memory queue, batched, retried with backoff; drops are COUNTED, never silent.
 */
export interface DkOptions {
  url: string;
  sourceKey: string;
  /** Secret used to pseudonymize session ids. Rotate it to unlink history. */
  sessionSalt: string;
  maxQueue?: number;
  flushIntervalMs?: number;
  fetchImpl?: typeof fetch;
}

type Outcome = "allowed" | "denied" | "blocked" | "success" | "failure" | "attempted" | "refused" | "observed" | "unknown";

/** Agent run context (R05.1). Never put prompts, completions, reasoning or tool payloads here. */
export interface DkAgentContext {
  phase: "intent" | "decision" | "execution" | "effect";
  origin: "runtime_self_report" | "tool_wrapper" | "policy_enforcer" | "independent_observer";
  initiating_principal?: string; runtime?: string; model_route?: string; tool?: string; tool_version?: string; policy_revision?: string; step?: number; parent_run_id?: string;
}

export interface DkEvent {
  asset: string;
  action: "request_received" | "authentication" | "authorization_change" | "data_access" | "decoy_used" | "tool_invocation" | "side_effect_observed" | "sensor_unavailable" | "sensor_restored";
  outcome: Outcome;
  route?: string;
  requestId?: string;
  session?: string;
  actor?: string;
  rule?: string;
  severity?: "info" | "low" | "medium" | "high" | "critical";
  details?: Record<string, string | number | boolean>;
  at?: Date;
  runId?: string;
  agent?: DkAgentContext;
  coverageNote?: string;
}

export class DigitalKingdom {
  private queue: Record<string, unknown>[] = [];
  private timer: NodeJS.Timeout | null = null;
  readonly stats = { sent: 0, dropped: 0, failedBatches: 0, rejected: 0 };
  private readonly f: typeof fetch;

  constructor(private readonly o: DkOptions) {
    this.f = o.fetchImpl ?? fetch;
    this.timer = setInterval(() => void this.flush(), o.flushIntervalMs ?? 1000);
    this.timer.unref?.();
  }

  /** Keyed pseudonym for a session or account id: stable for correlation, not reversible without the salt. */
  pseudonym(raw: string): string {
    return "ps_" + createHmac("sha256", this.o.sessionSalt).update(raw).digest("base64url").slice(0, 22);
  }

  emit(e: DkEvent): void {
    if (this.queue.length >= (this.o.maxQueue ?? 5000)) { this.stats.dropped++; return; }
    this.queue.push({
      source_event_id: randomUUID(),
      occurred_at: (e.at ?? new Date()).toISOString(),
      asset_ids: [e.asset],
      action: e.action,
      outcome: e.outcome,
      ...(e.route ? { route: e.route } : {}),
      ...(e.requestId ? { request_id: e.requestId } : {}),
      ...(e.session ? { session_ref: this.pseudonym(e.session) } : {}),
      ...(e.actor ? { actor_ref: this.pseudonym(e.actor) } : {}),
      ...(e.rule ? { rule_ref: e.rule } : {}),
      ...(e.severity ? { severity: e.severity } : {}),
      ...(e.details ? { attributes: e.details } : {}),
      ...(e.runId ? { run_id: e.runId } : {}),
      ...(e.agent ? { agent: e.agent } : {}),
      ...(e.coverageNote ? { coverage_note: e.coverageNote.slice(0, 1000) } : {}),
    });
  }
  /** A database read as the audit layer saw it (R02.2 database audit fixture). */
  dataAccess(asset: string, actor: string, extra: Partial<DkEvent> = {}) { this.emit({ asset, action: "data_access", outcome: "success", actor, ...extra }); }
  /** One agent tool step with its phase and observation origin (R05.1). */
  toolStep(asset: string, runId: string, outcome: Outcome, agent: DkAgentContext, extra: Partial<DkEvent> = {}) { this.emit({ asset, action: agent.phase === "effect" ? "side_effect_observed" : "tool_invocation", outcome, runId, agent, ...extra }); }
  /** Report this source's own outage and recovery so the gap is visible, not silent. */
  sensorDown(asset: string, note: string) { this.emit({ asset, action: "sensor_unavailable", outcome: "unknown", coverageNote: note }); }
  sensorUp(asset: string) { this.emit({ asset, action: "sensor_restored", outcome: "unknown" }); }

  signIn(asset: string, account: string, ok: boolean, extra: Partial<DkEvent> = {}) {
    this.emit({ asset, action: "authentication", outcome: ok ? "success" : "failure", actor: account, ...extra });
  }
  privilegeChange(asset: string, actor: string, change: string, extra: Partial<DkEvent> = {}) {
    this.emit({ asset, action: "authorization_change", outcome: "success", actor, severity: "high", details: { change }, ...extra });
  }
  denied(asset: string, route: string, rule: string, extra: Partial<DkEvent> = {}) {
    this.emit({ asset, action: "request_received", outcome: "denied", route, rule, ...extra });
  }

  async flush(): Promise<void> {
    if (!this.queue.length) return;
    const batch = this.queue.splice(0, 500);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await this.f(this.o.url.replace(/\/+$/, "") + "/ingest/events", {
          method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.o.sourceKey}` },
          body: JSON.stringify({ events: batch }), signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 202 || res.status === 422) {
          const body = (await res.json()) as { accepted: number; duplicate: number; rejected: number };
          this.stats.sent += body.accepted + body.duplicate; this.stats.rejected += body.rejected;
          return;
        }
        if (res.status === 401 || res.status === 413) { this.stats.dropped += batch.length; return; }
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    }
    this.stats.failedBatches++;
    // put back (bounded); events keep their ids so redelivery is deduplicated server-side
    const room = (this.o.maxQueue ?? 5000) - this.queue.length;
    this.queue.unshift(...batch.slice(0, Math.max(0, room)));
    this.stats.dropped += Math.max(0, batch.length - room);
  }

  async close() { if (this.timer) clearInterval(this.timer); await this.flush(); }
}
