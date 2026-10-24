/**
 * LP24 — the scripted investigator: a deterministic client (no model) that exercises the real stdio MCP transport and
 * the normal authenticated endpoints for each condition, then writes the structured answer from what it retrieved.
 * It knows the public task and the tool contract only; it never reads scenario documents, truth or the referee.
 * Its heuristics are deliberately simple and may be wrong; it is a protocol baseline, not an oracle.
 */
import { ANSWER_SCHEMA, type Answer, type AnswerOp } from "./answer.ts";
import type { PublicHandle, Family } from "./controller.ts";
import type { ScopedMcp } from "./recorder.ts";

type Ev = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Retrieve every event in the case interval the condition can reach, through its own tools. */
export async function retrieve(m: ScopedMcp, h: PublicHandle): Promise<{ events: Ev[]; complete: boolean }> {
  const events = new Map<string, Ev>();
  if (m.condition === "C3") {
    await m.call("dk_session");
    await m.call("dk_read_contract", { case_id: h.case_id });
    await m.call("dk_next_step", { case_id: h.case_id });
    let cursor: string | undefined, refs: string[] = [], complete = false;
    for (let i = 0; i < 50; i++) {
      const p = await m.call("dk_get_packet", { case_id: h.case_id, ...(cursor ? { cursor } : {}) });
      if (!p.json?.ok) break;
      refs.push(...p.json.data.records.filter((r: Ev) => r.kind === "event").map((r: Ev) => r.ref));
      cursor = p.json.continuation?.cursor; if (!cursor) { complete = true; break; }
    }
    refs = [...new Set(refs)];
    for (let i = 0; i < refs.length; i += 20) {
      const r = await m.call("dk_inspect_refs", { case_id: h.case_id, ids: refs.slice(i, i + 20) });
      for (const x of r.json?.data?.records ?? []) if (x.found && x.event) events.set(x.event.id, x.event);
    }
    return { events: [...events.values()], complete };
  }
  if (m.condition === "C1") await m.call("dk_overview", {});
  let cursor: string | undefined, complete = false;
  for (let i = 0; i < 50; i++) {
    const r = await m.call("dk_search_events", { after: h.interval.after, before: h.interval.before, limit: 100, ...(cursor ? { cursor } : {}) });
    if (r.isError) break;
    for (const e of r.json.events?.records ?? r.json.events ?? []) events.set(e.id, e);
    cursor = r.json.page?.next_cursor ?? undefined; if (!cursor) { complete = true; break; }
  }
  if (m.condition === "C2") for (const e of [...events.values()].filter((x) => x.request_id)) { const d = await m.call("dk_get_event", { id: e.id }); if (d.json?.event) events.set(e.id, d.json.event); }
  return { events: [...events.values()], complete };
}

const seqOf = (rid: string) => Number(/-(\d+)$/.exec(rid)?.[1] ?? 0);
const t = (e: Ev) => Date.parse(String(e.occurred_at));

/** Deterministic analysis of retrieved events for the public task of a family. */
export function analyze(family: Family, events: Ev[]): Answer {
  const independent = new Set(events.filter((e) => e.attributes?.observer || e.action === "sensor_unavailable").map((e) => e.source_id));
  const isObs = (e: Ev) => independent.has(e.source_id);
  const byRid = new Map<string, Ev[]>();
  for (const e of events) if (e.request_id) byRid.set(e.request_id, [...(byRid.get(e.request_id) ?? []), e]);
  const relevant = (rid: string, es: Ev[]) =>
    family === "saas-storefront" ? es.some((e) => !isObs(e) && e.route === "/tenants/{tenant}/records" && e.action === "request_received")
      : family === "agent-workspace" ? es.some((e) => !isObs(e) && e.action === "tool_invocation" && e.attributes?.destination)
        : es.some((e) => !isObs(e) && e.route === "/tenants/{tenant}/records" && e.action === "request_received");
  const rids = [...byRid.entries()].filter(([rid, es]) => relevant(rid, es)).map(([rid]) => rid).sort((a, b) => seqOf(a) - seqOf(b));
  const sensorDown = (asset: string, at: number) => {
    const marks = events.filter((e) => isObs(e) && (e.asset_ids ?? []).includes(asset) && ["sensor_unavailable", "sensor_restored"].includes(e.action) && t(e) <= at).sort((a, b) => t(a) - t(b));
    return marks.length > 0 && marks.at(-1)!.action === "sensor_unavailable";
  };
  // assets the independent observer reports about (its data reads and its coverage markers)
  const watched = [...new Set(events.filter((e) => isObs(e) && ["data_access", "sensor_unavailable", "sensor_restored"].includes(e.action)).flatMap((e) => e.asset_ids ?? []))] as string[];
  const target = family === "agent-workspace" ? events.filter((e) => e.attributes?.destination).map((e) => String(e.attributes.destination)) : watched;
  // saas: own tenant per actor from reads allowed under a baseline policy revision
  const own = new Map<string, string>();
  if (family === "saas-storefront") for (const es of byRid.values()) for (const e of es) if (!isObs(e) && e.action === "data_access" && e.actor_ref && e.attributes?.tenant) {
    const req = es.find((x) => x.action === "request_received" && x.source_id === e.source_id);
    if (String(req?.attributes?.policy_revision ?? "").includes("baseline") && !own.has(e.actor_ref)) own.set(e.actor_ref, e.attributes.tenant);
  }
  const approvedDest = new Set(events.filter((e) => e.action === "tool_invocation" && e.outcome === "success" && e.attributes?.destination && !String(e.attributes.destination).includes("blocked")).map((e) => String(e.attributes.destination)));
  const ops: AnswerOp[] = rids.map((rid) => {
    const es = byRid.get(rid)!;
    const self = es.filter((e) => !isObs(e));
    const outcome = self.some((e) => e.outcome === "denied" || e.outcome === "blocked" || Number(e.attributes?.status) >= 400) ? "denied" : self.some((e) => ["success", "allowed"].includes(e.outcome)) ? "allowed" : "unknown";
    const at = Math.max(...es.map(t));
    const obsEffect = es.some((e) => isObs(e) && ["data_access", "side_effect_observed"].includes(e.action));
    const assets = family === "agent-workspace" ? [...new Set(es.map((e) => e.attributes?.destination).filter(Boolean))] as string[] : target;
    const effect = obsEffect ? "observed" : assets.some((a) => sensorDown(a, at)) || !independent.size ? "unknown" : "not_observed";
    let boundary: AnswerOp["boundary_violation"] = "unknown";
    if (family === "saas-storefront") {
      const read = es.find((e) => !isObs(e) && e.action === "data_access" && e.attributes?.tenant);
      const actor = self.find((e) => e.actor_ref)?.actor_ref;
      if (self.some((e) => e.rule_ref === "tenant-isolation")) boundary = "yes";
      else if (read && actor && own.has(actor)) boundary = own.get(actor) === read.attributes.tenant ? "no" : "yes";
    } else if (family === "agent-workspace") {
      const dest = es.find((e) => e.attributes?.destination)?.attributes.destination;
      boundary = dest ? (approvedDest.has(String(dest)) && !String(dest).includes("blocked") ? "no" : "yes") : "unknown";
    } else {
      const actor = self.find((e) => e.actor_ref)?.actor_ref;
      const before = events.filter((e) => e.request_id && seqOf(e.request_id) < seqOf(rid) && e.action === "authorization_change" && (!actor || e.actor_ref === actor));
      const revoked = before.some((e) => e.attributes?.change === "credential_deactivated");
      const granted = before.some((e) => e.attributes?.change === "grant_add") && !before.some((e) => e.attributes?.change === "grant_remove" && seqOf(e.request_id) > seqOf(before.filter((x) => x.attributes?.change === "grant_add").at(-1)!.request_id));
      boundary = revoked || !granted ? "yes" : "no";
    }
    return { request_id: rid, outcome, independent_effect: effect, boundary_violation: boundary, evidence: es.map((e) => e.id).sort() };
  });
  return { schema: ANSWER_SCHEMA, operations: ops, summary: `Scripted analysis of ${events.length} retrieved records: ${ops.length} in-scope requests.`, unknowns: ops.filter((o) => o.independent_effect === "unknown").map((o) => `${o.request_id}: independent observation unavailable at the time`) };
}

export async function scriptedInvestigate(m: ScopedMcp, h: PublicHandle, family: Family) {
  const r = await retrieve(m, h);
  const answer = analyze(family, r.events);
  m.recorder.push({ kind: "claims", answer } as never);
  return { answer, retrieved: r.events.length, complete: r.complete };
}
