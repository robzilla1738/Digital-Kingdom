import { parse as parseYaml } from "yaml";
import { ASSET_KINDS, type Asset, type AssetKind, type Graph, type Relationship, type ZoneId } from "@dk/contracts";

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

export interface ImportResult {
  graph: Graph;
  unresolved: string[];
  ignoredKeys: string[];
}

/** Import a Docker Compose file. Reads only: services.*.{image,labels,depends_on,ports}. */
export function importCompose(yamlText: string, opts: { projectId: string; environment: string; revision: string; sourceRef?: string }): ImportResult {
  if (yamlText.length > 512_000) throw new Error("compose file too large (limit 512 KB)");
  const doc = parseYaml(yamlText, { maxAliasCount: 50, prettyErrors: true }) as Record<string, unknown> | null;
  if (!doc || typeof doc !== "object") throw new Error("compose file is empty or not a mapping");
  const services = (doc.services ?? {}) as Record<string, Record<string, unknown>>;
  if (typeof services !== "object") throw new Error("compose services must be a mapping");
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
  if (text.length > 512_000) throw new Error("manifest too large (limit 512 KB)");
  const doc = parseYaml(text, { maxAliasCount: 50 }) as { project?: string; environment?: string; assets?: unknown[]; relationships?: unknown[] };
  if (!doc || !Array.isArray(doc.assets)) throw new Error("manifest must contain an assets list");
  const sourceRef = opts.sourceRef ?? "import:manifest";
  const env = sanitizeId(doc.environment ?? "default");
  const unresolved: string[] = [];
  const assets: Asset[] = doc.assets.slice(0, 1000).map((raw) => {
    const a = raw as Record<string, unknown>;
    const kind = String(a.kind) as AssetKind;
    if (!ASSET_KINDS.includes(kind)) throw new Error(`asset ${String(a.id)}: unsupported kind ${kind}`);
    const out: Asset = { id: sanitizeId(String(a.id)), name: String(a.name ?? a.id).slice(0, 200), kind, environment: env, allowed_zone_ids: [ZONE_BY_KIND[kind]], source_refs: [sourceRef], lifecycle: "active" };
    if (typeof a.owner === "string") out.owner = a.owner.slice(0, 200);
    if (Array.isArray(a.aliases)) out.aliases = a.aliases.map(String).slice(0, 32);
    if (typeof a.sensitivity === "string") out.sensitivity = a.sensitivity as Asset["sensitivity"];
    if (typeof a.secondary_label === "string") out.secondary_label = a.secondary_label.slice(0, 80);
    return out;
  });
  const ids = new Set(assets.map((a) => a.id));
  const relationships: Relationship[] = [];
  for (const raw of (doc.relationships ?? []).slice(0, 5000)) {
    const r = raw as Record<string, unknown>;
    const s = sanitizeId(String(r.from)), t = sanitizeId(String(r.to));
    if (!ids.has(s) || !ids.has(t)) { unresolved.push(`relationship ${s} -> ${t} references an undeclared asset`); continue; }
    relationships.push({ id: sanitizeId(String(r.id ?? `rel-${s}-${t}-${String(r.kind ?? "calls")}`)), source_id: s, target_id: t, kind: (r.kind as Relationship["kind"]) ?? "calls", evidence_level: "declared", evidence_refs: [sourceRef] });
  }
  return { graph: { schema_version: "0.2", dataset_kind: "live", project_id: sanitizeId(doc.project ?? "project"), graph_revision: sanitizeId(opts.revision), assets, relationships }, unresolved, ignoredKeys: [] };
}
