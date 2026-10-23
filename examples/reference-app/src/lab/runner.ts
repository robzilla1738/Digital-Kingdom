/**
 * Isolated defense-lab runner (roadmap R07.2).
 *
 * Runs an authorized test against an OWNED sandbox target only: the target must be in an approved lab environment
 * and resolve to an allowlisted loopback/lab host. Every probe is a typed HTTP request from an allowlist of
 * methods; there is no shell. Budgets cap requests and wall time; an abort stops at once and still runs cleanup.
 * An independent effect observer (not the target's own response) decides whether a blocked probe had an effect,
 * and a permitted-operation positive control must succeed, otherwise the run is inconclusive: an unavailable
 * target is never counted as successful enforcement. Partial results and failed cleanup stay in the receipt.
 */
export interface Probe { name: string; method: "GET" | "POST" | "HEAD"; path: string; body?: unknown; headers?: Record<string, string>; expect: "blocked" | "allowed"; positive_control?: boolean }
export interface LabTest {
  test_id: string; control_id?: string;
  target: { url: string; environment: string };
  approved_environments: string[]; allowed_hosts: string[];
  probes: Probe[];
  budget: { max_requests: number; max_ms: number };
  observer: { name: string; snapshot(): Promise<number> | number; available(): Promise<boolean> | boolean };
  cleanup?: () => Promise<{ ok: boolean; detail: string }>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}
export interface ProbeResult { name: string; expect: Probe["expect"]; status: number | null; effect_observed: boolean | null; verdict: "as_expected" | "unexpected" | "inconclusive"; note: string }
export interface LabReceipt {
  schema: "dk.lab_receipt.v1"; test_id: string; control_id: string | null; outcome: "pass" | "fail" | "inconclusive" | "refused"; reasons: string[];
  probes: ProbeResult[]; requests_used: number; elapsed_ms: number; aborted: boolean;
  cleanup: { ran: boolean; ok: boolean | null; detail: string };
  conditions: string; observer: string; observer_available: boolean;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "[::1]"]);

export function refuseTarget(t: Pick<LabTest, "target" | "approved_environments" | "allowed_hosts">): string | null {
  if (!t.approved_environments.includes(t.target.environment)) return `environment ${t.target.environment} is not an approved lab environment`;
  if (/^(prod|production|live)$/i.test(t.target.environment)) return "production environments can never be lab targets";
  let u: URL; try { u = new URL(t.target.url); } catch { return "target url is invalid"; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "only http(s) targets are supported";
  if (!t.allowed_hosts.includes(u.hostname)) return `host ${u.hostname} is not an allowlisted lab host`;
  if (!LOOPBACK.has(u.hostname) && !/\.lab\.internal$/.test(u.hostname)) return `host ${u.hostname} is neither loopback nor a *.lab.internal sandbox`;
  return null;
}

export async function runLabTest(t: LabTest): Promise<LabReceipt> {
  const started = Date.now();
  const receipt: LabReceipt = { schema: "dk.lab_receipt.v1", test_id: t.test_id, control_id: t.control_id ?? null, outcome: "inconclusive", reasons: [], probes: [], requests_used: 0, elapsed_ms: 0, aborted: false, cleanup: { ran: false, ok: null, detail: "" }, conditions: "", observer: t.observer.name, observer_available: true };
  const refused = refuseTarget(t);
  if (refused) { receipt.outcome = "refused"; receipt.reasons.push(refused); receipt.conditions = `refused before any request: ${refused}`; return receipt; }
  for (const p of t.probes) if (!p.path.startsWith("/") || p.path.startsWith("//") || /^[a-z]+:/i.test(p.path)) { receipt.outcome = "refused"; receipt.reasons.push(`probe ${p.name} path must be relative to the target`); return receipt; }
  if (!t.probes.some((p) => p.positive_control && p.expect === "allowed")) { receipt.outcome = "refused"; receipt.reasons.push("a permitted-operation positive control is required"); return receipt; }
  const f = t.fetchImpl ?? fetch;
  const deadline = started + t.budget.max_ms;
  try {
    receipt.observer_available = await t.observer.available();
    for (const p of t.probes) {
      if (t.signal?.aborted) { receipt.aborted = true; receipt.reasons.push("aborted by operator"); break; }
      if (receipt.requests_used >= t.budget.max_requests) { receipt.reasons.push(`request budget ${t.budget.max_requests} reached`); break; }
      if (Date.now() > deadline) { receipt.reasons.push(`time budget ${t.budget.max_ms} ms reached`); break; }
      const before = await t.observer.snapshot();
      let status: number | null = null, note = "";
      receipt.requests_used++;
      try {
        const ctl = AbortSignal.any([AbortSignal.timeout(Math.max(1, deadline - Date.now())), ...(t.signal ? [t.signal] : [])]);
        const r = await f(new URL(p.path, t.target.url), { method: p.method, headers: { "content-type": "application/json", ...(p.headers ?? {}) }, ...(p.body !== undefined ? { body: JSON.stringify(p.body) } : {}), signal: ctl, redirect: "manual" });
        status = r.status; await r.arrayBuffer().catch(() => undefined);
      } catch (e) { note = `no response: ${(e as Error).name}`; if (t.signal?.aborted) receipt.aborted = true; }
      const after = await t.observer.snapshot();
      const effect = receipt.observer_available ? after > before : null;
      let verdict: ProbeResult["verdict"];
      if (status === null || status >= 500) { verdict = "inconclusive"; note ||= `HTTP ${status}: an availability failure is not enforcement`; }
      else if (effect === null) { verdict = "inconclusive"; note = "observer unavailable"; }
      else if (p.expect === "allowed") verdict = status < 400 && effect ? "as_expected" : "unexpected";
      else verdict = status >= 400 && !effect ? "as_expected" : "unexpected";
      if (verdict === "unexpected") note ||= p.expect === "blocked" ? `HTTP ${status}${effect ? ", effect observed downstream" : ""}` : `HTTP ${status}${effect ? "" : ", no effect observed"}`;
      receipt.probes.push({ name: p.name, expect: p.expect, status, effect_observed: effect, verdict, note });
      if (receipt.aborted) break;
    }
  } finally {
    if (t.cleanup) { receipt.cleanup.ran = true; try { const c = await t.cleanup(); receipt.cleanup.ok = c.ok; receipt.cleanup.detail = c.detail; } catch (e) { receipt.cleanup.ok = false; receipt.cleanup.detail = `cleanup threw: ${(e as Error).message.slice(0, 200)}`; } }
    receipt.elapsed_ms = Date.now() - started;
  }
  const pc = receipt.probes.filter((r) => t.probes.find((p) => p.name === r.name)?.positive_control);
  const complete = receipt.probes.length === t.probes.length && !receipt.aborted;
  if (!receipt.observer_available) receipt.reasons.push(`observer ${t.observer.name} was unavailable`);
  if (pc.some((r) => r.verdict !== "as_expected")) { receipt.outcome = "inconclusive"; receipt.reasons.push("the permitted-operation positive control did not succeed, so blocks cannot be credited to the control"); }
  else if (receipt.probes.some((r) => r.verdict === "unexpected")) receipt.outcome = "fail";
  else if (!complete || receipt.probes.some((r) => r.verdict === "inconclusive") || !receipt.observer_available) { receipt.outcome = "inconclusive"; if (!complete) receipt.reasons.push("partial run: not every probe executed"); }
  else receipt.outcome = "pass";
  if (receipt.cleanup.ok === false) receipt.reasons.push(`cleanup failed: ${receipt.cleanup.detail}`);
  receipt.conditions = `${receipt.probes.length}/${t.probes.length} probes (${t.probes.map((p) => `${p.name}:${p.expect}`).join(", ")}) against ${new URL(t.target.url).host} in ${t.target.environment}; observer ${t.observer.name}`;
  return receipt;
}

/** Body for POST /api/projects/:p/controls/:id/tests (R07.1). A refused run records nothing. */
export function toControlTest(r: LabReceipt): Record<string, unknown> | null {
  if (r.outcome === "refused") return null;
  return { outcome: r.outcome, observer: r.observer, observer_available: r.observer_available, conditions: `${r.conditions}${r.reasons.length ? `; ${r.reasons.join("; ")}` : ""}`.slice(0, 1000), evidence_refs: [`lab:${r.test_id}`] };
}
