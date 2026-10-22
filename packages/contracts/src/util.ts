/** Small deterministic helpers shared by every package (browser + node safe). */

/** FNV-1a 32-bit hash; deterministic, non-cryptographic. Used for layout ordering and stable ids only. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function stableId(prefix: string, ...parts: string[]): string {
  const joined = parts.join("\u241f");
  return `${prefix}-${fnv1a(joined).toString(36)}${fnv1a("salt:" + joined).toString(36)}`;
}

/** Canonical JSON (sorted keys) for digests and change detection. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

export function digest(value: unknown): string {
  const s = canonicalJson(value);
  return fnv1a(s).toString(16).padStart(8, "0") + fnv1a(s + "#2").toString(16).padStart(8, "0");
}

export function toMs(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`Invalid timestamp: ${iso}`);
  return t;
}

export function byTimeThenId<T extends { occurred_at: string; id: string }>(a: T, b: T): number {
  return toMs(a.occurred_at) - toMs(b.occurred_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
