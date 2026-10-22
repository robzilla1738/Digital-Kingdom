/**
 * Default data minimization. Applied before anything is stored. Removes credential-bearing keys,
 * masks token-shaped values, and normalizes raw URLs into route templates.
 */
const SECRET_KEY = /(authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key|session[-_]?id|credit|card[-_]?number|ssn)/i;
const TOKEN_VALUE = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // JWT
  /\b(sk|pk|rk|ghp|gho|xox[abpr]|AKIA)[A-Za-z0-9_-]{12,}\b/g, // common key prefixes
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b\d{13,19}\b/g, // card-like digit runs
];

export interface RedactionReport { removedKeys: string[]; maskedValues: number; truncated: boolean }

export function redactString(s: string, report?: RedactionReport): string {
  let out = s;
  for (const re of TOKEN_VALUE) out = out.replace(re, () => { if (report) report.maskedValues++; return "[redacted]"; });
  return out;
}

export function redactValue(value: unknown, report: RedactionReport = { removedKeys: [], maskedValues: 0, truncated: false }, depth = 0, path = ""): unknown {
  if (depth > 6) { report.truncated = true; return "[truncated: nesting limit]"; }
  if (typeof value === "string") return redactString(value.length > 2000 ? (report.truncated = true, value.slice(0, 2000) + "…") : value, report);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    if (value.length > 100) report.truncated = true;
    return value.slice(0, 100).map((v, i) => redactValue(v, report, depth + 1, `${path}[${i}]`));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 64) report.truncated = true;
    for (const [k, v] of entries.slice(0, 64)) {
      if (SECRET_KEY.test(k)) { report.removedKeys.push(path ? `${path}.${k}` : k); continue; }
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      out[k] = redactValue(v, report, depth + 1, path ? `${path}.${k}` : k);
    }
    return out;
  }
  return String(value);
}

/** "/orders/123/items?x=1" -> "/orders/:id/items". Query strings never stored. */
export function normalizeRoute(raw: string): string {
  let path = raw;
  try { if (/^https?:\/\//i.test(raw)) path = new URL(raw).pathname; } catch { /* keep raw */ }
  path = path.split("?")[0]!.split("#")[0]!;
  return path
    .split("/")
    .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) || /^[0-9a-f]{16,}$/i.test(seg) || /^[A-Za-z0-9_-]{24,}$/.test(seg) ? ":id" : seg))
    .join("/")
    .slice(0, 300);
}
