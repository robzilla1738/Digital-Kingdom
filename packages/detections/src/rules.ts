import { independenceGroups } from "./capabilities.ts";
import { identityOf, namespaces, sameIdentity, type CorrelationRefType } from "./correlation.ts";
import {
  stableId, toMs, byTimeThenId,
  type CoverageRecord, type Finding, type FindingKind, type Graph, type SecurityEvent, type Severity,
} from "@dk/contracts";

/**
 * 1.1.0 (R00.2): identifier joins use typed, namespaced correlation identities. Findings produced by
 * 1.0.x keep their stored revisions; re-evaluation records a new revision rather than rewriting them.
 */
export const RULESET_VERSION = "dk-rules-1.1.0";

export interface SourceDeclaration {
  id: string;
  independence_group?: string;
  label: string;
  asset_ids: string[];
  /** Administrative disablement overrides historic events and sensor-restored messages. */
  disabled?: boolean;
  /** Silence longer than this (live mode) degrades coverage. */
  stale_after_seconds?: number;
  /** Administrator-declared authority for actor_ref/session_ref (see correlation.ts). Undeclared: private to this source. */
  identity_namespace?: string;
  /** Administrator-declared authority for run_id. Undeclared: private to this source. */
  run_namespace?: string;
}

export interface EvaluateOptions {
  sources?: SourceDeclaration[];
  /** "Now" for staleness checks; omit for replay (no staleness). */
  now?: string;
  authFailureThreshold?: number;
  authFailureWindowSeconds?: number;
  /**
   * Per-source state read from ALL stored events, not just the evaluation window (R01.2). Without it a quiet
   * source whose last receipt or outage report fell outside a bounded window would look unreported or healthy.
   */
  sourceState?: Record<string, SourceState>;
}

export interface SourceState {
  last_received_at?: string;
  last_occurred_at?: string;
  /** Latest sensor_unavailable / sensor_restored report from this source. */
  last_health?: { id: string; action: "sensor_unavailable" | "sensor_restored"; occurred_at: string; coverage_note?: string };
}

export interface EvaluationResult {
  findings: Finding[];
  coverage: CoverageRecord[];
  /** Assets with no declared telemetry source: unknown, never safe. */
  unobserved_asset_ids: string[];
  ruleset_version: string;
}

const SEV_ORDER: Severity[] = ["info", "low", "medium", "high", "critical"];
const maxSev = (a: Severity, b: Severity) => (SEV_ORDER.indexOf(a) >= SEV_ORDER.indexOf(b) ? a : b);

type Draft = Omit<Finding, "id" | "lifecycle" | "disposition" | "revision" | "first_seen" | "last_seen" | "last_received" | "event_count" | "evidence_refs" | "dataset_kind"> & { key: string; events: SecurityEvent[]; counter?: SecurityEvent[]; /** when the finding has no events of its own (e.g. a source went silent): the derived moment it became true */ at?: string };

/**
 * Deterministic rule evaluation over a bounded event set. Pure: same events => same findings.
 * Rules distinguish attempted, blocked, allowed, refused, and independently observed effect, and
 * never link events by IP address or time proximity alone.
 */
export function evaluate(graph: Graph, inputEvents: SecurityEvent[], opts: EvaluateOptions = {}): EvaluationResult {
  const events = [...inputEvents].sort(byTimeThenId);
  const drafts: Draft[] = [];
  const assetName = (id: string) => graph.assets.find((a) => a.id === id)?.name ?? id;
  // Independence is judged by observation origin, not by source id: relays of one report share a group.
  const group = independenceGroups(opts.sources);
  // Identifier joins happen inside a declared authority only (R00.2), never on the bare string.
  const ns = namespaces(opts.sources);

  // ---------- contradictions first (they adjust other findings) ----------
  const trustedByRequest = new Map<string, SecurityEvent[]>();
  for (const e of events) if (e.request_id && e.request_id_trust === "trusted") push(trustedByRequest, e.request_id, e);
  const contradicted = new Map<string, SecurityEvent[]>(); // blocked event id -> effect events
  for (const [rid, evs] of trustedByRequest) {
    const blocked = evs.filter((e) => e.outcome === "denied" || e.outcome === "blocked");
    const effects = evs.filter((e) => (e.action === "side_effect_observed" || e.action === "data_access") && (e.outcome === "observed" || e.outcome === "success"));
    for (const b of blocked) {
      const independent = effects.filter((x) => group(x.source_id) !== group(b.source_id));
      if (!independent.length) continue;
      contradicted.set(b.id, independent);
      drafts.push({
        key: `contradiction:${rid}:${b.id}`, kind: "source_contradiction", title: "Sources disagree about a request",
        claim: `${b.source_id} reported request ${rid} as ${b.outcome}, but ${unique(independent.map((x) => x.source_id)).join(", ")} independently observed an effect for the same trusted request id.`,
        evidence_level: "contradicted", outcome_state: "needs_review", severity: "high",
        affected_asset_ids: unique([...b.asset_ids, ...independent.flatMap((x) => x.asset_ids)]),
        event_ids: independent.map((x) => x.id), counterevidence_event_ids: [b.id],
        coverage_gaps: [], not_claimed: ["Neither source is assumed to be correct.", "An observed effect is not, by itself, established security impact."],
        next_steps: ["Compare both source records.", "Check whether the blocking control is in the request path for this route.", "Confirm the effect with the data owner."],
        rule_id: "contradiction.blocked_vs_effect", rule_version: "1", events: independent, counter: [b],
      });
    }
  }

  // ---------- R1 blocked requests (clustered) ----------
  const blockedGroups = new Map<string, SecurityEvent[]>();
  for (const e of events) if ((e.action === "waf_match" || e.action === "request_received") && (e.outcome === "denied" || e.outcome === "blocked")) push(blockedGroups, `${e.asset_ids[0]}|${e.rule_ref ?? "unspecified"}`, e);
  for (const [k, evs] of blockedGroups) {
    const [asset, rule] = k.split("|") as [string, string];
    const counter = evs.flatMap((e) => contradicted.get(e.id) ?? []);
    drafts.push({
      key: `blocked:${k}`, kind: "blocked_request_reported", title: evs.length > 1 ? `${evs.length} requests blocked at ${assetName(asset)}` : `Request blocked at ${assetName(asset)}`,
      claim: `${unique(evs.map((e) => e.source_id)).join(", ")} reported ${evs.length} request(s) to ${assetName(asset)} as blocked${rule !== "unspecified" ? ` by rule ${rule}` : ""}.`,
      evidence_level: counter.length ? "contradicted" : "source_reported", outcome_state: counter.length ? "needs_review" : "blocked",
      severity: counter.length ? "high" : evs.reduce<Severity>((s, e) => maxSev(s, e.severity ?? "low"), "low"),
      affected_asset_ids: [asset], event_ids: evs.map((e) => e.id), counterevidence_event_ids: unique(counter.map((e) => e.id)),
      coverage_gaps: [],
      not_claimed: ["A blocked request is a reported attempt, not a compromise.", "The requester's identity is not established."],
      next_steps: counter.length ? ["Resolve the source contradiction before closing."] : ["No action needed unless volume or targets are unusual.", "Confirm the rule matched intended traffic."],
      rule_id: "edge.blocked_request", rule_version: "1", events: evs, counter,
    });
  }

  // ---------- R2 repeated authentication failures (typed, namespaced identifiers only) ----------
  const threshold = opts.authFailureThreshold ?? 5;
  const windowMs = (opts.authFailureWindowSeconds ?? 300) * 1000;
  // legacy key (asset|type:value) -> namespace -> failures. The key shape is kept so findings from
  // dk-rules-1.0.x keep their ids when only one authority uses the identifier.
  const failuresByKey = new Map<string, Map<string, SecurityEvent[]>>();
  for (const e of events) if (e.action === "authentication" && e.outcome === "failure") {
    const type: CorrelationRefType | null = e.session_ref ? "session" : e.actor_ref ? "actor" : null;
    if (!type) continue;
    const id = identityOf(e, type, ns)!;
    const legacy = `${e.asset_ids[0]}|${type}:${id.value}`;
    const byNs = failuresByKey.get(legacy) ?? new Map<string, SecurityEvent[]>();
    failuresByKey.set(legacy, byNs);
    push(byNs, id.namespace, e);
  }
  for (const [legacy, byNs] of failuresByKey) {
    const namespacesForKey = [...byNs.keys()].sort();
    for (const [nsIndex, namespace] of namespacesForKey.entries()) {
      const evs = byNs.get(namespace)!;
      const k = nsIndex === 0 ? legacy : `${legacy}|ns:${namespace}`;
      let best: SecurityEvent[] = [];
      for (let i = 0, j = 0; j < evs.length; j++) {
        while (toMs(evs[j]!.occurred_at) - toMs(evs[i]!.occurred_at) > windowMs) i++;
        if (j - i + 1 > best.length) best = evs.slice(i, j + 1);
      }
      if (best.length < threshold) continue;
      const asset = legacy.slice(0, legacy.indexOf("|"));
      const key = legacy.slice(legacy.indexOf("|") + 1);
      const type = key.slice(0, key.indexOf(":")) as CorrelationRefType;
      const failId = identityOf(best[0]!, type, ns);
      const lastFail = toMs(best[best.length - 1]!.occurred_at);
      const inWindow = (e: SecurityEvent) => e.action === "authentication" && e.outcome === "success" && toMs(e.occurred_at) >= lastFail && toMs(e.occurred_at) - lastFail <= 15 * 60_000;
      // Linked: the same identifier type, the same declared authority and the same asset.
      const sameIdSuccess = events.filter((e) => inWindow(e) && e.asset_ids.includes(asset) && sameIdentity(identityOf(e, type, ns), failId));
      // Equal text in another namespace, another reference type or on another asset is disclosed, never linked.
      const textOnly = events.filter((e) => inWindow(e) && !sameIdSuccess.includes(e) && (e.session_ref === failId!.value || e.actor_ref === failId!.value));
      const ips = new Set(best.map((e) => e.client_ip).filter(Boolean));
      const ipOnly = events.filter((e) => inWindow(e) && e.client_ip && ips.has(e.client_ip) && !sameIdSuccess.includes(e) && !textOnly.includes(e));
      drafts.push({
        key: `authfail:${k}`, kind: "repeated_auth_failure", title: `${best.length} failed sign-ins for one ${type === "session" ? "session" : "account"}`,
        claim: `${best.length} authentication failures for ${key.replace(":", " ")} at ${assetName(asset)} within ${Math.round(windowMs / 60000)} minutes.${sameIdSuccess.length ? " A later success for the same identifier from the same authority was recorded." : ""}`,
        evidence_level: "source_reported", outcome_state: sameIdSuccess.length ? "needs_review" : "attempted", severity: sameIdSuccess.length ? "medium" : "low",
        affected_asset_ids: [asset], event_ids: [...best, ...sameIdSuccess].map((e) => e.id), counterevidence_event_ids: [],
        coverage_gaps: [],
        not_claimed: [
          "Failed sign-ins do not show that an account was compromised.",
          ...(textOnly.length ? [`${textOnly.length} later successful sign-in(s) carried the same identifier text but from a different identity namespace, a different identifier type or a different asset; equal text is not the same principal, so they are not linked.`] : []),
          ...(ipOnly.length ? [`${ipOnly.length} later successful sign-in(s) shared a network address but not the identifier; shared addresses (NAT, proxies) are weak association, so they are not linked.`] : []),
        ],
        next_steps: sameIdSuccess.length ? ["Confirm the later success with the account owner.", "Review session activity after the success."] : ["Check whether rate limiting engaged."],
        rule_id: "auth.repeated_failure", rule_version: "2", events: [...best, ...sameIdSuccess],
      });
    }
  }

  // ---------- R3 sensitive privilege change ----------
  for (const e of events) if (e.action === "authorization_change" && e.outcome === "success") {
    const sess = identityOf(e, "session", ns);
    const isSignIn = (x: SecurityEvent) => x !== e && x.action === "authentication" && x.outcome === "success";
    const linked = events.filter((x) => isSignIn(x) &&
      (sameIdentity(sess, identityOf(x, "session", ns)) || (e.request_id && e.request_id_trust === "trusted" && x.request_id === e.request_id && x.request_id_trust === "trusted")));
    const textOnly = sess ? events.filter((x) => isSignIn(x) && !linked.includes(x) && (x.session_ref === sess.value || x.actor_ref === sess.value)) : [];
    drafts.push({
      key: `priv:${e.id}`, kind: "sensitive_privilege_change", title: `Privilege change on ${assetName(e.asset_ids[0]!)}`,
      claim: `${e.source_id} recorded a successful authorization change${e.actor_ref ? ` by ${e.actor_ref}` : ""} on ${e.asset_ids.map(assetName).join(", ")}.${linked.length ? " It is linked to a sign-in by a session issued in the same declared identity namespace or a trusted request identifier." : ""}`,
      evidence_level: "source_reported", outcome_state: "needs_review", severity: e.severity ?? "medium",
      affected_asset_ids: e.asset_ids, event_ids: [e.id, ...linked.map((x) => x.id)], counterevidence_event_ids: [],
      coverage_gaps: linked.length ? [] : ["No trusted identifier links this change to a sign-in."],
      not_claimed: [
        "A privilege change can be legitimate administration.", "Intent is not established.",
        ...(textOnly.length ? [`${textOnly.length} sign-in(s) carried the same identifier text outside this change's identity namespace or as a different identifier type; they are not linked.`] : []),
      ],
      next_steps: ["Confirm the change with its owner or change ticket.", "Revert if unexpected (manual, outside Digital Kingdom)."],
      rule_id: "authz.sensitive_change", rule_version: "2", events: [e, ...linked],
    });
  }

  // ---------- R4 decoy credential ----------
  const decoys = new Map<string, SecurityEvent[]>();
  for (const e of events) if (e.action === "decoy_used") push(decoys, `${e.asset_ids.join(",")}|${e.rule_ref ?? e.actor_ref ?? "decoy"}`, e);
  for (const [k, evs] of decoys) {
    const srcs = unique(evs.map((e) => group(e.source_id)));
    drafts.push({
      key: `decoy:${k}`, kind: "decoy_credential_used", title: `Decoy credential used (${assetName(evs[0]!.asset_ids[0]!)})`,
      claim: `A registered decoy credential placed with ${evs[0]!.asset_ids.map(assetName).join(", ")} was used ${evs.length} time(s).`,
      evidence_level: srcs.length > 1 ? "corroborated" : "source_reported", outcome_state: "attempted", severity: "high",
      affected_asset_ids: unique(evs.flatMap((e) => e.asset_ids)), event_ids: evs.map((e) => e.id), counterevidence_event_ids: [],
      coverage_gaps: ["How the credential was obtained (initial entry point) is unknown."],
      not_claimed: ["The person or system that used the decoy is not identified.", "Use of the decoy does not show where an intrusion began."],
      next_steps: ["Review access to where the decoy was placed.", "Rotate real credentials stored alongside it."],
      rule_id: "deception.decoy_used", rule_version: "1", events: evs,
    });
  }

  // ---------- R7 agent tool activity (run ids correlate only inside a declared run namespace) ----------
  const runs = new Map<string, Map<string, SecurityEvent[]>>(); // run text -> namespace -> events
  for (const e of events) if (e.run_id && (e.action === "tool_invocation" || e.action === "side_effect_observed")) {
    const byNs = runs.get(e.run_id) ?? new Map<string, SecurityEvent[]>();
    runs.set(e.run_id, byNs);
    push(byNs, ns.run(e.source_id), e);
  }
  for (const [runText, byNs] of runs) {
    const nsList = [...byNs.keys()].sort();
    for (const [nsIndex, runNs] of nsList.entries()) {
      const evs = byNs.get(runNs)!;
      const run = nsIndex === 0 ? runText : `${runText}|ns:${runNs}`;
      const label = runText;
      const otherNsCalls = nsList.filter((x) => x !== runNs).flatMap((x) => byNs.get(x)!).filter((e) => e.action === "tool_invocation");
      const denied = evs.filter((e) => e.action === "tool_invocation" && (e.outcome === "denied" || e.outcome === "blocked"));
      const refused = evs.filter((e) => e.action === "tool_invocation" && e.outcome === "refused");
      const reported = evs.filter((e) => e.action === "tool_invocation" && (e.outcome === "success" || e.outcome === "allowed" || e.outcome === "attempted"));
      const observed = evs.filter((e) => e.action === "side_effect_observed");
      if (denied.length) drafts.push({
        key: `agentdeny:${run}`, kind: "agent_action_denied", title: `Agent tool call denied by policy (${label})`,
        claim: `Policy enforcement denied ${denied.length} tool call(s) in agent run ${label}.${refused.length ? ` The model also declined ${refused.length} request(s) itself (a refusal, not enforcement).` : ""}`,
        evidence_level: "source_reported", outcome_state: "blocked", severity: "medium",
        affected_asset_ids: unique(denied.flatMap((e) => e.asset_ids)), event_ids: [...denied, ...refused].map((e) => e.id), counterevidence_event_ids: [],
        coverage_gaps: ["Only actions passing through the instrumented tool wrapper are visible."],
        not_claimed: ["A denied call did not execute.", "A model refusal is not an enforcement decision."],
        next_steps: ["Review why the agent requested a disallowed tool.", "Check the prompt or input that led to it."],
        rule_id: "agent.enforcement_denied", rule_version: "2", events: [...denied, ...refused],
      });
      if (observed.length) {
        const independent = observed.filter((o) => !reported.some((r) => group(r.source_id) === group(o.source_id)));
        const unlinked = !reported.length && otherNsCalls.length > 0;
        drafts.push({
          key: `agenteffect:${run}`, kind: "agent_effect_observed", title: `Agent action had an observed effect (${label})`,
          claim: `${unique(observed.map((e) => e.source_id)).join(", ")} observed ${observed.length} effect(s) from agent run ${label}${reported.length ? `, matching ${reported.length} tool call(s) the agent runtime reported in the same declared run namespace` : unlinked ? ", with no tool call reported in the same run namespace" : ", with no matching tool call reported by the runtime"}.`,
          evidence_level: reported.length && independent.length ? "corroborated" : "source_reported", outcome_state: "observed_effect",
          // Equal run text from an undeclared/unrelated runtime is neither corroboration nor proof of a bypass.
          severity: reported.length ? "low" : unlinked ? "medium" : "high",
          affected_asset_ids: unique([...observed, ...reported].flatMap((e) => e.asset_ids)), event_ids: [...reported, ...observed].map((e) => e.id), counterevidence_event_ids: [],
          coverage_gaps: reported.length ? [] : unlinked
            ? [`${otherNsCalls.length} tool call(s) from ${unique(otherNsCalls.map((e) => e.source_id)).join(", ")} use the same run identifier text, but no common run namespace is declared for these sources, so the effect cannot be attributed to them or to a bypass.`]
            : ["The effect was not reported by the tool wrapper: a bypass path or unsupported transport may exist."],
          not_claimed: ["An observed effect is not automatically harmful.", ...(unlinked ? ["Equal run identifiers from unrelated runtimes are not treated as the same run."] : [])],
          next_steps: reported.length ? ["Confirm the effect matched the approved destination."] : unlinked ? ["Declare a shared run namespace only if the observer really receives this runtime's propagated run ids.", "Otherwise investigate the effect's origin independently."] : ["Investigate how the agent acted outside the instrumented wrapper."],
          rule_id: "agent.effect_observed", rule_version: "2", events: [...reported, ...observed],
        });
      }
    }
  }

  // ---------- R8 runtime alerts ----------
  const runtime = new Map<string, SecurityEvent[]>();
  for (const e of events) if (e.action === "runtime_alert") push(runtime, `${e.asset_ids[0]}|${e.rule_ref ?? "rule"}`, e);
  for (const [k, evs] of runtime) {
    const [asset, rule] = k.split("|") as [string, string];
    drafts.push({
      key: `runtime:${k}`, kind: "runtime_alert_reported", title: `Runtime sensor: ${rule}`,
      claim: `${unique(evs.map((e) => e.source_id)).join(", ")} reported rule "${rule}" ${evs.length} time(s) on ${assetName(asset)}.`,
      evidence_level: "source_reported", outcome_state: "unknown", severity: evs.reduce<Severity>((s, e) => maxSev(s, e.severity ?? "medium"), "low"),
      affected_asset_ids: [asset], event_ids: evs.map((e) => e.id), counterevidence_event_ids: [], coverage_gaps: [],
      not_claimed: ["A runtime rule match is a sensor report, not confirmed impact."],
      next_steps: ["Inspect the process/container context in the source record."],
      rule_id: "runtime.alert", rule_version: "1", events: evs,
    });
  }

  // ---------- R5 coverage ----------
  const coverage = deriveCoverage(graph, events, opts);
  for (const c of coverage) if (c.state === "offline" || c.state === "degraded") {
    const evs = events.filter((e) => c.event_ids.includes(e.id));
    // A stale source has no event marking the moment it went quiet. Administrative disablement has
    // no historical timestamp in SourceDeclaration: use the assessment time, never invent a source event.
    const decl = opts.sources?.find((x) => x.id === c.source_id);
    const lastOwnReceived = opts.sourceState?.[c.source_id]?.last_received_at ?? events.filter((e) => e.source_id === c.source_id).at(-1)?.received_at;
    const at = decl?.disabled ? opts.now : c.state === "degraded" && lastOwnReceived && decl?.stale_after_seconds ? new Date(toMs(lastOwnReceived) + decl.stale_after_seconds * 1000).toISOString() : undefined;
    drafts.push({
      ...(at ? { at } : {}),
      key: `coverage:${c.source_id}`, kind: "coverage_loss", title: `${c.label} ${c.state === "offline" ? "offline" : "stale"}`,
      claim: `${c.label} is ${c.state}. Activity on ${c.asset_ids.map(assetName).join(", ")} that only this source would record is not assessable.`,
      evidence_level: "not_assessed", outcome_state: "unknown", severity: "medium",
      affected_asset_ids: c.asset_ids, event_ids: evs.map((e) => e.id), counterevidence_event_ids: [],
      coverage_gaps: [c.note ?? `${c.label} is not reporting.`],
      not_claimed: ["Silence from this source does not mean nothing happened.", "Loss of a sensor is not evidence of an attack."],
      next_steps: ["Restore the source and confirm a heartbeat.", "Backfill if the source supports it."],
      rule_id: "coverage.source_loss", rule_version: "2", events: evs,
    });
  }

  const kind = inputEvents.find((e) => e.dataset_kind)?.dataset_kind ?? "synthetic";
  const findings = drafts.map((d) => toFinding(d, kind)).sort((a, b) => toMs(a.first_seen) - toMs(b.first_seen) || (a.id < b.id ? -1 : 1));
  const covered = new Set(coverage.flatMap((c) => c.asset_ids));
  return { findings, coverage, unobserved_asset_ids: graph.assets.map((a) => a.id).filter((id) => !covered.has(id)), ruleset_version: RULESET_VERSION };
}

export function deriveCoverage(graph: Graph, events: SecurityEvent[], opts: EvaluateOptions): CoverageRecord[] {
  const decl: SourceDeclaration[] = opts.sources ?? unique(events.map((e) => e.source_id)).map((id) => ({ id, label: id, asset_ids: unique(events.filter((e) => e.source_id === id).flatMap((e) => e.asset_ids)) }));
  return decl.map((s) => {
    const own = events.filter((e) => e.source_id === s.id);
    const health = own.filter((e) => e.action === "sensor_unavailable" || e.action === "sensor_restored");
    const st = opts.sourceState?.[s.id];
    const lastHealth: { id: string; action: string; coverage_note?: string } | undefined = st?.last_health ?? health[health.length - 1];
    const last = own[own.length - 1];
    const lastReceived = st?.last_received_at ?? last?.received_at;
    const seen = own.length > 0 || !!st?.last_received_at;
    let state: CoverageRecord["state"] = seen ? "healthy" : "not_assessed";
    let note: string | undefined = seen ? undefined : "No events received from this source yet.";
    const evIds: string[] = [];
    if (s.disabled) {
      state = "offline";
      note = `${s.label} is administratively disabled. Stored events do not establish current reporting; the disablement time is not recorded here.`;
    } else if (lastHealth?.action === "sensor_unavailable") {
      state = "offline"; note = lastHealth.coverage_note ?? `${s.label} reported itself unavailable.`; evIds.push(lastHealth.id);
    } else if (opts.now && lastReceived && s.stale_after_seconds && toMs(opts.now) - toMs(lastReceived) > s.stale_after_seconds * 1000) {
      state = "degraded"; note = `No events for more than ${s.stale_after_seconds}s.`;
    }
    const rec: CoverageRecord = { source_id: s.id, label: s.label, asset_ids: s.asset_ids.filter((a) => graph.assets.some((x) => x.id === a)), state, event_ids: evIds };
    const lastAt = st?.last_occurred_at ?? last?.occurred_at;
    if (lastAt) rec.last_event_at = lastAt;
    if (note) rec.note = note;
    return rec;
  });
}

function toFinding(d: Draft, projectKind: Finding["dataset_kind"]): Finding {
  const all = [...d.events, ...(d.counter ?? [])];
  const times = all.map((e) => toMs(e.occurred_at));
  const recv = all.map((e) => toMs(e.received_at));
  // never present the Unix epoch as an observation time: a finding without events uses its derived moment
  const nowIso = d.at ?? new Date(0).toISOString();
  return {
    id: stableId("f", d.rule_id, d.key),
    kind: d.kind as FindingKind, title: d.title, claim: d.claim,
    lifecycle: "open", disposition: "unreviewed",
    evidence_level: d.evidence_level, outcome_state: d.outcome_state, severity: d.severity,
    affected_asset_ids: d.affected_asset_ids, event_ids: unique(d.event_ids), counterevidence_event_ids: d.counterevidence_event_ids,
    evidence_refs: unique(all.flatMap((e) => e.evidence_refs)),
    coverage_gaps: d.coverage_gaps, not_claimed: d.not_claimed, next_steps: d.next_steps,
    rule_id: d.rule_id, rule_version: `${RULESET_VERSION}/${d.rule_version}`,
    first_seen: times.length ? new Date(Math.min(...times)).toISOString() : nowIso,
    last_seen: times.length ? new Date(Math.max(...times)).toISOString() : nowIso,
    last_received: recv.length ? new Date(Math.max(...recv)).toISOString() : nowIso,
    event_count: unique(all.map((e) => e.id)).length,
    revision: 1,
    dataset_kind: all[0]?.dataset_kind ?? projectKind,
  };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); }
function unique<T>(xs: T[]): T[] { return [...new Set(xs)]; }
