import { parseDocument } from "yaml";
import type { Graph } from "@dk/contracts";
import { ImportValidationError, importCompose, importManifest, sanitizeId } from "@dk/graph-core";
import { routesFromOpenApi } from "@dk/graph-core/packs/edge";
import { sha256 } from "./catalog.ts";

/**
 * LP04: inert descriptor import and preview.
 *
 * Untrusted Compose, OpenAPI and dk-manifest text is DATA. Only allowlisted fields are read. Nothing is executed,
 * interpolated, fetched or resolved: build contexts, commands, entrypoints, environment and env files, volumes and
 * host mounts, privileged/host-network flags, extends/include, healthcheck commands, YAML custom tags, OpenAPI
 * server URLs, callbacks, links and $ref are either rejected or listed as explicitly ignored with a reason.
 * Declared names are never identity mappings: a descriptor service called "api" is not the world's api resource.
 */
export type DescriptorFormat = "compose" | "openapi" | "manifest";
export interface DescriptorIssue { path: string; reason: string }
export interface DescriptorPreview {
  schema: "dk.local.descriptor_preview.v1";
  ok: boolean;
  format: DescriptorFormat;
  provenance: { source_ref: string; digest: string; bytes: number; declared: true; note: string };
  graph: Graph | null;
  routes: { key: string; method: string; path: string; service: string; auth_declared: boolean }[];
  rejected: DescriptorIssue[];
  ignored: DescriptorIssue[];
  unresolved: string[];
  identity_mapping: { status: "none"; note: string; name_matches: { declared: string; world_resource: string }[] };
}

const MAX_BYTES = 512_000;
const INTERP = /\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*/;
const isMap = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const ptr = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

/** Compose keys that would execute, mount, expose or reach outside: never read. */
const COMPOSE_EXECUTABLE: Record<string, string> = {
  build: "build contexts and Dockerfiles are never built or read",
  command: "commands are never executed", entrypoint: "entrypoints are never executed",
  healthcheck: "healthcheck commands are never executed",
  environment: "environment values are not read or interpolated", env_file: "env files are never opened",
  volumes: "volumes and host mounts are never created", devices: "devices are never mapped",
  privileged: "privileged mode is never granted", cap_add: "capabilities are never granted", security_opt: "security options are never applied",
  network_mode: "network modes (including host) are never applied", networks: "networks are never created", pid: "host pid namespace is never shared", ipc: "host ipc namespace is never shared",
  extends: "extends is never followed", secrets: "secrets are never mounted", configs: "configs are never mounted",
  user: "user ids are not applied", working_dir: "working directories are not applied", sysctls: "sysctls are never applied",
  "<<": "YAML merge keys are not applied; merged fields are not read",
  ports: "declared ports are not endpoints; the supervisor allocates endpoints (used only as a hint that the service listens)",
};
const COMPOSE_TOP_IGNORED: Record<string, string> = {
  include: "include is never followed", volumes: "top-level volumes are never created", networks: "top-level networks are never created",
  secrets: "secrets are never read", configs: "configs are never read", name: "project name is not used", version: "compose version is informational",
};

function parseUntrusted(text: string, what: string, rejected: DescriptorIssue[]): unknown {
  const doc = parseDocument(text, { prettyErrors: false, uniqueKeys: true });
  for (const e of doc.errors) rejected.push({ path: "/", reason: `${what} is not valid YAML/JSON: ${e.message.split("\n")[0]!.slice(0, 200)}` });
  for (const w of doc.warnings) if (w.code === "TAG_RESOLVE_FAILED") rejected.push({ path: "/", reason: `custom YAML tag rejected (${w.message.split("\n")[0]!.slice(0, 120)}); tags are never resolved to code or objects` });
  if (doc.errors.length) return null;
  try { return doc.toJS({ maxAliasCount: 50 }); } catch (e) { rejected.push({ path: "/", reason: `${what} could not be read: ${(e as Error).message.slice(0, 200)}` }); return null; }
}

function scanInterpolation(v: unknown, path: string, out: DescriptorIssue[], depth = 0): void {
  if (depth > 20) return;
  if (typeof v === "string") { if (INTERP.test(v)) out.push({ path, reason: "variable interpolation is never evaluated" }); return; }
  if (Array.isArray(v)) v.forEach((x, i) => scanInterpolation(x, `${path}/${i}`, out, depth + 1));
  else if (isMap(v)) for (const [k, x] of Object.entries(v)) scanInterpolation(x, `${path}/${ptr(k)}`, out, depth + 1);
}

export interface DescriptorOptions { format: DescriptorFormat; text: string; revision?: string; projectId?: string; service?: string; environment?: string; worldResourceIds?: string[] }

export function previewDescriptor(o: DescriptorOptions): DescriptorPreview {
  const text = typeof o.text === "string" ? o.text : "";
  const digest = sha256(text);
  const base: DescriptorPreview = {
    schema: "dk.local.descriptor_preview.v1", ok: false, format: o.format,
    provenance: { source_ref: `import:${o.format}:${digest.slice(0, 12)}`, digest, bytes: Buffer.byteLength(text), declared: true, note: "Declared metadata from an untrusted file. Runtime observations are separate facts." },
    graph: null, routes: [], rejected: [], ignored: [], unresolved: [],
    identity_mapping: { status: "none", note: "Name equality is not an identity mapping; no declared service is mapped to a world resource automatically.", name_matches: [] },
  };
  const R = base.rejected, I = base.ignored;
  if (typeof o.text !== "string" || !text.trim()) { R.push({ path: "/", reason: "descriptor text is required" }); return base; }
  if (base.provenance.bytes > MAX_BYTES) { R.push({ path: "/", reason: `descriptor larger than ${MAX_BYTES} bytes (never truncated)` }); return base; }
  if (!["compose", "openapi", "manifest"].includes(o.format)) { R.push({ path: "/", reason: `unsupported descriptor format ${String(o.format).slice(0, 40)}` }); return base; }
  const doc = parseUntrusted(text, o.format, R);
  if (R.length) return base;
  if (!isMap(doc)) { R.push({ path: "/", reason: "descriptor must be a mapping" }); return base; }
  const revision = sanitizeId(o.revision ?? `desc-${digest.slice(0, 12)}`);

  if (o.format === "compose") {
    for (const k of Object.keys(doc)) if (k !== "services") I.push({ path: `/${ptr(k)}`, reason: COMPOSE_TOP_IGNORED[k] ?? (k.startsWith("x-") ? "extension fields are never read" : "unsupported top-level key is not read") });
    const services = isMap(doc.services) ? doc.services : {};
    const clean: Record<string, Record<string, unknown>> = {};
    for (const [name, svc] of Object.entries(services)) {
      const p = `/services/${ptr(name)}`;
      if (INTERP.test(name)) { R.push({ path: p, reason: "variable interpolation in a service name is never evaluated" }); continue; }
      if (!isMap(svc)) { clean[name] = svc as never; continue; }
      const kept: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(svc)) {
        if (k === "image" || k === "labels" || k === "depends_on") kept[k] = v;
        else if (k === "ports") { kept.ports = Array.isArray(v) ? [] : v; I.push({ path: `${p}/ports`, reason: COMPOSE_EXECUTABLE.ports! }); }
        else I.push({ path: `${p}/${ptr(k)}`, reason: COMPOSE_EXECUTABLE[k] ?? (k.startsWith("x-") ? "extension fields are never read" : "unsupported service key is not read") });
      }
      // interpolation in consumed fields: identity-bearing labels and dependencies are rejected; an image hint is ignored
      const interp: DescriptorIssue[] = [];
      scanInterpolation({ labels: kept.labels, depends_on: kept.depends_on }, p, interp);
      R.push(...interp);
      if (typeof kept.image === "string" && INTERP.test(kept.image)) { I.push({ path: `${p}/image`, reason: "variable interpolation is never evaluated; the image is not used as a kind hint" }); delete kept.image; }
      if (typeof kept.image === "string") I.push({ path: `${p}/image`, reason: "images are never pulled or run; the name is only a kind hint" });
      clean[name] = kept;
    }
    if (R.length) return base;
    try {
      const r = importCompose(JSON.stringify({ services: clean }), { projectId: o.projectId ?? "descriptor-preview", environment: o.environment ?? "imported", revision, sourceRef: base.provenance.source_ref });
      base.graph = r.graph; base.unresolved = r.unresolved; base.ok = true;
    } catch (e) { R.push(...issuesOf(e)); }
  } else if (o.format === "manifest") {
    scanInterpolation(doc, "", R);
    if (R.length) return base;
    try {
      const r = importManifest(JSON.stringify(doc), { revision, sourceRef: base.provenance.source_ref });
      base.graph = r.graph; base.unresolved = r.unresolved; base.ok = true;
    } catch (e) { R.push(...issuesOf(e)); }
  } else {
    // OpenAPI: allowlisted fields only; remote references rejected, local references not resolved.
    findRefs(doc, "", R, I);
    for (const k of Object.keys(doc)) if (!["openapi", "info", "paths"].includes(k)) I.push({ path: `/${ptr(k)}`, reason: k === "servers" ? "server URLs are never contacted" : k === "webhooks" ? "webhooks are never registered or called" : k.startsWith("x-") ? "extension fields are never read" : "not read by the inert route import" });
    if (typeof doc.openapi !== "string") R.push({ path: "/openapi", reason: "openapi version string is required" });
    if (!isMap(doc.paths)) R.push({ path: "/paths", reason: "paths mapping is required" });
    if (R.length) return base;
    const paths: Record<string, Record<string, { operationId?: string; security?: unknown[] }>> = {};
    for (const [path, ops] of Object.entries(doc.paths as Record<string, unknown>)) {
      const p = `/paths/${ptr(path)}`;
      if (!/^\/[^\s?#]*$/.test(path) || path.length > 300) { R.push({ path: p, reason: "path must start with / and contain no spaces, query or fragment" }); continue; }
      if (!isMap(ops)) continue;
      paths[path] = {};
      for (const [m, op] of Object.entries(ops)) {
        if (!["get", "put", "post", "delete", "options", "head", "patch", "trace"].includes(m)) { I.push({ path: `${p}/${ptr(m)}`, reason: m === "servers" ? "server URLs are never contacted" : "not an operation; not read" }); continue; }
        if (!isMap(op)) continue;
        for (const k of Object.keys(op)) if (!["operationId", "security", "summary", "description", "tags"].includes(k)) I.push({ path: `${p}/${m}/${ptr(k)}`, reason: k === "callbacks" ? "callbacks are never registered or called" : k === "links" ? "links are never followed" : k === "servers" ? "server URLs are never contacted" : "operation detail not read by the inert route import" });
        paths[path]![m] = { ...(typeof op.operationId === "string" ? { operationId: op.operationId.slice(0, 160) } : {}), ...(Array.isArray(op.security) ? { security: op.security } : {}) };
      }
    }
    if (R.length) return base;
    try {
      const service = sanitizeId(o.service ?? String((isMap(doc.info) && typeof doc.info.title === "string" ? doc.info.title : "api")));
      base.routes = routesFromOpenApi({ openapi: doc.openapi as string, paths }, service, sanitizeId(o.environment ?? "imported"), Array.isArray(doc.security) && doc.security.length > 0);
      base.ok = true;
    } catch (e) { R.push({ path: "/openapi", reason: (e as Error).message.slice(0, 200) }); }
  }
  if (base.ok) {
    const declared = new Set([...(base.graph?.assets.map((a) => a.id) ?? []), ...base.routes.map((r) => r.service)]);
    base.identity_mapping.name_matches = (o.worldResourceIds ?? []).filter((id) => declared.has(id)).map((id) => ({ declared: id, world_resource: id }));
  }
  base.ignored.sort((a, b) => a.path.localeCompare(b.path));
  return base;
}

function findRefs(v: unknown, path: string, R: DescriptorIssue[], I: DescriptorIssue[], depth = 0): void {
  if (depth > 30) return;
  if (Array.isArray(v)) { v.forEach((x, i) => findRefs(x, `${path}/${i}`, R, I, depth + 1)); return; }
  if (!isMap(v)) return;
  for (const [k, x] of Object.entries(v)) {
    if (k === "$ref") {
      if (typeof x === "string" && x.startsWith("#")) I.push({ path: `${path}/$ref`, reason: "local references are not resolved by the inert route import" });
      else R.push({ path: `${path}/$ref`, reason: "remote or file references are never fetched or opened" });
    } else findRefs(x, `${path}/${ptr(k)}`, R, I, depth + 1);
  }
}

function issuesOf(e: unknown): DescriptorIssue[] {
  if (e instanceof ImportValidationError) return e.issues.map((s) => { const i = s.indexOf(": "); return { path: i > 0 ? s.slice(0, i) : "/", reason: i > 0 ? s.slice(i + 2) : s }; });
  return [{ path: "/", reason: (e as Error).message.slice(0, 200) }];
}
