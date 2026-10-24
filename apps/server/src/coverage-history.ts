import { EVENT_ACTIONS, EVENT_OUTCOMES, type EventAction } from "@dk/contracts";
import { DEFAULT_ACTIONS_BY_KIND } from "@dk/detections";
import { HttpError, type Store } from "./store.ts";

/**
 * Historical, question-specific coverage (roadmap R01.2).
 *
 * "Is source X reporting right now" does not answer "could anything have recorded a read of orders-db between
 * 02:00 and 04:00 last Tuesday". This module answers the second question for one asset, one event class and
 * optionally one outcome over an interval, as spans:
 *
 * - covered: an enabled source assigned to the asset, permitted to report that class and outcome, was live.
 * - partial: the only coverage was sampled, or its liveness cannot be checked (no freshness expectation).
 * - unknown: nothing that could have recorded it was live. Each source says why (not configured yet,
 *   disabled, not capable, reported unavailable, silent past its freshness threshold, beyond retention).
 *
 * Liveness is judged by RECEIPT time (when Digital Kingdom heard from the source), never by a business event's
 * claimed occurrence time, so one event stamped in the future cannot vouch for a silent period. Outage reports
 * (sensor_unavailable ... sensor_restored) are placed at the sensor's stated times; current restoration never
 * backfills an outage. Everything is read from all stored events, not a recent evaluation window.
 */
export type SpanState = "covered" | "partial" | "unknown";
interface Span { from: number; to: number; state: SpanState; reason: string }

export interface CoverageQuestion { asset: string; action: EventAction; outcome?: string; after: string; before: string }

const MAX_INTERVAL_MS = 93 * 86_400_000;

export function parseCoverageQuestion(q: Record<string, unknown>): CoverageQuestion {
  const errors: string[] = [];
  const s = (k: string) => (typeof q[k] === "string" && (q[k] as string).length <= 200 ? (q[k] as string) : undefined);
  const asset = s("asset"), action = s("action"), outcome = s("outcome"), after = s("after"), before = s("before");
  if (!asset) errors.push("asset: required");
  if (!action || !EVENT_ACTIONS.includes(action as EventAction)) errors.push(`action: required, one of ${EVENT_ACTIONS.join(", ")}`);
  if (outcome !== undefined && !EVENT_OUTCOMES.includes(outcome as never)) errors.push(`outcome: one of ${EVENT_OUTCOMES.join(", ")}`);
  const isoOk = (v?: string) => !!v && !Number.isNaN(Date.parse(v)) && /T.*(Z|[+-]\d{2}:?\d{2})$/.test(v);
  if (!isoOk(after)) errors.push("after: required ISO 8601 timestamp with an offset");
  if (!isoOk(before)) errors.push("before: required ISO 8601 timestamp with an offset");
  if (isoOk(after) && isoOk(before)) {
    if (Date.parse(before!) <= Date.parse(after!)) errors.push("before: must be later than after");
    else if (Date.parse(before!) - Date.parse(after!) > MAX_INTERVAL_MS) errors.push("before: interval longer than 93 days");
  }
  if (errors.length) throw new HttpError(400, "invalid coverage question", errors);
  return { asset: asset!, action: action as EventAction, ...(outcome ? { outcome } : {}), after: new Date(Date.parse(after!)).toISOString(), before: new Date(Date.parse(before!)).toISOString() };
}

const RANK: Record<SpanState, number> = { unknown: 0, partial: 1, covered: 2 };
const iso = (t: number) => new Date(t).toISOString();

/** Replace the parts of `base` overlapped by `cut` (which only ever lowers a span to unknown). */
function overlay(base: Span[], cut: Span): Span[] {
  const out: Span[] = [];
  for (const s of base) {
    if (cut.to <= s.from || cut.from >= s.to || s.state === "unknown") { out.push(s); continue; }
    if (cut.from > s.from) out.push({ ...s, to: cut.from });
    out.push({ from: Math.max(s.from, cut.from), to: Math.min(s.to, cut.to), state: cut.state, reason: cut.reason });
    if (cut.to < s.to) out.push({ ...s, from: cut.to });
  }
  return out;
}

/** Lower covered parts of [from, to) to partial; unknown parts stay unknown. */
function overlayPartial(base: Span[], from: number, to: number, reason: string): Span[] {
  const out: Span[] = [];
  for (const s of base) {
    if (to <= s.from || from >= s.to || s.state !== "covered") { out.push(s); continue; }
    if (from > s.from) out.push({ ...s, to: from });
    out.push({ from: Math.max(s.from, from), to: Math.min(s.to, to), state: "partial", reason });
    if (to < s.to) out.push({ ...s, from: to });
  }
  return out;
}

export function coverageHistory(store: Store, projectId: string, q: CoverageQuestion) {
  const graph = store.getGraph(projectId);
  if (!graph) throw new HttpError(404, "project has no graph");
  const assetId = graph.assets.find((a) => a.id === q.asset || a.name === q.asset || a.aliases?.includes(q.asset))?.id;
  if (!assetId) throw new HttpError(404, `no asset matches ${q.asset}`);
  const a = Date.parse(q.after), b = Date.parse(q.before), now = store.now().getTime();
  const sources = store.listSources(projectId);
  const perSource: { source_id: string; label: string; history_basis: string; spans: Span[] }[] = [];

  for (const src of sources) {
    let revisions = store.sourceHistory(projectId, src.id);
    let basis = "recorded configuration revisions";
    if (!revisions.length) {
      // Sources registered before configuration history began: assume the current configuration since creation.
      revisions = [{ revision: 0, config: src, actor: "system", reason: "assumed: configuration history not recorded", recorded_at: src.created_at, effective_at: src.created_at }];
      basis = "current configuration assumed since registration (history not recorded before migration 5)";
    }
    const revs = [...revisions].sort((x, y) => Date.parse(x.effective_at) - Date.parse(y.effective_at) || x.revision - y.revision);
    let spans: Span[] = [];
    const first = Date.parse(revs[0]!.effective_at);
    if (first > a) spans.push({ from: a, to: Math.min(first, b), state: "unknown", reason: "source not yet registered" });
    revs.forEach((r, i) => {
      const from = Math.max(a, Date.parse(r.effective_at)), to = Math.min(b, i + 1 < revs.length ? Date.parse(revs[i + 1]!.effective_at) : b);
      if (to <= from) return;
      const cfg = r.config;
      const actions = cfg.allowed_actions?.length ? cfg.allowed_actions : DEFAULT_ACTIONS_BY_KIND[cfg.kind ?? "generic"] ?? DEFAULT_ACTIONS_BY_KIND.generic!;
      let state: SpanState = "covered", reason = "assigned, enabled, capable and live";
      if (!cfg.asset_ids.includes(assetId)) { state = "unknown"; reason = "not assigned to this asset"; }
      else if (cfg.disabled) { state = "unknown"; reason = "administratively disabled"; }
      else if (!actions.includes(q.action)) { state = "unknown"; reason = `cannot report ${q.action}`; }
      else if (q.outcome && cfg.outcomes_reported && !cfg.outcomes_reported.includes(q.outcome)) { state = "unknown"; reason = `reports only ${cfg.outcomes_reported.join("/")} outcomes, not ${q.outcome}`; }
      else if (cfg.sampling_ratio !== undefined && cfg.sampling_ratio < 1) { state = "partial"; reason = `sampled at ${cfg.sampling_ratio}: silence is not absence`; }
      else if (!cfg.stale_after_seconds) { state = "partial"; reason = "no freshness expectation declared: liveness cannot be verified"; }
      spans.push({ from, to, state, reason });
    });
    if (spans.every((s) => s.state === "unknown")) { perSource.push({ source_id: src.id, label: src.label, history_basis: basis, spans }); continue; }

    // Outage reports, placed at the sensor's stated times.
    // M6b: health reports are paired per ASSET. A source watching several assets reports each one separately, and a
    // restoration reported for another asset must never end this asset's outage (CI 40064260489: the other asset's
    // restoration landed one millisecond earlier and the last millisecond of a deliberate outage counted as covered).
    // A report names its assets by id, name or alias; one naming several assets applies to each of them.
    const names = new Set([assetId, ...graph.assets.filter((x) => x.id === assetId).flatMap((x) => [x.name, ...(x.aliases ?? [])])]);
    const health = (store.db.prepare("SELECT action, occurred_at, asset_ids FROM events WHERE project_id = ? AND source_id = ? AND action IN ('sensor_unavailable','sensor_restored') ORDER BY occurred_at, received_at").all(projectId, src.id) as { action: string; occurred_at: string; asset_ids: string }[])
      .filter((h) => { try { const ids = JSON.parse(h.asset_ids) as unknown; return !Array.isArray(ids) || !ids.length || ids.some((x) => names.has(String(x))); } catch { return true; } });
    let down: number | null = null;
    for (const h of health) {
      const t = Date.parse(h.occurred_at);
      if (h.action === "sensor_unavailable" && down === null) down = t;
      else if (h.action === "sensor_restored" && down !== null) { spans = overlay(spans, { from: down, to: t, state: "unknown", reason: "source reported itself unavailable" }); down = null; }
    }
    if (down !== null) spans = overlay(spans, { from: down, to: Math.max(b, now), state: "unknown", reason: "source reported itself unavailable (not restored)" });

    // Receipt-based liveness against the declared freshness threshold (latest declared value applies).
    const stale = revs.at(-1)!.config.stale_after_seconds;
    if (stale) {
      const ms = stale * 1000;
      const receipts = (store.db.prepare("SELECT received_at FROM events WHERE project_id = ? AND source_id = ? AND received_at >= ? AND received_at <= ? ORDER BY received_at").all(projectId, src.id, iso(a - ms), iso(b)) as { received_at: string }[]).map((r) => Date.parse(r.received_at));
      const prior = store.db.prepare("SELECT MAX(received_at) AS r FROM events WHERE project_id = ? AND source_id = ? AND received_at < ?").get(projectId, src.id, iso(a - ms)) as { r: string | null };
      let lastSeen = receipts.length && receipts[0]! <= a ? receipts[0]! : prior.r ? Date.parse(prior.r) : null;
      const silent = (from: number, to: number) => { if (to > from) spans = overlay(spans, { from, to, state: "unknown", reason: `silent for more than ${stale}s (no receipts)` }); };
      if (lastSeen === null) {
        // LP26.1: before its first receipt a source is judged from its registration, like any other gap between two
        // signs of life: a first receipt within the freshness threshold of registration makes [registration, first
        // receipt) live (time before registration stays "not yet registered"). A source that never reported, or whose
        // first report came later than the threshold, gets nothing: that time stays unknown.
        const registered = Date.parse(revs[0]!.effective_at), first = receipts.length ? receipts[0]! : null;
        if (first !== null && first >= registered && first - registered <= ms) lastSeen = registered;
        else silent(a, first ?? Math.min(b, now));
      }
      for (const r of receipts) { if (lastSeen !== null && r - lastSeen > ms) silent(lastSeen + ms, r); lastSeen = Math.max(lastSeen ?? r, r); }
      if (lastSeen !== null && Math.min(b, now) - lastSeen > ms) silent(lastSeen + ms, Math.min(b, now));
    }
    // R02.1: the collector's own account of each window. Anything but complete lowers coverage for that window.
    for (const rep of store.collectionReports(projectId, src.id, iso(a), iso(b))) {
      if (rep.status === "complete") continue;
      const why = `collector reported ${rep.status.replace(/_/g, " ")} for this window${(JSON.parse(rep.detail) as { detail?: string }).detail ? `: ${(JSON.parse(rep.detail) as { detail: string }).detail}` : ""}`;
      spans = rep.status === "partial" ? overlayPartial(spans, Date.parse(rep.window_start), Date.parse(rep.window_end), why) : overlay(spans, { from: Date.parse(rep.window_start), to: Date.parse(rep.window_end), state: "unknown", reason: why });
    }
    if (b > now) spans = overlay(spans, { from: Math.max(a, now), to: b, state: "unknown", reason: "in the future" });
    const retention = revs.at(-1)!.config.retention_days;
    if (retention) spans = overlay(spans, { from: a, to: Math.min(b, now - retention * 86_400_000), state: "unknown", reason: `beyond the source's ${retention}-day retention (no backfill possible)` });
    perSource.push({ source_id: src.id, label: src.label, history_basis: basis, spans: spans.filter((s) => s.to > s.from) });
  }

  // Sweep: the best state any source provides for each elementary segment.
  const cuts = [...new Set([a, b, ...perSource.flatMap((p) => p.spans.flatMap((s) => [s.from, s.to]))])].filter((t) => t >= a && t <= b).sort((x, y) => x - y);
  const merged: { from: string; to: string; state: SpanState; sources: { source_id: string; state: SpanState; reason: string }[] }[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i]!, to = cuts[i + 1]!, mid = (from + to) / 2;
    const at = perSource.map((p) => { const s = p.spans.find((x) => x.from <= mid && mid < x.to); return { source_id: p.source_id, state: s?.state ?? ("unknown" as SpanState), reason: s?.reason ?? "no information" }; }).filter((x) => x.reason !== "not assigned to this asset");
    const state = at.reduce<SpanState>((best, x) => (RANK[x.state] > RANK[best] ? x.state : best), "unknown");
    const prev = merged.at(-1);
    if (prev && prev.state === state && JSON.stringify(prev.sources) === JSON.stringify(at)) prev.to = iso(to);
    else merged.push({ from: iso(from), to: iso(to), state, sources: at });
  }
  const total = (st: SpanState) => merged.filter((m) => m.state === st).reduce((n, m) => n + Date.parse(m.to) - Date.parse(m.from), 0);
  return {
    question: { ...q, asset_id: assetId },
    known_at: iso(now),
    spans: merged,
    totals_ms: { covered: total("covered"), partial: total("partial"), unknown: total("unknown") },
    sources: perSource.map((p) => ({ source_id: p.source_id, label: p.label, history_basis: p.history_basis })),
    notes: [
      "Coverage here is the capability to record this event class for this asset, not proof that anything was recorded or that nothing happened.",
      "Liveness uses receipt time; a business event's claimed time never vouches for a silent period. Current health never backfills a past gap.",
      "Collector-side loss is not visible unless the source reports it (sampling ratio, outage events).",
    ],
  };
}
