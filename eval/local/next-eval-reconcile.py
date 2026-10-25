import json, os, re, sys
d = sys.argv[1]
rd = os.path.join(d, "runs", "approved_provider")
recs = [json.load(open(os.path.join(rd, f))) for f in sorted(os.listdir(rd)) if re.fullmatch(r"\d{3}\.json", f)]
led = json.load(open(os.path.join(d, "model-spend-ledger.json")))
prog = [json.loads(l) for l in open(os.path.join(rd, "progress.jsonl"))]
fin = [p for p in prog if "finished_at" in p]
turn_sum = 0.0; turns = 0; missing = 0; gens = []
per = {"C1": 0.0, "C2": 0.0, "C3": 0.0}
for r in recs:
    for t in (r.get("model") or {}).get("turns", []):
        c = (t.get("usage") or {}).get("cost")
        turns += 1
        if c is None: missing += 1
        else: turn_sum += c; per[r["condition"]] += c
        if t.get("generation_id"): gens.append(t["generation_id"])
rep = sum((r.get("cost") or {}).get("gateway_reported_usd") or 0 for r in recs)
errors = [r["attempt_id"] for r in recs if (r.get("model") or {}).get("error")]
prior_cons, prior_true = 2.138016, 1.934480
true = round(turn_sum, 9)
out = {
    "schema": "dk.local.eval_spend_reconciliation.v1", "preregistration": json.load(open(os.path.join(d, "preregistration.json")))["id"],
    "true_spend_usd": true,
    "basis": "sum of the gateway-reported cost (usage.cost) of every model request in every record",
    "requests": turns, "requests_without_gateway_cost": missing, "generation_ids": len(gens), "attempts_with_model_error": errors,
    "attempt_level_gateway_reported_sum_usd": round(rep, 9),
    "budget_ledger_incurred_usd_runner_final": fin[-1]["spent_total"] if fin else None,
    "ledger_entries_charged_total_usd": led["charged_total_usd"],
    "attribution": "runner fixed after m7 (fbe77c7): with concurrency 2 each clean attempt is charged its own gateway-reported cost, so the ledger entries should equal the true spend",
    "per_condition_true_usd": {k: round(v, 6) for k, v in per.items()},
    "allowance_usd": 0.60, "run_stop_usd": 0.52,
    "phase_total_conservative_usd": round(prior_cons + max(true, led["charged_total_usd"]), 6),
    "phase_total_true_usd": round(prior_true + true, 6),
    "prior_phase_total_conservative_usd": prior_cons, "prior_phase_total_true_usd": prior_true,
    "phase_cap_usd": 3.0, "records_unchanged": True,
}
print(json.dumps(out, indent=1))
