/**
 * LP26 — the sealed report. Objective metrics per block x condition with their own denominators; AI semantic critique
 * in a separate section with its own denominator (advisory); human review deferred. Every started attempt is counted:
 * invalid preflights are reported separately and excluded from model denominators; errors, timeouts, limits and schema
 * failures stay in the denominators. Nothing is inferred by subtracting failures.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = (dir: string): Rec[] => existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{3}\.json$/.test(f)).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8"))) : [];

export function aggregate(rows: Rec[]) {
  const statuses: Record<string, number> = {};
  for (const r of rows) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  const valid = rows.filter((r) => r.status !== "invalid_preflight");
  const graded = valid.filter((r) => r.metrics);
  const sum = (f: (r: Rec) => number) => graded.reduce((n, r) => n + f(r), 0);
  // predicates of attempts that never produced metrics (provider error before grading) still count: eligible from the key
  const eligibleMissing = valid.filter((r) => !r.metrics && r.key).reduce((n, r) => n + r.key.ops.length * 3, 0);
  const field = (k: string) => ({ passed: sum((r) => r.metrics.structured.by_field[k].passed), eligible: sum((r) => r.metrics.structured.by_field[k].eligible) });
  return {
    started: rows.length, invalid_preflight: rows.length - valid.length, valid_started: valid.length, statuses,
    end_to_end_success: { successful: valid.filter((r) => r.metrics?.end_to_end_success).length, denominator: valid.length },
    structured: { passed: sum((r) => r.metrics.structured.passed), eligible: sum((r) => r.metrics.structured.eligible) + eligibleMissing, by_field: { outcome: field("outcome"), independent_effect: field("independent_effect"), boundary_violation: field("boundary_violation") } },
    retrieval: { exposed: sum((r) => r.metrics.retrieval.exposed), reachable: sum((r) => r.metrics.retrieval.reachable), full_record: sum((r) => r.metrics.retrieval.full_record), packet_only: sum((r) => r.metrics.retrieval.packet_only) },
    claim_validity: { valid: sum((r) => r.metrics.claim_validity.valid), submitted: sum((r) => r.metrics.claim_validity.submitted), nonexistent: sum((r) => r.metrics.claim_validity.nonexistent), not_exposed: sum((r) => r.metrics.claim_validity.not_exposed) },
    operations: { graded: sum((r) => r.metrics.operations.graded), missed: sum((r) => r.metrics.operations.missed.length), extraneous: sum((r) => r.metrics.operations.extraneous.length) },
    unsupported_affirmatives: sum((r) => r.metrics.unsupported_affirmatives),
    underclaims: sum((r) => r.metrics.underclaims ?? 0),
    coverage_limitations: { not_visible_ops: sum((r) => r.metrics.coverage_limitations.not_visible_ops), unknown_admissible_predicates: sum((r) => r.metrics.coverage_limitations.unknown_admissible_predicates) },
    denials: sum((r) => (r.denials ?? []).length), leak_hits: sum((r) => r.leakage?.hits ?? 0),
    effort: { tool_calls: sum((r) => r.metrics.tool_calls), model_calls: graded.reduce((n, r) => n + (r.model?.usage?.model_calls ?? 0), 0), prompt_tokens: graded.reduce((n, r) => n + (r.model?.usage?.prompt_tokens ?? 0), 0), completion_tokens: graded.reduce((n, r) => n + (r.model?.usage?.completion_tokens ?? 0), 0), response_bytes: sum((r) => r.metrics.response_bytes), guided_planner_units: valid.reduce((n, r) => n + (r.condition === "C3" ? r.environment?.guided_system_work?.units ?? 0 : 0), 0) },
    cost_usd: rows.reduce((n, r) => n + (r.cost?.charged_usd ?? 0), 0),
  };
}

export function buildReport(out: string, reg: Rec, ledgerFile = join(out, "model-spend-ledger.json")) {
  const model = load(join(out, "runs", "approved_provider")), scripted = load(join(out, "runs", "scripted"));
  const groups = (rows: Rec[]) => Object.fromEntries(["dev", "heldout"].flatMap((b) => ["C1", "C2", "C3"].map((c) => [`${b}/${c}`, aggregate(rows.filter((r) => r.split === b && r.condition === c))])));
  const critiques = existsSync(join(out, "critique")) ? readdirSync(join(out, "critique")).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(out, "critique", f), "utf8"))) : [];
  const crit = Object.fromEntries(["dev", "heldout"].flatMap((b) => ["C1", "C2", "C3"].map((c) => {
    const rows = critiques.filter((x) => x.split === b && x.condition === c);
    const vals = rows.flatMap((x) => (x.critique?.operations ?? []).flatMap((o: Rec) => [o.outcome, o.independent_effect, o.boundary_violation]));
    return [`${b}/${c}`, { label: "ai_reviewed_advisory", critiqued_attempts: rows.length, errors: rows.filter((x) => x.error).length, judgments: vals.length, supported: vals.filter((v) => v === "supported").length, unsupported: vals.filter((v) => v === "unsupported").length, unclear: vals.filter((v) => v === "unclear").length }];
  })));
  // EXPLORATORY (not preregistered): where do failed predicates come from?
  const explore = Object.fromEntries(["dev", "heldout"].flatMap((b) => ["C1", "C2", "C3"].map((c) => {
    const rows = model.filter((r) => r.split === b && r.condition === c && r.metrics);
    const fails = rows.flatMap((r) => r.metrics.failures.map((f: Rec) => ({ ...f, sawUnavailable: (r.trace?.entries ?? []).some((e: Rec) => e.kind === "tool_call" && /"status":"unavailable"/.test(e.response)) })));
    const by = (pred: (f: Rec) => boolean) => fails.filter(pred).length;
    return [`${b}/${c}`, { failed_predicates: fails.length, by_field: { outcome: by((f) => f.field === "outcome"), independent_effect: by((f) => f.field === "independent_effect"), boundary_violation: by((f) => f.field === "boundary_violation") }, answered_unknown: by((f) => f.answered === "unknown"), answered_unknown_after_seeing_unavailable_coverage: by((f) => f.answered === "unknown" && f.sawUnavailable), wrong_affirmative: by((f) => f.answered !== null && f.answered !== "unknown"), missing_operation: by((f) => f.answered === null) }];
  })));
  const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, "utf8")) : null;
  const runSpend = ledger ? ledger.entries.filter((e: Rec) => e.run === reg.id).reduce((n: number, e: Rec) => n + e.charged_usd, 0) : 0;
  const followed = reg.follows ? (() => { const dir = join(out, "..", String(reg.follows.dir ?? "m6-eval").split("/").pop()!); const f = join(dir, "report.json"); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; })() : null;
  const planned = reg.order.length;
  const incident = existsSync(join(out, "incident-records-lost.json")) ? JSON.parse(readFileSync(join(out, "incident-records-lost.json"), "utf8")) : null;
  const amendments = readdirSync(out).filter((f) => /^preregistration-amendment-\d+\.json$/.test(f)).sort().map((f) => JSON.parse(readFileSync(join(out, f), "utf8")));
  const report = {
    schema: "dk.local.eval_report.v1", preregistration: reg.id, model: reg.model.id, planned_slots_per_mode: planned,
    model_runs: { started: model.length, by_block_condition: groups(model) },
    scripted_runs: { label: "scripted (no model): protocol baseline, not model skill", started: scripted.length, by_block_condition: groups(scripted) },
    ai_semantic_critique: { label: "ai_reviewed_advisory: same model family, separate conversation, no tools, no truth; never an objective score or an approval", by_block_condition: crit },
    human_review: "deferred (EXT05); no record is approved",
    incident: incident ? { file: "incident-records-lost.json", kind: incident.kind, surviving_model_records: incident.surviving_model_records, planned_slots: incident.planned_slots, missing_model_slots: incident.missing_model_slots.length, missing_by_block_condition: Object.fromEntries(["dev", "heldout"].flatMap((b) => ["C1", "C2", "C3"].map((c) => [`${b}/${c}`, incident.missing_model_slots.filter((m: Rec) => m.block === b && m.condition === c).length]))), not_re_attempted: incident.not_re_attempted, reported_by_previous_session_unverifiable: incident.reported_by_previous_session_unverifiable, spend_estimate: incident.spend_estimate, critique: incident.critique } : null,
    exploratory_failure_breakdown: { label: "exploratory, not preregistered: failed predicates by field and answer kind; 'after seeing unavailable coverage' = the attempt's tool results contained a coverage state/obligation with status unavailable", by_block_condition: explore },
    amendments: amendments.map((a) => ({ id: a.id, created_at: a.created_at, slots_recorded_at_amendment: a.slots_recorded_at_amendment, limits: a.limits, reason: a.reason })),
    follows: reg.follows ?? null, changes_from_followed: reg.changes_from_followed ?? null,
    followed_run_model_by_block_condition: followed ? followed.model_runs.by_block_condition : null,
    spend: ledger ? { ledger: ledgerFile.split("/").slice(-3).join("/"), this_run_usd: runSpend, charged_total_usd: ledger.charged_total_usd, entries: ledger.entries.length, allowance_usd: ledger.allowance_usd, phase_cap_usd: ledger.phase_cap_usd } : null,
    limitations: [
      "Synthetic local laboratory only (three blueprints, trusted built-in services); no production, provider or real-identity claim.",
      "Dev documents are repository-resident; held-out documents were private until seal. The model had MCP tools only (restricted_model), but the operator who wrote the generator, referee and tasks also wrote the product: not an operator-blinded study.",
      "Repetitions are not independent cases; small counts; no significance test and no pooled superiority claim.",
      "Exposure means the record reached the model, not that it was attended to; packet records count as exposure only when their digest equals the stored record.",
      "The referee's admissibility rules are this phase's specification (observer attachment + schedule faults); a silently dropped observer record admits not_observed or unknown.",
      "AI critique is advisory and from the same model family; human review is deferred.",
      ...(incident ? [`Records lost: ${incident.missing_model_slots.length} of ${incident.planned_slots} preregistered model slots have no surviving record (sandbox reset); they are missing, outside every denominator, and were not re-run. Held-out model counts cover only the surviving slots.`] : []),
    ],
  };
  const pct = (a: number, b: number) => b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : "0/0";
  const row = (k: string, g: Rec) => `| ${k} | ${g.started} | ${g.invalid_preflight} | ${pct(g.end_to_end_success.successful, g.end_to_end_success.denominator)} | ${pct(g.structured.passed, g.structured.eligible)} | ${pct(g.retrieval.exposed, g.retrieval.reachable)} | ${pct(g.claim_validity.valid, g.claim_validity.submitted)} | ${g.unsupported_affirmatives} | ${g.underclaims} | ${g.operations.missed} | ${Object.entries(g.statuses).map(([s, n]) => `${s}:${n}`).join(" ")} | ${g.effort.tool_calls} | $${g.cost_usd.toFixed(4)} |`;
  const table = (gs: Rec) => `| block/condition | started | invalid preflight | end-to-end | structured predicates | retrieval (required exposed/reachable) | claim validity | unsupported affirmatives | underclaims (unknown where established) | missed ops | statuses | tool calls | cost |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|\n${Object.entries(gs).map(([k, g]) => row(k, g as Rec)).join("\n")}`;
  const md = `# Local Intelligence M6 evaluation (LP26) — ${reg.id}

Model ${reg.model.id} via the AI Gateway (restricted_model: MCP tools only). Conditions: C1 ${reg.conditions[0].label}; C2 ${reg.conditions[1].label}; C3 ${reg.conditions[2].label}.
${reg.budget?.allowance_usd ? `Preregistered ${planned} slots per mode on NEWLY generated held-out documents only (${reg.heldout_documents.length} documents, fresh master seed, never seen by any run; ${reg.repetitions} repetition(s), fresh world and conversation per attempt). Spend: this run $${runSpend.toFixed(6)} of its $${reg.budget.allowance_usd} allowance; phase total $${(Number(reg.budget.prior_phase_spend_usd) + (ledger?.charged_total_usd ?? 0)).toFixed(6)} of the $3.00 phase cap (prior $${reg.budget.prior_phase_spend_usd}).` : `Preregistered ${planned} slots per mode (dev + held-out, ${reg.repetitions} repetition(s), fresh world and conversation per attempt). Spend: this run $${runSpend.toFixed(4)}; M6 ledger total $${(ledger?.charged_total_usd ?? 0).toFixed(4)} of the $${ledger?.allowance_usd ?? 2} M6 allowance.`}
${reg.follows ? `\nFollows ${reg.follows.preregistration} (records unchanged). ${reg.follows.why}\n\nChanges from the followed run: ${(reg.changes_from_followed as string[]).join("; ")}.\n` : ""}

${incident ? `> **Incident: records lost.** ${incident.summary} ${incident.missing_model_slots.length} of ${incident.planned_slots} model slots have no record and are excluded from every denominator (not re-run; never counted as failures or successes). Missing by block/condition: ${["dev", "heldout"].flatMap((b) => ["C1", "C2", "C3"].map((c) => `${b}/${c} ${incident.missing_model_slots.filter((m: Rec) => m.block === b && m.condition === c).length}`)).join(", ")}. Spend for the lost work is charged as a conservative estimate (attempts $${incident.spend_estimate.attempt_estimate_usd.toFixed(4)}, critique bound $${incident.spend_estimate.critique_estimate_usd.toFixed(4)}). The previous session reported e2e ${Object.entries(incident.reported_by_previous_session_unverifiable.e2e).map(([k, v]) => `${k} ${v}`).join(", ")}; those records do not exist and the figures are not data of this report. AI critique: ${incident.critique}.\n\n` : ""}${amendments.length ? `Preregistration amendments (made before any comparison slot ran): ${amendments.map((a) => `${a.id} — ${JSON.stringify(a.limits)}: ${a.reason}`).join(" ")}\n\n` : ""}## Model runs — objective metrics (deterministic referee)

${table(report.model_runs.by_block_condition)}

${followed ? `## Side by side with ${reg.follows.preregistration} (v1, surviving records only)\n\n| block/condition | v1 end-to-end | v1 predicates | this run end-to-end | this run predicates |\n|---|---:|---:|---:|---:|\n${Object.keys(report.model_runs.by_block_condition).map((k) => { const a = followed.model_runs.by_block_condition[k], b = (report.model_runs.by_block_condition as Rec)[k]; return `| ${k} | ${pct(a.end_to_end_success.successful, a.end_to_end_success.denominator)} | ${pct(a.structured.passed, a.structured.eligible)} | ${pct(b.end_to_end_success.successful, b.end_to_end_success.denominator)} | ${pct(b.structured.passed, b.structured.eligible)} |`; }).join("\n")}\n\n${followed.incident ? `v1 counts cover only its surviving records (${followed.incident.surviving_model_records} of ${followed.incident.planned_slots} slots; see its records-lost incident). ` : ""}This run's held-out documents are the same documents, revealed at the v1 seal (burned, not fresh).\n\n` : ""}## Scripted runs (no model; protocol baseline)

${table(report.scripted_runs.by_block_condition)}

## AI semantic critique (ai_reviewed_advisory — separate denominator, not a score)

| block/condition | critiqued attempts | judgments | supported | unsupported | unclear | errors |
|---|---:|---:|---:|---:|---:|---:|
${Object.entries(crit).map(([k, c]) => `| ${k} | ${(c as Rec).critiqued_attempts} | ${(c as Rec).judgments} | ${(c as Rec).supported} | ${(c as Rec).unsupported} | ${(c as Rec).unclear} | ${(c as Rec).errors} |`).join("\n")}

Human review: deferred (EXT05). No record is approved.

## Exploratory failure breakdown (not preregistered)

| block/condition | failed predicates | outcome | independent_effect | boundary | answered unknown | ...after seeing unavailable coverage | wrong affirmative | missing op |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${Object.entries(explore).map(([k, e]) => `| ${k} | ${(e as Rec).failed_predicates} | ${(e as Rec).by_field.outcome} | ${(e as Rec).by_field.independent_effect} | ${(e as Rec).by_field.boundary_violation} | ${(e as Rec).answered_unknown} | ${(e as Rec).answered_unknown_after_seeing_unavailable_coverage} | ${(e as Rec).wrong_affirmative} | ${(e as Rec).missing_operation} |`).join("\n")}

## Limitations

${report.limitations.map((l) => `- ${l}`).join("\n")}
`;
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(out, "REPORT.md"), md);
  const g = report.model_runs.by_block_condition as Rec;
  return { report, headline: Object.fromEntries(Object.entries(g).map(([k, v]) => [k, `${v.end_to_end_success.successful}/${v.end_to_end_success.denominator} e2e, ${v.structured.passed}/${v.structured.eligible} predicates`])) };
}
