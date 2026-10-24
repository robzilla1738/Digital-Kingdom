import type { CoverageRecord, Finding, Graph, Relationship, SecurityEvent } from "@dk/contracts";

/**
 * LP18 evidence-linked interiors (`dk.asset_interior.v1`). An interior is a list of typed objects inside one asset,
 * each pointing at the EXACT authoritative record it came from (a declared route, a relationship, an event, a source,
 * a control, a grant or credential reference, an artifact reference) with that record's provenance. Nothing here is a
 * generated description: labels are copied from the record, and every status is text plus a glyph name, never colour.
 *
 * Basis vocabulary (kept separate on purpose):
 * - declared:   stated in the inventory or plan; not observed.
 * - configured: present in configuration (a grant, a tool capability); what MAY happen, not what did.
 * - observed:   recorded by a connected source, with its event ids.
 * - tested:     a control whose latest supported test passed under the current configuration.
 * - unknown:    the record exists but its state cannot be established (stale/failed/untested control, no snapshot).
 * - hypothetical: proposed only; never shown outside a branch or case.
 * Declared and configured relationships are never drawn as transit: `draw.transit` is true only for observed records.
 * The same function runs on the server (API, MCP) and in the offline client, so every view shows the same objects.
 */
export const ASSET_INTERIOR = "dk.asset_interior.v1";
export const INTERIOR_LIMITS = { max_objects: 120, max_events_per_object: 25 } as const;

export type InteriorKind = "route" | "grant" | "credential" | "data" | "tool" | "run" | "decision" | "execution" | "effect" | "artifact" | "control" | "source";
export type InteriorBasis = "declared" | "configured" | "observed" | "tested" | "unknown" | "hypothetical";
export type InteriorFamily = "service" | "identity" | "data" | "agent" | "delivery" | "control";
export interface InteriorRecordRef { type: "asset_route" | "relationship" | "event" | "source" | "control" | "grant" | "credential" | "artifact_reference"; id: string; ref: string; body: Record<string, unknown> }
export interface InteriorObject {
  object_id: string; kind: InteriorKind; family: InteriorFamily; label: string; basis: InteriorBasis;
  status: { text: string; glyph: "dash-outline" | "solid" | "ring" | "hatch" | "check" | "cross" | "question" };
  record: InteriorRecordRef; provenance: string[];
  relationships: { type: string; target: string; basis: InteriorBasis; note?: string }[];
  event_ids: string[];
  actions: { id: "open_record" | "find_activity" | "open_event" | "open_source" | "open_relationship" | "open_control" | "explore_permission" | "inspect_coverage"; label: string; target?: { kind: "event" | "source" | "path" | "asset" | "finding"; id: string } }[];
  draw: { line: "patterned_declared" | "patterned_configured" | "patterned_conditional" | "solid_observed" | "hatched_unknown" | "dotted_hypothetical"; transit: boolean };
}
export interface AssetInterior {
  schema: typeof ASSET_INTERIOR; project_id: string; asset_id: string; graph_revision: string; families: InteriorFamily[];
  objects: InteriorObject[]; truncated: boolean;
  unavailable: { what: string; reason: string }[];
  not_claimed: string[];
}
export interface InteriorControl { id: string; name: string; kind?: string; asset_ids: string[]; state: string; state_reason: string }
export interface InteriorGrantElement { kind: "grant" | "credential"; authority: string; id: string; attrs: Record<string, unknown>; provenance: string[] }
export interface InteriorInput {
  project_id: string; graph: Graph; asset_id: string;
  events: SecurityEvent[];
  sources: { id: string; label: string; kind?: string; asset_ids: string[]; disabled?: boolean }[];
  coverage: CoverageRecord[];
  findings?: Finding[];
  /** null: the control registry is not available to this caller (offline demo). */
  controls: InteriorControl[] | null;
  /** null: no authorization snapshot is stored (grants unknown, never "none"). */
  grants: InteriorGrantElement[] | null;
}

const GLYPH: Record<InteriorBasis, InteriorObject["status"]["glyph"]> = { declared: "dash-outline", configured: "ring", observed: "solid", tested: "check", unknown: "question", hypothetical: "hatch" };
const LINE: Record<InteriorBasis, InteriorObject["draw"]["line"]> = { declared: "patterned_declared", configured: "patterned_configured", observed: "solid_observed", tested: "solid_observed", unknown: "hatched_unknown", hypothetical: "dotted_hypothetical" };
const draw = (basis: InteriorBasis, conditional = false): InteriorObject["draw"] => ({ line: conditional ? "patterned_conditional" : LINE[basis], transit: basis === "observed" });
const routeMatches = (template: string, route: string | undefined) => {
  if (!route) return false;
  const t = template.replace(/\/+$/, ""), r = route.split("?")[0]!.replace(/\/+$/, "");
  if (t.endsWith("/*")) return r === t.slice(0, -2) || r.startsWith(t.slice(0, -1));
  const ts = t.split("/"), rs = r.split("/");
  return ts.length === rs.length && ts.every((s, i) => s === rs[i] || /^\{.+\}$/.test(s) || s.startsWith(":"));
};
const relBody = (r: Relationship) => ({ id: r.id, source_id: r.source_id, target_id: r.target_id, kind: r.kind, evidence_level: r.evidence_level, evidence_refs: r.evidence_refs, ...(r.assumptions ? { assumptions: r.assumptions } : {}), ...(r.valid_from ? { valid_from: r.valid_from } : {}) });
const evBody = (e: SecurityEvent) => ({ id: e.id, source_id: e.source_id, occurred_at: e.occurred_at, received_at: e.received_at, action: e.action, outcome: e.outcome, asset_ids: e.asset_ids, ...(e.route ? { route: e.route } : {}), ...(e.run_id ? { run_id: e.run_id } : {}), ...(e.rule_ref ? { rule_ref: e.rule_ref } : {}), ...(e.agent ? { agent: e.agent } : {}), evidence_refs: e.evidence_refs });

export function buildInterior(input: InteriorInput): AssetInterior | null {
  const { graph, asset_id: id } = input;
  const asset = graph.assets.find((a) => a.id === id);
  if (!asset) return null;
  const name = (aid: string) => graph.assets.find((a) => a.id === aid)?.name ?? aid;
  const objects: InteriorObject[] = [];
  const unavailable: AssetInterior["unavailable"] = [];
  const events = input.events.filter((e) => e.asset_ids.includes(id)).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id));
  const cap = (ids: string[]) => ids.slice(-INTERIOR_LIMITS.max_events_per_object);
  const graphRef = `graph:${graph.graph_revision}`;

  // Service: declared routes (the authoritative route inventory), with observed requests matched to each template.
  (asset.routes ?? []).forEach((r, i) => {
    const methods = r.methods?.join(",") || "ANY";
    const seen = events.filter((e) => e.action === "request_received" && routeMatches(r.path, e.route));
    objects.push({ object_id: `route:${i}:${methods} ${r.path}`, kind: "route", family: "service", label: `${methods} ${r.path}${r.hosts?.length ? ` @ ${r.hosts.join(", ")}` : ""}`, basis: "declared",
      status: { text: `Declared route${r.hosts?.length ? " (locally declared host alias; no DNS discovery)" : ""}. ${seen.length ? `${seen.length} recorded request${seen.length === 1 ? "" : "s"} matched this template.` : "No recorded request matched this template in the loaded events."}`, glyph: GLYPH.declared },
      record: { type: "asset_route", id: `${id}#routes/${i}`, ref: `${graphRef}#${id}/routes/${i}`, body: { asset_id: id, index: i, ...r } }, provenance: [graphRef, ...asset.source_refs],
      relationships: seen.length ? [{ type: "requests_observed", target: `events:${seen.length}`, basis: "observed", note: "template match on the recorded route field" }] : [],
      event_ids: cap(seen.map((e) => e.id)), actions: [{ id: "open_record", label: "Open declared route" }, { id: "find_activity", label: "Search stored events for this asset", target: { kind: "asset", id } }], draw: draw("declared") });
  });

  // Identity: grants and credential references owned by this asset's provider identity (never secret values).
  const pid = asset.provider_ref?.id;
  if (pid) {
    if (input.grants === null) unavailable.push({ what: "grants and credentials", reason: "no authorization snapshot is stored for this project; grants are unknown, not absent" });
    else for (const g of input.grants.filter((x) => x.attrs.owner === pid)) {
      const conditional = g.kind === "grant" && !!g.attrs.conditional, inactive = g.kind === "credential" && g.attrs.status === "Inactive";
      const stmt = g.attrs.statement as { Effect?: string; Action?: unknown; Resource?: unknown } | undefined;
      objects.push({ object_id: `${g.kind}:${g.authority}:${g.id}`, kind: g.kind, family: "identity", label: g.kind === "credential" ? `Access key ${String(g.attrs.key_id)} (${String(g.attrs.status)})` : `${String(g.attrs.layer)} ${stmt?.Effect ?? ""} ${[stmt?.Action].flat().join(", ")}`.trim(), basis: "configured",
        status: { text: g.kind === "credential" ? `Credential reference only (status ${String(g.attrs.status)}); the secret value is never stored or shown.${inactive ? " Inactive: other grants of this principal remain separate authority." : ""}` : `Configured permission${conditional ? " with conditions (not evaluated)" : ""}; not observed use.`, glyph: inactive ? "cross" : GLYPH.configured },
        record: { type: g.kind, id: g.id, ref: `${g.kind}|${g.authority}|${g.id}`, body: { authority: g.authority, id: g.id, ...g.attrs } }, provenance: g.provenance,
        relationships: [{ type: g.kind === "credential" ? "credential_of" : "grants", target: pid, basis: "configured" }], event_ids: [],
        actions: [{ id: "open_record", label: g.kind === "credential" ? "Open credential reference" : "Open grant statement" }, ...(g.kind === "grant" ? [{ id: "explore_permission" as const, label: "Explain a path for this principal" }] : [])], draw: draw("configured", conditional) });
    }
  }
  for (const r of graph.relationships.filter((x) => (x.source_id === id || x.target_id === id) && (x.kind === "runs_as" || x.kind === "may_assume"))) {
    const basis: InteriorBasis = r.evidence_level === "observed" ? "observed" : r.evidence_level === "hypothetical" ? "hypothetical" : "configured";
    objects.push({ object_id: `grant:relationship:${r.id}`, kind: "grant", family: "identity", label: `${name(r.source_id)} ${r.kind.replace("_", " ")} ${name(r.target_id)}`, basis,
      status: { text: basis === "observed" ? "A grant whose use a source recorded." : "Configured permission; not observed use. Not attacker transit.", glyph: GLYPH[basis] },
      record: { type: "relationship", id: r.id, ref: `relationship:${r.id}`, body: relBody(r) }, provenance: [graphRef, ...r.evidence_refs],
      relationships: [{ type: r.kind, target: r.source_id === id ? r.target_id : r.source_id, basis }], event_ids: [], actions: [{ id: "open_relationship", label: "Open relationship", target: { kind: "path", id: r.id } }], draw: draw(basis) });
  }

  // Data: declared readers/writers, observed data access, and the sources that can audit this asset.
  for (const r of graph.relationships.filter((x) => (x.target_id === id || x.source_id === id) && (x.kind === "reads_from" || x.kind === "writes_to"))) {
    const reads = events.filter((e) => e.action === "data_access" && e.asset_ids.includes(r.source_id === id ? r.target_id : r.source_id));
    const basis: InteriorBasis = r.evidence_level === "observed" ? "observed" : r.evidence_level === "hypothetical" ? "hypothetical" : "declared";
    objects.push({ object_id: `data:relationship:${r.id}`, kind: "data", family: "data", label: `${name(r.source_id)} ${r.kind.replace("_", " ")} ${name(r.target_id)}`, basis,
      status: { text: `${basis === "declared" ? "Declared data relationship; runtime access is established only by recorded events." : basis === "observed" ? "Observed data relationship." : "Hypothetical relationship, not recorded."}${reads.length ? ` ${reads.length} recorded data-access event${reads.length === 1 ? "" : "s"} on the related assets.` : ""}`, glyph: GLYPH[basis] },
      record: { type: "relationship", id: r.id, ref: `relationship:${r.id}`, body: relBody(r) }, provenance: [graphRef, ...r.evidence_refs],
      relationships: [{ type: r.kind, target: r.source_id === id ? r.target_id : r.source_id, basis }], event_ids: cap(reads.map((e) => e.id)), actions: [{ id: "open_relationship", label: "Open relationship", target: { kind: "path", id: r.id } }, { id: "find_activity", label: "Search stored events for this asset", target: { kind: "asset", id } }], draw: draw(basis) });
  }
  for (const e of events.filter((x) => x.action === "data_access").slice(-INTERIOR_LIMITS.max_events_per_object)) objects.push({
    object_id: `data:event:${e.id}`, kind: "data", family: "data", label: `Data access · ${e.outcome}${e.route ? ` · ${e.route}` : ""}`, basis: "observed",
    status: { text: `Recorded by ${e.source_id} (${e.outcome}). An observed operation, not a security conclusion.`, glyph: GLYPH.observed },
    record: { type: "event", id: e.id, ref: `event:${e.id}`, body: evBody(e) }, provenance: [`source:${e.source_id}`, ...e.evidence_refs], relationships: [{ type: "recorded_by", target: e.source_id, basis: "observed" }],
    event_ids: [e.id], actions: [{ id: "open_event", label: "Open event", target: { kind: "event", id: e.id } }, { id: "open_source", label: "Open recording source", target: { kind: "source", id: e.source_id } }], draw: draw("observed") });
  for (const s of input.sources.filter((x) => x.asset_ids.includes(id))) {
    const c = input.coverage.find((x) => x.source_id === s.id);
    const state = s.disabled ? "administratively disabled" : c?.state ?? "not assessed";
    const basis: InteriorBasis = !s.disabled && c?.state === "healthy" ? "observed" : "unknown";
    objects.push({ object_id: `source:${s.id}`, kind: "source", family: "data", label: `${s.label} (${s.kind ?? "source"})`, basis,
      status: { text: `Current source state: ${state}.${basis === "observed" ? " Reporting per freshness checks; not proof of complete detection." : " Visibility is unknown, not healthy."}`, glyph: basis === "observed" ? "solid" : "hatch" },
      record: { type: "source", id: s.id, ref: `source:${s.id}`, body: { id: s.id, label: s.label, kind: s.kind ?? null, asset_ids: s.asset_ids, disabled: !!s.disabled, coverage_state: c?.state ?? null, coverage_note: c?.note ?? null } }, provenance: [`source:${s.id}`],
      relationships: [{ type: "covers", target: id, basis }], event_ids: [], actions: [{ id: "open_source", label: "Open source", target: { kind: "source", id: s.id } }, { id: "inspect_coverage", label: "Inspect coverage history" }], draw: { line: basis === "observed" ? "solid_observed" : "hatched_unknown", transit: false } });
  }

  // Agent: configured tool capabilities, then decisions, executions and effects as SEPARATE objects, each with its own
  // event and source. Effects come only from records whose origin is an independent observer.
  for (const r of graph.relationships.filter((x) => x.kind === "invokes_tool" && (x.source_id === id || x.target_id === id))) {
    const basis: InteriorBasis = r.evidence_level === "observed" ? "observed" : r.evidence_level === "hypothetical" ? "hypothetical" : "configured";
    objects.push({ object_id: `tool:relationship:${r.id}`, kind: "tool", family: "agent", label: `${name(r.source_id)} may invoke ${name(r.target_id)}`, basis,
      status: { text: basis === "configured" ? "Configured tool capability; not an observed call." : basis === "observed" ? "A tool link whose use a source recorded." : "Hypothetical tool link.", glyph: GLYPH[basis] },
      record: { type: "relationship", id: r.id, ref: `relationship:${r.id}`, body: relBody(r) }, provenance: [graphRef, ...r.evidence_refs], relationships: [{ type: "invokes_tool", target: r.source_id === id ? r.target_id : r.source_id, basis }],
      event_ids: [], actions: [{ id: "open_relationship", label: "Open tool link", target: { kind: "path", id: r.id } }], draw: draw(basis) });
  }
  const agentEvents = events.filter((e) => e.action === "tool_invocation" || e.agent || (e.action === "side_effect_observed"));
  const runs = [...new Set(agentEvents.map((e) => e.run_id).filter((x): x is string => !!x))].sort();
  for (const run of runs) {
    const evs = agentEvents.filter((e) => e.run_id === run);
    objects.push({ object_id: `run:${run}`, kind: "run", family: "agent", label: `Run ${run} · ${evs.length} recorded step${evs.length === 1 ? "" : "s"}`, basis: "observed",
      status: { text: "Correlated by the recorded run id only; correlation is not causation.", glyph: "solid" },
      record: { type: "event", id: evs[0]!.id, ref: `run:${run}`, body: { run_id: run, event_ids: evs.map((e) => e.id) } }, provenance: [...new Set(evs.map((e) => `source:${e.source_id}`))],
      relationships: evs.map((e) => ({ type: e.agent?.phase ?? e.action, target: `event:${e.id}`, basis: "observed" as const })), event_ids: cap(evs.map((e) => e.id)), actions: [{ id: "find_activity", label: "Search stored events for this asset", target: { kind: "asset", id } }], draw: draw("observed") });
  }
  for (const e of agentEvents) {
    const phase = e.agent?.phase ?? (e.action === "side_effect_observed" ? "effect" : "execution");
    const independent = e.agent?.origin === "independent_observer" || e.action === "side_effect_observed";
    const kind: InteriorKind = phase === "effect" ? "effect" : phase === "execution" ? "execution" : "decision";
    if (kind === "effect" && !independent) continue; // a self-reported "effect" is not an effect record
    const tool = e.agent?.tool ?? (e.attributes?.tool as string | undefined);
    objects.push({ object_id: `${kind}:${e.id}`, kind, family: "agent", label: `${kind === "decision" ? `Decision (${e.agent?.phase ?? "decision"})` : kind === "execution" ? "Execution" : "Observed effect"}${tool ? ` · ${tool}` : ""} · ${e.outcome}`, basis: "observed",
      status: { text: kind === "decision" ? `A recorded ${e.agent?.phase ?? "decision"} by ${e.agent?.origin ?? e.source_id} (${e.outcome}); a decision is not an execution.` : kind === "execution" ? `A recorded execution reported by ${e.agent?.origin ?? e.source_id} (${e.outcome}); an execution is not its effect.` : `An effect recorded by an independent observer (${e.source_id}).`, glyph: kind === "effect" ? "solid" : kind === "execution" ? "ring" : "dash-outline" },
      record: { type: "event", id: e.id, ref: `event:${e.id}`, body: evBody(e) }, provenance: [`source:${e.source_id}`, ...e.evidence_refs],
      relationships: [{ type: "recorded_by", target: e.source_id, basis: "observed", note: e.agent?.origin ?? (independent ? "independent_observer" : "unknown origin") }, ...(e.run_id ? [{ type: "in_run", target: `run:${e.run_id}`, basis: "observed" as const, note: "same recorded run id" }] : [])],
      event_ids: [e.id], actions: [{ id: "open_event", label: "Open event", target: { kind: "event", id: e.id } }, { id: "open_source", label: "Open recording source", target: { kind: "source", id: e.source_id } }], draw: draw("observed") });
  }

  // Delivery: declared deployers and the declared running artifact reference (digest/provenance labels, no "safe" shield).
  for (const r of graph.relationships.filter((x) => x.kind === "deploys" && (x.source_id === id || x.target_id === id))) {
    const basis: InteriorBasis = r.evidence_level === "observed" ? "observed" : "declared";
    objects.push({ object_id: `artifact:relationship:${r.id}`, kind: "artifact", family: "delivery", label: `${name(r.source_id)} deploys ${name(r.target_id)}`, basis,
      status: { text: basis === "declared" ? "Declared deployment relationship; not an observed deployment." : "Observed deployment relationship.", glyph: GLYPH[basis] },
      record: { type: "relationship", id: r.id, ref: `relationship:${r.id}`, body: relBody(r) }, provenance: [graphRef, ...r.evidence_refs], relationships: [{ type: "deploys", target: r.source_id === id ? r.target_id : r.source_id, basis }],
      event_ids: [], actions: [{ id: "open_relationship", label: "Open relationship", target: { kind: "path", id: r.id } }], draw: draw(basis) });
  }
  if (asset.deployment) {
    const at = asset.deployment.indexOf("@"), digest = at >= 0 ? asset.deployment.slice(at + 1) : null;
    objects.push({ object_id: `artifact:deployment:${id}`, kind: "artifact", family: "delivery", label: `Running artifact ${asset.deployment}`, basis: "declared",
      status: { text: `${digest ? `Declared digest ${digest}.` : "No digest declared: the running artifact is not pinned."} A digest or signature is a provenance label, not a malware-free verdict.`, glyph: GLYPH.declared },
      record: { type: "artifact_reference", id: `${id}#deployment`, ref: `${graphRef}#${id}/deployment`, body: { asset_id: id, reference: asset.deployment, digest } }, provenance: [graphRef, ...asset.source_refs], relationships: [{ type: "runs", target: id, basis: "declared" }],
      event_ids: [], actions: [{ id: "open_record", label: "Open artifact reference" }], draw: draw("declared") });
  }

  // Controls: declared configuration and test state. A shield-like "tested" basis only for a current passing test.
  if (input.controls === null) unavailable.push({ what: "controls", reason: "the control registry is not available in this view; controls are unknown, not absent" });
  else for (const c of input.controls.filter((x) => x.asset_ids.includes(id))) {
    const basis: InteriorBasis = c.state === "tested" ? "tested" : c.state === "declared" || c.state === "configured" ? "declared" : "unknown";
    objects.push({ object_id: `control:${c.id}`, kind: "control", family: "control", label: `${c.name}${c.kind ? ` (${c.kind})` : ""}`, basis,
      status: { text: `Control state: ${c.state}. ${c.state_reason}${c.asset_ids.length > 1 ? ` Scope covers ${c.asset_ids.length} assets; it does not protect the whole building.` : ""}`, glyph: c.state === "tested" ? "check" : c.state === "failed" ? "cross" : c.state === "stale" || c.state === "unknown" ? "question" : "dash-outline" },
      record: { type: "control", id: c.id, ref: `control:${c.id}`, body: { ...c } }, provenance: [`control:${c.id}`], relationships: [{ type: "scoped_to", target: id, basis }],
      event_ids: [], actions: [{ id: "open_control", label: "Open control receipt" }], draw: { line: basis === "tested" ? "solid_observed" : basis === "unknown" ? "hatched_unknown" : "patterned_declared", transit: false } });
  }

  const families = [...new Set(objects.map((o) => o.family))];
  const truncated = objects.length > INTERIOR_LIMITS.max_objects;
  return {
    schema: ASSET_INTERIOR, project_id: input.project_id, asset_id: id, graph_revision: graph.graph_revision, families,
    objects: objects.slice(0, INTERIOR_LIMITS.max_objects), truncated, unavailable,
    not_claimed: [
      "Interior objects are copied from records; positions inside the building are presentation only.",
      "Declared and configured relationships are not observed transit; only observed records have transit set.",
      "A decision is not an execution, and an execution is not its effect; effects come only from independent observers.",
    ],
  };
}
