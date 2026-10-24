/**
 * LP06: independent per-operation effect observer.
 *
 * The observer is attached by the supervisor to the effect taps of the resources its plan entry depends on. It
 * records each effect with the operation id the supervisor assigned, the run and resource identity and the resource
 * revision at that moment, and it reports under its OWN source (its own key and independence group). It keeps
 * health intervals: an effect that happens while the observer is down is lost to it, and any question about an
 * interval that overlaps a down period is answered `unknown`, never `not_observed`.
 */
export interface ReportEvent {
  asset: string; action: string; outcome: string; route?: string; requestId?: string; session?: string; actor?: string; rule?: string;
  severity?: "info" | "low" | "medium" | "high" | "critical"; details?: Record<string, string | number | boolean>; at?: Date; runId?: string;
  agent?: { phase: "intent" | "decision" | "execution" | "effect"; origin: "runtime_self_report" | "tool_wrapper" | "policy_enforcer" | "independent_observer"; [k: string]: unknown };
  coverageNote?: string;
}
/** Structural subset of @dk/sdk-node's DigitalKingdom; the supervisor never sees a source key. */
export interface Reporter { emit(e: ReportEvent): void; flush(): Promise<void>; sensorDown?(asset: string, note: string): void; sensorUp?(asset: string): void }

export interface TapEffect { action: "data_access" | "side_effect_observed"; detail: Record<string, string | number | boolean> }
export interface ObservedEffect { op_id: string; run_id: string; resource_id: string; resource_revision: string; action: TapEffect["action"]; detail: TapEffect["detail"]; at_mono_ms: number; at: string }
export interface HealthInterval { state: "up" | "down"; from_mono_ms: number; to_mono_ms: number | null; from: string; to: string | null; reason: string }
export interface EffectAnswer { status: "observed" | "not_observed" | "unknown"; effects: ObservedEffect[]; observer: string; reason: string; health: HealthInterval[] }

export class EffectObserver {
  private readonly log: ObservedEffect[] = [];
  readonly health: HealthInterval[] = [];
  lost = 0;
  constructor(readonly id: string, readonly run_id: string, readonly attached: string[], private readonly reporter: Reporter | null, private readonly mono: () => number, private readonly wall: () => Date = () => new Date()) {
    this.health.push({ state: "up", from_mono_ms: mono(), to_mono_ms: null, from: wall().toISOString(), to: null, reason: "started with the run" });
  }
  get up(): boolean { return this.health[this.health.length - 1]!.state === "up"; }
  private transition(state: "up" | "down", reason: string) {
    const now = this.mono(), at = this.wall().toISOString();
    const cur = this.health[this.health.length - 1]!;
    if (cur.state === state) return;
    cur.to_mono_ms = now; cur.to = at;
    this.health.push({ state, from_mono_ms: now, to_mono_ms: null, from: at, to: null, reason });
  }
  /** Deliberate outage. If `announce`, the outage is reported as sensor_unavailable (a crash would not be). */
  stop(reason: string, announce = true) {
    if (!this.up) return;
    if (announce) for (const a of this.attached) this.reporter?.sensorDown?.(a, `observer ${this.id} stopped: ${reason}`.slice(0, 900));
    this.transition("down", reason);
  }
  restart(reason = "restarted by the run controller") {
    if (this.up) return;
    this.transition("up", reason);
    for (const a of this.attached) this.reporter?.sensorUp?.(a);
  }

  /** Called from the effect tap. While down, the effect is not seen (and not reported) by this observer. */
  record(resource_id: string, op_id: string, effect: TapEffect, revision: string): boolean {
    if (!this.attached.includes(resource_id)) return false;
    if (!this.up) { this.lost++; return false; }
    const e: ObservedEffect = { op_id, run_id: this.run_id, resource_id, resource_revision: revision, action: effect.action, detail: { ...effect.detail }, at_mono_ms: this.mono(), at: this.wall().toISOString() };
    this.log.push(e);
    const agentRun = effect.action === "side_effect_observed" && typeof effect.detail.agent_run === "string" ? effect.detail.agent_run : null;
    this.reporter?.emit({
      asset: resource_id, action: effect.action, outcome: effect.action === "side_effect_observed" ? "observed" : "success", requestId: op_id,
      details: { operation_id: op_id, resource_revision: revision, observer: this.id, ...effect.detail },
      // an agent run's effect carries the run id so the existing agent rules can compare it with the gateway's reports
      ...(agentRun ? { runId: agentRun, agent: { phase: "effect" as const, origin: "independent_observer" as const, runtime: "local-agent-workspace", tool: "message.send" } } : {}),
    });
    return true;
  }

  /** Was any interval of [from, to] (monotonic ms) not covered by an up period? */
  coveredThroughout(from: number, to: number): { covered: boolean; down: HealthInterval[] } {
    const down = this.health.filter((h) => h.state === "down" && h.from_mono_ms <= to && (h.to_mono_ms === null || h.to_mono_ms >= from));
    return { covered: down.length === 0, down };
  }

  /**
   * Per-operation answer. Effects are matched by operation id only, so concurrent unrelated operations are never
   * attributed to this one. Absence is `not_observed` only when the observer was up for the whole interval
   * (including the settling allowance) and is attached to the resource in question.
   */
  answer(op_id: string, interval: { from_mono_ms: number; to_mono_ms: number }, resource_id: string, settleMs = 0): EffectAnswer {
    const effects = this.log.filter((e) => e.op_id === op_id && e.resource_id === resource_id);
    const health = this.health.map((h) => ({ ...h }));
    if (!this.attached.includes(resource_id)) return { status: "unknown", effects: [], observer: this.id, reason: `${this.id} is not attached to ${resource_id}`, health };
    if (effects.length) return { status: "observed", effects, observer: this.id, reason: `${effects.length} effect(s) recorded for operation ${op_id}`, health };
    const c = this.coveredThroughout(interval.from_mono_ms, interval.to_mono_ms + settleMs);
    if (!c.covered) return { status: "unknown", effects: [], observer: this.id, reason: `observer ${this.id} was down for part of the operation interval (${c.down.map((d) => d.reason).join("; ")}); absence of an effect is not evidence of no effect`, health };
    return { status: "not_observed", effects: [], observer: this.id, reason: `observer ${this.id} was up throughout and recorded no effect for operation ${op_id}`, health };
  }
  effects(): ObservedEffect[] { return this.log.map((e) => ({ ...e, detail: { ...e.detail } })); }
  snapshot() { return { log: this.effects(), lost: this.lost }; }
}
