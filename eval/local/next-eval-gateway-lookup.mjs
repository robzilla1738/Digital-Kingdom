// Look up every generation id in the run records on the AI Gateway (/v1/generation) and compare server-side total_cost
// with the cost the runner recorded. Writes only ids, costs and model names (never a credential).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2], outFile = process.argv[3];
const rd = join(dir, "runs", "approved_provider");
const gens = [];
for (const f of readdirSync(rd).filter((x) => /^\d{3}\.json$/.test(x)).sort()) {
  const r = JSON.parse(readFileSync(join(rd, f), "utf8"));
  for (const t of r.model?.turns ?? []) if (t.generation_id) gens.push({ slot: r.slot.index, condition: r.condition, id: t.generation_id, recorded_cost: t.usage?.cost ?? null });
}
const rows = [];
for (let i = 0; i < gens.length; i += 6) {
  const batch = await Promise.all(gens.slice(i, i + 6).map(async (g) => {
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(`https://ai-gateway.vercel.sh/v1/generation?id=${g.id}`, { headers: { Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}` } });
        if (r.ok) { const d = (await r.json()).data; return { ...g, gateway_total_cost: d.total_cost, gateway_model: d.model, is_byok: d.is_byok }; }
        if (a === 2) return { ...g, lookup_error: `HTTP ${r.status}` };
      } catch (e) { if (a === 2) return { ...g, lookup_error: String(e.message).slice(0, 80) }; }
      await new Promise((s) => setTimeout(s, 500));
    }
  }));
  rows.push(...batch);
}
const ok = rows.filter((r) => typeof r.gateway_total_cost === "number");
const sum = (xs, k) => Math.round(xs.reduce((n, x) => n + (x[k] ?? 0), 0) * 1e9) / 1e9;
const summary = { generations: rows.length, looked_up: ok.length, lookup_errors: rows.length - ok.length, gateway_total_cost_usd: sum(ok, "gateway_total_cost"), recorded_cost_usd: sum(rows, "recorded_cost"), mismatches: ok.filter((r) => Math.abs(r.gateway_total_cost - (r.recorded_cost ?? 0)) > 1e-9).map((r) => r.id), models: [...new Set(ok.map((r) => r.gateway_model))] };
writeFileSync(outFile, JSON.stringify({ schema: "dk.local.gateway_generation_lookup.v1", looked_up_at: new Date().toISOString(), endpoint: "GET https://ai-gateway.vercel.sh/v1/generation?id=<generation_id>", summary, rows }, null, 1));
console.log(JSON.stringify(summary));
