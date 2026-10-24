import { canonicalJson } from "@dk/contracts";
import { sha256 } from "./security.ts";
import { HttpError, type Store } from "./store.ts";
import { provenanceOf } from "./provenance.ts";

/**
 * Declared configuration of a local run's enforcement points (`dk.local.config_snapshot.v1`).
 *
 * The supervisor side of a local run (the launcher holding the run's operator token, never an investigator) reports
 * the reviewed policy variant of each resource whose template has one (edge gateway, tenant API, agent tool gateway, worker),
 * with the run's own revision string for it. Digital Kingdom records it append-only, like an authorization snapshot,
 * and the analysis state turns the latest one into `policy` elements. That is what lets the LP14 generator propose a
 * typed `set_gateway_policy` repair for a local world whose defect is a weakened policy variant, bound to the exact
 * revision the lease precondition checks.
 *
 * What this is not: it is not evidence of what happened (it says nothing about requests or effects), it is never read
 * from scenario truth, and it is accepted only for a project with valid local-run provenance whose run id matches.
 * Admin only (the run's launcher); reading it needs analyst.
 */
export const LOCAL_CONFIG_SCHEMA = "dk.local.config_snapshot.v1";
export const LOCAL_CONFIG_MIGRATION = `
CREATE TABLE local_configurations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL, body TEXT NOT NULL, digest TEXT NOT NULL, stored_by TEXT NOT NULL, stored_at TEXT NOT NULL);
CREATE INDEX local_configurations_project ON local_configurations (project_id, stored_at);
CREATE TRIGGER local_configurations_append_only_u BEFORE UPDATE ON local_configurations BEGIN SELECT RAISE(ABORT, 'local configurations are append-only'); END;
CREATE TRIGGER local_configurations_append_only_d BEFORE DELETE ON local_configurations BEGIN SELECT RAISE(ABORT, 'local configurations are append-only'); END;`;

/** Templates with a reviewed policy variant (mirrors the local-world catalog's supported_settings). */
export const POLICY_TEMPLATES = ["gateway", "api", "agent_gateway", "worker"] as const;
export const POLICY_VARIANTS = ["baseline", "candidate", "deliberately_weak"] as const;
export const TENANT_MODES = ["isolated", "single"] as const;
export type PolicyTemplate = (typeof POLICY_TEMPLATES)[number];
export type PolicyVariant = (typeof POLICY_VARIANTS)[number];
export interface LocalConfigResource { resource_id: string; template: PolicyTemplate; policy_variant: PolicyVariant; tenant_mode?: (typeof TENANT_MODES)[number]; revision: string }
export interface LocalConfigSnapshot { schema: typeof LOCAL_CONFIG_SCHEMA; run_id: string; resources: LocalConfigResource[] }
export interface StoredLocalConfig extends LocalConfigSnapshot { id: string; digest: string; stored_at: string }

const PLAIN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export function latestLocalConfig(store: Store, projectId: string): StoredLocalConfig | null {
  const r = store.db.prepare("SELECT id, body, digest, stored_at FROM local_configurations WHERE project_id = ? ORDER BY stored_at DESC, rowid DESC LIMIT 1").get(projectId) as { id: string; body: string; digest: string; stored_at: string } | undefined;
  return r ? { ...(JSON.parse(r.body) as LocalConfigSnapshot), id: r.id, digest: r.digest, stored_at: r.stored_at } : null;
}

export function recordLocalConfig(store: Store, projectId: string, body: Record<string, unknown>, actor: string) {
  const project = store.getProject(projectId);
  if (!project) throw new HttpError(404, "project not found");
  const prov = provenanceOf(project);
  if (!prov.local_run) throw new HttpError(409, "a local configuration snapshot is accepted only for a project with valid local run provenance");
  const bad = Object.keys(body).filter((k) => !["schema", "run_id", "resources"].includes(k));
  if (bad.length) throw new HttpError(422, `unsupported field(s) ${bad.join(", ")}`);
  if (body.schema !== LOCAL_CONFIG_SCHEMA) throw new HttpError(422, `schema must be ${LOCAL_CONFIG_SCHEMA}`);
  if (body.run_id !== prov.run_id) throw new HttpError(409, `the snapshot names run ${String(body.run_id).slice(0, 80)}, not this project's run`);
  if (!Array.isArray(body.resources) || !body.resources.length || body.resources.length > 50) throw new HttpError(422, "resources must list 1-50 enforcement points");
  const graph = store.getGraph(projectId);
  const resources = body.resources.map((x, i): LocalConfigResource => {
    const o = x as Record<string, unknown>;
    if (!o || typeof o !== "object" || Array.isArray(o)) throw new HttpError(422, `resources[${i}] must be an object`);
    const extra = Object.keys(o).filter((k) => !["resource_id", "template", "policy_variant", "tenant_mode", "revision"].includes(k));
    if (extra.length) throw new HttpError(422, `resources[${i}] unsupported field(s) ${extra.join(", ")}`);
    if (typeof o.resource_id !== "string" || !PLAIN.test(o.resource_id)) throw new HttpError(422, `resources[${i}].resource_id must be a plain id`);
    if (!POLICY_TEMPLATES.includes(o.template as PolicyTemplate)) throw new HttpError(422, `resources[${i}].template must be one of ${POLICY_TEMPLATES.join(", ")}`);
    if (!POLICY_VARIANTS.includes(o.policy_variant as PolicyVariant)) throw new HttpError(422, `resources[${i}].policy_variant must be one of ${POLICY_VARIANTS.join(", ")}`);
    if (o.tenant_mode !== undefined && !TENANT_MODES.includes(o.tenant_mode as "isolated")) throw new HttpError(422, `resources[${i}].tenant_mode must be one of ${TENANT_MODES.join(", ")}`);
    if (typeof o.revision !== "string" || !PLAIN.test(o.revision)) throw new HttpError(422, `resources[${i}].revision must be the run's plain revision string`);
    const asset = graph?.assets.find((a) => a.id === o.resource_id);
    if (!asset) throw new HttpError(422, `resources[${i}]: ${o.resource_id} is not an asset of this project's graph`);
    const declared = /^([a-z_]+)@\d/.exec(asset.secondary_label ?? "")?.[1];
    if (declared !== o.template) throw new HttpError(422, `resources[${i}]: ${o.resource_id} is declared as ${declared ?? "no template"}, not ${String(o.template)}`);
    return { resource_id: o.resource_id, template: o.template as PolicyTemplate, policy_variant: o.policy_variant as PolicyVariant, ...(o.tenant_mode ? { tenant_mode: o.tenant_mode as "isolated" } : {}), revision: o.revision };
  });
  if (new Set(resources.map((r) => r.resource_id)).size !== resources.length) throw new HttpError(422, "resource ids must be unique");
  resources.sort((a, b) => a.resource_id.localeCompare(b.resource_id));
  const snap: LocalConfigSnapshot = { schema: LOCAL_CONFIG_SCHEMA, run_id: String(prov.run_id), resources };
  const digest = sha256(canonicalJson(snap));
  const at = store.now().toISOString();
  const id = `lcfg_${sha256(`${projectId}:${digest}:${at}:${Math.random()}`).slice(0, 16)}`;
  store.db.prepare("INSERT INTO local_configurations (id, project_id, run_id, body, digest, stored_by, stored_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, projectId, snap.run_id, canonicalJson(snap), digest, actor, at);
  store.audit(actor, "local.configuration", projectId, id, { digest, resources: resources.length });
  return { id, digest, stored_at: at, ...snap };
}
