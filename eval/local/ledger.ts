/**
 * LP26-A4 — the NEW model-spend ledger for the Local Intelligence Phase. It never reads or inherits the historical
 * v2 ledger (`artifacts/completion/evaluation/budget.json`, $5 cap) or its approval. It persists every reservation
 * outcome (charged amount, gateway-reported cost, tokens) so spend survives process restarts, and it refuses any
 * request whose worst-case cost would exceed the remaining allowance (pre-reservation, via BudgetLedger).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BudgetLedger } from "../src/budget.ts";

export const LEDGER_SCHEMA = "dk.local.model_spend_ledger.v1";
export const HISTORICAL_LEDGERS = ["artifacts/completion/evaluation/budget.json"];
export interface LedgerEntry { id: string; run: string; kind: "smoke" | "attempt" | "critique" | "unrecorded_estimate"; reserved_max_usd: number; charged_usd: number; gateway_cost_usd: number | null; prompt_tokens: number; completion_tokens: number; model_calls: number; at: string; note?: string }
export interface LedgerFile { schema: typeof LEDGER_SCHEMA; phase: "local-intelligence"; phase_cap_usd: number; allowance_usd: number; allowance_note: string; route: string; model: string; entries: LedgerEntry[]; charged_total_usd: number; updated_at: string }

export class PhaseLedger {
  readonly file: LedgerFile; readonly budget: BudgetLedger;
  constructor(readonly path: string, init: { phase_cap_usd: number; allowance_usd: number; allowance_note: string; route: string; model: string }) {
    if (HISTORICAL_LEDGERS.some((h) => resolve(h) === resolve(path))) throw new Error("the historical v2 ledger is not reused for this phase");
    if (!(init.allowance_usd > 0 && init.allowance_usd <= init.phase_cap_usd)) throw new Error("allowance must be positive and within the phase cap");
    this.file = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { schema: LEDGER_SCHEMA, phase: "local-intelligence", ...init, entries: [], charged_total_usd: 0, updated_at: new Date().toISOString() };
    if (this.file.schema !== LEDGER_SCHEMA) throw new Error("not a local-intelligence ledger");
    if (this.file.allowance_usd !== init.allowance_usd || this.file.model !== init.model || this.file.route !== init.route) throw new Error("ledger route/model/allowance changed; start a new ledger with a new approval instead");
    this.budget = new BudgetLedger(this.file.allowance_usd, 1);
    const prior = this.file.entries.reduce((n, e) => n + e.charged_usd, 0);
    if (prior > 0) { if (!this.budget.reserve("prior", prior)) throw new Error("prior charges exceed the allowance"); this.budget.settle("prior", prior); }
  }
  get remaining() { return this.file.allowance_usd - this.budget.incurred - this.budget.outstanding; }
  record(e: Omit<LedgerEntry, "at">) {
    this.file.entries.push({ ...e, at: new Date().toISOString() });
    this.file.charged_total_usd = this.file.entries.reduce((n, x) => n + x.charged_usd, 0);
    this.file.updated_at = new Date().toISOString();
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.file, null, 2));
  }
}
