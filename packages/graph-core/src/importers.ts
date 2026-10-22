import { parse as parseYaml } from "yaml";
import { ASSET_KINDS, RELATIONSHIP_KINDS, type Asset, type AssetKind, type Graph, type Relationship, type ZoneId } from "@dk/contracts";

/**
 * Local, allowlist-based metadata importers. They never execute repository code, never resolve
 * environment-variable values, and never fetch URLs. Only the keys listed here are read.
 */

const ID_RE = /[^A-Za-z0-9_.:/-]+/g;
export const sanitizeId = (s: string) => s.trim().replace(ID_RE, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 160) || "unnamed";

const ZONE_BY_KIND: Record<AssetKind, ZoneId> = {
  edge: "public", auth: "application", service: "application", worker: "application", database: "data", storage: "data",
  agent: "automation", tool_server: "automation", pipeline: "delivery", third_party: "external",
};

export function zoneForKind(kind: AssetKind): ZoneId { return ZONE_BY_KIND[kind]; }

const IMAGE_HINTS: [RegExp, AssetKind][] = [
  [/(nginx|traefik|envoy|haproxy|caddy|kong)/i, "edge"],
  [/(keycloak|authentik|ory|kratos|dex|zitadel)/i, "auth"],
  [/(postgres|mysql|mariadb|mongo|redis|cockroach|clickhouse)/i, "database"],
  [/(minio|localstack|azurite)/i, "storage"],
];

/**
 * A user-correctable problem with an imported file. Carries one field-level message per problem (JSON-pointer
 * style path first) so the server can answer with its usual 422 validation response. Anything else thrown by
 * an importer is an unexpected internal error.
 */
export class ImportValidationError extends Error {
  constructor(message: string, readonly issues: string[]) { super(message); this.name = "ImportValidationError"; }
}

function parseDoc(text: string, what: string): unknown {
  try { return parseYaml(text, { maxAliasCount: 50 }); }
  catch (e) { throw new ImportValidationError(`${what} is not valid YAML`, [`/: ${(e as Error).message.split("\n")[0]!.slice(0, 200)}`]); }
}

export interface ImportResult {
  graph: Graph;
  unresolved: string[];
  ignoredKeys: string[];
}

/** Import a Docker Compose file. Reads only: services.*.{image,labels,depends_on,ports}. */
export function importCompose(yamlText: string, opts: { projectId: string; environment: string; revision: string; sourceRef?: string }): ImportResult {
  if (yamlText.length > 512_000) throw new ImportValidationError("compose file too large", ["/: compose file larger than 512 KB"]);
  const doc = parseDoc(yamlText, "compose file") as Record<string, unknown> | null;
  if (!doc || typeof doc !== "object") throw new ImportValidationError("compose file rejected", ["/: compose file is empty or not a mapping"]);
  const services = (doc.services ?? {}) as Record<string, Record<string, unknown>>;
  if (typeof services !== "object") throw new ImportValidationError("compose file rejected", ["/services: must be a mapping"]);
  const sourceRef = opts.sourceRef ?? "import:compose";
  const assets: Asset[] = [];
  const relationships: Relationship[] = [];
  const unresolved: string[] = [];
  const ignored = new Set<string>();
  const names = Object.keys(services).slice(0, 500);
  for (const name of names) {
    const svc = services[name] ?? {};
    for (const k of Object.keys(svc)) if (!["image", "labels", "depends_on", "ports", "build"].includes(k)) ignored.add(k);
    const labels = normalizeLabels(svc.labels);
    let kind = labels["dk.kind"] as AssetKind | undefined;
    if (kind && !ASSET_KINDS.includes(kind)) { unresolved.push(`${name}: unknown dk.kind "${kind}"`); kind = undefined; }
    if (!kind) {
      const image = typeof svc.image === "string" ? svc.image : "";
      kind = IMAGE_HINTS.find(([re]) => re.test(image))?.[1];
      if (!kind) { kind = svc.ports ? "service" : "worker"; unresolved.push(`${name}: kind inferred as ${kind}; add label dk.kind to confirm`); }
    }
    const asset: Asset = {
      id: sanitizeId(labels["dk.id"] ?? name), name: name.slice(0, 200), kind, environment: sanitizeId(opts.environment),
      allowed_zone_ids: [ZONE_BY_KIND[kind]], source_refs: [sourceRef], lifecycle: "active",
    };
    if (labels["dk.owner"]) asset.owner = labels["dk.owner"].slice(0, 200);
    if (labels["dk.sensitivity"] && ["public", "internal", "confidential", "restricted"].includes(labels["dk.sensitivity"])) asset.sensitivity = labels["dk.sensitivity"] as Asset["sensitivity"];
    assets.push(asset);
  }
  const idByName = new Map(names.map((n, i) => [n, assets[i]!.id]));
  for (const name of names) {
    const deps = services[name]?.depends_on;
    const list = Array.isArray(deps) ? deps : deps && typeof deps === "object" ? Object.keys(deps) : [];
    for (const dep of list) {
      const target = idByName.get(String(dep));
      if (!target) { unresolved.push(`${name}: depends_on ${String(dep)} is not a declared service`); continue; }
      const src = idByName.get(name)!;
      const targetKind = assets.find((a) => a.id === target)!.kind;
      relationships.push({
        id: sanitizeId(`rel-${src}-${target}`), source_id: src, target_id: target,
        kind: targetKind === "database" || targetKind === "storage" ? "reads_from" : "calls",
        evidence_level: "declared", evidence_refs: [sourceRef],
        assumptions: "Declared by compose depends_on; startup ordering does not prove runtime calls.",
      });
    }
  }
  return {
    graph: { schema_version: "0.2", dataset_kind: "live", project_id: sanitizeId(opts.projectId), graph_revision: sanitizeId(opts.revision), assets, relationships },
    unresolved, ignoredKeys: [...ignored].sort(),
  };
}

function normalizeLabels(labels: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(labels)) for (const l of labels) { const s = String(l); const i = s.indexOf("="); if (i > 0) out[s.slice(0, i)] = s.slice(i + 1); }
  else if (labels && typeof labels === "object") for (const [k, v] of Object.entries(labels)) out[k] = String(v);
  return out;
}

/** Explicit manifest (dk-manifest.yaml): the most trustworthy declared inventory. */
export function importManifest(text: string, opts: { revision: string; sourceRef?: string }): ImportResult {
  if (text.length > 512_000) throw new ImportValidationError("manifest too large", ["/: manifest larger than 512 KB"]);
  const doc = parseDoc(text, "manifest") as { project?: string; environment?: string; assets?: unknown[]; relationships?: unknown[] } | null;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new ImportValidationError("manifest rejected", ["/: manifest must be a mapping with an assets list"]);
  if (!Array.isArray(doc.assets)) throw new ImportValidationError("manifest rejected", ["/assets: required list of assets"]);
  if (doc.relationships !== undefined && !Array.isArray(doc.relationships)) throw new ImportValidationError("manifest rejected", ["/relationships: must be a list"]);
  if (doc.assets.length > 1000) throw new ImportValidationError("manifest rejected", ["/assets: at most 1000 assets"]);
  if ((doc.relationships ?? []).length > 5000) throw new ImportValidationError("manifest rejected", ["/relationships: at most 5000 relationships"]);
  const sourceRef = opts.sourceRef ?? "import:manifest";
  const env = sanitizeId(doc.environment ?? "default");
  const unresolved: string[] = [];
  const issues: string[] = [];
  // Validate every entry before building anything, so one response lists all problems and nothing partial is produced.
  doc.assets.forEach((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { issues.push(`/assets/${i}: must be a mapping`); return; }
    const a = raw as Record<string, unknown>;
    if (typeof a.id !== "string" || !a.id.trim()) issues.push(`/assets/${i}/id: required string`);
    if (typeof a.kind !== "string" || !ASSET_KINDS.includes(a.kind as AssetKind)) issues.push(`/assets/${i}/kind: unsupported asset kind ${JSON.stringify(typeof a.kind === "string" ? a.kind.slice(0, 60) : a.kind ?? null)}; allowed: ${ASSET_KINDS.join(", ")}`);
  });
  (doc.relationships ?? []).forEach((raw, i) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { issues.push(`/relationships/${i}: must be a mapping`); return; }
    const r = raw as Record<string, unknown>;
    if (typeof r.from !== "string" || typeof r.to !== "string") issues.push(`/relationships/${i}: from and to are required strings`);
    if (r.kind !== undefined && !RELATIONSHIP_KINDS.includes(r.kind as Relationship["kind"])) issues.push(`/relationships/${i}/kind: unsupported relationship kind ${JSON.stringify(String(r.kind).slice(0, 60))}; allowed: ${RELATIONSHIP_KINDS.join(", ")}`);
  });
  if (issues.length) throw new ImportValidationError("manifest rejected", issues.slice(0, 50));
  const assets: Asset[] = doc.assets.map((raw) => {
    const a = raw as Record<string, unknown>;
    const kind = a.kind as AssetKind;
    const out: Asset = { id: sanitizeId(String(a.id)), name: String(a.name ?? a.id).slice(0, 200), kind, environment: env, allowed_zone_ids: [ZONE_BY_KIND[kind]], source_refs: [sourceRef], lifecycle: "active" };
    if (typeof a.owner === "string") out.owner = a.owner.slice(0, 200);
    if (Array.isArray(a.aliases)) out.aliases = a.aliases.map(String).slice(0, 32);
    if (typeof a.sensitivity === "string") out.sensitivity = a.sensitivity as Asset["sensitivity"];
    if (typeof a.secondary_label === "string") out.secondary_label = a.secondary_label.slice(0, 80);
    return out;
  });
  const ids = new Set(assets.map((a) => a.id));
  const relationships: Relationship[] = [];
  for (const raw of doc.relationships ?? []) {
    const r = raw as Record<string, unknown>;
    const s = sanitizeId(String(r.from)), t = sanitizeId(String(r.to));
    if (!ids.has(s) || !ids.has(t)) { unresolved.push(`relationship ${s} -> ${t} references an undeclared asset`); continue; }
    relationships.push({ id: sanitizeId(String(r.id ?? `rel-${s}-${t}-${String(r.kind ?? "calls")}`)), source_id: s, target_id: t, kind: (r.kind as Relationship["kind"]) ?? "calls", evidence_level: "declared", evidence_refs: [sourceRef] });
  }
  return { graph: { schema_version: "0.2", dataset_kind: "live", project_id: sanitizeId(doc.project ?? "project"), graph_revision: sanitizeId(opts.revision), assets, relationships }, unresolved, ignoredKeys: [] };
}
