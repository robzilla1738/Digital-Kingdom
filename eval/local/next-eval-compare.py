#!/usr/bin/env python3
"""next-EVAL: descriptive comparison of a sealed fresh-document run with li-m7-7f4a12cd (read-only over both dirs).

  python3 eval/local/next-eval-compare.py <new dir> <m7 dir> > <new dir>/comparison.json

Counts per condition (model and scripted), every failed predicate with field / answered / admissible / family, the
tools the model called, the model's own turn text mentioning the failed request (excerpt), and any unsupported
affirmative. Different documents in the two runs: this is a side-by-side description, not a paired test.
"""
import json, os, re, sys

def load(d, mode):
    rd = os.path.join(d, "runs", mode)
    if not os.path.isdir(rd):
        return []
    return [json.load(open(os.path.join(rd, f))) for f in sorted(os.listdir(rd)) if re.fullmatch(r"\d{3}\.json", f)]

def _answers(r):
    return {o["request_id"]: o for o in (r.get("answer") or {}).get("operations", [])}

def s1(r):
    ops = r.get("key", {}).get("ops", [])
    if not any("unknown" in o["admissible"]["independent_effect"] for o in ops if o.get("visible")):
        return (0, 0)
    ex = [o for o in ops if o.get("visible") and o["admissible"]["independent_effect"] == ["not_observed"]]
    a = _answers(r)
    return (len(ex), sum(1 for o in ex if a.get(o["op_id"], {}).get("independent_effect") == "not_observed"))

def s2(r):
    ex = [o for o in r.get("key", {}).get("ops", []) if o.get("visible") and o["admissible"]["boundary_violation"] == ["yes"]]
    a = _answers(r)
    return (len(ex), sum(1 for o in ex if a.get(o["op_id"], {}).get("boundary_violation") == "yes"))

def g(r):
    ex = [o for o in r.get("key", {}).get("ops", []) if o.get("visible") and o["admissible"]["independent_effect"] == ["unknown"]]
    a = _answers(r)
    return (len(ex), sum(1 for o in ex if a.get(o["op_id"], {}).get("independent_effect") == "unknown"))

def summarize(recs):
    out = {}
    for c in ("C1", "C2", "C3"):
        rs = [r for r in recs if r["condition"] == c and r.get("metrics")]
        m = [r["metrics"] for r in rs]
        out[c] = {
            "attempts": len([r for r in recs if r["condition"] == c]),
            "end_to_end": f'{sum(1 for x in m if x["end_to_end_success"])}/{len(m)}',
            "structured": f'{sum(x["structured"]["passed"] for x in m)}/{sum(x["structured"]["eligible"] for x in m)}',
            "retrieval": f'{sum(x["retrieval"]["exposed"] for x in m)}/{sum(x["retrieval"]["reachable"] for x in m)}',
            "claim_validity": f'{sum(x["claim_validity"]["valid"] for x in m)}/{sum(x["claim_validity"]["submitted"] for x in m)}',
            "unsupported_affirmatives": sum(x.get("unsupported_affirmatives", 0) for x in m),
            "underclaims": sum(x.get("underclaims", 0) for x in m),
            "underclaims_by_field": {f: sum(1 for x in m for y in x["failures"] if y["field"] == f and y["answered"] == "unknown") for f in ("outcome", "independent_effect", "boundary_violation")},
            "wrong_affirmatives_by_field": {f: sum(1 for x in m for y in x["failures"] if y["field"] == f and y["answered"] not in (None, "unknown")) for f in ("outcome", "independent_effect", "boundary_violation")},
            "missed_ops": sum(len(x["operations"]["missed"]) for x in m),
            "statuses": {s: sum(1 for r in recs if r["condition"] == c and r["status"] == s) for s in sorted({r["status"] for r in recs if r["condition"] == c})},
            # exposure to the two m7 failure shapes (from the referee key stored in each record):
            # S1 = independent_effect admissible exactly [not_observed] in an attempt where another op's independent_effect
            #      admits unknown (an observer gap exists in the interval); S2 = boundary_violation admissible exactly [yes]
            "s1_exposed_predicates": sum(s1(r)[0] for r in rs), "s1_answered_correctly": sum(s1(r)[1] for r in rs),
            "s2_exposed_predicates": sum(s2(r)[0] for r in rs), "s2_answered_correctly": sum(s2(r)[1] for r in rs),
            # legitimate uncertainty kept: independent_effect admissible exactly [unknown] (request inside an observer gap)
            "gap_only_unknown_predicates": sum(g(r)[0] for r in rs), "gap_only_unknown_answered_unknown": sum(g(r)[1] for r in rs),
            "tool_calls": sum(x.get("tool_calls", 0) for x in m),
            "cost_gateway_reported_usd": round(sum((r.get("cost") or {}).get("gateway_reported_usd") or 0 for r in rs), 6),
        }
    return out

def excerpts(rec, op):
    texts = [t.get("content") or "" for t in (rec.get("model") or {}).get("turns", [])]
    suffix = op.rsplit("-", 1)[-1]
    hits = []
    def strings(v, acc, skip=False):
        if isinstance(v, str):
            if not skip: acc.append(v)
        elif isinstance(v, list):
            for x in v: strings(x, acc, skip)
        elif isinstance(v, dict):
            for k, x in v.items(): strings(x, acc, skip or k in ("operations", "evidence", "schema"))
        return acc
    def prose(t):
        body = t.strip().strip("`").removeprefix("json").strip()
        if body.startswith("{"):
            try:
                v, end = json.JSONDecoder().raw_decode(body)
                return "\n".join(strings(v, [])) + "\n" + body[end:]
            except Exception:
                return t
        return t
    texts = [prose(t) for t in texts]
    for t in texts:
        for s in re.split(r"(?<=[.;\n])\s+", t):
            if (op in s or re.search(rf"\bop-?{suffix}\b|request {suffix}\b", s)) and len(s) > 20:
                hits.append(s.strip()[:400])
    if not hits:
        hits = [s.strip()[:400] for t in texts for s in re.split(r"(?<=[.;\n])\s+", t) if re.search(r"unknown|coverage|unavailable|gap|tenant|boundary", s, re.I)][:3]
    return hits[:4]

def failures(recs):
    rows = []
    for r in recs:
        if not r.get("metrics"):
            continue
        tools = [e.get("tool") for e in r["trace"]["entries"] if e.get("kind") == "tool_call"]
        for f in r["metrics"]["failures"]:
            rows.append({
                "slot": r["slot"]["index"], "doc": r["slot"]["doc"], "family": (r.get("scenario") or {}).get("family"),
                "condition": r["condition"], "op": f["op_id"], "field": f["field"], "answered": f["answered"], "admissible": f["admissible"],
                "kind": "underclaim" if f["answered"] == "unknown" else ("missing_op" if f["answered"] is None else "wrong_affirmative"),
                "tools_called": tools, "model_text_excerpts": excerpts(r, f["op_id"]),
            })
    return rows

new, m7 = sys.argv[1], sys.argv[2]
res = {"schema": "dk.local.next_eval_comparison.v1", "note": "different held-out documents in each run (12 each), one repetition, descriptive only; no significance test",
       "new": {"dir": new, "model": summarize(load(new, "approved_provider")), "scripted": summarize(load(new, "scripted"))},
       "m7": {"dir": m7, "model": summarize(load(m7, "approved_provider")), "scripted": summarize(load(m7, "scripted"))},
       "new_failures": failures(load(new, "approved_provider")), "m7_failures": failures(load(m7, "approved_provider"))}
print(json.dumps(res, indent=1))
