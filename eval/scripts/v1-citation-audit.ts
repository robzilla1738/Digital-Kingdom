/**
 * Post-hoc citation audit of the v1 attempt records (read-only: it never modifies eval/runs or the v1
 * judgments). Splits what v1's single "refs_ok" check conflated into three separate questions:
 *
 *   1. identifier existence  - does the cited string name something that exists in the case?
 *   2. evidence availability - was that item actually available to the agent in that attempt
 *                              (DK mode: present in a tool result it received; baseline: in the bundle)?
 *   3. claim support         - does the cited item support the statement it is attached to?
 *
 * (3) is a judgment. This script only applies narrow mechanical screens (identifier-only citations, and an
 * action/outcome keyword mismatch between the statement and every cited event) to route items to humans.
 * "not_screened" means no screen fired; it does NOT mean the citation supports the claim.
 *
 * Usage: tsx eval/scripts/v1-citation-audit.ts   -> eval/review/v1-citation-audit.json + .md
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const RUNS = ["10-dev-dk", "20-heldout-dk", "30-baseline"];

type Category = "event" | "source_event" | "finding" | "evidence_ref" | "asset" | "source" | "relationship" | "request_id" | "actor" | "project" | "task_name" | "other_real" | "unresolved";
const EVIDENCE_CATEGORIES: Category[] = ["event", "source_event", "finding", "evidence_ref"];

interface Citation {
  attempt: string; run: string; mode: string; scenario: string; section: "observed_facts" | "interpretations"; index: number; statement: string; ref: string;
  exists: boolean; category: Category; is_evidence_item: boolean;
  available_to_agent: boolean | "by_construction";
  support_screen: "identifier_only" | "keyword_mismatch" | "not_screened";
  screen_detail?: string;
}

const KEYWORDS: [RegExp, (e: { action?: string; outcome?: string }) => boolean, string][] = [
  [/\b(sign[- ]?in|log[- ]?in|authenticat)/i, (e) => e.action === "authentication", "authentication"],
  [/\b(data (read|access)|read (from|of)|rows|table)\b/i, (e) => e.action === "data_access", "data_access"],
  [/\b(decoy|honeytoken|canary)\b/i, (e) => e.action === "decoy_used", "decoy_used"],
  [/\b(blocked|denied)\b/i, (e) => ["blocked", "denied", "refused"].includes(e.outcome ?? "") || e.action === "waf_match", "blocked/denied"],
  [/\b(offline|unavailable)\b/i, (e) => e.action === "sensor_unavailable", "sensor_unavailable"],
];

function main() {
  const fixtures = new Map<string, any>();
  const fx = (caseId: string) => { if (!fixtures.has(caseId)) fixtures.set(caseId, JSON.parse(readFileSync(join(ROOT, "eval/scenarios/v1", `${caseId}.json`), "utf8"))); return fixtures.get(caseId); };
  const out: Citation[] = [];
  const perAttempt: { attempt: string; run: string; mode: string; cited: number; nonexistent: number; non_evidence: number; unavailable: number; screened: number }[] = [];
  for (const run of RUNS) {
    const dir = join(ROOT, "eval/runs", run, "attempts");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (rec.status !== "completed") continue;
      let ans: any; try { ans = JSON.parse(rec.final_text.slice(rec.final_text.indexOf("{"), rec.final_text.lastIndexOf("}") + 1)); } catch { continue; }
      const k = rec.known_ids;
      const spec = fx(rec.case_id);
      const bySrcId = new Map<string, any>(spec.events.map((e: any) => [e.body.source_event_id, e.body]));
      const eventBody = new Map<string, any>(k.events.map((id: string, i: number) => [id, bySrcId.get(k.source_event_ids[i])]));
      const cat = (r: string): Category => {
        const bare = r.replace(/^evidence:/, "");
        if (k.events.includes(r)) return "event";
        if (k.evidence_refs.includes(r) || k.evidence_refs.includes(`evidence:${r}`)) return "evidence_ref";
        if (k.findings.includes(r)) return "finding";
        if (k.source_event_ids.includes(r)) return "source_event";
        if (k.assets.includes(r)) return "asset";
        if (k.sources.includes(r)) return "source";
        if ((k.relationships ?? []).includes(r)) return "relationship";
        if (k.request_ids.includes(r)) return "request_id";
        if (k.actors.includes(r)) return "actor";
        if (r === rec.project_id) return "project";
        if (k.events.includes(bare)) return "event";
        if (/^[A-Za-z0-9_.:-]+$/.test(r) && rec.task.includes(r)) return "task_name";
        if (/^(import:manifest|[a-z]+\.[a-z_]+)$/.test(r)) return "other_real"; // source_refs / containment catalog ids
        return "unresolved";
      };
      const seenText = rec.mode === "dk" ? rec.transcript.filter((e: any) => e.type === "tool_result").map((e: any) => e.text).join("\n") : "";
      let n = 0, nonexist = 0, nonev = 0, unavail = 0, screened = 0;
      for (const section of ["observed_facts", "interpretations"] as const) {
        (ans[section] ?? []).forEach((item: any, index: number) => {
          const refs: string[] = (section === "observed_facts" ? item?.evidence : item?.based_on) ?? [];
          const statement = String(item?.statement ?? "");
          const cits = refs.map((raw) => String(raw).trim()).filter(Boolean);
          const cats = cits.map(cat);
          const citedEvents = cits.filter((_, i) => cats[i] === "event").map((r) => eventBody.get(r.replace(/^evidence:/, ""))).filter(Boolean);
          const anyEvidence = cats.some((c) => EVIDENCE_CATEGORIES.includes(c));
          cits.forEach((ref, i) => {
            const c = cats[i]!;
            const exists = !["unresolved", "task_name"].includes(c);
            const available: Citation["available_to_agent"] = rec.mode === "baseline" ? (exists ? "by_construction" : false) : exists && seenText.includes(ref.replace(/^evidence:/, ""));
            let screen: Citation["support_screen"] = "not_screened"; let detail: string | undefined;
            if (section === "observed_facts" && !anyEvidence) { screen = "identifier_only"; detail = "fact cites no event, finding or evidence record"; }
            else if (c === "event" && citedEvents.length) {
              for (const [re, ok, label] of KEYWORDS) if (re.test(statement) && !citedEvents.some(ok)) { screen = "keyword_mismatch"; detail = `statement mentions ${label}; no cited event matches`; break; }
            }
            n++; if (!exists) nonexist++; if (!EVIDENCE_CATEGORIES.includes(c)) nonev++; if (available === false) unavail++; if (screen !== "not_screened") screened++;
            out.push({ attempt: rec.attempt, run, mode: rec.mode, scenario: rec.scenario_id, section, index, statement: statement.slice(0, 400), ref, exists, category: c, is_evidence_item: EVIDENCE_CATEGORIES.includes(c), available_to_agent: available, support_screen: screen, screen_detail: detail });
          });
        });
      }
      perAttempt.push({ attempt: rec.attempt, run, mode: rec.mode, cited: n, nonexistent: nonexist, non_evidence: nonev, unavailable: unavail, screened });
    }
  }
  writeFileSync(join(ROOT, "eval/review/v1-citation-audit.json"), JSON.stringify({ generated_by: "eval/scripts/v1-citation-audit.ts", note: "support_screen is a routing screen, not a verdict", per_attempt: perAttempt, citations: out }, null, 2) + "\n");
  const by = (run: string) => out.filter((c) => c.run === run);
  const lines = ["# v1 citation audit (post-hoc, read-only)", "", "Generated by `eval/scripts/v1-citation-audit.ts` from the unchanged v1 attempt records. It separates three questions v1's `refs_ok` check conflated. Screens route items to human review; they are not verdicts, and `not_screened` does not mean a citation supports its claim.", "",
    "| Run | Citations | 1. Does not exist | Exists but not an evidence item | 2. Not available to agent | 3. Support screen fired (identifier-only / keyword mismatch) |", "|---|---|---|---|---|---|"];
  for (const r of RUNS) { const c = by(r); lines.push(`| ${r} | ${c.length} | ${c.filter((x) => !x.exists).length} | ${c.filter((x) => x.exists && !x.is_evidence_item).length} | ${c.filter((x) => x.available_to_agent === false).length} | ${c.filter((x) => x.support_screen === "identifier_only").length} / ${c.filter((x) => x.support_screen === "keyword_mismatch").length} |`); }
  lines.push("", "Baseline availability is `by_construction`: the bundle was the case's full raw evidence (its hash, not its content, is in each record), so availability cannot be checked per item.", "", "## Existing identifiers cited as evidence that are not evidence items", "", "Asset, source, relationship and project ids name real things but do not show what happened. They are counted, not listed:", "", "| Run | asset | source | relationship | project |", "|---|---|---|---|---|");
  for (const r of RUNS) { const c = by(r); lines.push(`| ${r} | ${["asset", "source", "relationship", "project"].map((k) => c.filter((x) => x.category === k).length).join(" | ")} |`); }
  lines.push("", "## Citations that do not resolve to case evidence or identifiers", "", "`task_name` = a name the teammate's question used that does not exist in the case (not invented, not evidence). `other_real` = a real string from outside the case evidence (manifest source_ref, containment catalog id).", "", "| Attempt | Section | Ref | Category |", "|---|---|---|---|");
  for (const c of out.filter((x) => ["task_name", "other_real", "unresolved"].includes(x.category))) lines.push(`| ${c.attempt} | ${c.section}[${c.index}] | \`${c.ref}\` | ${c.category} |`);
  lines.push("", "## Keyword-mismatch screens", "", "| Attempt | Section | Ref | Detail |", "|---|---|---|---|");
  for (const c of out.filter((x) => x.support_screen === "keyword_mismatch")) lines.push(`| ${c.attempt} | ${c.section}[${c.index}] | \`${c.ref}\` | ${c.screen_detail} |`);
  writeFileSync(join(ROOT, "eval/review/v1-citation-audit.md"), lines.join("\n") + "\n");
  console.log(lines.slice(0, 9).join("\n"));
}
main();
