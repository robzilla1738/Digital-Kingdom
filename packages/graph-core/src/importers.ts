import { parse as parseYaml } from "yaml";
import { ASSET_KINDS, RELATIONSHIP_KINDS, type Asset, type AssetKind, type Graph, type Relationship, type ZoneId } from "@dk/contracts";

/** Local metadata import only: never execute code, resolve environment variables, or fetch URLs. */
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
const SENSITIVITIES = ["public", "internal", "confidential", "restricted"];
const isMapping = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const pointer = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

export class ImportValidationError extends Error {
  constructor(message: string, readonly issues: string[]) { super(message); this.name = "ImportValidationError"; }
}
function fail(what: string, issues: string[]): void {
  if (issues.length) throw new ImportValidationError(`${what} rejected`, issues.slice(0, 50));
}
/** Check optional/required strings before using trim, regexes, or other transformations. */
function stringField(obj: Record<string, unknown>, key: string, path: string, issues: string[], required = false, max = 200) {
  const v = obj[key];
  if (v === undefined && !required) return;
  if (typeof v !== "string" || !v.trim()) issues.push(`${path}: must be a non-empty string`);
  else if (v.length > max) issues.push(`${path}: must be at most ${max} characters`);
}
function parseDoc(text: string, what: string): unknown {
  try { return parseYaml(text, { maxAliasCount: 50 }); }
  catch (e) { throw new ImportValidationError(`${what} is not valid YAML`, [`/: ${(e as Error).message.split("\n")[0]!.slice(0, 200)}`]); }
}
export interface ImportResult { graph: Graph; unresolved: string[]; ignoredKeys: string[] }

/** Import the supported Docker Compose metadata subset. Unsupported fields are not executed or inspected. */
export function importCompose(yamlText: string, opts: { projectId: string; environment: string; revision: string; sourceRef?: string }): ImportResult {
  if (yamlText.length > 512_000) throw new ImportValidationError("compose file too large", ["/: compose file larger than 512 KB"]);
  const doc = parseDoc(yamlText, "compose file");
  if (!isMapping(doc)) throw new ImportValidationError("compose file rejected", ["/: compose file must be a mapping"]);
  if (!isMapping(doc.services)) throw new ImportValidationError("compose file rejected", ["/services: required mapping of services"]);
  const services = doc.services;
  const names = Object.keys(services);
  if (!names.length || names.length > 500) throw new ImportValidationError("compose file rejected", ["/services: must contain between 1 and 500 services (never silently truncated)"]);
  const issues: string[] = [];
  stringField(opts, "projectId", "/project", issues, true, 160);
  stringField(opts, "environment", "/environment", issues, true, 160);
  stringField(opts, "revision", "/revision", issues, true, 160);
  // Validate all consumed fields before constructing even the first asset.
  for (const name of names) {
    const path = `/services/${pointer(name)}`;
    const svc = services[name];
    if (!isMapping(svc)) { issues.push(`${path}: must be a mapping`); continue; }
    stringField(svc, "image", `${path}/image`, issues, false, 1000);
    const labels = svc.labels;
    if (labels !== undefined) {
      if (Array.isArray(labels)) {
        labels.forEach((v, i) => { if (typeof v !== "string") issues.push(`${path}/labels/${i}: must be a string`); });
      } else if (isMapping(labels)) {
        for (const [k, v] of Object.entries(labels)) if (v !== null && !["string", "number", "boolean"].includes(typeof v)) issues.push(`${path}/labels/${pointer(k)}: must be a scalar`);
      } else issues.push(`${path}/labels: must be a mapping or list of strings`);
      if (isMapping(labels) || (Array.isArray(labels) && labels.every((v) => typeof v === "string"))) {
        const normalized = normalizeLabels(labels);
        if (normalized["dk.kind"] !== undefined && !ASSET_KINDS.includes(normalized["dk.kind"] as AssetKind)) issues.push(`${path}/labels/dk.kind: unsupported asset kind ${JSON.stringify(normalized["dk.kind"].slice(0, 60))}`);
        if (normalized["dk.id"] !== undefined && !normalized["dk.id"].trim()) issues.push(`${path}/labels/dk.id: must be a non-empty string`);
        if (normalized["dk.sensitivity"] !== undefined && !SENSITIVITIES.includes(normalized["dk.sensitivity"])) issues.push(`${path}/labels/dk.sensitivity: unsupported sensitivity`);
      }
    }
    const deps = svc.depends_on;
    if (deps !== undefined) {
      if (Array.isArray(deps)) deps.forEach((v, i) => { if (typeof v !== "string" || !v.trim()) issues.push(`${path}/depends_on/${i}: must be a non-empty service name`); });
      else if (isMapping(deps)) {
        for (const [k, v] of Object.entries(deps)) if (!isMapping(v)) issues.push(`${path}/depends_on/${pointer(k)}: must be a mapping`);
      } else issues.push(`${path}/depends_on: must be a list of service names or a mapping`);
    }
    if (svc.ports !== undefined && !Array.isArray(svc.ports)) issues.push(`${path}/ports: must be a list`);
  }
  fail("compose file", issues);
  const sourceRef = opts.sourceRef ?? "import:compose";
  const assets: Asset[] = [];
  const relationships: Relationship[] = [];
  const unresolved: string[] = [];
  const ignored = new Set<string>();
  for (const name of names) {
    const svc = services[name] as Record<string, unknown>;
    for (const k of Object.keys(svc)) if (!["image", "labels", "depends_on", "ports", "build"].includes(k)) ignored.add(k);
    const labels = normalizeLabels(svc.labels);
    let kind = labels["dk.kind"] as AssetKind | undefined;
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
    if (labels["dk.sensitivity"]) asset.sensitivity = labels["dk.sensitivity"] as Asset["sensitivity"];
    assets.push(asset);
  }
  const idByName = new Map(names.map((n, i) => [n, assets[i]!.id]));
  for (const name of names) {
    const deps = (services[name] as Record<string, unknown>).depends_on;
    const list = Array.isArray(deps) ? deps : isMapping(deps) ? Object.keys(deps) : [];
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
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  if (Array.isArray(labels)) for (const l of labels) { const s = String(l); const i = s.indexOf("="); if (i > 0) out[s.slice(0, i)] = s.slice(i + 1); }
  else if (isMapping(labels)) for (const [k, v] of Object.entries(labels)) out[k] = v === null ? "" : String(v);
  return out;
}

/** Explicit manifest (dk-manifest.yaml). Validate the complete supported input before graph construction. */
export function importManifest(text: string, opts: { revision: string; sourceRef?: string }): ImportResult {
  if (text.length > 512_000) throw new ImportValidationError("manifest too large", ["/: manifest larger than 512 KB"]);
  const doc = parseDoc(text, "manifest");
  if (!isMapping(doc)) throw new ImportValidationError("manifest rejected", ["/: manifest must be a mapping with an assets list"]);
  if (!Array.isArray(doc.assets)) throw new ImportValidationError("manifest rejected", ["/assets: required list of assets"]);
  if (doc.relationships !== undefined && !Array.isArray(doc.relationships)) throw new ImportValidationError("manifest rejected", ["/relationships: must be a list"]);
  if (!doc.assets.length || doc.assets.length > 1000) throw new ImportValidationError("manifest rejected", ["/assets: must contain between 1 and 1000 assets"]);
  const rawRelationships = (doc.relationships ?? []) as unknown[];
  if (rawRelationships.length > 5000) throw new ImportValidationError("manifest rejected", ["/relationships: at most 5000 relationships"]);
  const issues: string[] = [];
  stringField(doc, "project", "/project", issues, false, 160);
  stringField(doc, "environment", "/environment", issues, false, 160);
  stringField(opts, "revision", "/revision", issues, true, 160);
  doc.assets.forEach((raw, i) => {
    const path = `/assets/${i}`;
    if (!isMapping(raw)) { issues.push(`${path}: must be a mapping`); return; }
    stringField(raw, "id", `${path}/id`, issues, true, 160);
    if (typeof raw.kind !== "string" || !ASSET_KINDS.includes(raw.kind as AssetKind)) issues.push(`${path}/kind: unsupported asset kind ${JSON.stringify(typeof raw.kind === "string" ? raw.kind.slice(0, 60) : raw.kind ?? null)}; allowed: ${ASSET_KINDS.join(", ")}`);
    for (const k of ["name", "owner", "secondary_label"]) stringField(raw, k, `${path}/${k}`, issues, false, k === "secondary_label" ? 80 : 200);
    if (raw.sensitivity !== undefined && (typeof raw.sensitivity !== "string" || !SENSITIVITIES.includes(raw.sensitivity))) issues.push(`${path}/sensitivity: must be public, internal, confidential or restricted`);
    if (raw.aliases !== undefined) {
      if (!Array.isArray(raw.aliases) || raw.aliases.length > 32) issues.push(`${path}/aliases: must be a list of at most 32 strings`);
      else raw.aliases.forEach((v, j) => { if (typeof v !== "string" || !v.trim() || v.length > 160) issues.push(`${path}/aliases/${j}: must be a non-empty string of at most 160 characters`); });
    }
  });
  rawRelationships.forEach((raw, i) => {
    const path = `/relationships/${i}`;
    if (!isMapping(raw)) { issues.push(`${path}: must be a mapping`); return; }
    stringField(raw, "from", `${path}/from`, issues, true, 160);
    stringField(raw, "to", `${path}/to`, issues, true, 160);
    stringField(raw, "id", `${path}/id`, issues, false, 160);
    if (raw.kind !== undefined && !RELATIONSHIP_KINDS.includes(raw.kind as Relationship["kind"])) issues.push(`${path}/kind: unsupported relationship kind ${JSON.stringify(String(raw.kind).slice(0, 60))}; allowed: ${RELATIONSHIP_KINDS.join(", ")}`);
  });
  fail("manifest", issues);
  const sourceRef = opts.sourceRef ?? "import:manifest";
  const env = sanitizeId((doc.environment as string | undefined) ?? "default");
  const unresolved: string[] = [];
  const assets: Asset[] = doc.assets.map((raw) => {
    const a = raw as Record<string, unknown>;
    const kind = a.kind as AssetKind;
    const out: Asset = { id: sanitizeId(a.id as string), name: (a.name ?? a.id) as string, kind, environment: env, allowed_zone_ids: [ZONE_BY_KIND[kind]], source_refs: [sourceRef], lifecycle: "active" };
    if (typeof a.owner === "string") out.owner = a.owner;
    if (Array.isArray(a.aliases)) out.aliases = a.aliases as string[];
    if (typeof a.sensitivity === "string") out.sensitivity = a.sensitivity as Asset["sensitivity"];
    if (typeof a.secondary_label === "string") out.secondary_label = a.secondary_label;
    return out;
  });
  const ids = new Set(assets.map((a) => a.id));
  const relationships: Relationship[] = [];
  for (const raw of rawRelationships) {
    const r = raw as Record<string, unknown>;
    const s = sanitizeId(r.from as string), t = sanitizeId(r.to as string);
    if (!ids.has(s) || !ids.has(t)) { unresolved.push(`relationship ${s} -> ${t} references an undeclared asset`); continue; }
    relationships.push({ id: sanitizeId(String(r.id ?? `rel-${s}-${t}-${String(r.kind ?? "calls")}`)), source_id: s, target_id: t, kind: (r.kind as Relationship["kind"]) ?? "calls", evidence_level: "declared", evidence_refs: [sourceRef] });
  }
  return { graph: { schema_version: "0.2", dataset_kind: "live", project_id: sanitizeId((doc.project as string | undefined) ?? "project"), graph_revision: sanitizeId(opts.revision), assets, relationships }, unresolved, ignoredKeys: [] };
}
