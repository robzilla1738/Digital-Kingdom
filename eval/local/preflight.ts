/**
 * LP26-A1 — evidence-access and metadata equality BEFORE any attempt.
 *
 * For every condition, a separate project-scoped service viewer (same role and scope as the investigator, a distinct
 * token so the preflight's own packet/inspection reads are not attributed to the investigator) connects through that
 * condition's real MCP profile and enumerates what it can reach:
 *  - C1/C2: every page of dk_search_events over the case interval (and dk_get_event for the required records);
 *  - C3: every packet page, plus dk_inspect_refs over every stored id (found and in contract scope).
 * The case is valid only when every condition reaches exactly the stored in-interval record set, every required
 * record is reachable everywhere, the tool lists equal the declared profiles, and the public metadata (task, project,
 * case, interval) is byte-identical. An invalid preflight is recorded and never scored as a model result.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "../../packages/contracts/src/index.ts";
import { connectScoped, eventDigest, Recorder, type ConditionId } from "./recorder.ts";
import type { LocalCase, PublicHandle } from "./controller.ts";
import { INVESTIGATION_TOOLS } from "../../apps/mcp/src/server.ts";
import { READ_TOOLS } from "../../apps/mcp/src/focused.ts";

export const DECLARED_TOOLS: Record<ConditionId, string[]> = { C1: [...INVESTIGATION_TOOLS].sort(), C2: ["dk_get_event", "dk_search_events"], C3: [...READ_TOOLS].sort() };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const publicMetadata = (h: PublicHandle) => ({ task: h.task, task_version: h.task_version, project: h.project, case_id: h.case_id, interval: h.interval });

export interface ConditionReach { tools: string[]; tools_ok: boolean; reachable: string[]; digest_mismatches: string[]; pages: number; errors: string[] }
export interface PreflightRecord { valid: boolean; reasons: string[]; stored: number; required: string[]; metadata_sha256: string; conditions: Record<ConditionId, ConditionReach> }

export async function preflight(c: LocalCase, required: string[], conditions: ConditionId[] = ["C1", "C2", "C3"]): Promise<PreflightRecord> {
  const stored = await c.storedEvents();
  const inInterval = stored.filter((e) => { const t = Date.parse(String(e.occurred_at)); return t >= Date.parse(c.public.interval.after) && t < Date.parse(c.public.interval.before); });
  const byId = new Map(inInterval.map((e) => [String(e.id), eventDigest(e)]));
  const out = {} as Record<ConditionId, ConditionReach>;
  const reasons: string[] = [];
  for (const id of conditions) {
    const h: PublicHandle = { ...c.public, token: c.mintViewer(`preflight ${id}`) };
    const m = await connectScoped(h, id, new Recorder([h.token]));
    const reach = new Set<string>(); const mism: string[] = []; const errors: string[] = []; let pages = 0;
    try {
      if (id === "C3") {
        let cursor: string | undefined;
        for (let i = 0; i < 100; i++) {
          const p = await m.call("dk_get_packet", { case_id: h.case_id, ...(cursor ? { cursor } : {}) }); pages++;
          if (!p.json?.ok) { errors.push(`packet: ${p.text.slice(0, 200)}`); break; }
          for (const r of p.json.data.records) if (r.kind === "event") { reach.add(r.ref); if (byId.get(r.ref) !== r.digest) mism.push(r.ref); }
          cursor = p.json.continuation?.cursor; if (!cursor) break;
        }
        const ids = [...byId.keys()];
        for (let i = 0; i < ids.length; i += 20) {
          const r = await m.call("dk_inspect_refs", { case_id: h.case_id, ids: ids.slice(i, i + 20) });
          if (!r.json?.ok) { errors.push(`inspect: ${r.text.slice(0, 200)}`); continue; }
          for (const x of r.json.data.records) if (x.found && x.in_contract_scope && x.event) { reach.add(x.ref); if (eventDigest(x.event) !== byId.get(x.ref)) mism.push(x.ref); }
        }
      } else {
        let cursor: string | undefined;
        for (let i = 0; i < 100; i++) {
          const r = await m.call("dk_search_events", { after: h.interval.after, before: h.interval.before, limit: 100, ...(cursor ? { cursor } : {}) }); pages++;
          if (r.isError) { errors.push(`search: ${r.text.slice(0, 200)}`); break; }
          for (const e of r.json.events?.records ?? []) { reach.add(e.id); if (eventDigest(e) !== byId.get(e.id)) mism.push(e.id); }
          cursor = r.json.page?.next_cursor ?? undefined; if (!cursor) break;
        }
        for (const rid of required) { const d = await m.call("dk_get_event", { id: rid }); if (!d.json?.event || eventDigest(d.json.event) !== byId.get(rid)) mism.push(`detail:${rid}`); }
      }
    } finally { await m.close(); }
    const tools = [...m.tools].sort();
    out[id] = { tools, tools_ok: canonicalJson(tools) === canonicalJson(DECLARED_TOOLS[id]), reachable: [...reach].sort(), digest_mismatches: [...new Set(mism)].sort(), pages, errors };
    if (!out[id].tools_ok) reasons.push(`${id} tool list differs from its declared profile`);
    if (errors.length) reasons.push(`${id} preflight errors: ${errors.join("; ")}`);
    if (mism.length) reasons.push(`${id} delivered ${mism.length} record(s) that differ from the stored record`);
    const missing = [...byId.keys()].filter((x) => !reach.has(x)), extra = [...reach].filter((x) => !byId.has(x));
    if (missing.length || extra.length) reasons.push(`${id} reaches a different record set (${missing.length} missing, ${extra.length} extra)`);
    for (const r of required) if (!reach.has(r)) reasons.push(`required record ${r} unreachable in ${id}`);
  }
  return { valid: reasons.length === 0, reasons, stored: byId.size, required: [...required].sort(), metadata_sha256: sha(canonicalJson(publicMetadata(c.public))), conditions: out };
}
