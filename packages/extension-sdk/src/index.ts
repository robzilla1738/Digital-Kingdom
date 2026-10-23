import { createHash } from "node:crypto";

/**
 * Digital Kingdom extension contract (roadmap R10.5), `dk.extension.v1`.
 *
 * Extensions are DECLARATIVE: a connector manifest, a threshold rule definition or a scene-module description.
 * No extension ships executable code, so none can open sockets, read files, spawn processes or call providers.
 * Each kind has a fixed permission ceiling; asking for more, or for an unknown permission, rejects the extension.
 * Every file is pinned by sha256 in the manifest, a revocation list can withdraw an id@version or a digest, and a
 * contributor pack must carry positive, benign, missing-evidence and failure fixtures that pass `checkPack`.
 */
export const EXTENSION_SCHEMA = "dk.extension.v1";
export const CONTRACT_VERSIONS = { connector: 1, rule: 1, module: 1 } as const;
export type ExtensionKind = keyof typeof CONTRACT_VERSIONS;

/** Permission ceilings. Nothing outside these sets can be granted to an extension of that kind. */
export const PERMISSION_CEILING: Record<ExtensionKind, readonly string[]> = {
  connector: ["ingest:events", "sources:declare"],
  rule: ["events:read", "findings:propose"],
  module: ["scene:render", "graph:read"],
};
const FORBIDDEN = /^(network|net|fs|file|exec|process|shell|respond|containment|approve|admin|tokens|secrets|provider)[:.]/i;

export interface ExtensionManifest {
  schema: typeof EXTENSION_SCHEMA;
  id: string; version: string; kind: ExtensionKind; contract_version: number;
  name: string; description: string; license: string; maintainers: string[];
  permissions: string[];
  /** Relative path -> sha256 hex. Every file the extension consists of. */
  files: Record<string, string>;
  /** For rule extensions: the definition file and the fixture files. */
  rule?: { definition: string; fixtures: { positive: string; benign: string; missing_evidence: string; failure: string } };
}

export interface RuleDefinition {
  id: string; severity: "low" | "medium" | "high" | "critical";
  match: { action: string; outcomes: string[] };
  group_by: "actor_ref" | "client_ip" | "session_ref";
  threshold: number; window_seconds: number;
}
export interface FixtureEvent { occurred_at?: unknown; action?: unknown; outcome?: unknown; actor_ref?: unknown; client_ip?: unknown; session_ref?: unknown }
export interface Fixture { events: unknown[]; expect: "fires" | "quiet" | "unknown" | "rejected" }

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;
const ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
export const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

/** Structural and permission validation. Returns problems; an empty list means acceptable. */
export function validateExtension(m: unknown): string[] {
  const p: string[] = [];
  if (!m || typeof m !== "object" || Array.isArray(m)) return ["manifest must be an object"];
  const x = m as Partial<ExtensionManifest> & Record<string, unknown>;
  const allowed = new Set(["schema", "id", "version", "kind", "contract_version", "name", "description", "license", "maintainers", "permissions", "files", "rule"]);
  for (const k of Object.keys(x)) if (!allowed.has(k)) p.push(`unknown field ${k}`);
  if (x.schema !== EXTENSION_SCHEMA) p.push(`schema must be ${EXTENSION_SCHEMA}`);
  if (typeof x.id !== "string" || !ID.test(x.id) || x.id.length > 80) p.push("id must be lowercase dotted/dashed, at most 80 characters");
  if (typeof x.version !== "string" || !SEMVER.test(x.version)) p.push("version must be semver");
  if (!x.kind || !(x.kind in CONTRACT_VERSIONS)) { p.push("kind must be connector, rule or module"); return p; }
  if (x.contract_version !== CONTRACT_VERSIONS[x.kind]) p.push(`contract_version ${String(x.contract_version)} is not supported for ${x.kind} (supported: ${CONTRACT_VERSIONS[x.kind]})`);
  for (const f of ["name", "description", "license"] as const) if (typeof x[f] !== "string" || !(x[f] as string).trim()) p.push(`${f} is required`);
  if (!Array.isArray(x.maintainers) || !x.maintainers.length) p.push("maintainers must name at least one owner");
  if (!Array.isArray(x.permissions)) p.push("permissions must be a list");
  else for (const perm of x.permissions) {
    if (typeof perm !== "string") { p.push("permissions must be strings"); continue; }
    if (FORBIDDEN.test(perm)) p.push(`permission ${perm} is never grantable to an extension`);
    else if (!PERMISSION_CEILING[x.kind].includes(perm)) p.push(`permission ${perm} exceeds the ${x.kind} ceiling (${PERMISSION_CEILING[x.kind].join(", ")})`);
  }
  if (!x.files || typeof x.files !== "object" || Array.isArray(x.files) || !Object.keys(x.files).length) p.push("files must pin every file by sha256");
  else for (const [path, h] of Object.entries(x.files)) {
    if (path.startsWith("/") || path.split("/").includes("..") || path.includes("\\")) p.push(`file path ${path} must be relative and inside the extension`);
    if (/\.(m?js|cjs|ts|mts|sh|py|wasm|node|so|dylib|dll|exe)$/i.test(path)) p.push(`file ${path} is executable code; extensions are declarative`);
    if (typeof h !== "string" || !/^[0-9a-f]{64}$/.test(h)) p.push(`file ${path} needs a sha256 hex digest`);
  }
  if (x.kind === "rule") {
    const r = x.rule;
    if (!r || typeof r.definition !== "string") p.push("rule extensions need rule.definition");
    else {
      const fx = r.fixtures as Record<string, unknown> | undefined;
      for (const k of ["positive", "benign", "missing_evidence", "failure"]) if (!fx || typeof fx[k] !== "string") p.push(`rule.fixtures.${k} is required`);
      for (const f of [r.definition, ...Object.values(fx ?? {})]) if (typeof f === "string" && x.files && !(f in x.files)) p.push(`${f} is referenced but not pinned in files`);
    }
  } else if (x.rule !== undefined) p.push("rule is only valid for rule extensions");
  return p;
}

/** Integrity: every pinned file exists with its digest and nothing unpinned is shipped. */
export function verifyIntegrity(m: ExtensionManifest, read: (path: string) => string | Uint8Array | null, shipped: string[]) {
  const p: string[] = [];
  for (const [path, h] of Object.entries(m.files)) { const c = read(path); if (c === null) p.push(`${path} is missing`); else if (sha256(c) !== h) p.push(`${path} does not match its pinned digest`); }
  for (const s of shipped) if (s !== "extension.json" && !(s in m.files)) p.push(`${s} is shipped but not pinned`);
  return p;
}

export interface Revocations { schema: "dk.extension_revocations.v1"; revoked: { id: string; version?: string; digest?: string; reason: string; at: string }[] }
const canon = (v: unknown): string => Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);
export const manifestDigest = (m: ExtensionManifest) => sha256(canon(m));
export function isRevoked(m: ExtensionManifest, list: Revocations | null) {
  const d = manifestDigest(m);
  return (list?.revoked ?? []).find((r) => r.id === m.id && (!r.version || r.version === m.version) && (!r.digest || r.digest === d)) ?? null;
}

export function validateRule(d: unknown): string[] {
  const p: string[] = [];
  const r = d as Partial<RuleDefinition> | null;
  if (!r || typeof r !== "object") return ["rule definition must be an object"];
  if (typeof r.id !== "string" || !ID.test(r.id)) p.push("rule id is required");
  if (!["low", "medium", "high", "critical"].includes(String(r.severity))) p.push("severity must be low, medium, high or critical");
  if (!r.match || typeof r.match.action !== "string" || !Array.isArray(r.match.outcomes) || !r.match.outcomes.length) p.push("match needs action and outcomes");
  if (!["actor_ref", "client_ip", "session_ref"].includes(String(r.group_by))) p.push("group_by must be actor_ref, client_ip or session_ref");
  if (!Number.isInteger(r.threshold) || (r.threshold as number) < 2 || (r.threshold as number) > 10_000) p.push("threshold must be an integer 2..10000");
  if (!Number.isInteger(r.window_seconds) || (r.window_seconds as number) < 1 || (r.window_seconds as number) > 86_400) p.push("window_seconds must be an integer 1..86400");
  return p;
}

/**
 * Evaluate a threshold rule over fixture events. Malformed events reject the whole input (never silently skipped);
 * matching events without the grouping field make the answer unknown (missing evidence is not benign).
 */
export function runRule(def: RuleDefinition, events: unknown[]): { result: "fires" | "quiet" | "unknown" | "rejected"; detail: string } {
  const evs: { t: number; key: string | null }[] = [];
  for (const [i, raw] of events.entries()) {
    const e = raw as FixtureEvent;
    if (!e || typeof e !== "object" || typeof e.action !== "string" || typeof e.outcome !== "string" || typeof e.occurred_at !== "string" || Number.isNaN(Date.parse(e.occurred_at))) return { result: "rejected", detail: `event ${i} is malformed (needs action, outcome, ISO occurred_at)` };
    if (e.action !== def.match.action || !def.match.outcomes.includes(e.outcome)) continue;
    const k = e[def.group_by];
    evs.push({ t: Date.parse(e.occurred_at), key: typeof k === "string" && k ? k : null });
  }
  const missing = evs.filter((e) => e.key === null).length;
  const groups = new Map<string, number[]>();
  for (const e of evs) if (e.key) groups.set(e.key, [...(groups.get(e.key) ?? []), e.t]);
  for (const [key, ts] of groups) { ts.sort((a, b) => a - b); for (let i = 0; i + def.threshold - 1 < ts.length; i++) if (ts[i + def.threshold - 1]! - ts[i]! <= def.window_seconds * 1000) return { result: "fires", detail: `${def.threshold} matching events for ${def.group_by}=${key} within ${def.window_seconds}s` }; }
  if (missing) return { result: "unknown", detail: `${missing} matching event(s) lack ${def.group_by}; the rule cannot say they are benign` };
  return { result: "quiet", detail: "threshold not reached" };
}

/** Contributor pack check: manifest, integrity, revocation, rule definition and all four fixtures. */
export function checkPack(m: ExtensionManifest, read: (path: string) => string | null, shipped: string[], revocations: Revocations | null = null) {
  const problems = validateExtension(m);
  if (problems.length) return { ok: false, problems, fixtures: [] as { name: string; expected: string; got: string; detail: string }[] };
  problems.push(...verifyIntegrity(m, read, shipped));
  const rev = isRevoked(m, revocations);
  if (rev) problems.push(`revoked: ${rev.reason}`);
  const fixtures: { name: string; expected: string; got: string; detail: string }[] = [];
  if (m.kind === "rule" && m.rule && !problems.length) {
    const parse = (path: string) => { try { return JSON.parse(read(path) ?? "null") as unknown; } catch { return null; } };
    const def = parse(m.rule.definition);
    const dp = validateRule(def);
    if (dp.length) problems.push(...dp.map((x) => `rule: ${x}`));
    else for (const [name, path] of Object.entries(m.rule.fixtures)) {
      const fx = parse(path) as Fixture | null;
      if (!fx || !Array.isArray(fx.events)) { problems.push(`fixture ${name} is not { events, expect }`); continue; }
      const want = ({ positive: "fires", benign: "quiet", missing_evidence: "unknown", failure: "rejected" } as const)[name as "positive"];
      if (fx.expect !== want) problems.push(`fixture ${name} must expect ${want}`);
      const r = runRule(def as RuleDefinition, fx.events);
      fixtures.push({ name, expected: want, got: r.result, detail: r.detail });
      if (r.result !== want) problems.push(`fixture ${name}: expected ${want}, got ${r.result} (${r.detail})`);
    }
  }
  return { ok: problems.length === 0, problems, fixtures };
}
