import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const hmac = (key: string, s: string) => createHmac("sha256", key).update(s).digest("hex");
export const newToken = (prefix: string) => `${prefix}_${randomBytes(24).toString("base64url")}`;
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export type Role = "viewer" | "analyst" | "admin";
const RANK: Record<Role, number> = { viewer: 1, analyst: 2, admin: 3 };
export const atLeast = (have: Role, need: Role) => RANK[have] >= RANK[need];

/** Bounded structural check run on every parsed JSON body before validation. */
export function checkShape(value: unknown, limits = { depth: 12, nodes: 20_000 }): string | null {
  let nodes = 0;
  const walk = (v: unknown, d: number): string | null => {
    if (++nodes > limits.nodes) return `too many JSON nodes (limit ${limits.nodes})`;
    if (d > limits.depth) return `JSON nesting too deep (limit ${limits.depth})`;
    if (v && typeof v === "object") for (const x of Array.isArray(v) ? v : Object.values(v)) { const e = walk(x, d + 1); if (e) return e; }
    return null;
  };
  return walk(value, 0);
}
