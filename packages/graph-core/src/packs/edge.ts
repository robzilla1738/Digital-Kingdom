/**
 * R09.1 edge, DNS, browser, API and webhook pack (fixture-validated; live provider feeds need authorized access).
 *
 * - Certificates and DNS produce LEADS. A hostname is owned only after an ownership proof the operator controls
 *   (a DNS TXT challenge value or an explicit declaration); appearing on a certificate proves nothing.
 * - Alternate-origin validation is planned only for targets on the operator's authorization list; this module
 *   never sends a request itself.
 * - Routes are keyed by method, path template, service and environment.
 * - Frontend and webhook observations always carry their blind spots.
 */
export type OwnershipState = "discovered_lead" | "declared" | "verified_owned";
export interface CertRecord { serial: string; sans: string[]; issuer: string; not_after: string; seen_on_ip?: string }
export interface OwnershipProof { hostname: string; method: "dns_txt" | "declaration"; expected_token?: string; observed_txt?: string[]; declared_by?: string }

export function hostnameInventory(certs: CertRecord[], proofs: OwnershipProof[]) {
  const hosts = new Map<string, { hostname: string; state: OwnershipState; evidence: string[]; wildcard: boolean }>();
  for (const c of certs) for (const san of c.sans) {
    const h = san.toLowerCase();
    const cur = hosts.get(h) ?? { hostname: h, state: "discovered_lead" as OwnershipState, evidence: [], wildcard: h.startsWith("*.") };
    cur.evidence.push(`certificate ${c.serial} (${c.issuer})`);
    hosts.set(h, cur);
  }
  for (const p of proofs) {
    const h = p.hostname.toLowerCase();
    const cur = hosts.get(h) ?? { hostname: h, state: "discovered_lead" as OwnershipState, evidence: [], wildcard: h.startsWith("*.") };
    if (p.method === "dns_txt" && p.expected_token && (p.observed_txt ?? []).includes(p.expected_token)) { cur.state = "verified_owned"; cur.evidence.push("DNS TXT ownership challenge matched"); }
    else if (p.method === "declaration" && p.declared_by && cur.state !== "verified_owned") { cur.state = "declared"; cur.evidence.push(`declared by ${p.declared_by}`); }
    else cur.evidence.push(`ownership proof via ${p.method} did not match`);
    hosts.set(h, cur);
  }
  return [...hosts.values()].sort((a, b) => a.hostname.localeCompare(b.hostname)).map((x) => ({ ...x, note: x.state === "discovered_lead" ? "seen on a certificate or DNS only: not assumed owned, not monitored" : x.state === "declared" ? "declared by an operator, not proven" : "ownership proven by a challenge the operator controls" }));
}

export interface OriginCheckRequest { hostname: string; candidate_origin: string }
/** Plan alternate-origin validation. Unauthorized targets are refused; nothing is sent from here. */
export function planOriginValidation(reqs: OriginCheckRequest[], authorized: { origins: string[]; authorized_by: string; expires_at: string }, now: Date) {
  const valid = Date.parse(authorized.expires_at) > now.getTime();
  return reqs.map((r) => {
    if (!valid) return { ...r, decision: "refused" as const, reason: "the authorization has expired" };
    if (!authorized.origins.includes(r.candidate_origin)) return { ...r, decision: "refused" as const, reason: "origin is not on the authorization list; no request will be sent" };
    return { ...r, decision: "planned" as const, reason: `authorized by ${authorized.authorized_by} until ${authorized.expires_at}`, probe: { method: "GET", path: "/", host_header: r.hostname, max_requests: 1 } };
  });
}

export interface OpenApiDoc { openapi: string; info?: { title?: string }; paths: Record<string, Record<string, { operationId?: string; security?: unknown[] }>> }
const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
/** Routes scoped by method, path template, service and environment. Unauthenticated operations are flagged. */
export function routesFromOpenApi(doc: OpenApiDoc, service: string, environment: string, globalSecurity = false) {
  if (!/^3\.[01]\./.test(String(doc.openapi))) throw new Error(`OpenAPI ${String(doc.openapi)} is not supported (3.0.x and 3.1.x only)`);
  const out: { key: string; method: string; path: string; service: string; environment: string; operation_id: string | null; auth_declared: boolean }[] = [];
  for (const [path, ops] of Object.entries(doc.paths ?? {})) for (const [m, op] of Object.entries(ops ?? {})) {
    if (!METHODS.includes(m)) continue;
    const method = m.toUpperCase();
    const auth = op.security ? op.security.length > 0 : globalSecurity;
    out.push({ key: `${environment}/${service}/${method} ${path}`, method, path, service, environment, operation_id: op.operationId ?? null, auth_declared: auth });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export interface FrontendObservation { page: string; scripts: { src: string; integrity?: string }[]; csp?: string | null }
export function frontendAssessment(o: FrontendObservation) {
  const thirdParty = o.scripts.filter((s) => /^https?:\/\//.test(s.src));
  return {
    page: o.page,
    dependencies: o.scripts.map((s) => ({ src: s.src, pinned: !!s.integrity })),
    unpinned_third_party: thirdParty.filter((s) => !s.integrity).map((s) => s.src),
    csp_declared: !!o.csp,
    blind_spots: ["scripts injected at runtime or by extensions are not in static metadata", "what code actually ran in a visitor's browser is not observed", ...(o.csp ? [] : ["no content security policy: script origins are unconstrained"])],
  };
}

export interface WebhookConfig { endpoint: string; provider: string; signature?: { algorithm: string; secret_ref: string } | null; replay_window_seconds?: number | null; idempotency_key_header?: string | null }
export function webhookAssessment(w: WebhookConfig) {
  const gaps: string[] = [];
  if (!w.signature) gaps.push("no signature verification declared: anyone who knows the URL can post");
  if (!w.replay_window_seconds) gaps.push("no replay window declared: a captured delivery can be resent");
  if (!w.idempotency_key_header) gaps.push("no idempotency key: retries may be processed twice");
  return { endpoint: w.endpoint, provider: w.provider, authorization: w.signature ? `signed (${w.signature.algorithm})` : "unsigned", replay_protection: w.replay_window_seconds ? `${w.replay_window_seconds}s window` : "none declared", gaps, blind_spots: ["declared configuration only: whether the handler enforces it is not observed", "deliveries the provider never sent (or dropped) are invisible here"] };
}
