/**
 * LP25 — held-out scenario generation, seed commitments and nuisance renaming.
 *
 * Held-out documents are generated from a private master seed into a private directory OUTSIDE the repository
 * (mode 0700/0600) and are never committed before the run is sealed. The preregistration records only commitments:
 * the generator version, SHA-256 of the master seed, and per document SHA-256 of its canonical JSON plus the world's
 * seed commitment. Ids, labels, run ids and artifact names are random and carry no answer; no expectations are stored in
 * the document (the referee computes the key from the executed truth).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkScenarioAgainstWorld, compileWorld, getBlueprint, instantiateBlueprint, parseScenario, seedCommitment, type WorldPlan } from "../../packages/local-world/src/index.ts";
import { canonicalJson } from "../../packages/contracts/src/index.ts";
import type { Family } from "./controller.ts";

export const HELDOUT_GENERATOR = "li-heldout-gen-1";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const docCommitment = (doc: unknown) => sha(canonicalJson(doc));

class Rng { private n = 0; constructor(private seed: string) {} next() { return parseInt(sha(`${this.seed}:${this.n++}`).slice(0, 8), 16) / 0x1_0000_0000; } bool(p = 0.5) { return this.next() < p; } hex(k: number) { return sha(`${this.seed}:h:${this.n++}`).slice(0, k); } pick<T>(xs: T[]) { return xs[Math.floor(this.next() * xs.length)]!; } }

type Step = Record<string, unknown>;
function schedule(steps: Step[], r: Rng) { let at = 0; return steps.map((s) => { at += 10 + Math.floor(r.next() * 6); return { at_ms: at, ...s }; }); }

/** One held-out document per family; toggles change the controlled truth, not only names. */
export function generateHeldout(family: Family, masterSeed: string, index: number) {
  const r = new Rng(`${HELDOUT_GENERATOR}:${masterSeed}:${family}:${index}`);
  const id = `lh-${r.hex(10)}`, seed = `lh-seed-${r.hex(16)}`;
  let steps: Step[] = [];
  if (family === "saas-storefront") {
    const [att, oth] = r.bool() ? ["tenant-a", "tenant-b"] : ["tenant-b", "tenant-a"];
    const own = r.bool(0.7), baselineCross = r.bool(0.7), delay = r.bool(0.5), outage = r.bool(0.7), weak = r.bool(0.85);
    steps = [
      { action: "sign_in", actor: `acct:${att}:user`, as: "s1" },
      { action: "sign_in", actor: `acct:${oth}:user`, as: "s2" },
      ...(own ? [{ action: "request_route", resource: "ingress", route: "GET /tenants/{tenant}/records", params: { tenant: att }, session: "s1" }] : []),
      ...(baselineCross ? [{ action: "request_route", resource: "ingress", route: "GET /tenants/{tenant}/records", params: { tenant: oth }, session: "s1" }] : []),
      { action: "request_route", resource: "ingress", route: "GET /tenants/{tenant}/records", params: { tenant: oth }, session: "s2" },
      ...(weak ? [{ action: "set_policy", resource: "api", policy_variant: "deliberately_weak" }] : []),
      ...(delay ? [{ action: "evidence", source: "api-sdk", fault: "delay" }] : []),
      { action: "request_route", resource: "ingress", route: "GET /tenants/{tenant}/records", params: { tenant: oth }, session: "s1" },
      ...(outage ? [{ action: "observer", observer: "audit", state: "stop" }, { action: "request_route", resource: "ingress", route: "GET /tenants/{tenant}/records", params: { tenant: oth }, session: "s1" }, { action: "observer", observer: "audit", state: "restart" }] : []),
      ...(delay ? [{ action: "evidence", source: "api-sdk", fault: "release" }] : []),
    ];
  } else if (family === "agent-workspace") {
    const [ra, rb, rc] = [`run-${r.hex(6)}`, `run-${r.hex(6)}`, `run-${r.hex(6)}`];
    const baseline = r.bool(0.7), weak = r.bool(0.8), drop = r.bool(0.6), extraAllowed = r.bool(0.5);
    steps = [
      { action: "agent_send", run: ra, to: "allowed-receiver" },
      ...(baseline ? [{ action: "agent_send", run: rb, to: "blocked-receiver" }] : []),
      { action: "agent_search", run: ra },
      ...(weak ? [{ action: "set_policy", resource: "tool-gateway", policy_variant: "deliberately_weak" }] : []),
      ...(drop ? [{ action: "evidence", source: "effects", fault: "drop" }] : []),
      { action: "agent_send", run: rc, to: "blocked-receiver" },
      ...(extraAllowed ? [{ action: "agent_send", run: rb, to: "allowed-receiver" }] : []),
      ...(drop ? [{ action: "evidence", source: "effects", fault: "restore" }] : []),
    ];
  } else {
    const noGrant = r.bool(0.7), grant = r.bool(0.85), revoke = r.bool(0.7), outage = r.bool(0.5);
    const use = { action: "use_credential", credential: "c1", resource: "deploy", route: "GET /tenants/{tenant}/records", params: { tenant: "release" } };
    steps = [
      { action: "publish_artifact", name: `build-${r.hex(5)}`, actor: "svc:builder", as: "a1" },
      { action: "select_artifact", artifact: "a1" },
      { action: "issue_credential", subject: "svc:deployer", as: "c1" },
      ...(noGrant ? [use] : []),
      ...(grant ? [{ action: "change_grant", subject: "svc:deployer", grant: "read:deploy-data", op: "add" }] : []),
      ...(outage ? [{ action: "observer", observer: "use-observer", state: "stop" }, use, { action: "observer", observer: "use-observer", state: "restart" }] : [use]),
      ...(revoke ? [{ action: "revoke_credential", credential: "c1" }, use] : []),
    ];
  }
  const doc = { schema: "dk.local.scenario.v1", id, version: 1, blueprint: family, blueprint_version: 1, seed, start: "2026-10-19T14:00:00.000Z", steps: schedule(steps, r), expect: [] as unknown[] };
  checkScenarioAgainstWorld(parseScenario(doc), compileWorld(instantiateBlueprint(family, { seed })));
  return doc;
}

export const PRIVATE_ROOT = () => process.env.DK_LI_PRIVATE_DIR ?? join(tmpdir(), "dk-li-private");
/** Write held-out documents to the private directory; return only commitments. */
export function materializeHeldout(prereg: string, masterSeed: string, families: Family[]) {
  const dir = join(PRIVATE_ROOT(), prereg);
  if (existsSync(dir)) throw new Error(`private directory ${dir} already exists`);
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
  writeFileSync(join(dir, "master-seed"), masterSeed, { mode: 0o600, flag: "wx" });
  const commitments = families.map((f, i) => {
    const doc = generateHeldout(f, masterSeed, i);
    const name = `${doc.id}.json`;
    writeFileSync(join(dir, name), JSON.stringify(doc, null, 1), { mode: 0o600, flag: "wx" });
    return { slot_doc: doc.id, family: f, doc_sha256: docCommitment(doc), seed_commitment: seedCommitment(doc.seed) };
  });
  return { dir, master_seed_sha256: sha(masterSeed), commitments };
}
export function loadHeldout(prereg: string, c: { slot_doc: string; doc_sha256: string }) {
  const doc = JSON.parse(readFileSync(join(PRIVATE_ROOT(), prereg, `${c.slot_doc}.json`), "utf8"));
  if (docCommitment(doc) !== c.doc_sha256) throw new Error(`held-out document ${c.slot_doc} does not match its preregistered commitment`);
  return doc;
}

/**
 * Nuisance renaming (LP25-A4): rename resources (by a plan with new ids), run ids, artifact names and step labels, and
 * jitter timing, without changing the controlled operations. Returns the renamed plan and document.
 */
export function renameSaas(doc: Record<string, any>, suffix: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const bp = getBlueprint("saas-storefront")!;
  const map: Record<string, string> = Object.fromEntries(bp.resources.map((r) => [r.id, `${r.template.replace(/_/g, "-")}-${suffix}`]));
  const base = instantiateBlueprint(bp, { seed: doc.seed });
  const plan: WorldPlan = { ...base, project_id: `lab-renamed-${suffix}`, resources: base.resources.map((r) => ({ ...r, id: map[r.id]!, depends_on: r.depends_on.map((d) => map[d]!) })) };
  const labelMap = new Map<string, string>();
  const steps = doc.steps.map((s: Record<string, any>, i: number) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const x: Record<string, any> = { ...s, at_ms: s.at_ms + i }; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (x.resource) x.resource = map[x.resource] ?? x.resource;
    if (x.observer) x.observer = map[x.observer] ?? x.observer;
    if (x.source) x.source = x.source.replace(/^([a-z-]+?)(-sdk)?$/, (_m: string, a: string, b: string) => `${map[a] ?? a}${b ?? ""}`);
    if (x.label) { const l = `n-${sha(`${suffix}:${x.label}`).slice(0, 8)}`; labelMap.set(x.label, l); x.label = l; }
    return x;
  });
  const renamed = { ...doc, id: `${doc.id}-r${suffix}`, steps, expect: (doc.expect ?? []).map((e: Record<string, any>) => ({ ...e, label: labelMap.get(e.label) ?? e.label, ...(e.resource ? { resource: map[e.resource] ?? e.resource } : {}) })) }; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { plan, doc: renamed, map };
}
