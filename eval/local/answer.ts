/** The structured answer every investigator (scripted, model, native agent) returns, identical across conditions. */
export const ANSWER_SCHEMA = "dk.local.eval_answer.v1";
export const OUTCOMES = ["allowed", "denied", "unknown"] as const;
export const EFFECTS = ["observed", "not_observed", "unknown"] as const;
export const BOUNDARY = ["yes", "no", "unknown"] as const;
export interface AnswerOp { request_id: string; outcome: (typeof OUTCOMES)[number]; independent_effect: (typeof EFFECTS)[number]; boundary_violation: (typeof BOUNDARY)[number]; evidence: string[] }
export interface Answer { schema: typeof ANSWER_SCHEMA; operations: AnswerOp[]; summary: string; unknowns: string[] }

export const ANSWER_SHAPE = `{
  "schema": "${ANSWER_SCHEMA}",
  "operations": [{
    "request_id": "the request_id exactly as recorded",
    "outcome": "allowed | denied | unknown",
    "independent_effect": "observed | not_observed | unknown",
    "boundary_violation": "yes | no | unknown",
    "evidence": ["ids of the event records you relied on, exactly as given to you"]
  }],
  "summary": "2-4 sentences",
  "unknowns": ["what the evidence cannot establish, and why"]
}`;

export function parseAnswer(text: string | null): { ok: true; answer: Answer } | { ok: false; error: string } {
  if (!text) return { ok: false, error: "no final answer" };
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  let j: unknown = null;
  try { j = JSON.parse(t); } catch { const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a >= 0 && b > a) { try { j = JSON.parse(t.slice(a, b + 1)); } catch { /* invalid */ } } }
  if (!j || typeof j !== "object") return { ok: false, error: "final answer is not a JSON object" };
  const o = j as Record<string, unknown>;
  if (o.schema !== ANSWER_SCHEMA) return { ok: false, error: `schema must be ${ANSWER_SCHEMA}` };
  if (!Array.isArray(o.operations)) return { ok: false, error: "operations must be a list" };
  const ops: AnswerOp[] = [];
  for (const [i, x] of o.operations.entries()) {
    const r = x as Record<string, unknown>;
    if (!r || typeof r.request_id !== "string") return { ok: false, error: `operations[${i}].request_id missing` };
    if (!(OUTCOMES as readonly unknown[]).includes(r.outcome)) return { ok: false, error: `operations[${i}].outcome invalid` };
    if (!(EFFECTS as readonly unknown[]).includes(r.independent_effect)) return { ok: false, error: `operations[${i}].independent_effect invalid` };
    if (!(BOUNDARY as readonly unknown[]).includes(r.boundary_violation)) return { ok: false, error: `operations[${i}].boundary_violation invalid` };
    if (!Array.isArray(r.evidence) || r.evidence.some((e) => typeof e !== "string")) return { ok: false, error: `operations[${i}].evidence must be a list of ids` };
    ops.push({ request_id: r.request_id, outcome: r.outcome as AnswerOp["outcome"], independent_effect: r.independent_effect as AnswerOp["independent_effect"], boundary_violation: r.boundary_violation as AnswerOp["boundary_violation"], evidence: r.evidence as string[] });
  }
  return { ok: true, answer: { schema: ANSWER_SCHEMA, operations: ops, summary: typeof o.summary === "string" ? o.summary : "", unknowns: Array.isArray(o.unknowns) ? o.unknowns.map(String) : [] } };
}
